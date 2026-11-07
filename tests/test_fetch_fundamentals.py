"""pipeline/fetch_fundamentals.py - what a blank in Yahoo's answer does to
what is stored."""
import sys
import types

import pandas as pd

if "yfinance" not in sys.modules:          # never called here; only its name is
    _yf = types.ModuleType("yfinance")
    _yf.Ticker = object
    sys.modules["yfinance"] = _yf
import fetch_fundamentals as ff  # noqa: E402

COLS = ["symbol", "fetch_date", "name", "sector", "price", "market_cap", "pe", "dividend_yield",
        "roe", "book_value", "net_margin", "revenue"]
OLD = ["TCS", "2026-11-01", "Tata Consultancy", "Technology", 3000.0, 1.1e13, 25.0, 1.5, 0.45, 300.0, 0.2, 2.4e12]


def _stored(con):
    pd.DataFrame([OLD], columns=COLS).to_sql("fundamentals", con, index=False)


def _new(**blank):
    row = dict(zip(COLS, OLD))
    row["fetch_date"] = "2026-11-04"
    row.update(blank)
    return pd.DataFrame([row])


def test_a_ratio_that_stopped_applying_stays_blank(con):
    _stored(con)
    got = ff.keep_known_values(con, "fundamentals", _new(pe=None)).iloc[0]
    assert got["pe"] is None or pd.isna(got["pe"])        # loss-maker: no old P/E
    assert got["price"] == 3000.0


def test_identity_and_size_are_carried_forward(con):
    _stored(con)
    got = ff.keep_known_values(con, "fundamentals", _new(market_cap=None, sector=None)).iloc[0]
    assert got["market_cap"] == 1.1e13
    assert got["sector"] == "Technology"


def test_a_half_built_answer_keeps_everything(con):
    _stored(con)
    many = {c: None for c in ["pe", "dividend_yield", "roe", "book_value", "net_margin", "revenue"]}
    got = ff.keep_known_values(con, "fundamentals", _new(**many)).iloc[0]
    assert got["pe"] == 25.0 and got["roe"] == 0.45 and got["revenue"] == 2.4e12


def test_a_new_value_always_wins(con):
    _stored(con)
    assert ff.keep_known_values(con, "fundamentals", _new(pe=30.0)).iloc[0]["pe"] == 30.0


def _stmt_rows(sym, st, pt, item, v):
    return {"symbol": sym, "stmt_type": st, "period_type": pt, "period_end": "2026-03-31", "item": item, "value": v}


def test_partial_statements_replace_only_their_own_types(con):
    pd.DataFrame([_stmt_rows("TCS", "income", "annual", "Total Revenue", 1.0),
                  _stmt_rows("TCS", "balance", "annual", "Total Assets", 9.0),
                  _stmt_rows("INFY", "income", "annual", "Total Revenue", 5.0)]).to_sql("statements", con, index=False)
    ff.replace_statement_types(con, "TCS", pd.DataFrame([_stmt_rows("TCS", "income", "annual", "Total Revenue", 2.0)]))
    rows = sorted(con.execute("SELECT symbol, stmt_type, value FROM statements").fetchall())
    assert rows == [("INFY", "income", 5.0), ("TCS", "balance", 9.0), ("TCS", "income", 2.0)]
