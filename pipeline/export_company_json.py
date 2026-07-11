"""Rscreener P3 - exports one JSON per company for the company pages.

Output: web/public/companies/<SYMBOL>.json
Contains the snapshot row plus trimmed financial statements (screener.in-style
key line items only, values in Rs CRORE). Companies whose statements haven't
been fetched yet get snapshot-only files - the page shows a notice.
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from trend_lib import build_trends

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT_DIR = ROOT / "web" / "public" / "companies"

# yfinance item name -> display label, per statement type (order = display order)
KEY_ITEMS = {
    "income": [
        ("Total Revenue", "Revenue"),
        ("Gross Profit", "Gross Profit"),
        ("Operating Income", "Operating Profit"),
        ("EBITDA", "EBITDA"),
        ("Interest Expense", "Interest"),
        ("Tax Provision", "Tax"),
        ("Net Income", "Net Profit"),
        ("Basic EPS", "EPS (Rs)"),
    ],
    "balance": [
        ("Total Assets", "Total Assets"),
        ("Stockholders Equity", "Equity"),
        ("Total Debt", "Total Debt"),
        ("Cash And Cash Equivalents", "Cash"),
        ("Inventory", "Inventory"),
        ("Accounts Receivable", "Receivables"),
    ],
    "cashflow": [
        ("Operating Cash Flow", "Cash from Operations"),
        ("Investing Cash Flow", "Cash from Investing"),
        ("Financing Cash Flow", "Cash from Financing"),
        ("Capital Expenditure", "Capex"),
        ("Free Cash Flow", "Free Cash Flow"),
    ],
}

NOT_CRORE = {"EPS (Rs)"}  # per-share numbers stay in rupees


def build_statement(df: pd.DataFrame, stmt_type: str, period_type: str) -> dict | None:
    sub = df[(df.stmt_type == stmt_type) & (df.period_type == period_type)]
    if sub.empty:
        return None
    periods = sorted(sub.period_end.unique())
    items = []
    for src, label in KEY_ITEMS[stmt_type]:
        rows = sub[sub["item"] == src].set_index("period_end")["value"]
        if rows.empty:
            continue
        values = []
        for p in periods:
            v = rows.get(p)
            if v is None or pd.isna(v):
                values.append(None)
            elif label in NOT_CRORE:
                values.append(round(float(v), 2))
            else:
                values.append(round(float(v) / 1e7, 1))  # Rs -> Rs crore
        items.append({"label": label, "values": values})
    if not items:
        return None
    return {"periods": periods, "items": items}


def main() -> None:
    con = sqlite3.connect(DB)
    snaps = pd.read_sql("SELECT * FROM fundamentals", con)
    has_statements = {
        r[0] for r in con.execute("SELECT DISTINCT symbol FROM statements").fetchall()
    }
    trends = build_trends(con)
    prices_by_symbol: dict[str, dict] = {}
    if con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='prices'").fetchone():
        pr = pd.read_sql("SELECT symbol, freq, date, close FROM prices ORDER BY date", con)
        for (sym_key, freq), grp in pr.groupby(["symbol", "freq"]):
            prices_by_symbol.setdefault(sym_key, {})[freq] = [
                [d, c] for d, c in zip(grp["date"], grp["close"])
            ]
    shp_by_symbol: dict[str, dict] = {}
    if con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='shareholding'").fetchone():
        shp = pd.read_sql("SELECT symbol, date, promoter, public, employee_trusts FROM shareholding ORDER BY date", con)
        for sym_key, grp in shp.groupby("symbol"):
            tail = grp.tail(12)
            shp_by_symbol[sym_key] = {
                "dates": tail["date"].tolist(),
                "promoter": [None if pd.isna(v) else float(v) for v in tail["promoter"]],
                "public": [None if pd.isna(v) else float(v) for v in tail["public"]],
                "employee": [None if pd.isna(v) else float(v) for v in tail["employee_trusts"]],
            }
    has_docs_table = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='documents'"
    ).fetchone()
    docs_by_symbol: dict[str, list[dict]] = {}
    if has_docs_table:
        for sym, from_yr, to_yr, url in con.execute(
            "SELECT symbol, from_yr, to_yr, url FROM documents WHERE doc_type='annual_report' ORDER BY from_yr DESC"
        ).fetchall():
            docs_by_symbol.setdefault(sym, []).append({"from": from_yr, "to": to_yr, "url": url})
    snaps["debt_to_equity"] = (snaps["debt_to_equity"] / 100).round(3)
    snaps["market_cap"] = (snaps["market_cap"] / 1e7).round(1)
    for col in ["roe", "roa", "net_margin", "op_margin", "gross_margin", "revenue_growth", "earnings_growth"]:
        snaps[col] = (snaps[col] * 100).round(2)
    # same field names the screener app uses (keep in sync with export_json.py)
    snaps = snaps.rename(columns={
        "market_cap": "mcap",
        "dividend_yield": "div_yield",
        "debt_to_equity": "de",
        "revenue_growth": "rev_growth",
        "earnings_growth": "earn_growth",
    })
    snaps = snaps.astype(object).where(pd.notna(snaps), None)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    n_with, n_without = 0, 0
    for _, snap in snaps.iterrows():
        sym = snap["symbol"]
        payload = {
            "generated_at": generated,
            "snapshot": snap.to_dict(),
            "statements": {},
            "documents": {"annual_reports": docs_by_symbol.get(sym, [])},
            "trend": trends.get(sym, {}),
            "shareholding": shp_by_symbol.get(sym),
            "prices": prices_by_symbol.get(sym),
        }
        if sym in has_statements:
            stmts = pd.read_sql("SELECT * FROM statements WHERE symbol = ?", con, params=(sym,))
            for key, stmt_type, period_type in [
                ("quarterly_results", "income", "quarterly"),
                ("annual_pnl", "income", "annual"),
                ("balance_sheet", "balance", "annual"),
                ("cash_flow", "cashflow", "annual"),
            ]:
                built = build_statement(stmts, stmt_type, period_type)
                if built:
                    payload["statements"][key] = built
        if payload["statements"]:
            n_with += 1
        else:
            n_without += 1
        (OUT_DIR / f"{sym}.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )
    con.close()
    print(f"company files: {n_with} with statements, {n_without} snapshot-only -> {OUT_DIR}")


if __name__ == "__main__":
    main()
