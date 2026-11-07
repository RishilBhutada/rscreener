"""pipeline/trend_lib.py - the long-term trends and valuation bands."""
import math
from datetime import date, timedelta

import pytest

import trend_lib as tl
from conftest import make_results_history, make_splits


# ── cagr_pct ────────────────────────────────────────────────────────────────

def test_cagr_plain_five_years():
    periods = [f"{y}-03-31" for y in range(2021, 2027)]
    vals = [100, 110, 120, 140, 170, 200]
    assert tl.cagr_pct(vals, periods, 5) == pytest.approx(round((2 ** (1 / 5) - 1) * 100, 2), abs=0.02)


def test_cagr_uses_the_real_span_after_a_changed_year_end():
    # ACC moved its year end: six entries, but the first to last is 5.25 years.
    periods = ["2020-12-31", "2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2026-03-31"]
    vals = [100, 110, 120, 130, 150, 200]
    span = (date(2026, 3, 31) - date(2020, 12, 31)).days / 365.25
    got = tl.cagr_pct(vals, periods, 5)
    assert got == pytest.approx(round((2 ** (1 / span) - 1) * 100, 2), abs=0.01)
    assert got < round((2 ** (1 / 5) - 1) * 100, 2)      # not stretched over 5 years


def test_cagr_withheld_when_a_gap_leaves_nothing_near_the_target():
    # No 2021 figure: the nearest are 4 and 6 years back, both a year off.
    periods = ["2020-03-31", "2022-03-31", "2023-03-31", "2024-03-31", "2025-03-31", "2026-03-31"]
    assert tl.cagr_pct([100, 120, 130, 150, 170, 200], periods, 5) is None


def test_cagr_counts_positions_by_date_not_index():
    # Seven years in six entries (3PLAND): counting positions would call this 5 years.
    periods = ["2019-03-31", "2020-03-31", "2022-03-31", "2023-03-31", "2024-03-31", "2026-03-31"]
    vals = [100, 110, 130, 140, 160, 200]
    got = tl.cagr_pct(vals, periods, 5)
    # the 2021 point is missing: nearest to 5y back is 2020 (6y) or 2022 (4y) - both refused
    assert got is None


def test_cagr_skips_missing_values_and_refuses_losses():
    periods = [f"{y}-03-31" for y in range(2021, 2027)]
    assert tl.cagr_pct([100, None, None, None, None, 200], periods, 5) is not None
    assert tl.cagr_pct([-100, 1, 1, 1, 1, 200], periods, 5) is None
    assert tl.cagr_pct([100, 1, 1, 1, 1, -5], periods, 5) is None
    assert tl.cagr_pct([200], ["2026-03-31"], 5) is None


# ── _derive ─────────────────────────────────────────────────────────────────

def test_derive_computes_operating_profit_and_adds_other_income():
    d = tl._derive({"revenue": 1000.0, "total_expenses": 800.0, "finance_cost": 50.0,
                    "depreciation": 30.0, "other_income": 20.0})
    assert d["ebitda"] == 280.0
    assert d["ebitda_oi"] == 300.0


def test_derive_filed_operating_profit_wins_when_arithmetic_agrees_and_gets_no_other_income():
    d = tl._derive({"revenue": 1000.0, "total_expenses": 800.0, "finance_cost": 50.0,
                    "depreciation": 30.0, "op_profit_direct": 290.0, "other_income": 20.0})
    assert d["ebitda"] == 290.0
    assert d["ebitda_oi"] == 290.0          # the bank's filed figure already holds it


def test_derive_filed_figure_far_from_arithmetic_loses():
    d = tl._derive({"revenue": 1000.0, "total_expenses": 800.0, "finance_cost": 50.0,
                    "depreciation": 30.0, "op_profit_direct": 2000.0, "other_income": 20.0})
    assert d["ebitda"] == 280.0
    assert d["ebitda_oi"] == 300.0          # computed figure: other income IS added


def test_derive_bank_with_no_expense_lines_uses_filed_figure():
    d = tl._derive({"revenue": 1000.0, "op_profit_direct": 500.0, "other_income": 40.0})
    assert d["ebitda"] == 500.0
    assert d["ebitda_oi"] == 500.0


def test_derive_second_source_only_when_filing_gives_nothing():
    # TCS: the second source's EBITDA must not override the filing's arithmetic
    d = tl._derive({"revenue": 1000.0, "total_expenses": 800.0, "ebitda_direct": 150.0})
    assert d["ebitda"] == 200.0
    d = tl._derive({"ebitda_direct": 150.0, "other_income": 10.0})
    assert d["ebitda"] == 150.0
    assert d["ebitda_oi"] == 160.0


def test_derive_gross_profit_from_cost_parts():
    d = tl._derive({"revenue": 1000.0, "cost_materials": 300.0, "purchases": 100.0, "inv_change": -20.0})
    assert d["gross_profit"] == 620.0
    assert tl._derive({"revenue": 1000.0})["gross_profit"] is None
    assert tl._derive({})["ebitda"] is None


# ── years_from_quarters ─────────────────────────────────────────────────────

def _q(rev, pat=10.0, eps=1.0, basis="consolidated"):
    return {"_source": "nse", "_basis": basis, "revenue": rev, "pat": pat, "eps": eps}


def test_years_from_quarters_builds_a_march_year():
    comps = {
        ("A", "annual"): {"2024-03-31": {"_source": "nse", "revenue": 400.0, "pat": 40.0}},
        ("A", "quarterly"): {p: _q(100.0 + i) for i, p in enumerate(
            ["2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31"])},
    }
    tl.years_from_quarters(comps)
    y = comps[("A", "annual")]["2025-03-31"]
    assert y["_source"] == "nse-4q"
    assert y["revenue"] == 100 + 101 + 102 + 103
    assert y["pat"] == 40.0
    assert comps[("A", "annual")]["2024-03-31"]["revenue"] == 400.0      # a filed year is never rebuilt


@pytest.mark.parametrize("fy_end,quarters,want,not_want", [
    # December year-end (ABB, Castrol)
    ("2023-12-31", ["2023-06-30", "2023-09-30", "2023-12-31", "2024-03-31", "2024-06-30",
                    "2024-09-30", "2024-12-31"], "2024-12-31", "2024-03-31"),
    # September year-end (Siemens)
    ("2023-09-30", ["2023-03-31", "2023-06-30", "2023-09-30", "2023-12-31", "2024-03-31",
                    "2024-06-30", "2024-09-30"], "2024-09-30", "2024-03-31"),
])
def test_years_from_quarters_no_made_up_march_year(fy_end, quarters, want, not_want):
    comps = {
        ("A", "annual"): {fy_end: {"_source": "nse", "revenue": 400.0, "pat": 40.0}},
        ("A", "quarterly"): {p: _q(100.0) for p in quarters},
    }
    tl.years_from_quarters(comps)
    years = comps[("A", "annual")]
    assert want in years and years[want]["_source"] == "nse-4q"
    assert not_want not in years


def test_years_from_quarters_refuses_mixed_basis():
    qs = {p: _q(100.0) for p in ["2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31"]}
    qs["2024-09-30"]["_basis"] = "standalone"
    comps = {("A", "annual"): {"2024-03-31": {"_source": "nse", "revenue": 1.0, "pat": 1.0}},
             ("A", "quarterly"): qs}
    tl.years_from_quarters(comps)
    assert "2025-03-31" not in comps[("A", "annual")]


def test_years_from_quarters_leaves_skipped_years_alone():
    second_source = {"_source": "yf", "revenue": 999.0, "pat": 9.0}
    comps = {
        ("A", "annual"): {"2024-03-31": {"_source": "nse", "revenue": 1.0, "pat": 1.0},
                          "2025-03-31": dict(second_source)},
        ("A", "quarterly"): {p: _q(100.0) for p in ["2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31"]},
    }
    tl.years_from_quarters(comps, skip={("A", "2025-03-31")})
    assert comps[("A", "annual")]["2025-03-31"] == second_source
    tl.years_from_quarters(comps)                 # without the skip it IS rebuilt
    assert comps[("A", "annual")]["2025-03-31"]["_source"] == "nse-4q"


def test_years_from_quarters_needs_all_four_quarters():
    comps = {("A", "annual"): {"2024-03-31": {"_source": "nse", "revenue": 1.0, "pat": 1.0}},
             ("A", "quarterly"): {p: _q(100.0) for p in ["2024-06-30", "2024-12-31", "2025-03-31", "2023-12-31"]}}
    tl.years_from_quarters(comps)
    assert "2025-03-31" not in comps[("A", "annual")]


def test_years_from_quarters_puts_eps_on_year_end_share_base():
    # 2:1 split on 1-Nov-2024: the two quarters before it are halved.
    comps = {("A", "annual"): {"2024-03-31": {"_source": "nse", "revenue": 1.0, "pat": 1.0}},
             ("A", "quarterly"): {p: _q(100.0, eps=10.0) for p in
                                  ["2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31"]}}
    tl.years_from_quarters(comps, splits={"A": [("2024-11-01", 2.0)]})
    assert comps[("A", "annual")]["2025-03-31"]["eps"] == pytest.approx(5 + 5 + 10 + 10)


# ── _fy_quarter_sums ────────────────────────────────────────────────────────

def test_fy_quarter_sums_uses_the_years_own_quarters(con):
    rows = [("A", "quarterly", p, "revenue", v) for p, v in
            [("2023-12-31", 1.0), ("2024-03-31", 10.0), ("2024-06-30", 20.0), ("2024-09-30", 30.0),
             ("2024-12-31", 40.0), ("2025-03-31", 1000.0)]]
    make_results_history(con, rows)
    assert tl._fy_quarter_sums(con, "A", "revenue", "2024-12-31") == 100.0
    assert tl._fy_quarter_sums(con, "A", "revenue", "2025-03-31") == 20 + 30 + 40 + 1000


def test_fy_quarter_sums_incomplete_year_is_none_and_duplicates_count_once(con):
    rows = [("A", "quarterly", p, "revenue", 10.0) for p in ["2024-06-30", "2024-09-30", "2025-03-31"]]
    rows.append(("A", "quarterly", "2025-03-31", "revenue", 10.0))   # duplicated filing row
    make_results_history(con, rows)
    assert tl._fy_quarter_sums(con, "A", "revenue", "2025-03-31") is None   # Dec quarter missing
    make_results_history(con, [("A", "quarterly", "2024-12-31", "revenue", 10.0)])
    tl._QSUM_CACHE.clear()
    assert tl._fy_quarter_sums(con, "A", "revenue", "2025-03-31") == 40.0


# ── splits_trustworthy ──────────────────────────────────────────────────────

def _quarters(n, start=date(2015, 3, 31)):
    out, y, m = [], start.year, start.month
    for _ in range(n):
        out.append(tl._months_back(f"{y:04d}-{m:02d}-28", 0))
        m += 3
        if m > 12:
            m -= 12
            y += 1
    return out


def _counts_rows(sym, counts):
    rows = []
    for p, c in zip(_quarters(len(counts)), counts):
        rows += [(sym, "quarterly", p, "pat", c * 10.0), (sym, "quarterly", p, "eps", 10.0)]
    return rows


def test_splits_trustworthy_both_directions_and_median(con):
    make_results_history(con, (
        _counts_rows("OK", [100] * 6)                       # no splits, count matches today
        + _counts_rows("MISSING", [1] * 6)                  # 100x growth, nothing recorded
        + _counts_rows("TOOMANY", [100] * 6)                # a recorded 10x split that never happened
        + _counts_rows("SPLIT", [10] * 6)                   # a real 10x split, recorded
        + _counts_rows("ODDFIRST", [1, 100, 100, 100, 100, 100])   # oldest filing a parse error
    ))
    make_splits(con, [("TOOMANY", "2030-01-01", 10.0), ("SPLIT", "2030-01-01", 10.0)])
    shares = {s: 100.0 for s in ("OK", "MISSING", "TOOMANY", "SPLIT", "ODDFIRST")}
    got = tl.splits_trustworthy(con, shares, suspect={})
    assert got == {"OK", "SPLIT", "ODDFIRST"}


def test_splits_trustworthy_reads_only_the_four_oldest(con):
    make_results_history(con, _counts_rows("A", [100, 100, 100, 100, 1, 1, 1, 1]))
    assert tl.splits_trustworthy(con, {"A": 100.0}, suspect={}) == {"A"}


# ── _spikes ─────────────────────────────────────────────────────────────────

def test_spikes_flags_a_jump_that_comes_back():
    assert tl._spikes([("a", 100), ("b", 600), ("c", 100)], 3.0) == {"b"}
    assert tl._spikes([("a", 100), ("b", 10), ("c", 110)], 3.0) == {"b"}


def test_spikes_ignores_a_permanent_step_and_disagreeing_neighbours():
    assert tl._spikes([("a", 100), ("b", 100), ("c", 600), ("d", 600)], 3.0) == set()
    assert tl._spikes([("a", 100), ("b", 900), ("c", 300)], 3.0) == set()
    assert tl._spikes([("a", 100), ("b", None), ("c", 100)], 3.0) == set()
    assert tl._spikes([("a", 100), ("b", 290), ("c", 100)], 3.0) == set()   # under the factor


# ── net_worth ───────────────────────────────────────────────────────────────

def test_net_worth_rejects_paid_up_capital():
    assert tl.net_worth({"equity": 1000.0, "share_capital": 100.0}) == 1000.0
    assert tl.net_worth({"equity": 200.0, "share_capital": 100.0}) is None
    assert tl.net_worth({"equity": 1000.0}) is None              # nothing to judge against
    assert tl.net_worth({"equity": float("nan"), "share_capital": 1.0}) is None
    assert tl.net_worth({"share_capital": 1.0}) is None


def test_net_worth_judges_against_the_symbols_median_capital():
    # HDFC Bank Dec-2016: the row's own capital is corrupt (tiny)
    slot = {"equity": 250.0, "share_capital": 0.02}
    assert tl.net_worth(slot) == 250.0                      # the per-row test would pass it
    assert tl.net_worth(slot, sc_ref=100.0) is None         # the symbol's median catches it
    ref = tl.share_capital_ref({"a": {"share_capital": 100.0}, "b": {"share_capital": 0.02},
                                "c": {"share_capital": 100.0}})
    assert ref == 100.0


# ── effective_shares / adj_factor ───────────────────────────────────────────

def test_effective_shares():
    assert tl.effective_shares(1000.0, 10.0, 2.0) == 200.0
    assert tl.effective_shares(1000.0, 10.0, 1.0, sh_now=100.0) == 100.0
    assert tl.effective_shares(1000.0, 0.01, 1.0, sh_now=100.0) is None    # breakeven noise
    assert tl.effective_shares(1000.0, 10.0, 1.0, sh_now=10000.0) is None  # below 1/50 of today
    assert tl.effective_shares(None, 10.0, 1.0) is None
    assert tl.effective_shares(1000.0, 0, 1.0) is None
    assert tl.effective_shares(-1000.0, 10.0, 1.0) is None


def test_adj_factor():
    ev = [("2020-01-01", 2.0), ("2022-01-01", 5.0)]
    assert tl.adj_factor(ev, "2019-12-31") == 10.0
    assert tl.adj_factor(ev, "2020-01-01") == 5.0        # on the ex-date: already split
    assert tl.adj_factor(ev, "2021-06-30") == 5.0
    assert tl.adj_factor(ev, "2023-01-01") == 1.0
    assert tl.adj_factor(None, "2023-01-01") == 1.0
    assert tl.adj_factor([], "2023-01-01") == 1.0


# ── ratio_bands: the TTM window ─────────────────────────────────────────────

def _band_db(con, sym, quarters, shares=100.0):
    """quarters: [(period_end, eps, basis)]; pat = eps x shares so the split
    check trusts the empty split history."""
    rows = []
    for p, eps, basis in quarters:
        rows += [(sym, "quarterly", p, "eps", eps, basis), (sym, "quarterly", p, "pat", eps * shares, basis),
                 (sym, "quarterly", p, "revenue", 1000.0, basis)]
    make_results_history(con, rows)
    con.execute("CREATE TABLE IF NOT EXISTS prices (symbol TEXT, freq TEXT, date TEXT, close REAL, volume REAL)")
    d = date(2022, 1, 31)
    pts = []
    while d < date(2027, 1, 1):
        pts.append((sym, "monthly", d.isoformat(), 100.0, 1.0))
        d = (d.replace(day=1) + timedelta(days=62)).replace(day=1) - timedelta(days=1)
    con.executemany("INSERT INTO prices VALUES (?,?,?,?,?)", pts)
    con.commit()


QS = ["2022-03-31", "2022-06-30", "2022-09-30", "2022-12-31", "2023-03-31", "2023-06-30",
      "2023-09-30", "2023-12-31", "2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31"]


def _windows(con, sym):
    bands = tl.ratio_bands(con, {sym: 100.0})
    return [part[2] for part in bands[sym]["pe"]["parts"]]


def test_ratio_bands_ttm_needs_four_consecutive_quarters(con):
    gap = "2023-06-30"
    _band_db(con, "A", [(p, 1.0, "consolidated") for p in QS if p != gap])
    wins = _windows(con, "A")
    assert wins, "some TTM windows must exist"
    for w in wins:
        span = (date.fromisoformat(w[-1]) - date.fromisoformat(w[0])).days
        assert span <= 300, w
        assert gap not in w
    # no window bridges the hole: none starts before it and ends after it
    assert not [w for w in wins if w[0] < gap < w[-1]]


def test_ratio_bands_ttm_on_one_basis(con):
    odd = "2023-06-30"
    _band_db(con, "A", [(p, 1.0, "standalone" if p == odd else "consolidated") for p in QS])
    wins = _windows(con, "A")
    assert wins
    assert not [w for w in wins if odd in w]
    assert [w for w in wins if w[-1] == "2023-03-31"]      # the windows around it still draw


def test_ratio_bands_ttm_eps_is_the_sum_of_the_four(con):
    _band_db(con, "A", [(p, float(i + 1), "consolidated") for i, p in enumerate(QS)])
    bands = tl.ratio_bands(con, {"A": 100.0})
    for price, ttm_eps, quarters in bands["A"]["pe"]["parts"]:
        want = sum(QS.index(q) + 1 for q in quarters)
        assert ttm_eps == pytest.approx(want)
        assert price == 100.0


def test_cagr_never_starts_on_the_other_basis():
    # Consolidated years to FY24, FY25-26 rebuilt from standalone quarters.
    periods = [f"{y}-03-31" for y in range(2020, 2027)]
    vals = [100, 110, 120, 130, 140, 60, 70]
    basis = ["consolidated"] * 5 + ["standalone"] * 2
    assert tl.cagr_pct(vals, periods, 5, basis) is None          # FY21 start is consolidated
    assert tl.cagr_pct(vals, periods, 1, basis) == pytest.approx((70 / 60 - 1) * 100, abs=0.05)
    same = ["consolidated"] * 7
    assert tl.cagr_pct(vals, periods, 5, same) is not None
    assert tl.cagr_pct(vals, periods, 5, [None] * 7) is not None  # unknown basis: not judged


def test_ratio_bands_quarter_eps_adds_up_to_the_ttm(con):
    _band_db(con, "A", [(p, float(i + 1), "consolidated") for i, p in enumerate(QS)])
    b = tl.ratio_bands(con, {"A": 100.0})["A"]["pe"]
    for _price, ttm, quarters in b["parts"]:
        assert sum(b["q_eps"][q] for q in quarters) == pytest.approx(ttm, abs=0.02)
