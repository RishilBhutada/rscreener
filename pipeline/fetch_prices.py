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
CHART = "https://query2.finance.yahoo.com/v8/finance/chart/{sym}.NS?range={rng}&interval={itv}"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
}


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def series(session: requests.Session, sym: str, rng: str, itv: str) -> list[tuple[str, float, float | None]]:
    """Yahoo chart API directly - yfinance's own session gets rate-limited here.
    Returns (date, close, volume) tuples."""
    r = session.get(CHART.format(sym=sym, rng=rng, itv=itv), timeout=25)
    r.raise_for_status()
    result = (r.json().get("chart", {}).get("result") or [None])[0]
    if not result:
        return []
    stamps = result.get("timestamp") or []
    quote = (result.get("indicators", {}).get("quote") or [{}])[0]
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    out = []
    for i, (ts, close) in enumerate(zip(stamps, closes)):
        if close is None:
            continue
        vol = volumes[i] if i < len(volumes) and volumes[i] is not None else None
        out.append((datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d"), round(float(close), 2), vol))
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
    con.execute("CREATE TABLE IF NOT EXISTS prices (symbol TEXT, freq TEXT, date TEXT, close REAL)")
    con.execute("CREATE TABLE IF NOT EXISTS prices_fetch_log (symbol TEXT PRIMARY KEY, fetched_at TEXT, error TEXT)")
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
            monthly = series(session, sym, "10y", "1mo")
            weekly = series(session, sym, "1y", "1wk")
            daily = series(session, sym, "2y", "1d")
            if not monthly and not weekly and not daily:
                raise ValueError("no price history returned")
            con.execute("DELETE FROM prices WHERE symbol=?", (sym,))
            con.executemany(
                "INSERT INTO prices VALUES (?,?,?,?,?)",
                [(sym, "monthly", d, c, v) for d, c, v in monthly]
                + [(sym, "weekly", d, c, v) for d, c, v in weekly]
                + [(sym, "daily", d, c, v) for d, c, v in daily],
            )
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
