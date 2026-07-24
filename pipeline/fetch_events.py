"""Rscreener - upcoming corporate events calendar (board meetings, results dates).

One market-wide NSE call. Output: web/public/calendar.json
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public" / "calendar.json"
API = "https://www.nseindia.com/api/event-calendar"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}


def main() -> None:
    s = requests.Session()
    s.headers.update(HEADERS)
    try:
        s.get("https://www.nseindia.com", timeout=20)
    except Exception:
        pass
    r = s.get(API, timeout=25)
    r.raise_for_status()
    events = []
    for e in r.json():
        raw = e.get("date")
        try:
            iso = datetime.strptime(raw, "%d-%b-%Y").strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            continue
        events.append({
            "symbol": e.get("symbol"),
            "company": e.get("company"),
            "purpose": e.get("purpose"),
            "date": iso,
            "desc": (e.get("bm_desc") or "")[:200],
        })
    events.sort(key=lambda x: (x["date"], x["symbol"] or ""))
    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "events": events,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"calendar: {len(events)} upcoming events -> {OUT}")


if __name__ == "__main__":
    main()
