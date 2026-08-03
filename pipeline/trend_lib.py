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
import math
import sqlite3
from datetime import datetime, timedelta

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


STALE_EQUITY_DAYS = 400  # a filing older than this is not evidence about today


def equity_at(eqs: list, date: str):
    """Shareholders' funds on `date`, or None if no filing is recent enough.

    Filed net worth is sparse and unevenly spaced - Reliance has gaps of 4.0 and
    5.5 years - because the quarterly filings carry only paid-up capital and the
    annual sheet is all that gives real net worth. Three ways of bridging those
    gaps were measured against screener.in's own Price/Book series, on the same
    harness, over ~1,900 shared months:

        drop past 400 days              7.9% median error   <- this
        interpolate between filings    13.9% median error
        carry the last filing forward  35.8% median error

    Carrying forward is not merely imprecise, it is the source of the absurd
    values: HDFC Bank's 2016 Price/Book came out at 648 against a real ~3,
    because a stale row that `net_worth()` could not reject as paid-up capital
    got held across years. Interpolation is no answer either - `eqs` merges
    as-filed net worth with Yahoo's balance-sheet equity, which sit on different
    bases, so a straight line between them ramps across a definitional step.

    A gap in the line is honest; 648 is not. The way to win the range back is
    deeper balance-sheet history, not a looser staleness rule.
    """
    if not eqs:
        return None
    return next(
        (v for d, v in reversed(eqs)
         if d <= date
         and (datetime.strptime(date, "%Y-%m-%d") - datetime.strptime(d, "%Y-%m-%d")).days
         <= STALE_EQUITY_DAYS),
        None,
    )


TYPICAL_REPORTING_LAG = 45  # days, used only where NSE gave us no broadcast date


def filing_dates(con: sqlite3.Connection) -> dict[str, dict]:
    """{symbol: {period_end: announcement date}} - when results reached the market."""
    if not _table_exists(con, "filing_dates"):
        return {}
    out: dict[str, dict] = {}
    for sym, period, announced in con.execute(
        "SELECT symbol, period_end, announced_on FROM filing_dates"
    ):
        if period and announced:
            out.setdefault(sym, {})[period] = announced
    return out


def available_from(period_end: str, announced: dict) -> str:
    """The date a quarter's earnings could first be known.

    A P/E chart is meant to show what the market could see at each point. Using
    the quarter's END date instead credits the market with figures nobody had
    read yet - and the gap is neither small nor constant. TCS publishes 9 to 12
    days after quarter end; MTAR Technologies takes 29 to 42, and between
    29-Jan-2026 and 29-Jul-2026 it published nothing at all. Over those six
    months its trailing EPS was frozen at 16.88 while the price ran up, so the
    real P/E reached ~496. Our chart, stepping earnings in on 31-Mar and 30-Jun,
    showed ~230 for the same weeks and hid the spike completely.

    So the announcement date is used where NSE gave us one, and TYPICAL_REPORTING_LAG
    stands in where it did not (mostly the yfinance-spliced newest quarters).
    """
    hit = announced.get(period_end)
    if hit:
        return hit
    return (
        datetime.strptime(period_end, "%Y-%m-%d") + timedelta(days=TYPICAL_REPORTING_LAG)
    ).strftime("%Y-%m-%d")


SHARE_COUNT_SPIKE = 3.0  # a filing this far from BOTH neighbours contradicts itself


def implausible_quarters(con: sqlite3.Connection) -> dict[str, set]:
    """{symbol: {period_end}} for filings that disagree with themselves.

    A quarterly filing carries both PAT and EPS, so it contains its own check:
    PAT / EPS is the share count that filing was written against, and a share
    count does not change sixfold in one quarter and change back the next. Where
    it appears to, the filing (or our parse of it) is wrong.

    This is deliberately a SPIKE test against both neighbours, not a comparison
    against the company's own average. A split is a real, permanent step - 360ONE
    sits at exactly a quarter of its old count for years after a 4:1 - and judging
    against an average flags every quarter after a split as broken. Measured over
    38,201 quarters: 8.70% look wrong against the average, 0.43% are actual
    single-quarter spikes. The difference is almost entirely splits.

    Dropping these leaves a gap in the chart. A gap is honest - the number was
    never fetched, or it cannot be trusted - whereas a wrong point is indis-
    tinguishable from a right one and gets acted on.
    """
    if not _table_exists(con, "results_history"):
        return {}
    rows = con.execute(
        "SELECT symbol, period_end, "
        "MAX(CASE WHEN item='pat' THEN value END), MAX(CASE WHEN item='eps' THEN value END) "
        "FROM results_history WHERE period_type='quarterly' AND item IN ('pat','eps') "
        "GROUP BY symbol, period_end ORDER BY symbol, period_end"
    ).fetchall()
    by_sym: dict[str, list] = {}
    for sym, period, pat, eps in rows:
        if pat and eps:
            by_sym.setdefault(sym, []).append((period, pat / eps))
    out: dict[str, set] = {}
    for sym, seq in by_sym.items():
        for i in range(1, len(seq) - 1):
            prev, cur, nxt = seq[i - 1][1], seq[i][1], seq[i + 1][1]
            if prev <= 0 or cur <= 0 or nxt <= 0:
                continue
            neighbours_agree = 0.7 <= prev / nxt <= 1.4
            off_both = (cur / prev > SHARE_COUNT_SPIKE or cur / prev < 1 / SHARE_COUNT_SPIKE) and                        (cur / nxt > SHARE_COUNT_SPIKE or cur / nxt < 1 / SHARE_COUNT_SPIKE)
            if neighbours_agree and off_both:
                out.setdefault(sym, set()).add(seq[i][0])
    return out


def filed_net_worth(con: sqlite3.Connection) -> dict[str, list]:
    """{symbol: [(period_end, net worth in raw Rs)]} from the NSE results filings.

    Reads BOTH quarterly and annual periods. Reg-33 only obliges a company to
    report net worth annually - quarterly it files paid-up capital - so reading
    quarterly rows alone (which the band builder did) threw away 4,924 annual
    figures covering 1,593 symbols back to 2005. HDFC Bank kept exactly one
    equity point out of 84 that way, and it was the corrupt one; its real Rs
    91,794 cr net worth sat in the annual row the query never asked for.
    """
    if not _table_exists(con, "results_history"):
        return {}
    df = pd.read_sql(
        "SELECT symbol, period_end, item, value FROM results_history "
        "WHERE item IN ('equity','share_capital') ORDER BY period_end",
        con,
    )
    out: dict[str, list] = {}
    for sym, g in df.groupby("symbol"):
        by_period: dict[str, dict] = {}
        for _, r in g.iterrows():
            if pd.notna(r["value"]):
                by_period.setdefault(r["period_end"], {})[r["item"]] = float(r["value"])
        ref = share_capital_ref(by_period)
        vals = [(p, nw) for p in sorted(by_period)
                if (nw := net_worth(by_period[p], ref)) is not None]
        vals = _drop_scale_outliers(vals)
        if vals:
            out[sym] = vals
    return out


NW_COLLAPSE = 0.25  # a filing under this share of BOTH neighbours is a parse artifact


def _drop_scale_outliers(vals: list) -> list:
    """Drop filings whose net worth collapses against BOTH neighbouring filings.

    The paid-up-capital test only catches a value close to share capital. It does
    not catch one that is merely far too small: every FY2017 annual filing we
    parse comes back ~80x under the truth - TCS at Rs 1,061 cr sitting between a
    real Rs 65,361 cr in FY16 and Rs 98,112 cr in FY23, with the identical window
    broken for Shree Cement, Hero MotoCorp, 3M India and Vedanta. Rs 1,061 cr is
    5.4x share capital, so it clears the 3x bar, and Price/Book printed 660
    against a real 8.

    The test has to be LOCAL. Comparing against the symbol's median instead
    throws away real early history - net worth compounds, so Reliance's genuine
    Rs 82,630 cr in FY08 is a small fraction of its median and looks identical to
    an artifact by that measure. Against its neighbours it sits on a smooth ramp.
    Only a value that collapses in both directions and recovers is a parse error;
    a real write-off does not un-write itself the following year.
    """
    if len(vals) < 3:
        return vals
    keep = [vals[0]]
    for i in range(1, len(vals) - 1):
        prev, cur, nxt = vals[i - 1][1], vals[i][1], vals[i + 1][1]
        if prev > 0 and nxt > 0 and cur / prev < NW_COLLAPSE and cur / nxt < NW_COLLAPSE:
            continue
        keep.append(vals[i])
    keep.append(vals[-1])
    return keep


def net_debt_series(con: sqlite3.Connection) -> dict[str, list]:
    """{symbol: [(period_end, net debt in Rs crore)]} for the EV calculation.

    Yahoo publishes a `Net Debt` line only for companies that carry net debt - it
    is simply absent for net-cash names like TCS, Infosys and Maruti, and absent
    for ITC in every year but the last. Reading that line alone left EV/EBITDA
    with one data point (or none) per symbol, so the chart either vanished or
    applied a 2026 balance sheet to a 2005 price.

    `Total Debt` and `Cash And Cash Equivalents` are present for ~2,200 symbols
    across every balance-sheet year, and their difference reproduces Yahoo's own
    Net Debt to within a few percent where both exist (Reliance 2.61 vs 2.37 lakh
    crore, Coal India 5,453 vs 5,202 crore). So compute it, and keep Yahoo's
    figure where it is given.
    """
    if not _table_exists(con, "statements"):
        return {}
    df = pd.read_sql(
        "SELECT symbol, period_end, item, value FROM statements WHERE stmt_type='balance' "
        "AND item IN ('Net Debt','Total Debt','Cash And Cash Equivalents') ORDER BY period_end",
        con,
    )
    by: dict[tuple, dict] = {}
    for _, r in df.iterrows():
        if pd.notna(r["value"]):
            by.setdefault((r["symbol"], r["period_end"]), {})[r["item"]] = float(r["value"])
    out: dict[str, list] = {}
    for (sym, period), items in sorted(by.items(), key=lambda kv: kv[0][1]):
        nd = items.get("Net Debt")
        if nd is None:
            td = items.get("Total Debt")
            if td is None:
                continue
            nd = td - (items.get("Cash And Cash Equivalents") or 0.0)
        out.setdefault(sym, []).append((period, nd / 1e7))
    return out


def effective_shares(pat, eps, factor: float, sh_now: float | None = None):
    """Share count at a past date, expressed on the ADJUSTED-price basis.

    Market cap at time t is unadjusted_price(t) x shares(t). Our price series is
    split-adjusted - unadjusted/F(t) - so the matching count is shares(t)*F(t).
    Using TODAY's count instead is only valid when every change was a split;
    HDFC Bank issued ~65% new shares for the HDFC merger, so its 2007 market cap
    came out 2.4x too large, taking Price/Book, EV/EBITDA and MCap/Sales with it.
    shares(t) comes from PAT/EPS - both as-filed in the same statement, so their
    ratio is exactly the count that filing was written against.

    PAT/EPS is unstable near a breakeven quarter: an EPS of 0.01 turns a real
    30 cr shares into 3,000 cr, and since this count multiplies the price into
    market cap, every band built on it explodes with it - Geekay Wire's
    Price/Book reached 292,421. `sh_now` is today's count; anything outside a
    generous band around it is arithmetic noise, not a share issue, so the
    caller falls back to today's count instead.
    """
    if not pat or not eps:
        return None
    shares = pat / eps
    if shares <= 0:
        return None
    out = shares * factor
    if sh_now and not (sh_now / 50 <= out <= sh_now * 5):
        return None                      # implied count is not physically plausible
    return out


def share_capital_ref(by_period: dict) -> float | None:
    """A symbol's typical paid-up capital, as the yardstick net_worth() tests against.

    Taken across all of the symbol's filings rather than from the row being
    judged, because the row being judged is exactly what may be corrupt: HDFC
    Bank's Dec-2016 filing reports share capital of Rs 200,000 - two hundredths
    of a crore against a real Rs 512 cr. A per-row test compares a bad number
    with itself and passes. The median of the whole history does not move for
    one bad row.
    """
    vals = sorted(
        v for s in by_period.values()
        if (v := s.get("share_capital")) and v > 0 and not math.isnan(v)
    )
    return vals[len(vals) // 2] if vals else None


def net_worth(slot: dict, sc_ref: float | None = None):
    """Shareholders' funds, or None if the filing only gave paid-up capital.

    The Reg-33 'Equity' tag is PAID-UP EQUITY SHARE CAPITAL, not net worth -
    HDFC Bank files Rs 1,540 cr there against a real net worth near Rs 7.7 lakh
    cr. Dividing by it produced a book value ~190x too small and a Price/Book of
    2,382 where screener shows 3.6. Net worth is always a large multiple of paid-up
    capital, so anything close to it is rejected and the balance sheet used instead.

    `sc_ref` is the symbol's median share capital (see share_capital_ref). Judging
    against it rather than the row's own share-capital field is what makes the
    test survive a corrupt row - with the per-row check alone, HDFC Bank's Dec-2016
    Price/Book shipped at 648 against a real ~3.
    """
    eq = slot.get("equity")
    if eq is None or (isinstance(eq, float) and math.isnan(eq)):
        return None
    sc = slot.get("share_capital")
    if sc is not None and isinstance(sc, float) and math.isnan(sc):
        sc = None
    ref = sc_ref if sc_ref else sc
    if not ref:
        # Nothing credible to compare against, so the two cannot be told apart
        # and accepting on faith is how paid-up capital reaches the chart.
        return None
    if eq < ref * 3:
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


def build_trends(con: sqlite3.Connection, shares: dict | None = None,
                 only: set | None = None) -> dict[str, dict]:
    shares = shares or {}
    comps = _stitched(con)
    suspect = implausible_quarters(con)
    for (sym_, ptype_), periods_ in comps.items():
        if ptype_ == "quarterly":
            for bad_ in suspect.get(sym_, set()):
                periods_.pop(bad_, None)   # same rule as the charts: drop, do not draw
    splits = split_factors(con)
    known = splits_trustworthy(con, shares)
    bal = balance_equity(con)
    out: dict[str, dict] = {}
    for (symbol, ptype), periods in comps.items():
        if only is not None and symbol not in only:
            continue
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
        sc_ref = share_capital_ref(periods)
        equity = [net_worth(periods[p], sc_ref) or bal.get((symbol, p)) for p in ordered]
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


def splits_trustworthy(con: sqlite3.Connection, shares: dict) -> set[str]:
    """Symbols whose recorded split history actually explains their share growth.

    Yahoo's corporate-action feed can silently omit events: it lists only the
    2:1 split for Bajaj Finance in 2025 and misses the accompanying 4:1 bonus,
    so EPS was adjusted 10x where the price series was adjusted ~100x and PE
    read 2.5 against screener's 30.8.

    The share count implied by PAT/EPS is an independent witness. Growth beyond
    the recorded splits is normal share issuance (HDFC Bank's merger is 2.5x,
    ITC 1.7x), but a 37x gap means events are missing. Past that threshold the
    split feed is discarded for that symbol in favour of PAT / current shares.

    This also covers the empty-split-list case, which is ambiguous on its own -
    it means either "never split" or "never fetched". Trusting it blindly left
    EPS unadjusted and put ITC's 2006 PE at 1.0; here a symbol with no recorded
    events only keeps the exact path if its implied share growth agrees.
    """
    out = set()
    sp = split_factors(con)
    rows = con.execute(
        "SELECT symbol, period_end, "
        "MAX(CASE WHEN item='pat' THEN value END), MAX(CASE WHEN item='eps' THEN value END) "
        "FROM results_history WHERE period_type='quarterly' GROUP BY symbol, period_end "
        "ORDER BY symbol, period_end"
    ).fetchall()
    seen: set[str] = set()
    for sym, pe, pat, eps in rows:
        if sym in seen or not pat or not eps or not shares.get(sym):
            continue
        seen.add(sym)
        implied = shares[sym] / (pat / eps)
        recorded = adj_factor(sp.get(sym), pe)
        if recorded and implied / recorded <= 3.0:
            out.add(sym)
    return out


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


def ratio_bands(con: sqlite3.Connection, shares: dict, netdebt: dict | None = None,
                only: set | None = None) -> dict[str, dict]:
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
    known = splits_trustworthy(con, shares)
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
    filed = filed_net_worth(con)
    announced = filing_dates(con)   # when the market could first read each quarter
    suspect = implausible_quarters(con)  # filings whose own PAT and EPS contradict each other
    for sym, g in q.groupby("symbol"):
        by_pe: dict[str, dict] = {}
        for _, r in g.iterrows():
            by_pe.setdefault(r["period_end"], {})[r["item"]] = r["value"]
        ev = splits.get(sym)
        sh_now = shares.get(sym)   # yardstick for effective_shares sanity
        skip = suspect.get(sym, set())
        flows, eqs = [], []
        for pe in sorted(by_pe):
            # A filing that disagrees with itself is dropped rather than drawn.
            # Empty is honest; wrong is acted on.
            if pe in skip:
                continue
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
                          effective_shares(s.get("pat"), s.get("eps"), adj_factor(ev, pe), sh_now)))
        # Net worth comes from filed_net_worth(), which reads the ANNUAL rows too -
        # Reg-33 only requires net worth once a year, so collecting it here inside
        # the quarterly loop is what starved the Price/Book line.
        eqs = list(filed.get(sym, []))
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
                              effective_shares(yv("Net Income"), eps_y, 1.0, sh_now)))
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
            have = {d: v for d, v in equity_by_sym.get(sym, [])}
            ybal = {r["period_end"]: float(r["value"]) for _, r in g.iterrows() if pd.notna(r["value"])}
            # Only let the balance sheet override the filings if the two agree on a
            # shared period. For dual-listed names yfinance serves the US line in
            # DOLLARS - Infosys came back at Rs 979 cr against a filed Rs 93,297 cr,
            # and because the balance sheet was treated as authoritative it
            # overwrote the truth and put Infosys' current Price/Book at 468.
            trust = True
            for p in sorted(set(ybal) & set(have), reverse=True):
                if have[p]:
                    ratio = ybal[p] / have[p]
                    trust = 0.5 <= ratio <= 2.0
                    break
            merged = dict(have)
            if trust:
                merged.update(ybal)          # newer, and audited, where it checks out
            equity_by_sym[sym] = sorted(merged.items())

    # weekly gives ~1,100 points over 20+ years (screener.in serves the same
    # density); fall back to monthly for symbols whose weekly history is short
    wk = pd.read_sql("SELECT symbol, date, close FROM prices WHERE freq='weekly' ORDER BY date", con)
    mo = pd.read_sql("SELECT symbol, date, close FROM prices WHERE freq='monthly' ORDER BY date", con)
    wk_by = {s: g for s, g in wk.groupby("symbol")}
    mo_by = {s: g for s, g in mo.groupby("symbol")}
    out: dict[str, dict] = {}
    # `only` exists for the iteration loop, not for production: rebuilding the
    # bands for all 2,354 companies takes ~9 minutes, which is a long time to
    # wait to find out whether a one-line change to a formula helped.
    for sym in sorted(set(wk_by) | set(mo_by)):
        if only is not None and sym not in only:
            continue
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
        # Inputs behind every point, aligned by index with the series above.
        # A ratio you cannot take apart is a ratio you have to take on faith, and
        # every error found on 2-Aug-2026 - Price/Book 648, a balance sheet in
        # dollars, a P/E line frozen for seven months - rendered as a perfectly
        # ordinary-looking point. Shipping the numerator and denominator lets the
        # chart be checked instead of trusted.
        pe_p, ev_p, pb_p, ps_p = [], [], [], []
        # Shorter earnings windows, each annualised so they sit on the same scale
        # as the 4-quarter TTM and can be read against it: 1Q x4, 2Q x2, 3Q x4/3.
        # They react to an earnings turn far sooner than TTM, at the cost of
        # carrying that quarter's seasonality and one-offs undiluted.
        pe_alt: dict[str, list] = {"q1": [], "q2": [], "q3": []}
        fi = 0  # pointer into `flows` (both it and the price series are date-sorted)
        avail = announced.get(sym, {})
        for date, close in zip(g["date"], g["close"]):
            while fi < len(flows) and available_from(flows[fi][0], avail) <= date:
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
                    pe_p.append([round(close, 2), round(ttm_eps, 2),
                                 [f[0] for f in recent]])   # price, TTM EPS, the four quarters
                    # aligned by index with pe_s, so only the values travel
                    for key, n, mult in (("q1", 1, 4.0), ("q2", 2, 2.0), ("q3", 3, 4.0 / 3.0)):
                        tail = [f[1] for f in recent[-n:]]
                        ann = sum(tail) * mult if all(v is not None for v in tail) else None
                        pe_alt[key].append(round(close / ann, 1) if (ann and ann > 0) else None)
                if ttm_rev and ttm_rev > 0:
                    ps_s.append([date, round(mcap_cr / ttm_rev, 2)])
                    ps_p.append([round(mcap_cr, 1), round(ttm_rev, 1)])
                if ttm_eb and ttm_eb > 0:
                    ndv = next((v for d, v in reversed(nd)
                                if d <= date and (datetime.strptime(date, "%Y-%m-%d")
                                                  - datetime.strptime(d, "%Y-%m-%d")).days <= 400), None)
                    if ndv is not None:  # no current net debt -> no EV, rather than a guess
                        ev_s.append([date, round((mcap_cr + ndv) / ttm_eb, 1)])
                        ev_p.append([round(mcap_cr, 1), round(ndv, 1), round(ttm_eb, 1)])
            eq = equity_at(eqs, date)
            if eq and eq > 0:
                # price/book == market cap / shareholders' funds, which keeps the
                # share count consistent on both sides of the ratio
                pb_s.append([date, round(mcap_cr / (eq / 1e7), 2)])
                pb_p.append([round(mcap_cr, 1), round(eq / 1e7, 1)])
        bands = {}
        for key, ser, rnd, parts in (("pe", pe_s, 1, pe_p), ("ev", ev_s, 1, ev_p),
                                     ("pb", pb_s, 2, pb_p), ("ps", ps_s, 2, ps_p)):
            b = _band(ser, rnd)
            if b:
                if len(parts) == len(ser):
                    b["parts"] = parts
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
