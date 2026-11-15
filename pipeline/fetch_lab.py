"""Rscreener - derivatives history for the Lab: ten years, daily.

Owner, 16-Nov-2026: "Build all" - more instruments, strategies and factors.
RESEARCH ONLY: nothing here places a trade. The plan puts F&O after Phase-3.

  NSE F&O bhavcopy (new and old layouts)  Nifty, Bank Nifty, Fin Nifty, Midcap
                                          Nifty and every F&O stock: options
                                          around the money, and futures
  BSE F&O bhavcopy                        Sensex options and futures (2024 on)
  NSE participant-wise open interest      FIIs' index-futures long share
  Yahoo chart endpoint                    Nifty, India VIX, S&P 500 daily levels

Tables
  lab_chain   (sym, date, data)        one packed record per instrument per day
                                       (optlab_lib.pack) - plain rows would be
                                       tens of millions
  lab_days    (src, date, status)      every source-date tried, once
  lab_lots    (sym, lot)               the newest lot size each file stated
  lab_fii     (date, long_pct)
  optlab_index (ticker, date, open, high, low, close)

Newest first, within --minutes: ten years fill over about two weeks of
nights, then three small files a night. Read-only toward the exchanges.

Usage:  python pipeline/fetch_lab.py [--years 10] [--minutes 15]
"""
import argparse
import json
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import nse_session
import optlab_lib as lib

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
ARCH = "https://nsearchives.nseindia.com"
NSE_NEW = ARCH + "/content/fo/BhavCopy_NSE_FO_0_0_0_{ymd}_F_0000.csv.zip"
NSE_OLD = ARCH + "/content/historical/DERIVATIVES/{yyyy}/{mon}/fo{dd}{mon}{yyyy}bhav.csv.zip"
BSE_NEW = "https://www.bseindia.com/download/Bhavcopy/Derivative/BhavCopy_BSE_FO_0_0_0_{ymd}_F_0000.CSV"
POI = ARCH + "/content/nsccl/fao_participant_oi_{dmy}.csv"
YAHOO = "https://query2.finance.yahoo.com/v8/finance/chart/{sym}?period1={p1}&period2={p2}&interval=1d"
INDEX = ("^NSEI", "^INDIAVIX", "^GSPC")
BSE_FROM = "2024-01-01"


def connect():
    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    con.execute("CREATE TABLE IF NOT EXISTS lab_chain (sym TEXT, date TEXT, data TEXT, PRIMARY KEY (sym, date))")
    con.execute("CREATE TABLE IF NOT EXISTS lab_days (src TEXT, date TEXT, status TEXT, PRIMARY KEY (src, date))")
    con.execute("CREATE TABLE IF NOT EXISTS lab_lots (sym TEXT PRIMARY KEY, lot INTEGER, seen TEXT)")
    con.execute("CREATE TABLE IF NOT EXISTS lab_fii (date TEXT PRIMARY KEY, long_pct REAL)")
    con.execute("CREATE TABLE IF NOT EXISTS optlab_index (ticker TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, "
                "PRIMARY KEY (ticker, date))")
    # The first version's Nifty-only tables: lab_chain holds the same and more.
    con.execute("DROP TABLE IF EXISTS nifty_opt")
    con.execute("DROP TABLE IF EXISTS optlab_days")
    return con


def fetch_index(con, years: int) -> None:
    s = requests.Session()
    s.headers.update({"User-Agent": nse_session.HEADERS["User-Agent"]})
    now = int(time.time())
    for sym in INDEX:
        try:
            r = s.get(YAHOO.format(sym=requests.utils.quote(sym), p1=now - int((years + 1.2) * 366 * 86400), p2=now), timeout=45)
            res = r.json()["chart"]["result"][0]
            q = res["indicators"]["quote"][0]
            off = res["meta"].get("gmtoffset", 19800)
            rows = []
            for i, ts in enumerate(res["timestamp"]):
                if q["close"][i] is None:
                    continue
                d = datetime.fromtimestamp(ts + off, timezone.utc).strftime("%Y-%m-%d")
                rows.append((sym, d, q["open"][i], q["high"][i], q["low"][i], q["close"][i]))
            with con:
                con.executemany("INSERT OR REPLACE INTO optlab_index VALUES (?,?,?,?,?,?)", rows)
            print(f"  {sym}: {len(rows)} days")
        except Exception as e:  # noqa: BLE001 - the chains still load; the page says what is missing
            print(f"  {sym}: not read ({type(e).__name__})")


def get(s, url: str):
    """(body, 'ok') | (None, 'missing') | (None, 'fail')."""
    try:
        r = s.get(url, timeout=60)
    except requests.RequestException:
        return None, "fail"
    if r.status_code == 404:
        return None, "missing"
    # BSE answers an unknown file with an HTML page and a 200.
    if r.status_code == 200 and not r.content[:200].lstrip().lower().startswith((b"<!doctype", b"<html")):
        return r.content, "ok"
    return None, "missing" if r.status_code == 200 else "fail"


def store_chains(con, src: str, iso: str, body: bytes) -> int:
    day, syms, lots = lib.parse(lib.read_csv(body))
    if day != iso:
        return 0
    rows = []
    for sym, rec in syms.items():
        # BSE's file also lists a few stock options, thinly traded; taken from
        # it they overwrote NSE's record of the same stock. Only the Sensex
        # comes from BSE.
        if src == "bse" and sym != "SENSEX":
            continue
        p = lib.pack(sym, day, rec)
        if p:
            rows.append((sym, day, json.dumps(p, separators=(",", ":"))))
    with con:
        con.executemany("INSERT OR REPLACE INTO lab_chain VALUES (?,?,?)", rows)
        con.executemany("INSERT INTO lab_lots VALUES (?,?,?) ON CONFLICT(sym) DO UPDATE SET lot=excluded.lot, seen=excluded.seen "
                        "WHERE excluded.seen >= lab_lots.seen",
                        [(k, v, day) for k, v in lots.items() if src != "bse" or k == "SENSEX"])
    return len(rows)


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
    done = {(src, d) for src, d in con.execute("SELECT src, date FROM lab_days")}
    tally = {"nse": [0, 0, 0], "bse": [0, 0, 0], "poi": [0, 0, 0]}   # read, not published, failed
    out_of_time = False

    def mark(src: str, iso: str, status: str, d) -> None:
        if status == "ok" or d < today:          # today's files appear in the evening
            with con:
                con.execute("INSERT OR REPLACE INTO lab_days VALUES (?,?,?)", (src, iso, status))

    for d in days:                               # newest first
        iso = d.isoformat()
        if all((src, iso) in done for src in ("nse", "poi")) and ((("bse", iso) in done) or iso < BSE_FROM):
            continue
        if time.monotonic() > stop_at:
            out_of_time = True
            break
        if ("nse", iso) not in done:
            urls = [NSE_NEW.format(ymd=d.strftime("%Y%m%d")),
                    NSE_OLD.format(yyyy=d.strftime("%Y"), mon=d.strftime("%b").upper(), dd=d.strftime("%d"))]
            if iso < "2024-01-01":
                urls.reverse()
            body, states = None, []
            for u in urls:
                body, st = get(s, u)
                states.append(st)
                if body:
                    break
            if body:
                try:
                    n = store_chains(con, "nse", iso, body)
                    mark("nse", iso, "ok" if n else "empty", d)
                    tally["nse"][0] += 1
                except Exception as e:  # noqa: BLE001 - one bad file must not stop the rest
                    print(f"  nse {iso}: could not read ({type(e).__name__})")
                    tally["nse"][2] += 1
            elif "fail" in states:
                tally["nse"][2] += 1
            else:
                mark("nse", iso, "missing", d)
                tally["nse"][1] += 1
        if iso >= BSE_FROM and ("bse", iso) not in done:
            body, st = get(s, BSE_NEW.format(ymd=d.strftime("%Y%m%d")))
            if body:
                try:
                    n = store_chains(con, "bse", iso, body)
                    mark("bse", iso, "ok" if n else "empty", d)
                    tally["bse"][0] += 1
                except Exception as e:  # noqa: BLE001
                    print(f"  bse {iso}: could not read ({type(e).__name__})")
                    tally["bse"][2] += 1
            elif st == "fail":
                tally["bse"][2] += 1
            else:
                mark("bse", iso, "missing", d)
                tally["bse"][1] += 1
        if ("poi", iso) not in done:
            body, st = get(s, POI.format(dmy=d.strftime("%d%m%Y")))
            if body:
                got = lib.fii_long_pct(body.decode("utf-8", "replace"))
                if got:
                    with con:
                        con.execute("INSERT OR REPLACE INTO lab_fii VALUES (?,?)", got)
                mark("poi", iso, "ok" if got else "empty", d)
                tally["poi"][0] += 1
            elif st == "fail":
                tally["poi"][2] += 1
            else:
                mark("poi", iso, "missing", d)
                tally["poi"][1] += 1
        time.sleep(0.2)
    span = con.execute("SELECT MIN(date), MAX(date), COUNT(DISTINCT date), COUNT(DISTINCT sym) FROM lab_chain").fetchone()
    con.close()
    for src, (ok, miss, fail) in tally.items():
        print(f"  {src}: {ok} file(s) read, {miss} not published, {fail} failed")
    print(f"  lab history: {span[0]} to {span[1]}, {span[2]} days, {span[3]} instruments"
          + ("; stopped at the time limit - the rest next run" if out_of_time else "; complete"))


if __name__ == "__main__":
    main()
