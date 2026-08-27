"""Rscreener P5 - fetches direct annual-report PDF links from NSE's API.

Writes a `documents` table: symbol, doc_type, from_yr, to_yr, url.
Usage:
  python fetch_documents.py --symbols TCS,RELIANCE
  python fetch_documents.py --symbols @data/top500.txt
"""
import argparse
import sqlite3
from datetime import datetime, timedelta, timezone
import time
from pathlib import Path

import requests

import budget
import nse_session

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
API = "https://www.nseindia.com/api/annual-reports?index=equities&symbol={sym}"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", required=True, help="comma list, or @path/to/file with comma list")
    ap.add_argument("--sleep", type=float, default=0.5)
    # This script had no log, no cap and no schedule, so it was never put on the
    # nightly at all: 19,087 annual-report links were fetched once for 1,824
    # companies and never touched again. A company listed since gets no reports,
    # and a company that has filed a new annual report keeps showing its old
    # ones. 36% coverage, frozen. Its own log, like every other rotation - one
    # shared with a nightly full sweep is a rotation that never runs.
    ap.add_argument("--max-age-hours", type=float, default=0)
    ap.add_argument("--limit", type=int, default=0,
                    help="fetch at most this many symbols this run (0 = no cap)")
    args = ap.parse_args()
    if args.symbols.startswith("@"):
        raw = (ROOT / args.symbols[1:]).read_text(encoding="utf-8")
    else:
        raw = args.symbols
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]

    s = nse_session.new_session()

    con = sqlite3.connect(DB, timeout=180)
    con.execute(
        "CREATE TABLE IF NOT EXISTS documents (symbol TEXT, doc_type TEXT, from_yr TEXT, to_yr TEXT, url TEXT)"
    )
    con.execute("CREATE TABLE IF NOT EXISTS docs_fetch_log "
                "(symbol TEXT PRIMARY KEY, fetched_at TEXT, error TEXT)")
    log = {r[0]: r[1] for r in con.execute(
        "SELECT symbol, fetched_at FROM docs_fetch_log WHERE error IS NULL")}
    if args.max_age_hours > 0:
        cut = (datetime.now(timezone.utc)
               - timedelta(hours=args.max_age_hours)).strftime("%Y-%m-%d %H:%M:%S")
        symbols = [x for x in symbols if log.get(x, "") < cut]
    if args.limit and len(symbols) > args.limit:
        symbols.sort(key=lambda x: log.get(x) or "")     # oldest and never-fetched first
        print(f"  --limit {args.limit}: {len(symbols) - args.limit} deferred to a later run")
        symbols = symbols[:args.limit]
    print(f"annual reports for {len(symbols)} symbols...")
    ok = err = 0
    for i, sym in enumerate(symbols, 1):
        if budget.stop(i - 1, len(symbols)):
            break
        try:
            r = nse_session.get(s, API.format(sym=sym))
            body = r.json()
            data = body.get("data", body if isinstance(body, list) else [])
            rows = [
                (sym, "annual_report", it.get("fromYr"), it.get("toYr"), it.get("fileName"))
                for it in data
                if it.get("fileName")
            ]
            con.execute("DELETE FROM documents WHERE symbol=? AND doc_type='annual_report'", (sym,))
            con.executemany("INSERT INTO documents VALUES (?,?,?,?,?)", rows)
            con.commit()
            ok += 1
            con.execute("INSERT OR REPLACE INTO docs_fetch_log VALUES (?,?,?)",
                        (sym, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), None))
            con.commit()
            print(f"[{i}/{len(symbols)}] {sym}: {len(rows)} reports")
        except Exception as e:  # noqa: BLE001 - one bad symbol must not kill the run
            err += 1
            con.execute("INSERT OR REPLACE INTO docs_fetch_log VALUES (?,?,?)",
                        (sym, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), str(e)[:200]))
            con.commit()
            print(f"[{i}/{len(symbols)}] {sym}: ERROR {e}")
        time.sleep(args.sleep)
    con.close()
    print(f"done: {ok} ok, {err} errors")


if __name__ == "__main__":
    main()
