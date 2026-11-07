"""screen_fields.py, ratios_lib.py and export_backtest.py."""
from datetime import date, timedelta

import pytest

import export_backtest as bt
import ratios_lib
import screen_fields
from conftest import make_splits, make_statements


# ── screen_fields.quarter_growth ────────────────────────────────────────────

def _trend(basis):
    return {"S": {"quarterly": {
        "periods": ["2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"],
        "revenue": [100.0, 110.0, 120.0, 130.0, 150.0],
        "pat": [10.0, 11.0, 12.0, 13.0, 20.0],
        "basis": basis,
    }}}


def test_quarter_growth_same_basis():
    got = screen_fields.quarter_growth(_trend(["consolidated"] * 5))["S"]
    assert got["qtr_sales_yoy"] == 50.0
    assert got["qtr_profit_yoy"] == 100.0
    assert got["qtr_sales_qoq"] == pytest.approx(15.4)
    assert got["qtr_sales"] == 150.0


def test_quarter_growth_refuses_yoy_and_qoq_across_a_basis_change():
    got = screen_fields.quarter_growth(_trend(["standalone"] * 4 + ["consolidated"]))["S"]
    for k in ("qtr_sales_yoy", "qtr_profit_yoy", "qtr_sales_qoq", "qtr_profit_qoq"):
        assert k not in got
    assert got["qtr_sales"] == 150.0           # the quarter's own figure still shows


def test_quarter_growth_refuses_only_the_comparison_that_crosses():
    got = screen_fields.quarter_growth(_trend(["standalone"] + ["consolidated"] * 4))["S"]
    assert "qtr_sales_yoy" not in got          # year-ago quarter is standalone
    assert got["qtr_sales_qoq"] == pytest.approx(15.4)


def test_quarter_growth_no_growth_from_a_loss():
    t = _trend(["consolidated"] * 5)
    t["S"]["quarterly"]["pat"][0] = -5.0
    assert "qtr_profit_yoy" not in screen_fields.quarter_growth(t)["S"]


# ── screen_fields.piotroski ─────────────────────────────────────────────────

def _f_score_db(con, with_split):
    cur = date.today() - timedelta(days=200)
    prev = cur - timedelta(days=365)
    rows = []
    for pe, v in ((prev.isoformat(), dict(ni=50, rev=900, gp=300, ta=1000, ltd=200, ca=200, cl=100, sh=100, cfo=60)),
                  (cur.isoformat(), dict(ni=100, rev=1000, gp=400, ta=1000, ltd=100, ca=300, cl=100, sh=200, cfo=150))):
        names = {"ni": "Net Income", "rev": "Total Revenue", "gp": "Gross Profit", "ta": "Total Assets",
                 "ltd": "Long Term Debt", "ca": "Current Assets", "cl": "Current Liabilities",
                 "sh": "Ordinary Shares Number", "cfo": "Operating Cash Flow"}
        rows += [("S", "x", "annual", pe, names[k], float(x)) for k, x in v.items()]
    make_statements(con, rows)
    make_splits(con, [("S", (prev + timedelta(days=100)).isoformat(), 2.0)] if with_split else [])


def test_piotroski_puts_last_years_shares_on_this_years_split_base(con):
    _f_score_db(con, with_split=True)
    assert screen_fields.piotroski(con)["S"]["f_score"] == 9


def test_piotroski_without_the_split_the_doubling_counts_as_new_shares(con):
    _f_score_db(con, with_split=False)
    assert screen_fields.piotroski(con)["S"]["f_score"] == 8


# ── ratios_lib.derived_roe ──────────────────────────────────────────────────

def _roe_db(con, ni_year, eq_years):
    rows = [("S", "income", "annual", ni_year, "Net Income Common Stockholders", 100.0)]
    rows += [("S", "balance", "annual", y, "Stockholders Equity", v) for y, v in eq_years]
    make_statements(con, rows)


def _ye(years_ago):
    return (date.today() - timedelta(days=150 + 365 * years_ago)).isoformat()


def test_derived_roe_average_equity(con):
    _roe_db(con, _ye(0), [(_ye(1), 400.0), (_ye(0), 600.0)])
    assert ratios_lib.derived_roe(con)["S"] == pytest.approx(0.2)


def test_derived_roe_profit_year_must_be_the_closing_equity_year(con):
    _roe_db(con, _ye(0), [(_ye(2), 400.0), (_ye(1), 600.0)])
    assert "S" not in ratios_lib.derived_roe(con)


def test_derived_roe_stale_year_is_withheld(con):
    _roe_db(con, _ye(3), [(_ye(4), 400.0), (_ye(3), 600.0)])
    assert "S" not in ratios_lib.derived_roe(con)


def test_derived_roe_needs_adjacent_years_and_positive_equity(con):
    _roe_db(con, _ye(0), [(_ye(2), 400.0), (_ye(0), 600.0)])        # two years apart
    assert "S" not in ratios_lib.derived_roe(con)


def test_derived_roe_negative_equity_withheld(con):
    _roe_db(con, _ye(0), [(_ye(1), -400.0), (_ye(0), -600.0)])
    assert "S" not in ratios_lib.derived_roe(con)


# ── export_backtest.snapshot ────────────────────────────────────────────────

WHEN = date(2025, 6, 30)
PERIODS = ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31"]


def _company(depreciation=None, basis=None):
    return {
        "prices": {"monthly": [["2024-06-28", 80.0], ["2025-06-30", 100.0], ["2026-06-30", 120.0]]},
        "quarters": [{"end": p, "announced": (date.fromisoformat(p) + timedelta(days=30)).isoformat()}
                     for p in PERIODS],
        "trend": {"quarterly": {
            "periods": PERIODS,
            "revenue": [100.0, 100.0, 100.0, 100.0, 120.0],
            "pat": [10.0, 10.0, 10.0, 10.0, 12.0],
            "ebitda": [30.0, 30.0, 30.0, 30.0, 30.0],
            "depreciation": depreciation or [None] * 5,
            "basis": basis or ["consolidated"] * 5,
        }},
    }


def _field(row, name):
    return row[bt.FIELDS.index(name)]


def test_snapshot_bank_without_depreciation_keeps_op_margin():
    row = bt.snapshot(_company(), WHEN)
    assert _field(row, "op_margin") == pytest.approx(120 / 420 * 100, rel=1e-2)
    row = bt.snapshot(_company(depreciation=[5.0] * 5), WHEN)
    assert _field(row, "op_margin") == pytest.approx(100 / 420 * 100, rel=1e-2)


def test_snapshot_ttm_and_yoy_on_one_basis():
    row = bt.snapshot(_company(), WHEN)
    assert _field(row, "net_margin") == pytest.approx(42 / 420 * 100, rel=1e-2)
    assert _field(row, "qtr_sales_yoy") == pytest.approx(20.0)
    assert row[-1] == pytest.approx(20.0)                   # forward 12-month return


def test_snapshot_refuses_ttm_across_a_basis_change():
    row = bt.snapshot(_company(basis=["consolidated"] * 3 + ["standalone", "consolidated"]), WHEN)
    assert _field(row, "net_margin") is None
    assert _field(row, "op_margin") is None


def test_snapshot_refuses_yoy_across_a_basis_change():
    row = bt.snapshot(_company(basis=["standalone"] + ["consolidated"] * 4), WHEN)
    assert _field(row, "qtr_sales_yoy") is None
    assert _field(row, "rev_growth") is None
    assert _field(row, "net_margin") is not None            # the TTM window itself is one basis


def test_snapshot_counts_quarters_only_once_announced():
    c = _company()
    c["quarters"][-1]["announced"] = "2025-07-15"           # not yet out on 30 June
    row = bt.snapshot(c, WHEN)
    assert _field(row, "net_margin") == pytest.approx(10.0)
    assert _field(row, "qtr_sales_yoy") is None             # no 2023 June quarter to compare
