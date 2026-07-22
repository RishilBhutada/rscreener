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
]
MONEY = {  # fields to convert Rs -> Rs crore on emit (eps / margins / book-value-per-share excluded)
    "revenue", "pat", "total_expenses", "finance_cost", "depreciation",
    "cost_materials", "purchases", "inv_change", "equity", "ebitda_direct", "cogs_direct",
}
KEEP_ANNUAL = 15
KEEP_QUARTERLY = 32


def _table_exists(con: sqlite3.Connection, name: str) -> bool:
    return bool(con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def _cr(v):
    return None if v is None else round(v / 1e7, 1)


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


def _derive(slot: dict) -> dict:
    """Compute ebitda / gross_profit / margins from a period's raw fields (raw Rs)."""
    rev = slot.get("revenue")
    exp = slot.get("total_expenses")
    fin = slot.get("finance_cost") or 0.0
    dep = slot.get("depreciation") or 0.0
    ebitda = slot.get("ebitda_direct")
    if ebitda is None and rev is not None and exp is not None:
        ebitda = rev - exp + fin + dep
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
    # latest paid-up share capital per symbol -> restate as-filed per-share EPS to
    # the current share base (catches bonus issues; keeps EPS bars/PE comparable to
    # the split/bonus-adjusted price series)
    sc_latest: dict[str, float] = {}
    for (symbol, _pt), periods in comps.items():
        for p in sorted(periods):
            sc = periods[p].get("share_capital")
            if sc:
                sc_latest[symbol] = sc
    out: dict[str, dict] = {}
    for (symbol, ptype), periods in comps.items():
        keep = KEEP_ANNUAL if ptype == "annual" else KEEP_QUARTERLY
        ordered = sorted(periods)[-keep:]
        if not ordered:
            continue
        sh = shares.get(symbol)

        def pct(num, den):
            return round(num / den * 100, 2) if (num is not None and den) else None

        scr = sc_latest.get(symbol)

        def adj_eps(p):
            e = periods[p].get("eps")
            if e is None:
                return None
            sc = periods[p].get("share_capital")
            return round(e * (sc / scr if (sc and scr) else 1.0), 2)

        rev = [periods[p].get("revenue") for p in ordered]
        pat = [periods[p].get("pat") for p in ordered]
        eps = [adj_eps(p) for p in ordered]
        exp = [periods[p].get("total_expenses") for p in ordered]
        deriv = [_derive(periods[p]) for p in ordered]
        ebitda = [d["ebitda"] for d in deriv]
        gp = [d["gross_profit"] for d in deriv]
        equity = [periods[p].get("equity") for p in ordered]
        trend = {
            "periods": ordered,
            "revenue": [_cr(v) for v in rev],
            "pat": [_cr(v) for v in pat],
            "eps": [round(v, 2) if v is not None else None for v in eps],
            "expenses": [_cr(v) for v in exp],
            "ebitda": [_cr(v) for v in ebitda],
            "book_value": [round(e / sh, 2) if (e is not None and sh) else None for e in equity],
            "opm": [pct(ebitda[i], rev[i]) for i in range(len(ordered))],
            "gpm": [pct(gp[i], rev[i]) for i in range(len(ordered))],
            "npm": [pct(pat[i], rev[i]) for i in range(len(ordered))],
            "source": [periods[p]["_source"] for p in ordered],
        }
        if any(v is not None for v in trend["revenue"]):
            out.setdefault(symbol, {})[ptype] = trend
    return out


def _median(vals: list[float]) -> float:
    s = sorted(vals)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def _band(series: list[list], round_to: int = 1) -> dict | None:
    if len(series) < 12:
        return None
    last5y = [v for _, v in series[-60:]]
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
    q = pd.read_sql(
        "SELECT symbol, period_end, item, value FROM results_history "
        "WHERE period_type='quarterly' AND item IN "
        "('eps','revenue','total_expenses','finance_cost','depreciation','equity','share_capital') ORDER BY period_end",
        con,
    )
    # recent quarters yfinance covers but the XBRL index doesn't yet (keeps the
    # newest TTM current instead of frozen at the last as-filed quarter)
    yq_by_sym: dict[str, dict] = {}
    if _table_exists(con, "statements"):
        yq = pd.read_sql(
            "SELECT symbol, period_end, item, value FROM statements "
            "WHERE stmt_type='income' AND period_type='quarterly' "
            "AND item IN ('Total Revenue','Basic EPS','EBITDA') ORDER BY period_end",
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
        sc_ref = None
        for pe in sorted(by_pe):
            sc = by_pe[pe].get("share_capital")
            if sc:
                sc_ref = sc
        flows, eqs = [], []
        for pe in sorted(by_pe):
            s = by_pe[pe]
            rev, exp = s.get("revenue"), s.get("total_expenses")
            fin, dep = s.get("finance_cost") or 0.0, s.get("depreciation") or 0.0
            ebitda = (rev - exp + fin + dep) if (rev is not None and exp is not None) else None
            eps = s.get("eps")
            if eps is not None:
                sc = s.get("share_capital")
                eps *= (sc / sc_ref) if (sc and sc_ref) else 1.0
            flows.append((pe, eps, (rev / 1e7 if rev is not None else None),
                          (ebitda / 1e7 if ebitda is not None else None)))
            if s.get("equity") is not None:
                eqs.append((pe, s["equity"]))
        last_nse = flows[-1][0] if flows else "0000-00-00"
        for pe in sorted(yq_by_sym.get(sym, {})):
            if pe > last_nse:
                ys = yq_by_sym[sym][pe]
                yv = lambda k: (ys[k] if (k in ys and pd.notna(ys[k])) else None)
                rev_y, eps_y, eb_y = yv("Total Revenue"), yv("Basic EPS"), yv("EBITDA")
                flows.append((pe, eps_y, (rev_y / 1e7 if rev_y is not None else None),
                              (eb_y / 1e7 if eb_y is not None else None)))
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
                merged.setdefault(r["period_end"], r["value"])  # nse wins
            equity_by_sym[sym] = sorted(merged.items())

    px = pd.read_sql("SELECT symbol, date, close FROM prices WHERE freq='monthly' ORDER BY date", con)
    out: dict[str, dict] = {}
    for sym, g in px.groupby("symbol"):
        flows = flow_by_sym.get(sym)
        sh = shares.get(sym)
        if not flows or not sh:
            continue
        eqs = equity_by_sym.get(sym, [])
        nd = netdebt.get(sym, [])  # list of (date, netdebt_cr) or []
        pe_s, ev_s, pb_s, ps_s = [], [], [], []
        for date, close in zip(g["date"], g["close"]):
            recent = [f for f in flows if f[0] <= date][-4:]
            mcap_cr = close * sh / 1e7
            if len(recent) == 4:
                ttm_eps = sum(f[1] for f in recent) if all(f[1] is not None for f in recent) else None
                ttm_rev = sum(f[2] for f in recent) if all(f[2] is not None for f in recent) else None
                ttm_eb = sum(f[3] for f in recent) if all(f[3] is not None for f in recent) else None
                if ttm_eps and ttm_eps > 0:
                    pe_s.append([date, round(close / ttm_eps, 1)])
                if ttm_rev and ttm_rev > 0:
                    ps_s.append([date, round(mcap_cr / ttm_rev, 2)])
                if ttm_eb and ttm_eb > 0:
                    ndv = next((v for d, v in reversed(nd) if d <= date), (nd[0][1] if nd else 0.0))
                    ev_s.append([date, round((mcap_cr + (ndv or 0.0)) / ttm_eb, 1)])
            eq = next((v for d, v in reversed(eqs) if d <= date), None)
            if eq and sh:
                bvps = eq / sh
                if bvps > 0:
                    pb_s.append([date, round(close / bvps, 2)])
        bands = {}
        for key, ser, rnd in (("pe", pe_s, 1), ("ev", ev_s, 1), ("pb", pb_s, 2), ("ps", ps_s, 2)):
            b = _band(ser, rnd)
            if b:
                bands[key] = b
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
