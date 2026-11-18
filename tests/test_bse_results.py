"""BSE results archive: which filing stands for which period."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))

import fetch_bse_results as b  # noqa: E402


def test_quarter_and_year_strings():
    assert b.parse_quarter("Consolidated-Mar-22;MQ2021-2022;113.00;c", "Quarter") == ("consolidated", "quarterly", "2022-01-01", "2022-03-31")
    assert b.parse_quarter("Standalone-Mar-22;MQ2021-2022;113.00;D", "Year") == ("standalone", "annual", "2021-04-01", "2022-03-31")
    assert b.parse_quarter("Standalone-Dec-00;DQ2000-2001;28.00;D", "Quarter") == ("standalone", "quarterly", "2000-10-01", "2000-12-31")
    assert b.parse_quarter("Standalone-Sep-26;SQ;131;D", "Half Year") is None
    assert b.parse_quarter("garbage", "Quarter") is None


def row(q, kind="Quarter", cons=None, stand=None, status="New", filed="2022-05-20T15:52:39", revised=None):
    return {"Quarter": q, "Fld_QuarterName": kind, "conso_xbrl_link": cons, "stand_xbrl_link": stand,
            "Status": status, "Filing_Date_Time": filed, "Revised_Date_Time": revised}


def test_pick_prefers_consolidated_then_revised_and_keeps_first_date():
    rows = [
        row("Standalone-Mar-22;x;1;D", stand="/s.xml", filed="2022-05-20T15:00:00"),
        row("Consolidated-Mar-22;x;1;c", cons="/c.xml", filed="2022-05-20T15:30:00"),
        row("Consolidated-Mar-22;x;1;c", cons="/c2.xml", status="Revised", filed=None, revised="2022-06-01T10:00:00"),
        row("Consolidated-Mar-22;x;1;c", kind="Half Year", cons="/h.xml"),
        row("Standalone-Dec-21;x;1;D", stand=None),          # no XBRL: nothing to read
    ]
    got = b.pick(rows)
    assert len(got) == 1
    f = got[0]
    assert f["basis"] == "consolidated" and f["xbrl"].endswith("/c2.xml")
    assert f["filed"] == "2022-05-20"      # the results date is the first filing, not the revision


def test_oldest_units_wrong():
    import sqlite3
    import fetch_bse_results as m
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE results_history (symbol, basis, period_type, period_start, period_end, item, value)")
    for pe, v in [("2019-06-30", 1.5e9), ("2019-09-30", 1.6e9), ("2019-12-31", 1.2e9)]:
        con.execute("INSERT INTO results_history VALUES ('X','standalone','quarterly','',?, 'revenue', ?)", (pe, v))
    # PB Global's Dec-2018: 100,000x the run that follows - refused
    assert m.oldest_units_wrong(con, "X", "quarterly", "2018-12-31", 1.2e14)
    # a small start is a business starting, never judged
    assert not m.oldest_units_wrong(con, "X", "quarterly", "2018-12-31", 1.5e6)
    # an ordinary value passes
    assert not m.oldest_units_wrong(con, "X", "quarterly", "2018-12-31", 1.4e9)
    # with fewer than three newer periods there is nothing to judge by
    assert not m.oldest_units_wrong(con, "Y", "quarterly", "2018-12-31", 1.2e14)


# ── F2 (owner, 18-Nov-2026): holes inside a history, on the neighbours' basis ──

def test_inside_basis_matches_the_quarters_either_side():
    from fetch_bse_results import inside_basis
    stored = [("2017-12-31", "consolidated"), ("2018-09-30", "consolidated")]
    assert inside_basis(stored, "2018-03-31") == "consolidated"
    assert inside_basis(stored, "2017-09-30") is None          # before the history: no neighbour
    assert inside_basis(stored, "2019-03-31") is None          # after it: the newest quarters
    mixed = [("2017-12-31", "standalone"), ("2018-09-30", "consolidated")]
    assert inside_basis(mixed, "2018-03-31") is False          # no basis joins them


def test_holes_after_mid_2016_only():
    from fetch_bse_results import holes_after
    p = ["2015-06-30", "2015-12-31", "2017-12-31", "2018-09-30"]
    assert holes_after(p) == ["2016-06-30", "2016-09-30", "2016-12-31", "2017-03-31", "2017-06-30",
                              "2017-09-30", "2018-03-31", "2018-06-30"]
    assert holes_after(["2018-03-31", "2018-06-30"]) == []


def test_pick_keeps_each_basis_for_inside_fills():
    from fetch_bse_results import pick
    rows = [
        {"Quarter": "Consolidated-Mar-18;x", "Fld_QuarterName": "Quarter", "conso_xbrl_link": "/c.xml",
         "Filing_Date_Time": "2018-04-20T10:00:00", "Status": "New"},
        {"Quarter": "Standalone-Mar-18;x", "Fld_QuarterName": "Quarter", "stand_xbrl_link": "/s.xml",
         "Filing_Date_Time": "2018-04-19T10:00:00", "Status": "New"},
    ]
    [f] = pick(rows)
    assert f["basis"] == "consolidated" and set(f["alts"]) == {"consolidated", "standalone"}
    assert f["alts"]["standalone"]["xbrl"].endswith("/s.xml") and f["alts"]["standalone"]["filed"] == "2018-04-19"
