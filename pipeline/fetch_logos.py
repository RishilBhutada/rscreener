"""Rscreener - each company's own icon, from its own website.

screener.in's app shows a logo beside the name; this is where ours comes from:
the icon the company's site publishes for itself (apple-touch-icon, else the
largest <link rel="icon">, else /favicon.ico), fetched once and kept. The
site's robots.txt is read first and a disallowed site is left alone - the
page then shows the company's initials, as it does for every company without
one.

When the company's own site refuses programs (TCS answers 403 to anything
that is not a browser - a bot check, never worked around) or publishes no
raster icon, the icon is taken from a public favicon service that serves site
icons for anyone to show: DuckDuckGo's, then Google's icon CDN (gstatic,
size 128). Both are read only where their robots.txt allows it (checked
27-Oct-2026; google.com/s2 does not, so it is not used), and only a real
200 answer counts - their "unknown site" placeholder comes back as a 404.

Kept only when it is a raster image the browser draws as an <img>: PNG, JPEG,
WebP, GIF or ICO, at most 80 KB. Never SVG: an SVG served from our own address
can carry script, and a company's file is not ours to vouch for.

Table logos(symbol, mime, data, source, fetched_at, status). One request or
three per company; --limit a night; a company is asked again after a year.

Usage:  python pipeline/fetch_logos.py --limit 150
"""
import argparse
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import requests

import budget

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
UA = "Mozilla/5.0 (compatible; Rscreener/1.0; +https://rishilbhutada.github.io/rscreener/)"
MAX_BYTES = 80_000
MAGIC = [(b"\x89PNG", "image/png"), (b"\xff\xd8\xff", "image/jpeg"), (b"GIF8", "image/gif"),
         (b"RIFF", "image/webp"), (b"\x00\x00\x01\x00", "image/x-icon")]


def kind(data: bytes) -> str | None:
    for sig, mime in MAGIC:
        if data.startswith(sig):
            if mime == "image/webp" and data[8:12] != b"WEBP":
                return None
            return mime
    return None


def allowed(s: requests.Session, base: str, path: str) -> bool:
    """robots.txt, read with requests (RobotFileParser.read() can hang)."""
    try:
        r = s.get(urljoin(base, "/robots.txt"), timeout=15)
        if r.status_code >= 400:
            return True          # no robots.txt: nothing is disallowed
        rp = RobotFileParser()
        rp.parse(r.text.splitlines())
        return rp.can_fetch(UA, urljoin(base, path)) and rp.can_fetch("*", urljoin(base, path))
    except requests.RequestException:
        return False


def icon_links(html: str, base: str) -> list[str]:
    """The site's declared icons, biggest first; apple-touch-icon ahead of the rest."""
    found = []
    for tag in re.findall(r"<link\b[^>]*>", html[:200_000], re.I):
        rel = (re.search(r'rel=["\']([^"\']+)', tag, re.I) or [None, ""])[1].lower()
        href = (re.search(r'href=["\']([^"\']+)', tag, re.I) or [None, ""])[1]
        if not href or "icon" not in rel or href.lower().endswith(".svg") or "mask-icon" in rel:
            continue
        size = max((int(x) for x in re.findall(r"(\d+)x\d+", tag)), default=0)
        found.append((("apple-touch-icon" in rel), size, urljoin(base, href)))
    found.sort(reverse=True)
    return [u for _, _, u in found]


def fetch_icon(s: requests.Session, site: str) -> tuple[str, bytes, str] | str:
    u = urlparse(site if "://" in site else f"https://{site}")
    if u.scheme not in ("http", "https") or not u.netloc:
        return "bad url"
    base = f"{u.scheme}://{u.netloc}/"
    if not allowed(s, base, "/"):
        return "robots"
    try:
        home = s.get(base, timeout=20)
        cands = icon_links(home.text, home.url) if home.ok else []
    except requests.RequestException:
        cands = []
    cands += [urljoin(base, "/apple-touch-icon.png"), urljoin(base, "/favicon.ico")]
    for url in dict.fromkeys(cands):
        try:
            r = s.get(url, timeout=20, stream=True)
            if not r.ok:
                continue
            data = r.raw.read(MAX_BYTES + 1, decode_content=True)
        except requests.RequestException:
            continue
        if not data or len(data) > MAX_BYTES:
            continue
        mime = kind(data)
        if mime:
            return mime, data, url
        time.sleep(0.3)
    return "no icon"


SERVICES = [
    "https://icons.duckduckgo.com/ip3/{host}.ico",
    "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://{host}&size=128",
]


def from_service(s: requests.Session, site: str) -> tuple[str, bytes, str] | None:
    host = urlparse(site if "://" in site else f"https://{site}").netloc.lower()
    host = host[4:] if host.startswith("www.") else host
    if not host:
        return None
    for tpl in SERVICES:
        url = tpl.format(host=host)
        try:
            r = s.get(url, timeout=20)
        except requests.RequestException:
            continue
        if r.status_code != 200 or not r.content or len(r.content) > MAX_BYTES:
            continue
        mime = kind(r.content)
        if mime:
            return mime, r.content, url
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=150)
    ap.add_argument("--symbols", default="", help="comma list (default: every company with a website)")
    ap.add_argument("--sleep", type=float, default=1.0)
    args = ap.parse_args()
    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    con.execute("CREATE TABLE IF NOT EXISTS logos (symbol TEXT PRIMARY KEY, mime TEXT, data BLOB, source TEXT,"
                " fetched_at TEXT, status TEXT)")
    con.commit()
    cols = {r[1] for r in con.execute("PRAGMA table_info(fundamentals)")}
    if "website" not in cols:
        print("logos: no websites stored yet (fetch_fundamentals.py saves them) - nothing to do")
        return
    sites = {s_: w for s_, w in con.execute("SELECT symbol, website FROM fundamentals WHERE website LIKE 'http%'")}
    want = [x.strip().upper() for x in args.symbols.split(",") if x.strip()] or sorted(sites)
    year_ago = (datetime.now(timezone.utc) - timedelta(days=365)).strftime("%Y-%m-%d %H:%M:%S")
    done = {s_ for s_, t in con.execute("SELECT symbol, fetched_at FROM logos") if t >= year_ago}
    due = [x for x in want if x in sites and (args.symbols or x not in done)][:args.limit]
    print(f"logos: {len(due)} companies to look at ({len(done)} held)")
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept": "text/html,image/*;q=0.9,*/*;q=0.5"})
    got = 0
    for i, sym in enumerate(due):
        if budget.stop(i, len(due)):
            break
        res = fetch_icon(s, sites[sym])
        if not isinstance(res, tuple):
            res = from_service(s, sites[sym]) or res
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        if isinstance(res, tuple):
            mime, data, src = res
            con.execute("INSERT OR REPLACE INTO logos VALUES (?,?,?,?,?,?)", (sym, mime, data, src, stamp, "ok"))
            got += 1
        else:
            con.execute("INSERT OR REPLACE INTO logos VALUES (?,?,?,?,?,?)", (sym, None, None, None, stamp, res))
        con.commit()
        time.sleep(args.sleep)
    con.close()
    print(f"logos: {got} of {len(due)} found")


if __name__ == "__main__":
    main()
