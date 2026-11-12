"""Rscreener - web/public/world.json: the world's markets for the World page.

Each market's last finished close, its own date, and its change over a day, a
week, a month and a year, in its own currency; India's two headline indices
from the index table beside them; and five companions (VIX, dollar index, US
10-year yield, Brent, USD/INR).

Written even when nothing has been fetched yet, so the page can say so.

Usage:  python export_world_json.py
"""
import json
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

import world_lib
from export_indices_json import sym_of

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "world.json"
INDIA = [("Nifty 50", "Nifty 50"), ("SENSEX", "Sensex")]
# A market not read for this long is left off rather than shown as current.
STALE_DAYS = 12


def has(con: sqlite3.Connection, table: str) -> bool:
    return bool(con.execute("SELECT 1 FROM sqlite_master WHERE name=?", (table,)).fetchone())


def main() -> None:
    con = sqlite3.connect(DB, timeout=180)
    items, extras, india = [], [], []
    newest = None
    if has(con, "world_bars"):
        cur = dict(con.execute("SELECT sym, currency FROM world_meta"))
        newest = con.execute("SELECT MAX(date) FROM world_bars").fetchone()[0]

        def rows_of(sym: str) -> list[tuple[str, float]]:
            return con.execute("SELECT date, close FROM world_bars WHERE sym=? ORDER BY date", (sym,)).fetchall()

        def fresh(m: dict) -> bool:
            return bool(m) and (date.fromisoformat(newest) - date.fromisoformat(m["date"])).days <= STALE_DAYS

        for sym, name, country, region in world_lib.MARKETS:
            m = world_lib.moves(rows_of(sym))
            if fresh(m):
                items.append({"s": sym, "name": name, "country": country, "region": region, "cur": cur.get(sym), **m})
        for sym, name, what, absolute in world_lib.EXTRAS:
            m = world_lib.moves(rows_of(sym), absolute)
            if fresh(m):
                extras.append({"s": sym, "name": name, "what": what, "abs": absolute, **m})
    if has(con, "idx_bars"):
        for stored, name in INDIA:
            rows = con.execute(
                "SELECT date, close FROM idx_bars WHERE name=? AND close IS NOT NULL "
                "AND date >= date((SELECT MAX(date) FROM idx_bars WHERE name=?), '-420 days') ORDER BY date",
                (stored, stored)).fetchall()
            m = world_lib.moves(rows)
            if m:
                india.append({"s": sym_of(stored), "name": name, "country": "India", "region": "India",
                              "cur": "INR", "page": True, **m})
    regions = [r for r in world_lib.REGIONS if any(x["region"] == r for x in india + items)]
    OUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "asof": newest, "regions": regions, "items": india + items, "extras": extras,
    }, separators=(",", ":"), allow_nan=False, ensure_ascii=False), encoding="utf-8")
    print(f"world: {len(items)} markets, {len(india)} Indian, {len(extras)} companions, newest close {newest}")


if __name__ == "__main__":
    main()
