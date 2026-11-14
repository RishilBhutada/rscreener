"""Rscreener - the volume split, 10 years: shares delivered vs shares bought
and sold the same day, per stock per day.

Owner, 14-Nov-2026: "Build all A, B, and C ... I want all data of at least
10 years. The volume split." Then "ok for both a and b": every DAY kept
for the ten years, not only weekly totals.

  NSE  MTO_DDMMYYYY.DAT     security-wise delivery position (EQ series), 2012 on
  BSE  SCBSEALLddmm.zip     delivery per scrip code, 2016 on; read for the
                            BSE-only companies (NSE-listed ones come from NSE)

Tables
  vol_split       (symbol, date, traded, delivered)        daily rows, last 400 days
                                                            (screener fields read these)
  vol_split_w     (symbol, week, traded, delivered, days)  weekly totals, 10 years
  vol_daily       (symbol, year, data)                      every day, 10 years, PACKED:
                                                            one row per stock-year, data =
                                                            JSON {"MMDD": [traded, delivered]}
                                                            - 12 million plain rows would
                                                            be ~1 GB; packed, a fraction
  vol_days        (src, date, status)                       dates counted into the weekly totals
  vol_daily_days  (src, date)                               dates written into vol_daily

Each (source, date) adds to the weekly totals exactly once (vol_days) and to
the daily history exactly once (vol_daily_days); a date already counted
weekly is re-read for its days only. Newest first, within --minutes per
run. Listed companies only. Read-only toward the exchanges.

Usage:  python pipeline/fetch_volume_split.py [--years 10] [--minutes 20]
"""
import argparse
import json
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
FLUSH_EVERY = 120   # days of packed rows held in memory before they are written


def connect():
    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    con.execute("CREATE TABLE IF NOT EXISTS vol_split (symbol TEXT, date TEXT, traded REAL, delivered REAL, PRIMARY KEY (symbol, date))")
    con.execute("CREATE TABLE IF NOT EXISTS vol_split_w (symbol TEXT, week TEXT, traded REAL, delivered REAL, days INTEGER, "
                "PRIMARY KEY (symbol, week))")
    con.execute("CREATE TABLE IF NOT EXISTS vol_days (src TEXT, date TEXT, status TEXT, PRIMARY KEY (src, date))")
    con.execute("CREATE TABLE IF NOT EXISTS vol_daily (symbol TEXT, year TEXT, data TEXT, PRIMARY KEY (symbol, year))")
    con.execute("CREATE TABLE IF NOT EXISTS vol_daily_days (src TEXT, date TEXT, PRIMARY KEY (src, date))")
    return con


def store_weekly(con, src: str, day: str, rows: list[tuple], status: str) -> None:
    """One day into the weekly totals (and the recent daily rows), once."""
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


def flush_daily(con, buf: dict, days_done: list) -> None:
    """Merge the buffered days into the packed stock-year rows."""
    if not buf and not days_done:
        return
    with con:
        for (sym, year), days in buf.items():
            r = con.execute("SELECT data FROM vol_daily WHERE symbol=? AND year=?", (sym, year)).fetchone()
            data = json.loads(r[0]) if r else {}
            data.update(days)
            con.execute("INSERT OR REPLACE INTO vol_daily VALUES (?,?,?)",
                        (sym, year, json.dumps(dict(sorted(data.items())), separators=(",", ":"))))
        con.executemany("INSERT OR IGNORE INTO vol_daily_days VALUES (?,?)", days_done)
    buf.clear()
    days_done.clear()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=10)
    ap.add_argument("--minutes", type=float, default=20)
    a = ap.parse_args()
    stop_at = time.monotonic() + a.minutes * 60
    con = connect()
    codes = {str(c).strip(): s for s, c in con.execute(
        "SELECT SYMBOL, BSE_CODE FROM universe WHERE EXCHANGE='BSE' AND BSE_CODE IS NOT NULL")}
    listed = {r[0] for r in con.execute("SELECT SYMBOL FROM universe")}
    s = requests.Session()
    s.headers.update(nse_session.HEADERS)
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
    first = today - timedelta(days=int(365.25 * a.years))
    days = [today - timedelta(days=i) for i in range((today - first).days + 1)]
    days = [d for d in days if d.weekday() < 5]
    weekly_done: dict[tuple, str] = {(src, d): st for src, d, st in con.execute("SELECT src, date, status FROM vol_days")}
    daily_done = {(src, d) for src, d in con.execute("SELECT src, date FROM vol_daily_days")}
    # A holiday or a repeated file has no days of its own to keep.
    daily_done |= {k for k, st in weekly_done.items() if st != "ok"}
    tally = {"nse": [0, 0, 0], "bse": [0, 0, 0]}   # read, not published, failed
    buf: dict[tuple, dict] = {}
    days_done: list[tuple] = []
    n_buffered = 0
    out_of_time = False
    for d in days:                                   # newest first
        if time.monotonic() > stop_at:
            out_of_time = True
            break
        iso = d.isoformat()
        for src in ("nse", "bse"):
            need_w, need_d = (src, iso) not in weekly_done, (src, iso) not in daily_done
            if not need_w and not need_d:
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
                    store_weekly(con, src, iso, [], "missing")
                    weekly_done[(src, iso)] = "missing"
                    daily_done.add((src, iso))
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
            # stored under the date it SAYS, which the once-only rules guard.
            day = rows[0][1] if rows else iso
            if day != iso:
                store_weekly(con, src, iso, [], "repeat")
                weekly_done[(src, iso)] = "repeat"
                daily_done.add((src, iso))
            if (src, day) not in weekly_done:
                store_weekly(con, src, day, rows, "ok")
                weekly_done[(src, day)] = "ok"
            if (src, day) not in daily_done:
                y, md = day[:4], day[5:7] + day[8:10]
                for sym, _, t, dq in rows:
                    if sym in listed:
                        buf.setdefault((sym, y), {})[md] = [int(t), int(dq)]
                days_done.append((src, day))
                daily_done.add((src, day))
                n_buffered += 1
                if n_buffered >= FLUSH_EVERY:
                    flush_daily(con, buf, days_done)
                    n_buffered = 0
            tally[src][0] += 1
            time.sleep(0.25)
    flush_daily(con, buf, days_done)
    with con:
        con.execute("DELETE FROM vol_split WHERE date < ?", ((date.today() - timedelta(days=DAILY_DAYS)).isoformat(),))
    span = con.execute("SELECT MIN(week), MAX(week), COUNT(DISTINCT symbol) FROM vol_split_w").fetchone()
    dspan = con.execute("SELECT MIN(year), MAX(year), COUNT(DISTINCT symbol) FROM vol_daily").fetchone()
    con.close()
    for src, (ok, miss, fail) in tally.items():
        print(f"  {src}: {ok} file(s) read, {miss} not published (holiday or not yet), {fail} failed")
    print(f"  weekly history: {span[0]} to {span[1]}, {span[2]} stocks; daily history: {dspan[0]} to {dspan[1]}, "
          f"{dspan[2]} stocks" + ("; stopped at the time limit - the rest next run" if out_of_time else "; complete"))


if __name__ == "__main__":
    main()
