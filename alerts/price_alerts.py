"""Rscreener alerts - "tell me when RELIANCE goes above Rs 1,300".

The rules come from two places, merged:
  - the bell on a company page, which keeps them as rs_price_alerts in the
    owner's synced profile ([{"s": "RELIANCE", "op": ">", "p": 1300}, ...]) -
    read with the same read-only key as every other alert (account_list.py);
  - alerts/price_alerts.txt, one rule a line: "RELIANCE > 1300", "TCS < 2900".

Run by the news watcher (pipeline/news_watch.py) every twenty minutes; it only
looks during market hours (Mon-Fri 09:15-15:45 IST). Prices are Yahoo's quote,
about 15 minutes behind the exchange - there is no free live feed, and the
push says how old the price is. Each rule fires at most once a day (ntfy tag
rs-px-<symbol>-<op>-<price>-<date>, read back before sending).

Read-only toward markets: it tells, it never trades.

Usage:  python alerts/price_alerts.py     (NTFY_TOPIC unset = print only)
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from account_list import account_profile  # noqa: E402
from ntfy_lib import post, sent_tags  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))
FILE = Path(__file__).with_name("price_alerts.txt")
SITE = "https://rishilbhutada.github.io/rscreener"
CHART = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1d&interval=5m"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def rules() -> list[tuple[str, str, float]]:
    out = []
    if FILE.exists():
        for line in FILE.read_text(encoding="utf-8").splitlines():
            m = re.fullmatch(r"\s*([A-Z0-9&\-]+)\s*([<>])\s*([0-9]+(?:\.[0-9]+)?)\s*(?:#.*)?", line.split("#")[0] + " ")
            if m:
                out.append((m.group(1), m.group(2), float(m.group(3))))
    prof = account_profile() or {}
    raw = prof.get("rs_price_alerts")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = None
    for r in raw or []:
        if isinstance(r, dict) and isinstance(r.get("s"), str) and r.get("op") in ("<", ">"):
            try:
                out.append((r["s"].upper(), r["op"], float(r["p"])))
            except (TypeError, ValueError, KeyError):
                continue
    return sorted(set(out))


def price(sym: str) -> tuple[float, datetime, float | None] | None:
    for suffix in (".NS", ".BO"):
        try:
            r = requests.get(CHART.format(sym=sym.replace("&", "%26") + suffix), headers={"User-Agent": UA}, timeout=30)
            meta = (r.json().get("chart", {}).get("result") or [{}])[0].get("meta") or {}
        except (requests.RequestException, ValueError):
            continue
        p, t = meta.get("regularMarketPrice"), meta.get("regularMarketTime")
        prev = meta.get("chartPreviousClose") or meta.get("previousClose")
        if p and t:
            return float(p), datetime.fromtimestamp(int(t), IST), (float(prev) if prev else None)
    return None


def main() -> None:
    now = datetime.now(IST)
    if now.weekday() >= 5 or not ((now.hour, now.minute) >= (9, 15) and (now.hour, now.minute) <= (15, 45)):
        print("price alerts: market closed - not checked")
        return
    rs = rules()
    if not rs:
        print("price alerts: no rules")
        return
    sent, fired = sent_tags("rs-px-"), 0
    if sent is None:
        print("price alerts: ntfy topic unreadable - nothing sent, next run")
        return
    quotes: dict[str, tuple[float, datetime, float | None] | None] = {}
    for sym, op, level in rs:
        if sym not in quotes:
            quotes[sym] = price(sym)
        q = quotes[sym]
        if not q:
            continue
        px, at, prev = q
        if at.date() != now.date():
            continue        # yesterday's close (before the first trade, or a holiday) is not a crossing today
        if not ((op == ">" and px >= level) or (op == "<" and px <= level)):
            continue
        # A CROSSING, not a level: "RELIANCE > 1300" used to push every trading
        # day for as long as RELIANCE stayed above 1300 (review alerts-workflows
        # #16). It fires on the day the price goes past the level from the
        # other side of yesterday's close; with no previous close known, as before.
        if prev is not None and ((op == ">" and prev >= level) or (op == "<" and prev <= level)):
            continue
        key = f"rs-px-{re.sub(r'[^A-Za-z0-9]', '', sym)}-{'up' if op == '>' else 'dn'}-{level:g}-{now:%Y%m%d}".replace(".", "p")
        if key in sent:
            continue
        title = f"{sym} {'above' if op == '>' else 'below'} Rs {level:,.2f}"
        body = f"Rs {px:,.2f} at {at:%H:%M} IST (Yahoo's quote, about 15 minutes behind NSE)."
        if post(title, body, tags=f"bell,{key}", click=f"{SITE}/company/?s={sym}"):
            fired += 1
    print(f"price alerts: {len(rs)} rules, {fired} pushed")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - one bad run must not stop the news watcher
        print(f"price alerts: FAILED {type(e).__name__}: {e}"[:300])
