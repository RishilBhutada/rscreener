"""Rscreener P5 - fetches direct annual-report PDF links from NSE's API.

Writes a `documents` table: symbol, doc_type, from_yr, to_yr, url.
Usage:
  python fetch_documents.py --symbols TCS,RELIANCE
  python fetch_documents.py --symbols @data/top500.txt
"""
import argparse
import sqlite3
import time
from pathlib import Path

import requests

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
    args = ap.parse_args()
    if args.symbols.startswith("@"):
        raw = (ROOT / args.symbols[1:]).read_text(encoding="utf-8")
    else:
        raw = args.symbols
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]

    s = requests.Session()
    s.headers.update(HEADERS)
    # warm the session; a 403 here is fine, the cookies still help the API call
    try:
        s.get("https://www.nseindia.com", timeout=20)
    except Exception:
        pass

    con = sqlite3.connect(DB)
    con.execute(
        "CREATE TABLE IF NOT EXISTS documents (symbol TEXT, doc_type TEXT, from_yr TEXT, to_yr TEXT, url TEXT)"
    )
    ok = err = 0
    for i, sym in enumerate(symbols, 1):
        try:
            r = s.get(API.format(sym=sym), timeout=25)
            r.raise_for_status()
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
            print(f"[{i}/{len(symbols)}] {sym}: {len(rows)} reports")
        except Exception as e:  # noqa: BLE001 - one bad symbol must not kill the run
            err += 1
            print(f"[{i}/{len(symbols)}] {sym}: ERROR {e}")
        time.sleep(args.sleep)
    con.close()
    print(f"done: {ok} ok, {err} errors")


if __name__ == "__main__":
    main()
