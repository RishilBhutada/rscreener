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
    for s, d, c, v in con.execute(
            f"SELECT symbol, date, close, volume FROM etf_prices WHERE close IS NOT NULL"
            f" AND symbol IN ({q}) ORDER BY symbol, date", syms):
        px.setdefault(s, []).append((d, c, v or 0))
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
    listing = []
    for (sym, name, security, underlying, ukey, klass, isin, listed, code, scheme,
         itick, fxtick, ilabel) in etfs:
        prices = px.get(sym) or []
        nav = navs.get(sym) or {}
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
            rows.append([day_no(d), round(c, 2), round(n, 4) if n else None, round(iv, 2) if iv else None])
            if n:
                prem.append((d, (c / n - 1) * 100))

        # Liquidity, over the last 20 sessions.
        last20 = prices[-20:]
        turn = [c * v / 1e7 for _d, c, v in last20]
        traded = sum(1 for _d, _c, v in last20 if v > 0)
        med_turn = median(turn) if turn else 0.0
        thin = bool(last20) and (med_turn < THIN_TURNOVER_CR or traded < THIN_TRADED_DAYS)

        nav_series = sorted(nav.items())
        px_series = [(d, c) for d, c, _v in prices]
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
            "ret_price": returns(px_series),
            "ret_nav": returns(nav_series),
            "ret_index": returns(idx_series),
            "turnover_cr": round(med_turn, 2),
            "traded_days_20": traded,
            "thin": thin,
            "rows": rows,
        }
        (DIR_OUT / f"{sym}.json").write_text(json.dumps(doc, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        listing.append({k: doc[k] for k in (
            "s", "name", "underlying", "class", "price", "price_date", "nav", "nav_date", "prem", "prem_date",
            "prem_avg_1m", "turnover_cr", "thin")} | {
            "r1y_price": doc["ret_price"].get("1y"), "r1y_nav": doc["ret_nav"].get("1y"),
            "index": ilabel})

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
          f"{sum(1 for x in listing if x['thin'])} thinly traded")

    # Into the search index as well, so an ETF can be searched for, and a
    # portfolio or watchlist holding one keeps its price - they left the
    # company table (fund_units.py), which is where those pages read prices.
    # Flagged in an 11th column so links open the ETF page, not a company one.
    ix_path = ROOT / "web" / "public" / "index.json"
    if ix_path.exists():
        ix = json.loads(ix_path.read_text(encoding="utf-8"))
        have = {r[0] for r in ix.get("rows", [])}
        add = [[x["s"], x["name"], "NSE", x["price"], None, 0, None, None, None, None, 1]
               for x in listing if x["s"] not in have]
        ix["rows"] = ix.get("rows", []) + add
        if "etf" not in ix.get("fields", []):
            ix["fields"] = ix.get("fields", []) + ["etf"]
        ix_path.write_text(json.dumps(ix, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
        print(f"  search index: {len(add)} ETFs added")


if __name__ == "__main__":
    main()
