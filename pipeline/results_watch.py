"""Rscreener - watch NSE for results and publish them as they land.

GitHub's own timer cannot do this. On 9-Oct-2026 the "Watchlist alerts"
workflow, set to run hourly - seventeen times a day - ran three times, each
hours late: GitHub drops most scheduled runs on this repository. So one job
watches instead. The nightly run starts it each morning (a few timed starts
back that up). It reads NSE's two newest-first lists - announcements, and the
results XBRL - every two minutes while results are due, and starts "Publish
new results" (results.yml) whenever either shows a result newer than the last
publish began. That run fetches and republishes in about four minutes.

When it watches, from the calendar's own times: from half an hour before the
earliest time today's companies usually publish (11:00 when none is known)
until 23:59 IST, or until every company due today has its figures on the site.
Before that it looks every ten minutes, in case one is early. A day with no
results meetings on the calendar is not watched at all, and results that land
after midnight are the nightly run's.

Starting a publish at most every eight minutes keeps a busy evening to one run
at a time; GitHub keeps one waiting run per group, so nothing piles up.

A GitHub job lives six hours at most, so before then this starts its successor
and stops. Read-only toward NSE: two small GETs every two minutes.

Usage:  python results_watch.py [--dry-run] [--polls N]
"""
import argparse
import os
import time
from datetime import date, datetime, timedelta, timezone

import requests

import nse_session
from fetch_result_times import is_results, stamp_of

IST = timezone(timedelta(hours=5, minutes=30))
SITE = "https://rishilbhutada.github.io/rscreener"
REPO = os.environ.get("GITHUB_REPOSITORY", "RishilBhutada/rscreener")
NSE = nse_session.HOME
ANNOUNCEMENTS = NSE + "/api/corporate-announcements?index=equities"
ANNOUNCEMENTS_DAY = NSE + "/api/corporate-announcements?index=equities&from_date={d:%d-%m-%Y}&to_date={d:%d-%m-%Y}"
XBRL = NSE + "/api/integrated-filing-results?index=equities&type=Integrated%20Filing-%20Financials&page={p}"
MEETINGS = NSE + "/api/corporate-board-meetings?index=equities&from_date={d:%d-%m-%Y}&to_date={d:%d-%m-%Y}"
PUBLISHERS = {".github/workflows/results.yml", ".github/workflows/nightly.yml"}
FAST, SLOW = 120, 600            # seconds between looks: results due / not yet
MIN_GAP = 8 * 60                 # never start a publish within this long of the last
LIFE = 5 * 3600 + 40 * 60        # hand over before GitHub's six-hour limit
EARLY = timedelta(minutes=30)


class Nse:
    """NSE with a live cookie: re-primed every twenty minutes and after a refusal."""

    def __init__(self) -> None:
        self.s = requests.Session()
        self.s.headers.update(nse_session.HEADERS)
        self.primed = 0.0

    def prime(self) -> None:
        try:
            self.s.get(NSE, timeout=20)
        except requests.RequestException:
            pass
        self.primed = time.monotonic()

    def get(self, url: str):
        if time.monotonic() - self.primed > 1200:
            self.prime()
        for attempt in range(2):
            try:
                r = self.s.get(url, timeout=30)
                r.raise_for_status()
                body = r.json()
                return body if isinstance(body, list) else body.get("data", [])
            except (requests.RequestException, ValueError) as e:
                if attempt:
                    print(f"  NSE: {type(e).__name__} on {url.split('/api/')[1][:50]} - next look")
                    return None
                time.sleep(5)
                self.prime()


def gh(method: str, path: str, **kw):
    r = requests.request(method, f"https://api.github.com/repos/{REPO}{path}", timeout=30, headers={
        "Authorization": f"Bearer {os.environ['GH_TOKEN']}", "Accept": "application/vnd.github+json"}, **kw)
    r.raise_for_status()
    return r.json() if r.content else None


def last_publish() -> datetime | None:
    """When the newest publish that fetches results was started - running,
    waiting or done. A cancelled one fetched nothing."""
    since = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    runs = gh("GET", "/actions/runs", params={"per_page": 50, "created": f">={since}"})["workflow_runs"]
    stamps = [datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")) for r in runs
              if r.get("path") in PUBLISHERS and r.get("conclusion") != "cancelled"]
    return max(stamps, default=None)


def start(workflow: str, dry: bool) -> None:
    if dry:
        print(f"  (dry run) would start {workflow}")
        return
    gh("POST", f"/actions/workflows/{workflow}/dispatches", json={"ref": "main"})


def today_on_site(today: str):
    """Today's results meetings still to come (symbol -> usual time or None),
    and the companies whose results are already out / already have figures."""
    r = requests.get(f"{SITE}/calendar.json", params={"t": int(time.time() // 60)}, timeout=30)
    r.raise_for_status()
    doc = r.json()
    due = {e["symbol"]: e.get("usual") for e in doc.get("events", [])
           if e.get("type") == "results" and e.get("date") == today}
    out = [e for e in doc.get("recent", []) if e.get("k") == "results" and e.get("d") == today]
    return due, {e["s"] for e in out}, {e["s"] for e in out if "rv" in e or "pt" in e}


def at(day: date, hhmm: str) -> datetime:
    return datetime(day.year, day.month, day.day, int(hhmm[:2]), int(hhmm[3:5]), tzinfo=IST)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="look and report, start nothing")
    ap.add_argument("--polls", type=int, default=0, help="stop after this many looks (testing)")
    args = ap.parse_args()
    born = time.monotonic()
    nse = Nse()

    today = datetime.now(IST).date()
    try:
        due, out, filed = today_on_site(today.isoformat())
    except (requests.RequestException, ValueError) as e:
        # The site unreadable: NSE's own list of today's meetings will do.
        print(f"calendar.json: {type(e).__name__} - reading today's meetings from NSE")
        rows = nse.get(MEETINGS.format(d=today)) or []
        due = {r.get("bm_symbol"): None for r in rows if "result" in (r.get("bm_purpose") or "").lower()}
        out, filed = set(), set()
    expected = set(due) | out
    if not expected:
        print(f"{today}: no results meetings on the calendar today - nothing to watch")
        return
    times = sorted(u for u in due.values() if u)
    begin = at(today, times[0]) - EARLY if times else at(today, "11:00")
    end = at(today, "23:59")
    print(f"{today}: {len(expected)} companies due ({len(out)} out already, {len(filed)} with figures); "
          f"watching closely from {begin:%H:%M} to {end:%H:%M} IST")

    meeting_days = {(s, today.isoformat()) for s in expected}
    last_ann = last_xbrl = None   # the newest stamp each list showed at the previous look
    last_start = -1e9
    looks = 0
    while True:
        now = datetime.now(IST)
        if now >= end:
            print(f"{now:%H:%M}: the day is over - results after midnight are the nightly run's")
            break
        if time.monotonic() - born > LIFE:
            print(f"{now:%H:%M}: handing over to a fresh watcher before GitHub's six-hour limit")
            start("results-watch.yml", args.dry_run)
            break

        # Both lists, newest first. When a list's oldest row is newer than the
        # newest seen last time, rows were missed between looks: read further.
        fresh: list[tuple] = []   # (stamp, symbol, "out" | "figures")
        rows = nse.get(ANNOUNCEMENTS)
        if rows is not None:
            stamps = [t for t in map(stamp_of, rows) if t]
            if last_ann is None or (stamps and min(stamps) > last_ann):
                rows = nse.get(ANNOUNCEMENTS_DAY.format(d=today)) or rows
            for r in rows:
                t = stamp_of(r)
                if t and t.date() == today and is_results(r, meeting_days):
                    fresh.append((t.replace(tzinfo=IST), r.get("symbol"), "out"))
            last_ann = max([t for t in map(stamp_of, rows) if t] + ([last_ann] if last_ann else []), default=None)
        seen = []
        for page in range(1, 6):   # 20 a page; a busy evening files ~1 a minute
            rows = nse.get(XBRL.format(p=page))
            if not rows:
                break
            stamps = []
            for r in rows:
                try:
                    t = datetime.strptime((r.get("broadcast_Date") or "").strip(), "%d-%b-%Y %H:%M:%S")
                except ValueError:
                    continue
                stamps.append(t)
                if t.date() == today:
                    fresh.append((t.replace(tzinfo=IST), r.get("symbol"), "figures"))
            seen += stamps
            # The first look reads one page: the site already says what is filed.
            if not stamps or last_xbrl is None or min(stamps) <= last_xbrl or min(stamps).date() < today:
                break
        last_xbrl = max(seen + ([last_xbrl] if last_xbrl else []), default=None)

        out |= {s for _, s, k in fresh if k == "out"}
        filed |= {s for _, s, k in fresh if k == "figures"}
        newest = max(fresh, default=None)
        if newest and time.monotonic() - last_start >= MIN_GAP:
            try:
                published = last_publish()
            except requests.RequestException as e:
                print(f"  GitHub: {type(e).__name__} - next look")
                published = newest[0]
            if published is None or newest[0] > published:
                news = sorted({s for t, s, _ in fresh if published is None or t > published})
                print(f"{now:%H:%M}: new since the last publish - {', '.join(news[:12])}"
                      f"{f' and {len(news) - 12} more' if len(news) > 12 else ''}; publishing")
                start("results.yml", args.dry_run)
                last_start = time.monotonic()
        # Done for the day once every company due has filed its figures and the
        # last publish has had time to finish.
        if expected <= filed and time.monotonic() - last_start > 15 * 60:
            print(f"{now:%H:%M}: every company due today has its figures out and published")
            break

        looks += 1
        if args.polls and looks >= args.polls:
            print(f"{now:%H:%M}: {looks} looks done (--polls)")
            break
        wait = FAST if now >= begin - timedelta(minutes=2) else min(SLOW, max(60, (begin - now).total_seconds()))
        time.sleep(wait)


if __name__ == "__main__":
    main()
