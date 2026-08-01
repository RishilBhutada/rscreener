"""Rscreener - price history for company-page charts.

Per symbol: 10 years of monthly closes + 1 year of weekly closes (compact
enough to embed in the company JSONs; the live snapshot price becomes the
final chart point client-side).

Usage:
  python fetch_prices.py --symbols @data/top500.txt [--max-age-hours 156]
"""
import argparse
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
CHART = "https://query2.finance.yahoo.com/v8/finance/chart/{sym}.NS?range={rng}&interval={itv}&events=split"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
}


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


SPIKE = 2.5  # a bar this far above BOTH neighbours, then straight back, is a bad print


def drop_spikes(rows: list[tuple]) -> tuple[list[tuple], int]:
    """Remove single-bar price spikes that immediately revert.

    Yahoo's long history carries occasional corrupt prints - HDFC Bank's
    March-2006 monthly close comes back as 165.16 between neighbours of 38.71 and
    37.26: a 4x spike and a 4x collapse in consecutive months. Left in, it
    distorts the Max price chart and every ratio computed at that date. A real
    move does not reverse itself completely in one bar, so testing against BOTH
    neighbours leaves genuine crashes and rallies untouched.
    """
    if len(rows) < 3:
        return rows, 0
    keep, dropped = [rows[0]], 0
    for i in range(1, len(rows) - 1):
        prev, cur, nxt = rows[i - 1][4], rows[i][4], rows[i + 1][4]
        if prev and nxt and cur and cur / prev > SPIKE and cur / nxt > SPIKE:
            dropped += 1
            continue
        keep.append(rows[i])
    keep.append(rows[-1])
    return keep, dropped


def splits_of(session: requests.Session, sym: str) -> list[tuple[str, float]]:
    """Split/bonus events from Yahoo, as (date, ratio).

    Yahoo's prices are split-adjusted but as-filed EPS is not, so PE is wrong by
    the cumulative factor unless EPS is put on the same basis. A 1:1 bonus is
    reported here as a 2:1 split, so this one feed covers bonuses too.
    """
    ev = None
    for attempt in range(3):  # a silent [] here leaves EPS unadjusted and PE badly wrong
        try:
            r = session.get(CHART.format(sym=sym, rng="max", itv="1mo"), timeout=25)
            r.raise_for_status()
            result = (r.json().get("chart", {}).get("result") or [None])[0]
            ev = ((result or {}).get("events") or {}).get("splits") or {}
            break
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    if ev is None:
        raise RuntimeError("split events unavailable")
    out = []
    for v in ev.values():
        num, den = v.get("numerator"), v.get("denominator")
        if not num or not den:
            continue
        out.append((
            datetime.fromtimestamp(int(v["date"]), tz=timezone.utc).strftime("%Y-%m-%d"),
            float(num) / float(den),
        ))
    return sorted(out)


def series(session: requests.Session, sym: str, rng: str, itv: str) -> list[tuple]:
    """Yahoo chart API directly - yfinance's own session gets rate-limited here.
    Returns (date, open, high, low, close, volume) tuples (OHLC feed the
    Yang-Zhang volatility estimator; open/high/low may be None on gap rows)."""
    r = session.get(CHART.format(sym=sym, rng=rng, itv=itv), timeout=25)
    r.raise_for_status()
    result = (r.json().get("chart", {}).get("result") or [None])[0]
    if not result:
        return []
    stamps = result.get("timestamp") or []
    quote = (result.get("indicators", {}).get("quote") or [{}])[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    def at(arr, i):
        return round(float(arr[i]), 2) if i < len(arr) and arr[i] is not None else None

    out = []
    for i, (ts, close) in enumerate(zip(stamps, closes)):
        if close is None:
            continue
        vol = volumes[i] if i < len(volumes) and volumes[i] is not None else None
        out.append((
            datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d"),
            at(opens, i), at(highs, i), at(lows, i), round(float(close), 2), vol,
        ))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", required=True)
    ap.add_argument("--sleep", type=float, default=0.5)
    ap.add_argument("--max-age-hours", type=float, default=0)
    ap.add_argument("--refresh", action="store_true", help="re-fetch even if already done")
    args = ap.parse_args()
    raw = (ROOT / args.symbols[1:]).read_text(encoding="utf-8") if args.symbols.startswith("@") else args.symbols
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]

    con = sqlite3.connect(DB, timeout=180)
    con.execute("CREATE TABLE IF NOT EXISTS prices (symbol TEXT, freq TEXT, date TEXT, close REAL, volume REAL, open REAL, high REAL, low REAL)")
    have = {c[1] for c in con.execute("PRAGMA table_info(prices)").fetchall()}
    for col in ("volume", "open", "high", "low"):  # bring older DBs up to schema
        if col not in have:
            con.execute(f"ALTER TABLE prices ADD COLUMN {col} REAL")
    con.execute("CREATE TABLE IF NOT EXISTS prices_fetch_log (symbol TEXT PRIMARY KEY, fetched_at TEXT, error TEXT)")
    con.execute("CREATE TABLE IF NOT EXISTS splits (symbol TEXT, date TEXT, ratio REAL, PRIMARY KEY (symbol, date))")
    if args.refresh:
        done: set[str] = set()
    elif args.max_age_hours > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=args.max_age_hours)).strftime("%Y-%m-%d %H:%M:%S")
        done = {r[0] for r in con.execute("SELECT symbol FROM prices_fetch_log WHERE error IS NULL AND fetched_at >= ?", (cutoff,)).fetchall()}
    else:
        done = {r[0] for r in con.execute("SELECT symbol FROM prices_fetch_log WHERE error IS NULL").fetchall()}
    symbols = [s for s in symbols if s not in done]
    print(f"fetching prices for {len(symbols)} symbols...")

    session = requests.Session()
    session.headers.update(HEADERS)
    ok = err = 0
    for i, sym in enumerate(symbols, 1):
        try:
            # NOTE: Yahoo silently downgrades 1wk to monthly bars when range=max,
            # so weekly is requested with an explicit span.
            monthly, _sp = drop_spikes(series(session, sym, "max", "1mo"))  # ~30y, drives Max + bands
            weekly, _ = drop_spikes(series(session, sym, "5y", "1wk"))   # 3Yr/5Yr density
            daily = series(session, sym, "2y", "1d")       # 1M/6M/1Yr + DMA + volatility
            if not monthly and not weekly and not daily:
                raise ValueError("no price history returned")
            con.execute("DELETE FROM prices WHERE symbol=?", (sym,))
            con.executemany(
                "INSERT INTO prices (symbol,freq,date,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?,?)",
                [(sym, "monthly", d, o, h, l, c, v) for d, o, h, l, c, v in monthly]
                + [(sym, "weekly", d, o, h, l, c, v) for d, o, h, l, c, v in weekly]
                + [(sym, "daily", d, o, h, l, c, v) for d, o, h, l, c, v in daily],
            )
            sp = splits_of(session, sym)
            if sp:
                con.execute("DELETE FROM splits WHERE symbol=?", (sym,))
                con.executemany("INSERT OR REPLACE INTO splits VALUES (?,?,?)", [(sym, d, r) for d, r in sp])
            con.execute("INSERT OR REPLACE INTO prices_fetch_log VALUES (?,?,?)", (sym, now_utc(), None))
            con.commit()
            ok += 1
            print(f"[{i}/{len(symbols)}] {sym}: {len(monthly)}m + {len(weekly)}w + {len(daily)}d points")
        except Exception as e:  # noqa: BLE001
            err += 1
            con.execute("INSERT OR REPLACE INTO prices_fetch_log VALUES (?,?,?)", (sym, now_utc(), str(e)[:200]))
            con.commit()
            print(f"[{i}/{len(symbols)}] {sym}: ERROR {e}")
        time.sleep(args.sleep)
    print(f"done: {ok} ok, {err} errors")


if __name__ == "__main__":
    main()
