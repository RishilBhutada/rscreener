"""Rscreener - what each company does, from its Wikipedia article (owner,
15-Oct-2026: "what the company does, under the company name").

Source and licence: the article's own opening paragraphs and its one-line
short description, republished under CC BY-SA 4.0 with the article's title,
link and licence shown beside them on the page. Not Yahoo's or a data
vendor's business summary (licensed text), and never a summary written by a
model (unverified).

Only article pages are read (/wiki/Title). Wikipedia's and Wikidata's APIs,
and Wikidata's query service, are disallowed to programs by their robots.txt,
so they are not used.

A page counts only if its infobox lists the company's own ticker - "NSE: TCS",
or the BSE code for a company listed only on BSE. The title is tried from the
company's registered name in a few spellings; a page that does not carry the
ticker (a namesake, a family, a town) is rejected, so a company without an
article shows nothing rather than someone else's description.

  table company_about(symbol, title, url, short, text, status, checked_at)
        status 'ok' (found and verified) or 'none' (no verified article)

Usage:
  python pipeline/fetch_about.py --symbols TCS,HDFCBANK          a few
  python pipeline/fetch_about.py --all --limit 300               nightly rotation
  options: --refresh (read again regardless of age), --sleep 1.0, --db path
"""
import argparse
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
UA = "RscreenerBot/1.0 (https://rishilbhutada.github.io/rscreener; a personal stock screener) python-requests"
WIKI = "https://en.wikipedia.org/wiki/"
SUFFIX = re.compile(r"[\s,]+(limited|ltd\.?|ltd)$", re.I)
KEEP_UPPER = {"HDFC", "ICICI", "ITC", "NTPC", "ONGC", "SBI", "BHEL", "GAIL", "IRCTC", "NHPC", "LIC", "MRF", "ACC", "UPL",
              "TVS", "DLF", "IDFC", "IDBI", "PNB", "BEL", "HAL", "NMDC", "RBL", "IIFL", "KPIT", "CESC", "JSW", "SJVN",
              "IRFC", "RVNL", "BSE", "CDSL", "MCX", "NBCC", "HUDCO", "IREDA", "SAIL", "IOC", "BPCL", "HPCL", "ABB",
              "AU", "PVR", "INOX", "KEI", "PI", "GMR", "IRB", "NCC", "RITES", "HCL", "LTI", "IT", "AIA", "CG", "CRISIL"}


def ensure(con) -> None:
    con.execute("""CREATE TABLE IF NOT EXISTS company_about (
        symbol TEXT PRIMARY KEY, title TEXT, url TEXT, short TEXT, text TEXT, status TEXT, checked_at TEXT)""")


def spellings(name: str) -> list[str]:
    """Article titles to try, most likely first."""
    base = SUFFIX.sub("", name.strip()).strip(" .,")
    out = []
    if base and not base.isupper():
        out.append(base)
    words = []
    for w in base.split():
        core = re.sub(r"[^A-Za-z]", "", w)
        if core.upper() in KEEP_UPPER or (core.isupper() and len(core) <= 3 and core not in {"AND", "OF", "THE"}):
            words.append(w.upper())
        elif w.isupper() or w.islower():
            words.append(w[:1].upper() + w[1:].lower())
        else:
            words.append(w)
    titled = " ".join(words).replace(" And ", " and ").replace(" Of ", " of ").replace(" The ", " the ")
    for t in (titled, f"{titled} Limited", f"{titled} (company)"):
        if t and t not in out:
            out.append(t)
    return out[:4]


def ticker_pattern(symbol: str, exchange: str, bse_code: str) -> re.Pattern | None:
    """The company's own listing as an infobox writes it: "NSE: TCS", "BSE: 532540"."""
    alts = [] if exchange == "BSE" else [rf"NSE\s*:\s*{re.escape(symbol)}"]
    if bse_code:
        alts.append(rf"BSE\s*:\s*{re.escape(bse_code)}")
    return re.compile(rf"\b(?:{'|'.join(alts)})\b", re.I) if alts else None


def lead(soup: BeautifulSoup) -> str:
    body = soup.select_one("div.mw-parser-output")
    if not body:
        return ""
    for junk in body.select("sup, style, .noprint, .mw-ref, .reference, span.IPA, .rt-commentedText"):
        junk.decompose()
    # Wikipedia's newer pages wrap the article in <section>s; the first is the lead.
    first = body.find("section", recursive=False)
    if first is not None:
        body = first
    paras = []
    for el in body.find_all(recursive=False):
        if el.name in ("h2",) or (el.name == "div" and "mw-heading" in (el.get("class") or [])):
            break
        if el.name == "p" and "mw-empty-elt" not in (el.get("class") or []):
            t = re.sub(r"\s+", " ", el.get_text(" ", strip=True))
            t = re.sub(r"\s+([,.;:)])", r"\1", t)
            t = re.sub(r"\(\s+", "(", t).replace("()", "").strip()
            if len(t) > 40:
                paras.append(t)
        if sum(len(p) for p in paras) >= 450 or len(paras) >= 2:
            break
    text = "\n\n".join(paras)
    return text[:1500].rsplit(" ", 1)[0] + "…" if len(text) > 1500 else text


def lookup(session: requests.Session, symbol: str, name: str, exchange: str, bse_code: str, sleep: float):
    pat = ticker_pattern(symbol, exchange, bse_code)
    if pat is None:
        return None
    for t in spellings(name):
        r = session.get(WIKI + quote(t.replace(" ", "_")), timeout=30)
        time.sleep(sleep)
        if r.status_code != 200:
            continue
        soup = BeautifulSoup(r.text, "lxml")
        box = soup.select_one("table.infobox")
        if not box or not pat.search(box.get_text(" ", strip=True)):
            continue   # a namesake, or an article that does not carry this ticker
        canon = soup.select_one('link[rel="canonical"]')
        url = canon["href"] if canon and canon.get("href") else r.url
        title = (soup.select_one("#firstHeading") or soup.select_one("h1")).get_text(" ", strip=True)
        sd = soup.select_one("div.shortdescription")
        short = sd.get_text(" ", strip=True) if sd else ""
        text = lead(soup)
        if text or short:
            return title, url, short, text
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", help="comma list, or @path")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--sleep", type=float, default=1.0)
    ap.add_argument("--max-minutes", type=float, default=0, help="stop after this long (the nightly's budget)")
    ap.add_argument("--db", default=str(ROOT / "data" / "rscreener.db"))
    a = ap.parse_args()
    con = sqlite3.connect(a.db, timeout=180)
    ensure(con)
    uni = {r[0]: (r[1] or "", r[2] or "NSE", str(r[3] or "").strip()) for r in con.execute(
        'SELECT SYMBOL, "NAME OF COMPANY", EXCHANGE, BSE_CODE FROM universe')}
    if a.symbols:
        raw = Path(a.symbols[1:]).read_text(encoding="utf-8") if a.symbols.startswith("@") else a.symbols
        want = [s.strip().upper() for s in re.split(r"[,\s]+", raw) if s.strip()]
    elif a.all:
        want = sorted(uni, key=lambda s: (uni[s][1] != "NSE", s))   # NSE first, then BSE-only
    else:
        ap.error("--symbols or --all")
    if not a.refresh:
        now = datetime.now(timezone.utc)
        fresh = set()
        for sym, status, at in con.execute("SELECT symbol, status, checked_at FROM company_about"):
            age = now - datetime.fromisoformat(at)
            if (status == "ok" and age < timedelta(days=90)) or (status == "none" and age < timedelta(days=30)):
                fresh.add(sym)
        want = [s for s in want if s not in fresh]
    if a.limit:
        want = want[:a.limit]
    s = requests.Session()
    s.headers["User-Agent"] = UA
    found = none = 0
    began = time.monotonic()
    for sym in want:
        if a.max_minutes and time.monotonic() - began > a.max_minutes * 60:
            print(f"about: stopping at the {a.max_minutes:g}-minute budget")
            break
        name, exch, code = uni.get(sym, ("", "NSE", ""))
        if not name:
            continue
        try:
            got = lookup(s, sym, name, exch, code, a.sleep)
        except requests.RequestException as e:
            print(f"{sym}: {type(e).__name__} - next time")
            continue
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if got:
            con.execute("INSERT OR REPLACE INTO company_about VALUES (?,?,?,?,?,?,?)", (sym, *got, "ok", stamp))
            found += 1
        else:
            con.execute("INSERT OR REPLACE INTO company_about VALUES (?,?,?,?,?,?,?)", (sym, None, None, None, None, "none", stamp))
            none += 1
        con.commit()
    print(f"about: {found} found on Wikipedia, {none} without a verified article, of {len(want)} checked")


if __name__ == "__main__":
    main()
