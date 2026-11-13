"""Rscreener - web/public/dma.json for the Research hub's "200 DMA" page.

Per NSE stock with at least three years measured (after the 40-week warm-up): the share of weeks
it closed below its 40-week average (the weekly 200-day), how many dips of
two weeks or more, the typical and longest dip, and where it stands now -
above or below the DAILY 200-day average, by how much, and for how long.

Descriptive: past behaviour, not a forecast. Generated, never committed.
Usage:  python pipeline/export_dma_json.py
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

import dma_lib
import price_adjust

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "dma.json"
MIN_WEEKS = 156


def main() -> None:
    con = sqlite3.connect(DB)
    names, mcap = {}, {}
    for sym, nm, ex in con.execute('SELECT SYMBOL, "NAME OF COMPANY", EXCHANGE FROM universe'):
        if (ex or "NSE") == "NSE":
            names[sym] = nm
    for sym, m in con.execute("SELECT symbol, market_cap FROM fundamentals"):
        mcap[sym] = m
    weekly = pd.read_sql("SELECT symbol, date, close FROM prices WHERE freq='weekly' "
                         "AND date >= date('now', '-6 years') ORDER BY symbol, date", con)
    daily = pd.read_sql("SELECT symbol, date, close FROM prices WHERE freq='daily' "
                        "AND date >= date('now', '-420 days') ORDER BY symbol, date", con)
    # Demergers the stored prices have not absorbed (Vedanta 30-Apr-2026):
    # closes before the ex-date scaled down, as the P/E chart does, or the
    # old larger prices sit inside the average and every later close reads
    # far "below" it.
    evs = price_adjust.events(con)
    con.close()
    for frame in (weekly, daily):
        if evs:
            frame["close"] = [c * price_adjust.factor_at(evs.get(s), d) if s in evs else c
                              for s, d, c in zip(frame["symbol"], frame["date"], frame["close"])]
    dly = {s: g["close"].tolist() for s, g in daily.groupby("symbol")}
    dly_date = {s: g["date"].iloc[-1] for s, g in daily.groupby("symbol")}
    rows = []
    for sym, g in weekly.groupby("symbol"):
        if sym not in names:
            continue
        closes = [float(c) for c in g["close"] if c and c > 0]
        st = dma_lib.spell_stats(closes)
        # Three years measured at least: a two-year-old listing that has only
        # ever risen tops a "least time below" list on luck of its timing.
        if not st or st["weeks"] < MIN_WEEKS:
            continue
        d = dly.get(sym, [])
        avg200 = sum(d[-200:]) / 200 if len(d) >= 200 else None
        dist = dma_lib.distance(d[-1] if d else None, avg200)
        rows.append([sym, names[sym], round((mcap.get(sym) or 0) / 1e7), st["pct_below"], st["dips"],
                     st["median_dip"], st["longest_dip"], dist,
                     # signed: weeks above the weekly line (+) or below it (-)
                     -st["run"] if st["now_below"] else st["run"], st["weeks"]])
    pct = [r[3] for r in rows]
    doc = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "asof": max(dly_date.values()) if dly_date else None,
        "cols": ["s", "name", "mcap_cr", "pct_below", "dips", "median_dip_w", "longest_dip_w", "dist_200d", "run_w", "weeks"],
        "median_pct_below": round(sorted(pct)[len(pct) // 2], 1) if pct else None,
        "rows": rows,
    }
    OUT.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    print(f"dma.json: {len(rows)} stocks; median share of weeks below the line {doc['median_pct_below']}%")


if __name__ == "__main__":
    main()
