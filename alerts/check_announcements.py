"""Rscreener alerts - checks NSE corporate announcements for watchlist symbols
and pushes matches to the owner's phone via ntfy.sh.

Run every twenty minutes by the news watcher (pipeline/news_watch.py), with
the hourly alerts.yml as a backup - GitHub drops most of this repository's
timed runs, and a checker that only looked back an hour lost every
announcement of an hour it skipped. Each run looks back LOOKBACK_MIN minutes
(default ten hours, inside ntfy's twelve-hour memory), and each push carries a
tag rs-ann-<symbol>-<id> that is read back before sending, so overlapping
runs never repeat one. If the topic cannot be read, nothing is sent that run.
A crash sends a high-priority "checker FAILED" push, at most once a day.
"""
import hashlib
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import nse_session  # noqa: E402
from business_updates import is_update  # noqa: E402
from ntfy_lib import WINDOW_H, post, sent_tags  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))
API = nse_session.HOME + "/api/corporate-announcements?index=equities"
LOOKBACK_MIN = int(os.environ.get("LOOKBACK_MIN", str(WINDOW_H * 60)))


def load_watchlist() -> set[str]:
    # alerts/watchlist.txt plus the stars and holdings in the owner's account.
    from account_list import alert_symbols
    return set(alert_symbols())


def tag_for(sym: str, a: dict) -> str:
    ident = f"{sym}|{a.get('an_dt')}|{a.get('desc')}|{a.get('attchmntFile')}"
    return f"rs-ann-{re.sub(r'[^A-Za-z0-9]', '', sym)}-{hashlib.sha1(ident.encode()).hexdigest()[:10]}"


def main() -> None:
    if os.environ.get("TEST_PUSH") == "1":
        post("Rscreener alerts are wired", "One-time test notification. If you can read this, the pipeline works end-to-end.",
             tags="white_check_mark")
        print("test push sent")
        return

    watch = load_watchlist()
    print(f"announcements: watching {len(watch)} symbols")

    # NSE's API refuses a cold session: the homepage sets the cookies it wants.
    s = requests.Session()
    s.headers.update(nse_session.HEADERS)
    try:
        s.get(nse_session.HOME, timeout=20)
    except requests.RequestException:
        pass
    r = s.get(API, timeout=25)
    r.raise_for_status()
    body = r.json()
    announcements = body if isinstance(body, list) else body.get("data", [])

    sent = sent_tags("rs-ann-")
    if sent is None:
        print("announcements: ntfy topic unreadable - nothing sent, next run")
        return
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
        if ts < cutoff or is_update(a):
            continue  # update_alerts.py pushes business updates, with what they are
        tag = tag_for(sym, a)
        if tag in sent:
            continue
        desc = (a.get("desc") or "announcement").strip()
        detail = (a.get("attchmntText") or desc).strip()
        link = a.get("attchmntFile") or "https://www.nseindia.com/companies-listing/corporate-filings-announcements"
        if post(f"{sym}: {desc[:70]}", f"{raw_ts} IST\n{detail[:300]}\n{link}",
                tags=f"chart_with_upwards_trend,{tag}"):
            sent.add(tag)
            hits += 1
            print(f"alert: {sym} | {raw_ts} | {desc[:70]}")

    print(f"announcements: {len(announcements)} scanned, {hits} pushed")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - heartbeat: NEVER fail silently
        print(f"announcements: FAILED {type(e).__name__}: {e}"[:300])
        # Once a day: run every twenty minutes, a broken NSE would otherwise
        # send seventy of these.
        tag = f"rs-annfail-{datetime.now(IST):%Y%m%d}"
        seen = sent_tags("rs-annfail-")
        if seen is not None and tag not in seen:
            post("Rscreener checker FAILED", f"{type(e).__name__}: {e}"[:300], tags=f"warning,{tag}", priority="high")
        sys.exit(1)
