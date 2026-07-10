"""Rscreener alerts - checks NSE corporate announcements for watchlist symbols
and pushes matches to the owner's phone via ntfy.sh.

Runs on GitHub Actions (see .github/workflows/alerts.yml). Stateless by design:
each run looks back LOOKBACK_MIN minutes (default 70, cron is hourly), so a
delayed cron can rarely duplicate an alert but never lose one silently - and
any crash sends a high-priority "checker FAILED" push (the heartbeat).
"""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

IST = timezone(timedelta(hours=5, minutes=30))
API = "https://www.nseindia.com/api/corporate-announcements?index=equities"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}
TOPIC = os.environ.get("NTFY_TOPIC", "")
LOOKBACK_MIN = int(os.environ.get("LOOKBACK_MIN", "70"))


def push(title: str, message: str, priority: str = "default", tags: str = "chart_with_upwards_trend") -> None:
    if not TOPIC:
        print(f"no NTFY_TOPIC set; would have pushed: {title}")
        return
    requests.post(
        f"https://ntfy.sh/{TOPIC}",
        data=message.encode("utf-8"),
        headers={"Title": title, "Priority": priority, "Tags": tags},
        timeout=15,
    )


def load_watchlist() -> set[str]:
    path = Path(__file__).with_name("watchlist.txt")
    syms = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.split("#")[0].strip().upper()
        if s:
            syms.add(s)
    return syms


def main() -> None:
    if os.environ.get("TEST_PUSH") == "1":
        push("Rscreener alerts are wired", "One-time test notification. If you can read this, the pipeline works end-to-end.", tags="white_check_mark")
        print("test push sent")
        return

    watch = load_watchlist()
    print(f"watchlist ({len(watch)}): {sorted(watch)}")

    s = requests.Session()
    s.headers.update(HEADERS)
    r = s.get(API, timeout=25)
    r.raise_for_status()
    announcements = r.json()

    cutoff = datetime.now(IST) - timedelta(minutes=LOOKBACK_MIN)
    hits = 0
    for a in announcements:
        sym = (a.get("symbol") or "").upper()
        if sym not in watch:
            continue
        raw_ts = a.get("an_dt") or ""
        try:
            ts = datetime.strptime(raw_ts, "%d-%b-%Y %H:%M:%S").replace(tzinfo=IST)
        except ValueError:
            continue
        if ts < cutoff:
            continue
        desc = (a.get("desc") or "announcement").strip()
        detail = (a.get("attchmntText") or desc).strip()
        link = a.get("attchmntFile") or "https://www.nseindia.com/companies-listing/corporate-filings-announcements"
        push(f"{sym}: {desc[:70]}", f"{raw_ts} IST\n{detail[:300]}\n{link}")
        hits += 1
        print(f"alert: {sym} | {raw_ts} | {desc[:70]}")

    print(f"done: {len(announcements)} announcements scanned, {hits} watchlist hits")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - heartbeat: NEVER fail silently
        push("Rscreener checker FAILED", f"{type(e).__name__}: {e}"[:300], priority="high", tags="warning")
        print(f"CHECKER FAILED: {e}")
        sys.exit(1)
