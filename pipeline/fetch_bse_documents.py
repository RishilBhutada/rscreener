"""Rscreener - annual-report PDF links for BSE-listed companies.

2,700 of the 5,069 companies in the universe are listed only on BSE. Every
document on their page comes from NSE's archive, so every one of them has an
empty Documents section - not "nothing filed", just nothing we ever asked for.

BSE publishes no structured financials at zero cost (its FinancialResult links
are zips of PDFs, and every structured-looking endpoint returns an HTML error
page), but it does publish the annual reports, and it publishes a lot of them:
thirty years for Reliance. That is the one thing worth taking from it.

Writes into the same `documents` table the NSE fetcher uses, so the company
page needs no change to show them.

Usage:
  python fetch_bse_documents.py --symbols RELIANCE,NSDL
  python fetch_bse_documents.py --exchange BSE --limit 400
"""
import argparse
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import budget

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
API = "https://api.bseindia.com/BseIndiaAPI/api/AnnualReport_New/w?scripcode={code}"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.bseindia.com/",
    "Origin": "https://www.bseindia.com",
}


def ensure(con: sqlite3.Connection) -> None:
    con.execute("""CREATE TABLE IF NOT EXISTS documents
                   (symbol TEXT, doc_type TEXT, from_yr TEXT, to_yr TEXT, url TEXT)""")
    con.execute("""CREATE TABLE IF NOT EXISTS bse_docs_log
                   (symbol TEXT PRIMARY KEY, fetched_at TEXT, found INTEGER, error TEXT)""")
    con.commit()


def targets(con: sqlite3.Connection, args) -> list[tuple[str, str]]:
    """(symbol, bse_code) pairs still worth asking about."""
    rows = con.execute(
        'SELECT SYMBOL, BSE_CODE FROM universe WHERE BSE_CODE IS NOT NULL AND BSE_CODE != ""'
        + (" AND EXCHANGE = ?" if args.exchange else ""),
        (args.exchange,) if args.exchange else (),
    ).fetchall()
    if args.symbols:
        want = {s.strip().upper() for s in args.symbols.split(",")}
        rows = [r for r in rows if r[0] in want]

    if args.max_age_hours:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=args.max_age_hours)).isoformat()
        seen = {s for s, at in con.execute("SELECT symbol, fetched_at FROM bse_docs_log")
                if at and at > cutoff}
        rows = [r for r in rows if r[0] not in seen]
    return rows[: args.limit] if args.limit else rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", help="comma list; default is every scrip with a BSE code")
    ap.add_argument("--exchange", help="restrict to this EXCHANGE value, e.g. BSE")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-age-hours", type=float, default=0,
                    help="skip symbols asked about more recently than this")
    ap.add_argument("--sleep", type=float, default=0.3)
    args = ap.parse_args()

    con = sqlite3.connect(DB)
    ensure(con)
    todo = targets(con, args)
    print(f"bse annual reports: {len(todo)} symbol(s) to ask about")

    sess = requests.Session()
    sess.headers.update(HEADERS)
    added = touched = failed = 0
    for i, (sym, code) in enumerate(todo, 1):
        if budget.expired():
            budget.stop(i - 1, len(todo))
            break
        err = None
        rows: list[tuple] = []
        try:
            r = sess.get(API.format(code=str(code).strip()), timeout=25)
            r.raise_for_status()
            for rec in (r.json() or {}).get("Table") or []:
                url = (rec.get("PDFDownload") or "").strip()
                year = str(rec.get("Year") or "").strip()
                if not url or not year.isdigit():
                    continue
                # Stored on the same shape as the NSE rows: an Indian annual
                # report covers the year ending in `Year`, so it runs from the
                # one before it.
                rows.append((sym, "annual_report", str(int(year) - 1), year, url))
        except Exception as e:  # noqa: BLE001 - one company must not stop the run
            err = f"{type(e).__name__}: {e}"[:200]
            failed += 1

        if rows:
            # Replace this company's BSE rows rather than accumulating duplicates
            # on every run, and never touch what NSE supplied.
            have = {u for (u,) in con.execute(
                "SELECT url FROM documents WHERE symbol=? AND doc_type='annual_report'", (sym,))}
            fresh = [r for r in rows if r[4] not in have]
            if fresh:
                con.executemany("INSERT INTO documents VALUES (?,?,?,?,?)", fresh)
                added += len(fresh)
            touched += 1
        con.execute("INSERT OR REPLACE INTO bse_docs_log VALUES (?,?,?,?)",
                    (sym, datetime.now(timezone.utc).isoformat(), len(rows), err))
        con.commit()
        if i % 100 == 0:
            print(f"  {i}/{len(todo)}  {added} new links, {failed} failed")
        time.sleep(args.sleep)

    print(f"bse annual reports: {added} new link(s) across {touched} company(ies), {failed} failed")
    con.close()


if __name__ == "__main__":
    main()
