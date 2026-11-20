"""Backfill the half-yearly cash flow (cashflow_half.py) from FY21 on.

The weekly results pass stores the cash flow of every filing it downloads,
which covers the last two years. This reaches back to where the statement
starts in NSE's machine-readable filings (FY21): per company, only the
half-year and year-end filings - about a dozen documents - consolidated
where filed. Biggest companies first; each company is done once, then again
after --max-age-hours, under a wall-clock budget.

Usage:
  python fetch_cashflow_half.py --symbols TCS,INFY
  python fetch_cashflow_half.py --max-minutes 30
"""
import argparse
import sqlite3
import time
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

import requests

import budget
import cashflow_half
import nse_session
from fetch_results_history import HEADERS, INDEX_API, _has_xbrl, db_retry, get_retry, integrated_filings

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
SINCE = datetime(2020, 9, 1)   # FY21's half-year: nothing machine-readable before


def fy_end_month(annual_rows: list[dict]) -> int:
    """The month this company's financial year ends in, from its annual
    filings since FY21 (March when none)."""
    ends = Counter()
    for r in annual_rows:
        try:
            d = datetime.strptime(r["toDate"], "%d-%b-%Y")
        except (KeyError, TypeError, ValueError):
            continue
        if d >= SINCE:
            ends[d.month] += 1
    return ends.most_common(1)[0][0] if ends else 3


def half_months(annual_rows: list[dict]) -> set[int]:
    """The months a half-year and a year end in for this company: Sep and Mar
    for an April-March year; Jun and Dec for a calendar year."""
    fy = fy_end_month(annual_rows)
    return {fy, (fy + 5) % 12 + 1}


def pick(rows: list[dict], months: set[int]) -> list[dict]:
    """One filing per period end in `months` since FY21, consolidated first."""
    best: dict[str, dict] = {}
    for r in rows:
        if not _has_xbrl(r):
            continue
        try:
            end = datetime.strptime(str(r.get("toDate")).strip().title(), "%d-%b-%Y")
        except ValueError:
            continue
        if end < SINCE or end.month not in months:
            continue
        key = end.strftime("%Y-%m-%d")
        cons = r.get("consolidated") == "Consolidated"
        if key not in best or (cons and best[key].get("consolidated") != "Consolidated"):
            best[key] = r
    return [best[k] for k in sorted(best)]


def due_symbols(con: sqlite3.Connection, symbols: list[str], max_age_hours: float) -> list[str]:
    log = {r[0]: r[1] for r in con.execute("SELECT symbol, fetched_at FROM cashflow_fetch_log WHERE error IS NULL")}
    cutoff = (datetime.utcnow() - timedelta(hours=max_age_hours)).strftime("%Y-%m-%d %H:%M:%S")
    due = [s for s in symbols if log.get(s, "") < cutoff]
    # biggest first: those are the pages people open
    try:
        mcap = {r[0]: r[1] or 0 for r in con.execute("SELECT symbol, market_cap FROM fundamentals")}
    except sqlite3.Error:
        mcap = {}
    due.sort(key=lambda s: (log.get(s) or "", -(mcap.get(s) or 0)))
    return due


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="@data/nse_symbols.txt", help="comma list, or @path to file")
    ap.add_argument("--max-age-hours", type=float, default=24 * 180)
    ap.add_argument("--max-minutes", type=float, default=0)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--sleep", type=float, default=0.3)
    args = ap.parse_args()
    raw = (ROOT / args.symbols[1:]).read_text(encoding="utf-8") if args.symbols.startswith("@") else args.symbols
    symbols = [s.strip().upper() for s in raw.replace("\n", ",").split(",") if s.strip()]

    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    cashflow_half.ensure_table(con)
    con.execute("CREATE TABLE IF NOT EXISTS cashflow_fetch_log (symbol TEXT PRIMARY KEY, fetched_at TEXT, error TEXT, n INTEGER)")
    nse_session.requeue_amp(con, "cashflow_fetch_log")
    due = due_symbols(con, symbols, args.max_age_hours)
    if args.limit:
        due = due[: args.limit]
    print(f"half-yearly cash flow for {len(due)} symbols...")

    s = requests.Session()
    s.headers.update(HEADERS)
    try:
        s.get("https://www.nseindia.com", timeout=20)
    except Exception:  # noqa: BLE001
        pass
    started = time.monotonic()
    done = cols_total = 0
    for i, sym in enumerate(due, 1):
        if budget.stop(i - 1, len(due)):
            break
        if args.max_minutes and (time.monotonic() - started) / 60 >= args.max_minutes:
            print(f"time budget of {args.max_minutes:g} min reached after {i-1} of {len(due)}; the rest come up next run")
            break
        n = unread = 0
        err = None
        try:
            annual, rows = [], []
            for period in ("Annual", "Quarterly"):
                body = get_retry(s, INDEX_API.format(sym=nse_session.q(sym), period=period)).json()
                got = body if isinstance(body, list) else body.get("data", [])
                rows += got
                if period == "Annual":
                    annual = got
                time.sleep(args.sleep)
            rows += integrated_filings(s, sym)
            months = half_months(annual)
            fy_end = fy_end_month(annual)
            for f in pick(rows, months):
                try:
                    cols = cashflow_half.parse(get_retry(s, f["xbrl"], tries=3).content, fy_end)
                except Exception:  # noqa: BLE001
                    unread += 1
                    continue
                basis = "consolidated" if f.get("consolidated") == "Consolidated" else "standalone"
                n += db_retry(lambda: cashflow_half.store(con, sym, basis, cols))
                time.sleep(0.15)
            note = f"{unread} filings could not be read" if unread and not n else None
        except Exception as e:  # noqa: BLE001
            note = err = str(e)[:200]
        db_retry(lambda: con.execute("INSERT OR REPLACE INTO cashflow_fetch_log VALUES (?,?,?,?)",
                                     (sym, datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"), note, n)))
        db_retry(con.commit)
        done += 1
        cols_total += n
        print(f"[{i}/{len(due)}] {sym}: {n} cash flow columns" + (f" ({unread} unreadable)" if unread else "")
              + (f" ERROR {err}" if err else ""), flush=True)
        time.sleep(args.sleep)
    print(f"done: {done} companies, {cols_total} cash flow columns stored")


if __name__ == "__main__":
    main()
