"""Rscreener - a company's announcements, concall documents and credit ratings.

One announcements-API call per symbol returns full filing history; we keep:
  announcement_docs  the newest N of each kind with their PDF links: concall
                     transcripts, investor presentations ("ppt"), call
                     recordings ("rec") and credit-rating updates
  announcements      the newest ANN_KEEP announcements of every kind - the
                     company page's Announcements list (Recent / Important /
                     search) - each with NSE's category, its time and PDF, and
                     whether it is one of the kinds that move a share (results,
                     board outcomes, dividends, ratings, deals, orders, ...)

Usage:
  python fetch_announcement_docs.py --symbols @data/nse_symbols.txt [--max-age-hours 156]
"""
import argparse
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import budget

import nse_session

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
# Concall material comes in three kinds (screener.in shows them side by side):
# the presentation, the recording, the transcript.
PPT_RE = re.compile(r"investor presentation|earnings presentation|presentation", re.I)
REC_RE = re.compile(r"audio|video|recording|webcast|youtube|weblink|web link", re.I)
KEEP_PER_TYPE = 15
ANN_KEEP = 50
# NSE's own category ("desc") for the filings that matter to a shareholder.
IMPORTANT_RE = re.compile(
    r"financial result|outcome of board meeting|board meeting|dividend|bonus|split|buy ?back|rights|credit rating"
    r"|acquisition|amalgamation|merger|demerger|scheme of arrangement|bagging|receiving of orders|order|"
    r"resignation of (?:director|kmp)|change in (?:management|director)|auditor|insolvency|fraud|default"
    r"|press release|investor presentation|updates?$|general updates", re.I)
NOT_IMPORTANT_RE = re.compile(r"newspaper|trading window|certificate under|loss of share|duplicate share|esop|esos|esps"
                              r"|shareholders meeting|postal ballot|record date|copy of", re.I)


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", required=True)
    ap.add_argument("--sleep", type=float, default=0.5)
    ap.add_argument("--max-age-hours", type=float, default=0)
    # The nightly has always passed --limit to this script and this parser has
    # never accepted it, so every run died on argparse with exit 2 and the whole
    # source silently stopped refreshing. Found 8-Aug-2026 when guarded_fetch.sh
    # started failing the run on a bad invocation instead of shrugging at it.
    ap.add_argument("--limit", type=int, default=0,
                    help="fetch at most this many symbols this run (0 = no cap)")
    args = ap.parse_args()
    raw = (ROOT / args.symbols[1:]).read_text(encoding="utf-8") if args.symbols.startswith("@") else args.symbols
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]

    con = sqlite3.connect(DB, timeout=180)

    nse_session.requeue_amp(con, "anndocs_fetch_log")
    con.execute(
        "CREATE TABLE IF NOT EXISTS announcement_docs (symbol TEXT, doc_type TEXT, date TEXT, title TEXT, url TEXT)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS anndocs_fetch_log (symbol TEXT PRIMARY KEY, fetched_at TEXT, error TEXT)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS announcements (symbol TEXT, at TEXT, category TEXT, subject TEXT, url TEXT,"
        " important INTEGER)"
    )
    if args.max_age_hours > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=args.max_age_hours)).strftime("%Y-%m-%d %H:%M:%S")
        done = {r[0] for r in con.execute("SELECT symbol FROM anndocs_fetch_log WHERE error IS NULL AND fetched_at >= ?", (cutoff,)).fetchall()}
    else:
        done = {r[0] for r in con.execute("SELECT symbol FROM anndocs_fetch_log WHERE error IS NULL").fetchall()}
    symbols = [s for s in symbols if s not in done]
    if args.limit and len(symbols) > args.limit:
        # oldest first, never-fetched ahead of ever-fetched, so a nightly cap
        # rotates through the universe instead of re-reading the same names
        last = {r[0]: r[1] for r in con.execute(
            "SELECT symbol, fetched_at FROM anndocs_fetch_log").fetchall()}
        symbols.sort(key=lambda s: last.get(s) or "")
        print(f"  --limit {args.limit}: {len(symbols) - args.limit} symbols deferred to a later run")
        symbols = symbols[:args.limit]
    print(f"fetching announcement docs for {len(symbols)} symbols...")

    s = requests.Session()
    s.headers.update(HEADERS)
    try:
        s.get("https://www.nseindia.com", timeout=20)
    except Exception:
        pass

    ok = err = 0
    for i, sym in enumerate(symbols, 1):
        if budget.stop(i - 1, len(symbols)):
            break
        try:
            r = nse_session.get(s, API.format(sym=nse_session.q(sym)), timeout=30)
            rows = r.json()
            buckets: dict[str, list] = {"concall": [], "ppt": [], "rec": [], "rating": []}
            anns = []
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
                desc = (a.get("desc") or "").strip()
                try:
                    at = datetime.strptime(dt_raw.strip(), "%d-%b-%Y %H:%M:%S").strftime("%Y-%m-%d %H:%M")
                except ValueError:
                    at = iso
                subject = re.sub(r"^.{0,120}?has informed the exchange (?:about|regarding)\s*", "",
                                 " ".join((a.get("attchmntText") or desc).split()), flags=re.I).strip(" '\".")
                important = 1 if (IMPORTANT_RE.search(desc) and not NOT_IMPORTANT_RE.search(desc)
                                  and not re.search(r"newspaper|clipping", subject, re.I)) else 0
                anns.append((sym, at, desc[:80], (subject[:1].upper() + subject[1:])[:240], url, important))
                if REC_RE.search(text) and CONCALL_RE.search(text):
                    buckets["rec"].append((sym, "rec", iso, title, url))
                elif PPT_RE.search(text):
                    buckets["ppt"].append((sym, "ppt", iso, title, url))
                elif CONCALL_RE.search(text):
                    buckets["concall"].append((sym, "concall", iso, title, url))
                elif RATING_RE.search(text):
                    buckets["rating"].append((sym, "rating", iso, title, url))
            recs = []
            for typ, items in buckets.items():
                items.sort(key=lambda x: x[2], reverse=True)
                recs.extend(items[:KEEP_PER_TYPE])
            con.execute("DELETE FROM announcement_docs WHERE symbol=?", (sym,))
            con.executemany("INSERT INTO announcement_docs VALUES (?,?,?,?,?)", recs)
            anns.sort(key=lambda x: x[1], reverse=True)
            con.execute("DELETE FROM announcements WHERE symbol=?", (sym,))
            con.executemany("INSERT INTO announcements VALUES (?,?,?,?,?,?)", anns[:ANN_KEEP])
            con.execute("INSERT OR REPLACE INTO anndocs_fetch_log VALUES (?,?,?)", (sym, now_utc(), None))
            con.commit()
            ok += 1
            print(f"[{i}/{len(symbols)}] {sym}: {len(buckets['concall'])} concall, {len(buckets['ppt'])} ppt, "
                  f"{len(buckets['rec'])} rec, {len(buckets['rating'])} rating, {len(anns)} announcements (kept {len(recs)})")
        except Exception as e:  # noqa: BLE001
            err += 1
            con.execute("INSERT OR REPLACE INTO anndocs_fetch_log VALUES (?,?,?)", (sym, now_utc(), str(e)[:200]))
            con.commit()
            print(f"[{i}/{len(symbols)}] {sym}: ERROR {e}")
        time.sleep(args.sleep)
    print(f"done: {ok} ok, {err} errors")


if __name__ == "__main__":
    main()
