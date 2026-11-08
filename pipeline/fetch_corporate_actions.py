"""Rscreener - dividends, bonuses, splits, rights and the rest, from NSE.

The exchange publishes every corporate action against the EX-DATE it takes
effect, which is the date that matters on a chart: it is the day the price
adjusts, and the day by which you had to already hold the share to receive
anything.

This also corrects something the app already had wrong. The `splits` table comes
from Yahoo, which files Reliance's 28-Oct-2024 one-for-one BONUS as a "2:1
split". The two are economically similar and legally different, and NSE labels
them correctly - so this feed is both new information and a fix.

Usage:
  python fetch_corporate_actions.py --symbols @data/all_symbols.txt [--max-age-hours 336]
"""
import argparse
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import budget

import nse_session

from db_lib import retry as db_retry

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
API = "https://www.nseindia.com/api/corporates-corporateActions?index=equities&symbol={sym}"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Referer": "https://www.nseindia.com/",
}

# Order matters. "Annual General Meeting/Dividend - Rs 6.50 Per Share" is a
# dividend, not a meeting, so the specific kinds are tested before the fallback.
KINDS: list[tuple[str, re.Pattern]] = [
    ("bonus", re.compile(r"\bbonus\b", re.I)),
    ("split", re.compile(r"\bsplit\b|sub-?division|face\s*value", re.I)),
    ("rights", re.compile(r"\brights\b", re.I)),
    ("buyback", re.compile(r"buy\s*-?\s*back", re.I)),
    ("dividend", re.compile(r"\bdividend\b", re.I)),
]

AMOUNT = re.compile(r"(?:rs\.?|inr|₹)\s*([\d]+(?:\.\d+)?)", re.I)   # Rs 6 · Rs. 9.50 · Rs 10.50/-
RATIO = re.compile(r"(\d+)\s*:\s*(\d+)")                                  # 1:1 · 1:15


def dividend_detail(s: str) -> str | None:
    """The amount per share, counting every dividend the announcement names.

    Only the first amount was read, so "Interim Dividend - Rs 8 Per Share
    Special Dividend - Rs 67 Per Share" (TCS, Jan 2023) was drawn as a ₹8
    dividend - 231 of 15,899 dividend announcements name two amounts. They are
    now added up, unless the wording says one INCLUDES the other ("Rs 8.50 Per
    Share (Including Special Dividend Of Rs 2)"), where adding would double it.
    """
    amounts = AMOUNT.findall(s)
    if not amounts:
        return None
    if len(amounts) == 1 or re.search(r"\bincl(?:uding|usive|\.)?\b", s, re.I):
        return f"₹{amounts[0]}"
    total = sum(float(a) for a in amounts)
    txt = f"{total:.2f}".rstrip("0").rstrip(".")
    return f"₹{txt} ({' + '.join('₹' + a for a in amounts)})"


# "Fv Split Rs.10/- To Re.1/", "Face Value Split (Sub-Division) - From Rs 10/-
# Per Share To Rs 2/- Per Share": NSE writes a split as the face value before
# and after, never as "a:b", so all 477 stored splits had no ratio (review
# 4-Nov-2026).
FACE_VALUE = re.compile(r"(?:rs\.?|re\.?|₹)\s*(\d+(?:\.\d+)?)\s*/?-?\s*(?:per\s+share\s*)?to\s*"
                        r"(?:rs\.?|re\.?|₹)\s*(\d+(?:\.\d+)?)", re.I)


def split_detail(subject: str) -> str | None:
    """"Face value ₹10 → ₹1" for a split, plus the dividend when the same
    notice declares one (13 stored notices did, and lost the amount)."""
    s = subject or ""
    m = RATIO.search(s)
    fv = FACE_VALUE.search(s)
    if fv:
        out = f"Face value ₹{fv.group(1)} → ₹{fv.group(2)}"
    elif m:
        out = f"{m.group(1)}:{m.group(2)}"
    else:
        return None
    if re.search(r"\bdividend\b", s, re.I):
        div = dividend_detail(re.split(r"face\s*value|\bsplit\b|sub-?division|\bbonus\b", s, flags=re.I)[0])
        if div:
            out += f" · dividend {div}"
    return out


# What changes the number of shares - the events a price series cannot be
# compared across. "other" is not one of them: of 8,872 stored "other"
# actions, 7,707 are Annual General Meetings (and 305 "AGM"), mostly in
# July-September, and treating them as reshaping dropped those quarters from
# every price season and blanked results moves on the calendar (review
# 4-Nov-2026). Only these "other" subjects reshape.
RESHAPING_OTHER = re.compile(
    r"demerg|amalgamat|scheme\s+of\s+arrangement|capital\s+reduction|reduction\s+(?:of|in)\s+(?:share\s+)?capital|"
    r"consolidation\s+of\s+(?:equity\s+)?shares|share\s+consolidation", re.I)


def reshapes(kind: str | None, subject: str | None) -> bool:
    """Whether a corporate action changes what one share is."""
    if kind in ("bonus", "split", "rights"):
        return True
    return kind == "other" and bool(RESHAPING_OTHER.search(subject or ""))


def classify(subject: str) -> tuple[str, str | None]:
    """(kind, short detail) for a corporate-action subject line."""
    s = (subject or "").strip()
    for kind, rx in KINDS:
        if rx.search(s):
            if kind == "dividend":
                return kind, dividend_detail(s)
            if kind == "split":
                return kind, split_detail(s)
            if kind in ("bonus", "rights"):
                m = RATIO.search(s)
                return kind, (f"{m.group(1)}:{m.group(2)}" if m else None)
            return kind, None
    return "other", (s[:40] or None)


def iso(d: str | None) -> str | None:
    """'28-Oct-2024' -> '2024-10-28'."""
    if not d:
        return None
    head = str(d).strip()
    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(head, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", required=True, help="comma list, or @path")
    ap.add_argument("--sleep", type=float, default=0.25)
    ap.add_argument("--max-age-hours", type=float, default=0.0)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    raw = (ROOT / args.symbols[1:]).read_text(encoding="utf-8") if args.symbols.startswith("@") else args.symbols
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]

    con = sqlite3.connect(DB, timeout=180)

    nse_session.requeue_amp(con, "ca_fetch_log")
    con.execute("PRAGMA busy_timeout=180000")
    db_retry(lambda: con.execute(
        "CREATE TABLE IF NOT EXISTS corporate_actions "
        "(symbol TEXT, ex_date TEXT, kind TEXT, detail TEXT, subject TEXT, "
        "PRIMARY KEY (symbol, ex_date, subject))"
    ))
    db_retry(lambda: con.execute(
        "CREATE TABLE IF NOT EXISTS ca_fetch_log "
        "(symbol TEXT PRIMARY KEY, fetched_at TEXT, error TEXT, n INTEGER)"
    ))
    log = {r[0]: r[1] for r in con.execute("SELECT symbol, fetched_at FROM ca_fetch_log WHERE error IS NULL")}
    if args.max_age_hours > 0:
        cut = (datetime.now(timezone.utc) - timedelta(hours=args.max_age_hours)).strftime("%Y-%m-%d %H:%M:%S")
        due = [s for s in symbols if log.get(s, "") < cut]
    else:
        due = [s for s in symbols if s not in log]
    due.sort(key=lambda s: log.get(s) or "")
    if args.limit:
        due = due[:args.limit]
    print(f"corporate actions for {len(due)} symbols...", flush=True)

    session = requests.Session()
    session.headers.update(HEADERS)
    try:
        session.get("https://www.nseindia.com/", timeout=20)   # cookie
    except Exception:  # noqa: BLE001
        pass

    import time
    ok = err = 0
    for i, sym in enumerate(due, 1):
        if budget.stop(i - 1, len(due)):
            break
        try:
            body = nse_session.get(session, API.format(sym=nse_session.q(sym)), timeout=30).json()
            rows = body if isinstance(body, list) else (body.get("data") or [])
            out = []
            for r in rows:
                ex = iso(r.get("exDate"))
                subj = (r.get("subject") or "").strip()
                if not ex or not subj:
                    continue
                kind, detail = classify(subj)
                out.append((sym, ex, kind, detail, subj))

            def _write(rows_in=out, s=sym):
                if rows_in:
                    # NSE's answer is the truth for the dates it covers. A row it
                    # no longer lists there - an ex-date or subject NSE corrected -
                    # is removed, not kept beside the corrected one: 17 such pairs
                    # were stored twice (review pipeline-core #17).
                    # Its list runs from its earliest date to the newest -
                    # upcoming ones included - so everything stored from that
                    # earliest date on is covered; older history is left alone.
                    lo = min(r[1] for r in rows_in)
                    keep = {(r[1], r[4]) for r in rows_in}
                    stale = [(s, ex, subj) for ex, subj in con.execute(
                        "SELECT ex_date, subject FROM corporate_actions WHERE symbol=? AND ex_date >= ?",
                        (s, lo)) if (ex, subj) not in keep]
                    if stale:
                        con.executemany("DELETE FROM corporate_actions WHERE symbol=? AND ex_date=? AND subject=?", stale)
                    con.executemany("INSERT OR REPLACE INTO corporate_actions VALUES (?,?,?,?,?)", rows_in)
                con.execute("INSERT OR REPLACE INTO ca_fetch_log VALUES (?,?,?,?)",
                            (s, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), None, len(rows_in)))
                con.commit()
            db_retry(_write)
            ok += 1
            print(f"[{i}/{len(due)}] {sym}: {len(out)} actions", flush=True)
        except Exception as e:  # noqa: BLE001
            err += 1

            def _log(s=sym, msg=str(e)[:200]):
                con.execute("INSERT OR REPLACE INTO ca_fetch_log VALUES (?,?,?,?)",
                            (s, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), msg, 0))
                con.commit()
            db_retry(_log)
            print(f"[{i}/{len(due)}] {sym}: ERROR {e}", flush=True)
        time.sleep(args.sleep)
    print(f"done: {ok} ok, {err} errors")
    con.close()


if __name__ == "__main__":
    main()
