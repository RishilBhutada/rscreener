"""Rscreener - Nifty options, daily, ten years, for the Options lab.

Owner, 15-Nov-2026: test an overnight strategy (buy a Nifty call and put near
the close, sell the next morning) on history, inside Rscreener. RESEARCH
ONLY: nothing here places a trade. The plan puts F&O after Phase-3.

  NSE F&O bhavcopy, new layout (UDiFF)  2024 on
  NSE F&O bhavcopy, old layout          before that (back past 2016)
  Yahoo chart endpoint                  ^NSEI and ^INDIAVIX daily open/high/low/close

Tables
  nifty_opt     (date, expiry, strike, cp, open, high, low, close, volume)
                the three nearest expiries, strikes within 800 points of
                at-the-money: ~200 rows a day
  optlab_days   (date, status, lot)   every date tried, once
  optlab_index  (ticker, date, open, high, low, close)

Newest first, within --minutes: ten years fill over a few nights, then one
file a night. Read-only toward the exchange.

Usage:  python pipeline/fetch_nifty_options.py [--years 10] [--minutes 15]
"""
import argparse
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import nse_session
import optlab_lib as lib

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
NEW = "https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{ymd}_F_0000.csv.zip"
OLD = "https://nsearchives.nseindia.com/content/historical/DERIVATIVES/{yyyy}/{mon}/fo{dd}{mon}{yyyy}bhav.csv.zip"
YAHOO = "https://query2.finance.yahoo.com/v8/finance/chart/{sym}?period1={p1}&period2={p2}&interval=1d"
INDEX = ("^NSEI", "^INDIAVIX")


def connect():
    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    con.execute("CREATE TABLE IF NOT EXISTS nifty_opt (date TEXT, expiry TEXT, strike REAL, cp TEXT, open REAL, high REAL, "
                "low REAL, close REAL, volume REAL, PRIMARY KEY (date, expiry, strike, cp))")
    con.execute("CREATE TABLE IF NOT EXISTS optlab_days (date TEXT PRIMARY KEY, status TEXT, lot INTEGER)")
    con.execute("CREATE TABLE IF NOT EXISTS optlab_index (ticker TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, "
                "PRIMARY KEY (ticker, date))")
    return con


def fetch_index(con, years: int) -> None:
    s = requests.Session()
    s.headers.update({"User-Agent": nse_session.HEADERS["User-Agent"]})
    now = int(time.time())
    for sym in INDEX:
        try:
            r = s.get(YAHOO.format(sym=requests.utils.quote(sym), p1=now - int((years + 0.2) * 366 * 86400), p2=now), timeout=45)
            res = r.json()["chart"]["result"][0]
            q = res["indicators"]["quote"][0]
            off = res["meta"].get("gmtoffset", 19800)
            rows = []
            for i, ts in enumerate(res["timestamp"]):
                o, h, lo, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
                if c is None:
                    continue
                d = datetime.fromtimestamp(ts + off, timezone.utc).strftime("%Y-%m-%d")
                rows.append((sym, d, o, h, lo, c))
            with con:
                con.executemany("INSERT OR REPLACE INTO optlab_index VALUES (?,?,?,?,?,?)", rows)
            print(f"  {sym}: {len(rows)} days")
        except Exception as e:  # noqa: BLE001 - the options still load; the page says what is missing
            print(f"  {sym}: not read ({type(e).__name__})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=10)
    ap.add_argument("--minutes", type=float, default=15)
    a = ap.parse_args()
    stop_at = time.monotonic() + a.minutes * 60
    con = connect()
    fetch_index(con, a.years)
    s = requests.Session()
    s.headers.update(nse_session.HEADERS)
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
    days = [today - timedelta(days=i) for i in range(int(365.25 * a.years) + 1)]
    days = [d for d in days if d.weekday() < 5]
    done = {r[0] for r in con.execute("SELECT date FROM optlab_days")}
    ok = miss = fail = 0
    out_of_time = False
    for d in days:                                   # newest first
        iso = d.isoformat()
        if iso in done:
            continue
        if time.monotonic() > stop_at:
            out_of_time = True
            break
        urls = [NEW.format(ymd=d.strftime("%Y%m%d")),
                OLD.format(yyyy=d.strftime("%Y"), mon=d.strftime("%b").upper(), dd=d.strftime("%d"))]
        if iso < "2024-01-01":
            urls.reverse()
        body, gone = None, 0
        for u in urls:
            try:
                r = s.get(u, timeout=60)
            except requests.RequestException:
                continue
            if r.status_code == 200 and r.content[:2] == b"PK":
                body = r.content
                break
            if r.status_code == 404:
                gone += 1
        if body is None:
            if gone == len(urls):
                if d < today:                        # today's file appears in the evening
                    with con:
                        con.execute("INSERT OR REPLACE INTO optlab_days VALUES (?,?,NULL)", (iso, "missing"))
                miss += 1
            else:
                fail += 1
            continue
        try:
            rows, lot = lib.parse(body)
            keep = lib.select(rows)
        except Exception as e:  # noqa: BLE001 - one bad file must not stop the rest
            print(f"  {iso}: could not read ({type(e).__name__})")
            fail += 1
            continue
        if len(keep) < 20 or keep[0][0] != iso:
            with con:
                con.execute("INSERT OR REPLACE INTO optlab_days VALUES (?,?,NULL)", (iso, "empty"))
            miss += 1
            continue
        with con:
            con.executemany("INSERT OR REPLACE INTO nifty_opt VALUES (?,?,?,?,?,?,?,?,?)", keep)
            con.execute("INSERT OR REPLACE INTO optlab_days VALUES (?,?,?)", (iso, "ok", lot))
        ok += 1
        time.sleep(0.25)
    span = con.execute("SELECT MIN(date), MAX(date), COUNT(*) FROM optlab_days WHERE status='ok'").fetchone()
    con.close()
    print(f"  nifty options: {ok} day(s) read, {miss} not published (holiday or not yet), {fail} failed; "
          f"history {span[0]} to {span[1]}, {span[2]} days"
          + ("; stopped at the time limit - the rest next run" if out_of_time else "; complete"))


if __name__ == "__main__":
    main()
