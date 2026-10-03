"""Rscreener - the gold page's inputs.

  - The week's scheduled releases: Forex Factory's public calendar feed
    (nfs.faireconomy.media, robots.txt allows all). It carries only the
    current week, so the history builds from the nightly snapshots.
  - Every FOMC decision date, past and scheduled: federalreserve.gov's
    meeting calendar (2021 onwards) - enough to measure gold's reaction to
    the Fed from the first run.
  - The official release schedules, past and coming, so the calendar looks
    months ahead and more kinds of event can be measured: BEA (GDP, PCE),
    the Census Bureau (retail sales), the ECB's meeting calendar and the
    Bank of Japan's meeting list (each site's robots.txt allows it).
  - With a FRED_API_KEY secret (free, from the St. Louis Fed): the dates of
    CPI, the jobs report, PPI, JOLTS and jobless claims since 2021 and
    ahead, and the actual figure of each release the night it comes out.
    BLS, which publishes them, refuses programs; FRED republishes them.
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
import os
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
from gold_lib import ANNOUNCE, ECB_PAST, INDIA_EVENTS, clean_title, family_of, rate_headline

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
# Last year's schedule, this year's, and next year's once it is published
# (until then its page is empty, or missing).
BEA = ["https://www.bea.gov/news/schedule/full-{prev}", "https://www.bea.gov/news/schedule/full",
       "https://www.bea.gov/news/schedule/full-{next}"]
CENSUS = ["https://www.census.gov/economic-indicators/calendar-listview-{prev}.html",
          "https://www.census.gov/economic-indicators/calendar-listview.html",
          "https://www.census.gov/economic-indicators/calendar-listview-{next}.html"]
FED_CALENDAR = "https://www.federalreserve.gov/json/calendar.json"
ECB = "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html"
BOJ = ["https://www.boj.or.jp/en/mopo/mpmsche_minu/past.htm", "https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm"]
FRED = "https://api.stlouisfed.org/fred"
# FRED release id: (family, title, New York time, a word the release's name must contain)
FRED_RELEASES = {
    10: ("us_cpi", "US CPI inflation", (8, 30), "Consumer Price"),
    50: ("us_jobs", "US jobs report", (8, 30), "Employment Situation"),
    46: ("us_ppi", "US producer prices (PPI)", (8, 30), "Producer Price"),
    192: ("us_labour_minor", "US job openings (JOLTS)", (10, 0), "Job Openings"),
    180: ("us_claims", "US jobless claims", (8, 30), "Claims"),
}
# Forex Factory title: (FRED series, how the calendar writes the figure)
ACTUALS = {
    "CPI m/m": ("CPIAUCSL", "mm"), "Core CPI m/m": ("CPILFESL", "mm"), "CPI y/y": ("CPIAUCNS", "yy"),
    "Non-Farm Employment Change": ("PAYEMS", "change_k"), "Unemployment Rate": ("UNRATE", "level_pct"),
    "Average Hourly Earnings m/m": ("CES0500000003", "mm"), "Core PCE Price Index m/m": ("PCEPILFE", "mm"),
    "PPI m/m": ("PPIFIS", "mm"), "Retail Sales m/m": ("RSAFS", "mm"),
    "JOLTS Job Openings": ("JTSJOL", "level_m"), "Unemployment Claims": ("ICSA", "level_k"),
    "Advance GDP q/q": ("A191RL1Q225SBEA", "level_pct"), "Prelim GDP q/q": ("A191RL1Q225SBEA", "level_pct"),
    "Final GDP q/q": ("A191RL1Q225SBEA", "level_pct"),
}
# FRED's own release dates: the headline figure of each, and what it is.
FRED_HEADLINE = {
    "us_cpi": ("CPIAUCSL", "mm", " m/m"), "us_jobs": ("PAYEMS", "change_k", " payrolls"),
    "us_ppi": ("PPIFIS", "mm", " m/m"), "us_labour_minor": ("JTSJOL", "level_m", " openings"),
    "us_claims": ("ICSA", "level_k", " claims"),
}
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


def upsert_event(con, key, when_utc, country, title, impact, forecast, previous, actual, source, today,
                 family: str | None = None):
    con.execute("""
        INSERT INTO gold_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(key) DO UPDATE SET when_utc=excluded.when_utc, impact=excluded.impact,
            title=excluded.title, source=excluded.source,
            forecast=COALESCE(NULLIF(excluded.forecast,''), gold_events.forecast),
            previous=COALESCE(NULLIF(excluded.previous,''), gold_events.previous),
            actual=COALESCE(NULLIF(excluded.actual,''), gold_events.actual),
            family=excluded.family, last_seen=excluded.last_seen""",
        (key, when_utc, country, title, impact, forecast, previous, actual,
         family or family_of(title, country, impact), source, today, today))


def get(url: str) -> str:
    r = requests.get(url, headers={"User-Agent": UA}, timeout=60)
    r.raise_for_status()
    return r.content.decode("utf-8", "replace")


def plain(s: str) -> str:
    s = re.sub(r"<script.*?</script>|<style.*?</style>", " ", s, flags=re.S)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))).strip()


def stamp(when: datetime) -> str:
    return when.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ny_time(day: date, hm: str | tuple[int, int]) -> datetime:
    if isinstance(hm, str):  # "8:30 AM"
        t = datetime.strptime(hm.strip().upper(), "%I:%M %p")
        hm = (t.hour, t.minute)
    return datetime(day.year, day.month, day.day, hm[0], hm[1], tzinfo=NY)


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
                         "USD", title, "High", "", "", "", "federalreserve.gov", today, family="fomc")
            n += 1
    con.commit()
    print(f"FOMC: {n} decision dates from {FED}")


def bea(con, today: str) -> None:
    """GDP and PCE inflation (BEA's Personal Income and Outlays), last year's
    schedule and this year's, past dates and coming ones."""
    n = 0
    year = int(today[:4])
    for url in BEA:
        url = url.format(prev=year - 1, next=year + 1)
        try:
            page = get(url)
        except requests.RequestException as e:
            print(f"BEA: {url} {type(e).__name__}")
            continue
        y = re.search(r"Year\s*(\d{4})", plain(page[page.find("<table"):][:3000])) or re.search(r"full-(\d{4})", url)
        if not y:
            print(f"BEA: no year on {url}")
            continue
        year = int(y.group(1))
        for row in re.findall(r'<tr class="scheduled-releases-type-press">(.*?)</tr>', page, flags=re.S):
            d = re.search(r'release-date">([^<]+)<', row)
            t = re.search(r"<small[^>]*>([^<]+)<", row)
            name = re.search(r"release-title[^>]*>(.*?)</td>", row, flags=re.S)
            if not (d and t and name):
                continue
            name = plain(name.group(1))
            gdp = re.match(r"GDP \(([^)]+)\).*?(\d)(?:st|nd|rd|th) Quarter (\d{4})", name)
            if gdp:
                fam, title = "us_growth", f"US GDP, Q{gdp.group(2)} {gdp.group(3)} ({gdp.group(1).lower()})"
            elif name.startswith("Personal Income and Outlays,"):
                fam, title = "us_pce", f"US PCE inflation, {name.split(',', 1)[1].strip()}"
            else:
                continue
            try:
                day = datetime.strptime(f"{d.group(1).strip()} {year}", "%B %d %Y").date()
                when = ny_time(day, t.group(1))
            except ValueError:
                continue
            upsert_event(con, f"bea|{fam}|{day}", stamp(when), "USD", title, "High", "", "", "", "BEA release schedule",
                         today, family=fam)
            n += 1
        time.sleep(1)
    con.commit()
    print(f"BEA: {n} GDP and PCE release dates")


def census(con, today: str) -> None:
    """Retail sales (the Census Bureau's advance monthly report)."""
    n = 0
    year = int(today[:4])
    for url in CENSUS:
        url = url.format(prev=year - 1, next=year + 1)
        try:
            page = plain(get(url))
        except requests.RequestException as e:
            print(f"Census: {url} {type(e).__name__}")
            continue
        for d, t, period in re.findall(
                r"Advance Monthly Sales for Retail and Food Services\s+([A-Z][a-z]+ \d{1,2}, \d{4})\s+"
                r"(\d{1,2}:\d{2} [AP]M)\s+([A-Z][a-z]+ \d{4})", page):
            try:
                day = datetime.strptime(d, "%B %d, %Y").date()
                when = ny_time(day, t)
            except ValueError:
                continue
            upsert_event(con, f"census|retail|{day}", stamp(when), "USD", f"US retail sales, {period}", "High",
                         "", "", "", "Census Bureau schedule", today, family="us_growth")
            n += 1
        time.sleep(1)
    con.commit()
    print(f"Census: {n} retail-sales release dates")


def ecb(con, today: str) -> None:
    """ECB decisions: the meeting day followed by a press conference, decided
    at 14:15 Frankfurt time. The ECB's page lists only meetings ahead - kept
    here as they pass - and past ones come from gold_lib.ECB_PAST."""
    n = 0
    for d, m, y in re.findall(r"(\d{2})/(\d{2})/(\d{4}) Governing Council of the ECB: monetary policy meeting"
                              r"[^/]*?followed by press conference", plain(get(ECB))):
        when = datetime(int(y), int(m), int(d), 14, 15, tzinfo=ZoneInfo("Europe/Berlin"))
        upsert_event(con, f"ecb|{when.date()}", stamp(when), "EUR", "ECB rate decision", "High", "", "", "",
                     "ECB meeting calendar", today, family="ecb")
        n += 1
    for d in ECB_PAST:
        day = date.fromisoformat(d)
        when = datetime(day.year, day.month, day.day, 14, 15, tzinfo=ZoneInfo("Europe/Berlin"))
        upsert_event(con, f"ecb|{d}", stamp(when), "EUR", "ECB rate decision", "High", "", "", "",
                     "ECB meeting calendar (archived copies, 2025)", today, family="ecb")
    con.commit()
    print(f"ECB: {n} coming decisions, {len(ECB_PAST)} past ones from the kept list")


def fed_calendar(con, today: str) -> None:
    """The Fed Board's own calendar: the Chair's and governors' speeches and
    testimony, FOMC minutes and the Beige Book, from 2021 and as far ahead as
    the Board has announced. New speeches appear here as they are scheduled."""
    r = requests.get(FED_CALENDAR, headers={"User-Agent": UA}, timeout=60)
    r.raise_for_status()
    rows = json.loads(r.content.decode("utf-8-sig")).get("events") or []
    n = 0
    for x in rows:
        kind, title, month = x.get("type"), plain(x.get("title") or ""), x.get("month") or ""
        if not re.fullmatch(r"20\d\d-\d\d", month) or month < "2021-01":
            continue
        desc = plain(html.unescape(x.get("description") or ""))
        chair = False
        if kind in ("Speeches", "Testimony"):
            who = re.split(r"\s+-+\s+", title, maxsplit=1)[-1].strip()
            # "Chair Jerome H. Powell", "Chairman Kevin Warsh" - not a Vice Chair
            chair = bool(re.match(r"Chair(man|woman)?\b", who))
            fam = "fed_chair" if chair else "fed_member"
            verb = "testifies" if kind == "Testimony" else "speaks"
            label = f"Fed {who} {verb}" + (f": {desc}" if desc and len(desc) < 90 else "")
        elif kind == "FOMC" and "Minutes" in title:
            fam, who, label = "fomc_minutes", "minutes", f"FOMC minutes{(' (' + desc + ')') if desc else ''}"
        elif kind == "Beige":
            fam, who, label = "beige_book", "beige", "Fed Beige Book"
        else:
            continue
        day = re.match(r"\s*(\d{1,2})", x.get("days") or "")
        tm = re.match(r"\s*(\d{1,2}):(\d{2})\s*([ap])", x.get("time") or "", flags=re.I)
        if not day:
            continue
        try:
            d = date(int(month[:4]), int(month[5:7]), int(day.group(1)))
        except ValueError:
            continue
        hh = (int(tm.group(1)) % 12 + (12 if tm.group(3).lower() == "p" else 0)) if tm else 12
        when = ny_time(d, (hh, int(tm.group(2)) if tm else 0))
        upsert_event(con, f"fedcal|{kind}|{d}|{who}", stamp(when), "USD", label, "High" if chair else "Medium",
                     "", "", "", "federalreserve.gov calendar" + ("" if tm else " (hour not given)"), today,
                     family=fam)
        n += 1
    con.commit()
    print(f"Fed calendar: {n} speeches, testimonies, minutes and Beige Books since 2021")


def us_holidays(year: int) -> set[date]:
    """US federal holidays as observed (a Saturday holiday on the Friday, a
    Sunday one on the Monday)."""
    def nth(month: int, weekday: int, n: int) -> date:
        d = date(year, month, 1)
        d += timedelta(days=(weekday - d.weekday()) % 7)
        return d + timedelta(weeks=n - 1)

    def last(month: int, weekday: int) -> date:
        d = date(year, month + 1, 1) - timedelta(days=1)
        return d - timedelta(days=(d.weekday() - weekday) % 7)

    fixed = [date(year, 1, 1), date(year, 6, 19), date(year, 7, 4), date(year, 11, 11), date(year, 12, 25)]
    observed = {d - timedelta(days=1) if d.weekday() == 5 else d + timedelta(days=1) if d.weekday() == 6 else d
                for d in fixed}
    return observed | {nth(1, 0, 3), nth(2, 0, 3), last(5, 0), nth(9, 0, 1), nth(10, 0, 2), nth(11, 3, 4)}


def ism(con, today: str) -> None:
    """ISM's two PMIs, from ISM's published rule - manufacturing on the first
    business day of the month, services on the third, both at 10:00 New York
    time. ISM's own calendar is drawn by script; these dates are worked out,
    and the week's calendar replaces them when it lists the release."""
    t = date.fromisoformat(today)
    n = 0
    for k in range(-14, 15):
        y, m = divmod(t.month - 1 + k, 12)
        first = date(t.year + y, m + 1, 1)
        hol = us_holidays(first.year)
        days, d = [], first
        while len(days) < 3:
            if d.weekday() < 5 and d not in hol:
                days.append(d)
            d += timedelta(days=1)
        covers = (first - timedelta(days=1)).strftime("%B %Y")
        for name, d in (("manufacturing", days[0]), ("services", days[2])):
            upsert_event(con, f"ism|{name}|{d}", stamp(ny_time(d, (10, 0))), "USD",
                         f"US ISM {name} PMI, {covers}", "High", "", "", "", "ISM rule (date worked out)", today,
                         family="us_growth")
            n += 1
    con.commit()
    print(f"ISM: {n} PMI dates worked out")


def india(con, today: str) -> None:
    """India's scheduled events from the hand-kept list in gold_lib."""
    for d, hm, fam, title, src in INDIA_EVENTS:
        day = date.fromisoformat(d)
        when = datetime(day.year, day.month, day.day, int(hm[:2]), int(hm[3:]),
                        tzinfo=timezone(timedelta(hours=5, minutes=30)))
        upsert_event(con, f"india|{fam}|{d}", stamp(when), "INR", title, "High", "", "", "", src, today, family=fam)
    con.commit()
    print(f"India: {len(INDIA_EVENTS)} scheduled events from the hand-kept list")


def boj(con, today: str) -> None:
    """Bank of Japan decisions since 2021 and the ones scheduled: the last
    day of each meeting. The Bank announces when the meeting ends, usually
    around noon in Tokyo; 12:00 JST (03:00 UTC) stands in for the hour."""
    n = 0
    for url in BOJ:
        page = get(url)
        for cap, body in re.findall(r"<caption[^>]*>(.*?)</caption>(.*?)</table>", page, flags=re.S):
            y = re.search(r"(20\d\d)", plain(cap))
            if not y or int(y.group(1)) < 2021:
                continue
            for row in re.findall(r"<tr.*?</tr>", body, flags=re.S):
                cells = re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, flags=re.S)
                if not cells:
                    continue
                first = re.sub(r"\(.*?\)|\[.*?\]", " ", plain(cells[0]))
                mon, last = None, None
                for name, day in re.findall(r"(?:([A-Z][a-z]{2,4})\.?\s+)?(\d{1,2})\b", first):
                    if name:
                        mon = MON3.get(name.lower()[:3])
                    if mon:
                        last = (mon, int(day))
                if not last:
                    continue
                try:
                    when = datetime(int(y.group(1)), last[0], last[1], 3, 0, tzinfo=timezone.utc)
                except ValueError:
                    continue
                upsert_event(con, f"boj|{when.date()}", stamp(when), "JPY", "Bank of Japan rate decision", "High",
                             "", "", "", "Bank of Japan (hour approximate)", today, family="boj")
                n += 1
        time.sleep(1)
    con.commit()
    print(f"Bank of Japan: {n} decision dates")


def fred(path: str, **params) -> dict:
    """One FRED call. The key travels only inside the request: a failure
    names the path and the status, never the URL that carries the key."""
    try:
        r = requests.get(f"{FRED}/{path}", headers={"User-Agent": UA}, timeout=40,
                         params={**params, "api_key": os.environ["FRED_API_KEY"].strip(), "file_type": "json"})
    except requests.RequestException as e:
        raise RuntimeError(f"FRED {path}: {type(e).__name__}") from None
    time.sleep(0.6)  # FRED allows 120 calls a minute
    if r.status_code != 200:
        raise RuntimeError(f"FRED {path}: HTTP {r.status_code}")
    return r.json()


def fred_dates(con, today: str) -> None:
    for rid, (fam, title, hm, word) in FRED_RELEASES.items():
        try:
            name = ((fred("release", release_id=rid).get("releases") or [{}])[0]).get("name", "")
            if word.lower() not in name.lower():
                print(f"FRED: release {rid} is {name!r}, not {word} - skipped")
                continue
            got = fred("release/dates", release_id=rid, realtime_start="2021-01-01", realtime_end="9999-12-31",
                       include_release_dates_with_no_data="true", sort_order="asc", limit=10000)
        except RuntimeError as e:
            print(e)
            continue
        n = 0
        for x in got.get("release_dates") or []:
            try:
                day = date.fromisoformat(x["date"])
            except (KeyError, ValueError):
                continue
            upsert_event(con, f"fred|{fam}|{day}", stamp(ny_time(day, hm)), "USD", title, "High", "", "", "",
                         "FRED (St. Louis Fed)", today, family=fam)
            n += 1
        con.commit()
        print(f"FRED: {name} - {n} release dates")


def figure(new: list[tuple[str, float]], how: str) -> str | None:
    """A FRED series, newest first, written the way the calendar writes it."""
    v = new[0][1]
    if how == "mm" and len(new) > 1:
        x = (v / new[1][1] - 1) * 100
    elif how == "yy":
        year_ago = f"{int(new[0][0][:4]) - 1}{new[0][0][4:]}"
        base = next((b for d, b in new if d == year_ago), None)
        if base is None:
            return None
        x = (v / base - 1) * 100
    elif how == "change_k" and len(new) > 1:
        return f"{round(v - new[1][1])}K"
    elif how == "level_pct":
        x = v
    elif how == "level_m":
        return f"{v / 1000:.2f}M"
    elif how == "level_k":
        return f"{round(v / 1000)}K"
    else:
        return None
    return f"{0.0 if abs(x) < 0.05 else x:.1f}%"


def fred_actuals(con) -> None:
    """The actual figure of each US release, from the FRED vintage of its
    release day - the number as first published, before later revisions. A
    release counts only if that day's vintage has a newer reading than the
    day before's. The week's calendar rows from the last 60 days, and FRED's
    own release dates from the last year (the headline figure of each)."""
    now = datetime.now(timezone.utc)
    rows = con.execute("SELECT key, when_utc, title, family, source FROM gold_events WHERE COALESCE(actual,'')='' "
                       "AND ((source='forexfactory' AND country='USD' AND when_utc >= ?) "
                       "  OR (source LIKE 'FRED%' AND when_utc >= ?)) AND when_utc <= ? ORDER BY when_utc DESC",
                       (stamp(now - timedelta(days=60)), stamp(now - timedelta(days=380)),
                        stamp(now - timedelta(hours=2)))).fetchall()
    n = 0
    for key, when, title, family, source in rows[:120]:  # two calls each; FRED allows 120 a minute
        spec = ACTUALS.get(title) if source == "forexfactory" else FRED_HEADLINE.get(family)
        if not spec:
            continue
        sid, how = spec[:2]
        suffix = spec[2] if len(spec) > 2 else ""
        day = datetime.fromisoformat(when.replace("Z", "+00:00")).astimezone(NY).date()
        try:
            obs = fred("series/observations", series_id=sid, realtime_start=str(day), realtime_end=str(day),
                       sort_order="desc", limit=14).get("observations") or []
            before = fred("series/observations", series_id=sid, realtime_start=str(day - timedelta(days=1)),
                          realtime_end=str(day - timedelta(days=1)), sort_order="desc", limit=1).get("observations") or []
        except RuntimeError as e:
            print(e)
            continue
        new = [(o["date"], float(o["value"])) for o in obs if re.fullmatch(r"-?[\d.]+", o.get("value") or "")]
        old = [(o["date"], float(o["value"])) for o in before if re.fullmatch(r"-?[\d.]+", o.get("value") or "")]
        # Nothing new that day: the release slipped, or FRED had not caught up.
        if not new or (old and old[0][0] == new[0][0] and abs(old[0][1] - new[0][1]) < 1e-9):
            continue
        fig = figure(new, how)
        if fig:
            con.execute("UPDATE gold_events SET actual=? WHERE key=?", (fig + suffix, key))
            n += 1
    con.commit()
    print(f"FRED: {n} actual figures filled in")


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
    # The news tab shows a week. Announcements (a central bank buying, a duty
    # change) stay on the calendar for a year; everything else goes.
    now = datetime.now(timezone.utc)
    cut, year = stamp(now - timedelta(days=21)), stamp(now - timedelta(days=400))
    old = con.execute("SELECT url, seen_utc, title FROM gold_news WHERE seen_utc < ?", (cut,)).fetchall()
    for url, seen, title in old:
        rated = rate_headline(clean_title(title))
        if seen < year or not rated or rated[1] not in ANNOUNCE:
            con.execute("DELETE FROM gold_news WHERE url=?", (url,))
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
    steps = [lambda: week_calendar(con, today), lambda: fomc_dates(con, today), lambda: fed_calendar(con, today),
             lambda: bea(con, today), lambda: census(con, today), lambda: ecb(con, today), lambda: boj(con, today),
             lambda: ism(con, today), lambda: india(con, today)]
    if os.environ.get("FRED_API_KEY", "").strip():
        steps += [lambda: fred_dates(con, today), lambda: fred_actuals(con)]
    else:
        print("FRED: no FRED_API_KEY secret - CPI, jobs, PPI, JOLTS and claims dates come from the week's calendar "
              "only, and actual figures are not filled in")
    for step in steps + [lambda: headlines(con), lambda: comex(con)]:
        try:
            step()
        except Exception as e:  # noqa: BLE001 - each source fails on its own
            print(f"{type(e).__name__}: {str(e)[:200]}")
    con.close()


if __name__ == "__main__":
    main()
