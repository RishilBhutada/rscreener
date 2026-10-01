"""Rscreener - the physical (mandi) price beside each NCDEX contract.

From Agmarknet, the Government of India's agricultural market-price service
(agmarknet.gov.in, whose robots.txt allows reading). Two of its open feeds:

  - a market's prices for one commodity over the last week, for contracts
    whose delivery centre is an APMC mandi (Unjha for jeera, Deesa for
    castor, Nizamabad for turmeric, ...)
  - a state's arrival-weighted price for the last three reporting days, for
    pepper, whose Kochi trade does not report as a mandi

Prices are rupees per quintal, stored as reported; the export turns them
into each contract's quoted unit. A day the mandi did not report ("NR") is
no row. The feeds reach back only a week, so the history grows nightly, as
NCDEX's own does. Agmarknet's longer reports sit behind a CAPTCHA, which is
a bot check and is not touched.

Usage:  python fetch_spot.py
"""
import re
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

from commodities_lib import SPOT

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
API = "https://api.agmarknet.gov.in/v1"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Origin": "https://agmarknet.gov.in",
    "Referer": "https://agmarknet.gov.in/",
    "Accept": "application/json",
}


def market_week(s: requests.Session, cmdt: int, market: int, state: int, variety: str | None) -> list[tuple[str, float]]:
    r = s.get(f"{API}/prices-and-arrivals/commodity-price/lastweek",
              params={"marketId": market, "stateId": state, "commodityId": cmdt, "includeExcel": "false"}, timeout=40)
    r.raise_for_status()
    rows = r.json().get("data") or []
    if variety:
        rows = [x for x in rows if variety in str(x.get("variety", "")).lower()]
    out = []
    for x in rows[:1]:          # one variety per contract; the first that matched
        if str(x.get("unitOfPrice", "")).lower().replace(" ", "") != "rs./quintal":
            continue
        for k, v in x.items():
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", k) and isinstance(v, (int, float)) and v > 0:
                out.append((k, float(v)))
    return out


def state_days(s: requests.Session, cmdt: int, state: int) -> list[tuple[str, float]]:
    body = {"dashboard": "marketwise_price_arrival", "date": datetime.now().strftime("%Y-%m-%d"),
            "commodity": [cmdt], "state": state}
    r = s.post(f"{API}/dashboard-data/", json=body, timeout=40)
    r.raise_for_status()
    data = r.json().get("data")
    if not isinstance(data, dict) or not data.get("records"):
        return []
    # The three price columns carry their own dates in their titles.
    titles = {}
    for g in data.get("columns", []):
        for c in g.get("columns", []):
            titles[c.get("key")] = c.get("title")
    rec = data["records"][0]
    out = []
    for key in ("as_on_price", "one_day_ago_price", "two_day_ago_price"):
        try:
            d = datetime.strptime(str(titles.get(key)), "%d %b, %Y").date().isoformat()
            v = float(rec.get(key))
        except (TypeError, ValueError):
            continue
        if v > 0:
            out.append((d, v))
    return out


def main() -> None:
    con = sqlite3.connect(DB, timeout=180)
    con.execute("""CREATE TABLE IF NOT EXISTS commodity_spot (
        root TEXT, date TEXT, price REAL, source TEXT, PRIMARY KEY (root, date))""")
    s = requests.Session()
    s.headers.update(HEADERS)
    stored = failed = 0
    done: dict[tuple, list] = {}
    for root, m in SPOT.items():
        key = (m["cmdt"], m["market"], m["state"], m.get("variety"))
        try:
            if key not in done:      # jeera's two contracts share Unjha's price
                done[key] = (market_week(s, m["cmdt"], m["market"], m["state"], m.get("variety"))
                             if m["market"] else state_days(s, m["cmdt"], m["state"]))
                time.sleep(1.0)
        except Exception as e:  # noqa: BLE001 - one mandi's refusal is that mandi's
            failed += 1
            print(f"  {root}: {type(e).__name__}: {str(e)[:120]}")
            continue
        rows = done[key]
        con.executemany("INSERT OR REPLACE INTO commodity_spot VALUES (?,?,?,?)",
                        [(f"{root}_NCDEX", d, v, f"agmarknet:{m['label']}") for d, v in rows])
        stored += len(rows)
        print(f"  {root}: {len(rows)} days from {m['label']}" + (f", latest {max(rows)[0]} Rs {max(rows)[1]:,.0f}/q" if rows else ""))
    con.commit()
    con.close()
    print(f"spot: {stored} mandi prices stored, {failed} sources failed")
    if failed == len(SPOT):
        sys.exit(1)


if __name__ == "__main__":
    main()
