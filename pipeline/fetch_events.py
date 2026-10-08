"""Rscreener - upcoming corporate events: board meetings (results, dividends,
fund raising) and ex-dates (dividend, bonus, split) - two market-wide NSE calls.

Stored in the database (calendar_events), not written into the website. This
used to write web/public/calendar.json directly, and the repo kept a copy of
that file: every publish that ran without fetching - every code change - built
the site from the copy, so the live calendar showed 27-Aug's events for a month
while the nightly run fetched fresh ones each night. export_calendar_json.py
now writes the page's file from this table on every run.

Each kind is replaced only when its call succeeds; a night NSE refuses keeps
the last good list rather than emptying it.

Past board meetings come from a third call. NSE's event calendar lists only
meetings still to come - a meeting leaves it ON ITS OWN DAY - so keeping the
rows it once returned lost every meeting the day it happened (TCS's Q2, 8 Oct
2026, was gone by that evening). NSE's board-meetings list takes a date range
and keeps them: the last ten days on every run, the whole past year once.
Ex-dates have no such call: the corporate-actions table holds their history.
"""
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
MEETINGS = "https://www.nseindia.com/api/event-calendar"
PAST_MEETINGS = ("https://www.nseindia.com/api/corporate-board-meetings?index=equities"
                 "&from_date={a:%d-%m-%Y}&to_date={b:%d-%m-%Y}")
# NSE files a generic "Board Meeting Intimation" row beside the one that names
# the purpose; the named one wins.
GENERIC = "board meeting intimation"
EXDATES = ("https://www.nseindia.com/api/corporates-corporateActions?index=equities"
           "&from_date={a:%d-%m-%Y}&to_date={b:%d-%m-%Y}")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}
IST = timezone(timedelta(hours=5, minutes=30))


def iso(raw: str | None) -> str | None:
    try:
        return datetime.strptime(raw or "", "%d-%b-%Y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def replace(con: sqlite3.Connection, kind: str, rows: list[tuple], keep_before: str | None = None) -> None:
    """The new list replaces the old. With keep_before, rows dated before it
    stay - unless the new list carries the same company and day again."""
    if keep_before is None:
        con.execute("DELETE FROM calendar_events WHERE kind=?", (kind,))
    else:
        con.execute("DELETE FROM calendar_events WHERE kind=? AND date >= ?", (kind, keep_before))
        con.executemany("DELETE FROM calendar_events WHERE kind=? AND symbol=? AND date=?",
                        [(kind, r[1], r[4]) for r in rows])
        year_ago = (date.fromisoformat(keep_before) - timedelta(days=400)).isoformat()
        con.execute("DELETE FROM calendar_events WHERE kind=? AND date < ?", (kind, year_ago))
    con.executemany("INSERT INTO calendar_events VALUES (?,?,?,?,?,?,?)", rows)
    con.commit()


def past_meetings(s: requests.Session, a: date, b: date, stamp: str) -> list[tuple]:
    """Board meetings held from a to b, one row per company and day."""
    r = s.get(PAST_MEETINGS.format(a=a, b=b), timeout=40)
    r.raise_for_status()
    body = r.json()
    best: dict[tuple, tuple] = {}
    for e in body if isinstance(body, list) else body.get("data", []):
        d, sym = iso(e.get("bm_date")), e.get("bm_symbol")
        if not (d and sym):
            continue
        purpose = (e.get("bm_purpose") or "").strip() or "Board meeting"
        row = ("meeting", sym, e.get("sm_name"), purpose, d, (e.get("bm_desc") or "")[:200], stamp)
        held = best.get((sym, d))
        if held is None or (held[3].lower() == GENERIC and purpose.lower() != GENERIC):
            best[(sym, d)] = row
    return list(best.values())


def main() -> None:
    con = sqlite3.connect(DB, timeout=180)
    con.execute("""CREATE TABLE IF NOT EXISTS calendar_events (
        kind TEXT, symbol TEXT, company TEXT, purpose TEXT, date TEXT, detail TEXT, fetched_at TEXT)""")
    s = requests.Session()
    s.headers.update(HEADERS)
    try:
        s.get("https://www.nseindia.com", timeout=20)
    except Exception:  # noqa: BLE001 - the cookie is a courtesy; the calls below decide
        pass
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    r = s.get(MEETINGS, timeout=25)
    r.raise_for_status()
    # One row per company and day: NSE sometimes lists the same meeting twice.
    meetings = list({(e.get("symbol"), d): ("meeting", e.get("symbol"), e.get("company"), e.get("purpose"), d,
                                            (e.get("bm_desc") or "")[:200], stamp)
                     for e in r.json() if (d := iso(e.get("date")))}.values())
    today = datetime.now(IST).date()
    # Today's rows stay: the event calendar has already dropped them.
    replace(con, "meeting", meetings, keep_before=(today + timedelta(days=1)).isoformat())

    # The past: ten days every run; the year, a month a call, until it is held.
    oldest = con.execute("SELECT MIN(date) FROM calendar_events WHERE kind='meeting'").fetchone()[0]
    start = today - timedelta(days=10)
    if not oldest or oldest > (today - timedelta(days=330)).isoformat():
        start = today - timedelta(days=366)
    held, a = 0, start
    while a <= today:
        b = min(a + timedelta(days=30), today)
        try:
            rows = past_meetings(s, a, b, stamp)
        except (requests.RequestException, ValueError) as e:
            print(f"past board meetings {a} to {b}: {type(e).__name__} - kept what is stored")
            break
        con.executemany("DELETE FROM calendar_events WHERE kind='meeting' AND symbol=? AND date=?",
                        [(r[1], r[4]) for r in rows])
        con.executemany("INSERT INTO calendar_events VALUES (?,?,?,?,?,?,?)", rows)
        con.commit()
        held += len(rows)
        a = b + timedelta(days=1)

    r = s.get(EXDATES.format(a=today, b=today + timedelta(days=45)), timeout=30)
    r.raise_for_status()
    body = r.json()
    rows = body if isinstance(body, list) else body.get("data", [])
    exdates = [("exdate", e.get("symbol"), e.get("comp"), e.get("subject"), d, None, stamp)
               for e in rows if (d := iso(e.get("exDate")))]
    replace(con, "exdate", exdates)
    con.close()
    print(f"calendar: {len(meetings)} board meetings, {len(exdates)} ex-dates in the next 45 days; "
          f"{held} past meetings since {start}")


if __name__ == "__main__":
    main()
