"""Rscreener - the gold page's inputs.

  - The week's scheduled releases: Forex Factory's public calendar feed
    (nfs.faireconomy.media, robots.txt allows all). It carries only the
    current week, so the history builds from the nightly snapshots.
  - Every FOMC decision date, past and scheduled: federalreserve.gov's
    meeting calendar (2021 onwards) - enough to measure gold's reaction to
    the Fed from the first run.
  - Gold headlines: the GDELT news API, built for programs, and the RSS
    feeds publishers put out for readers' apps (each feed's robots.txt
    allows it). GDELT often refuses GitHub's shared runners; the feeds
    keep the page fed when it does.
  - COMEX gold's daily closes (Yahoo GC=F) and its history from 2020, to
    measure how gold moved around each event.

Each source is asked once a run. The feeds rate-limit; a refusal is logged
and yesterday's rows stand.

Usage:  python fetch_gold.py
"""
import html
import json
import re
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import requests

import price_periods
from gold_lib import family_of

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
FF = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
FED = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
GDELT = "https://api.gdeltproject.org/api/v2/doc/doc"
FEEDS = [
    "https://economictimes.indiatimes.com/markets/commodities/rssfeeds/1808152121.cms",
    "https://economictimes.indiatimes.com/markets/commodities/news/rssfeeds/50991765.cms",
    "https://www.business-standard.com/rss/markets/commodities-10608.rss",
    "https://www.thehindubusinessline.com/markets/gold/feeder/default.rss",
    "https://www.fxstreet.com/rss/news",
]
YAHOO = "https://query2.finance.yahoo.com/v8/finance/chart/GC%3DF?period1={p1}&period2={p2}&interval=1d"
NY = ZoneInfo("America/New_York")
MONTHS = {m: i + 1 for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july",
                                         "august", "september", "october", "november", "december"])}
MON3 = {k[:3]: v for k, v in MONTHS.items()}


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB, timeout=180)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS gold_events (
            key TEXT PRIMARY KEY, when_utc TEXT, country TEXT, title TEXT, impact TEXT,
            forecast TEXT, previous TEXT, actual TEXT, family TEXT, source TEXT,
            first_seen TEXT, last_seen TEXT);
        CREATE TABLE IF NOT EXISTS gold_news (
            url TEXT PRIMARY KEY, seen_utc TEXT, title TEXT, domain TEXT);
        CREATE TABLE IF NOT EXISTS commodity_world (ticker TEXT, date TEXT, close REAL, PRIMARY KEY (ticker, date));
    """)
    return con


def upsert_event(con, key, when_utc, country, title, impact, forecast, previous, actual, source, today):
    con.execute("""
        INSERT INTO gold_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET when_utc=excluded.when_utc, impact=excluded.impact,
            forecast=COALESCE(NULLIF(excluded.forecast,''), gold_events.forecast),
            previous=COALESCE(NULLIF(excluded.previous,''), gold_events.previous),
            actual=COALESCE(NULLIF(excluded.actual,''), gold_events.actual),
            family=excluded.family, last_seen=excluded.last_seen""",
        (key, when_utc, country, title, impact, forecast, previous, actual,
         family_of(title, country, impact), source, today, today))


def week_calendar(con, today: str) -> None:
    r = requests.get(FF, headers={"User-Agent": UA}, timeout=40)
    if r.status_code != 200 or not r.text.lstrip().startswith("["):
        print(f"calendar feed: HTTP {r.status_code} - keeping what is stored")
        return
    n = 0
    for x in r.json():
        try:
            when = datetime.fromisoformat(x["date"]).astimezone(timezone.utc)
        except (KeyError, ValueError):
            continue
        title, country = (x.get("title") or "").strip(), (x.get("country") or "").strip()
        if not title or x.get("impact") == "Holiday":
            continue
        key = f"ff|{country}|{title}|{when.date().isoformat()}"
        upsert_event(con, key, when.strftime("%Y-%m-%dT%H:%M:%SZ"), country, title, x.get("impact") or "",
                     x.get("forecast") or "", x.get("previous") or "", x.get("actual") or "", "forexfactory", today)
        n += 1
    con.commit()
    print(f"calendar feed: {n} events this week")


def fomc_dates(con, today: str) -> None:
    """Each scheduled FOMC decision: the second day of the meeting, 2pm in
    Washington. Notation votes and unscheduled calls are not meetings."""
    r = requests.get(FED, headers={"User-Agent": UA}, timeout=60)
    r.raise_for_status()
    blocks = re.split(r"(\d{4}) FOMC Meetings", r.text)
    n = 0
    for i in range(1, len(blocks), 2):
        year = int(blocks[i])
        for month, days in re.findall(
                r'fomc-meeting__month[^>]*>\s*<strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<',
                blocks[i + 1], flags=re.S):
            if "notation" in days.lower() or "unscheduled" in days.lower():
                continue
            m = re.match(r"\s*(\d{1,2})(?:-(\d{1,2}))?\s*(\*)?", days)
            if not m:
                continue
            last_day = int(m.group(2) or m.group(1))
            months = [MON3.get(p.strip().lower()[:3]) for p in month.split("/")]
            mon = months[-1] if (m.group(2) and int(m.group(2)) < int(m.group(1))) else months[0]
            if not mon:
                continue
            try:
                when = datetime(year, mon, last_day, 14, 0, tzinfo=NY).astimezone(timezone.utc)
            except ValueError:
                continue
            title = "FOMC rate decision" + (" and projections" if m.group(3) else "")
            upsert_event(con, f"fed|FOMC|{when.date().isoformat()}", when.strftime("%Y-%m-%dT%H:%M:%SZ"),
                         "USD", title, "High", "", "", "", "federalreserve.gov", today)
            # family_of reads the title; an FOMC decision is its own family.
            con.execute("UPDATE gold_events SET family='fomc' WHERE key=?", (f"fed|FOMC|{when.date().isoformat()}",))
            n += 1
    con.commit()
    print(f"FOMC: {n} decision dates from {FED}")


def save_headline(con, url: str, seen: datetime, title: str, domain: str) -> bool:
    title = re.sub(r"\s+", " ", html.unescape(title)).strip()
    if not url or not title or not re.search(r"gold|bullion", title, flags=re.I):
        return False
    now = datetime.now(timezone.utc)
    if seen < now - timedelta(days=7):
        return False
    seen = min(seen, now)  # a feed that mislabels its time zone is not news from the future
    con.execute("INSERT OR IGNORE INTO gold_news VALUES (?,?,?,?)",
                (url, seen.strftime("%Y-%m-%dT%H:%M:%SZ"), title, domain.removeprefix("www.")))
    return True


def gdelt(con) -> int:
    q = ('("gold price" OR "gold prices" OR bullion OR "gold reserves" OR "gold import" OR "gold demand" '
         'OR "gold ETF" OR "gold rate") sourcelang:english')
    params = {"query": q, "mode": "artlist", "format": "json", "maxrecords": 150, "timespan": "3d", "sort": "datedesc"}
    for wait in (15, 30, None):
        r = requests.get(GDELT, params=params, headers={"User-Agent": UA}, timeout=60)
        if r.status_code != 429 or wait is None:
            break
        time.sleep(wait)
    if r.status_code != 200:
        print(f"headlines: GDELT HTTP {r.status_code}")
        return 0
    try:
        arts = r.json().get("articles") or []
    except ValueError:
        print("headlines: GDELT answered without JSON")
        return 0
    n = 0
    for a in arts:
        try:
            seen = datetime.strptime(a.get("seendate", ""), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        n += save_headline(con, a.get("url") or "", seen, a.get("title") or "", a.get("domain") or "")
    return n


def feed_date(s: str) -> datetime | None:
    s = s.strip()
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def rss(con) -> int:
    def tag(item: str, name: str) -> str:
        m = re.search(rf"<{name}[^>]*>(.*?)</{name}>", item, flags=re.S)
        return re.sub(r"<!\[CDATA\[|\]\]>", "", m.group(1)).strip() if m else ""
    n = 0
    for url in FEEDS:
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=40)
            r.raise_for_status()
        except requests.RequestException as e:
            print(f"headlines: {urlparse(url).netloc} {type(e).__name__}")
            continue
        for item in re.findall(r"<item\b.*?</item>", r.content.decode("utf-8", "replace"), flags=re.S):
            link, seen = html.unescape(tag(item, "link")), feed_date(tag(item, "pubDate"))
            if seen:
                n += save_headline(con, link, seen, tag(item, "title"), urlparse(link).netloc)
        time.sleep(1)
    return n


def headlines(con) -> None:
    g, f = gdelt(con), rss(con)
    # A week is all the page shows; older headlines go.
    cut = (datetime.now(timezone.utc) - timedelta(days=21)).strftime("%Y-%m-%dT%H:%M:%SZ")
    con.execute("DELETE FROM gold_news WHERE seen_utc < ?", (cut,))
    con.commit()
    print(f"headlines: {g} from GDELT, {f} from publishers' feeds")


def comex(con) -> None:
    first, last = con.execute("SELECT MIN(date), MAX(date) FROM commodity_world WHERE ticker='GC=F'").fetchone()
    # From 2020 until the store reaches back that far - the Fed's calendar
    # starts in 2021 and each meeting needs the day before it - then the
    # last ten days.
    p1 = (int(datetime(2020, 6, 1).timestamp()) if not first or first > "2021-01-01"
          else int(datetime.fromisoformat(last).timestamp()) - 10 * 86400)
    r = requests.get(YAHOO.format(p1=p1, p2=int(time.time())), headers={"User-Agent": UA}, timeout=60)
    r.raise_for_status()
    res = (r.json().get("chart", {}).get("result") or [None])[0] or {}
    closes = ((res.get("indicators", {}).get("quote") or [{}])[0]).get("close") or []
    rows = [("GC=F", price_periods.ist_date(ts), round(c, 2))
            for ts, c in zip(res.get("timestamp") or [], closes) if c]
    # Yahoo dates a COMEX session by its start; a bar for today is a session
    # still trading.
    today = datetime.now(NY).date().isoformat()
    rows = [x for x in rows if x[1] < today]
    con.executemany("INSERT OR REPLACE INTO commodity_world VALUES (?,?,?)", rows)
    con.commit()
    print(f"COMEX gold: {len(rows)} daily closes")


def main() -> None:
    con = connect()
    today = date.today().isoformat()
    for step in (lambda: week_calendar(con, today), lambda: fomc_dates(con, today), lambda: headlines(con),
                 lambda: comex(con)):
        try:
            step()
        except Exception as e:  # noqa: BLE001 - each source fails on its own
            print(f"{type(e).__name__}: {str(e)[:200]}")
    con.close()


if __name__ == "__main__":
    main()
