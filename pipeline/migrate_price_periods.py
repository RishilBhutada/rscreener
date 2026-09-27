"""One-time: re-date every stored weekly and monthly price row.

Rows written before pipeline/price_periods.py carry the old labels - each
period bar dated a day early in UTC, the latest session stored as an extra
bar, young listings' "monthly" rows as daily rows repeated up to seven times.
Prices are refreshed on a rotation, so waiting for every company to be
re-fetched would leave months of mixed conventions in one table. This rewrites
them all once, with the same folding the fetcher now uses.

Idempotent: it records itself in a `migrations` table and does nothing on any
later run. It must run before anything writes new-style rows, because a new
month-end label and an old day-early label are indistinguishable - which is
why it is the first step after the database is restored.

Usage:  python pipeline/migrate_price_periods.py [--db PATH]
"""

from __future__ import annotations

import argparse
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

from price_periods import fold, legacy_start_of

ROOT = Path(__file__).resolve().parents[1]
NAME = "price_periods_v1"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "data" / "rscreener.db"))
    args = ap.parse_args()
    if not Path(args.db).exists():
        print("no database - nothing to migrate")
        return
    con = sqlite3.connect(args.db, timeout=180)
    con.execute("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT)")
    if con.execute("SELECT 1 FROM migrations WHERE name=?", (NAME,)).fetchone():
        print(f"{NAME}: already applied")
        return
    if not con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='prices'").fetchone():
        print("no prices table - nothing to migrate")
        return

    # The latest real session per company: its daily series, where it has one.
    last_session = {s: date.fromisoformat(d) for s, d in
                    con.execute("SELECT symbol, MAX(date) FROM prices WHERE freq='daily' GROUP BY symbol")}
    before = dict(con.execute("SELECT freq, COUNT(*) FROM prices WHERE freq IN ('weekly','monthly') GROUP BY freq"))
    written = {"weekly": 0, "monthly": 0}
    for freq in ("weekly", "monthly"):
        cur_sym, bucket = None, []

        def flush() -> None:
            if cur_sym is None or not bucket:
                return
            dates = sorted({date.fromisoformat(r[0]) for r in bucket})
            start_of = legacy_start_of(freq, dates)
            # A session row (not a day-early label) is a real trading date too.
            cap = last_session.get(cur_sym)
            for d in dates:
                if start_of(d) <= d and (cap is None or d > cap):
                    cap = d
            rows = fold(bucket, freq, cap, start_of)
            con.execute("DELETE FROM prices WHERE symbol=? AND freq=?", (cur_sym, freq))
            con.executemany(
                "INSERT INTO prices (symbol,freq,date,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?,?)",
                [(cur_sym, freq, *r) for r in rows])
            written[freq] += len(rows)

        for sym, d, o, h, l, c, v in con.execute(
            "SELECT symbol, date, open, high, low, close, volume FROM prices WHERE freq=? ORDER BY symbol, date",
            (freq,)).fetchall():
            if sym != cur_sym:
                flush()
                cur_sym, bucket = sym, []
            bucket.append((d, o, h, l, c, v))
        flush()

    con.execute("INSERT INTO migrations VALUES (?, ?)", (NAME, datetime.now(timezone.utc).isoformat(timespec="seconds")))
    con.commit()
    con.close()
    for f in ("weekly", "monthly"):
        print(f"{NAME}: {f} {before.get(f, 0):,} rows -> {written[f]:,}")


if __name__ == "__main__":
    main()
