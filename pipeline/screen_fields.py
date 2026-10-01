"""Screener fields worked out from data the DB already holds.

Four families, each a dict {symbol: {field: value}} that export_json maps
onto the company table:

  technicals        price against its 50- and 200-day averages, the two
                    averages against each other, 14-day RSI, and the last
                    session's volume against the 20 before it
  quarter_growth    the latest quarter's sales and profit against the same
                    quarter a year earlier and against the quarter before
  promoter_changes  the promoters' stake now against a quarter and a year ago
  piotroski         the nine-point F-score from the two latest annual reports

Every figure is arithmetic on stored data and is as good as that data; the
screener's "i" says so. A field that cannot be worked out honestly is left
out rather than guessed: a stale price series gets no technicals, growth
from a loss is not a percentage, and a company missing any F-score input
gets no score.
"""
from __future__ import annotations

import sqlite3
from datetime import date, timedelta

import numpy as np
import pandas as pd


def _r(v: float | None, nd: int = 1) -> float | None:
    if v is None or not np.isfinite(v):
        return None
    return round(float(v), nd)


def technicals(con: sqlite3.Connection) -> dict[str, dict]:
    """Moving averages, RSI and volume surge from the daily closes.

    Reads `prices`, which export_json has already pointed at the demerger-
    adjusted view, so a demerger is not mistaken for a crash below the average.
    A series whose last bar is more than a week older than the newest close
    anywhere is skipped: its averages describe a market that has moved on.
    """
    newest = con.execute("SELECT MAX(date) FROM prices WHERE freq='daily'").fetchone()[0]
    if not newest:
        return {}
    last_day = date.fromisoformat(str(newest)[:10])
    since = (last_day - timedelta(days=420)).isoformat()
    stale = (last_day - timedelta(days=7)).isoformat()
    px = pd.read_sql(
        "SELECT symbol, date, close, volume FROM prices "
        "WHERE freq='daily' AND date >= ? AND close IS NOT NULL AND close > 0 ORDER BY symbol, date",
        con, params=(since,))
    out: dict[str, dict] = {}
    for sym, g in px.groupby("symbol", sort=False):
        if str(g["date"].iloc[-1])[:10] < stale:
            continue
        c = g["close"].to_numpy(dtype=float)
        v = pd.to_numeric(g["volume"], errors="coerce").to_numpy(dtype=float)
        last = c[-1]
        res: dict[str, float | None] = {}
        if len(c) >= 50:
            sma50 = c[-50:].mean()
            res["vs_dma50"] = _r((last / sma50 - 1) * 100)
            if len(c) >= 200:
                sma200 = c[-200:].mean()
                res["vs_dma200"] = _r((last / sma200 - 1) * 100)
                res["dma50_200"] = _r((sma50 / sma200 - 1) * 100)
        if len(c) >= 30:
            # Wilder's RSI(14), smoothed over up to 140 sessions so the seed
            # average has washed out.
            d = np.diff(c[-141:])
            gain, loss = np.clip(d, 0, None), np.clip(-d, 0, None)
            ag, al = gain[:14].mean(), loss[:14].mean()
            for i in range(14, len(d)):
                ag = (ag * 13 + gain[i]) / 14
                al = (al * 13 + loss[i]) / 14
            res["rsi14"] = _r(100.0 if al == 0 else 100 - 100 / (1 + ag / al))
        if len(v) >= 21 and np.isfinite(v[-1]) and v[-1] > 0:
            base = v[-21:-1]
            base = base[np.isfinite(base) & (base > 0)]
            if len(base) >= 10:
                res["vol_surge"] = _r(v[-1] / base.mean(), 2)
        res = {k: x for k, x in res.items() if x is not None}
        if res:
            out[str(sym)] = res
    return out


def _growth(now: float | None, then: float | None) -> float | None:
    """Percentage change, only from a positive base: growth "from" a loss is
    not a number anyone can read."""
    if now is None or then is None or then <= 0:
        return None
    return _r((now / then - 1) * 100)


def quarter_growth(trends: dict[str, dict]) -> dict[str, dict]:
    """Latest quarter against the same quarter last year (YoY) and the one
    before (QoQ), from the as-filed quarterly series build_trends made."""
    out: dict[str, dict] = {}
    for sym, t in trends.items():
        q = t.get("quarterly")
        if not q or not q.get("periods"):
            continue
        per, rev, pat = q["periods"], q["revenue"], q["pat"]
        i = len(per) - 1
        while i >= 0 and rev[i] is None:
            i -= 1
        if i < 0:
            continue
        p = per[i]
        res: dict[str, float | None] = {}
        year_ago = f"{int(p[:4]) - 1}{p[4:]}"
        if year_ago in per:
            j = per.index(year_ago)
            res["qtr_sales_yoy"] = _growth(rev[i], rev[j])
            res["qtr_profit_yoy"] = _growth(pat[i], pat[j])
        if i > 0 and (date.fromisoformat(p) - date.fromisoformat(per[i - 1])).days <= 100:
            res["qtr_sales_qoq"] = _growth(rev[i], rev[i - 1])
            res["qtr_profit_qoq"] = _growth(pat[i], pat[i - 1])
        res = {k: x for k, x in res.items() if x is not None}
        if res:
            out[sym] = res
    return out


def promoter_changes(con: sqlite3.Connection) -> dict[str, dict]:
    """Change in the promoters' stake, in percentage points: since the
    previous filing, and since the filing nearest a year before the latest."""
    rows = con.execute(
        "SELECT symbol, date, promoter FROM shareholding WHERE promoter IS NOT NULL ORDER BY symbol, date").fetchall()
    by: dict[str, list[tuple[str, float]]] = {}
    for s, d, p in rows:
        by.setdefault(s, []).append((str(d)[:10], float(p)))
    out: dict[str, dict] = {}
    for s, seq in by.items():
        if len(seq) < 2:
            continue
        d_last, p_last = seq[-1]
        res: dict[str, float] = {"promoter_chg_qtr": round(p_last - seq[-2][1], 2)}
        want = date.fromisoformat(d_last) - timedelta(days=365)
        best = min(seq[:-1], key=lambda x: abs((date.fromisoformat(x[0]) - want).days))
        if abs((date.fromisoformat(best[0]) - want).days) <= 45:
            res["promoter_chg_1y"] = round(p_last - best[1], 2)
        out[s] = res
    return out


_F_ITEMS = {
    "ni": ("Net Income", "Net Income Common Stockholders"),
    "rev": ("Total Revenue",),
    "gp": ("Gross Profit",),
    "ta": ("Total Assets",),
    "ltd": ("Long Term Debt",),
    "ca": ("Current Assets",),
    "cl": ("Current Liabilities",),
    "sh": ("Ordinary Shares Number", "Share Issued"),
    "cfo": ("Operating Cash Flow",),
}


def piotroski(con: sqlite3.Connection) -> dict[str, dict]:
    """Piotroski's F-score, 0-9, from the two latest annual statements.

    One point each: profit (return on assets > 0), operating cash flow > 0,
    return on assets up, cash flow above profit, long-term debt to assets
    not up, current ratio up, no new shares, gross margin up, asset turnover
    up. Assets are year-end, not averaged. Debt missing from a year is read
    as none. Any other input missing in either year and there is no score -
    banks, which report no current assets, fall out here, as they should.
    """
    names = sorted({n for v in _F_ITEMS.values() for n in v})
    q = ",".join("?" * len(names))
    rows = con.execute(
        f"SELECT symbol, period_end, item, value FROM statements "
        f"WHERE period_type='annual' AND item IN ({q}) AND value IS NOT NULL", names).fetchall()
    by: dict[str, dict[str, dict[str, float]]] = {}
    for s, pe, item, v in rows:
        by.setdefault(s, {}).setdefault(str(pe)[:10], {})[item] = float(v)
    cutoff = (date.today() - timedelta(days=730)).isoformat()
    out: dict[str, dict] = {}
    for s, years in by.items():
        def get(y: dict, key: str) -> float | None:
            for n in _F_ITEMS[key]:
                if n in y:
                    return y[n]
            return None
        full = [pe for pe in sorted(years) if get(years[pe], "ta") and get(years[pe], "ni") is not None]
        if len(full) < 2 or full[-1] < cutoff:
            continue
        cur, prev = years[full[-1]], years[full[-2]]
        v = {k: (get(cur, k), get(prev, k)) for k in _F_ITEMS}
        need = ["ni", "rev", "gp", "ta", "ca", "cl", "sh"]
        if any(a is None or b is None for k in need for a, b in [v[k]]) or v["cfo"][0] is None:
            continue
        (ni, ni0), (rev, rev0), (gp, gp0), (ta, ta0) = v["ni"], v["rev"], v["gp"], v["ta"]
        (ca, ca0), (cl, cl0), (sh, sh0) = v["ca"], v["cl"], v["sh"]
        ltd, ltd0 = (v["ltd"][0] or 0.0), (v["ltd"][1] or 0.0)
        cfo = v["cfo"][0]
        if not (ta and ta0 and rev and rev0 and cl and cl0):
            continue
        score = sum([
            ni / ta > 0,
            cfo > 0,
            ni / ta > ni0 / ta0,
            cfo > ni,
            ltd / ta <= ltd0 / ta0,
            ca / cl > ca0 / cl0,
            sh <= sh0 * 1.001,
            gp / rev > gp0 / rev0,
            rev / ta > rev0 / ta0,
        ])
        out[s] = {"f_score": int(score)}
    return out
