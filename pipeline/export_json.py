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
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from ratios_lib import compute_ratios, latest_annual_items, latest_promoter
from trend_lib import avg_npm_5y, build_trends, cagr_pct, ratio_bands


def clean_nan(o):
    """Recursively replace NaN/Inf floats with None so the JSON is browser-parseable."""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: clean_nan(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean_nan(v) for v in o]
    return o

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

RETURN_ANCHORS = {"ret_1m": 1, "ret_3m": 3, "ret_6m": 6, "ret_1y": 12, "ret_3y": 36, "ret_5y": 60}


def _yang_zhang(o, h, l, c, n: int, ann: float):
    """Yang-Zhang (2000) annualised volatility (%) over the last n days.

    YZ = overnight variance + k*open-to-close variance + (1-k)*Rogers-Satchell.
    Uses the full O/H/L/C bar so it is far less noisy than close-to-close and,
    unlike Parkinson/Garman-Klass, captures overnight gaps AND price drift.
    Returns None if OHLC is missing/degenerate (caller falls back to close-close)."""
    import numpy as np

    if len(c) < n + 1:
        n = len(c) - 1
    if n < 5:
        return None
    s = len(c) - n
    O, H, L, C = o[s:], h[s:], l[s:], c[s:]
    Cprev = c[s - 1:len(c) - 1]
    mask = ~(np.isnan(O) | np.isnan(H) | np.isnan(L) | np.isnan(C) | np.isnan(Cprev))
    O, H, L, C, Cprev = O[mask], H[mask], L[mask], C[mask], Cprev[mask]
    m = len(C)
    if m < 5 or np.any(O <= 0) or np.any(H <= 0) or np.any(L <= 0) or np.any(C <= 0) or np.any(Cprev <= 0):
        return None
    ov = np.log(O / Cprev)          # overnight (close -> next open)
    oc = np.log(C / O)              # open -> close
    rs = np.log(H / C) * np.log(H / O) + np.log(L / C) * np.log(L / O)  # Rogers-Satchell
    k = 0.34 / (1.34 + (m + 1) / (m - 1))
    yz2 = float(np.var(ov, ddof=1) + k * np.var(oc, ddof=1) + (1 - k) * np.mean(rs))
    if yz2 <= 0:
        return None
    return round(yz2 ** 0.5 * ann * 100, 1)


def volatility_fields(con: sqlite3.Connection) -> dict[str, dict]:
    """Annualised historical volatility (%). Primary estimator is Yang-Zhang on
    the daily OHLC bar; symbols whose OHLC hasn't been captured yet fall back to
    close-to-close so every stock keeps a number. `vol_method` records which."""
    import numpy as np

    if not con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='prices'").fetchone():
        return {}
    cols = [c[1] for c in con.execute("PRAGMA table_info(prices)").fetchall()]
    has_cols = {"open", "high", "low"} <= set(cols)
    sel = "symbol, date, open, high, low, close" if has_cols else "symbol, date, close"
    px = pd.read_sql(f"SELECT {sel} FROM prices WHERE freq='daily' ORDER BY date", con)
    out: dict[str, dict] = {}
    ann = 252 ** 0.5
    for sym, g in px.groupby("symbol"):
        C = g["close"].to_numpy(dtype=float)
        if len(C) < 40:
            continue
        O = g["open"].to_numpy(dtype=float) if has_cols else np.full(len(C), np.nan)
        H = g["high"].to_numpy(dtype=float) if has_cols else np.full(len(C), np.nan)
        L = g["low"].to_numpy(dtype=float) if has_cols else np.full(len(C), np.nan)
        has_ohlc = has_cols and not (np.isnan(O).all() or np.isnan(H).all() or np.isnan(L).all())

        Cpos = C[C > 0]
        rets = np.diff(np.log(Cpos))

        def close_close(n: int):
            if len(rets) < min(n, 20):
                return None
            return round(float(np.std(rets[-n:], ddof=1)) * ann * 100, 1)

        d: dict = {}
        for key, n in (("volatility_1y", 250), ("volatility_30d", 30)):
            v = _yang_zhang(O, H, L, C, n, ann) if has_ohlc else None
            if v is None:
                v = close_close(n)
            if v is not None:
                d[key] = v
        if d:
            d["vol_method"] = "yang-zhang" if has_ohlc else "close-close"
            out[sym] = d
    return out


def price_returns(con: sqlite3.Connection) -> dict[str, dict]:
    """Trailing returns (%) per symbol from monthly closes (latest point ~= live)."""
    if not con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='prices'").fetchone():
        return {}
    px = pd.read_sql("SELECT symbol, date, close FROM prices WHERE freq='monthly' ORDER BY date", con)
    out: dict[str, dict] = {}
    for sym, g in px.groupby("symbol"):
        closes = list(g["close"])
        d = {}
        for key, n in RETURN_ANCHORS.items():
            if len(closes) > n and closes[-1 - n]:
                d[key] = round((closes[-1] / closes[-1 - n] - 1) * 100, 1)
        if d:
            out[sym] = d
    return out


def main() -> None:
    con = sqlite3.connect(DB, timeout=180)
    df = pd.read_sql("SELECT * FROM fundamentals", con)
    n_universe = pd.read_sql("SELECT COUNT(*) n FROM universe", con)["n"][0]
    shares_by_symbol = {
        r["symbol"]: r["market_cap"] / r["price"]
        for r in df.to_dict(orient="records")
        if r.get("market_cap") and r.get("price")
    }
    trends = build_trends(con, shares_by_symbol)
    items_by_symbol = latest_annual_items(con)
    promoter_by_symbol = latest_promoter(con)
    pe_by_symbol = {s: b["pe"] for s, b in ratio_bands(con, shares_by_symbol).items() if "pe" in b}
    returns_by_symbol = price_returns(con)
    vol_by_symbol = volatility_fields(con)
    con.close()

    # computed ratios need RAW rupee values - run before any unit conversion
    computed = [
        compute_ratios(row, items_by_symbol.get(row["symbol"], {}))
        for row in df.to_dict(orient="records")
    ]
    comp_df = pd.DataFrame(computed)
    for col in comp_df.columns:
        df[col] = comp_df[col].values
    df["promoter_holding"] = df["symbol"].map(promoter_by_symbol)
    df["median_pe_5y"] = df["symbol"].map(lambda s: pe_by_symbol.get(s, {}).get("median_5y"))
    for vk in ("volatility_1y", "volatility_30d", "vol_method"):
        df[vk] = df["symbol"].map(lambda s, k=vk: vol_by_symbol.get(s, {}).get(k))
    for rk in RETURN_ANCHORS:
        df[rk] = df["symbol"].map(lambda s, k=rk: returns_by_symbol.get(s, {}).get(k))
    df["off_52w_high"] = df.apply(lambda r: round((r["price"] / r["wk52_high"] - 1) * 100, 1) if r["price"] and r["wk52_high"] else None, axis=1)
    df["avg_npm_5y"] = df["symbol"].map(lambda s: avg_npm_5y(trends.get(s, {}).get("annual")))
    for key in ("ret_1m", "ret_3m", "ret_6m", "ret_1y", "ret_3y", "ret_5y"):
        df[key] = df["symbol"].map(lambda s, k=key: returns_by_symbol.get(s, {}).get(k))
    df["off_52w_high"] = [
        round((p / h - 1) * 100, 1) if p and h else None
        for p, h in zip(df["price"], df["wk52_high"])
    ]

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
        "roce", "ev_ebitda", "ps", "peg", "int_coverage", "div_payout",
        "debtor_days", "inventory_days", "promoter_holding",
        "median_pe_5y", "avg_npm_5y",
        "ret_1m", "ret_3m", "ret_6m", "ret_1y", "ret_3y", "ret_5y", "off_52w_high",
        "volatility_1y", "volatility_30d", "vol_method",
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
    OUT.write_text(json.dumps(clean_nan(payload), ensure_ascii=False, allow_nan=False), encoding="utf-8")
    kb = OUT.stat().st_size / 1024
    print(f"exported {len(df)}/{n_universe} symbols -> {OUT} ({kb:.0f} KB)")
    sample = df[df.symbol == "RELIANCE"]
    if not sample.empty:
        print(sample[["symbol", "price", "mcap", "pe", "roe", "de", "div_yield"]].to_string(index=False))


if __name__ == "__main__":
    main()
