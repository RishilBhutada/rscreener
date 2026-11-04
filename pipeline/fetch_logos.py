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
size 128). Each service's own robots.txt is read once a run and a service it
disallows is skipped (google.com/s2 disallows, so it is not listed), and only
a real 200 answer counts - their "unknown site" placeholder comes back as a
404. Never for a company whose robots.txt disallows us: a site that says no
gets its initials, not someone else's copy of its icon. A site whose
robots.txt cannot be read at all (it is down, or answers with a server
error) is not contacted further - RFC 9309 says to treat that as "no" for
the site itself - but nothing says it objects, so the services are asked.

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
import urllib3

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


# What reading a response body can raise besides requests' own errors: a
# streamed body is read through urllib3 (r.raw), whose ProtocolError,
# ReadTimeoutError and DecodeError are not requests.RequestException.
NET_ERRORS = (requests.RequestException, urllib3.exceptions.HTTPError, OSError)


def read_robots(s: requests.Session, base: str) -> RobotFileParser | None:
    """robots.txt, read with requests (RobotFileParser.read() can hang).
    None when it cannot be read - a network error or a server error - which
    RFC 9309 says to treat as "everything disallowed" for that site."""
    try:
        r = s.get(urljoin(base, "/robots.txt"), timeout=15)
        text = r.text
    except NET_ERRORS:
        return None
    if r.status_code >= 500:
        return None
    rp = RobotFileParser()
    # A 4xx means no robots.txt: nothing is disallowed (RFC 9309).
    rp.parse([] if r.status_code >= 400 else text.splitlines())
    return rp


def may_fetch(rp: RobotFileParser, url: str) -> bool:
    return rp.can_fetch(UA, url) and rp.can_fetch("*", url)


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
    rp = read_robots(s, base)
    if rp is None:
        return "unreachable"
    if not may_fetch(rp, base):
        return "robots"
    try:
        home = s.get(base, timeout=20)
        cands = icon_links(home.text, home.url) if home.ok else []
    except NET_ERRORS:
        cands = []
    cands += [urljoin(base, "/apple-touch-icon.png"), urljoin(base, "/favicon.ico")]
    for url in dict.fromkeys(cands):
        if not may_fetch(rp, url):
            continue
        try:
            with s.get(url, timeout=20, stream=True) as r:
                if not r.ok:
                    continue
                data = r.raw.read(MAX_BYTES + 1, decode_content=True)
        except NET_ERRORS:
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


_service_robots: dict[str, RobotFileParser | None] = {}


def from_service(s: requests.Session, site: str) -> tuple[str, bytes, str] | None:
    """The icon from a public favicon service, each read only where its own
    robots.txt allows (read once a run per service; unreadable = skipped)."""
    host = urlparse(site if "://" in site else f"https://{site}").netloc.lower()
    host = host[4:] if host.startswith("www.") else host
    if not host:
        return None
    for tpl in SERVICES:
        url = tpl.format(host=host)
        su = urlparse(url)
        sbase = f"{su.scheme}://{su.netloc}/"
        if sbase not in _service_robots:
            _service_robots[sbase] = read_robots(s, sbase)
        rp = _service_robots[sbase]
        if rp is None or not may_fetch(rp, url):
            continue
        try:
            r = s.get(url, timeout=20)
        except NET_ERRORS:
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
        # Never for "robots": the company said no, so it keeps its initials.
        if not isinstance(res, tuple) and res != "robots":
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
