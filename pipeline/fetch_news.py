"""Rscreener - market news, broker calls and institutional deals, every
twenty minutes through the day (owner, 15-Oct-2026).

Everything goes into a small database of its own, data/news.db (stored as
news.db.gz on the data-db release), so the watcher that runs this all day
never has to download the 1.3 GB main database.

  news   headlines from publishers' feeds that allow programs - Mint's
         markets and companies feeds, Economic Times' markets, stock-news and
         recommendations feeds - and GDELT's index of Indian business news
         (one request at a time, five seconds apart, as GDELT asks).
         Moneycontrol, NDTV Profit and Business Standard answer programs with
         403 and are not used. Headline and link only: the article stays on
         its site.
  calls  a broker's call on a stock read from a headline - "Citi maintains
         sell on Hindustan Zinc" - when the headline names a known
         institution, a rating word and a listed company. Third-party
         opinion, reported by the news; never Rscreener's.
  deals  NSE's bulk and block deals: who bought or sold how many shares at
         what price (the exchange's own disclosure).
  sast   NSE's SAST Regulation 29 disclosures: acquirers and promoters
         crossing ownership thresholds.
  names  the stock-name index the headlines are tagged with, refreshed by the
         nightly from the main database (--names-from).

Not fetched: NSE's insider-trading (PIT) feed answers only with 2021-22
records, and BSE's data service refuses programs. Consensus ratings
(Refinitiv, S&P, Trendlyne) are licensed and are not scraped.

Usage:
  python pipeline/fetch_news.py                       feeds, GDELT, deals, SAST
  python pipeline/fetch_news.py --names-from data/rscreener.db --backfill-days 365
"""
import argparse
import html
import json
import re
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nse_session  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "news.db"
UA = "Mozilla/5.0 (compatible; RscreenerBot/1.0; +https://rishilbhutada.github.io/rscreener)"
# url: (publisher, keep only headlines that name a listed company). Mint's
# companies feed carries world business and lifestyle stories too.
FEEDS = {
    "https://www.livemint.com/rss/markets": ("Mint", False),
    "https://www.livemint.com/rss/companies": ("Mint", True),
    "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms": ("Economic Times", False),
    "https://economictimes.indiatimes.com/markets/stocks/news/rssfeeds/2146842.cms": ("Economic Times", False),
    "https://economictimes.indiatimes.com/markets/stocks/recos/rssfeeds/3053611.cms": ("Economic Times", False),
}
GDELT = "https://api.gdeltproject.org/api/v2/doc/doc"
GDELT_QUERIES = [
    '("target price" OR "maintains buy" OR "maintains sell" OR "upgrades" OR "downgrades" OR "initiates coverage" '
    'OR "top picks" OR overweight OR underweight) (NSE OR Nifty OR Sensex OR India) sourcecountry:IN sourcelang:english',
]
KEEP_DAYS = 400

# Institutions whose calls are read from headlines - brokers and research desks.
BROKERS = [
    "Morgan Stanley", "Goldman Sachs", "JP Morgan", "JPMorgan", "Citi", "Citigroup", "CLSA", "Jefferies", "Nomura",
    "Macquarie", "UBS", "HSBC", "BofA Securities", "BofA", "Bank of America", "Bernstein", "BNP Paribas", "Investec",
    "Kotak Institutional Equities", "Kotak Securities", "Motilal Oswal", "Nuvama", "ICICI Securities", "IIFL Securities",
    "IIFL", "Emkay", "Elara Capital", "Elara", "Axis Securities", "Axis Capital", "HDFC Securities", "Sharekhan",
    "Prabhudas Lilladher", "PL Capital", "Anand Rathi", "Antique", "Ambit", "Equirus", "InCred", "JM Financial",
    "Phillip Capital", "PhillipCapital", "Systematix", "Geojit", "SBI Securities", "Religare", "Centrum",
    "YES Securities", "Dolat Capital", "DAM Capital", "Nirmal Bang", "Arihant Capital", "Choice Broking",
    "Deven Choksey", "ICICI Direct", "Spark Capital", "Avendus", "B&K Securities", "Monarch Networth",
    "Bajaj Broking", "LKP Securities", "Asit C Mehta", "Ventura", "Mirae Asset",
]
BROKER_RE = re.compile(r"\b(" + "|".join(re.escape(b) for b in sorted(BROKERS, key=len, reverse=True)) + r")\b")
CANON = {"JPMorgan": "JP Morgan", "Citigroup": "Citi", "BofA Securities": "BofA", "Bank of America": "BofA",
         "Elara": "Elara Capital", "IIFL": "IIFL Securities", "PhillipCapital": "Phillip Capital", "PL Capital": "Prabhudas Lilladher"}
RATING_WORDS = [
    (r"strong buy|outperform|overweight|accumulate|bullish|buy|add", "Buy"),
    (r"equal[- ]weight|market perform|in-line|neutral|hold", "Hold"),
    (r"underperform|underweight|bearish|reduce|sell", "Sell"),
]
# A rating counts only in rating phrasing - "maintains buy", "buy rating",
# "Buy X, target" - never as an ordinary word ("OLX buy can deliver").
VERBS = (r"maintains?|reiterates?|retains?|keeps?|recommends?|rates?|initiates?(?:\s+coverage)?(?:\s+with)?|"
         r"upgrades?(?:\s+\w+)?\s+to|downgrades?(?:\s+\w+)?\s+to|remains?|stays?|turns?|has\s+an?|with\s+an?|assigns?|"
         r"gives?|retained|maintained|upgraded\s+to|downgraded\s+to")
PICKS = re.compile(r"top\s+picks?|stocks?\s+to\s+buy|suggests|recommends", re.I)


def rating_of(text: str) -> tuple[str, str] | None:
    for words, bucket in RATING_WORDS:
        for pat in (rf"\b(?:{VERBS})\s+(?:a\s+|an\s+|its\s+|the\s+)?({words})\b",
                    rf"\b({words})\s+(?:rating|call|recommendation|stance)\b",
                    rf"^\s*({words})\s+[A-Z]"):
            m = re.search(pat, text, re.I)
            if m:
                return bucket, m.group(1).lower()
    if PICKS.search(text):
        return "Buy", "top pick"
    return None
TARGET = re.compile(r"target(?:\s+price)?(?:\s+(?:of|to|at))?\s*(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)", re.I)
SUFFIX = re.compile(r"[\s,]+(limited|ltd\.?|ltd)$", re.I)
COMMON = {"india", "indian", "bharat", "hindustan", "national", "global", "united", "general", "new", "first", "tata",
          "adani", "bajaj", "reliance", "mahindra", "birla", "jindal", "power", "gold", "future", "capital", "steel",
          "bank", "energy", "sun", "apollo", "jet", "star", "royal", "eastern", "western", "southern", "northern",
          "premier", "standard", "super", "prime", "max", "zee", "jk", "shree", "sri", "the", "orient", "indo",
          # words and names a headline uses for something else ("Ahead of Market",
          # "Morgan Stanley", "Akash Ambani")
          "market", "markets", "stock", "stocks", "share", "shares", "money", "value", "smart", "digital", "ahead",
          "today", "record", "results", "profit", "dividend", "split", "bonus", "check", "world", "wealth", "growth",
          "vision", "alpha", "ultra", "mega", "metro", "city", "union", "central", "federal", "morgan", "stanley",
          "goldman", "sachs", "nasdaq", "bitcoin", "crypto", "amul", "fidelity", "blackrock", "fairfax", "akash",
          "isha", "anant", "mukesh", "ambani", "gautam", "ratan", "kiran", "rahul", "anand", "vijay", "sanjay",
          "rajesh", "suresh", "ramesh", "mahesh", "dinesh", "ashok", "sunil", "anil", "vinod", "manoj", "deepak",
          "trump", "modi", "china", "japan", "europe", "america", "dollar", "rupee", "silver", "crude", "oil",
          "sensex", "nifty", "rally", "crash", "surge", "jumps", "falls", "gains", "lakh", "crore", "brand", "brands",
          "health", "care", "pharma", "finance", "infra", "solar", "green", "metal", "metals", "auto", "motors"}


def connect(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(path, timeout=180)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS news (url TEXT PRIMARY KEY, t TEXT, title TEXT, src TEXT, syms TEXT);
        CREATE TABLE IF NOT EXISTS calls (url TEXT, t TEXT, broker TEXT, symbol TEXT, rating TEXT, bucket TEXT,
                                          target REAL, title TEXT, PRIMARY KEY (url, broker, symbol));
        CREATE TABLE IF NOT EXISTS deals (d TEXT, symbol TEXT, name TEXT, client TEXT, side TEXT, qty INTEGER,
                                          price REAL, kind TEXT, PRIMARY KEY (d, symbol, client, side, qty, kind));
        CREATE TABLE IF NOT EXISTS sast (app TEXT PRIMARY KEY, t TEXT, symbol TEXT, company TEXT, acquirer TEXT,
                                         side TEXT, shares INTEGER, after INTEGER, promoter TEXT, period TEXT, doc TEXT);
        CREATE TABLE IF NOT EXISTS names (alias TEXT PRIMARY KEY, symbol TEXT, exact INTEGER);
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    """)
    return con


# ── the stock-name index ────────────────────────────────────────────────────

def build_names(con, main_db: str) -> None:
    """Aliases a headline can name a company by: its registered name without
    "Limited", its Wikipedia title, a distinctive first word, and the ticker
    itself when it is a word (ITC, NTPC). exact=1: match case-sensitively."""
    m = sqlite3.connect(f"file:{main_db}?mode=ro", uri=True)
    rows = m.execute('SELECT SYMBOL, "NAME OF COMPANY" FROM universe').fetchall()
    about = {}
    if m.execute("SELECT 1 FROM sqlite_master WHERE name='company_about'").fetchone():
        about = dict(m.execute("SELECT symbol, title FROM company_about WHERE status='ok'"))
    m.close()
    alias: dict[str, tuple[str, int]] = {}
    firsts: dict[str, set] = {}
    for sym, name in rows:
        base = SUFFIX.sub("", (name or "").strip()).strip(" .,")
        plain = re.sub(r"\s*\(.*?\)\s*", " ", base).strip()
        for a in {base, plain, about.get(sym) or ""}:
            if len(a) >= 4 and " " in a:
                alias.setdefault(a.lower(), (sym, 0))
        if plain:
            firsts.setdefault(plain.split()[0].lower(), set()).add(sym)
        if sym.isalpha() and 3 <= len(sym) <= 6:
            alias.setdefault(sym, (sym, 1))
    for w, syms in firsts.items():
        if len(syms) == 1 and len(w) >= 5 and w not in COMMON and w.isalpha():
            alias.setdefault(w.capitalize(), (next(iter(syms)), 1))
    # Names the press uses that the registers do not.
    for a, s in {"RIL": "RELIANCE", "L&T": "LT", "M&M": "M&M", "SBI": "SBIN", "HUL": "HINDUNILVR", "IndiGo": "INDIGO",
                 "Airtel": "BHARTIARTL", "Maruti": "MARUTI", "UltraTech": "ULTRACEMCO", "Sun Pharma": "SUNPHARMA",
                 "Dr Reddy's": "DRREDDY", "HCLTech": "HCLTECH", "Kotak Bank": "KOTAKBANK", "Power Grid": "POWERGRID",
                 "Adani Ports": "ADANIPORTS", "Bajaj Finserv": "BAJAJFINSV", "Eicher": "EICHERMOT", "Hero MotoCorp": "HEROMOTOCO",
                 "Zomato": "ETERNAL", "Eternal": "ETERNAL", "Paytm": "PAYTM", "Nykaa": "NYKAA", "Titan": "TITAN",
                 "Infosys": "INFY", "Wipro": "WIPRO", "Nestle India": "NESTLEIND", "Coal India": "COALINDIA"}.items():
        alias[a if a.isupper() or not a.islower() else a] = (s, 1 if " " not in a else 0)
    con.execute("DELETE FROM names")
    con.executemany("INSERT OR REPLACE INTO names VALUES (?,?,?)",
                    [(a, s, e) for a, (s, e) in alias.items()])
    con.commit()
    print(f"names: {len(alias)} aliases for {len(rows)} companies")


class Tagger:
    def __init__(self, con):
        rows = con.execute("SELECT alias, symbol, exact FROM names").fetchall()
        self.loose = {a.lower(): s for a, s, e in rows if not e}
        self.exact = {a: s for a, s, e in rows if e}
        self.loose_re = re.compile(r"\b(" + "|".join(re.escape(a) for a in sorted(self.loose, key=len, reverse=True)) + r")\b", re.I) if self.loose else None
        self.exact_re = re.compile(r"(?<![\w&])(" + "|".join(re.escape(a) for a in sorted(self.exact, key=len, reverse=True)) + r")(?![\w&])") if self.exact else None

    def __call__(self, text: str) -> list[str]:
        out, spans = [], []
        for rx, table, low in ((self.loose_re, self.loose, True), (self.exact_re, self.exact, False)):
            if rx is None:
                continue
            for m in rx.finditer(text):
                if any(m.start() < e and s < m.end() for s, e in spans):
                    continue
                sym = table.get(m.group(1).lower() if low else m.group(1))
                if sym and sym not in out:
                    out.append(sym)
                    spans.append((m.start(), m.end()))
        return out


def calls_in(title: str, tag: Tagger) -> list[dict]:
    """A broker's rating on a stock, per clause: the institution, a rating word
    and a listed company in the same clause."""
    head = re.sub(r"^\s*buy,\s*sell\s*or\s*hold\s*:\s*", "", title, flags=re.I)
    out = []
    for clause in re.split(r";|\|", head):
        b = BROKER_RE.search(clause)
        if not b:
            continue
        broker = CANON.get(b.group(1), b.group(1))
        rest = BROKER_RE.sub(" ", clause)          # a broker is never the stock (Motilal Oswal is both)
        got = rating_of(rest)
        bucket, rating = got if got else (None, None)
        tm = TARGET.search(clause)
        target = float(tm.group(1).replace(",", "")) if tm else None
        move = re.search(r"\b(raises|hikes|ups|cuts|trims|lowers|reduces)\b[^;]*?\btarget", clause, re.I)
        if bucket is None and target is None and not move:
            continue
        if rating is None and move:
            rating = "target raised" if move.group(1).lower() in ("raises", "hikes", "ups") else "target cut"
        for sym in tag(rest):
            out.append({"broker": broker, "symbol": sym, "rating": rating, "bucket": bucket, "target": target})
    return out


def save(con, tag: Tagger, url: str, seen: datetime, title: str, src: str) -> bool:
    title = re.sub(r"\s+", " ", html.unescape(title or "")).strip()
    now = datetime.now(timezone.utc)
    if not url or not title or seen < now - timedelta(days=7):
        return False
    # In UTC: a feed's "01:46 +0530" printed as-is with a Z would sit 5.5 hours
    # in the future (it did, 15-Oct-2026: every new headline read "just now").
    t = min(seen, now).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    syms = tag(BROKER_RE.sub(" ", title))   # "Morgan Stanley" names a broker, not two stocks
    new = con.execute("INSERT OR IGNORE INTO news VALUES (?,?,?,?,?)", (url, t, title, src, json.dumps(syms))).rowcount
    for c in calls_in(title, tag):
        con.execute("INSERT OR IGNORE INTO calls VALUES (?,?,?,?,?,?,?,?)",
                    (url, t, c["broker"], c["symbol"], c["rating"], c["bucket"], c["target"], title))
    return bool(new)


def feed_date(s: str):
    s = (s or "").strip()
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def feeds(con, tag: Tagger) -> int:
    def field(item: str, name: str) -> str:
        m = re.search(rf"<{name}[^>]*>(.*?)</{name}>", item, flags=re.S)
        return re.sub(r"<!\[CDATA\[|\]\]>", "", m.group(1)).strip() if m else ""
    n = 0
    for url, (src, tagged_only) in FEEDS.items():
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=40)
            r.raise_for_status()
        except requests.RequestException as e:
            print(f"news: {urlparse(url).netloc} {type(e).__name__}")
            continue
        for item in re.findall(r"<item\b.*?</item>", r.content.decode("utf-8", "replace"), flags=re.S):
            seen = feed_date(field(item, "pubDate"))
            title = field(item, "title")
            if seen and (not tagged_only or tag(BROKER_RE.sub(" ", html.unescape(title)))):
                n += save(con, tag, html.unescape(field(item, "link")), seen, title, src)
        time.sleep(1)
    return n


def gdelt(con, tag: Tagger) -> int:
    n = 0
    for q in GDELT_QUERIES:
        params = {"query": q, "mode": "artlist", "format": "json", "maxrecords": 100, "timespan": "2d", "sort": "datedesc"}
        r = None
        for wait in (8, 20, None):
            r = requests.get(GDELT, params=params, headers={"User-Agent": UA}, timeout=60)
            if r.status_code != 429 or wait is None:
                break
            time.sleep(wait)
        if r is None or r.status_code != 200:
            print(f"news: GDELT HTTP {r.status_code if r is not None else '-'}")
            continue
        try:
            arts = r.json().get("articles") or []
        except ValueError:
            continue
        for a in arts:
            try:
                seen = datetime.strptime(a.get("seendate", ""), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            title = a.get("title") or ""
            # GDELT's net is wide: keep only what names a listed company.
            if tag(title):
                n += save(con, tag, a.get("url") or "", seen, title, (a.get("domain") or "").removeprefix("www."))
        time.sleep(6)
    return n


# ── exchange disclosures ────────────────────────────────────────────────────

def deals(con, days: int) -> int:
    s = nse_session.new_session()
    nse_session.prime(s)
    n = 0
    end = date.today()
    start = end - timedelta(days=days)
    f = lambda d: d.strftime("%d-%m-%Y")
    while start <= end:
        # A week at a time: a month in one request came back cut short.
        stop = min(start + timedelta(days=6), end)
        for kind in ("bulk", "block"):
            url = (f"{nse_session.HOME}/api/historicalOR/bulk-block-short-deals?optionType={kind}_deals"
                   f"&from={f(start)}&to={f(stop)}")
            try:
                r = s.get(url, timeout=40)
                rows = (r.json() or {}).get("data") or []
            except (requests.RequestException, ValueError) as e:
                print(f"deals: {kind} {f(start)} {type(e).__name__}")
                continue
            for x in rows:
                try:
                    d = datetime.strptime(x["BD_DT_DATE"], "%d-%b-%Y").date().isoformat()
                except (KeyError, ValueError):
                    continue
                n += con.execute("INSERT OR IGNORE INTO deals VALUES (?,?,?,?,?,?,?,?)",
                                 (d, x.get("BD_SYMBOL"), x.get("BD_SCRIP_NAME"), (x.get("BD_CLIENT_NAME") or "").strip(),
                                  (x.get("BD_BUY_SELL") or "").upper(), int(x.get("BD_QTY_TRD") or 0),
                                  float(x.get("BD_TP_WATP") or 0), kind)).rowcount
            time.sleep(1.5)
        start = stop + timedelta(days=1)
    con.commit()
    return n


def sast(con) -> int:
    s = nse_session.new_session()
    nse_session.prime(s)
    try:
        rows = (s.get(f"{nse_session.HOME}/api/corporate-sast-reg29?index=equities", timeout=40).json() or {}).get("data") or []
    except (requests.RequestException, ValueError) as e:
        print(f"sast: {type(e).__name__}")
        return 0
    n = 0
    num = lambda v: int(float(v)) if v not in (None, "", "-") else None
    for x in rows:
        try:   # "12-Oct-2026 12:36", Indian time
            t = datetime.strptime((x.get("timestamp") or "").strip(), "%d-%b-%Y %H:%M").replace(tzinfo=timezone(timedelta(hours=5, minutes=30)))
            ts = t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            ts = None
        side = "Sale" if (x.get("acqSaleType") or "").lower().startswith("sale") else "Acquisition"
        shares = num(x.get("noOfShareSale")) if side == "Sale" else num(x.get("noOfShareAcq"))
        n += con.execute("INSERT OR IGNORE INTO sast VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                         (x.get("application_no"), ts, x.get("symbol"), x.get("company"), x.get("acquirerName"), side,
                          shares, num(x.get("noOfShareAft")), x.get("promoterType"), x.get("acquirerDate"),
                          x.get("attachement"))).rowcount
    con.commit()
    return n


def prune(con) -> None:
    cut = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%d")
    con.execute("DELETE FROM news WHERE t < ?", (cut,))
    con.execute("DELETE FROM calls WHERE t < ?", (cut,))
    con.execute("DELETE FROM deals WHERE d < ?", (cut,))
    con.execute("DELETE FROM sast WHERE t < ?", (cut,))
    con.commit()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DB))
    ap.add_argument("--names-from", default="", help="the main database, to rebuild the stock-name index")
    ap.add_argument("--deal-days", type=int, default=7, help="how far back to read bulk/block deals")
    ap.add_argument("--no-gdelt", action="store_true")
    a = ap.parse_args()
    con = connect(Path(a.db))
    if a.names_from:
        build_names(con, a.names_from)
    tag = Tagger(con)
    before = {k: con.execute(f"SELECT COUNT(*) FROM {k}").fetchone()[0] for k in ("news", "calls", "deals", "sast")}
    f = feeds(con, tag)
    g = 0 if a.no_gdelt else gdelt(con, tag)
    con.commit()
    d = deals(con, a.deal_days)
    s = sast(con)
    prune(con)
    after = {k: con.execute(f"SELECT COUNT(*) FROM {k}").fetchone()[0] for k in ("news", "calls", "deals", "sast")}
    new = sum(max(0, after[k] - before[k]) for k in after)
    con.execute("INSERT OR REPLACE INTO meta VALUES ('fetched', ?)", (datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),))
    con.commit()
    print(f"news: {f} new from feeds, {g} from GDELT; deals +{d}; SAST +{s}; "
          f"now {after['news']} headlines, {after['calls']} broker calls, {after['deals']} deals, {after['sast']} SAST filings")
    # The watcher reads this line to decide whether to publish.
    print(f"NEW_ROWS={new}")


if __name__ == "__main__":
    main()
