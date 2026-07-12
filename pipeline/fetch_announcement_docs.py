"""Rscreener - concall transcripts & credit-rating documents per company.

One announcements-API call per symbol returns full filing history; we keep the
newest N concall/transcript and credit-rating items with their PDF links.

Usage:
  python fetch_announcement_docs.py --symbols @data/top500.txt [--max-age-hours 156]
"""
import argparse
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
API = "https://www.nseindia.com/api/corporate-announcements?index=equities&symbol={sym}"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}
CONCALL_RE = re.compile(r"transcript|con\.? ?call|concall|analyst|investor meet|earnings call", re.I)
RATING_RE = re.compile(r"credit rating", re.I)
KEEP_PER_TYPE = 15


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", required=True)
    ap.add_argument("--sleep", type=float, default=0.5)
    ap.add_argument("--max-age-hours", type=float, default=0)
    args = ap.parse_args()
    raw = (ROOT / args.symbols[1:]).read_text(encoding="utf-8") if args.symbols.startswith("@") else args.symbols
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]

    con = sqlite3.connect(DB, timeout=180)
    con.execute(
        "CREATE TABLE IF NOT EXISTS announcement_docs (symbol TEXT, doc_type TEXT, date TEXT, title TEXT, url TEXT)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS anndocs_fetch_log (symbol TEXT PRIMARY KEY, fetched_at TEXT, error TEXT)"
    )
    if args.max_age_hours > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=args.max_age_hours)).strftime("%Y-%m-%d %H:%M:%S")
        done = {r[0] for r in con.execute("SELECT symbol FROM anndocs_fetch_log WHERE error IS NULL AND fetched_at >= ?", (cutoff,)).fetchall()}
    else:
        done = {r[0] for r in con.execute("SELECT symbol FROM anndocs_fetch_log WHERE error IS NULL").fetchall()}
    symbols = [s for s in symbols if s not in done]
    print(f"fetching announcement docs for {len(symbols)} symbols...")

    s = requests.Session()
    s.headers.update(HEADERS)
    try:
        s.get("https://www.nseindia.com", timeout=20)
    except Exception:
        pass

    ok = err = 0
    for i, sym in enumerate(symbols, 1):
        try:
            r = s.get(API.format(sym=sym), timeout=30)
            r.raise_for_status()
            rows = r.json()
            buckets: dict[str, list] = {"concall": [], "rating": []}
            for a in rows:
                text = f"{a.get('desc', '')} {a.get('attchmntText', '')}"
                url = a.get("attchmntFile")
                dt_raw = a.get("an_dt") or ""
                if not url:
                    continue
                try:
                    iso = datetime.strptime(dt_raw.split(" ")[0], "%d-%b-%Y").strftime("%Y-%m-%d")
                except (ValueError, IndexError):
                    continue
                title = (a.get("attchmntText") or a.get("desc") or "")[:140]
                if CONCALL_RE.search(text):
                    buckets["concall"].append((sym, "concall", iso, title, url))
                elif RATING_RE.search(text):
                    buckets["rating"].append((sym, "rating", iso, title, url))
            recs = []
            for typ, items in buckets.items():
                items.sort(key=lambda x: x[2], reverse=True)
                recs.extend(items[:KEEP_PER_TYPE])
            con.execute("DELETE FROM announcement_docs WHERE symbol=?", (sym,))
            con.executemany("INSERT INTO announcement_docs VALUES (?,?,?,?,?)", recs)
            con.execute("INSERT OR REPLACE INTO anndocs_fetch_log VALUES (?,?,?)", (sym, now_utc(), None))
            con.commit()
            ok += 1
            print(f"[{i}/{len(symbols)}] {sym}: {len(buckets['concall'])} concall, {len(buckets['rating'])} rating (kept {len(recs)})")
        except Exception as e:  # noqa: BLE001
            err += 1
            con.execute("INSERT OR REPLACE INTO anndocs_fetch_log VALUES (?,?,?)", (sym, now_utc(), str(e)[:200]))
            con.commit()
            print(f"[{i}/{len(symbols)}] {sym}: ERROR {e}")
        time.sleep(args.sleep)
    print(f"done: {ok} ok, {err} errors")


if __name__ == "__main__":
    main()
