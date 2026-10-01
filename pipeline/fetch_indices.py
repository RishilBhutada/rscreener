"""Rscreener - every NSE index, and the Sensex: candles, valuation, members.

Sources, all open:
  - NSE's daily index file (nsearchives ind_close_all_DDMMYYYY.csv): every
    index's open, high, low, close, volume, turnover, P/E, P/B and dividend
    yield for the day. The nightly top-up; it is the authority for any day it
    covers.
  - NSE Indices (niftyindices.com, whose robots.txt allows it): each index's
    daily candles since it began, and its P/E, P/B and dividend-yield history -
    fetched once per index, after which the daily file carries it.
  - Each index's page on niftyindices.com: the link to its member list (CSV)
    and factsheet. Members are re-read weekly; pages robots.txt disallows are
    skipped.
  - Yahoo for the Sensex (^BSESN), the one BSE index kept: price only, BSE
    publishing no valuation series this reads.

Indices are stored under NSE's own name for them ("Nifty Bank"); the
equity ones are those the daily file gives a P/E for, plus India VIX.

Usage:  python fetch_indices.py [--no-history] [--no-members]
"""
import argparse
import csv
import io
import json
import re
import sqlite3
import time
import urllib.robotparser
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

import budget
import nse_session
import price_periods

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
IST = timezone(timedelta(hours=5, minutes=30))
DAILY = "https://nsearchives.nseindia.com/content/indices/ind_close_all_{dmy}.csv"
NI = "https://www.niftyindices.com"
NI_HOME = NI + "/reports/historical-data"
NI_MAP = "https://liveindexsa.niftyindices.com/assets/json/IndexMapping.json"
NI_OHLC = NI + "/BackPage/getHistoricaldatatabletoString"
NI_PEPB = NI + "/BackPage/getpepbHistoricaldataDBtoString"
NI_MENU = NI + "/indices/equity/broad-based-indices"
YAHOO = "https://query2.finance.yahoo.com/v8/finance/chart/{sym}?period1={p1}&period2={p2}&interval=1d"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
SENSEX = "SENSEX"
VIX = "India VIX"
SLEEP = 1.5


def norm(t: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (t or "").lower().replace("&", "and"))


def num(v) -> float | None:
    try:
        x = float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB, timeout=180)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS idx_bars (
            name TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL,
            volume REAL, turnover REAL, pe REAL, pb REAL, dy REAL, PRIMARY KEY (name, date));
        CREATE TABLE IF NOT EXISTS idx_meta (
            name TEXT PRIMARY KEY, trading TEXT, long_name TEXT, hist_done TEXT,
            page TEXT, csv TEXT, factsheet TEXT, page_at TEXT, members_at TEXT);
        CREATE TABLE IF NOT EXISTS idx_members (
            name TEXT, symbol TEXT, company TEXT, industry TEXT, PRIMARY KEY (name, symbol));
    """)
    return con


def top_up(con: sqlite3.Connection) -> None:
    """The daily file for every weekday since the newest one stored."""
    last = con.execute("SELECT MAX(date) FROM idx_bars WHERE name != ?", (SENSEX,)).fetchone()[0]
    today = datetime.now(IST).date()
    d = max(date.fromisoformat(last) - timedelta(days=3), today - timedelta(days=20)) if last else today - timedelta(days=12)
    s = nse_session.new_session()
    days = rows = 0
    while d <= today:
        if d.weekday() < 5:
            try:
                r = nse_session.get(s, DAILY.format(dmy=d.strftime("%d%m%Y")), tries=2)
                text = r.text.lstrip("﻿")
            except Exception:  # noqa: BLE001 - a holiday is a 404; any day can be retried tomorrow
                text = ""
            if text.startswith("Index Name"):
                for x in csv.DictReader(io.StringIO(text)):
                    name = (x.get("Index Name") or "").strip()
                    pe = num(x.get("P/E"))
                    if not name or (pe is None and name != VIX):
                        continue
                    close = num(x.get("Closing Index Value"))
                    if not close:
                        continue
                    con.execute("INSERT OR REPLACE INTO idx_bars VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
                        name, d.isoformat(), num(x.get("Open Index Value")) or close,
                        num(x.get("High Index Value")) or close, num(x.get("Low Index Value")) or close, close,
                        num(x.get("Volume")), num(x.get("Turnover (Rs. Cr.)")), pe,
                        num(x.get("P/B")), num(x.get("Div Yield"))))
                    con.execute("INSERT OR IGNORE INTO idx_meta (name) VALUES (?)", (name,))
                    rows += 1
                days += 1
            time.sleep(0.5)
        d += timedelta(days=1)
    con.commit()
    print(f"daily index files: {days} days read, {rows} index rows written")


def ni_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Content-Type": "application/json; charset=utf-8",
                      "Accept": "application/json, text/javascript, */*; q=0.01",
                      "X-Requested-With": "XMLHttpRequest", "Origin": NI, "Referer": NI_HOME})
    s.get(NI_HOME, timeout=30)
    return s


def ni_call(s: requests.Session, url: str, trading: str, long: str, start: str, end: str) -> list[dict]:
    cinfo = "{'name':'%s','startDate':'%s','endDate':'%s','indexName':'%s'}" % (trading.upper(), start, end, long)
    r = s.post(url, data=json.dumps({"cinfo": cinfo}), timeout=120)
    try:
        j = r.json()
    except ValueError:
        return []
    d = j.get("d", j) if isinstance(j, dict) else j
    d = json.loads(d) if isinstance(d, str) else d
    return d if isinstance(d, list) else []


def history(con: sqlite3.Connection) -> None:
    """Each index's candles since it began, and its valuation history - once."""
    todo = [n for (n,) in con.execute(
        "SELECT name FROM idx_meta WHERE hist_done IS NULL AND name != ? ORDER BY name", (SENSEX,))]
    if not todo:
        print("index history: every index already has its history")
        return
    s = ni_session()
    mapping: dict[str, dict] = {}
    for x in json.loads(s.get(NI_MAP, timeout=40).content.decode("utf-8-sig")):
        mapping.setdefault(norm(x["Index_long_name"]), x)
        mapping.setdefault(norm(x["Trading_Index_Name"]), x)
    end = datetime.now(IST).strftime("%d-%b-%Y")
    done = 0
    for i, name in enumerate(todo):
        if budget.stop(i, len(todo), "index histories"):
            break
        base = re.sub(r"\s+index$", "", name, flags=re.I)
        m = mapping.get(norm(name)) or mapping.get(norm(base))
        tries = ([(m["Trading_Index_Name"], m["Index_long_name"])] if m else []) + [(name, name), (base, base)]
        ohlc, used = [], None
        for trading, long in dict.fromkeys(tries):
            ohlc = ni_call(s, NI_OHLC, trading, long, "01-Jan-1990", end)
            time.sleep(SLEEP)
            if ohlc:
                used = (trading, long)
                break
        rows = []
        for x in ohlc:
            try:
                d = datetime.strptime(str(x.get("HistoricalDate", "")).strip(), "%d %b %Y").date().isoformat()
            except ValueError:
                continue
            c = num(x.get("CLOSE"))
            if c:
                rows.append((name, d, num(x.get("OPEN")) or c, num(x.get("HIGH")) or c, num(x.get("LOW")) or c, c))
        # The daily file's rows stand; history only fills the days before.
        con.executemany("INSERT OR IGNORE INTO idx_bars (name, date, open, high, low, close) VALUES (?,?,?,?,?,?)", rows)
        vals = ni_call(s, NI_PEPB, *(used or (name, name)), "01-Jan-1999", end) if used else []
        time.sleep(SLEEP)
        nv = 0
        for x in vals:
            try:
                d = datetime.strptime(str(x.get("DATE", "")).strip(), "%d %b %Y").date().isoformat()
            except ValueError:
                continue
            pe, pb, dy = num(x.get("pe")), num(x.get("pb")), num(x.get("divYield"))
            cur = con.execute("UPDATE idx_bars SET pe=COALESCE(pe,?), pb=COALESCE(pb,?), dy=COALESCE(dy,?) WHERE name=? AND date=?",
                              (pe, pb, dy, name, d))
            nv += cur.rowcount
        con.execute("UPDATE idx_meta SET trading=?, long_name=?, hist_done=? WHERE name=?",
                    (used[0] if used else None, used[1] if used else None, datetime.now(IST).date().isoformat(), name))
        con.commit()
        done += 1
        print(f"  {name}: {len(rows)} days of candles" + (f" from {min(r[1] for r in rows)}" if rows else " - none found")
              + f", {nv} days of valuation")
    print(f"index history: {done} of {len(todo)} indices fetched this run")


def sensex(con: sqlite3.Connection) -> None:
    last = con.execute("SELECT MAX(date) FROM idx_bars WHERE name=?", (SENSEX,)).fetchone()[0]
    p1 = int(datetime(1997, 7, 1).timestamp()) if not last else int(
        datetime.fromisoformat(last).timestamp()) - 10 * 86400
    r = requests.get(YAHOO.format(sym="%5EBSESN", p1=p1, p2=int(time.time())), headers={"User-Agent": UA}, timeout=60)
    r.raise_for_status()
    res = (r.json().get("chart", {}).get("result") or [None])[0] or {}
    q = (res.get("indicators", {}).get("quote") or [{}])[0]
    o, h, lo, c, v = (q.get(k) or [] for k in ("open", "high", "low", "close", "volume"))
    at = lambda arr, i: arr[i] if i < len(arr) else None  # noqa: E731
    rows = []
    for i, ts in enumerate(res.get("timestamp") or []):
        close = at(c, i)
        if not close:
            continue
        rows.append((SENSEX, price_periods.ist_date(ts), round(at(o, i) or close, 2), round(at(h, i) or close, 2),
                     round(at(lo, i) or close, 2), round(close, 2), at(v, i)))
    # The session in progress is not a close.
    today = datetime.now(IST)
    rows = [x for x in rows if x[1] < today.date().isoformat() or today.hour >= 16]
    con.executemany("INSERT OR REPLACE INTO idx_bars (name, date, open, high, low, close, volume) VALUES (?,?,?,?,?,?,?)", rows)
    con.execute("INSERT OR IGNORE INTO idx_meta (name, hist_done) VALUES (?, ?)", (SENSEX, today.date().isoformat()))
    con.commit()
    print(f"Sensex: {len(rows)} days from Yahoo")


def members(con: sqlite3.Connection) -> None:
    """Each index's member list from the CSV its page links, weekly."""
    today = datetime.now(IST).date()
    week_ago = (today - timedelta(days=7)).isoformat()
    todo = [(n, page, csv_url, page_at) for n, page, csv_url, page_at in con.execute(
        "SELECT name, page, csv, page_at FROM idx_meta WHERE name NOT IN (?, ?) "
        "AND (members_at IS NULL OR members_at < ?) ORDER BY name", (SENSEX, VIX, week_ago))]
    if not todo:
        print("index members: all read this week")
        return
    s = requests.Session()
    s.headers["User-Agent"] = UA
    # Read with a timeout and this script's own agent: robotparser's read()
    # has neither, and the site stalls the default Python agent indefinitely.
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(s.get(NI + "/robots.txt", timeout=30).text.splitlines())
    menu = s.get(NI_MENU, timeout=40).text
    pages = {}
    for href in set(re.findall(r'href="(/indices/equity/[^"#?]+)"', menu)):
        slug = href.rstrip("/").split("/")[-1]
        pages.setdefault(norm(slug), NI + href)
    got = 0
    for i, (name, page, csv_url, page_at) in enumerate(todo):
        if budget.stop(i, len(todo), "index member lists"):
            break
        if not csv_url or not page_at or page_at < (today - timedelta(days=30)).isoformat():
            page = pages.get(norm(name)) or pages.get(norm(re.sub(r"\s+index$", "", name, flags=re.I)))
            csv_url = fact = None
            if page and rp.can_fetch(UA, page):
                html = s.get(page, timeout=40).text
                time.sleep(SLEEP)
                m = re.search(r'href="([^"]*IndexConstituent/[^"]+\.csv)"', html)
                f = re.search(r'href="([^"]*/Factsheet/[^"]+\.pdf)"', html)
                csv_url = (m.group(1) if m.group(1).startswith("http") else NI + m.group(1)) if m else None
                fact = (f.group(1) if f.group(1).startswith("http") else NI + f.group(1)) if f else None
            con.execute("UPDATE idx_meta SET page=?, csv=?, factsheet=?, page_at=? WHERE name=?",
                        (page, csv_url, fact, today.isoformat(), name))
        if csv_url:
            r = s.get(csv_url, timeout=40)
            time.sleep(SLEEP)
            text = r.text.lstrip("﻿")
            if r.status_code == 200 and text.startswith("Company Name"):
                rows = [(name, x["Symbol"].strip(), x.get("Company Name", "").strip(), x.get("Industry", "").strip())
                        for x in csv.DictReader(io.StringIO(text)) if (x.get("Symbol") or "").strip()]
                if rows:
                    con.execute("DELETE FROM idx_members WHERE name=?", (name,))
                    con.executemany("INSERT OR REPLACE INTO idx_members VALUES (?,?,?,?)", rows)
                    got += 1
        con.execute("UPDATE idx_meta SET members_at=? WHERE name=?", (today.isoformat(), name))
        con.commit()
    print(f"index members: {got} of {len(todo)} lists read")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-history", action="store_true")
    ap.add_argument("--no-members", action="store_true")
    a = ap.parse_args()
    con = connect()
    budget.announce("indices")
    for step in (top_up, sensex, *(() if a.no_history else (history,)), *(() if a.no_members else (members,))):
        try:
            step(con)
        except Exception as e:  # noqa: BLE001 - each source fails on its own
            print(f"{step.__name__}: {type(e).__name__}: {str(e)[:200]}")
    con.close()


if __name__ == "__main__":
    main()
