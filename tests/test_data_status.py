"""data_status: why a chart or figure is missing, and whose side it is on
(owner, 18-Nov-2026: "whether it's a glitch or something missing from the NSE data")."""
from datetime import date, timedelta

import trend_lib as tl
from conftest import make_results_history
from data_status import data_status
from fetch_bse_results import remember_codes

OK_LOG = ("2026-11-10 03:00:00", None, 0)
QS = [f"{y}-{md}" for y in (2022, 2023, 2024) for md in ("03-31", "06-30", "09-30", "12-31")]
BANDS = {k: {"series": [["2024-01-31", 10.0]] * 20, "median_5y": 10.0, "alt": {"q1": [1.0]}} for k in ("pe", "ev", "pb", "ps")}
DIAG = {"flows": 12, "shares": True, "dates": 60, "ttm": 40, "pe": 40, "ps": 40, "ebitda": 40, "ev": 40,
        "netdebt": True, "equity": 60, "equity_pos": 60}


def status(**kw):
    base = dict(exch="NSE", on_bse=False, listed_on="25-AUG-2004", nse_log=OK_LOG, bse_log=None,
                quarters=QS, annual_ends=set(), has_shares=True, diag=DIAG, bands=BANDS, ebitda_any=True)
    base.update(kw)
    return data_status(**base)


def sides(st):
    return [(it["side"], it["what"]) for it in st["items"]]


def test_nothing_missing_is_none():
    assert status() is None


def test_new_on_nse_with_a_bse_history_is_queued_not_never_filed():
    # ACGL: on BSE for decades, on NSE from 17-Aug-2026; the page said "no results filed".
    st = status(quarters=[], listed_on="17-AUG-2026", on_bse=True, diag=None, bands={})
    assert st["worst"] == "queued"
    it = st["items"][0]
    assert it["what"] == "Quarterly results" and it["whole"]
    assert "joined NSE on 17 Aug 2026" in it["why"] and "queued" in it["why"]
    assert "pe" in it["views"] and "sales" in it["views"]


def test_no_results_anywhere_after_both_archives_checked_is_source():
    st = status(quarters=[], on_bse=True, bse_log=("2026-11-17 12:00:00", None, 0), diag=None, bands={})
    assert st["worst"] == "source"
    assert "Neither NSE's nor BSE's" in st["items"][0]["why"]


def test_not_on_bse_and_nothing_on_nse_is_source():
    st = status(quarters=[], on_bse=False, diag=None, bands={})
    assert sides(st) == [("source", "Quarterly results")]
    assert "not listed on BSE" in st["items"][0]["why"]


def test_unknown_bse_listing_is_not_guessed():
    st = status(quarters=[], on_bse=None, diag=None, bands={})
    assert st["worst"] == "queued"
    assert "has not been checked" in st["items"][0]["why"]


def test_a_failed_nse_fetch_is_ours():
    st = status(quarters=[], nse_log=("2026-11-17 02:00:00", "Read timed out", 0), diag=None, bands={})
    assert st["worst"] == "ours"
    assert "failed on 17 Nov 2026" in st["items"][0]["why"]


def test_unreadable_nse_filings_are_ours():
    st = status(quarters=[], nse_log=("2026-11-17 02:00:00", "3 filings could not be read", 0), diag=None, bands={})
    assert st["worst"] == "ours"
    assert "could not read (3 on 17 Nov 2026)" in st["items"][0]["why"]


def test_bse_only_company_by_archive_state():
    q = status(exch="BSE", quarters=[], diag=None, bands={})
    assert q["worst"] == "queued" and "BSE only" in q["items"][0]["why"]
    bad = status(exch="BSE", quarters=[], bse_log=("2026-11-17 01:00:00", "403 Forbidden", 0), diag=None, bands={})
    assert bad["worst"] == "ours"
    none = status(exch="BSE", quarters=[], bse_log=("2026-11-17 01:00:00", None, 0), diag=None, bands={})
    assert none["worst"] == "source"


def test_q4_filed_inside_the_year_is_ours_other_gaps_are_the_archives():
    # TCS: Mar-2008 to Mar-2011 sit only inside the year's results (fixable);
    # Mar-2018 and Jun-2018 are in no readable NSE filing at all.
    qs = [f"{y}-{md}" for y in range(2007, 2020) for md in ("03-31", "06-30", "09-30", "12-31")]
    gone = {"2008-03-31", "2009-03-31", "2010-03-31", "2011-03-31", "2018-03-31", "2018-06-30"}
    annual = {f"{y}-03-31" for y in range(2007, 2018)} | {"2019-03-31"}
    st = status(quarters=[q for q in qs if q not in gone], annual_ends=annual, on_bse=True)
    got = sides(st)
    assert ("ours", "Quarters Mar-2008, Mar-2009, Mar-2010, Mar-2011") in got
    # Since F2 (18-Nov-2026) a hole after mid-2016 is BSE's to fill: queued until read...
    assert ("queued", "Quarters Mar-2018, Jun-2018") in got
    assert st["worst"] == "ours"
    # ...and once read with nothing on the neighbours' basis, missing at the source.
    read = status(quarters=[q for q in qs if q not in gone], annual_ends=annual, on_bse=True,
                  bse_log=("2026-11-19 01:00:00", None, 0))
    src = next(it for it in read["items"] if it["side"] == "source")
    assert src["what"] == "Quarters Mar-2018, Jun-2018" and "basis" in src["why"] and not src["whole"]


def test_pre_2016_holes_say_bse_cannot_fill_them():
    qs = [q for q in QS if q != "2023-06-30"]
    old = [f"2010-{md}" for md in ("03-31", "06-30", "12-31")] + qs       # Sep-2010 missing
    st = status(quarters=old, on_bse=True, bse_log=("2026-11-19 01:00:00", None, 0))
    src = next(it for it in st["items"] if "Sep-2010" in it["what"])
    assert src["side"] == "source" and "mid-2016" in src["why"]


def test_late_starter_gap_after_2016_waits_for_the_bse_read():
    qs = [q for q in QS if q != "2023-06-30"]
    st = status(quarters=qs, on_bse=True)
    assert ("queued", "Quarters Jun-2023") in sides(st)


def test_fewer_than_four_quarters():
    st = status(quarters=QS[-2:], diag={"flows": 2, "shares": True, "ttm": 0}, bands={}, on_bse=False)
    assert ("source", "12-month figures") in sides(st)
    assert "Only 2 quarters" in st["items"][0]["why"]
    late = status(quarters=QS[-2:], diag={"flows": 2, "shares": True, "ttm": 0}, bands={}, on_bse=True,
                  listed_on="20-APR-2026")
    assert late["worst"] == "queued" and "joined NSE on 20 Apr 2026" in late["items"][0]["why"]


def test_missing_share_count_is_ours():
    st = status(has_shares=False, diag={"flows": 12, "shares": False}, bands={})
    assert ("ours", "Share count") in sides(st)


def test_loss_maker_pe_is_a_rule_and_names_the_view():
    st = status(diag={**DIAG, "pe": 0}, bands={k: v for k, v in BANDS.items() if k != "pe"})
    assert sides(st) == [("rule", "P/E")]
    assert st["items"][0]["views"] == ["pe"] and "No 12-month period" in st["items"][0]["why"]


def test_ev_reasons():
    no_ev = {k: v for k, v in BANDS.items() if k != "ev"}
    assert sides(status(diag={**DIAG, "netdebt": False, "ev": 0}, bands=no_ev)) == [("source", "EV / EBITDA")]
    failed = status(diag={**DIAG, "netdebt": False, "ev": 0}, bands=no_ev,
                    stmt_log=("2026-11-01 01:00:00", "HTTP 500"))
    assert failed["worst"] == "ours"
    unknown = status(diag={**DIAG, "netdebt": False, "ev": 0}, bands=no_ev,
                     stmt_log=("2026-11-01 01:00:00", "no data returned (symbol unknown to Yahoo or delisted)"))
    assert unknown["worst"] == "source"
    loss = status(diag={**DIAG, "ebitda": 0, "ev": 0}, bands=no_ev)
    assert sides(loss) == [("rule", "EV / EBITDA")]
    # no EBITDA lines at all: one item for both views, not two
    bank = status(diag={**DIAG, "ebitda": 0, "ev": 0}, bands=no_ev, ebitda_any=False)
    assert sides(bank) == [("source", "EBITDA and EV / EBITDA")]
    assert sorted(bank["items"][0]["views"]) == ["ebitda", "ev"]


def test_negative_book_is_a_rule():
    st = status(diag={**DIAG, "equity_pos": 0}, bands={k: v for k, v in BANDS.items() if k != "pb"})
    assert sides(st) == [("rule", "Price / Book")]


def test_median_and_window_gaps_are_partial():
    young = {**BANDS, "pe": {"series": [["2026-01-31", 20.0]] * 9, "median_5y": None}}
    st = status(bands=young)
    got = {it["what"]: it for it in st["items"]}
    assert "needs 12 points and there are 9" in got["Median line"]["why"]
    assert got["1Q x4 window"]["views"] == ["pe"]
    assert not got["Median line"]["whole"] and not got["1Q x4 window"]["whole"]


def test_ratio_bands_diag_counts_what_decided_each_point(con):
    rows = []
    for i, p in enumerate(QS):
        eps = -1.0 if i < 6 else 1.0     # losses first, profits later
        rows += [("A", "quarterly", p, "eps", eps), ("A", "quarterly", p, "pat", eps * 100),
                 ("A", "quarterly", p, "revenue", 1000.0)]
    make_results_history(con, rows)
    con.execute("CREATE TABLE prices (symbol TEXT, freq TEXT, date TEXT, close REAL, volume REAL)")
    d, pts = date(2022, 1, 31), []
    while d < date(2027, 1, 1):
        pts.append(("A", "monthly", d.isoformat(), 100.0, 1.0))
        d = (d.replace(day=1) + timedelta(days=62)).replace(day=1) - timedelta(days=1)
    con.executemany("INSERT INTO prices VALUES (?,?,?,?,?)", pts)
    con.commit()
    diag: dict = {}
    tl.ratio_bands(con, {"A": 100.0, "B": 1.0}, diag=diag)
    a = diag["A"]
    assert a["shares"] and a["flows"] == 12
    assert 0 < a["pe"] < a["ttm"]           # the loss windows counted out of P/E only
    assert a["ps"] == a["ttm"]
    assert a["netdebt"] is False and a["ev"] == 0
    assert a["equity"] == 0


def test_ev_band_carries_a_latest_quarter_x4_window(con):
    # EBITDA 10 Cr a quarter, 20 Cr in the newest; net debt 50 Cr; 1 crore shares at Rs 100.
    rows = []
    for i, p in enumerate(QS):
        eb = (20.0 if i == len(QS) - 1 else 10.0) * 1e7
        rows += [("A", "quarterly", p, "eps", 1.0), ("A", "quarterly", p, "pat", 1e7),
                 ("A", "quarterly", p, "revenue", 100.0 * 1e7), ("A", "quarterly", p, "total_expenses", 100.0 * 1e7 - eb)]
    make_results_history(con, rows)
    con.execute("CREATE TABLE prices (symbol TEXT, freq TEXT, date TEXT, close REAL, volume REAL)")
    con.executemany("INSERT INTO prices VALUES (?,?,?,?,?)",
                    [("A", "monthly", f"{y}-{m:02d}-28", 100.0, 1.0) for y in (2023, 2024, 2025) for m in range(1, 13)])
    con.commit()
    nd = {"A": [(f"{y}-03-31", 50.0) for y in (2022, 2023, 2024, 2025)]}
    ev = tl.ratio_bands(con, {"A": 1e7}, nd)["A"]["ev"]
    q1 = ev["alt"]["q1"]
    assert len(q1) == len(ev["series"])
    mcap = 100.0 * 1e7 / 1e7                       # Rs 100 x 1 crore shares = 100 Cr
    assert q1[-1] == round((mcap + 50.0) / (20.0 * 4), 1)    # newest quarter x4
    assert ev["series"][-1][1] == round((mcap + 50.0) / (10.0 * 3 + 20.0), 1)   # TTM beside it


def test_remember_codes_keeps_old_matches(con):
    remember_codes(con, {"ACGL": "505036", "HNDFDS": 519126})
    remember_codes(con, {"HNDFDS": "519126"})      # a day without the bhavcopy
    rows = dict(con.execute("SELECT symbol, bse_code FROM bse_code_map").fetchall())
    assert rows == {"ACGL": "505036", "HNDFDS": "519126"}
