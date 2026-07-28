"""Rscreener - daily Grey Market Premium (GMP) snapshots.

GMP is an UNOFFICIAL, UNREGULATED number: it is quoted by a handful of grey-market
dealers, has no exchange, no audit trail and no official source. SEBI does not
recognise it and it is thinly quoted enough to be moved deliberately. It is stored
here as a dated snapshot precisely so it can be SCORED later against what actually
happened on listing day - see ipo_lib.gmp_scoreboard(). Never present it as fact.

Source: ipowatch.in (robots.txt permits general crawling). One polite request/day.

Usage:
  python fetch_gmp.py
"""
import argparse
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
URL = "https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/"
# a partial header set gets refused by the host - these mirror a real navigation
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "Connection": "keep-alive",
}


def _cells(row_html: str) -> list[str]:
    out = [
        re.sub(r"<[^>]+>", "", c).replace("&nbsp;", " ").replace("&#8377;", "₹").strip()
        for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, flags=re.S | re.I)
    ]
    return [re.sub(r"\s+", " ", c) for c in out]


def _money(s: str) -> float | None:
    """First rupee figure in a cell ('₹500 (17.64%)' -> 500.0, '₹-' -> None)."""
    m = re.search(r"-?\d[\d,]*\.?\d*", (s or "").replace("₹", ""))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _pct(s: str) -> float | None:
    m = re.search(r"\(\s*(-?\d+\.?\d*)\s*%\s*\)", s or "")
    return float(m.group(1)) if m else None


def norm_name(s: str) -> str:
    """Normalise an IPO name so ipowatch's wording can be matched to NSE's."""
    s = (s or "").lower()
    s = re.sub(r"\b(limited|ltd|private|pvt|india|ipo)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


def parse(html: str) -> list[dict]:
    tables = re.findall(r"<table.*?</table>", html, flags=re.S | re.I)
    if not tables:
        return []
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", tables[0], flags=re.S | re.I)
    out: list[dict] = []
    header: list[str] = []
    for r in rows:
        c = [x for x in _cells(r) if x]
        if not c:
            continue
        if not header and any("gmp" in x.lower() for x in c):
            header = [x.lower() for x in c]
            continue
        if len(c) < 5:
            continue
        name = c[0]
        if not name or name.lower().startswith("ipo name"):
            continue
        est = c[4] if len(c) > 4 else ""
        out.append({
            "ipo_name": name,
            "name_key": norm_name(name),
            "gmp": _money(c[1]),
            "price": _money(c[3]) if len(c) > 3 else None,
            "est_listing": _money(est),
            "est_gain_pct": _pct(est),
            "ipo_dates": c[5] if len(c) > 5 else None,
            "ipo_type": c[6] if len(c) > 6 else None,
            "status": c[7] if len(c) > 7 else None,
            "source_updated": c[8] if len(c) > 8 else None,
        })
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tries", type=int, default=4)
    args = ap.parse_args()

    html = None
    delay = 2.0
    for attempt in range(args.tries):
        try:
            r = requests.get(URL, headers=HEADERS, timeout=30)
            r.raise_for_status()
            html = r.text
            break
        except Exception as e:  # noqa: BLE001
            print(f"  attempt {attempt + 1} failed: {str(e)[:70]}")
            if attempt < args.tries - 1:
                time.sleep(delay)
                delay *= 2
    if html is None:
        print("gmp: source unreachable - leaving previous snapshots untouched")
        return

    rows = parse(html)
    if not rows:
        print("gmp: parsed 0 rows (layout may have changed) - nothing written")
        return

    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    con.execute(
        "CREATE TABLE IF NOT EXISTS gmp_history ("
        "snapshot_date TEXT, ipo_name TEXT, name_key TEXT, gmp REAL, price REAL, "
        "est_listing REAL, est_gain_pct REAL, ipo_dates TEXT, ipo_type TEXT, status TEXT, "
        "source_updated TEXT, source TEXT, fetched_at TEXT, "
        "PRIMARY KEY (snapshot_date, name_key))"
    )
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    con.executemany(
        "INSERT OR REPLACE INTO gmp_history VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            (today, r["ipo_name"], r["name_key"], r["gmp"], r["price"], r["est_listing"],
             r["est_gain_pct"], r["ipo_dates"], r["ipo_type"], r["status"], r["source_updated"],
             "ipowatch.in", now)
            for r in rows
        ],
    )
    con.commit()
    total = con.execute("SELECT COUNT(*) FROM gmp_history").fetchone()[0]
    days = con.execute("SELECT COUNT(DISTINCT snapshot_date) FROM gmp_history").fetchone()[0]
    con.close()
    live = sum(1 for r in rows if (r["gmp"] or 0) > 0)
    print(f"gmp: {len(rows)} IPOs snapshotted for {today} ({live} with a non-zero GMP); "
          f"history now {total} rows over {days} day(s)")


if __name__ == "__main__":
    main()
