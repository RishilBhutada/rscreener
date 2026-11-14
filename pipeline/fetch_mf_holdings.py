"""Rscreener - mutual funds' monthly holdings of each listed company.

Owner, 14-Nov-2026: "C2 for the mutual funds" - the top fund houses' own
monthly portfolio files, found the way a visitor finds them.

Each fund house publishes its schemes' holdings every month (a SEBI rule).
Some link the files plainly; most build the list in the page with
JavaScript, so those pages are opened in a headless browser (Playwright) and
the links read off them - a normal visit, nothing more. A site that refuses
programs is left out, never worked around: HDFC answers 403; Kotak's page is
guarded; ICICI, UTI, Axis, Franklin, Canara and Bandhan showed no files to a
plain visit on 14-Nov-2026; Mirae's lists only some schemes. Coverage is therefore PART of mutual-fund money,
and every figure built on it says so.

Table mf_holdings (month, amc, symbol, shares, value, schemes)
      mf_months   (amc, month, files, stocks, fetched_at)  - a month read once

Usage:  python pipeline/fetch_mf_holdings.py [--months 12] [--minutes 25]
"""
import argparse
import re
import sqlite3
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import requests

import mf_holdings_lib as lib

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# render: the page builds its list with JavaScript. include / exclude are
# tested against the decoded link (and its text).
SOURCES = [
    {"amc": "SBI", "page": "https://www.sbimf.com/portfolios", "render": True,
     "include": r"all-schemes-monthly-portfolio"},
    {"amc": "Nippon India", "page": "https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures",
     "render": False, "include": r"NIMF-MONTHLY-PORTFOLIO"},
    {"amc": "Aditya Birla SL", "page": "https://mutualfund.adityabirlacapital.com/forms-and-downloads/portfolio", "render": True,
     "include": r"/monthly-portfolio/"},
    # Mirae Asset (miraeassetmf.co.in/downloads/portfolios) is left out: its
    # page shows about 10 of its schemes' files a month, so a total from it
    # would understate its holdings without saying so (14-Nov-2026).
    {"amc": "Motilal Oswal", "page": "https://www.motilaloswalmf.com/download/month-end-portfolio", "render": True,
     "include": r"month-end-portfolio"},
    {"amc": "Tata", "page": "https://www.tatamutualfund.com/schemes-related/portfolio", "render": True,
     "include": r"monthly portfolio"},
    {"amc": "DSP", "page": "https://www.dspim.com/mandatory-disclosures/portfolio-disclosures", "render": False,
     "include": r"monthend-portfolio", "exclude": r"debt"},
    {"amc": "PPFAS", "page": "https://amc.ppfas.com/downloads/portfolio-disclosure/", "render": False,
     "include": r"monthly[_-]portfolio"},
    {"amc": "Invesco", "page": "https://invescomutualfund.com/literature-and-form?tab=Complete", "render": True,
     "include": r"completes-monthly-holding"},
]
EXCLUDE_ALWAYS = r"fortnight|half[-_ ]?year|riskometer|factsheet|debt-portfolio|isin-debt"

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def month_of(text: str) -> str | None:
    """The portfolio month ("YYYY-MM") a file name or link text names.
    "31st October 2026", "31-Oct-26", "31102026", "july--2026", "oct2026"."""
    t = urllib.parse.unquote(text).lower()
    mon = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[^a-z0-9]{0,3}"
    # A four-digit year first, a day allowed in between ("October_31_2026");
    # only then a two-digit one ("31-Oct-26"), or 31 would read as 2031.
    m = re.search(mon + r"(?:\d{1,2}(?:st|nd|rd|th)?[^a-z0-9]{1,3})?(20\d{2})(?!\d)", t) \
        or re.search(mon + r"(\d{2})(?!\d)", t)
    if m:
        y = int(m.group(2))
        return f"{y if y > 99 else 2000 + y:04d}-{MONTHS[m.group(1)]:02d}"
    m = re.search(r"(?<!\d)(\d{2})(\d{2})(20\d{2})(?!\d)", t)        # ddmmyyyy
    if m and 1 <= int(m.group(2)) <= 12:
        return f"{m.group(3)}-{m.group(2)}"
    return None


def static_links(s: requests.Session, page: str) -> list[tuple[str, str]]:
    html = s.get(page, timeout=60).text
    out = []
    for href in re.findall(r'href="([^"]+\.(?:xlsx?|zip)[^"]*)"', html, re.I):
        out.append((urllib.parse.urljoin(page, href), ""))
    return out


def rendered_links(pages: list[str]) -> dict[str, list[tuple[str, str]]]:
    """{page: [(href, link text)]} after the page's own scripts have run."""
    from playwright.sync_api import sync_playwright
    out: dict[str, list] = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(user_agent=UA)
        for url in pages:
            pg = ctx.new_page()
            try:
                pg.goto(url, timeout=60000, wait_until="domcontentloaded")
                pg.wait_for_timeout(8000)
                out[url] = pg.eval_on_selector_all(
                    "a[href]", "els => els.map(e => [e.href, (e.closest('tr,li,div') || e).innerText.slice(0, 200)])")
            except Exception as e:  # noqa: BLE001 - one site down must not stop the rest
                print(f"  {url}: not read ({type(e).__name__})")
                out[url] = []
            pg.close()
        b.close()
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=12, help="months back to read on a first run")
    ap.add_argument("--minutes", type=float, default=25)
    a = ap.parse_args()
    stop_at = time.monotonic() + a.minutes * 60
    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    con.execute("CREATE TABLE IF NOT EXISTS mf_holdings (month TEXT, amc TEXT, symbol TEXT, shares REAL, value REAL, "
                "schemes INTEGER, PRIMARY KEY (month, amc, symbol))")
    con.execute("CREATE TABLE IF NOT EXISTS mf_months (amc TEXT, month TEXT, files INTEGER, stocks INTEGER, fetched_at TEXT, "
                "PRIMARY KEY (amc, month))")
    isin = {str(i).strip().upper(): s for s, i in con.execute('SELECT SYMBOL, "ISIN NUMBER" FROM universe')
            if i}
    done = {(r[0], r[1]) for r in con.execute("SELECT amc, month FROM mf_months")}
    s = requests.Session()
    s.headers.update({"User-Agent": UA})

    try:
        rendered = rendered_links([x["page"] for x in SOURCES if x["render"]])
    except ImportError:
        print("  playwright is not installed - only the plainly linked fund houses are read")
        rendered = {}

    now = datetime.now(timezone.utc)
    oldest = f"{now.year - (1 if now.month <= a.months % 12 else 0) - a.months // 12:04d}-01"
    for src in SOURCES:
        amc = src["amc"]
        try:
            links = rendered.get(src["page"], []) if src["render"] else static_links(s, src["page"])
        except requests.RequestException as e:
            print(f"  {amc}: page not read ({type(e).__name__})")
            continue
        by_month: dict[str, set] = {}
        for href, text in links:
            name = urllib.parse.unquote(href) + " " + (text or "")
            # Exclusions on the FILE name and link text only: Nippon keeps its
            # monthly portfolios in a folder called "FactsheetsDocuments".
            leaf = urllib.parse.unquote(href).rsplit("/", 1)[-1] + " " + (text or "")
            if not re.search(src["include"], name, re.I) or re.search(EXCLUDE_ALWAYS, leaf, re.I):
                continue
            if src.get("exclude") and re.search(src["exclude"], leaf, re.I):
                continue
            m = month_of(urllib.parse.unquote(href).rsplit("/", 1)[-1]) or month_of(text or "")
            if m:
                by_month.setdefault(m, set()).add(href)
        want = sorted((m for m in by_month if (amc, m) not in done), reverse=True)[:a.months]
        if not by_month:
            print(f"  {amc}: no monthly files found on the page")
            continue
        for month in want:
            if time.monotonic() > stop_at:
                print("  stopped at the time limit - the rest next run")
                con.close()
                return
            total: dict[str, list] = {}
            files = 0
            for href in sorted(by_month[month]):
                try:
                    r = s.get(href, timeout=120)
                    r.raise_for_status()
                    h = lib.holdings(r.content, set(isin), href)
                except Exception as e:  # noqa: BLE001
                    print(f"  {amc} {month}: a file could not be read ({type(e).__name__})")
                    continue
                files += 1
                for code, (sh, val, sc) in h.items():
                    t = total.setdefault(isin[code], [0.0, 0.0, 0])
                    t[0] += sh
                    t[1] += val
                    t[2] += sc
                time.sleep(0.5)
            if not files or len(total) < 20:
                print(f"  {amc} {month}: {files} file(s), {len(total)} stocks - too few, not stored")
                continue
            stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            with con:
                con.executemany("INSERT OR REPLACE INTO mf_holdings VALUES (?,?,?,?,?,?)",
                                [(month, amc, sym, v[0], v[1], v[2]) for sym, v in total.items()])
                con.execute("INSERT OR REPLACE INTO mf_months VALUES (?,?,?,?,?)", (amc, month, files, len(total), stamp))
            print(f"  {amc} {month}: {files} file(s), {len(total)} stocks")
    con.close()


if __name__ == "__main__":
    main()
