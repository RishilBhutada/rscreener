"""Rscreener - a push after each big US release: did it surprise, and how did
gold move? (owner, 14-Oct-2026)

The gold page rates a release by how gold moves when it SURPRISES, reading the
surprise from the 2-year Treasury yield. This sends the same reading the
evening it happens: 30 minutes after each US release rated four stars or more
on the gold calendar (an hour after the Fed, whose press conference starts 30
minutes in), one push -

  title    "US CPI inflation: a surprise" / "...: in line"
  body     the 2-year yield's move since the release (from the 2-Year T-Note
           futures, converted at a duration of about 1.9), the release's own
           surprise mark from the gold page, COMEX gold's move with prices,
           and the Cleveland Fed nowcast and the previous figure for CPI/PCE

Facts only - a move and a threshold, never an opinion on what to do.

Started each morning by the nightly run (timed starts are backups; GitHub
drops most of them). It sleeps until each release, hands over to a fresh run
before GitHub's six-hour limit, and stops after the day's last release. The
topic's own recent messages are the record of what was sent (each push is
tagged with its release), so a second run never repeats one.

Usage:
  python pipeline/us_release_alerts.py                  watch today's releases
  python pipeline/us_release_alerts.py --replay 2026-09-11T12:30:00Z
                                                        print what a past release's push would have said
"""
import argparse
import json
import os
import time
from datetime import datetime, timedelta, timezone

import requests

SITE = "https://rishilbhutada.github.io/rscreener"
IST = timezone(timedelta(hours=5, minutes=30))
TOPIC = os.environ.get("NTFY_TOPIC", "")
REPO = os.environ.get("GITHUB_REPOSITORY", "RishilBhutada/rscreener")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
CHART = "https://query2.finance.yahoo.com/v8/finance/chart/{sym}?interval=5m&period1={p1}&period2={p2}"
FAMS = {"fomc", "us_cpi", "us_jobs", "us_pce", "us_growth", "us_ppi"}
MIN_STARS = 4
AFTER = {"fomc": 60}          # minutes after the release; 30 otherwise
DURATION = 1.9               # the 2-year note futures' duration, roughly: price % / 1.9 = yield points
LIFE = 5 * 3600 + 40 * 60    # hand over before GitHub's six-hour limit


def key_of(e: dict) -> str:
    return f"rs-{e['t'][:16].replace('-', '').replace(':', '').replace('T', '')}-{e['fam']}"


def due_at(e: dict) -> datetime:
    t = datetime.fromisoformat(e["t"].replace("Z", "+00:00"))
    return t + timedelta(minutes=AFTER.get(e["fam"], 30))


def gold_doc() -> dict:
    r = requests.get(f"{SITE}/gold.json", params={"t": int(time.time())}, headers={"User-Agent": UA}, timeout=60)
    r.raise_for_status()
    return r.json()


def releases(doc: dict, start: datetime, until: datetime) -> list[dict]:
    out = []
    for e in doc.get("events", []):
        t = datetime.fromisoformat(e["t"].replace("Z", "+00:00"))
        if e.get("fam") in FAMS and e.get("stars", 0) >= MIN_STARS and start <= t < until:
            out.append(e)
    return sorted(out, key=lambda e: e["t"])


def sent_keys() -> set[str]:
    """Release tags on the topic's messages of the last day."""
    if not TOPIC:
        return set()
    try:
        r = requests.get(f"https://ntfy.sh/{TOPIC}/json", params={"poll": "1", "since": "26h"}, timeout=30)
        keys = set()
        for line in r.text.splitlines():
            try:
                keys.update(t for t in json.loads(line).get("tags") or [] if t.startswith("rs-"))
            except ValueError:
                continue
        return keys
    except requests.RequestException:
        return set()


def bars(sym: str, t0: datetime, t1: datetime) -> list[tuple[int, float]]:
    url = CHART.format(sym=sym, p1=int((t0 - timedelta(hours=3)).timestamp()), p2=int((t1 + timedelta(minutes=10)).timestamp()))
    r = requests.get(url, headers={"User-Agent": UA}, timeout=60)
    r.raise_for_status()
    res = (r.json().get("chart", {}).get("result") or [None])[0] or {}
    closes = ((res.get("indicators", {}).get("quote") or [{}])[0]).get("close") or []
    return [(ts, c) for ts, c in zip(res.get("timestamp") or [], closes) if c]


def price_at(b: list[tuple[int, float]], t: datetime) -> float | None:
    """The last 5-minute bar to have closed by `t` (a bar is stamped with its start)."""
    cut = t.timestamp() - 300
    before = [c for ts, c in b if ts <= cut]
    return before[-1] if before else None


def bps(v: float) -> str:
    n = round(v)
    return "0bp" if n == 0 else f"{n:+d}bp"


def compose(e: dict, fam: dict) -> tuple[str, str] | None:
    t = datetime.fromisoformat(e["t"].replace("Z", "+00:00"))
    t1 = due_at(e)
    t5 = t + timedelta(minutes=5)
    gb, zb = bars("GC%3DF", t, t1), bars("ZT%3DF", t, t1)
    g0, g5, g1 = price_at(gb, t), price_at(gb, t5), price_at(gb, t1)
    z0, z5, z1 = price_at(zb, t), price_at(zb, t5), price_at(zb, t1)
    if None in (g0, g5, g1, z0, z5, z1):
        return None
    # Two readings: the first five minutes are the market's verdict on the
    # print itself; the later one shows whether it stuck. September 2026's CPI
    # moved the yield +4bp at once and gave it all back within 25 minutes.
    bp5 = -(z5 / z0 - 1) * 100 / DURATION * 100
    bp1 = -(z1 / z0 - 1) * 100 / DURATION * 100
    gold5, gold1 = (g5 / g0 - 1) * 100, (g1 / g0 - 1) * 100
    mark = (fam.get("surprise") or {}).get("bp")
    mins = AFTER.get(e["fam"], 30)
    verdict = "" if mark is None else (": a surprise" if max(abs(bp5), abs(bp1)) >= mark else ": in line")
    lines = [
        f"{t.astimezone(IST):%H:%M} IST release. 2-year yield {bps(bp5)} in 5 min, {bps(bp1)} after {mins} min"
        + (f" (a surprise for this release is {mark:g}bp or more)." if mark is not None else "."),
        f"COMEX gold {gold5:+.2f}% in 5 min, {gold1:+.2f}% after {mins} min ({g0:,.1f} to {g1:,.1f}).",
    ]
    now = e.get("now") or {}
    if now.get("h") is not None:
        core = f", core {now['c']:+.2f}%" if now.get("c") is not None else ""
        lines.append(f"Cleveland Fed nowcast {now['h']:+.2f}% m/m{core} (a model, not consensus).")
    if e.get("previous"):
        lines.append(f"Previous: {e['previous']}.")
    return f"{e['title']}{verdict}", " ".join(lines)


def push(title: str, body: str, key: str) -> None:
    if not TOPIC:
        print(f"(no NTFY_TOPIC) would push: {title} | {body}")
        return
    requests.post(f"https://ntfy.sh/{TOPIC}", data=body.encode("utf-8"), timeout=15,
                  headers={"Title": title.encode("utf-8"), "Tags": f"chart_with_upwards_trend,{key}",
                           "Click": f"{SITE}/gold"})


def hand_over(until: datetime) -> None:
    tok = os.environ.get("GH_TOKEN", "")
    if not tok:
        print("no GH_TOKEN - cannot hand over")
        return
    r = requests.post(f"https://api.github.com/repos/{REPO}/actions/workflows/us-alerts.yml/dispatches",
                      json={"ref": "main", "inputs": {"until": until.strftime("%Y-%m-%dT%H:%M:%SZ")}},
                      headers={"Authorization": f"Bearer {tok}", "Accept": "application/vnd.github+json"}, timeout=30)
    print(f"handed over to a fresh watcher: HTTP {r.status_code}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--until", default="", help="UTC ISO end of the watch (set by a hand-over)")
    ap.add_argument("--replay", default="", help="UTC ISO time of a past release: print its push and stop")
    args = ap.parse_args()
    doc = gold_doc()
    fams = doc.get("families", {})

    if args.replay:
        for e in doc.get("events", []):
            if e["t"].startswith(args.replay[:16]) and e.get("fam") in FAMS:
                got = compose(e, fams.get(e["fam"], {}))
                print(f"{e['title']} [{e['fam']}, {e.get('stars')} stars]:", got or "no prices around it")
        return

    born = time.monotonic()
    start = datetime.now(timezone.utc) - timedelta(hours=2)
    # One evening per watch: until 08:00 IST tomorrow, which takes in the
    # Fed's decision at 23:30 or 00:30 IST and keeps two days' watches apart.
    morning = datetime.combine(datetime.now(IST).date() + timedelta(days=1), datetime.min.time(), IST) + timedelta(hours=8)
    until = datetime.fromisoformat(args.until.replace("Z", "+00:00")) if args.until else morning.astimezone(timezone.utc)
    todo = releases(doc, start, until)
    print(f"{len(todo)} release(s) rated {MIN_STARS}+ stars until {until.astimezone(IST):%d %b %H:%M} IST: "
          + ", ".join(f"{e['title']} {datetime.fromisoformat(e['t'].replace('Z', '+00:00')).astimezone(IST):%d %b %H:%M}" for e in todo))
    done = sent_keys()
    for e in todo:
        key = key_of(e)
        if key in done:
            print(f"{e['title']}: already sent")
            continue
        while datetime.now(timezone.utc) < due_at(e):
            left = LIFE - (time.monotonic() - born)
            wait = (due_at(e) - datetime.now(timezone.utc)).total_seconds()
            if wait > left - 120:
                print(f"next release {e['title']} is beyond this run's life - handing over")
                hand_over(until)
                return
            time.sleep(min(wait, 600))
        if due_at(e) < datetime.now(timezone.utc) - timedelta(hours=3):
            print(f"{e['title']}: more than three hours ago - not sent late")
            continue
        try:
            got = compose(e, fams.get(e["fam"], {}))
        except requests.RequestException as ex:
            got = None
            print(f"{e['title']}: prices unreadable ({type(ex).__name__})")
        if got:
            push(*got, key)
            print(f"sent: {got[0]}")
        else:
            print(f"{e['title']}: no prices around the release - nothing sent")
    print("the day's releases are done")


if __name__ == "__main__":
    main()
