"""Rscreener - when each set of results was ANNOUNCED, not when the quarter ended.

Why this exists: a P/E chart is supposed to show what the market could know at
each point in time. Ours stepped a quarter's earnings in on the quarter's END
date, which is weeks or months before anybody could read them. MTAR Technologies
closed its June-2026 quarter on 30-Jun and NSE broadcast the results on 29-Jul at
18:39 - and 29-Jul is exactly the day screener.in's EPS jumps from 16.88 to
44.26. Between 29-Jan and 29-Jul the company announced nothing at all, so the
trailing EPS sat still while the price ran, and the P/E peaked near 496. Our
chart, using period-end dates, quietly showed 230 for the same week: the spike
that actually happened was invisible.

Both NSE endpoints carry the date. The integrated-filing feed calls it
`broadcast_Date` against a `qe_Date` quarter; the legacy feed calls it
`broadCastDate` (with `filingDate` as a fallback) against `toDate`. One index
call per symbol is enough - no XBRL fetch, no parsing - so this is far cheaper
than a results re-fetch and can run over the whole universe often.

Usage:
  python fetch_filing_dates.py --symbols @data/all_symbols.txt [--max-age-hours 168]
"""
import argparse
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from fetch_results_history import INDEX_API, INTEGRATED_API, get_retry

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Referer": "https://www.nseindia.com/",
}


def _iso(stamp: str | None) -> str | None:
    """'29-Jul-2026 18:39:19' / '30-JUN-2026' -> '2026-07-29'."""
    if not stamp:
        return None
    head = str(stamp).split(" ")[0].strip()
    for fmt in ("%d-%b-%Y", "%d-%B-%Y"):
        try:
            return datetime.strptime(head.title(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def rows_from_integrated(session, sym: str) -> list[tuple]:
    body = get_retry(session, INTEGRATED_API.format(sym=sym), tries=2).json()
    rows = body if isinstance(body, list) else (body.get("resultBody") or body.get("data") or [])
    out = []
    for r in rows:
        period = _iso(r.get("qe_Date"))
        # revised_Date wins where a company restated: the market learned the
        # corrected figure then, not at the original broadcast
        announced = _iso(r.get("revised_Date")) or _iso(r.get("broadcast_Date")) or _iso(r.get("creation_Date"))
        if period and announced:
            out.append((period, announced))
    return out


def rows_from_legacy(session, sym: str) -> list[tuple]:
    out = []
    for period in ("Quarterly", "Annual"):
        try:
            body = get_retry(session, INDEX_API.format(sym=sym, period=period), tries=2).json()
        except Exception:  # noqa: BLE001
            continue
        rows = body if isinstance(body, list) else (body.get("resultBody") or body.get("data") or [])
        for r in rows:
            p = _iso(r.get("toDate"))
            a = _iso(r.get("broadCastDate")) or _iso(r.get("filingDate")) or _iso(r.get("exchdisstime"))
            if p and a:
                out.append((p, a))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", required=True, help="comma list, or @path to file")
    ap.add_argument("--sleep", type=float, default=0.25)
    ap.add_argument("--max-age-hours", type=float, default=0.0,
                    help="re-fetch a symbol older than this (0 = only never-fetched)")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    raw = (ROOT / args.symbols[1:]).read_text(encoding="utf-8") if args.symbols.startswith("@") else args.symbols
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]

    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    # Only switch journal mode if it isn't already WAL. Re-declaring it takes an
    # EXCLUSIVE lock that busy_timeout does not wait out, so running this while
    # the results fetchers are writing fails instantly with "database is locked"
    # even though the mode is the one we wanted all along.
    if con.execute("PRAGMA journal_mode").fetchone()[0].lower() != "wal":
        con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        "CREATE TABLE IF NOT EXISTS filing_dates "
        "(symbol TEXT, period_end TEXT, announced_on TEXT, PRIMARY KEY (symbol, period_end))"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS filing_dates_log "
        "(symbol TEXT PRIMARY KEY, fetched_at TEXT, error TEXT, n INTEGER)"
    )
    log = {r[0]: r[1] for r in con.execute("SELECT symbol, fetched_at FROM filing_dates_log WHERE error IS NULL")}
    if args.max_age_hours > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=args.max_age_hours)).strftime("%Y-%m-%d %H:%M:%S")
        due = [s for s in symbols if log.get(s, "") < cutoff]
    else:
        due = [s for s in symbols if s not in log]
    due.sort(key=lambda s: log.get(s) or "")
    if args.limit:
        due = due[:args.limit]
    print(f"filing dates for {len(due)} symbols...", flush=True)

    session = requests.Session()
    session.headers.update(HEADERS)
    try:
        session.get("https://www.nseindia.com/", timeout=20)  # cookie
    except Exception:  # noqa: BLE001
        pass

    import time
    ok = err = 0
    for i, sym in enumerate(due, 1):
        try:
            pairs = rows_from_integrated(session, sym)
            pairs += rows_from_legacy(session, sym)
            # earliest announcement wins: a later re-broadcast of the same
            # quarter is a restatement of something the market already had
            best: dict[str, str] = {}
            for p, a in pairs:
                if p not in best or a < best[p]:
                    best[p] = a
            if best:
                con.executemany(
                    "INSERT OR REPLACE INTO filing_dates VALUES (?,?,?)",
                    [(sym, p, a) for p, a in best.items()],
                )
            con.execute(
                "INSERT OR REPLACE INTO filing_dates_log VALUES (?,?,?,?)",
                (sym, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), None, len(best)),
            )
            con.commit()
            ok += 1
            print(f"[{i}/{len(due)}] {sym}: {len(best)} periods dated", flush=True)
        except Exception as e:  # noqa: BLE001
            err += 1
            con.execute(
                "INSERT OR REPLACE INTO filing_dates_log VALUES (?,?,?,?)",
                (sym, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), str(e)[:200], 0),
            )
            con.commit()
            print(f"[{i}/{len(due)}] {sym}: ERROR {e}", flush=True)
        time.sleep(args.sleep)
    print(f"done: {ok} ok, {err} errors")
    con.close()


if __name__ == "__main__":
    main()
