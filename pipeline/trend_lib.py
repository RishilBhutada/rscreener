"""Builds stitched long-term P&L trends per symbol.

Two sources, one series:
  - results_history (NSE XBRL, as-filed, reaches ~2019 and earlier) wins wherever it exists
  - statements (yfinance) fills periods the XBRL index doesn't cover (mainly the newest 1-2 years,
    which NSE moved to its integrated-filing system)
Values are converted to Rs crore here (eps stays in rupees).
"""
import sqlite3

import pandas as pd

YF_MAP = {"Total Revenue": "revenue", "Net Income": "pat", "Basic EPS": "eps", "Total Expenses": "expenses"}
ITEMS = ["revenue", "pat", "eps", "expenses"]
KEEP_ANNUAL = 15
KEEP_QUARTERLY = 32


def _table_exists(con: sqlite3.Connection, name: str) -> bool:
    return bool(con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def _to_cr(item: str, value: float) -> float:
    return round(value / 1e7, 1) if item in ("revenue", "pat", "expenses") else round(value, 2)


def build_trends(con: sqlite3.Connection) -> dict[str, dict]:
    frames = []
    if _table_exists(con, "results_history"):
        xb = pd.read_sql(
            "SELECT symbol, period_type, period_end, item, value FROM results_history WHERE item IN ('revenue','pat','eps','total_expenses')",
            con,
        )
        xb["item"] = xb["item"].replace({"total_expenses": "expenses"})
        xb["source"] = "nse"
        frames.append(xb)
    if _table_exists(con, "statements"):
        yf = pd.read_sql(
            "SELECT symbol, period_type, period_end, item, value FROM statements "
            "WHERE stmt_type='income' AND item IN ('Total Revenue','Net Income','Basic EPS','Total Expenses')",
            con,
        )
        yf["item"] = yf["item"].map(YF_MAP)
        yf["source"] = "yf"
        frames.append(yf)
    if not frames:
        return {}
    df = pd.concat(frames, ignore_index=True)

    out: dict[str, dict] = {}
    for (symbol, ptype), grp in df.groupby(["symbol", "period_type"]):
        periods: dict[str, dict] = {}
        for src in ("yf", "nse"):  # nse second -> overwrites yf (as-filed wins)
            for _, r in grp[grp.source == src].iterrows():
                # r["item"] not r.item - .item is a pandas Series method
                slot = periods.setdefault(r["period_end"], {"source": src})
                slot[r["item"]] = _to_cr(r["item"], r["value"])
                slot["source"] = src if src == "nse" else slot["source"]
        keep = KEEP_ANNUAL if ptype == "annual" else KEEP_QUARTERLY
        ordered = sorted(periods)[-keep:]
        trend = {
            "periods": ordered,
            "revenue": [periods[p].get("revenue") for p in ordered],
            "pat": [periods[p].get("pat") for p in ordered],
            "eps": [periods[p].get("eps") for p in ordered],
            "expenses": [periods[p].get("expenses") for p in ordered],
            "source": [periods[p]["source"] for p in ordered],
        }
        if any(v is not None for v in trend["revenue"]):
            out.setdefault(symbol, {})[ptype] = trend
    return out


def pe_series(con: sqlite3.Connection) -> dict[str, dict]:
    """Monthly P/E series per symbol: monthly close / trailing-twelve-month EPS
    (sum of the four most recent quarterly as-filed EPS at each price date).
    Returns {symbol: {"series": [[date, pe], ...], "median_5y": float}}."""
    if not (_table_exists(con, "prices") and _table_exists(con, "results_history")):
        return {}
    eps = pd.read_sql(
        "SELECT symbol, period_end, value FROM results_history "
        "WHERE period_type='quarterly' AND item='eps' ORDER BY period_end",
        con,
    )
    px = pd.read_sql(
        "SELECT symbol, date, close FROM prices WHERE freq='monthly' ORDER BY date", con
    )
    eps_by_sym = {s: list(zip(g["period_end"], g["value"])) for s, g in eps.groupby("symbol")}
    out: dict[str, dict] = {}
    for sym, g in px.groupby("symbol"):
        quarters = eps_by_sym.get(sym)
        if not quarters or len(quarters) < 4:
            continue
        series = []
        qi = 0
        for date, close in zip(g["date"], g["close"]):
            while qi < len(quarters) and quarters[qi][0] <= date:
                qi += 1
            recent = quarters[max(0, qi - 4):qi]
            if len(recent) < 4:
                continue
            ttm = sum(v for _, v in recent)
            if ttm <= 0:
                continue
            series.append([date, round(close / ttm, 1)])
        if len(series) < 12:
            continue
        last5y = [pe for _, pe in series[-60:]]
        med = sorted(last5y)[len(last5y) // 2]
        out[sym] = {"series": series, "median_5y": round(med, 1)}
    return out


def avg_npm_5y(trend_annual: dict | None) -> float | None:
    """Average PAT margin (%) over the last 5 annual periods with both values."""
    if not trend_annual:
        return None
    pairs = [
        (r, p)
        for r, p in zip(trend_annual["revenue"], trend_annual["pat"])
        if r and p is not None
    ][-5:]
    if len(pairs) < 3:
        return None
    margins = [p / r * 100 for r, p in pairs]
    return round(sum(margins) / len(margins), 2)


def cagr_pct(values: list, periods: list[str], years: int) -> float | None:
    """CAGR over `years` intervals of the annual series; None when not computable."""
    pairs = [(p, v) for p, v in zip(periods, values) if v is not None]
    if len(pairs) < years + 1:
        return None
    last, start = pairs[-1][1], pairs[-(years + 1)][1]
    if not start or not last or start <= 0 or last <= 0:
        return None
    return round(((last / start) ** (1 / years) - 1) * 100, 2)
