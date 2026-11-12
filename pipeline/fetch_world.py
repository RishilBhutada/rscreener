"""Rscreener - the world's stock markets, one daily close each.

Thirty index levels and five companions (VIX, the dollar index, the US 10-year
yield, Brent, USD/INR) from Yahoo's chart endpoint - the same open source the
Sensex and the COMEX contracts already come from. About 35 small requests,
under a minute. Prices only; nothing here is checked against an exchange's own
file, and the page says so.

Only sessions that have ENDED are stored (world_lib.finished): the nightly run
is at 22:00 IST, when New York is mid-session.

Usage:  python fetch_world.py [--days 420]
"""
import argparse
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import requests

import world_lib

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
YAHOO = "https://query2.finance.yahoo.com/v8/finance/chart/{sym}?period1={p1}&period2={p2}&interval=1d"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
SLEEP = 0.6


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB, timeout=180)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS world_bars (
            sym TEXT, date TEXT, close REAL, PRIMARY KEY (sym, date));
        CREATE TABLE IF NOT EXISTS world_meta (
            sym TEXT PRIMARY KEY, currency TEXT, tz TEXT, fetched_at TEXT);
    """)
    return con


def fetch(s: requests.Session, sym: str, days: int, now: int) -> tuple[list[tuple[str, float]], dict]:
    r = s.get(YAHOO.format(sym=quote(sym, safe=""), p1=now - days * 86400, p2=now), timeout=40)
    r.raise_for_status()
    res = (r.json().get("chart", {}).get("result") or [None])[0] or {}
    meta = res.get("meta") or {}
    closes = ((res.get("indicators", {}).get("quote") or [{}])[0]).get("close") or []
    return world_lib.finished(res.get("timestamp") or [], closes, meta, now), meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=420, help="how far back to read (a year, and a margin)")
    a = ap.parse_args()
    con = connect()
    s = requests.Session()
    s.headers["User-Agent"] = UA
    now = int(time.time())
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    ok, failed = 0, []
    for sym in [m[0] for m in world_lib.MARKETS] + [e[0] for e in world_lib.EXTRAS]:
        try:
            rows, meta = fetch(s, sym, a.days, now)
        except Exception as e:  # noqa: BLE001 - one market failing must not lose the rest
            failed.append(f"{sym} ({type(e).__name__})")
            time.sleep(SLEEP)
            continue
        if rows:
            con.executemany("INSERT OR REPLACE INTO world_bars (sym, date, close) VALUES (?,?,?)",
                            [(sym, d, c) for d, c in rows])
            con.execute("INSERT OR REPLACE INTO world_meta (sym, currency, tz, fetched_at) VALUES (?,?,?,?)",
                        (sym, meta.get("currency"), meta.get("exchangeTimezoneName"), stamp))
            con.commit()
            ok += 1
        else:
            failed.append(f"{sym} (no bars)")
        time.sleep(SLEEP)
    print(f"world markets: {ok} read" + (f"; not read: {', '.join(failed)}" if failed else ""))


if __name__ == "__main__":
    main()
