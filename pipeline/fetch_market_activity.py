"""Rscreener - the exchanges' daily market-activity files, stored.

Owner, 13-Nov-2026: "fetch all the data you said is worth bringing in".
  delivery      NSE sec_bhavdata_full     per stock per day: delivery %, VWAP, trades
  fo_oi         NSE F&O bhavcopy          per F&O stock per day: futures OI and its change, call / put OI
  participant   NSE participant-wise OI   per day: index & stock futures long/short by FII, DII, Pro, Client
  short_sell    NSE short-selling file    per stock per day: shares sold short
  fii_dii       NSE FII/DII cash report   per day: net buying, crore (NSE serves the latest day only,
                                          so history builds up one night at a time)
  surveillance  NSE ASM / GSM / F&O ban   replaced whole each run
  pledge        NSE pledge disclosures    replaced whole each run

The daily files are read for the last --days calendar days; a date already
stored is skipped and a holiday's 404 is not an error. History is kept for
400 days. A source that fails is reported and left as it was; the others
still run. Read-only toward the exchanges: nothing here is used to trade.
Parsing lives in market_activity_lib.py.

Usage:  python pipeline/fetch_market_activity.py [--days 7]
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
ARCH = "https://nsearchives.nseindia.com"
DAILY = {
    "delivery": ARCH + "/products/content/sec_bhavdata_full_{dmy}.csv",
    "fo_oi": ARCH + "/content/fo/BhavCopy_NSE_FO_0_0_0_{ymd}_F_0000.csv.zip",
    "participant": ARCH + "/content/nsccl/fao_participant_oi_{dmy}.csv",
    "short_sell": ARCH + "/archives/equities/shortSelling/shortselling_{dmy}.csv",
}
API = "https://www.nseindia.com/api/"
KEEP_DAYS = 400

SCHEMA = {
    "deliv": "CREATE TABLE IF NOT EXISTS deliv (symbol TEXT, date TEXT, vwap REAL, traded_qty REAL, trades REAL, "
             "deliv_qty REAL, deliv_pct REAL, PRIMARY KEY (symbol, date))",
    "fo_oi": "CREATE TABLE IF NOT EXISTS fo_oi (symbol TEXT, date TEXT, fut_oi REAL, fut_oi_chg REAL, call_oi REAL, "
             "put_oi REAL, PRIMARY KEY (symbol, date))",
    "participant_oi": "CREATE TABLE IF NOT EXISTS participant_oi (date TEXT, client TEXT, idx_fut_long REAL, "
                      "idx_fut_short REAL, stk_fut_long REAL, stk_fut_short REAL, PRIMARY KEY (date, client))",
    "short_sell": "CREATE TABLE IF NOT EXISTS short_sell (symbol TEXT, date TEXT, qty REAL, PRIMARY KEY (symbol, date))",
    "fii_dii": "CREATE TABLE IF NOT EXISTS fii_dii (date TEXT, who TEXT, buy REAL, sell REAL, net REAL, PRIMARY KEY (date, who))",
    "surveillance": "CREATE TABLE IF NOT EXISTS surveillance (symbol TEXT, list TEXT, stage TEXT, as_of TEXT, "
                    "PRIMARY KEY (symbol, list))",
    "pledge": "CREATE TABLE IF NOT EXISTS pledge (symbol TEXT PRIMARY KEY, shp_date TEXT, of_promoter REAL, "
              "of_total REAL, promoter_pct REAL, as_of TEXT)",
}
# which table each daily file fills, and the date column it is checked by
TARGET = {"delivery": "deliv", "fo_oi": "fo_oi", "participant": "participant_oi", "short_sell": "short_sell"}


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    for ddl in SCHEMA.values():
        con.execute(ddl)
    return con


def weekdays(n: int) -> list[date]:
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
    return [d for d in (today - timedelta(days=i) for i in range(n)) if d.weekday() < 5]


def fetch_daily(con, s: requests.Session, days: int) -> None:
    for kind, url in DAILY.items():
        table = TARGET[kind]
        have = {r[0] for r in con.execute(f"SELECT DISTINCT date FROM {table}")}
        got = miss = fail = 0
        for d in weekdays(days):
            iso = d.isoformat()
            # The short-selling file is dated the day it is published and
            # holds the previous session's trades: checked by the file date.
            if iso in have and kind != "short_sell":
                continue
            u = url.format(dmy=d.strftime("%d%m%Y"), ymd=d.strftime("%Y%m%d"))
            try:
                r = s.get(u, timeout=60)
            except requests.RequestException:
                fail += 1
                continue
            if r.status_code == 404:
                miss += 1          # a holiday, or not published yet
                continue
            if r.status_code != 200:
                fail += 1
                continue
            try:
                if kind == "delivery":
                    rows = lib.delivery(r.text)
                    sql = "INSERT OR REPLACE INTO deliv VALUES (?,?,?,?,?,?,?)"
                elif kind == "fo_oi":
                    rows = lib.fo_oi(r.content)
                    sql = "INSERT OR REPLACE INTO fo_oi VALUES (?,?,?,?,?,?)"
                elif kind == "participant":
                    rows = lib.participant(r.text)
                    sql = "INSERT OR REPLACE INTO participant_oi VALUES (?,?,?,?,?,?)"
                else:
                    rows = lib.short_sell(r.text)
                    sql = "INSERT OR REPLACE INTO short_sell VALUES (?,?,?)"
            except Exception as e:  # noqa: BLE001 - one bad file must not stop the rest
                print(f"  {kind} {iso}: could not read ({type(e).__name__})")
                fail += 1
                continue
            with con:
                con.executemany(sql, rows)
            got += 1
            time.sleep(0.4)
        print(f"  {kind}: {got} new day(s), {miss} not published (holiday or not yet), {fail} failed")


def fetch_snapshots(con) -> None:
    s = nse_session.new_session()
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    try:
        rows = lib.fii_dii(nse_session.get(s, API + "fiidiiTradeReact").json())
        with con:
            con.executemany("INSERT OR REPLACE INTO fii_dii VALUES (?,?,?,?,?)", rows)
        print(f"  fii_dii: {len(rows)} row(s) for {sorted({r[0] for r in rows})}")
    except Exception as e:  # noqa: BLE001
        print(f"  fii_dii: failed ({type(e).__name__}) - kept what was stored")

    try:
        asm = nse_session.get(s, API + "reportASM").json()
        gsm = nse_session.get(s, API + "reportGSM").json()
        ban = s.get(ARCH + "/content/fo/fo_secban.csv", timeout=60).text
        rows = lib.surveillance(asm, gsm, ban)
        # An empty answer is not "no stock is under surveillance".
        if len(rows) >= 20:
            with con:
                con.execute("DELETE FROM surveillance")
                con.executemany("INSERT OR REPLACE INTO surveillance VALUES (?,?,?,?)", [(*r, stamp) for r in rows])
        print(f"  surveillance: {len(rows)} listing(s)" + ("" if len(rows) >= 20 else " - too few, kept the last list"))
    except Exception as e:  # noqa: BLE001
        print(f"  surveillance: failed ({type(e).__name__}) - kept the last list")

    try:
        names = {sym: nm for sym, nm in con.execute('SELECT SYMBOL, "NAME OF COMPANY" FROM universe')}
        rows, missed = lib.pledge(nse_session.get(s, API + "corporate-pledgedata?index=equities", timeout=60).json(), names)
        if len(rows) >= 200:
            with con:
                con.execute("DELETE FROM pledge")
                con.executemany("INSERT OR REPLACE INTO pledge VALUES (?,?,?,?,?,?)", [(*r, stamp) for r in rows])
        print(f"  pledge: {len(rows)} companies matched, {len(missed)} names matched no symbol"
              + ("" if len(rows) >= 200 else " - too few, kept the last list"))
    except Exception as e:  # noqa: BLE001
        print(f"  pledge: failed ({type(e).__name__}) - kept the last list")


def prune(con) -> None:
    cut = (date.today() - timedelta(days=KEEP_DAYS)).isoformat()
    with con:
        for t in ("deliv", "fo_oi", "participant_oi", "short_sell", "fii_dii"):
            con.execute(f"DELETE FROM {t} WHERE date < ?", (cut,))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7, help="calendar days of daily files to read back")
    a = ap.parse_args()
    con = connect()
    s = requests.Session()
    s.headers.update(nse_session.HEADERS)
    fetch_daily(con, s, a.days)
    fetch_snapshots(con)
    prune(con)
    con.close()


if __name__ == "__main__":
    main()
