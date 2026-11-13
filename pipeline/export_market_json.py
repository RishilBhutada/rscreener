"""Rscreener - market-wide activity: web/public/market.json.

  fii_dii      [[date, FII net Rs Cr, DII net Rs Cr]]  cash market, newest last
               (NSE serves one day at a time; the series grows nightly)
  futures      [[date, FII long %, Client long %, Pro long %, DII long %]]
               share of index-futures contracts each group holds LONG
  breadth      [[date, % above 200-day avg, % above 50-day avg, stocks counted]]
               NSE stocks with 200 sessions of history, from our own daily closes

Descriptive, not a forecast: these say what happened, not what will.
Usage:  python pipeline/export_market_json.py
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "market.json"
DAYS = 250


def breadth(con) -> list:
    nse = {r[0] for r in con.execute("SELECT SYMBOL FROM universe WHERE EXCHANGE='NSE' OR EXCHANGE IS NULL")}
    px = pd.read_sql("SELECT symbol, date, close FROM prices WHERE freq='daily' AND date >= date('now', '-800 days')", con)
    px = px[px.symbol.isin(nse)]
    if px.empty:
        return []
    wide = px.pivot_table(index="date", columns="symbol", values="close").sort_index()
    ma200 = wide.rolling(200, min_periods=200).mean()
    ma50 = wide.rolling(50, min_periods=50).mean()
    out = []
    for d in wide.index[-DAYS:]:
        c, a, b = wide.loc[d], ma200.loc[d], ma50.loc[d]
        ok = c.notna() & a.notna() & b.notna()
        n = int(ok.sum())
        if n < 200:
            continue
        out.append([d, round(float((c[ok] > a[ok]).mean() * 100), 1), round(float((c[ok] > b[ok]).mean() * 100), 1), n])
    return out


def main() -> None:
    con = sqlite3.connect(DB)
    have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    doc = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "fii_dii": [], "futures": [], "breadth": []}
    if "fii_dii" in have:
        by: dict[str, dict] = {}
        for d, who, net in con.execute("SELECT date, who, net FROM fii_dii ORDER BY date"):
            by.setdefault(d, {})[who] = net
        doc["fii_dii"] = [[d, v.get("FII"), v.get("DII")] for d, v in sorted(by.items())][-DAYS:]
    if "participant_oi" in have:
        by = {}
        for d, who, lo, sh in con.execute("SELECT date, client, idx_fut_long, idx_fut_short FROM participant_oi ORDER BY date"):
            by.setdefault(d, {})[who] = round(lo / (lo + sh) * 100, 1) if lo is not None and sh and (lo + sh) else None
        doc["futures"] = [[d, v.get("FII"), v.get("Client"), v.get("Pro"), v.get("DII")] for d, v in sorted(by.items())][-DAYS:]
    doc["breadth"] = breadth(con)
    con.close()
    OUT.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    last = doc["breadth"][-1] if doc["breadth"] else None
    print(f"market.json: {len(doc['fii_dii'])} FII/DII day(s), {len(doc['futures'])} futures day(s), "
          f"{len(doc['breadth'])} breadth day(s); latest breadth {last}")


if __name__ == "__main__":
    main()
