"""Rscreener - the calendar page's files, from the database.

  web/public/calendar.json       what is coming: board meetings, ex-dates and
                                 IPOs from today on. Small, because the home
                                 page's "Coming up" reads it on every visit.
  web/public/calendar-past.json  the past year: every results announcement -
                                 with the quarter's sales and profit against a
                                 year before, how the stock moved, and the
                                 earnings call - dividends, bonuses, splits,
                                 rights, buybacks, IPO listings, and the board
                                 meetings fetch_events.py keeps. Only the
                                 calendar page reads it.

Written on EVERY run, publish-only ones included, so a code change can never
put an old calendar back on the site (see fetch_events.py). If NSE refuses for
a week, the upcoming list thins out as dates pass rather than showing last
week's meetings as "upcoming".

How a stock "moved on results": from the last close before the day NSE
broadcast the results to the close of the next session after it. Results
often come out after the market shuts (MTAR's June-2026 quarter: 18:39), so a
one-day window would miss the reaction; the cost is that the window spans two
sessions. A split, bonus or rights ex-date inside the window voids the figure.

Usage:  python export_calendar_json.py
"""
import bisect
import json
import re
import sqlite3
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "calendar.json"
PAST = ROOT / "web" / "public" / "calendar-past.json"
IST = timezone(timedelta(hours=5, minutes=30))
NSE_DOCS = "https://nsearchives.nseindia.com/corporate/"
# Equity IPOs only; NSE's list also carries bonds and debt issues.
IPO_SEGMENT = {"EQ": "Mainboard", "BE": "Mainboard", "SME": "SME"}
# An ex-date that changes the share count makes a price move meaningless.
RESHAPES = {"bonus", "split", "rights", "other"}


def quarter(period_end: str) -> str:
    """2026-06-30 -> "Q1 FY27" (India's year runs April to March)."""
    y, m = int(period_end[:4]), int(period_end[5:7])
    q = {6: 1, 9: 2, 12: 3, 3: 4}.get(m)
    return f"Q{q} FY{(y + 1 if m >= 4 else y) % 100:02d}" if q else period_end


def year_before(iso_day: str) -> str:
    return f"{int(iso_day[:4]) - 1}{iso_day[4:]}"


def pct(new: float | None, old: float | None, places: int = 1) -> float | None:
    if new is None or old is None or old <= 0:
        return None
    return round((new / old - 1) * 100, places)


def crore(v: float | None) -> float | None:
    if v is None:
        return None
    c = v / 1e7
    return round(c) if abs(c) >= 1000 else round(c, 1)


def money(text: str | None) -> float | None:
    """"₹2.20", "Dividend - Rs 2.20 Per Share", "Re 0.10" -> the rupee amount."""
    m = re.search(r"(?:₹|\bR[se]\.?)\s*([\d]+(?:\.\d+)?)", text or "")
    return float(m.group(1)) if m else None


def price(text: str | None) -> float | None:
    m = re.search(r"\d+(?:\.\d+)?", (text or "").replace(",", ""))
    return float(m.group()) if m else None


def ca_kind(subject: str) -> str:
    s = subject.lower()
    for k in ("bonus", "split", "rights", "buy back", "buyback", "dividend", "demerger"):
        if k in s:
            return {"buy back": "buyback", "demerger": "other"}.get(k, k)
    return "other"


class Closes:
    """Daily closes per symbol, for "the close before" and "the next close"."""

    def __init__(self, rows):
        by = defaultdict(list)
        for sym, d, c in rows:
            if c:
                by[sym].append((d, c))
        self.days = {s: [d for d, _ in sorted(v)] for s, v in by.items()}
        self.vals = {s: [c for _, c in sorted(v)] for s, v in by.items()}

    def before(self, sym: str, day: str):
        ds = self.days.get(sym)
        i = bisect.bisect_left(ds, day) - 1 if ds else -1
        return (ds[i], self.vals[sym][i]) if i >= 0 else None

    def after(self, sym: str, day: str):
        ds = self.days.get(sym)
        i = bisect.bisect_right(ds, day) if ds else 0
        return (ds[i], self.vals[sym][i]) if ds and i < len(ds) else None

    def on_or_after(self, sym: str, day: str):
        ds = self.days.get(sym)
        i = bisect.bisect_left(ds, day) if ds else 0
        return (ds[i], self.vals[sym][i]) if ds and i < len(ds) else None

    def latest(self, sym: str):
        ds = self.days.get(sym)
        return (ds[-1], self.vals[sym][-1]) if ds else None


def gap(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def move(closes: Closes, sym: str, day: str, reshaped: dict[str, list[str]]) -> float | None:
    """The close before `day` to the next close after it; None when either is
    more than a week away (a halt) or the share count changed in between."""
    b, a = closes.before(sym, day), closes.after(sym, day)
    if not (b and a) or gap(b[0], day) > 7 or gap(day, a[0]) > 7:
        return None
    if any(b[0] < x <= a[0] for x in reshaped.get(sym, [])):
        return None
    return pct(a[1], b[1], 2)


def main() -> None:
    now = datetime.now(IST)
    today = now.date().isoformat()
    lo = (now.date() - timedelta(days=366)).isoformat()
    deep = (now.date() - timedelta(days=760)).isoformat()  # a year before the year, for growth
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    has = lambda t: con.execute("SELECT 1 FROM sqlite_master WHERE name=?", (t,)).fetchone() is not None

    names = {s: n for s, n in con.execute('SELECT SYMBOL, "NAME OF COMPANY" FROM universe')} if has("universe") else {}
    early = (now.date() - timedelta(days=380)).isoformat()  # a close before the year's first event
    closes = Closes(con.execute("SELECT symbol, date, close FROM prices WHERE freq='daily' AND date >= ?",
                                (early,)) if has("prices") else [])
    nifty = Closes(("NIFTY", d, c) for d, c in con.execute(
        "SELECT date, close FROM idx_bars WHERE name='Nifty 50' AND date >= ?", (early,))) if has("idx_bars") else Closes([])

    actions = con.execute("SELECT symbol, ex_date, kind, detail, subject FROM corporate_actions WHERE ex_date >= ?",
                          (lo,)).fetchall() if has("corporate_actions") else []
    reshaped = defaultdict(list)
    for sym, d, kind, _, _ in actions:
        if kind in RESHAPES:
            reshaped[sym].append(d)

    past: list[dict] = []

    # ── results ──
    figures: dict[tuple, dict] = defaultdict(dict)
    if has("results_history"):
        for sym, basis, pe, item, v in con.execute(
                "SELECT symbol, basis, period_end, item, value FROM results_history WHERE period_type='quarterly'"
                " AND period_end >= ? AND item IN ('revenue','pat','eps')", (deep,)):
            figures[(sym, basis, pe)][item] = v
    calls = defaultdict(list)
    if has("announcement_docs"):
        for sym, d, title, url in con.execute(
                "SELECT symbol, date, title, url FROM announcement_docs WHERE doc_type='concall' AND date >= ?"
                " ORDER BY date", ((now.date() - timedelta(days=380)).isoformat(),)):
            calls[sym].append((d, title or "", url or ""))
    filings = con.execute("SELECT symbol, period_end, announced_on FROM filing_dates WHERE announced_on >= ?"
                          " AND announced_on < ? ORDER BY announced_on", (lo, today)).fetchall() if has("filing_dates") else []
    results_by = defaultdict(list)  # symbol -> its results, oldest first
    for sym, pe, ann in filings:
        e = {"d": ann, "k": "results", "s": sym, "q": quarter(pe)}
        basis = "consolidated" if figures.get((sym, "consolidated", pe), {}).get("pat") is not None else "standalone"
        cur, ago = figures.get((sym, basis, pe), {}), figures.get((sym, basis, year_before(pe)), {})
        for key, item in (("rv", "revenue"), ("pt", "pat")):
            if cur.get(item) is not None:
                e[key] = crore(cur[item])
                if (g := pct(cur[item], ago.get(item))) is not None:
                    e[key + "y"] = g
        if cur.get("eps") is not None:
            e["eps"] = round(cur["eps"], 2)
        if cur and basis == "standalone":
            e["sa"] = 1
        if (mv := move(closes, sym, ann, reshaped)) is not None:
            e["mv"] = mv
            if (nf := move(nifty, "NIFTY", ann, {})) is not None:
                e["nf"] = nf
        # The earnings call: transcript and recording filed within three weeks.
        lo_c, hi_c = (date.fromisoformat(ann) - timedelta(days=3)).isoformat(), (date.fromisoformat(ann) + timedelta(days=21)).isoformat()
        cc = {}
        for d, title, url in calls.get(sym, []):
            if lo_c <= d <= hi_c and url:
                t = title.lower()
                k = "t" if "transcript" in t else "r" if re.search(r"recording|audio|video", t) else None
                if k and k not in cc:
                    cc[k] = url[len(NSE_DOCS):] if url.startswith(NSE_DOCS) else url
        if cc:
            e["cc"] = cc
        past.append(e)
        results_by[sym].append(e)

    # ── dividends, bonuses, splits, rights, buybacks ──
    for sym, d, kind, detail, subject in actions:
        if d >= today:
            continue
        e = {"d": d, "k": kind if kind in ("dividend", "bonus", "split", "rights", "buyback") else "other",
             "s": sym, "x": (subject or "").strip()}
        if kind == "dividend":
            amt = money(detail) or money(subject)
            if amt:
                e["amt"] = amt
                b = closes.before(sym, d)
                if b and gap(b[0], d) <= 7 and b[1] > 0:
                    e["yld"] = round(amt / b[1] * 100, 2)
        elif detail and kind != "other":
            e["r"] = detail
        past.append(e)

    # ── IPO listings ──
    if has("ipos"):
        for sym, company, listing, issue, seg in con.execute(
                "SELECT symbol, company, listing_date, issue_price, security_type FROM ipos"
                " WHERE listing_date >= ? AND listing_date < ?", (lo, today)):
            if seg not in IPO_SEGMENT or not sym:
                continue
            names.setdefault(sym, company)
            e = {"d": listing, "k": "ipo", "s": sym, "seg": IPO_SEGMENT[seg]}
            if (ip := price(issue)) and ip < 1e6:
                e["ip"] = ip
                first = closes.on_or_after(sym, listing)
                if first and gap(listing, first[0]) <= 5:
                    e["lc"] = round(first[1], 2)
                    if (g := pct(first[1], ip)) is not None:
                        e["lg"] = g
            past.append(e)

    # ── other board meetings (results meetings are covered above) ──
    meetings = con.execute("SELECT symbol, company, purpose, date, detail FROM calendar_events WHERE kind='meeting'"
                           " AND date >= ? AND date < ?", (lo, today)).fetchall() if has("calendar_events") else []
    for sym, company, purpose, d, detail in meetings:
        if "result" in (purpose or "").lower() and any(abs(gap(r["d"], d)) <= 5 for r in results_by.get(sym, [])):
            continue
        names.setdefault(sym, company)
        past.append({"d": d, "k": "meeting", "s": sym, "p": purpose or "", "x": detail or ""})

    # ── what is coming ──
    upcoming = []
    rows = con.execute("SELECT kind, symbol, company, purpose, date, detail FROM calendar_events WHERE date >= ?"
                       " ORDER BY date, symbol", (today,)).fetchall() if has("calendar_events") else []
    seen_ex = set()
    for kind, sym, company, purpose, d, detail in rows:
        e = {"kind": kind, "symbol": sym, "company": company, "purpose": purpose if kind == "meeting" else f"Ex-date: {purpose}",
             "date": d, "desc": detail or ""}
        if kind == "meeting" and "result" in (purpose or "").lower():
            e["type"] = "results"
            mine = [r for r in results_by.get(sym, []) if r["d"] < d]
            if mine:
                last = mine[-1]
                e["last"] = {k: last[k] for k in ("q", "rvy", "pty", "mv") if k in last}
            moves = [abs(r["mv"]) for r in mine[-4:] if "mv" in r]
            if len(moves) >= 2:
                e["typ"], e["n"] = round(statistics.median(moves), 1), len(moves)
        elif kind == "meeting":
            e["type"] = "meeting"
        else:
            seen_ex.add((sym, d))
            e["type"] = ca_kind(purpose or "")
        upcoming.append(e)
    # Ex-dates the per-company corporate-actions fetch knows and NSE's 45-day
    # list did not carry.
    for sym, d, kind, detail, subject in actions:
        if d >= today and (sym, d) not in seen_ex:
            seen_ex.add((sym, d))
            upcoming.append({"kind": "exdate", "symbol": sym, "company": names.get(sym, sym),
                             "purpose": f"Ex-date: {subject}", "date": d, "desc": "",
                             "type": kind if kind in ("dividend", "bonus", "split", "rights", "buyback") else "other"})
    for e in upcoming:
        if e["kind"] == "exdate" and e["type"] == "dividend" and (amt := money(e["purpose"])):
            e["amt"] = amt
            last = closes.latest(e["symbol"])
            if last and last[1] > 0:
                e["yld"] = round(amt / last[1] * 100, 2)
    if has("ipos"):
        for sym, company, start, end, listing, band, seg in con.execute(
                "SELECT symbol, company, issue_start, issue_end, listing_date, price_band, security_type FROM ipos"
                " WHERE phase IN ('upcoming','current') AND (issue_end >= ? OR listing_date >= ?)", (today, today)):
            if seg not in IPO_SEGMENT or not start:
                continue
            nums = re.findall(r"\d+(?:\.\d+)?", (band or "").replace(",", ""))
            band_txt = f"₹{nums[0]}–{nums[1]}" if len(nums) >= 2 else (f"₹{nums[0]}" if nums else "")
            span = f"{start} to {end}" if end else start
            base = {"kind": "ipo", "symbol": sym, "company": company, "type": "ipo", "seg": IPO_SEGMENT[seg]}
            if end and end >= today:
                upcoming.append({**base, "purpose": "IPO opens" if start >= today else "IPO open",
                                 "date": max(start, today), "end": end,
                                 "desc": " · ".join(x for x in (f"{IPO_SEGMENT[seg]} IPO", f"bids {span}", band_txt and f"price band {band_txt}") if x)})
            if listing and listing >= today:
                upcoming.append({**base, "purpose": "Listing", "date": listing, "desc": f"{IPO_SEGMENT[seg]} IPO lists"})
    upcoming.sort(key=lambda e: (e["date"], e["symbol"] or ""))

    fetched = con.execute("SELECT MAX(fetched_at) FROM calendar_events").fetchone()[0] if has("calendar_events") else None
    con.close()

    OUT.write_text(json.dumps({
        # When NSE was last read, not when this file was written - the honest
        # age of what the page shows.
        "generated_at": fetched,
        "events": upcoming,
    }, ensure_ascii=False, allow_nan=False), encoding="utf-8")

    past.sort(key=lambda e: (e["d"], e["s"]), reverse=True)
    used = {e["s"] for e in past}
    PAST.write_text(json.dumps({
        "from": lo, "to": today,
        "prices_to": max((d[-1] for d in closes.days.values() if d), default=None),
        "names": {s: names[s] for s in sorted(used) if s in names},
        "events": past,
    }, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    kinds = defaultdict(int)
    for e in past:
        kinds[e["k"]] += 1
    print(f"calendar: {len(upcoming)} events from {today} on (fetched {fetched}); past year: {len(past)} events "
          f"({', '.join(f'{k} {n}' for k, n in sorted(kinds.items()))}), {PAST.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
