"""Rscreener P2 - exports the fundamentals snapshot to web/public/data.json.

Unit conventions in the exported file (what the query language sees):
  mcap            market cap in Rs CRORE (like screener.in)
  pe, pb, de      plain ratios
  roe, roa, net_margin, op_margin, rev_growth, earn_growth   PERCENT
  div_yield       PERCENT (yfinance already returns percent)
  price, book_value, wk52_high, wk52_low                      Rs
Missing values are exported as null - the app must treat null as
"excluded from this screen", never as zero.
"""
import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from ratios_lib import compute_ratios, derived_roe, latest_annual_items, latest_promoter
from trend_lib import avg_npm_5y, build_trends, cagr_pct, ratio_bands


def clean_nan(o):
    """Recursively replace NaN/Inf floats with None so the JSON is browser-parseable."""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: clean_nan(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean_nan(v) for v in o]
    return o

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "data.json"

FRACTION_TO_PCT = ["roe", "roa", "net_margin", "op_margin", "gross_margin", "revenue_growth", "earnings_growth"]

RENAME = {
    "market_cap": "mcap",
    "dividend_yield": "div_yield",
    "debt_to_equity": "de",
    "revenue_growth": "rev_growth",
    "earnings_growth": "earn_growth",
}

RETURN_ANCHORS = {"ret_1m": 1, "ret_3m": 3, "ret_6m": 6, "ret_1y": 12, "ret_3y": 36, "ret_5y": 60}


def _yang_zhang(o, h, l, c, n: int, ann: float):
    """Yang-Zhang (2000) annualised volatility (%) over the last n days.

    YZ = overnight variance + k*open-to-close variance + (1-k)*Rogers-Satchell.
    Uses the full O/H/L/C bar so it is far less noisy than close-to-close and,
    unlike Parkinson/Garman-Klass, captures overnight gaps AND price drift.
    Returns None if OHLC is missing/degenerate (caller falls back to close-close)."""
    import numpy as np

    if len(c) < n + 1:
        n = len(c) - 1
    if n < 5:
        return None
    s = len(c) - n
    O, H, L, C = o[s:], h[s:], l[s:], c[s:]
    Cprev = c[s - 1:len(c) - 1]
    mask = ~(np.isnan(O) | np.isnan(H) | np.isnan(L) | np.isnan(C) | np.isnan(Cprev))
    O, H, L, C, Cprev = O[mask], H[mask], L[mask], C[mask], Cprev[mask]
    m = len(C)
    if m < 5 or np.any(O <= 0) or np.any(H <= 0) or np.any(L <= 0) or np.any(C <= 0) or np.any(Cprev <= 0):
        return None
    ov = np.log(O / Cprev)          # overnight (close -> next open)
    oc = np.log(C / O)              # open -> close
    rs = np.log(H / C) * np.log(H / O) + np.log(L / C) * np.log(L / O)  # Rogers-Satchell
    k = 0.34 / (1.34 + (m + 1) / (m - 1))
    yz2 = float(np.var(ov, ddof=1) + k * np.var(oc, ddof=1) + (1 - k) * np.mean(rs))
    if yz2 <= 0:
        return None
    return round(yz2 ** 0.5 * ann * 100, 1)


def volatility_fields(con: sqlite3.Connection) -> dict[str, dict]:
    """Annualised historical volatility (%). Primary estimator is Yang-Zhang on
    the daily OHLC bar; symbols whose OHLC hasn't been captured yet fall back to
    close-to-close so every stock keeps a number. `vol_method` records which."""
    import numpy as np

    if not con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='prices'").fetchone():
        return {}
    cols = [c[1] for c in con.execute("PRAGMA table_info(prices)").fetchall()]
    has_cols = {"open", "high", "low"} <= set(cols)
    sel = "symbol, date, open, high, low, close" if has_cols else "symbol, date, close"
    px = pd.read_sql(f"SELECT {sel} FROM prices WHERE freq='daily' ORDER BY date", con)
    out: dict[str, dict] = {}
    ann = 252 ** 0.5
    for sym, g in px.groupby("symbol"):
        C = g["close"].to_numpy(dtype=float)
        if len(C) < 40:
            continue
        O = g["open"].to_numpy(dtype=float) if has_cols else np.full(len(C), np.nan)
        H = g["high"].to_numpy(dtype=float) if has_cols else np.full(len(C), np.nan)
        L = g["low"].to_numpy(dtype=float) if has_cols else np.full(len(C), np.nan)
        has_ohlc = has_cols and not (np.isnan(O).all() or np.isnan(H).all() or np.isnan(L).all())

        Cpos = C[C > 0]
        rets = np.diff(np.log(Cpos))

        def close_close(n: int):
            if len(rets) < min(n, 20):
                return None
            return round(float(np.std(rets[-n:], ddof=1)) * ann * 100, 1)

        d: dict = {}
        for key, n in (("volatility_1y", 250), ("volatility_30d", 30)):
            v = _yang_zhang(O, H, L, C, n, ann) if has_ohlc else None
            if v is None:
                v = close_close(n)
            if v is not None:
                d[key] = v
        if d:
            d["vol_method"] = "yang-zhang" if has_ohlc else "close-close"
            out[sym] = d
    return out


def price_returns(con: sqlite3.Connection) -> dict[str, dict]:
    """Trailing returns (%) per symbol from monthly closes (latest point ~= live)."""
    if not con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='prices'").fetchone():
        return {}
    px = pd.read_sql("SELECT symbol, date, close FROM prices WHERE freq='monthly' ORDER BY date", con)
    out: dict[str, dict] = {}
    for sym, g in px.groupby("symbol"):
        closes = list(g["close"])
        d = {}
        for key, n in RETURN_ANCHORS.items():
            if len(closes) > n and closes[-1 - n]:
                d[key] = round((closes[-1] / closes[-1 - n] - 1) * 100, 1)
        if d:
            out[sym] = d
    return out


def withhold_on_dead_equity(df, col: str) -> int:
    """Blank a ratio whose company has no net worth left; returns how many.

    260 companies published a NEGATIVE price-to-book, because accumulated losses
    have wiped out their equity. A positive price over a negative book gives
    something like -0.20, which sorts to the TOP of a cheapest-by-P/B screen and
    reads as a bargain - the same trap the screens page already names for P/E:
    "a negative P/E is a loss, not a cheap share". ROE has the identical problem
    from the identical cause: -8,399% for SML, -4,016% for McLeod Russel, both
    produced by dividing into an equity that is not there.

    The BOOK VALUE itself keeps being published. It is real, and it is the
    point - net worth per share is negative, and a reader should see that rather
    than a ratio built on top of it.
    """
    if col not in df.columns:
        return 0
    bv = pd.to_numeric(df["book_value"], errors="coerce")
    vals, n = [], 0
    for v, b in zip(df[col], bv):
        if v is not None and v == v and pd.notna(b) and b <= 0:
            vals.append(None); n += 1
        else:
            vals.append(v)
    df[col] = vals
    return n


def freshen_prices(con, df):
    """Replace the snapshot price with the newest close we actually hold, and
    stamp every row with the date that price belongs to.

    `fundamentals` is a point-in-time snapshot; nothing forced it to be re-fetched
    before an export, so a snapshot taken on 10-Jul shipped unchanged for weeks.
    HDFC Bank showed Rs 824.95 against a real Rs 750.35 and MTAR Tech Rs 7,101
    against Rs 5,194 - 27% out, on the number every other figure on the page is
    derived from. The daily series is refreshed far more often, so wherever it is
    newer it wins, and market cap is rescaled with it (share count is the thing
    that actually stays put between refreshes, so mcap/price is the safe pivot).

    The date is exported too: a price with no date attached is untestable, which
    is exactly how this survived so long.
    """
    latest = {}
    for sym, d, c in con.execute(
        "SELECT symbol, MAX(date), close FROM prices WHERE freq='daily' GROUP BY symbol"
    ):
        if c:
            latest[sym] = (d, float(c))
    moved = 0
    px, mc = df["price"].copy(), df["market_cap"].copy()
    # Every ratio Yahoo hands us with a price in the numerator has to move with the
    # price, or the page ends up quoting a fresh price beside a three-week-old P/E.
    SCALE_UP = ["pe", "pb", "forward_pe"]      # price/x  -> multiply by the move
    SCALE_DOWN = ["dividend_yield"]            # x/price  -> divide by it
    # coerced: a few rows carry these as text ("None", ""), and scaling a string
    # by a float raises rather than degrading quietly
    scaled = {
        c: pd.to_numeric(df[c], errors="coerce")
        for c in SCALE_UP + SCALE_DOWN if c in df.columns
    }
    # Share count taken from the snapshot BEFORE anything is rescaled. Every ratio
    # already uses mcap/price as its share count, and exporting the same figure
    # lets check_prices.py assert price x shares == mcap afterwards - which is the
    # test that would have caught a price moving without its market cap.
    df["shares_out"] = [
        (m / p) if (m and p) else None for m, p in zip(df["market_cap"], df["price"])
    ]
    # Two price sources. The daily bar carries a real trading date and is
    # reproducible; the fundamentals snapshot carries only a fetch timestamp, which
    # is not a market date at all - a quote pulled on Saturday belongs to Friday's
    # session. So the bar wins wherever we have one, and the snapshot is the
    # fallback for tickers with no series (delisted, renamed, freshly listed).
    # Live intraday pricing is a separate layer (a broker feed), not this one.
    snap_date = [(str(v)[:10] if v else None) for v in df.get("fetch_date", pd.Series([None] * len(df)))]
    dates = []
    for i, sym in enumerate(df["symbol"]):
        hit = latest.get(sym)
        if not hit:
            dates.append(snap_date[i])
            continue
        d, close = hit
        old = px.iat[i]
        dates.append(d)
        if not old or not close:
            continue
        if abs(close - old) / old > 0.002:          # ignore rounding-level drift
            r = close / old
            shares = (mc.iat[i] / old) if mc.iat[i] else None
            px.iat[i] = close
            if shares:
                mc.iat[i] = shares * close          # keep mcap = price x shares
            for c in SCALE_UP:
                v = scaled.get(c)
                if v is not None and v.iat[i]:
                    v.iat[i] = v.iat[i] * r
            for c in SCALE_DOWN:
                v = scaled.get(c)
                if v is not None and v.iat[i]:
                    v.iat[i] = v.iat[i] / r
            moved += 1
    df["price"], df["market_cap"] = px, mc
    for c, v in scaled.items():
        df[c] = v
    # The yardstick is the newest TRADING date in the export - snapshot fetch dates
    # are excluded, or one ticker re-pulled on a Saturday would mark the whole
    # market stale against a day the exchange never opened.
    fresh = max([d for d, _ in latest.values()], default=None)
    stale = [bool(fresh and d and d < fresh) for d in dates]
    df["price_date"], df["price_stale"] = dates, stale

    # How many days this company actually TRADED in the last 30, straight from
    # its daily bars - a bar exists only for a day on which a trade happened.
    #
    # It is the difference between a broken pipeline and an illiquid stock, and
    # until BSE arrived they looked the same because every NSE company of any
    # size trades daily. 0.1% of NSE companies lag the newest close; the BSE
    # scrips lag at 7.4%, not because anything failed but because nobody traded
    # them. Counted across 5,000 companies that alone would have pushed the
    # staleness guard past its 2% limit and blocked every publish, for a reading
    # that says nothing about whether the fetcher works.
    #
    # Counted from TODAY, not from the freshest row in the table. Anchored to
    # `fresh` it inherits that row's outlier problem: one company re-fetched by
    # hand carried a bar 19 days newer than everyone else, so every other
    # company had too few bars inside the window, only ONE company qualified as
    # regularly traded, and the freshness score was a median over a single
    # stock reading a perfect 100. A window defined by the data it is measuring
    # is not a window.
    #
    # Counted over the 30 days ending at each company's OWN newest bar - not
    # from today, and not from the freshest row anywhere.
    #
    # This distinguishes two things that kept getting confused. LIQUIDITY is a
    # property of the stock: does it trade most days. STALENESS is a property of
    # our fetch: how old its newest bar is. Anchoring the window to today
    # collapses them, because a company we have not refreshed in three weeks has
    # no recent bars and therefore looks illiquid - so check_prices dropped it
    # from the population it was testing FOR staleness. Measured on the real
    # export: 4,745 companies stale, 4,745 excluded, exactly ONE judged. The
    # staler a company got, the less likely the guard was to look at it.
    #
    # Anchored to the company's own last bar, a regular trader still scores ~20
    # however far behind we are, stays in the judged population, and its age is
    # then tested against today - which is the test that catches us.
    try:
        recent = con.execute(
            "SELECT p.symbol, COUNT(DISTINCT p.date) FROM prices p "
            "JOIN (SELECT symbol, MAX(date) AS last FROM prices WHERE freq='daily' "
            "      GROUP BY symbol) m ON m.symbol = p.symbol "
            "WHERE p.freq='daily' AND p.date >= date(m.last, '-30 day') "
            "GROUP BY p.symbol"
        ).fetchall()
    except Exception:  # noqa: BLE001
        recent = []
    bars = dict(recent)
    df["bars30"] = [bars.get(s, 0) for s in df["symbol"]]

    try:
        ex = {r[0]: r[1] for r in con.execute("SELECT SYMBOL, EXCHANGE FROM universe")}
    except Exception:  # noqa: BLE001 - a database from before the column existed
        ex = {}
    df["exchange"] = [ex.get(s) or "NSE" for s in df["symbol"]]

    # The company's NAME, from the exchange when the market-data provider has
    # none. 478 companies shipped with a blank name and rendered as their ticker
    # - "MAXESTATES (MAXESTATES)" for Max Estates Limited, "AADHARHFC" for Aadhar
    # Housing Finance - and every one of them had a perfectly good name sitting
    # in the universe table the whole time, because that is where the exchange's
    # own listing file was loaded. The page was reading one source and ignoring
    # the other.
    try:
        listed = {r[0]: (r[1] or "").strip()
                  for r in con.execute('SELECT SYMBOL, "NAME OF COMPANY" FROM universe')}
    except Exception:  # noqa: BLE001
        listed = {}
    filled = 0
    names = []
    for sym, nm in zip(df["symbol"], df["name"]):
        if (nm is None or not str(nm).strip() or str(nm) == "nan") and listed.get(sym):
            names.append(listed[sym]); filled += 1
        else:
            names.append(nm)
    df["name"] = names
    if filled:
        print(f"  filled {filled} missing company names from the exchange listing")

    # A ratio whose denominator is gone is not a ratio.
    #
    # 260 companies published a NEGATIVE price-to-book, because their net worth
    # is negative - accumulated losses have wiped the equity out. Dividing a
    # positive price by it produces something like -0.20, which sorts to the top
    # of a "cheapest by P/B" screen and reads as a bargain. It is the same trap
    # the screens page already names for P/E: "a negative P/E is a loss, not a
    # cheap share". ROE has the identical problem from the identical cause -
    # -8,399% for SML, -4,016% for McLeod Russel - a number produced by dividing
    # by an equity that is not there.
    #
    # The BOOK VALUE itself keeps being published. It is real and it is the
    # point: net worth per share is negative, and the reader should see that
    # rather than a ratio built on it. Only the ratios go.
    n_pb = withhold_on_dead_equity(df, "pb")
    if n_pb:
        print(f"  withheld {n_pb} price-to-book figures whose company has negative "
              f"net worth - a negative P/B sorts to the top of a cheapest-first screen")
    undated = sum(1 for d in dates if not d)
    print(f"  price refresh: {moved} symbols moved onto the latest traded close "
          f"(as of {fresh}, {sum(stale)} behind it, {undated} undated)")
    return df, fresh


def main() -> None:
    con = sqlite3.connect(DB, timeout=180)
    df = pd.read_sql("SELECT * FROM fundamentals", con)
    df, price_asof = freshen_prices(con, df)  # never show a price older than the series we hold
    n_universe = pd.read_sql("SELECT COUNT(*) n FROM universe", con)["n"][0]
    shares_by_symbol = {
        r["symbol"]: r["market_cap"] / r["price"]
        for r in df.to_dict(orient="records")
        if r.get("market_cap") and r.get("price")
    }
    trends = build_trends(con, shares_by_symbol)
    items_by_symbol = latest_annual_items(con)
    promoter_by_symbol = latest_promoter(con)
    pe_by_symbol = {s: b["pe"] for s, b in ratio_bands(con, shares_by_symbol).items() if "pe" in b}
    returns_by_symbol = price_returns(con)
    vol_by_symbol = volatility_fields(con)
    roe_calc = derived_roe(con)
    con.close()

    # computed ratios need RAW rupee values - run before any unit conversion
    computed = [
        compute_ratios(row, items_by_symbol.get(row["symbol"], {}))
        for row in df.to_dict(orient="records")
    ]
    comp_df = pd.DataFrame(computed)
    for col in comp_df.columns:
        df[col] = comp_df[col].values
    df["promoter_holding"] = df["symbol"].map(promoter_by_symbol)
    df["median_pe_5y"] = df["symbol"].map(lambda s: pe_by_symbol.get(s, {}).get("median_5y"))
    for vk in ("volatility_1y", "volatility_30d", "vol_method"):
        df[vk] = df["symbol"].map(lambda s, k=vk: vol_by_symbol.get(s, {}).get(k))
    for rk in RETURN_ANCHORS:
        df[rk] = df["symbol"].map(lambda s, k=rk: returns_by_symbol.get(s, {}).get(k))
    df["off_52w_high"] = df.apply(lambda r: round((r["price"] / r["wk52_high"] - 1) * 100, 1) if r["price"] and r["wk52_high"] else None, axis=1)
    df["avg_npm_5y"] = df["symbol"].map(lambda s: avg_npm_5y(trends.get(s, {}).get("annual")))
    for key in ("ret_1m", "ret_3m", "ret_6m", "ret_1y", "ret_3y", "ret_5y"):
        df[key] = df["symbol"].map(lambda s, k=key: returns_by_symbol.get(s, {}).get(k))
    df["off_52w_high"] = [
        round((p / h - 1) * 100, 1) if p and h else None
        for p, h in zip(df["price"], df["wk52_high"])
    ]

    def growth(sym: str, item: str, years: int):
        t = trends.get(sym, {}).get("annual")
        if not t:
            return None
        return cagr_pct(t[item], t["periods"], years)

    df["sales_cagr_5y"] = df["symbol"].map(lambda s: growth(s, "revenue", 5))
    df["sales_cagr_10y"] = df["symbol"].map(lambda s: growth(s, "revenue", 10))
    df["profit_cagr_5y"] = df["symbol"].map(lambda s: growth(s, "pat", 5))
    df["profit_cagr_10y"] = df["symbol"].map(lambda s: growth(s, "pat", 10))

    # Fill ROE where the source omitted it, from the company's own statements.
    # Runs while roe is still a fraction, so it lands in the same units as every
    # published value and converts with them on the next line.
    if roe_calc:
        before = int(df["roe"].notna().sum())
        df["roe"] = [
            v if v is not None and v == v else roe_calc.get(s)
            for s, v in zip(df["symbol"], df["roe"])
        ]
        after = int(df["roe"].notna().sum())
        print(f"  ROE: {before} published by the source, {after - before} worked out from "
              f"the filings, {len(df) - after} still unknown")

    # AFTER the fill, deliberately. Done before it, the fill puts the figure
    # straight back: McLeod Russel kept its -4,016% through the first attempt at
    # this, because nulling a value earlier in the pipeline than the step that
    # populates it changes nothing at all.
    # A margin of exactly zero beside a material profit or loss is the source
    # saying "I do not know", published as a number. Yahoo reports
    # profitMargins 0.0 for BGR Energy while its net income is -1,247 crore on
    # 227 crore of revenue - a real margin of -550%. 405 rows carried a 0.0
    # margin, 151 of them with material income behind it, and on screen a 0%
    # margin reads as "breaks even" rather than "unknown".
    #
    # Where net income and revenue are both known and revenue is positive, the
    # margin is arithmetic and is computed. Where it is not, the field is blanked
    # rather than left saying zero.
    fixed_margin = blanked_margin = 0
    if {"net_margin", "net_income", "revenue"} <= set(df.columns):
        nm, ni, rev = [], df["net_income"], df["revenue"]
        for v, inc, rv in zip(df["net_margin"], ni, rev):
            material = inc is not None and inc == inc and abs(inc) > 1e7   # over Rs 1 crore
            if v == 0 and material:
                if rv is not None and rv == rv and rv > 0:
                    nm.append(inc / rv); fixed_margin += 1        # still a fraction here
                else:
                    nm.append(None); blanked_margin += 1
            else:
                nm.append(v)
        df["net_margin"] = nm
    if fixed_margin or blanked_margin:
        print(f"  net margin: {fixed_margin} recomputed from income and revenue, "
              f"{blanked_margin} blanked where the source said 0 beside a real loss")

    # Revenue that is not positive is not a denominator. 41 companies published
    # negative revenue, which produced 27 NEGATIVE price-to-sales values - and a
    # negative P/S sorts to the top of a cheapest-first screen, the same trap as
    # the negative price-to-book.
    n_ps = 0
    if {"ps", "revenue"} <= set(df.columns):
        vals = []
        for v, rv in zip(df["ps"], df["revenue"]):
            if v is not None and v == v and rv is not None and rv == rv and rv <= 0:
                vals.append(None); n_ps += 1
            else:
                vals.append(v)
        df["ps"] = vals
    if n_ps:
        print(f"  withheld {n_ps} price-to-sales figures whose company reports "
              f"non-positive revenue")

    n_roe = withhold_on_dead_equity(df, "roe")
    if n_roe:
        print(f"  withheld {n_roe} ROE figures whose company has negative net worth - "
              f"dividing by an equity that is gone produces -4,016%, not a return")

    for col in FRACTION_TO_PCT:
        df[col] = (df[col] * 100).round(2)
    df["market_cap"] = (df["market_cap"] / 1e7).round(1)  # Rs -> Rs crore
    df["debt_to_equity"] = (df["debt_to_equity"] / 100).round(3)  # Yahoo's 36.65 -> 0.37 ratio, screener.in style

    # Price-to-sales and EV/EBITDA divide a RUPEE market cap by a figure taken
    # from the source's own statements, and those two are not always in the same
    # currency. Infosys and HCL Technologies are listed in New York, so their
    # revenue arrives in US DOLLARS - Infosys at 2,030 against the 153,670 crore
    # it filed. Divided into a rupee market cap that produced a price-to-sales
    # of 234 next to TCS's 3.2, which reads as Infosys being seventy times the
    # more expensive company. 88 companies had a scale mismatch of some kind
    # between the two sources.
    #
    # Both ratios are therefore rebuilt from the FILED figures, which are in
    # rupees by construction and are the same numbers the charts and quarterly
    # tables already show. Trailing twelve months where four quarters are on
    # file, the latest full year otherwise. The source's own figure is kept only
    # where nothing has been filed.
    def filed_ttm(sym: str, field: str) -> float | None:
        t = trends.get(sym) or {}
        q = t.get("quarterly") or {}
        vals = [v for v in (q.get(field) or [])[-4:] if v is not None]
        if len(vals) == 4:
            return sum(vals)
        a = t.get("annual") or {}
        for v in reversed(a.get(field) or []):
            if v is not None:
                return v
        return None

    rebuilt_ps = rebuilt_ev = 0
    ps_new, ev_new = [], []
    for sym, mc, ps_old, ev_old, debt, cash in zip(
        df["symbol"], df["market_cap"], df["ps"], df["ev_ebitda"],
        df["total_debt"], df["total_cash"]
    ):
        rev = filed_ttm(sym, "revenue")
        eb = filed_ttm(sym, "ebitda")
        if mc and rev and rev > 0:
            ps_new.append(round(mc / rev, 2)); rebuilt_ps += 1
        else:
            ps_new.append(ps_old)
        if mc and eb and eb > 0:
            ev = mc + (debt or 0) / 1e7 - (cash or 0) / 1e7
            ev_new.append(round(ev / eb, 2)); rebuilt_ev += 1
        else:
            ev_new.append(ev_old)
    df["ps"], df["ev_ebitda"] = ps_new, ev_new
    print(f"  rebuilt from filed figures: P/S {rebuilt_ps}, EV/EBITDA {rebuilt_ev}")
    df = df.rename(columns=RENAME)

    keep = [
        "symbol", "name", "sector", "industry", "price", "mcap", "pe", "forward_pe",
        "pb", "book_value", "roe", "roa", "de", "div_yield", "net_margin", "op_margin",
        "gross_margin", "rev_growth", "earn_growth", "revenue", "net_income",
        "total_debt", "total_cash", "free_cashflow", "wk52_high", "wk52_low", "beta",
        "sales_cagr_5y", "sales_cagr_10y", "profit_cagr_5y", "profit_cagr_10y",
        "roce", "ev_ebitda", "ps", "peg", "int_coverage", "div_payout",
        "debtor_days", "inventory_days", "promoter_holding",
        "median_pe_5y", "avg_npm_5y",
        "ret_1m", "ret_3m", "ret_6m", "ret_1y", "ret_3y", "ret_5y", "off_52w_high",
        "volatility_1y", "volatility_30d", "vol_method",
        "shares_out", "price_date", "bars30", "exchange",
    ]
    df = df[keep]
    df = df.astype(object).where(pd.notna(df), None)

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "price_asof": price_asof,          # the newest close in this file; check_prices.py enforces it
        "universe_size": int(n_universe),
        "covered": len(df),
        "rows": df.to_dict(orient="records"),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(clean_nan(payload), ensure_ascii=False, allow_nan=False), encoding="utf-8")
    kb = OUT.stat().st_size / 1024
    print(f"exported {len(df)}/{n_universe} symbols -> {OUT} ({kb:.0f} KB)")
    sample = df[df.symbol == "RELIANCE"]
    if not sample.empty:
        print(sample[["symbol", "price", "mcap", "pe", "roe", "de", "div_yield"]].to_string(index=False))


if __name__ == "__main__":
    main()
