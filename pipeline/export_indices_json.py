"""Rscreener - indices: the list (web/public/indices.json), one file per
index (web/public/idx/<SYM>.json), its valuation history in the ETF
valuation chart's format (web/public/etf-val/IDX-<SYM>.json), its
full-screen chart (web/public/charts/<SYM>.json), and a row each in the
search index, flagged 3 in its kind column.

An index's symbol is "^" and its name squashed ("^NIFTY50", "^NIFTYBANK",
"^SENSEX") - Yahoo's convention, and no share's symbol starts with "^".

Everything is worked out from closes the index itself published: returns
from the close nearest each anchor date (within a week), valuation medians
over the trailing five and ten years of daily P/E, P/B and dividend yield.

Usage:  python export_indices_json.py
"""
import json
import math
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median

from export_chart_json import OUT as CHART_DIR, _day, _normalise, _px

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
PUB = ROOT / "web" / "public"
LIST_OUT = PUB / "indices.json"
DIR_OUT = PUB / "idx"
VAL_DIR = PUB / "etf-val"
EPOCH = date(1970, 1, 1)
DAILY_YEARS = 5          # daily candles kept in the chart file, as for companies

GROUPS = ["Broad market", "Sectoral", "Thematic", "Strategy", "Volatility"]
BROAD = {
    "nifty 50", "nifty next 50", "nifty 100", "nifty 200", "nifty 500", "nifty midcap 50", "nifty midcap 100",
    "nifty midcap 150", "nifty midcap select", "nifty smallcap 50", "nifty smallcap 100", "nifty smallcap 250",
    "nifty smallcap 500", "nifty microcap 250", "nifty largemidcap 250", "nifty midsmallcap 400",
    "nifty midsmallcap400 50:50", "nifty total market", "nifty next 100", "nifty sme emerge",
    "nifty500 multicap 50:25:25", "sensex",
}
SECTORAL = {
    "nifty auto", "nifty bank", "nifty energy", "nifty financial services", "nifty financial services 25/50",
    "nifty financial services ex-bank", "nifty fmcg", "nifty it", "nifty media", "nifty metal", "nifty pharma",
    "nifty psu bank", "nifty private bank", "nifty realty", "nifty oil & gas", "nifty healthcare index",
    "nifty consumer durables", "nifty chemicals", "nifty cement", "nifty construction", "nifty hospitals",
    "nifty housing finance", "nifty insurance", "nifty power", "nifty retail", "nifty nbfc", "nifty capital markets",
    "nifty telecommunications", "nifty capital goods", "nifty midsmall financial services",
    "nifty midsmall healthcare", "nifty midsmall it & telecom", "nifty500 healthcare",
}
STRATEGY = re.compile(r"alpha|quality|momentum|value|low[- ]volatility|equal|dividend|high beta|liquid|"
                      r"growth 50|multifactor|esg|shariah|ahimsa|top \d+", re.I)
# The broad indices in the order people read them; everything else by name.
BROAD_ORDER = ["nifty 50", "sensex", "nifty next 50", "nifty 100", "nifty 200", "nifty 500", "nifty total market",
               "nifty midcap 50", "nifty midcap 100", "nifty midcap 150", "nifty midcap select", "nifty smallcap 50",
               "nifty smallcap 100", "nifty smallcap 250", "nifty smallcap 500", "nifty microcap 250",
               "nifty largemidcap 250", "nifty midsmallcap 400"]
RETURNS = [("1W", 7), ("1M", 30), ("3M", 91), ("6M", 182), ("1Y", 365), ("3Y", 1095), ("5Y", 1826),
           ("10Y", 3652), ("20Y", 7305)]


def group_of(name: str) -> str:
    n = name.lower()
    if n == "india vix":
        return "Volatility"
    if n in BROAD:
        return "Broad market"
    if n in SECTORAL:
        return "Sectoral"
    if STRATEGY.search(n):
        return "Strategy"
    return "Thematic"


def sym_of(name: str) -> str:
    return "^" + re.sub(r"[^A-Z0-9]", "", re.sub(r"\s+index$", "", name, flags=re.I).upper())


def norm(t: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (t or "").lower().replace("&", "and"))


def r2(v: float | None, n: int = 2) -> float | None:
    return None if v is None or not math.isfinite(v) else round(v, n)


def day_no(d: str) -> int:
    return (date.fromisoformat(d) - EPOCH).days


def at_or_before(days: list[int], vals: list[float], want: int) -> float | None:
    """The close nearest `want` on or before it, within a week."""
    lo, hi = 0, len(days) - 1
    best = None
    while lo <= hi:
        mid = (lo + hi) // 2
        if days[mid] <= want:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    if best is None or want - days[best] > 7:
        return None
    return vals[best]


def val_stats(series: list[tuple[int, float]], last_day: int) -> dict:
    """Now, the 5- and 10-year medians, and where now sits in ten years."""
    if not series:
        return {}
    now_d, now = series[-1]
    if last_day - now_d > 10:
        return {}
    y5 = [v for d, v in series if d >= last_day - 1826]
    y10 = [v for d, v in series if d >= last_day - 3652]
    return {
        "now": now, "med5": r2(median(y5)) if len(y5) > 200 else None,
        "med10": r2(median(y10)) if len(y10) > 400 else None,
        # Share of the last ten years' days on which it was LOWER than now.
        "pct10": round(100 * sum(1 for v in y10 if v < now) / len(y10)) if len(y10) > 400 else None,
        "years": round((last_day - series[0][0]) / 365.25, 1),
    }


def main() -> None:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='idx_bars'").fetchone():
        print("no index tables yet - nothing to write")
        return
    bars: dict[str, list[tuple]] = defaultdict(list)
    for row in con.execute("SELECT name, date, open, high, low, close, volume, turnover, pe, pb, dy "
                           "FROM idx_bars WHERE close > 0 ORDER BY name, date"):
        bars[row[0]].append(row[1:])
    meta = {r[0]: r for r in con.execute("SELECT name, factsheet FROM idx_meta")}
    members: dict[str, list] = defaultdict(list)
    for name, s, comp, ind in con.execute("SELECT name, symbol, company, industry FROM idx_members ORDER BY name, symbol"):
        members[name].append([s, comp, ind])
    etf_by: dict[str, list[str]] = defaultdict(list)
    if con.execute("SELECT 1 FROM sqlite_master WHERE name='etfs'").fetchone():
        for s, u, uk, lab in con.execute("SELECT symbol, underlying, underlying_key, index_label FROM etfs"):
            for k in {norm(u), norm(uk), norm(lab)} - {""}:
                etf_by[k].append(s)
    con.close()

    newest = max((b[-1][0] for b in bars.values()), default=None)
    if not newest:
        print("no index closes stored")
        return
    DIR_OUT.mkdir(parents=True, exist_ok=True)
    VAL_DIR.mkdir(parents=True, exist_ok=True)
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    items, seen_sym = [], set()
    for name, rows in sorted(bars.items()):
        last = rows[-1]
        # An index NSE has stopped publishing is history, not a market.
        if day_no(newest) - day_no(last[0]) > 10:
            continue
        sym = sym_of(name)
        if sym in seen_sym:
            sym += "2"
        seen_sym.add(sym)
        days = [day_no(r[0]) for r in rows]
        closes = [r[4] for r in rows]
        ld, close = days[-1], closes[-1]
        prev = closes[-2] if len(closes) > 1 else None
        year = [r for r in rows if day_no(r[0]) >= ld - 365]
        hi52 = max(r[2] or r[4] for r in year)
        lo52 = min(r[3] or r[4] for r in year)
        ath_i = max(range(len(rows)), key=lambda i: closes[i])
        ret, cagr = {}, {}
        for label, span in RETURNS:
            base = at_or_before(days, closes, ld - span)
            if base:
                ret[label] = r2((close / base - 1) * 100, 1)
                if span >= 1095:
                    cagr[label] = r2(((close / base) ** (365.25 / span) - 1) * 100, 1)
        yrs_all = (ld - days[0]) / 365.25
        logs = [math.log(year[i][4] / year[i - 1][4]) for i in range(1, len(year)) if year[i - 1][4]]
        vol = (sum((x - sum(logs) / len(logs)) ** 2 for x in logs) / (len(logs) - 1)) ** 0.5 * math.sqrt(252) * 100 if len(logs) > 30 else None
        sma = lambda n: sum(closes[-n:]) / n if len(closes) >= n else None  # noqa: E731
        s50, s200 = sma(50), sma(200)
        val = {}
        for k, col in (("pe", 7), ("pb", 8), ("dy", 9)):
            st = val_stats([(day_no(r[0]), r[col]) for r in rows if r[col]], ld)
            if st:
                val[k] = st
        fact = meta.get(name, (None, None))[1]
        doc = {
            "s": sym, "name": name, "group": group_of(name), "exch": "BSE" if name == "SENSEX" else "NSE",
            "asof": last[0], "open": last[1], "high": last[2], "low": last[3], "close": close,
            "prev": prev, "chg": r2(close - prev) if prev else None, "chg_pct": r2((close / prev - 1) * 100) if prev else None,
            "volume": last[5], "turnover": last[6],
            "hi52": hi52, "lo52": lo52, "ath": closes[ath_i], "ath_date": rows[ath_i][0],
            "from_ath": r2((close / closes[ath_i] - 1) * 100, 1),
            "vs_dma50": r2((close / s50 - 1) * 100, 1) if s50 else None,
            "vs_dma200": r2((close / s200 - 1) * 100, 1) if s200 else None,
            "vol_1y": r2(vol, 1),
            "ret": ret, "cagr": cagr, "since": rows[0][0],
            "cagr_all": r2(((close / closes[0]) ** (1 / yrs_all) - 1) * 100, 1) if yrs_all >= 1 else None,
            "val": val,
            "members": members.get(name, []),
            "factsheet": fact,
            "etfs": sorted(set(etf_by.get(norm(name), []) + etf_by.get(norm(re.sub(r"\s+index$", "", name, flags=re.I)), []))),
        }
        has_val = bool(val)
        if has_val:
            vfile = "IDX-" + sym[1:]
            (VAL_DIR / f"{vfile}.json").write_text(json.dumps({
                "name": name, "rows": [[day_no(r[0]), r[7], r[8], r[9]] for r in rows if r[7] or r[8] or r[9]],
            }, separators=(",", ":"), allow_nan=False), encoding="utf-8")
            doc["val_file"] = vfile
        # The full-screen chart: weekly and monthly folded from every daily
        # candle, the daily ones kept for five years.
        chart = {"s": sym, "name": name, "exch": doc["exch"],
                 "d": [[_day(r[0]), _px(r[1]), _px(r[2]), _px(r[3]), _px(r[4]), int(r[5] or 0)] for r in rows]}
        _normalise(chart)
        chart["d"] = [x for x in chart["d"] if x[0] >= ld - DAILY_YEARS * 366]
        chart["asof"] = last[0]
        (CHART_DIR / f"{sym}.json").write_text(json.dumps(chart, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        (DIR_OUT / f"{sym}.json").write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False, ensure_ascii=False), encoding="utf-8")
        items.append({
            "s": sym, "name": name, "group": doc["group"], "exch": doc["exch"], "date": last[0], "close": close,
            "chg": doc["chg"], "chg_pct": doc["chg_pct"], "r1m": ret.get("1M"), "r1y": ret.get("1Y"),
            "pe": (val.get("pe") or {}).get("now"), "pb": (val.get("pb") or {}).get("now"),
            "dy": (val.get("dy") or {}).get("now"), "pe_pct": (val.get("pe") or {}).get("pct10"),
            "from_ath": doc["from_ath"], "n": len(doc["members"]),
        })
    def order(x: dict) -> tuple:
        n = x["name"].lower()
        return (GROUPS.index(x["group"]), BROAD_ORDER.index(n) if n in BROAD_ORDER else len(BROAD_ORDER), n)
    items.sort(key=order)
    LIST_OUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "asof": newest, "groups": GROUPS, "items": items,
    }, separators=(",", ":"), allow_nan=False, ensure_ascii=False), encoding="utf-8")

    # Into the search index: kind 3, so a search for "nifty bank" or "vix"
    # opens the index page.
    ix_path = PUB / "index.json"
    if ix_path.exists():
        ix = json.loads(ix_path.read_text(encoding="utf-8"))
        have = {r[0] for r in ix.get("rows", [])}
        add = [[x["s"], x["name"], x["exch"], x["close"], x["r1m"], 0, x["pe"], None, None, x["dy"], 3, x["chg_pct"]]
               for x in items if x["s"] not in have]
        ix["rows"] = ix.get("rows", []) + add
        ix_path.write_text(json.dumps(ix, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
        print(f"  search index: {len(add)} indices added")
    print(f"indices: {len(items)} written, as of {newest}; "
          f"{sum(1 for x in items if x['pe'])} with valuation, {sum(1 for x in items if x['n'])} with member lists")


if __name__ == "__main__":
    main()
