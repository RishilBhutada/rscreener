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
  - NCDEX against the mandi. Each contract against the physical price at its
    delivery centre that day (fetch_spot.py, from Agmarknet), in the
    contract's own unit - the agri counterpart of MCX against the world.

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

from commodities_lib import FX, GROUPS, NCDEX_SUFFIX, SPOT, WORLD, describe, world_front, world_ticker
from export_chart_json import OUT as CHART_DIR, _day, _normalise, _px

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
LIST_OUT = ROOT / "web" / "public" / "commodities.json"
DIR_OUT = ROOT / "web" / "public" / "commodity"
EPOCH = date(1970, 1, 1)
WORLD_MAX_GAP = 4      # days between an MCX close and the world close it is set against
SPOT_MAX_GAP = 4       # the same for an NCDEX close and the mandi price
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


def write_chart(sym: str, name: str, exch: str, rows: list[tuple]) -> None:
    """One full-screen chart file: daily candles, weekly and monthly folded
    from them by the companies' own builder."""
    if not rows:
        return
    doc = {"s": sym, "name": name, "exch": exch,
           "d": [[_day(d), _px(o), _px(h), _px(lo), _px(c), int(v or 0)] for d, o, h, lo, c, v, _oi in rows]}
    _normalise(doc)
    doc["asof"] = rows[-1][0]
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    (CHART_DIR / f"{sym}.json").write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False), encoding="utf-8")


def main() -> None:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='commodity_bars'").fetchone():
        print("no commodity tables yet - nothing to write")
        return
    # "Live" is judged per exchange: NCDEX is read on its own schedule (only
    # once the owner's Angel login exists), and MCX's newer read must not
    # make every NCDEX contract look delisted.
    newest_seen = dict(con.execute("SELECT exchange, MAX(last_seen) FROM commodity_contracts GROUP BY exchange"))
    contracts = {k: {"key": k, "root": root, "expiry": exp, "mult": mult, "tick": tick, "exchange": ex,
                     "live": seen == newest_seen.get(ex)}
                 for k, ex, root, exp, mult, tick, seen in con.execute(
                     "SELECT key, exchange, root, expiry, mult, tick, last_seen FROM commodity_contracts")}
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
    # Mandi prices, already in each contract's quoted unit.
    spot: dict[str, Series] = {}
    if con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='commodity_spot'").fetchone():
        srows: dict[str, list] = defaultdict(list)
        for r, d, v in con.execute("SELECT root, date, price FROM commodity_spot WHERE price > 0"):
            m = SPOT.get(r.removesuffix(NCDEX_SUFFIX))
            if m:
                srows[r].append((d, v * m.get("per_q", 1.0)))
        spot = {r: Series(rows) for r, rows in srows.items()}

    def spot_at(root: str, d: str) -> tuple[str, float] | None:
        s_ = spot.get(root)
        hit = s_.at(d) if s_ else None
        return hit if hit and day_no(d) - day_no(hit[0]) <= SPOT_MAX_GAP else None

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
                # Open interest is None where the source has none (Angel's
                # daily candles), not zero.
                "vol": vol if d == asof else 0, "oi": oi,
                "oi_chg": oi - prev[6] if prev and oi is not None and prev[6] is not None else None,
                "value": round(close * c["mult"]) if c["mult"] else None,
            }
            wt = world_ticker(root, c["expiry"])
            wi = world_inr(root, wt, d)
            if wi:
                row["world"] = {"ticker": wt, "usd": r2(wi[0], 3), "fx": r2(wi[1], 3), "inr": r2(wi[2]), "prem": r2((close / wi[2] - 1) * 100)}
            sp = spot_at(root, d)
            if sp:
                prem = (close / sp[1] - 1) * 100
                # No "% a year" here: most of a futures-to-mandi gap is grade and
                # place (a contract's specified quality against whatever arrived
                # at the mandi), not time, and annualising it reads as nonsense.
                row["spot"] = {"date": sp[0], "price": r2(sp[1]), "prem": r2(prem)}
            curve.append(row)
        fresh = [r for r in curve if r["fresh"]]
        front = next((r for r in fresh if not r["expiring"]), None)
        for r in curve:
            if front and r["fresh"] and r["expiry"] > front["expiry"]:
                gap = day_no(r["expiry"]) - day_no(front["expiry"])
                r["prem_front"] = r2((r["close"] / front["close"] - 1) * 100)
                r["carry_pa"] = r2(r["prem_front"] * 365 / gap, 1) if gap > 0 else None
        active = max(fresh, key=lambda r: (r["oi"] or 0, r["vol"])) if fresh else curve[0]
        nxt = next((r for r in fresh if front and r["expiry"] > front["expiry"]), None)

        # Each live contract's life, and the world contract beside it.
        hist = {}
        for c in live:
            wt = world_ticker(root, c["expiry"])
            rows = []
            for d, o, h, lo, close, vol, oi in bars[c["key"]]:
                wi = world_inr(root, wt, d)
                # The comparison price: the world contract in rupees, or for
                # NCDEX the mandi's price that day.
                cmp_ = wi[2] if wi else (sp[1] if (sp := spot_at(root, d)) else None)
                rows.append([day_no(d), o, h, lo, close, vol, oi, r2(cmp_)])
            hist[c["expiry"]] = rows

        # Front over next, each day both traded - from every contract stored,
        # the expired ones included, so the line outlives any one pair.
        on_day: dict[str, list[tuple[str, float]]] = defaultdict(list)
        for c in cs:
            for b in bars[c["key"]]:
                if day_no(c["expiry"]) - day_no(b[0]) >= EXPIRING_DAYS and (b[6] is None or b[6] >= MIN_OI):
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

        # Candle files for the full-screen chart (charts/<SYMBOL>.json, the
        # companies' format), so a commodity gets everything that chart does -
        # candles, indicators, levels, ranges, compare. One per live contract,
        # "<ROOT>-<MON><YY>", and one continuous series, "<ROOT>1!" as on
        # TradingView: each day, the nearest contract not yet in its last
        # EXPIRING_DAYS, so it rolls to the next month before delivery.
        exch = live[0]["exchange"]
        chart_of = {}
        for c in live:
            sym = f"{root}-{date.fromisoformat(c['expiry']).strftime('%b%y').upper()}"
            write_chart(sym, f"{name} {date.fromisoformat(c['expiry']).strftime('%b %y')}", exch, bars[c["key"]])
            chart_of[c["expiry"]] = sym
        front_by_day: dict[str, tuple] = {}
        for c in cs:                                   # nearest expiry first
            for b in bars[c["key"]]:
                if b[0] not in front_by_day and day_no(c["expiry"]) - day_no(b[0]) >= EXPIRING_DAYS:
                    front_by_day[b[0]] = b
        cont = f"{root}1!"
        write_chart(cont, f"{name} - continuous (front month)", exch, [front_by_day[d] for d in sorted(front_by_day)])

        w = WORLD.get(root)
        sm = SPOT.get(root.removesuffix(NCDEX_SUFFIX)) if root.endswith(NCDEX_SUFFIX) else None
        ss = spot.get(root)
        spot_doc = {
            "label": sm["label"], "source": "Agmarknet", "date": ss.d[-1], "price": r2(ss.v[-1]),
            "series": [[day_no(d), r2(v)] for d, v in zip(ss.d, ss.v)],
        } if sm and ss and ss.d else None
        doc = {
            "charts": {"continuous": cont, "by_expiry": chart_of},
            "s": root, "code": root.removesuffix(NCDEX_SUFFIX), "name": name, "group": group, "quoted": quoted,
            "family": family, "exchange": live[0]["exchange"],
            "asof": asof, "mult": live[0]["mult"], "tick": live[0]["tick"],
            "active": active["expiry"], "front": front["expiry"] if front else None,
            "world": {"label": w["label"], "unit": w["unit"], "front": world_front(root)} if w else None,
            "spot": spot_doc,
            "curve": curve, "world_curve": wcurve, "hist": hist, "spread": spread,
            "untraded": sum(1 for c in contracts.values() if c["root"] == root and c["live"] and not bars.get(c["key"])),
        }
        (DIR_OUT / f"{root}.json").write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        items.append({
            "s": root, "name": name, "group": group, "quoted": quoted, "family": family,
            "expiry": active["expiry"], "date": active["date"], "close": active["close"], "chg": active["chg"],
            "next_prem": nxt.get("prem_front") if nxt else None, "carry_pa": nxt.get("carry_pa") if nxt else None,
            "world_prem": active.get("world", {}).get("prem"),
            "spot_prem": active.get("spot", {}).get("prem"),
            "oi": sum(r["oi"] or 0 for r in fresh), "vol": sum(r["vol"] for r in fresh), "n": len(curve),
            "exchange": live[0]["exchange"],
        })
    con.close()
    items.sort(key=lambda x: (GROUPS.index(x["group"]) if x["group"] in GROUPS else 99, x["family"], x["s"] != x["family"], -x["oi"]))
    LIST_OUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "asof": max((x["date"] for x in items), default=None),
        "items": items,
    }, separators=(",", ":"), ensure_ascii=False, allow_nan=False), encoding="utf-8")
    # Into the search index, flagged 2 in the 11th column (ETFs are 1) so a
    # search for "gold" or "crude" opens the commodity page.
    ix_path = ROOT / "web" / "public" / "index.json"
    if ix_path.exists() and items:
        ix = json.loads(ix_path.read_text(encoding="utf-8"))
        have = {r[0] for r in ix.get("rows", [])}
        add = [[x["s"], f"{x['name']} futures", x["exchange"], x["close"], None, 0, None, None, None, None, 2, x["chg"]]
               for x in items if x["s"] not in have]
        ix["rows"] = ix.get("rows", []) + add
        ix_path.write_text(json.dumps(ix, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
        print(f"  search index: {len(add)} commodities added")
    print(f"commodities: {len(items)} contract types written, as of {max((x['date'] for x in items), default='-')}")


if __name__ == "__main__":
    main()
