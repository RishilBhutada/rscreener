"""Rscreener - quarterly shareholding pattern (promoter / public / employee trusts).

One NSE call per symbol returns the full quarterly history. FII/DII split lives
inside per-quarter XBRL files - future work; the promoter trend is the headline.

Usage:
  python fetch_shareholding.py --symbols @data/top500.txt [--max-age-hours 156]
"""
import argparse
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
API = "https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&symbol={sym}"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def to_float(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", required=True)
    ap.add_argument("--sleep", type=float, default=0.4)
    ap.add_argument("--max-age-hours", type=float, default=0)
    args = ap.parse_args()
    raw = (ROOT / args.symbols[1:]).read_text(encoding="utf-8") if args.symbols.startswith("@") else args.symbols
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]

    # generous busy-timeout: the results-history backfill may hold the write
    # lock; both writers commit often, so waiting our turn always succeeds
    con = sqlite3.connect(DB, timeout=180)
    con.execute(
        "CREATE TABLE IF NOT EXISTS shareholding (symbol TEXT, date TEXT, promoter REAL, public REAL, employee_trusts REAL)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS shp_fetch_log (symbol TEXT PRIMARY KEY, fetched_at TEXT, error TEXT)"
    )
    if args.max_age_hours > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=args.max_age_hours)).strftime("%Y-%m-%d %H:%M:%S")
        done = {r[0] for r in con.execute("SELECT symbol FROM shp_fetch_log WHERE error IS NULL AND fetched_at >= ?", (cutoff,)).fetchall()}
    else:
        done = {r[0] for r in con.execute("SELECT symbol FROM shp_fetch_log WHERE error IS NULL").fetchall()}
    symbols = [s for s in symbols if s not in done]
    print(f"fetching shareholding for {len(symbols)} symbols...")

    s = requests.Session()
    s.headers.update(HEADERS)
    try:
        s.get("https://www.nseindia.com", timeout=20)
    except Exception:
        pass

    ok = err = 0
    for i, sym in enumerate(symbols, 1):
        try:
            r = s.get(API.format(sym=sym), timeout=25)
            r.raise_for_status()
            rows = r.json()
            recs = []
            for row in rows:
                d = row.get("date")
                if not d:
                    continue
                try:
                    iso = datetime.strptime(d, "%d-%b-%Y").strftime("%Y-%m-%d")
                except ValueError:
                    continue
                recs.append((sym, iso, to_float(row.get("pr_and_prgrp")), to_float(row.get("public_val")), to_float(row.get("employeeTrusts"))))
            # keep the latest filing per quarter-date (rows can contain revisions)
            dedup: dict[str, tuple] = {}
            for rec in recs:
                dedup.setdefault(rec[1], rec)
            con.execute("DELETE FROM shareholding WHERE symbol=?", (sym,))
            con.executemany("INSERT INTO shareholding VALUES (?,?,?,?,?)", list(dedup.values()))
            con.execute("INSERT OR REPLACE INTO shp_fetch_log VALUES (?,?,?)", (sym, now_utc(), None))
            con.commit()
            ok += 1
            print(f"[{i}/{len(symbols)}] {sym}: {len(dedup)} quarters")
        except Exception as e:  # noqa: BLE001
            err += 1
            con.execute("INSERT OR REPLACE INTO shp_fetch_log VALUES (?,?,?)", (sym, now_utc(), str(e)[:200]))
            con.commit()
            print(f"[{i}/{len(symbols)}] {sym}: ERROR {e}")
        time.sleep(args.sleep)
    print(f"done: {ok} ok, {err} errors")


if __name__ == "__main__":
    main()
