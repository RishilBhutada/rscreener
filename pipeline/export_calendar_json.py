"""Rscreener - the calendar page's file (web/public/calendar.json), from the
calendar_events table fetch_events.py keeps.

Written on EVERY run, publish-only ones included, so a code change can never
put an old calendar back on the site (see fetch_events.py). Only events dated
today or later are written: if NSE refuses for a week, the page thins out as
dates pass rather than showing last week's meetings as "upcoming".

Usage:  python export_calendar_json.py
"""
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "calendar.json"
IST = timezone(timedelta(hours=5, minutes=30))


def main() -> None:
    today = datetime.now(IST).date().isoformat()
    events, fetched = [], None
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    if con.execute("SELECT 1 FROM sqlite_master WHERE name='calendar_events'").fetchone():
        for kind, sym, company, purpose, d, detail, stamp in con.execute(
                "SELECT kind, symbol, company, purpose, date, detail, fetched_at FROM calendar_events"
                " WHERE date >= ? ORDER BY date, symbol", (today,)):
            events.append({
                "kind": kind,
                "symbol": sym,
                "company": company,
                "purpose": purpose if kind == "meeting" else f"Ex-date: {purpose}",
                "date": d,
                "desc": detail or "",
            })
        fetched = con.execute("SELECT MAX(fetched_at) FROM calendar_events").fetchone()[0]
    con.close()
    OUT.write_text(json.dumps({
        # When NSE was last read, not when this file was written - the honest
        # age of what the page shows.
        "generated_at": fetched,
        "events": events,
    }, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"calendar: {len(events)} events from {today} on (fetched {fetched})")


if __name__ == "__main__":
    main()
