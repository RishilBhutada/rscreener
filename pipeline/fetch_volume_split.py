"""Rscreener - the volume split, 10 years: shares delivered vs shares bought
and sold the same day, per stock per day.

Owner, 14-Nov-2026: "Build all A, B, and C ... I want all data of at least
10 years. The volume split."

  NSE  MTO_DDMMYYYY.DAT     security-wise delivery position (EQ series), 2012 on
  BSE  SCBSEALLddmm.zip     delivery per scrip code, 2016 on; read for the
                            BSE-only companies (NSE-listed ones come from NSE)

Tables
  vol_split    (symbol, date, traded, delivered)          daily, last 400 days
  vol_split_w  (symbol, week, traded, delivered, days)    weekly totals, 10 years
  vol_days     (src, date, status)                         every date tried, once

Each (source, date) is read exactly once - vol_days records it, holiday 404s
included - so the weekly totals, which are ADDED to, never count a day twice.
Newest first: the recent years fill in on the first night, the rest over the
next few, within --minutes per run. Read-only toward the exchanges.

Usage:  python pipeline/fetch_volume_split.py [--years 10] [--minutes 20]
"""
import argparse
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

import market_activity_lib as lib
import nse_session

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
NSE_MTO = "https://nsearchives.nseindia.com/archives/equities/mto/MTO_{dmy}.DAT"
BSE_SCB = "https://www.bseindia.com/BSEDATA/gross/{yyyy}/SCBSEALL{ddmm}.zip"
DAILY_DAYS = 400


def connect():
    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    con.execute("CREATE TABLE IF NOT EXISTS vol_split (symbol TEXT, date TEXT, traded REAL, delivered REAL, PRIMARY KEY (symbol, date))")
    con.execute("CREATE TABLE IF NOT EXISTS vol_split_w (symbol TEXT, week TEXT, traded REAL, delivered REAL, days INTEGER, "
                "PRIMARY KEY (symbol, week))")
    con.execute("CREATE TABLE IF NOT EXISTS vol_days (src TEXT, date TEXT, status TEXT, PRIMARY KEY (src, date))")
    return con


def store(con, src: str, day: str, rows: list[tuple], status: str) -> None:
    """One day, atomically: its daily rows (if recent), its weekly totals,
    and the record that it has been read."""
    recent = day >= (date.today() - timedelta(days=DAILY_DAYS)).isoformat()
    with con:
        if con.execute("SELECT 1 FROM vol_days WHERE src=? AND date=?", (src, day)).fetchone():
            return
        if rows:
            if recent:
                con.executemany("INSERT OR REPLACE INTO vol_split VALUES (?,?,?,?)", [(s, d, t, dq) for s, d, t, dq in rows])
            con.executemany(
                "INSERT INTO vol_split_w VALUES (?,?,?,?,1) ON CONFLICT(symbol, week) DO UPDATE SET "
                "traded = traded + excluded.traded, delivered = delivered + excluded.delivered, days = days + 1",
                [(s, lib.week_end(d), t, dq) for s, d, t, dq in rows])
        con.execute("INSERT INTO vol_days VALUES (?,?,?)", (src, day, status))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=10)
    ap.add_argument("--minutes", type=float, default=20)
    a = ap.parse_args()
    stop_at = time.monotonic() + a.minutes * 60
    con = connect()
    codes = {str(c).strip(): s for s, c in con.execute(
        "SELECT SYMBOL, BSE_CODE FROM universe WHERE EXCHANGE='BSE' AND BSE_CODE IS NOT NULL")}
    s = requests.Session()
    s.headers.update(nse_session.HEADERS)
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
    first = today - timedelta(days=int(365.25 * a.years))
    days = [today - timedelta(days=i) for i in range((today - first).days + 1)]
    days = [d for d in days if d.weekday() < 5]
    done = {(src, d) for src, d in con.execute("SELECT src, date FROM vol_days")}
    tally = {"nse": [0, 0, 0], "bse": [0, 0, 0]}   # read, not published, failed
    out_of_time = False
    for d in days:                                   # newest first
        if time.monotonic() > stop_at:
            out_of_time = True
            break
        iso = d.isoformat()
        for src in ("nse", "bse"):
            if (src, iso) in done:
                continue
            # Today's files appear in the evening; a 404 for today is "not
            # yet", not a holiday, so today is never recorded as missing.
            url = NSE_MTO.format(dmy=d.strftime("%d%m%Y")) if src == "nse" else \
                BSE_SCB.format(yyyy=d.strftime("%Y"), ddmm=d.strftime("%d%m"))
            try:
                r = s.get(url, timeout=45)
            except requests.RequestException:
                tally[src][2] += 1
                continue
            if r.status_code == 404:
                if d < today:
                    store(con, src, iso, [], "missing")
                tally[src][1] += 1
                continue
            if r.status_code != 200:
                tally[src][2] += 1
                continue
            try:
                rows = lib.mto(r.text) if src == "nse" else lib.bse_delivery(r.content, codes)
            except Exception as e:  # noqa: BLE001 - one bad file must not stop the rest
                print(f"  {src} {iso}: could not read ({type(e).__name__})")
                tally[src][2] += 1
                continue
            # A file for a holiday sometimes repeats the session before it:
            # stored under the date it SAYS, which the once-only rule guards.
            day = rows[0][1] if rows else iso
            if (src, day) in done:
                store(con, src, iso, [], "repeat")
                continue
            store(con, src, day, rows, "ok")
            if day != iso:
                store(con, src, iso, [], "repeat")
            done.add((src, day))
            tally[src][0] += 1
            time.sleep(0.25)
    with con:
        con.execute("DELETE FROM vol_split WHERE date < ?", ((date.today() - timedelta(days=DAILY_DAYS)).isoformat(),))
    span = con.execute("SELECT MIN(week), MAX(week), COUNT(DISTINCT symbol) FROM vol_split_w").fetchone()
    con.close()
    for src, (ok, miss, fail) in tally.items():
        print(f"  {src}: {ok} day(s) read, {miss} not published (holiday or not yet), {fail} failed")
    print(f"  weekly history: {span[0]} to {span[1]}, {span[2]} stocks"
          + ("; stopped at the time limit - the rest next run" if out_of_time else "; complete"))


if __name__ == "__main__":
    main()
