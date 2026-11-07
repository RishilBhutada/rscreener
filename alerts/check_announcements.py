"""Rscreener alerts - checks NSE corporate announcements for watchlist symbols
and pushes matches to the owner's phone via ntfy.sh.

Run every twenty minutes by the news watcher (pipeline/news_watch.py), with
the hourly alerts.yml as a backup - GitHub drops most of this repository's
timed runs, and a checker that only looked back an hour lost every
announcement of an hour it skipped. Each run looks back LOOKBACK_MIN minutes
(default ten hours, inside ntfy's twelve-hour memory), and each push carries a
tag rs-ann-<symbol>-<id> that is read back before sending, so overlapping
runs never repeat one. If the topic cannot be read, nothing is sent that run.
A crash sends a high-priority "checker FAILED" push, at most once every twelve
hours (as long as ntfy remembers the last one).

A quarterly business update is left to alerts/update_alerts.py, which says
what it is - but that runs only inside the news watcher. When its tag
(rs-upd-<symbol>-<quarter end>) is not on the topic, this sends the same push
itself, with that tag, so neither script repeats it.
"""
import hashlib
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import business_updates  # noqa: E402
import nse_session  # noqa: E402
import update_alerts  # noqa: E402
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

    # Both prefixes: this script's own tags and update_alerts.py's.
    sent = sent_tags("rs-")
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
        if ts < cutoff:
            continue
        tag = tag_for(sym, a)
        if tag in sent:
            continue
        if business_updates.is_update(a):
            # update_alerts.py pushes these, saying what they are. If it has
            # not (the news watcher is not running), send its push from here.
            for (usym, qe), (day, at, doc, subject) in business_updates.found([a]).items():
                key = update_alerts.tag(usym, qe)
                if key in sent:
                    continue
                if update_alerts.push(usym, qe, day, at, doc, subject, extra_tags=tag):
                    sent.update((key, tag))
                    hits += 1
                    print(f"alert: {sym} | {raw_ts} | business update (update_alerts.py had not sent it)")
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
        # At most once every twelve hours: run every twenty minutes, a broken
        # NSE would otherwise send seventy a day. ntfy.sh keeps a message
        # twelve hours, so that is as far back as "already sent" can be read;
        # the tag used to carry the date, which read like "once a day" but
        # repeated twelve hours later (and again just after midnight).
        tag = "rs-annfail"
        seen = sent_tags("rs-annfail")
        if seen is not None and tag not in seen:
            post("Rscreener checker FAILED", f"{type(e).__name__}: {e}"[:300], tags=f"warning,{tag}", priority="high")
        sys.exit(1)
