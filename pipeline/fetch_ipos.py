"""Rscreener - official IPO data from NSE.

Three official endpoints, all free and unauthenticated:
  /api/ipo-current-issue            open issues, with live subscription per category
  /api/all-upcoming-issues?...=ipo  announced, not yet open
  /api/public-past-issues           ~1,400 historical issues with listing dates

Subscription is stored as a DATED SNAPSHOT so the demand curve through the
bidding window is preserved, not just its final value.

Usage:
  python fetch_ipos.py
"""
import argparse
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

import db_lib

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
BASE = "https://www.nseindia.com"
EPS = {
    "current": f"{BASE}/api/ipo-current-issue",
    "upcoming": f"{BASE}/api/all-upcoming-issues?category=ipo",
    "past": f"{BASE}/api/public-past-issues",
}
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": f"{BASE}/market-data/all-upcoming-issues-ipo",
}


def iso(d: str | None) -> str | None:
    """'27-Jul-2026' / '24-JUL-2026' -> '2026-07-27'; '-' and junk -> None."""
    if not d or str(d).strip() in ("-", "", "NA"):
        return None
    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(d).strip().title(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def num(v) -> float | None:
    try:
        f = float(str(v).replace(",", ""))
        return f
    except (TypeError, ValueError):
        return None


def get_json(session, url: str, tries: int = 4):
    delay = 1.5
    last = None
    for attempt in range(tries):
        try:
            r = session.get(url, timeout=30)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < tries - 1:
                time.sleep(delay)
                delay *= 2
    raise last  # type: ignore[misc]


def rows_of(body) -> list[dict]:
    if isinstance(body, list):
        return body
    return (body or {}).get("data", []) or []


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-past", action="store_true", help="only refresh current+upcoming")
    args = ap.parse_args()

    s = requests.Session()
    s.headers.update(HEADERS)
    try:
        s.get(BASE, timeout=20)
    except Exception:
        pass

    con = db_lib.connect()
    db_lib.ensure(
        con,
        "CREATE TABLE IF NOT EXISTS ipos ("
        "symbol TEXT, company TEXT, phase TEXT, issue_start TEXT, issue_end TEXT, "
        "listing_date TEXT, price_band TEXT, issue_price TEXT, issue_size REAL, "
        "security_type TEXT, status TEXT, updated_at TEXT, PRIMARY KEY (symbol, issue_start))",
        "CREATE TABLE IF NOT EXISTS ipo_subscription ("
        "snapshot_date TEXT, symbol TEXT, category TEXT, shares_offered REAL, shares_bid REAL, "
        "times_subscribed REAL, fetched_at TEXT, PRIMARY KEY (snapshot_date, symbol, category))",
    )
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    today = now[:10]
    counts = {}

    # ---- current + upcoming -------------------------------------------------
    for phase in ("current", "upcoming"):
        try:
            rows = rows_of(get_json(s, EPS[phase]))
        except Exception as e:  # noqa: BLE001
            print(f"  {phase}: FAILED {str(e)[:70]}")
            continue
        seen = {}
        subs = []
        for r in rows:
            sym = (r.get("symbol") or "").strip().upper()
            if not sym:
                continue
            start = iso(r.get("issueStartDate"))
            seen[(sym, start)] = (
                sym, r.get("companyName") or r.get("company"), phase, start,
                iso(r.get("issueEndDate")), None, r.get("issuePrice"), None,
                num(r.get("issueSize")), r.get("series"), r.get("status"), now,
            )
            if r.get("noOfTime") is not None:
                subs.append((today, sym, (r.get("category") or "Total").strip(),
                             num(r.get("noOfSharesOffered")), num(r.get("noOfsharesBid")),
                             num(r.get("noOfTime")), now))
        db_lib.retry(lambda v=list(seen.values()): con.executemany(
            "INSERT OR REPLACE INTO ipos VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", v))
        if subs:
            db_lib.retry(lambda v=subs: con.executemany(
                "INSERT OR REPLACE INTO ipo_subscription VALUES (?,?,?,?,?,?,?)", v))
        counts[phase] = len(seen)
        counts[f"{phase}_subs"] = len(subs)
        time.sleep(0.4)

    # ---- past issues --------------------------------------------------------
    if not args.skip_past:
        try:
            rows = rows_of(get_json(s, EPS["past"]))
            out = {}
            for r in rows:
                sym = (r.get("symbol") or "").strip().upper()
                if not sym:
                    continue
                start = iso(r.get("ipoStartDate"))
                out[(sym, start)] = (
                    sym, r.get("company") or r.get("companyName"), "past", start,
                    iso(r.get("ipoEndDate")), iso(r.get("listingDate")),
                    r.get("priceRange"), r.get("issuePrice"), None,
                    r.get("securityType"), "Listed" if iso(r.get("listingDate")) else None, now,
                )
            db_lib.retry(lambda v=list(out.values()): con.executemany(
                "INSERT OR REPLACE INTO ipos VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", v))
            counts["past"] = len(out)
        except Exception as e:  # noqa: BLE001
            print(f"  past: FAILED {str(e)[:70]}")

    db_lib.retry(con.commit)
    total = con.execute("SELECT COUNT(*) FROM ipos").fetchone()[0]
    listed = con.execute("SELECT COUNT(*) FROM ipos WHERE listing_date IS NOT NULL").fetchone()[0]
    con.close()
    print(f"ipos: {counts} | table now {total} issues ({listed} with a listing date)")


if __name__ == "__main__":
    main()
