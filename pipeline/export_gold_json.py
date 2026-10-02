"""Rscreener - the gold page (web/public/gold.json).

  snapshot   MCX gold, COMEX gold in dollars and in rupees, MCX over the
             world price, USD/INR, the gold-silver ratio
  events     scheduled releases from this week's calendar and every FOMC
             decision, each with its stars, the reason, and - once it has
             happened - how gold moved that day on COMEX and MCX
  families   per kind of event: the rule stars, and the measured stars where
             enough past events have prices around them
  news       the week's gold headlines, each rated by the rule it matched

How gold "moved that day": the close of the first session to settle after the
event, against the close before it. COMEX settles at 1:30pm New York time, so
an event after that counts on the next session; MCX trades until 23:30 IST, so
an event after 23:00 IST counts on the next MCX day.

Usage:  python export_gold_json.py
"""
import bisect
import json
import sqlite3
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from gold_lib import FAMILIES, MIN_MEASURED, NOT_MEASURED, clean_title, duty_on, rate_headline, stars_from_ratio

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "gold.json"
NY = ZoneInfo("America/New_York")
IST = timezone(timedelta(hours=5, minutes=30))
TROY_OZ_G = 31.1034768
EXPIRING_DAYS = 5


def r2(v, n=2):
    return None if v is None else round(v, n)


class Closes:
    """Daily closes, answering "the first session on or after this day"."""
    def __init__(self, rows):
        rows = sorted(rows)
        self.d = [r[0] for r in rows]
        self.c = [r[1] for r in rows]

    def move_from(self, day: str) -> tuple[str, float] | None:
        i = bisect.bisect_left(self.d, day)
        if i <= 0 or i >= len(self.d) or (date.fromisoformat(self.d[i]) - date.fromisoformat(day)).days > 4:
            return None
        return self.d[i], (self.c[i] / self.c[i - 1] - 1) * 100

    def last_two(self):
        return (self.d[-1], self.c[-1], self.c[-2]) if len(self.c) > 1 else None

    def on_or_before(self, day: str) -> float | None:
        i = bisect.bisect_right(self.d, day)
        return self.c[i - 1] if i else None

    def abs_moves(self, start: str, end: str) -> list[float]:
        i, j = bisect.bisect_left(self.d, start), bisect.bisect_right(self.d, end)
        return [abs(self.c[k] / self.c[k - 1] - 1) * 100 for k in range(max(i, 1), j)]


def front_series(con, root: str) -> Closes:
    """The nearest contract not yet in its last days, each day it traded."""
    exp = dict(con.execute("SELECT key, expiry FROM commodity_contracts WHERE root=?", (root,)))
    by_day: dict[str, tuple[str, float]] = {}
    for key, d, c in con.execute(
            "SELECT key, date, close FROM commodity_bars WHERE volume > 0 AND key IN "
            "(SELECT key FROM commodity_contracts WHERE root=?) ORDER BY date", (root,)):
        e = exp.get(key)
        if not e or (date.fromisoformat(e) - date.fromisoformat(d)).days < EXPIRING_DAYS:
            continue
        if d not in by_day or e < by_day[d][0]:
            by_day[d] = (e, c)
    return Closes([(d, v[1]) for d, v in by_day.items()])


def reaction_days(when_utc: datetime) -> tuple[str, str]:
    # COMEX's daily close is the 1:30pm New York settlement - before the Fed
    # announces at 2pm. Measured against the same day, the Fed looked like a
    # one-star event (gold moved 0.35% on decision days against 0.59% on any
    # day): the day measured was the quiet wait, not the reaction.
    ny = when_utc.astimezone(NY)
    comex = ny.date() + timedelta(days=1 if (ny.hour, ny.minute) >= (13, 30) else 0)
    ist = when_utc.astimezone(IST)
    mcx = ist.date() + timedelta(days=1 if (ist.hour, ist.minute) >= (23, 0) else 0)
    return comex.isoformat(), mcx.isoformat()


def main() -> None:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='gold_events'").fetchone():
        print("no gold tables yet - nothing to write")
        return
    world = defaultdict(list)
    for t, d, c in con.execute("SELECT ticker, date, close FROM commodity_world WHERE ticker IN ('GC=F','INR=X')"):
        world[t].append((d, c))
    comex, fx = Closes(world["GC=F"]), Closes(world["INR=X"])
    mcx, silver = front_series(con, "GOLD"), front_series(con, "SILVER")
    events = con.execute("SELECT key, when_utc, country, title, impact, forecast, previous, actual, family, source "
                         "FROM gold_events ORDER BY when_utc").fetchall()
    # MCX gold's expiries: trading ends at 23:30 IST on the day.
    for (exp,) in con.execute("SELECT DISTINCT expiry FROM commodity_contracts WHERE root='GOLD' AND exchange='MCX'"):
        d = date.fromisoformat(exp)
        when = datetime(d.year, d.month, d.day, 23, 30, tzinfo=IST).astimezone(timezone.utc)
        events.append((f"mcx|{exp}", when.strftime("%Y-%m-%dT%H:%M:%SZ"), "INR",
                       f"MCX gold {d.strftime('%b %Y')} contract expires", "", "", "", "", "mcx_expiry",
                       "MCX contract list"))
    events.sort(key=lambda e: e[1])
    news = con.execute("SELECT url, seen_utc, title, domain FROM gold_news ORDER BY seen_utc DESC").fetchall()
    con.close()

    now = datetime.now(timezone.utc)
    # ── how each family has moved gold ──
    fam_days: dict[str, set[str]] = defaultdict(set)
    for key, when, country, title, impact, *_rest, family, _src in events:
        w = datetime.fromisoformat(when.replace("Z", "+00:00"))
        if w < now:
            fam_days[family].add(reaction_days(w)[0])
    families = {}
    for fam, (stars, label, why) in FAMILIES.items():
        moves = [m[1] for d in sorted(fam_days.get(fam, ())) if (m := comex.move_from(d))]
        info = {"label": label, "why": why, "rule": stars, "stars": stars, "n": len(moves)}
        if fam in NOT_MEASURED:
            info.update({"n": 0, "fixed": True})
        elif len(moves) >= MIN_MEASURED:
            days = sorted(fam_days[fam])
            base = statistics.median(comex.abs_moves(days[0], days[-1]))
            med = statistics.median(abs(m) for m in moves)
            info.update({"median_move": r2(med), "normal_move": r2(base), "ratio": r2(med / base),
                         "stars": stars_from_ratio(med / base), "since": days[0]})
        families[fam] = info

    # A release the week's calendar already lists (with its forecast) is not
    # shown a second time from a schedule.
    on_calendar = {(e[8], e[1][:10]) for e in events if e[9] == "forexfactory"}
    out_events = []
    lo, hi = (now - timedelta(days=45)), (now + timedelta(days=120))
    for key, when, country, title, impact, forecast, previous, actual, family, source in events:
        w = datetime.fromisoformat(when.replace("Z", "+00:00"))
        if not lo <= w <= hi:
            continue
        if source != "forexfactory" and (family, when[:10]) in on_calendar:
            continue
        fam = families.get(family) or families["other"]
        # One star is shown for a named kind of event - measured that low, it
        # is still worth knowing - but not for the long tail of minor data.
        if fam["stars"] < 2 and family in ("other", "other_high"):
            continue
        e = {"t": w.strftime("%Y-%m-%dT%H:%M:%SZ"), "c": country, "title": title, "fam": family,
             "stars": fam["stars"], "src": source}
        for k, v in (("forecast", forecast), ("previous", previous), ("actual", actual)):
            if v:
                e[k] = v
        if w < now and family not in NOT_MEASURED:
            cday, mday = reaction_days(w)
            cm, mm = comex.move_from(cday), mcx.move_from(mday)
            if cm:
                e["comex"] = [cm[0], r2(cm[1])]
            if mm:
                e["mcx"] = [mm[0], r2(mm[1])]
        out_events.append(e)

    # ── headlines ──
    out_news, seen = [], set()
    week = (now - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    for url, when, title, domain in news:
        if when < week:
            continue
        title = clean_title(title)
        sig = "".join(ch for ch in title.lower() if ch.isalnum())[:60]
        rated = rate_headline(title)
        if not rated or sig in seen:
            continue
        seen.add(sig)
        out_news.append({"t": when, "title": title, "url": url, "src": domain, "stars": rated[0], "why": rated[1]})
        if len(out_news) >= 60:
            break

    # ── snapshot ──
    snap = {}
    for name, series in (("mcx", mcx), ("comex", comex), ("usdinr", fx), ("silver", silver)):
        t = series.last_two()
        if t:
            snap[name] = {"date": t[0], "close": r2(t[1]), "chg": r2((t[1] / t[2] - 1) * 100)}
    if "comex" in snap and "usdinr" in snap:
        # The world price on MCX's own last day, so the two compare like with like.
        day = snap["mcx"]["date"] if "mcx" in snap else snap["comex"]["date"]
        cx, rate = comex.on_or_before(day), fx.on_or_before(day)
        parity = (cx or snap["comex"]["close"]) * (rate or snap["usdinr"]["close"]) * 10 / TROY_OZ_G
        snap["parity"] = r2(parity, 0)
        snap["parity_date"] = day
        if "mcx" in snap:
            snap["mcx_prem"] = r2((snap["mcx"]["close"] / parity - 1) * 100)
            # What is left once India's import duty is added to the world price:
            # the local premium or discount, plus a month or two of carry.
            duty = duty_on(snap["mcx"]["date"])
            if duty:
                landed = parity * (1 + duty[0] / 100)
                snap.update({"duty": duty[0], "duty_since": duty[1], "duty_why": duty[2], "landed": r2(landed, 0),
                             "mcx_vs_landed": r2((snap["mcx"]["close"] / landed - 1) * 100)})
    if "mcx" in snap and "silver" in snap:
        snap["gold_silver"] = r2((snap["mcx"]["close"] / 10) / (snap["silver"]["close"] / 1000), 1)

    OUT.write_text(json.dumps({
        "generated_at": now.strftime("%Y-%m-%d %H:%M UTC"),
        "snapshot": snap, "events": out_events, "families": families, "news": out_news,
        "min_measured": MIN_MEASURED,
    }, separators=(",", ":"), ensure_ascii=False, allow_nan=False), encoding="utf-8")
    measured = [f"{k} {v['stars']}* ({v['n']}, {v['ratio']}x)" for k, v in families.items() if "ratio" in v]
    print(f"gold: {len(out_events)} events, {len(out_news)} headlines; measured: {', '.join(measured) or 'none yet'}")


if __name__ == "__main__":
    main()
