"""Rscreener - the time each company's results came out.

The figures on the site are read from the results XBRL, and that often reaches
NSE hours after the results themselves. TCS announced its Sep-2026 quarter at
15:40 on 8 Oct and filed the XBRL at 22:07; HDFC Bank 14:22 and 16:01 in July.
The moment that matters - when the market could read the results - is the
"Outcome of Board Meeting" announcement, which NSE's announcements list stamps
to the second. One market-wide call per day, so the whole past year costs a
few hundred small requests, once.

Table result_times(symbol, day, at, doc): each company's earliest results
announcement on each day - its time (HH:MM:SS, IST) and the filing's PDF.

  every run         the last --days days (default 3)
  with --backfill   also every day of the past year not fetched yet, a day a
                    call; result_times_log remembers which days are held, so
                    a Sunday with nothing on it is not asked again every night

Usage:  python fetch_result_times.py [--days 3] [--backfill]
"""
import argparse
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

import budget
import nse_session

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
DAY = "https://www.nseindia.com/api/corporate-announcements?index=equities&from_date={d:%d-%m-%Y}&to_date={d:%d-%m-%Y}"
NSE_DOCS = "https://nsearchives.nseindia.com/corporate/"
IST = timezone(timedelta(hours=5, minutes=30))
# The subjects results are filed under. Most come as "Outcome of Board
# Meeting"; the text then says "financial results".
RESULT_DESCS = {"outcome of board meeting", "financial result updates", "financial results"}


def is_results(row: dict, meeting_days: set[tuple]) -> bool:
    desc = (row.get("desc") or "").strip().lower()
    if desc not in RESULT_DESCS:
        return False
    if "result" in (row.get("attchmntText") or "").lower():
        return True
    # An outcome filed on the day of the company's results meeting is its
    # results, however the covering text is worded.
    stamp = stamp_of(row)
    return desc == "outcome of board meeting" and stamp is not None and (row.get("symbol"), stamp.date().isoformat()) in meeting_days


def stamp_of(row: dict) -> datetime | None:
    try:
        return datetime.strptime((row.get("an_dt") or "").strip(), "%d-%b-%Y %H:%M:%S")
    except ValueError:
        return None


def earliest(rows: list[dict], meeting_days: set[tuple]) -> dict[tuple, tuple]:
    """(symbol, day) -> (time, document) of its first results announcement."""
    best: dict[tuple, tuple] = {}
    for r in rows:
        sym, t = r.get("symbol"), stamp_of(r)
        if not sym or t is None or not is_results(r, meeting_days):
            continue
        key = (sym, t.date().isoformat())
        doc = (r.get("attchmntFile") or "").strip()
        doc = doc[len(NSE_DOCS):] if doc.startswith(NSE_DOCS) else doc
        at = t.strftime("%H:%M:%S")
        if key not in best or at < best[key][0]:
            best[key] = (at, doc)
    return best


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3, help="re-read this many days back from today, every run")
    ap.add_argument("--backfill", action="store_true", help="also fill the past year's days not held yet")
    ap.add_argument("--sleep", type=float, default=1.0)
    args = ap.parse_args()

    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    con.execute("CREATE TABLE IF NOT EXISTS result_times "
                "(symbol TEXT, day TEXT, at TEXT, doc TEXT, PRIMARY KEY (symbol, day))")
    con.execute("CREATE TABLE IF NOT EXISTS result_times_log (day TEXT PRIMARY KEY, fetched_at TEXT, n INTEGER)")
    con.commit()
    has_events = con.execute("SELECT 1 FROM sqlite_master WHERE name='calendar_events'").fetchone()
    meeting_days = {(s, d) for s, d in con.execute(
        "SELECT symbol, date FROM calendar_events WHERE kind='meeting' AND lower(purpose) LIKE '%result%'")} if has_events else set()

    today = datetime.now(IST).date()
    days = [today - timedelta(days=i) for i in range(args.days)]
    if args.backfill:
        held = {r[0] for r in con.execute("SELECT day FROM result_times_log")}
        days += [d for d in (today - timedelta(days=i) for i in range(args.days, 366)) if d.isoformat() not in held]

    s = requests.Session()
    s.headers.update(nse_session.HEADERS)
    try:
        s.get(nse_session.HOME, timeout=20)
    except requests.RequestException:
        pass  # the cookie is a courtesy; the calls below decide

    found = done = 0
    for i, d in enumerate(days):
        if budget.stop(i, len(days)):
            break
        try:
            r = s.get(DAY.format(d=d), timeout=60)
            r.raise_for_status()
            body = r.json()
        except (requests.RequestException, ValueError) as e:
            # One retry on a fresh cookie; a second refusal leaves the day for
            # the next run (it is not logged as held).
            time.sleep(3)
            try:
                s.get(nse_session.HOME, timeout=20)
                r = s.get(DAY.format(d=d), timeout=60)
                r.raise_for_status()
                body = r.json()
            except (requests.RequestException, ValueError):
                print(f"{d}: {type(e).__name__} - left for the next run")
                continue
        rows = body if isinstance(body, list) else body.get("data", [])
        best = earliest(rows, meeting_days)
        for (sym, day), (at, doc) in best.items():
            # The earliest wins: a later results filing that day is a correction
            # or an attachment, not the moment the results came out.
            con.execute("INSERT INTO result_times VALUES (?,?,?,?) ON CONFLICT(symbol, day) DO UPDATE SET "
                        "at=excluded.at, doc=excluded.doc WHERE excluded.at < result_times.at",
                        (sym, day, at, doc))
        # Today is never "held": more results arrive all evening.
        if d < today:
            con.execute("INSERT OR REPLACE INTO result_times_log VALUES (?,?,?)",
                        (d.isoformat(), datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), len(best)))
        con.commit()
        found += len(best)
        done += 1
        if i + 1 < len(days):
            time.sleep(args.sleep)
    n = con.execute("SELECT COUNT(*) FROM result_times").fetchone()[0]
    con.close()
    print(f"result times: {done} of {len(days)} days read, {found} results announcements in them; {n} held")


if __name__ == "__main__":
    main()
