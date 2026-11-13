"""One-off items and the P/E without them (pipeline/oneoffs_lib.py)."""
import sqlite3

import pytest

import oneoffs_lib as ol

CR = 1e7  # rupees in a crore


def q(pat, exc, pbt=400, tax=100):
    return {"pat": pat * CR, "exceptional": None if exc is None else exc * CR, "pbt": pbt * CR, "tax": tax * CR}


def test_a_charge_makes_the_core_pe_lower():
    # Rs 200 Cr charge before tax at a 25% rate = Rs 150 Cr after tax, 15% of
    # a Rs 1,000 Cr year. Without it EPS is 11.5, not 10.
    f = ol.core_figures(100.0, 10.0, [q(250, -200), q(250, 0), q(250, 0), q(250, 0)])
    assert f == {"pe_filed": 10.0, "oneoff_pct": -15.0, "eps_core": 11.5, "pe_core": 8.7}


def test_a_gain_makes_the_core_pe_higher_with_the_fallback_rate():
    # No profit before tax that quarter: the 25.17% rate stands in.
    f = ol.core_figures(100.0, 10.0, [q(250, 400, pbt=0, tax=0), q(250, 0), q(250, 0), q(250, 0)])
    assert f["oneoff_pct"] == 29.9
    assert f["pe_core"] == 14.3


def test_an_implausible_tax_rate_is_not_used():
    assert ol.after_tax(100.0, 100.0, 90.0) == pytest.approx(100 * (1 - ol.TAX_FALLBACK))
    assert ol.after_tax(100.0, 100.0, -5.0) == pytest.approx(100 * (1 - ol.TAX_FALLBACK))
    assert ol.after_tax(100.0, 100.0, 30.0) == pytest.approx(70.0)


def test_an_unstated_quarter_leaves_only_the_filed_pe():
    f = ol.core_figures(100.0, 10.0, [q(250, -200), q(250, None), q(250, 0), q(250, 0)])
    assert f == {"pe_filed": 10.0}


def test_no_profit_without_the_one_off():
    # A Rs 1,500 Cr gain (no tax on it) in a Rs 1,000 Cr year: underneath, a loss.
    f = ol.core_figures(100.0, 10.0, [q(250, 1500, pbt=1600, tax=0), q(250, 0), q(250, 0), q(250, 0)])
    assert f["oneoff_pct"] == 150.0
    assert f["pe_core"] is None and f["eps_core"] is None


def test_no_pe_no_figures():
    assert ol.core_figures(100.0, 0.0, [q(250, 0)] * 4) == {}
    assert ol.core_figures(100.0, -3.0, [q(250, 0)] * 4) == {}
    assert ol.core_figures(None, 10.0, [q(250, 0)] * 4) == {}


def test_a_loss_year_gives_no_share():
    f = ol.core_figures(100.0, 10.0, [q(-250, -200), q(250, 0), q(-250, 0), q(-250, 0)])
    assert f == {"pe_filed": 10.0}


def test_screen_fields_reads_the_pe_points_own_quarters(tmp_path):
    con = sqlite3.connect(tmp_path / "t.db")
    con.execute("CREATE TABLE results_history (symbol, basis, period_type, period_start, period_end, item, value)")
    Q = ["2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"]
    rows = []
    for sym, exc in (("AAA", [-200, 0, 0, 0]), ("BBB", [0, 0, 0, 0])):
        for p, e in zip(["2025-09-30", *Q], [999, *exc]):   # an older quarter outside the window
            for item, v in (("pat", 250), ("exceptional", e), ("pbt", 400), ("tax", 100)):
                rows.append((sym, "consolidated", "quarterly", "", p, item, v * CR))
    con.executemany("INSERT INTO results_history VALUES (?,?,?,?,?,?,?)", rows)
    band = lambda d: {"series": [[d, 10.0]], "parts": [[100.0, 10.0, Q]]}
    bands = {"AAA": band("2026-11-12"), "BBB": band("2026-11-12"), "OLD": band("2026-06-01")}
    out = ol.screen_fields(con, bands)
    assert out["AAA"]["oneoff_pct"] == -15.0 and out["AAA"]["pe_core"] == 8.7
    assert out["BBB"] == {"pe_filed": 10.0, "oneoff_pct": 0.0, "eps_core": 10.0, "pe_core": 10.0}
    assert "OLD" not in out   # its newest P/E point is months old: not today's quarters
