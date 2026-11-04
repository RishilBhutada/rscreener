"""Rscreener - MCX commodity futures: every live contract, every expiry, and
the world contract each one follows.

Sources, all open, none needing a login:
  - Upstox's public instrument file for MCX - every live futures contract
    with its expiry, lot and quoted unit - and Upstox's public daily-candle
    API for each contract's open, high, low, close, volume and open interest
    over its whole life. These are MCX's own trades, passed on by a broker.
  - Yahoo for the matching CME contract (COMEX gold December for MCX gold
    December, NYMEX crude November for MCX crude October...) and for USD/INR.

Not here, on purpose:
  - MCX's and NCDEX's own websites. Both sit behind bot checks that refuse
    anything but a real browser. Getting past a bot check is not something
    this pipeline does, so NCDEX is absent until an open source carries it.
  - Expired contracts' histories. Upstox's open candles cover live contracts
    only, so the store starts with each live contract's life (gold's furthest
    back: about a year) and every contract is KEPT after it expires - the
    history grows by a day a night from here and never shrinks.

The nightly run starts at 22:00 IST, while MCX is still trading, so the day
in progress is never stored: the newest bar kept is yesterday's. The last ten
days are re-read every night, so a late correction replaces what was stored.

Usage:
  python fetch_commodities.py [--sleep 0.15]      (about a minute)
"""
import argparse
import gzip
import json
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import budget
from commodities_lib import FX, WORLD, world_front, world_ticker
from fetch_etfs import HEADERS, yahoo_bars

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
INSTRUMENTS = "https://assets.upstox.com/market-quote/instruments/exchange/MCX.json.gz"
CANDLES = "https://api.upstox.com/v2/historical-candle/{key}/day/{to}/{frm}"
IST = timezone(timedelta(hours=5, minutes=30))
REFETCH_DAYS = 10
# How far back a first read reaches. Upstox refuses a range of more than about
# ten years ("Invalid date range"), and no MCX contract lives half that long.
FIRST_READ_DAYS = 3000


def schema(con: sqlite3.Connection) -> None:
    con.executescript("""
        CREATE TABLE IF NOT EXISTS commodity_contracts (
            key TEXT PRIMARY KEY, exchange TEXT, root TEXT, expiry TEXT,
            mult REAL, lot INTEGER, tick REAL, unit TEXT, symbol TEXT,
            first_seen TEXT, last_seen TEXT);
        CREATE TABLE IF NOT EXISTS commodity_bars (
            key TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL,
            volume INTEGER, oi INTEGER, PRIMARY KEY (key, date));
        CREATE TABLE IF NOT EXISTS commodity_world (
            ticker TEXT, date TEXT, close REAL, PRIMARY KEY (ticker, date));
    """)


def load_contracts(session: requests.Session, con: sqlite3.Connection, today: str) -> list[str]:
    """Record every live MCX futures contract. Add-only: a contract that has
    expired keeps its row, which is how its history stays findable."""
    r = session.get(INSTRUMENTS, timeout=60)
    r.raise_for_status()
    rows = json.loads(gzip.decompress(r.content))
    live = []
    for d in rows:
        if d.get("segment") != "MCX_FO" or d.get("instrument_type") != "FUT":
            continue
        expiry = datetime.fromtimestamp(d["expiry"] / 1000, IST).date().isoformat()
        key = d["instrument_key"]
        con.execute("""
            INSERT INTO commodity_contracts VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(key) DO UPDATE SET last_seen=excluded.last_seen, mult=excluded.mult,
                lot=excluded.lot, tick=excluded.tick, unit=excluded.unit, symbol=excluded.symbol""",
            (key, "MCX", d.get("asset_symbol") or d["name"], expiry, d.get("qty_multiplier"), d.get("lot_size"),
             (d.get("tick_size") or 0) / 100, d.get("price_quote_unit"), d.get("trading_symbol"), today, today))
        live.append(key)
    con.commit()
    if len(live) < 50:
        raise ValueError(f"only {len(live)} MCX futures in the instrument file - refusing to treat that as the market")
    print(f"MCX: {len(live)} live futures contracts")
    return live


def load_bars(session: requests.Session, con: sqlite3.Connection, live: list[str], today: str, sleep: float) -> None:
    """Daily bars per live contract: its whole life the first time, the last
    ten days after that. An expired contract is not asked for: Upstox's
    public candle API answers HTTP 400 for every expired key (all 16 of the
    late-September expiries, every run from 30-Sep-2026), so a contract's
    last bar is the day before its expiry day."""
    keys = live
    last = dict(con.execute("SELECT key, MAX(date) FROM commodity_bars GROUP BY key"))
    ok = empty = bad = 0
    for i, key in enumerate(keys):
        if budget.stop(i, len(keys), "commodity contracts"):
            break
        frm = (datetime.fromisoformat(today) - timedelta(days=FIRST_READ_DAYS)).date().isoformat()
        if last.get(key):
            frm = (datetime.fromisoformat(last[key]) - timedelta(days=REFETCH_DAYS)).date().isoformat()
        try:
            r = session.get(CANDLES.format(key=requests.utils.quote(key, safe=""), to=today, frm=frm), timeout=30)
            r.raise_for_status()
            candles = (r.json().get("data") or {}).get("candles") or []
            rows = [(key, c[0][:10], c[1], c[2], c[3], c[4], int(c[5] or 0), int(c[6] or 0))
                    for c in candles if c[0][:10] < today and c[4] and c[4] > 0]
            if rows:
                con.executemany("INSERT OR REPLACE INTO commodity_bars VALUES (?,?,?,?,?,?,?,?)", rows)
                ok += 1
            else:
                empty += 1
        except Exception as e:  # noqa: BLE001 - one contract's failure is that contract's
            bad += 1
            print(f"  {key}: FAILED - {e}")
        if i % 25 == 0:
            con.commit()
        time.sleep(sleep)
    con.commit()
    print(f"bars: {ok} contracts updated, {empty} with no trades in the window, {bad} failed")


def load_world(session: requests.Session, con: sqlite3.Connection, sleep: float) -> None:
    """The matching CME contract for every live MCX contract that has one,
    the rolling front month for the long view, and USD/INR."""
    live = con.execute("""SELECT root, expiry FROM commodity_contracts WHERE exchange='MCX'
        AND last_seen = (SELECT MAX(last_seen) FROM commodity_contracts WHERE exchange='MCX')""").fetchall()
    months = sorted({t for r, e in live if (t := world_ticker(r, e))})
    fronts = sorted({world_front(r) for r in WORLD})
    for i, (t, rng) in enumerate([(FX, "5y")] + [(t, "5y") for t in fronts] + [(t, "2y") for t in months]):
        if budget.stop(i, len(months) + len(fronts) + 1, "world contracts"):
            break
        try:
            rows = [(t, d, c) for d, _o, _h, _l, c, _v in yahoo_bars(session, t, rng)]
            if rows:
                con.executemany("INSERT OR REPLACE INTO commodity_world VALUES (?,?,?)", rows)
                con.commit()
            print(f"  {t}: {len(rows)} days" + (f" to {rows[-1][1]}" if rows else " - Yahoo has none"))
        except Exception as e:  # noqa: BLE001 - a month Yahoo does not list is simply absent
            print(f"  {t}: none - {e}")
        time.sleep(sleep)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sleep", type=float, default=0.15)
    args = ap.parse_args()
    today = datetime.now(IST).date().isoformat()
    con = sqlite3.connect(DB, timeout=180)
    schema(con)
    session = requests.Session()
    session.headers.update({**HEADERS, "Accept": "application/json"})
    live = load_contracts(session, con, today)
    load_bars(session, con, live, today, args.sleep)
    load_world(session, con, 0.3)
    n = con.execute("SELECT COUNT(*), MAX(date) FROM commodity_bars").fetchone()
    print(f"stored: {n[0]} contract-days, newest {n[1]}")
    con.close()


if __name__ == "__main__":
    main()
