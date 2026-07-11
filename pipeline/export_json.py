"""Rscreener P2 - exports the fundamentals snapshot to web/public/data.json.

Unit conventions in the exported file (what the query language sees):
  mcap            market cap in Rs CRORE (like screener.in)
  pe, pb, de      plain ratios
  roe, roa, net_margin, op_margin, rev_growth, earn_growth   PERCENT
  div_yield       PERCENT (yfinance already returns percent)
  price, book_value, wk52_high, wk52_low                      Rs
Missing values are exported as null - the app must treat null as
"excluded from this screen", never as zero.
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from trend_lib import build_trends, cagr_pct

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "data.json"

FRACTION_TO_PCT = ["roe", "roa", "net_margin", "op_margin", "gross_margin", "revenue_growth", "earnings_growth"]

RENAME = {
    "market_cap": "mcap",
    "dividend_yield": "div_yield",
    "debt_to_equity": "de",
    "revenue_growth": "rev_growth",
    "earnings_growth": "earn_growth",
}


def main() -> None:
    con = sqlite3.connect(DB)
    df = pd.read_sql("SELECT * FROM fundamentals", con)
    n_universe = pd.read_sql("SELECT COUNT(*) n FROM universe", con)["n"][0]
    trends = build_trends(con)
    con.close()

    def growth(sym: str, item: str, years: int):
        t = trends.get(sym, {}).get("annual")
        if not t:
            return None
        return cagr_pct(t[item], t["periods"], years)

    df["sales_cagr_5y"] = df["symbol"].map(lambda s: growth(s, "revenue", 5))
    df["sales_cagr_10y"] = df["symbol"].map(lambda s: growth(s, "revenue", 10))
    df["profit_cagr_5y"] = df["symbol"].map(lambda s: growth(s, "pat", 5))
    df["profit_cagr_10y"] = df["symbol"].map(lambda s: growth(s, "pat", 10))

    for col in FRACTION_TO_PCT:
        df[col] = (df[col] * 100).round(2)
    df["market_cap"] = (df["market_cap"] / 1e7).round(1)  # Rs -> Rs crore
    df["debt_to_equity"] = (df["debt_to_equity"] / 100).round(3)  # Yahoo's 36.65 -> 0.37 ratio, screener.in style
    df = df.rename(columns=RENAME)

    keep = [
        "symbol", "name", "sector", "industry", "price", "mcap", "pe", "forward_pe",
        "pb", "book_value", "roe", "roa", "de", "div_yield", "net_margin", "op_margin",
        "gross_margin", "rev_growth", "earn_growth", "revenue", "net_income",
        "total_debt", "total_cash", "free_cashflow", "wk52_high", "wk52_low", "beta",
        "sales_cagr_5y", "sales_cagr_10y", "profit_cagr_5y", "profit_cagr_10y",
    ]
    df = df[keep]
    df = df.astype(object).where(pd.notna(df), None)

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "universe_size": int(n_universe),
        "covered": len(df),
        "rows": df.to_dict(orient="records"),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    kb = OUT.stat().st_size / 1024
    print(f"exported {len(df)}/{n_universe} symbols -> {OUT} ({kb:.0f} KB)")
    sample = df[df.symbol == "RELIANCE"]
    if not sample.empty:
        print(sample[["symbol", "price", "mcap", "pe", "roe", "de", "div_yield"]].to_string(index=False))


if __name__ == "__main__":
    main()
