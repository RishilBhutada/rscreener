"""Rscreener - the ETFs page (web/public/etfs.json) and one file per ETF
(web/public/etf/<SYMBOL>.json).

The number that matters is the PREMIUM: exchange price over NAV, minus one.
It is taken only from a price and a NAV for the SAME day. A NAV from the day
before would fold a day's market move into the premium, and on a 2% day that
is the whole of a normal premium.

For a foreign index ETF, the NAV struck on an Indian date uses the previous US
close, so the index line takes the last close BEFORE that date, in rupees at
that date's rate. The index is a price index; the fund tracks the total-return
version, so the NAV should run ahead of it by about the dividends.

Usage:  python export_etf_json.py
"""
import bisect
import json
from collections import Counter
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import mean, median

from export_chart_json import OUT as CHART_DIR, _day, _normalise, _px

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
LIST_OUT = ROOT / "web" / "public" / "etfs.json"
DIR_OUT = ROOT / "web" / "public" / "etf"
EPOCH = date(1970, 1, 1)
YEARS = 5
# An ETF whose units barely change hands has a closing price that can be days
# old, and its "premium" is then partly just the market having moved since.
THIN_TURNOVER_CR = 0.1     # under ₹10 lakh a day, on the median day
THIN_TRADED_DAYS = 15      # or traded on fewer than 15 of the last 20 sessions


def day_no(d: str) -> int:
    return (date.fromisoformat(d) - EPOCH).days


def pct(a: float | None, b: float | None) -> float | None:
    return round((a / b - 1) * 100, 2) if a and b else None


def at_or_before(dates: list[str], values: list[float], want: str, strict: bool = False) -> float | None:
    """The value on `want`, or the last one before it (strictly before if asked)."""
    i = bisect.bisect_left(dates, want) if strict else bisect.bisect_right(dates, want)
    return values[i - 1] if i > 0 else None


def near(series: list[tuple[str, float]], want: date, tol: int = 7) -> float | None:
    """The value closest to `want`, within `tol` days - for returns."""
    if not series:
        return None
    ds = [s[0] for s in series]
    i = bisect.bisect_left(ds, want.isoformat())
    best = None
    for j in (i - 1, i):
        if 0 <= j < len(series):
            gap = abs((date.fromisoformat(series[j][0]) - want).days)
            if gap <= tol and (best is None or gap < best[0]):
                best = (gap, series[j][1])
    return best[1] if best else None


def returns(series: list[tuple[str, float]]) -> dict:
    if len(series) < 2:
        return {}
    last_d, last_v = date.fromisoformat(series[-1][0]), series[-1][1]
    out = {}
    for key, days in (("1m", 30), ("6m", 182), ("1y", 365), ("3y", 1095)):
        base = near(series[:-1], last_d - timedelta(days=days))
        if base:
            out[key] = pct(last_v, base)
    return out


NAV_SPLITS = (2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000)


def near_ratio(q: float, choices, tol: float) -> float | None:
    """The choice (or its inverse) q is within `tol` of, if any."""
    for n in choices:
        for v in (n, 1 / n):
            if abs(q / v - 1) < tol:
                return v
    return None


def adjust_nav(nav: dict[str, float]) -> tuple[dict[str, float], list[float]]:
    """NAV per unit in TODAY's units, and the split ratios found.

    A fund that splits its units has its NAV fall by the ratio overnight - 71
    such steps across 68 ETFs in AMFI's history: 1:10 mostly, GOLDBEES 1:100
    (Dec 2019), QGOLDHALF about 1:50 (2021), GOLDADD 1:10 on 28-Aug-2026.
    Unadjusted, GOLDADD's one-year NAV return read -86.7% in a year gold rose
    32%. A move of 45% or more between consecutive NAVs is never the market for
    these funds; within 8% of a whole split ratio, every NAV before it is
    divided by that ratio."""
    days = sorted(nav)
    out: dict[str, float] = {}
    factor, found = 1.0, []
    for i in range(len(days) - 1, -1, -1):
        d = days[i]
        out[d] = nav[d] / factor
        if i and nav[d]:
            q = nav[days[i - 1]] / nav[d]
            r = near_ratio(q, NAV_SPLITS, 0.08) if (q >= 1.8 or q <= 0.55) else None
            if r:
                factor *= r
                found.append(r)
    return out, found


def clean_bars(rows: list[tuple]) -> tuple[list[tuple], int]:
    """(date, o, h, l, c, v, traded) - untraded days and one-day spikes flat.

    8% of ETF days have no trades, and the price source fills them with an old
    close, sometimes mis-scaled: SILVER1 "closed" at 82.13 for two untraded
    weeks between real closes near 8.2. A day with no volume is shown as what
    it was - the last traded price, unchanged - and kept out of every premium.
    A traded close that jumps 60% and straight back (IVZINGOLD's 11,853.30
    between 103.06 and 106.19) is a bad print and is flattened the same way."""
    out, last, n = [], None, 0
    for i, (d, o, h, lo, c, v) in enumerate(rows):
        spike = False
        if v and last and 0 < i < len(rows) - 1:
            nxt = rows[i + 1][4]
            if nxt and ((c / last > 1.6 and c / nxt > 1.6) or (c / last < 0.625 and c / nxt < 0.625)):
                spike = True
        if (not v or spike) and last:
            out.append((d, last, last, last, last, 0, False))
            n += 1
        else:
            out.append((d, o, h, lo, c, v, bool(v)))
            if v:
                last = c
    return out, n


def align_prices(rows: list[tuple], nav: dict[str, float], ratios: list[float],
                 month_end: bool = False) -> tuple[list[tuple], int]:
    """Exchange prices in the same units as the adjusted NAV.

    Yahoo adjusts some ETF splits and not others: BANKNIFTY1 closed at 631.97
    the day before its 1:10 split and 62.60 the day after. A bar whose close
    sits a split's ratio - or a power of ten - from that day's NAV is scaled to
    match, with 25% slack for the premium on top; volume moves the other way,
    so turnover is unchanged. A genuine premium never nears these ratios (the
    largest seen is MONQ50's 3.4x on 18-Sep-2026). Monthly bars are compared
    with the month's last NAV; a day without a NAV keeps the last day's scale."""
    choices = sorted({10.0, 100.0, 1000.0} | {r if r > 1 else 1 / r for r in ratios})
    nav_days = sorted(nav)
    out, scale, n = [], 1.0, 0
    for row in rows:
        d, o, h, lo, c, v = row[:6]
        if month_end:
            j = bisect.bisect_right(nav_days, d[:8] + "31") - 1
            ref = nav[nav_days[j]] if j >= 0 and nav_days[j][:7] == d[:7] else None
        else:
            ref = nav.get(d)
        if ref and c and (len(row) < 7 or row[6]):
            r = near_ratio(c / ref, choices, 0.25)
            scale = 1 / r if r else 1.0
        if scale != 1.0:
            n += 1
        out.append((d, o * scale, h * scale, lo * scale, c * scale, v / scale) + tuple(row[6:]))
    return out, n


def tidy_wick(o: float, h: float, lo: float, c: float) -> tuple[float, float, bool]:
    """(high, low, trimmed) for one of the provider's long-history monthly bars.

    Yahoo's monthly history carries corrupt extremes: MON100's June 2021 bar has
    a low of 10.07 between an open of 98.99 and a close of 107.20 - a print at a
    tenth of the price, drawn as a wick to the floor of the Max chart. 224 such
    bars across 26 ETFs on 27-Sep-2026, none in the daily bars. A month's wick
    below half its body, or above double it, is trimmed back to the body."""
    body_lo, body_hi = min(o, c), max(o, c)
    trimmed = False
    if lo < 0.5 * body_lo:
        lo, trimmed = body_lo, True
    if h > 2 * body_hi:
        h, trimmed = body_hi, True
    # And a candle always spans its own open and close. Missing highs and lows
    # arrive as 0 (BANKBEES, 2012) and stand in as the close, which left a
    # "high" below the open.
    return max(h, body_hi), min(lo, body_lo), trimmed


def main() -> None:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='etfs'").fetchone():
        print("no ETF data yet - run fetch_etfs.py; nothing exported")
        return
    etfs = con.execute(
        "SELECT symbol, name, security, underlying, underlying_key, asset_class, isin, listed,"
        " amfi_code, scheme, index_ticker, fx_ticker, index_label FROM etfs ORDER BY symbol").fetchall()
    syms = [e[0] for e in etfs]
    q = ",".join("?" * len(syms))
    px: dict[str, list[tuple[str, float, float]]] = {}
    bars: dict[str, list[tuple]] = {}
    # Open/high/low came later than the table; until a fetch has added them the
    # candles are flat at the close rather than the export failing.
    cols = {r[1] for r in con.execute("PRAGMA table_info(etf_prices)")}
    ohl = "open, high, low" if {"open", "high", "low"} <= cols else "close, close, close"
    for s, d, c, v, o, h, lo in con.execute(
            f"SELECT symbol, date, close, volume, {ohl} FROM etf_prices WHERE close IS NOT NULL"
            f" AND symbol IN ({q}) ORDER BY symbol, date", syms):
        px.setdefault(s, []).append((d, c, v or 0))
        o, h, lo = o or c, h or c, lo or c
        bars.setdefault(s, []).append((d, o, max(h, o, c), min(lo, o, c), c, v or 0))
    monthly: dict[str, list[tuple]] = {}
    wicks = 0
    if con.execute("SELECT 1 FROM sqlite_master WHERE name='etf_prices_monthly'").fetchone():
        for s, d, o, h, lo, c, v in con.execute(
                f"SELECT symbol, date, open, high, low, close, volume FROM etf_prices_monthly"
                f" WHERE close IS NOT NULL AND symbol IN ({q}) ORDER BY symbol, date", syms):
            o, h, lo = o or c, h or c, lo or c
            h, lo, cut = tidy_wick(o, h, lo, c)
            wicks += cut
            monthly.setdefault(s, []).append((d, o, h, lo, c, v or 0))
    navs: dict[str, dict[str, float]] = {}
    for s, d, n in con.execute(f"SELECT symbol, date, nav FROM etf_nav WHERE symbol IN ({q})", syms):
        navs.setdefault(s, {})[d] = n
    idx: dict[str, tuple[list[str], list[float]]] = {}
    for t, d, c in con.execute("SELECT ticker, date, close FROM index_prices ORDER BY ticker, date"):
        ds, vs = idx.setdefault(t, ([], []))
        ds.append(d)
        vs.append(c)
    con.close()

    DIR_OUT.mkdir(parents=True, exist_ok=True)
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    listing = []
    splits_seen = rescaled = flattened = 0
    docs: dict[str, dict] = {}
    group_of: dict[str, str] = {}
    charts = 0
    for (sym, name, security, underlying, ukey, klass, isin, listed, code, scheme,
         itick, fxtick, ilabel) in etfs:
        # Splits: NAVs in today's units, prices in the NAV's units.
        nav, ratios = adjust_nav(navs.get(sym) or {})
        cleaned, n_flat = clean_bars(bars.get(sym) or [])
        aligned, n_px = align_prices(cleaned, nav, ratios)
        month_bars, n_m = align_prices(monthly.get(sym) or [], nav, ratios, month_end=True)
        splits_seen += len(ratios)
        rescaled += n_px + n_m
        flattened += n_flat
        traded_on = {d for d, *_r, t in aligned if t}
        prices = [(d, c, v) for d, _o, _h, _l, c, v, _t in aligned]
        if not prices and not nav:
            continue
        start = (datetime.now(timezone.utc).date() - timedelta(days=365 * YEARS + 10)).isoformat()
        foreign = fxtick is not None

        def index_inr(d: str) -> float | None:
            if not itick or itick not in idx:
                return None
            v = at_or_before(*idx[itick], d, strict=foreign)
            if v is None:
                return None
            if foreign:
                if fxtick not in idx:
                    return None
                fx = at_or_before(*idx[fxtick], d)
                return v * fx if fx else None
            return v

        rows, prem = [], []
        for d, c, _v in prices:
            if d < start:
                continue
            n = nav.get(d)
            iv = index_inr(d)
            row = [day_no(d), round(c, 2), round(n, 4) if n else None, round(iv, 2) if iv else None]
            # A day nothing traded carries the last price; it is marked so the
            # premium - which it would only repeat - leaves it out.
            if d not in traded_on:
                row.append(0)
            rows.append(row)
            if n and d in traded_on:
                prem.append((d, (c / n - 1) * 100))

        # Liquidity, over the last 20 sessions.
        last20 = prices[-20:]
        turn = [c * v / 1e7 for _d, c, v in last20]
        traded = sum(1 for _d, _c, v in last20 if v > 0)
        med_turn = median(turn) if turn else 0.0
        thin = bool(last20) and (med_turn < THIN_TURNOVER_CR or traded < THIN_TRADED_DAYS)

        nav_series = sorted(nav.items())
        # Price returns from days something traded: an untraded day carries a
        # close that can be months old (SILVER1 went unquoted for weeks, and its
        # "price a year ago" was one of those - a 170% return in a year its NAV
        # rose 67%). No trade within a week of the date, no figure.
        px_series = [(d, c) for d, c, _v in prices if d in traded_on]
        idx_series = [(d, v) for d in [p[0] for p in prices[-800:]] if (v := index_inr(d))]
        year_ago = (date.fromisoformat(prices[-1][0]) - timedelta(days=365)).isoformat() if prices else None
        prem_1y = [p for p in prem if year_ago and p[0] >= year_ago]
        hi = max(prem_1y, key=lambda p: p[1]) if prem_1y else None
        lo = min(prem_1y, key=lambda p: p[1]) if prem_1y else None
        doc = {
            "s": sym,
            "name": scheme or name or security,
            "underlying": underlying or ukey,
            "class": klass,
            "isin": isin,
            "listed": listed,
            "amfi_code": code,
            "index": {"label": ilabel, "ticker": itick, "fx": fxtick} if itick else None,
            "price": round(prices[-1][1], 2) if prices else None,
            "price_date": prices[-1][0] if prices else None,
            "nav": nav_series[-1][1] if nav_series else None,
            "nav_date": nav_series[-1][0] if nav_series else None,
            "prem": round(prem[-1][1], 2) if prem else None,
            "prem_date": prem[-1][0] if prem else None,
            "prem_avg_1m": round(mean(p[1] for p in prem[-21:]), 2) if prem else None,
            "prem_hi_1y": [hi[0], round(hi[1], 2)] if hi else None,
            "prem_lo_1y": [lo[0], round(lo[1], 2)] if lo else None,
            # Where today's premium sits in its own past year: the share of
            # days it was LOWER. 92 reads "higher than on 92% of days".
            "prem_pct_1y": round(100 * sum(1 for p in prem_1y if p[1] < prem[-1][1]) / len(prem_1y))
                           if prem and prem_1y else None,
            "ret_price": returns(px_series),
            "ret_nav": returns(nav_series),
            "ret_index": returns(idx_series),
            "turnover_cr": round(med_turn, 2),
            "traded_days_20": traded,
            "thin": thin,
            "rows": rows,
        }
        docs[sym] = doc
        # ETFs tracking the same thing. Global ETFs share NSE's one key "GLOBAL
        # INDICES", so they are grouped by the index itself.
        group_of[sym] = ((ilabel or underlying or "") if klass == "international" else (ukey or underlying or "")).strip().lower()
        # Candles for the full-screen chart, in the company charts' format and
        # through the same builder: weekly and monthly from the NSE daily bars
        # wherever they reach, the provider's monthly bars only before that.
        b = aligned
        if b:
            candles = {
                "s": sym,
                "d": [[_day(d), _px(o), _px(h), _px(lo), _px(c), int(v)] for d, o, h, lo, c, v, _t in b],
                "m": [[_day(d), _px(o), _px(h), _px(lo), _px(c), int(v)] for d, o, h, lo, c, v in month_bars],
            }
            _normalise(candles)
            candles["asof"] = b[-1][0]
            (CHART_DIR / f"{sym}.json").write_text(json.dumps(candles, separators=(",", ":"), allow_nan=False), encoding="utf-8")
            charts += 1
        listing.append({k: doc[k] for k in (
            "s", "name", "underlying", "class", "price", "price_date", "nav", "nav_date", "prem", "prem_date",
            "prem_avg_1m", "turnover_cr", "thin")} | {
            "r1y_price": doc["ret_price"].get("1y"), "r1y_nav": doc["ret_nav"].get("1y"),
            "r1m_price": doc["ret_price"].get("1m"),
            "index": ilabel})

    # Same-index comparison, then every file is written.
    members: dict[str, list[str]] = {}
    for sym, g in group_of.items():
        if g:
            members.setdefault(g, []).append(sym)
    for sym, doc in docs.items():
        doc["same_index"] = sorted(
            ({"s": o, "name": docs[o]["name"], "prem": docs[o]["prem"], "prem_avg_1m": docs[o]["prem_avg_1m"],
              "turnover_cr": docs[o]["turnover_cr"], "thin": docs[o]["thin"],
              "r1y_nav": docs[o]["ret_nav"].get("1y")}
             for o in members.get(group_of[sym], []) if o != sym),
            key=lambda x: -(x["turnover_cr"] or 0))
        (DIR_OUT / f"{sym}.json").write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False), encoding="utf-8")

    with_prem = [x for x in listing if x["prem"] is not None]
    LIST_OUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        # The date most funds' NAV is from. Not the latest: liquid funds strike
        # a NAV for weekends too, which would date the whole list a day or two
        # past the one almost every equity ETF was valued on.
        "nav_asof": Counter(x["nav_date"] for x in listing if x["nav_date"]).most_common(1)[0][0] if listing else None,
        "etfs": listing,
    }, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    print(f"ETFs: {len(listing)} exported, {len(with_prem)} with a same-day premium, "
          f"{sum(1 for x in listing if x['thin'])} thinly traded, {charts} candle files "
          f"({wicks} corrupt monthly wicks trimmed); {splits_seen} unit splits adjusted, "
          f"{rescaled} price bars rescaled to match, {flattened} untraded or spiked days flattened")

    # Into the search index as well, so an ETF can be searched for, and a
    # portfolio or watchlist holding one keeps its price - they left the
    # company table (fund_units.py), which is where those pages read prices.
    # Flagged in an 11th column so links open the ETF page, not a company one.
    ix_path = ROOT / "web" / "public" / "index.json"
    if ix_path.exists():
        ix = json.loads(ix_path.read_text(encoding="utf-8"))
        have = {r[0] for r in ix.get("rows", [])}
        add = [[x["s"], x["name"], "NSE", x["price"], x["r1m_price"], 0, None, None, None, None, 1]
               for x in listing if x["s"] not in have]
        ix["rows"] = ix.get("rows", []) + add
        if "etf" not in ix.get("fields", []):
            ix["fields"] = ix.get("fields", []) + ["etf"]
        ix_path.write_text(json.dumps(ix, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
        print(f"  search index: {len(add)} ETFs added")


if __name__ == "__main__":
    main()
