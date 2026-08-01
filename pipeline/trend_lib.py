"""Builds stitched long-term P&L trends and valuation-ratio bands per symbol.

Two sources, one series:
  - results_history (NSE XBRL, as-filed, reaches ~2018 and earlier) wins wherever it exists
  - statements (yfinance) fills periods the XBRL index doesn't cover (mainly the newest 1-2 years)

Derived per period (matching screener.in's chart section):
  - EBITDA / Operating Profit = Revenue - Expenses + Finance cost + Depreciation
    (NSE "Total Expenses" bundles interest & depreciation; screener's Operating
     Profit excludes them, so we add them back)
  - Gross Profit = Revenue - COGS   (COGS = materials + purchases + inventory change)
  - OPM/GPM/NPM % and per-share Book Value
Money is converted to Rs crore here (eps and per-share book value stay in rupees).
"""
import sqlite3
from datetime import datetime

import pandas as pd

# yfinance income-statement item -> our field name
YF_INCOME_MAP = {
    "Total Revenue": "revenue",
    "Net Income": "pat",
    "Basic EPS": "eps",
    "Total Expenses": "total_expenses",
    "EBITDA": "ebitda_direct",
    "Reconciled Cost Of Revenue": "cogs_direct",
}
# NSE as-filed items we read from results_history
NSE_ITEMS = [
    "revenue", "pat", "eps", "total_expenses", "finance_cost", "depreciation",
    "cost_materials", "purchases", "inv_change", "equity", "share_capital",
    "gross_profit", "op_profit_direct", "interest_expended", "operating_expenses",
]
MONEY = {  # fields to convert Rs -> Rs crore on emit (eps / margins / book-value-per-share excluded)
    "revenue", "pat", "total_expenses", "finance_cost", "depreciation",
    "cost_materials", "purchases", "inv_change", "equity", "ebitda_direct", "cogs_direct",
}
KEEP_ANNUAL = 25
KEEP_QUARTERLY = 88  # ~22 years, matching screener.in's Max span on the ratio charts


def _table_exists(con: sqlite3.Connection, name: str) -> bool:
    return bool(con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def _cr(v):
    return round(v / 1e7, 1) if pd.notna(v) else None  # pd.notna guards None AND NaN


def _stitched(con: sqlite3.Connection) -> dict:
    """{(symbol, period_type): {period_end: {field: raw_value, '_source': src}}} with NSE winning."""
    frames = []
    if _table_exists(con, "results_history"):
        placeholders = ",".join("?" * len(NSE_ITEMS))
        xb = pd.read_sql(
            f"SELECT symbol, period_type, period_end, item, value FROM results_history WHERE item IN ({placeholders})",
            con, params=NSE_ITEMS,
        )
        xb["source"] = "nse"
        frames.append(xb)
    if _table_exists(con, "statements"):
        yf = pd.read_sql(
            "SELECT symbol, period_type, period_end, item, value FROM statements "
            "WHERE stmt_type='income' AND item IN ('Total Revenue','Net Income','Basic EPS','Total Expenses','EBITDA','Reconciled Cost Of Revenue')",
            con,
        )
        yf["item"] = yf["item"].map(YF_INCOME_MAP)
        yf["source"] = "yf"
        frames.append(yf)
    if not frames:
        return {}
    df = pd.concat(frames, ignore_index=True)
    out: dict = {}
    for (symbol, ptype), grp in df.groupby(["symbol", "period_type"]):
        periods: dict[str, dict] = {}
        for src in ("yf", "nse"):  # nse second -> as-filed overwrites yf
            for _, r in grp[grp.source == src].iterrows():
                slot = periods.setdefault(r["period_end"], {"_source": src})
                slot[r["item"]] = r["value"]
                if src == "nse":
                    slot["_source"] = "nse"
        out[(symbol, ptype)] = periods
    return out


def balance_equity(con: sqlite3.Connection) -> dict:
    """{(symbol, period_end): shareholders' funds} from the balance sheet.

    The results filings only carry paid-up capital, so real net worth - and with
    it any usable book value - has to come from the balance sheet.
    """
    if not _table_exists(con, "statements"):
        return {}
    df = pd.read_sql(
        "SELECT symbol, period_end, item, value FROM statements WHERE stmt_type='balance' "
        "AND item IN ('Common Stock Equity','Stockholders Equity') ORDER BY period_end",
        con,
    )
    out: dict = {}
    for _, r in df.iterrows():
        if pd.notna(r["value"]):
            out.setdefault((r["symbol"], r["period_end"]), float(r["value"]))
    return out


def effective_shares(pat, eps, factor: float):
    """Share count at a past date, expressed on the ADJUSTED-price basis.

    Market cap at time t is unadjusted_price(t) x shares(t). Our price series is
    split-adjusted - unadjusted/F(t) - so the matching count is shares(t)*F(t).
    Using TODAY's count instead is only valid when every change was a split;
    HDFC Bank issued ~65% new shares for the HDFC merger, so its 2007 market cap
    came out 2.4x too large, taking Price/Book, EV/EBITDA and MCap/Sales with it.
    shares(t) comes from PAT/EPS - both as-filed in the same statement, so their
    ratio is exactly the count that filing was written against.
    """
    if not pat or not eps:
        return None
    shares = pat / eps
    return shares * factor if shares > 0 else None


def net_worth(slot: dict):
    """Shareholders' funds, or None if the filing only gave paid-up capital.

    The Reg-33 'Equity' tag is PAID-UP EQUITY SHARE CAPITAL, not net worth -
    HDFC Bank files Rs 1,540 cr there against a real net worth near Rs 7.7 lakh
    cr. Dividing by it produced a book value ~190x too small and a Price/Book of
    2,382 where screener shows 3.6. Net worth is always a large multiple of paid-up
    capital, so anything close to it is rejected and the balance sheet used instead.
    """
    eq, sc = slot.get("equity"), slot.get("share_capital")
    if eq is None:
        return None
    if sc and eq < sc * 3:
        return None
    return eq


def _derive(slot: dict) -> dict:
    """Compute ebitda / gross_profit / margins from a period's raw fields (raw Rs)."""
    rev = slot.get("revenue")
    exp = slot.get("total_expenses")
    fin = slot.get("finance_cost") or 0.0
    dep = slot.get("depreciation") or 0.0
    # Banks file operating profit outright ("Financing Profit" on screener.in);
    # for everyone else it is Revenue - Expenses + Interest + Depreciation.
    ebitda = slot.get("op_profit_direct") or slot.get("ebitda_direct")
    if ebitda is None and rev is not None and exp is not None:
        ebitda = rev - exp + fin + dep
    gp = slot.get("gross_profit")  # some old sheets report Gross Profit outright
    if gp is None:
        cogs = slot.get("cogs_direct")
        if cogs is None:
            parts = [slot.get(k) for k in ("cost_materials", "purchases", "inv_change")]
            if any(p is not None for p in parts):
                cogs = sum(p for p in parts if p is not None)
        gp = (rev - cogs) if (rev is not None and cogs is not None) else None
    return {"ebitda": ebitda, "gross_profit": gp}


def build_trends(con: sqlite3.Connection, shares: dict | None = None) -> dict[str, dict]:
    shares = shares or {}
    comps = _stitched(con)
    splits = split_factors(con)
    known = splits_known(con)
    bal = balance_equity(con)
    out: dict[str, dict] = {}
    for (symbol, ptype), periods in comps.items():
        keep = KEEP_ANNUAL if ptype == "annual" else KEEP_QUARTERLY
        ordered = sorted(periods)[-keep:]
        if not ordered:
            continue
        sh = shares.get(symbol)

        def pct(num, den):
            return round(num / den * 100, 2) if (num is not None and den) else None

        ev = splits.get(symbol)

        def adj_eps(p):
            """As-filed EPS put on today's share base, to match the adjusted price.

            Splits and bonuses only - the same convention screener.in uses. A
            MERGER is deliberately not restated: HDFC Bank absorbing HDFC Ltd in
            2023 raised the share count ~65%, but those shares bought a second
            business, so dividing old profits by the enlarged count understates
            historical EPS (it put HDFC Bank's 2006 PE at 70 instead of ~30).
            PAT / current shares is only a fallback for symbols whose split
            history was never successfully fetched.
            """
            e = periods[p].get("eps")
            if symbol in known:
                return None if e is None else round(e / adj_factor(ev, p), 2)
            pat_v = periods[p].get("pat")
            if pat_v is not None and sh:
                return round(pat_v / sh, 2)
            return None if e is None else round(e / adj_factor(ev, p), 2)

        rev = [periods[p].get("revenue") for p in ordered]
        pat = [periods[p].get("pat") for p in ordered]
        eps = [adj_eps(p) for p in ordered]
        exp = [periods[p].get("total_expenses") for p in ordered]
        deriv = [_derive(periods[p]) for p in ordered]
        ebitda = [d["ebitda"] for d in deriv]
        gp = [d["gross_profit"] for d in deriv]
        # filings give paid-up capital only; the balance sheet gives net worth
        equity = [net_worth(periods[p]) or bal.get((symbol, p)) for p in ordered]
        trend = {
            "periods": ordered,
            "revenue": [_cr(v) for v in rev],
            "pat": [_cr(v) for v in pat],
            "eps": [round(v, 2) if v is not None else None for v in eps],
            "expenses": [_cr(v) for v in exp],
            "ebitda": [_cr(v) for v in ebitda],
            "book_value": [round(e / sh, 2) if (pd.notna(e) and sh) else None for e in equity],
            "opm": [pct(ebitda[i], rev[i]) for i in range(len(ordered))],
            "gpm": [pct(gp[i], rev[i]) for i in range(len(ordered))],
            "npm": [pct(pat[i], rev[i]) for i in range(len(ordered))],
            "source": [periods[p]["_source"] for p in ordered],
        }
        if any(v is not None for v in trend["revenue"]):
            out.setdefault(symbol, {})[ptype] = trend
    return out


def split_factors(con: sqlite3.Connection) -> dict[str, list[tuple[str, float]]]:
    """{symbol: [(date, ratio), ...]} of split/bonus events, oldest first."""
    if not _table_exists(con, "splits"):
        return {}
    out: dict[str, list[tuple[str, float]]] = {}
    for sym, d, r in con.execute("SELECT symbol, date, ratio FROM splits ORDER BY date"):
        if r and r > 0:
            out.setdefault(sym, []).append((d, float(r)))
    return out


def splits_known(con: sqlite3.Connection) -> set[str]:
    """Symbols with at least one recorded split/bonus.

    Only these take the exact split-factor path. An empty split list is
    ambiguous - it means either "never split" or "never fetched" - and guessing
    wrong leaves EPS unadjusted, which put ITC's 2006 PE at 1.0. For those the
    PAT / current-shares fallback is used instead: it is exact when a company
    truly never split, and merely approximate otherwise, so it fails softly
    in both directions.
    """
    if not _table_exists(con, "splits"):
        return set()
    return {r[0] for r in con.execute("SELECT DISTINCT symbol FROM splits")}


def adj_factor(events: list[tuple[str, float]] | None, period_end: str) -> float:
    """How many of today's shares one share at `period_end` became.

    Yahoo's price series is already divided by this; as-filed EPS is not. Divide
    EPS by the same factor and price/EPS finally compare like with like.
    Share CAPITAL cannot substitute here: in a split the face value falls as the
    count rises, so capital is unchanged and the split is invisible to it.
    """
    if not events:
        return 1.0
    f = 1.0
    for d, r in events:
        if d > period_end:
            f *= r
    return f or 1.0


def _median(vals: list[float]) -> float:
    s = sorted(vals)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def _band(series: list[list], round_to: int = 1) -> dict | None:
    """Median is taken over the trailing 5 years by DATE, so it means the same
    thing whether the series is weekly or monthly."""
    if len(series) < 12:
        return None
    end = series[-1][0]
    cutoff = f"{int(end[:4]) - 5}{end[4:]}"
    last5y = [v for d, v in series if d >= cutoff] or [v for _, v in series]
    return {"series": series, "median_5y": round(_median(last5y), round_to)}


def ratio_bands(con: sqlite3.Connection, shares: dict, netdebt: dict | None = None) -> dict[str, dict]:
    """Monthly PE / EV-EBITDA / Price-to-Book / MarketCap-to-Sales bands per symbol.

    All ratios use as-filed quarterly fundamentals (results_history) against the
    monthly close, mirroring screener.in. EV uses market cap + latest net debt;
    book value uses the most recent as-filed equity. Depth is bounded by the
    fundamental series (EV / book value are shallower than PE / P-S because free
    balance-sheet history is short)."""
    if not (_table_exists(con, "prices") and _table_exists(con, "results_history")):
        return {}
    netdebt = netdebt or {}
    splits = split_factors(con)
    known = splits_known(con)
    q = pd.read_sql(
        "SELECT symbol, period_end, item, value FROM results_history "
        "WHERE period_type='quarterly' AND item IN "
        "('eps','pat','revenue','total_expenses','finance_cost','depreciation','equity','share_capital') "
        "ORDER BY period_end",
        con,
    )
    # recent quarters yfinance covers but the XBRL index doesn't yet (keeps the
    # newest TTM current instead of frozen at the last as-filed quarter)
    yq_by_sym: dict[str, dict] = {}
    if _table_exists(con, "statements"):
        yq = pd.read_sql(
            "SELECT symbol, period_end, item, value FROM statements "
            "WHERE stmt_type='income' AND period_type='quarterly' "
            "AND item IN ('Total Revenue','Basic EPS','EBITDA','Net Income') ORDER BY period_end",
            con,
        )
        for sym, g in yq.groupby("symbol"):
            by_pe: dict[str, dict] = {}
            for _, r in g.iterrows():
                by_pe.setdefault(r["period_end"], {})[r["item"]] = r["value"]
            yq_by_sym[sym] = by_pe

    # quarterly components per symbol: period_end -> {eps, revenue_cr, ebitda_cr}
    flow_by_sym: dict[str, list] = {}
    equity_by_sym: dict[str, list] = {}
    for sym, g in q.groupby("symbol"):
        by_pe: dict[str, dict] = {}
        for _, r in g.iterrows():
            by_pe.setdefault(r["period_end"], {})[r["item"]] = r["value"]
        ev = splits.get(sym)
        flows, eqs = [], []
        for pe in sorted(by_pe):
            s = by_pe[pe]
            rev, exp = s.get("revenue"), s.get("total_expenses")
            fin, dep = s.get("finance_cost") or 0.0, s.get("depreciation") or 0.0
            ebitda = (rev - exp + fin + dep) if (rev is not None and exp is not None) else None
            # Mirror adj_eps(): exact split factor when the split history is
            # known, else PAT / current shares. Testing "eps is None" first (as
            # this once did) meant a symbol with no split data kept its raw
            # as-filed EPS - ITC's 2006 PE came out at 1.0 instead of ~20.
            eps = s.get("eps")
            if sym in known:
                if eps is not None:
                    eps /= adj_factor(ev, pe)
            else:
                pat_v, sh_now = s.get("pat"), shares.get(sym)
                if pat_v is not None and sh_now:
                    eps = pat_v / sh_now
            flows.append((pe, eps, (rev / 1e7 if rev is not None else None),
                          (ebitda / 1e7 if ebitda is not None else None),
                          effective_shares(s.get("pat"), s.get("eps"), adj_factor(ev, pe))))
            # The filings' "Equity" is paid-up capital in the Ind-AS/bank
            # taxonomies but real net worth in the older sheets (capital +
            # reserves). net_worth() tells them apart, so the deep history is
            # kept and only the paid-up-capital values are dropped - excluding
            # the lot cost 20 years of Price/Book depth.
            nw = net_worth(s)
            if nw is not None:
                eqs.append((pe, nw))
        last_nse = flows[-1][0] if flows else "0000-00-00"
        # Only splice yfinance in if it AGREES with the as-filed series on a
        # shared quarter. For dual-listed names yfinance serves the ADR line in
        # USD (Infosys: 0.23 vs NSE's Rs 16.43), and splicing that silently
        # multiplied the PE by ~70x.
        yrows = yq_by_sym.get(sym, {})
        nse_eps = {p: e for p, e, *_ in flows if e is not None}
        agree = True
        for p in set(yrows) & set(nse_eps):
            yv_ = yrows[p].get("Basic EPS")
            if yv_ and pd.notna(yv_) and nse_eps[p]:
                ratio = (yv_ / adj_factor(splits.get(sym), p)) / nse_eps[p]
                agree = 0.5 <= ratio <= 2.0
                break
        for pe in sorted(yrows if agree else {}):
            if pe > last_nse:
                ys = yq_by_sym[sym][pe]
                yv = lambda k: (ys[k] if (k in ys and pd.notna(ys[k])) else None)
                rev_y, eps_y, eb_y = yv("Total Revenue"), yv("Basic EPS"), yv("EBITDA")
                if eps_y is None:
                    # A quarter with revenue but no EPS still lands in the trailing
                    # -4 window and nulls the TTM, which silently truncated the PE
                    # line by a year or more. Skip it and keep the last known four.
                    continue
                eps_y /= adj_factor(splits.get(sym), pe)
                flows.append((pe, eps_y, (rev_y / 1e7 if rev_y is not None else None),
                              (eb_y / 1e7 if eb_y is not None else None),
                              effective_shares(yv("Net Income"), eps_y, 1.0)))
        flow_by_sym[sym] = flows
        if eqs:
            equity_by_sym[sym] = eqs
    # supplement equity with yfinance balance (extends book-value depth a little)
    if _table_exists(con, "statements"):
        yb = pd.read_sql(
            "SELECT symbol, period_end, value FROM statements "
            "WHERE stmt_type='balance' AND item='Common Stock Equity' ORDER BY period_end",
            con,
        )
        for sym, g in yb.groupby("symbol"):
            merged = {d: v for d, v in equity_by_sym.get(sym, [])}
            for _, r in g.iterrows():
                if pd.notna(r["value"]):
                    merged[r["period_end"]] = float(r["value"])  # balance sheet is authoritative
            equity_by_sym[sym] = sorted(merged.items())

    # weekly gives ~1,100 points over 20+ years (screener.in serves the same
    # density); fall back to monthly for symbols whose weekly history is short
    wk = pd.read_sql("SELECT symbol, date, close FROM prices WHERE freq='weekly' ORDER BY date", con)
    mo = pd.read_sql("SELECT symbol, date, close FROM prices WHERE freq='monthly' ORDER BY date", con)
    wk_by = {s: g for s, g in wk.groupby("symbol")}
    mo_by = {s: g for s, g in mo.groupby("symbol")}
    out: dict[str, dict] = {}
    for sym in sorted(set(wk_by) | set(mo_by)):
        gw, gm = wk_by.get(sym), mo_by.get(sym)
        g = gw if (gw is not None and len(gw) >= (len(gm) if gm is not None else 0)) else gm
        if g is None or not len(g):
            continue
        flows = flow_by_sym.get(sym)
        sh = shares.get(sym)
        if not flows or not sh:
            continue
        eqs = equity_by_sym.get(sym, [])
        nd = netdebt.get(sym, [])  # list of (date, netdebt_cr) or []
        pe_s, ev_s, pb_s, ps_s = [], [], [], []
        # Shorter earnings windows, each annualised so they sit on the same scale
        # as the 4-quarter TTM and can be read against it: 1Q x4, 2Q x2, 3Q x4/3.
        # They react to an earnings turn far sooner than TTM, at the cost of
        # carrying that quarter's seasonality and one-offs undiluted.
        pe_alt: dict[str, list] = {"q1": [], "q2": [], "q3": []}
        fi = 0  # pointer into `flows` (both it and the price series are date-sorted)
        for date, close in zip(g["date"], g["close"]):
            while fi < len(flows) and flows[fi][0] <= date:
                fi += 1
            recent = flows[max(0, fi - 4):fi]
            # The four must actually be CONSECUTIVE quarters. With a gap in the
            # data the window silently spanned five or six calendar quarters and
            # still got called a TTM (HDFC Bank summed Jun-24, Sep-24, Dec-24 and
            # Jun-25, understating earnings and inflating PE).
            if len(recent) == 4:
                span = (
                    datetime.strptime(recent[-1][0], "%Y-%m-%d")
                    - datetime.strptime(recent[0][0], "%Y-%m-%d")
                ).days
                if span > 300:  # 3 gaps of ~92 days each; more means a hole
                    recent = []
            # point-in-time share count; falls back to today's only when a
            # filing didn't give us PAT and EPS together
            eff = next((f[4] for f in reversed(flows[:fi]) if len(f) > 4 and f[4]), None) or sh
            mcap_cr = close * eff / 1e7
            if len(recent) == 4:
                ttm_eps = sum(f[1] for f in recent) if all(f[1] is not None for f in recent) else None
                ttm_rev = sum(f[2] for f in recent) if all(f[2] is not None for f in recent) else None
                ttm_eb = sum(f[3] for f in recent) if all(f[3] is not None for f in recent) else None
                if ttm_eps and ttm_eps > 0:
                    pe_s.append([date, round(close / ttm_eps, 1)])
                    # aligned by index with pe_s, so only the values travel
                    for key, n, mult in (("q1", 1, 4.0), ("q2", 2, 2.0), ("q3", 3, 4.0 / 3.0)):
                        tail = [f[1] for f in recent[-n:]]
                        ann = sum(tail) * mult if all(v is not None for v in tail) else None
                        pe_alt[key].append(round(close / ann, 1) if (ann and ann > 0) else None)
                if ttm_rev and ttm_rev > 0:
                    ps_s.append([date, round(mcap_cr / ttm_rev, 2)])
                if ttm_eb and ttm_eb > 0:
                    ndv = next((v for d, v in reversed(nd) if d <= date), (nd[0][1] if nd else 0.0))
                    ev_s.append([date, round((mcap_cr + (ndv or 0.0)) / ttm_eb, 1)])
            eq = next((v for d, v in reversed(eqs) if d <= date), None)
            if eq and eq > 0:
                # price/book == market cap / shareholders' funds, which keeps the
                # share count consistent on both sides of the ratio
                pb_s.append([date, round(mcap_cr / (eq / 1e7), 2)])
        bands = {}
        for key, ser, rnd in (("pe", pe_s, 1), ("ev", ev_s, 1), ("pb", pb_s, 2), ("ps", ps_s, 2)):
            b = _band(ser, rnd)
            if b:
                bands[key] = b
        if "pe" in bands and pe_s:
            cutoff = f"{int(pe_s[-1][0][:4]) - 5}{pe_s[-1][0][4:]}"
            alt, med = {}, {}
            for key, vals in pe_alt.items():
                if not any(v is not None for v in vals):
                    continue
                alt[key] = vals
                last5 = [v for (d, _), v in zip(pe_s, vals) if v is not None and d >= cutoff]
                if last5:
                    med[key] = round(_median(last5), 1)
            if alt:
                bands["pe"]["alt"] = alt
                bands["pe"]["alt_median_5y"] = med
        if bands:
            out[sym] = bands
    return out


def pe_series(con: sqlite3.Connection) -> dict[str, dict]:
    """Back-compat: monthly P/E series only (kept for callers that import it)."""
    return {}


def avg_npm_5y(trend_annual: dict | None) -> float | None:
    """Average PAT margin (%) over the last 5 annual periods with both values."""
    if not trend_annual:
        return None
    pairs = [
        (r, p)
        for r, p in zip(trend_annual["revenue"], trend_annual["pat"])
        if r and p is not None
    ][-5:]
    if len(pairs) < 3:
        return None
    margins = [p / r * 100 for r, p in pairs]
    return round(sum(margins) / len(margins), 2)


def cagr_pct(values: list, periods: list[str], years: int) -> float | None:
    """CAGR over `years` intervals of the annual series; None when not computable."""
    pairs = [(p, v) for p, v in zip(periods, values) if v is not None]
    if len(pairs) < years + 1:
        return None
    last, start = pairs[-1][1], pairs[-(years + 1)][1]
    if not start or not last or start <= 0 or last <= 0:
        return None
    return round(((last / start) ** (1 / years) - 1) * 100, 2)
