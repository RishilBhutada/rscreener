"""Rscreener - the commodities page (web/public/commodities.json) and one file
per MCX contract type (web/public/commodity/<ROOT>.json).

Three comparisons, each between prices from the SAME day:

  - Expiry against expiry. Every live contract's close over the nearest
    one's, and that premium spread over the days between them as % a year -
    the cost of carrying the metal (or the market's view of the season, for
    gas) that the later contract prices in.
  - MCX against the world. Each contract against the CME contract for the
    same delivery month, in rupees at that day's USD/INR. A contract whose
    last trade is days old is shown with its date and left out of both.
  - Front against next, day by day, for as long as the store reaches.

A close is "fresh" only if it is from the newest day the contract type
traded; an untraded far month keeps its last close, and a premium worked out
from it would be partly the market having moved since.

Usage:  python export_commodities_json.py
"""
import bisect
import json
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

from commodities_lib import FX, GROUPS, WORLD, describe, world_front, world_ticker

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
LIST_OUT = ROOT / "web" / "public" / "commodities.json"
DIR_OUT = ROOT / "web" / "public" / "commodity"
EPOCH = date(1970, 1, 1)
WORLD_MAX_GAP = 4      # days between an MCX close and the world close it is set against
# A contract in its last days is in delivery: few trade it and its close
# drifts to where the metal can be delivered, not where the market is. It is
# shown, flagged, but never the base the other expiries are measured from.
EXPIRING_DAYS = 5
MIN_OI = 10            # a spread leg with fewer open contracts is one trader's quote
STALE_DAYS = 10        # a contract type not traded for this long is left off the page


def day_no(d: str) -> int:
    return (date.fromisoformat(d) - EPOCH).days


def r2(v: float | None, n: int = 2) -> float | None:
    return None if v is None else round(v, n)


class Series:
    """Closes by date, answering 'on or before this day'."""
    def __init__(self, rows: list[tuple[str, float]]):
        rows = sorted(rows)
        self.d = [r[0] for r in rows]
        self.v = [r[1] for r in rows]

    def at(self, d: str) -> tuple[str, float] | None:
        i = bisect.bisect_right(self.d, d)
        return (self.d[i - 1], self.v[i - 1]) if i else None


def main() -> None:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='commodity_bars'").fetchone():
        print("no commodity tables yet - nothing to write")
        return
    newest_seen = con.execute("SELECT MAX(last_seen) FROM commodity_contracts").fetchone()[0]
    contracts = {k: {"key": k, "root": root, "expiry": exp, "mult": mult, "tick": tick, "live": seen == newest_seen}
                 for k, root, exp, mult, tick, seen in con.execute(
                     "SELECT key, root, expiry, mult, tick, last_seen FROM commodity_contracts")}
    # Only days the contract actually traded. On a day nobody traded it, the
    # feed still carries a bar - open, high, low and close all one reference
    # number, volume zero - and those numbers sat as far as 18% from the
    # traded days either side (gold December on 30-Jan-2026: 2,47,917 against
    # 2,10,175). A price nobody paid is not a price.
    bars: dict[str, list[tuple]] = defaultdict(list)
    for key, d, o, h, lo, c, v, oi in con.execute(
            "SELECT key, date, open, high, low, close, volume, oi FROM commodity_bars WHERE volume > 0 ORDER BY key, date"):
        bars[key].append((d, o, h, lo, c, v, oi))
    world: dict[str, Series] = {}
    wrows: dict[str, list] = defaultdict(list)
    for t, d, c in con.execute("SELECT ticker, date, close FROM commodity_world"):
        wrows[t].append((d, c))
    for t, rows in wrows.items():
        world[t] = Series(rows)
    fx = world.get(FX)

    def world_inr(root: str, ticker: str | None, d: str) -> tuple[float, float, float] | None:
        """(world price in its own unit, USD/INR, in MCX rupees) for day d."""
        if not ticker or ticker not in world or not fx:
            return None
        w, x = world[ticker].at(d), fx.at(d)
        if not w or not x or day_no(d) - day_no(w[0]) > WORLD_MAX_GAP or day_no(d) - day_no(x[0]) > WORLD_MAX_GAP:
            return None
        return w[1], x[1], w[1] * x[1] * WORLD[root]["factor"]

    by_root: dict[str, list[dict]] = defaultdict(list)
    for c in contracts.values():
        if bars.get(c["key"]):
            by_root[c["root"]].append(c)

    DIR_OUT.mkdir(parents=True, exist_ok=True)
    newest = max(b[-1][0] for b in bars.values())
    items = []
    for root, cs in sorted(by_root.items()):
        name, group, quoted, family = describe(root)
        cs.sort(key=lambda c: c["expiry"])
        asof = max(bars[c["key"]][-1][0] for c in cs)
        live = [c for c in cs if c["live"] and c["expiry"] >= asof]
        # Listed but not trading (Kapas's last trade was months ago): a page
        # of stale closes would read as today's market.
        if not live or day_no(newest) - day_no(asof) > STALE_DAYS:
            continue

        # Today's curve: one row per live contract.
        curve = []
        for c in live:
            b = bars[c["key"]]
            d, o, h, lo, close, vol, oi = b[-1]
            prev = b[-2] if len(b) > 1 else None
            row = {
                "key": c["key"], "expiry": c["expiry"], "days": day_no(c["expiry"]) - day_no(asof),
                "date": d, "fresh": d == asof, "expiring": day_no(c["expiry"]) - day_no(asof) < EXPIRING_DAYS, "open": o, "high": h, "low": lo, "close": close,
                "chg": r2((close / prev[4] - 1) * 100) if prev else None,
                "vol": vol if d == asof else 0, "oi": oi, "oi_chg": oi - prev[6] if prev else None,
                "value": round(close * (c["mult"] or 0)),
            }
            wt = world_ticker(root, c["expiry"])
            wi = world_inr(root, wt, d)
            if wi:
                row["world"] = {"ticker": wt, "usd": r2(wi[0], 3), "fx": r2(wi[1], 3), "inr": r2(wi[2]), "prem": r2((close / wi[2] - 1) * 100)}
            curve.append(row)
        fresh = [r for r in curve if r["fresh"]]
        front = next((r for r in fresh if not r["expiring"]), None)
        for r in curve:
            if front and r["fresh"] and r["expiry"] > front["expiry"]:
                gap = day_no(r["expiry"]) - day_no(front["expiry"])
                r["prem_front"] = r2((r["close"] / front["close"] - 1) * 100)
                r["carry_pa"] = r2(r["prem_front"] * 365 / gap, 1) if gap > 0 else None
        active = max(fresh, key=lambda r: r["oi"]) if fresh else curve[0]
        nxt = next((r for r in fresh if front and r["expiry"] > front["expiry"]), None)

        # Each live contract's life, and the world contract beside it.
        hist = {}
        for c in live:
            wt = world_ticker(root, c["expiry"])
            rows = []
            for d, o, h, lo, close, vol, oi in bars[c["key"]]:
                wi = world_inr(root, wt, d)
                rows.append([day_no(d), o, h, lo, close, vol, oi, r2(wi[2]) if wi else None])
            hist[c["expiry"]] = rows

        # Front over next, each day both traded - from every contract stored,
        # the expired ones included, so the line outlives any one pair.
        on_day: dict[str, list[tuple[str, float]]] = defaultdict(list)
        for c in cs:
            for b in bars[c["key"]]:
                if day_no(c["expiry"]) - day_no(b[0]) >= EXPIRING_DAYS and b[6] >= MIN_OI:
                    on_day[b[0]].append((c["expiry"], b[4]))
        spread = []
        for d in sorted(on_day):
            pair = sorted(on_day[d])[:2]
            if len(pair) == 2:
                gap = day_no(pair[1][0]) - day_no(pair[0][0])
                pct = (pair[1][1] / pair[0][1] - 1) * 100
                spread.append([day_no(d), r2(pct), r2(pct * 365 / gap, 1) if gap > 0 else None])

        # The world's own curve for the same months, as % over its first month,
        # so the two curves' shapes can be laid side by side.
        wcurve = []
        for r in curve:
            if r.get("world"):
                wcurve.append({"expiry": r["expiry"], "usd": r["world"]["usd"]})
        if wcurve:
            base = wcurve[0]["usd"]
            for w in wcurve:
                w["prem_first"] = r2((w["usd"] / base - 1) * 100)

        w = WORLD.get(root)
        doc = {
            "s": root, "name": name, "group": group, "quoted": quoted, "family": family, "exchange": "MCX",
            "asof": asof, "mult": live[0]["mult"], "tick": live[0]["tick"],
            "active": active["expiry"], "front": front["expiry"] if front else None,
            "world": {"label": w["label"], "unit": w["unit"], "front": world_front(root)} if w else None,
            "curve": curve, "world_curve": wcurve, "hist": hist, "spread": spread,
            "untraded": sum(1 for c in contracts.values() if c["root"] == root and c["live"] and not bars.get(c["key"])),
        }
        (DIR_OUT / f"{root}.json").write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        items.append({
            "s": root, "name": name, "group": group, "quoted": quoted, "family": family,
            "expiry": active["expiry"], "date": active["date"], "close": active["close"], "chg": active["chg"],
            "next_prem": nxt.get("prem_front") if nxt else None, "carry_pa": nxt.get("carry_pa") if nxt else None,
            "world_prem": active.get("world", {}).get("prem"),
            "oi": sum(r["oi"] for r in fresh), "vol": sum(r["vol"] for r in fresh), "n": len(curve),
        })
    con.close()
    items.sort(key=lambda x: (GROUPS.index(x["group"]) if x["group"] in GROUPS else 99, x["family"], x["s"] != x["family"], -x["oi"]))
    LIST_OUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "asof": max((x["date"] for x in items), default=None),
        "items": items,
    }, separators=(",", ":"), ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"commodities: {len(items)} contract types written, as of {max((x['date'] for x in items), default='-')}")


if __name__ == "__main__":
    main()
