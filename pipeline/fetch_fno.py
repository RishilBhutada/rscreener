"""Rscreener - which stocks trade in NSE's futures & options segment.

The "F&O" tag beside a ticker (screener.in shows one) and the screen field
in_fno. Source: NSE's public market-lot file, one small CSV, read nightly.
Read-only toward NSE; never used for trading.

Table fno_lots(symbol, lot, fetched_at) - replaced whole each run, so a stock
leaving the segment loses its tag the next night. A failed fetch leaves the
table as it was (an empty file is not "no stock trades F&O").

Usage:  python pipeline/fetch_fno.py
"""
import csv
import io
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import requests

import nse_session

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
URL = "https://nsearchives.nseindia.com/content/fo/fo_mktlots.csv"


def main() -> None:
    s = requests.Session()
    s.headers.update(nse_session.HEADERS)
    try:
        r = s.get(URL, timeout=60)
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"fno: {type(e).__name__} - kept the last list")
        return
    rows = list(csv.reader(io.StringIO(r.text)))
    lots: dict[str, int | None] = {}
    for row in rows[1:]:
        cells = [c.strip() for c in row]
        if len(cells) < 3 or not cells[1] or cells[1].upper() == "SYMBOL":
            continue
        sym = cells[1].upper()
        # Index derivatives are listed too (NIFTY, BANKNIFTY ...); they carry
        # no company page, and the tag is for stocks.
        if "NIFTY" in sym or sym in {"SENSEX", "BANKEX"}:
            continue
        lot = next((int(c) for c in cells[2:] if c.isdigit()), None)
        lots[sym] = lot
    if len(lots) < 50:
        print(f"fno: only {len(lots)} rows parsed - kept the last list")
        return
    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    con.execute("CREATE TABLE IF NOT EXISTS fno_lots (symbol TEXT PRIMARY KEY, lot INTEGER, fetched_at TEXT)")
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with con:
        con.execute("DELETE FROM fno_lots")
        con.executemany("INSERT INTO fno_lots VALUES (?,?,?)", [(k, v, stamp) for k, v in lots.items()])
    con.close()
    print(f"fno: {len(lots)} stocks in the F&O segment")


if __name__ == "__main__":
    main()
