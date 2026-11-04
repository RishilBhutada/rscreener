"""Rscreener alerts - a starred company's quarterly business update, on the
owner's phone within twenty minutes of NSE listing it.

Some companies say how the quarter went days before the results (Honasa,
Titan, most banks - see pipeline/business_updates.py for how they are told
apart from the rest of NSE's announcements). Run by the news watcher
(pipeline/news_watch.py) every twenty minutes from 07:00 to 23:59 IST,
because GitHub drops most of this repository's timed runs.

One push per company per quarter: each push carries the tag
rs-upd-<symbol>-<quarter end>, and the topic's messages of the last day and a
bit are read before sending, so twenty-minute runs never repeat one. Facts
only: the time, the subject line, the PDF. The owner's study (17-Oct-2026)
found the share's move on an update day did not tell which way the results
day would go; the push says so rather than inviting a guess.

Symbols: alerts/watchlist.txt plus the stars and holdings in the owner's
account (account_list.py) - the same list every other alert uses.

Usage:  python alerts/update_alerts.py     (NTFY_TOPIC unset = print only)
"""
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import business_updates  # noqa: E402
import nse_session  # noqa: E402
from account_list import alert_symbols  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))
TOPIC = os.environ.get("NTFY_TOPIC", "")
DAY = nse_session.HOME + "/api/corporate-announcements?index=equities&from_date={d:%d-%m-%Y}&to_date={d:%d-%m-%Y}"
DOCS = "https://nsearchives.nseindia.com/corporate/"


def sent_keys() -> set[str]:
    """Update tags on the topic's messages of the last day and a bit."""
    if not TOPIC:
        return set()
    try:
        r = requests.get(f"https://ntfy.sh/{TOPIC}/json", params={"poll": "1", "since": "30h"}, timeout=30)
    except requests.RequestException:
        return set()
    keys = set()
    for line in r.text.splitlines():
        try:
            keys.update(t for t in json.loads(line).get("tags") or [] if t.startswith("rs-upd-"))
        except ValueError:
            continue
    return keys


def clock(hms: str) -> str:
    h, m = int(hms[:2]), hms[3:5]
    return f"{h % 12 or 12}:{m} {'am' if h < 12 else 'pm'}"


def main() -> None:
    watch = set(alert_symbols())
    now = datetime.now(IST)
    # Before eight, yesterday evening's filings too: the watcher sleeps from
    # midnight to seven.
    days = [now.date()] + ([now.date() - timedelta(days=1)] if now.hour < 8 else [])
    s = requests.Session()
    s.headers.update(nse_session.HEADERS)
    try:
        s.get(nse_session.HOME, timeout=20)
    except requests.RequestException:
        pass
    rows = []
    for d in days:
        try:
            r = s.get(DAY.format(d=d), timeout=60)
            r.raise_for_status()
            body = r.json()
            rows += body if isinstance(body, list) else body.get("data", [])
        except (requests.RequestException, ValueError) as e:
            print(f"updates: NSE {type(e).__name__} for {d} - next run")
    found = business_updates.found(rows)
    mine = {k: v for k, v in found.items() if k[0] in watch}
    sent = sent_keys()
    pushed = 0
    for (sym, qe), (day, at, doc, subject) in sorted(mine.items(), key=lambda x: x[1][:2]):
        key = "rs-upd-" + re.sub(r"[^A-Za-z0-9]", "", sym) + "-" + qe
        if key in sent:
            continue
        q = business_updates.quarter_label(datetime.strptime(qe, "%Y-%m-%d").date())
        url = doc if doc.startswith("http") else DOCS + doc
        title = f"{sym}: {q} business update"
        # No database here to check the results day against, so the push
        # never claims "before its results"; the calendar does that check.
        body = (f"Out {clock(at)} IST. {subject[:220]}\n"
                "Past update-day moves did not tell which way results day would go.")
        if not TOPIC:
            print(f"(no NTFY_TOPIC) would push: {title} | {body} | {url}")
        else:
            requests.post(f"https://ntfy.sh/{TOPIC}", data=body.encode("utf-8"), timeout=15,
                          headers={"Title": title.encode("utf-8"), "Tags": f"newspaper,{key}", "Click": url})
        pushed += 1
    print(f"updates: {len(found)} business updates on NSE today, {len(mine)} for the alert list, {pushed} pushed")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - one bad run must not stop the news watcher
        print(f"updates: FAILED {type(e).__name__}: {e}"[:300])
