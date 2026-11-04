"""Rscreener alerts - the owner's watchlist companies' results, on his phone,
within minutes of NSE publishing them.

Run by "Publish new results" (results.yml) right after it has fetched, and by
the nightly run for whatever landed after the watcher stopped. At most two
pushes per result:

  out      the results announcement is up - its time, and the filing's PDF
  figures  the quarter's figures are filed - sales and profit against the
           same quarter a year before

alert_log in the database remembers what was sent, so the many runs of a
results evening send each once. Only today's and yesterday's results count:
a first run, or a night the database was restored from an older copy, does
not replay last week.

Symbols: alerts/watchlist.txt plus the stars and holdings in the owner's
account (account_list.py) - the same list the announcement alert uses.
Facts from the filings only - growth figures, never an opinion on them.

Usage:  python alerts/results_alerts.py     (NTFY_TOPIC unset = print only)
"""
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from account_list import alert_symbols

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
SITE = "https://rishilbhutada.github.io/rscreener"
NSE_DOCS = "https://nsearchives.nseindia.com/corporate/"
IST = timezone(timedelta(hours=5, minutes=30))
TOPIC = os.environ.get("NTFY_TOPIC", "")


def watchlist() -> list[str]:
    return alert_symbols()


def push(title: str, message: str, click: str) -> None:
    if not TOPIC:
        print(f"(no NTFY_TOPIC) would push: {title} | {message}")
        return
    requests.post(f"https://ntfy.sh/{TOPIC}", data=message.encode("utf-8"), timeout=15,
                  headers={"Title": title.encode("utf-8"), "Tags": "bar_chart", "Click": click})


def quarter_before(day: str) -> str:
    """The quarter a results announcement on `day` reports: the last to end before it."""
    y, m = int(day[:4]), int(day[5:7])
    return [f"{y - 1}-12-31", f"{y}-03-31", f"{y}-06-30", f"{y}-09-30"][(m - 1) // 3]


def quarter_label(pe: str) -> str:
    y, m = int(pe[:4]), int(pe[5:7])
    q = {6: 1, 9: 2, 12: 3, 3: 4}[m]
    return f"Q{q} FY{(y + 1 if m >= 4 else y) % 100:02d}"


def clock(hms: str) -> str:
    h, mnt = int(hms[:2]), hms[3:5]
    return f"{h % 12 or 12}:{mnt} {'am' if h < 12 else 'pm'}"


def crore(v: float) -> str:
    c = v / 1e7
    return f"{'-' if c < 0 else ''}₹{abs(c):,.0f} Cr" if abs(c) >= 100 else f"{'-' if c < 0 else ''}₹{abs(c):,.1f} Cr"


def growth(new: float | None, old: float | None) -> str:
    if new is None or old is None or old <= 0:
        return ""
    return f" ({(new / old - 1) * 100:+.1f}% YoY)"


def figures(con, sym: str, pe: str) -> dict | None:
    """Sales and profit for the quarter, and a year before, on the basis filed."""
    rows = con.execute("SELECT basis, period_end, item, value FROM results_history WHERE symbol=? AND period_type='quarterly'"
                       " AND period_end IN (?, ?) AND item IN ('revenue','pat')",
                       (sym, pe, f"{int(pe[:4]) - 1}{pe[4:]}")).fetchall()
    by: dict[tuple, dict] = {}
    for basis, end, item, v in rows:
        by.setdefault((basis, end), {})[item] = v
    for basis in ("consolidated", "standalone"):
        cur = by.get((basis, pe))
        if cur and (cur.get("revenue") is not None or cur.get("pat") is not None):
            return {"now": cur, "ago": by.get((basis, f"{int(pe[:4]) - 1}{pe[4:]}"), {})}
    return None


def main() -> None:
    syms = watchlist()
    if not syms or not DB.exists():
        print("no watchlist or no database - nothing to check")
        return
    con = sqlite3.connect(DB, timeout=180)
    con.execute("CREATE TABLE IF NOT EXISTS alert_log (symbol TEXT, day TEXT, stage TEXT, sent_at TEXT,"
                " PRIMARY KEY (symbol, day, stage))")
    has = lambda t: con.execute("SELECT 1 FROM sqlite_master WHERE name=?", (t,)).fetchone() is not None
    today = datetime.now(IST).date()
    since = (today - timedelta(days=1)).isoformat()
    sent = {(s, d, st) for s, d, st in con.execute("SELECT symbol, day, stage FROM alert_log")}
    marks = ",".join("?" * len(syms))
    out = con.execute(f"SELECT symbol, day, at, doc FROM result_times WHERE day >= ? AND symbol IN ({marks})",
                      (since, *syms)).fetchall() if has("result_times") else []
    n = 0
    for sym, day, at, doc in out:
        pe = quarter_before(day)
        f = figures(con, sym, pe) if has("results_history") else None
        page = f"{SITE}/company/?s={sym}"
        if f and (sym, day, "figures") not in sent:
            now, ago = f["now"], f["ago"]
            parts = []
            if now.get("revenue") is not None:
                parts.append(f"Sales {crore(now['revenue'])}{growth(now['revenue'], ago.get('revenue'))}")
            if now.get("pat") is not None:
                parts.append(f"{'Profit' if now['pat'] >= 0 else 'Loss'} {crore(abs(now['pat']))}{growth(now['pat'], ago.get('pat'))}")
            push(f"{sym} {quarter_label(pe)} results", f"{' · '.join(parts)}\nOut at {clock(at)} IST, from the filing.", page)
            for stage in ("out", "figures"):
                con.execute("INSERT OR IGNORE INTO alert_log VALUES (?,?,?,?)",
                            (sym, day, stage, datetime.now(timezone.utc).isoformat(timespec="seconds")))
            n += 1
        elif not f and (sym, day, "out") not in sent:
            link = NSE_DOCS + doc if doc and "://" not in doc else (doc or page)
            push(f"{sym} {quarter_label(pe)} results are out",
                 f"Announced at {clock(at)} IST. Figures follow when the company files its data (often hours later).\n{link}", page)
            con.execute("INSERT OR IGNORE INTO alert_log VALUES (?,?,?,?)",
                        (sym, day, "out", datetime.now(timezone.utc).isoformat(timespec="seconds")))
            n += 1
    con.commit()
    con.close()
    print(f"results alerts: {len(syms)} watched, {len(out)} results out since {since}, {n} pushed")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - an alert failing must never stop a publish
        print(f"results alerts FAILED: {type(e).__name__}: {e}")
        sys.exit(0)
