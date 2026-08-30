"""Rscreener P3 - exports one JSON per company for the company pages.

Output: web/public/companies/<SYMBOL>.json
Contains the snapshot row plus trimmed financial statements (screener.in-style
key line items only, values in Rs CRORE). Companies whose statements haven't
been fetched yet get snapshot-only files - the page shows a notice.
"""
import argparse
import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from export_json import freshen_prices
from trend_lib import build_trends, net_debt_series, ratio_bands


def clean_nan(o):
    """Recursively replace NaN/Inf floats with None so the output is valid JSON
    (Python's json.dumps emits bare NaN, which browsers reject on JSON.parse)."""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: clean_nan(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean_nan(v) for v in o]
    return o

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT_DIR = ROOT / "web" / "public" / "companies"

# yfinance item name -> display label, per statement type (order = display order)
KEY_ITEMS = {
    "income": [
        ("Total Revenue", "Revenue"),
        ("Gross Profit", "Gross Profit"),
        ("Operating Income", "Operating Profit"),
        ("EBITDA", "EBITDA"),
        ("Interest Expense", "Interest"),
        ("Tax Provision", "Tax"),
        ("Net Income", "Net Profit"),
        ("Basic EPS", "EPS (Rs)"),
    ],
    "balance": [
        ("Total Assets", "Total Assets"),
        ("Stockholders Equity", "Equity"),
        ("Total Debt", "Total Debt"),
        ("Cash And Cash Equivalents", "Cash"),
        ("Inventory", "Inventory"),
        ("Accounts Receivable", "Receivables"),
    ],
    "cashflow": [
        ("Operating Cash Flow", "Cash from Operations"),
        ("Investing Cash Flow", "Cash from Investing"),
        ("Financing Cash Flow", "Cash from Financing"),
        ("Capital Expenditure", "Capex"),
        ("Free Cash Flow", "Free Cash Flow"),
    ],
}

NOT_CRORE = {"EPS (Rs)"}  # per-share numbers stay in rupees


def build_statement(df: pd.DataFrame, stmt_type: str, period_type: str) -> dict | None:
    sub = df[(df.stmt_type == stmt_type) & (df.period_type == period_type)]
    if sub.empty:
        return None
    periods = sorted(sub.period_end.unique())
    items = []
    for src, label in KEY_ITEMS[stmt_type]:
        rows = sub[sub["item"] == src].set_index("period_end")["value"]
        if rows.empty:
            continue
        values = []
        for p in periods:
            v = rows.get(p)
            if v is None or pd.isna(v):
                values.append(None)
            elif label in NOT_CRORE:
                values.append(round(float(v), 2))
            else:
                values.append(round(float(v) / 1e7, 1))  # Rs -> Rs crore
        items.append({"label": label, "values": values})
    if not items:
        return None
    return {"periods": periods, "items": items}


def coverage_notes(con: sqlite3.Connection) -> dict[str, dict]:
    """Why each company's history starts where it starts.

    A chart that begins in 2023 next to one that begins in 2005 looks like a
    fault in the site. Usually it is not: the filings behind it simply do not
    exist, or a quarter is missing in the middle and a trailing-twelve-month
    figure cannot be assembled across a hole. Cemindia Projects (CEMPRO) is the
    worked example - NSE's index lists its 2005-2017 results, every one of those
    archive links returns 404, and three later quarters (Dec-2018, Sep-2021,
    Dec-2021) were never filed at all. The same index links resolve perfectly
    for RELIANCE, TCS and INDIACEM, so this is that company's record, not a bug.

    Showing the reason costs one small block of text and replaces a silent
    absence with a checkable statement. Nothing here is inferred from a model -
    every field is counted from the filings actually in the database.
    """
    out: dict[str, dict] = {}
    rows = con.execute(
        """SELECT symbol, period_end FROM results_history
           WHERE period_type='quarterly' AND item='pat'
           GROUP BY symbol, period_end ORDER BY symbol, period_end"""
    ).fetchall()
    by_sym: dict[str, list[str]] = {}
    for sym, pe in rows:
        by_sym.setdefault(sym, []).append(pe)

    def qkey(d: str) -> int:
        """Quarters as a running integer so gaps are countable, not eyeballed."""
        y, m = int(d[:4]), int(d[5:7])
        return y * 4 + (m - 1) // 3

    for sym, periods in by_sym.items():
        if len(periods) < 2:
            out[sym] = {"quarters": len(periods), "from": periods[0] if periods else None, "gaps": []}
            continue
        keys = [qkey(p) for p in periods]
        gaps: list[str] = []
        for a, b in zip(keys, keys[1:]):
            for k in range(a + 1, b):
                y, q = divmod(k, 4)
                gaps.append(f"{y}-{['Mar','Jun','Sep','Dec'][q]}")
        out[sym] = {
            "quarters": len(periods),
            "from": periods[0],
            "to": periods[-1],
            # Capped: a company with forty holes needs the count, not the list.
            "gaps": gaps[:12],
            "gap_count": len(gaps),
        }
    return out


def working_capital_ratios(con: sqlite3.Connection) -> dict[str, dict]:
    """Per-year working-capital ratios: the one section screener.in has that this
    app did not.

    Debtor days, inventory days, days payable, the cash conversion cycle and
    working capital days say how a business actually runs - whether it is
    financed by its suppliers or financing its customers - and none of it was
    visible here. The screener carried debtor_days and inventory_days as a
    single current value with no history, which is the least useful form: the
    number only means something as a trend.

    Every figure is arithmetic on filed balance-sheet and income lines, so
    nothing here is an estimate. A year missing any input it needs is left out
    rather than filled with a zero - a zero-day cash conversion cycle is a
    remarkable business, not a missing number.

        debtor days      receivables / revenue     x 365
        inventory days   inventory    / cost of revenue x 365
        days payable     payables     / cost of revenue x 365
        cash conversion  debtor + inventory - payable
        working capital  working capital / revenue x 365
        ROCE             EBIT / (total assets - current liabilities)
    """
    if not _table_exists(con, "statements"):
        return {}
    WANT = ("Accounts Receivable", "Inventory", "Accounts Payable", "Working Capital",
            "Total Revenue", "Cost Of Revenue", "Total Assets", "Current Liabilities",
            "EBIT", "EBITDA", "Reconciled Depreciation")
    rows = con.execute(
        "SELECT symbol, period_end, item, value FROM statements "
        "WHERE period_type='annual' AND item IN ({}) "
        "ORDER BY symbol, period_end".format(",".join("?" * len(WANT))), WANT
    ).fetchall()
    by: dict[str, dict[str, dict]] = {}
    for sym, pe, item, val in rows:
        if val is None:
            continue
        by.setdefault(sym, {}).setdefault(pe, {})[item] = float(val)

    def days(num, den):
        if num is None or not den or den <= 0:
            return None
        d = num / den * 365
        # A working-capital cycle beyond a few years is a parsing artefact, not
        # a business. Left out rather than drawn.
        return round(d, 1) if -2000 < d < 2000 else None

    out: dict[str, dict] = {}
    for sym, periods in by.items():
        pers = sorted(periods)[-12:]
        cols = {"debtor_days": [], "inventory_days": [], "days_payable": [],
                "cash_conversion": [], "working_capital_days": [], "roce": []}
        kept = []
        for pe in pers:
            s = periods[pe]
            rev, cogs = s.get("Total Revenue"), s.get("Cost Of Revenue")
            dd = days(s.get("Accounts Receivable"), rev)
            idd = days(s.get("Inventory"), cogs)
            dp = days(s.get("Accounts Payable"), cogs)
            wc = days(s.get("Working Capital"), rev)
            ebit = s.get("EBIT")
            if ebit is None and s.get("EBITDA") is not None and s.get("Reconciled Depreciation") is not None:
                ebit = s["EBITDA"] - s["Reconciled Depreciation"]
            ta, cl = s.get("Total Assets"), s.get("Current Liabilities")
            ce = (ta - cl) if (ta is not None and cl is not None) else None
            roce = round(ebit / ce * 100, 1) if (ebit is not None and ce and ce > 0) else None
            ccc = (dd + idd - dp) if None not in (dd, idd, dp) else None
            if all(v is None for v in (dd, idd, dp, wc, roce)):
                continue
            kept.append(pe)
            cols["debtor_days"].append(dd)
            cols["inventory_days"].append(idd)
            cols["days_payable"].append(dp)
            cols["cash_conversion"].append(round(ccc, 1) if ccc is not None else None)
            cols["working_capital_days"].append(wc)
            cols["roce"].append(roce)
        if len(kept) >= 2:
            out[sym] = {"periods": kept, **cols}
    return out


def quarter_blocks(con: sqlite3.Connection) -> dict[str, list[dict]]:
    """{symbol: [{start, end, eps, announced, q}]} - one block per filed quarter.

    Drives the quarter-coloured EPS bars and the result-declaration markers on the
    company charts. Each block carries the period it actually covers (as filed, so
    consecutive blocks butt together with no gap) and the date NSE broadcast it.

    `q` is the INDIAN FISCAL quarter, not the calendar one: Apr-Jun is Q1. That is
    what the colour cycle keys off, so a company's Q1 is the same colour every year
    regardless of when in the calendar it falls.
    """
    if not _table_exists(con, "results_history"):
        return {}
    announced: dict[tuple, str] = {}
    if _table_exists(con, "filing_dates"):
        announced = {
            (s, p): a for s, p, a in con.execute(
                "SELECT symbol, period_end, announced_on FROM filing_dates"
            ) if a
        }
    rows = con.execute(
        "SELECT symbol, period_start, period_end, value FROM results_history "
        "WHERE period_type='quarterly' AND item='eps' AND period_start<>'' "
        "ORDER BY symbol, period_end"
    ).fetchall()
    out: dict[str, list[dict]] = {}
    for sym, start, end, eps in rows:
        if eps is None or not start or not end:
            continue
        month = int(end[5:7])
        fq = {6: 1, 9: 2, 12: 3, 3: 4}.get(month)
        if fq is None:  # a non-standard year-end; colour it by calendar quarter
            fq = (month - 1) // 3 + 1
        out.setdefault(sym, []).append({
            "start": start,
            "end": end,
            "eps": round(float(eps), 2),
            "announced": announced.get((sym, end)),
            "q": fq,
        })
    return out


def corporate_actions(con: sqlite3.Connection) -> dict[str, list[dict]]:
    """{symbol: [{date, kind, detail, subject}]} - dividends, bonuses and the rest.

    Keyed on the EX-DATE, which is the day the price adjusts and the day by which
    the share had to be held. That is the date worth drawing on a chart; the
    announcement and record dates are not what the price responds to.
    """
    if not _table_exists(con, "corporate_actions"):
        return {}
    out: dict[str, list[dict]] = {}
    for sym, ex, kind, detail, subject in con.execute(
        "SELECT symbol, ex_date, kind, detail, subject FROM corporate_actions ORDER BY ex_date"
    ):
        if ex:
            out.setdefault(sym, []).append(
                {"date": ex, "kind": kind, "detail": detail, "subject": subject})
    return out


def _table_exists(con: sqlite3.Connection, name: str) -> bool:
    return bool(con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone())


def asfiled_table(trend: dict | None, announced: dict | None = None) -> dict | None:
    """A results table built from the AS-FILED NSE figures, quarterly or annual.

    Both sources were being exported and the page rendered the wrong one. Yahoo
    reports "Net Income" as profit attributable to owners, net of minority
    interest; the filing reports total net profit. For Dixon Technologies those
    differ by 15-25% every quarter - Dec-2024 filed at Rs 216cr showed as Rs 171cr
    - so the number on screen came from a real source, just not the one the
    company filed. Yahoo was also missing two of the eight quarters outright.

    Dixon was not special. Across the universe the two sources sit more than 5%
    apart on 1,323 quarterly profit figures spanning 524 companies, 445 annual
    profit figures spanning 306, and 568 annual revenue figures spanning 360.
    Fixing the one company the owner happened to check would have left the other
    hundreds wrong, so the precedence is applied to every table and every company.

    The as-filed series is authoritative, matches screener.in to the decimal, and
    runs deeper. It wins; Yahoo is only a fallback where no filings are parsed.
    """
    if not trend or not trend.get("periods"):
        return None
    per = trend["periods"]
    declared = [(announced or {}).get(p) for p in per]
    rows = [
        ("Revenue", trend.get("revenue")),
        ("Expenses", trend.get("expenses")),
        ("Operating Profit", trend.get("ebitda")),
        ("OPM %", trend.get("opm")),
        ("Interest", trend.get("interest")),
        ("Depreciation", trend.get("depreciation")),
        ("Net Profit", trend.get("pat")),
        ("EPS (Rs)", trend.get("eps")),
    ]
    items = [{"label": lab, "values": vals} for lab, vals in rows
             if vals and any(v is not None for v in vals)]
    if not items:
        return None
    out = {"periods": per, "items": items}
    if any(declared):
        out["declared"] = declared   # shown in brackets after each period
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", help="comma list, or @path - rebuild only these "
                                      "(the full run computes 2,354 companies' bands and takes ~9 minutes)")
    args = ap.parse_args()
    only = None
    if args.symbols:
        raw = (ROOT / args.symbols[1:]).read_text(encoding="utf-8") if args.symbols.startswith("@") else args.symbols
        only = {s.strip().upper() for s in raw.split(",") if s.strip()}
        print(f"rebuilding {len(only)} symbol(s) only")

    con = sqlite3.connect(DB, timeout=180)
    snaps = pd.read_sql("SELECT * FROM fundamentals", con)
    # Same correction as data.json, from the same function: the company page falls
    # back to this snapshot when the screener row is missing, so a stale price here
    # would leak straight back onto the page the fix was written for.
    snaps, _ = freshen_prices(con, snaps)
    has_statements = {
        r[0] for r in con.execute("SELECT DISTINCT symbol FROM statements").fetchall()
    }
    # Share count, from whichever source actually has one. Every ratio band -
    # P/E, P/B, P/S, EV/EBITDA - multiplies price by this to reach market cap,
    # and `ratio_bands` skips a symbol outright when it is missing. So a single
    # absent number silently deletes four twenty-year charts; on 4-Aug-2026 it
    # deleted RELIANCE's and TCS's and stopped the nightly run dead.
    #
    # market_cap / price is primary. shares_out is a genuinely separate field
    # Yahoo returns, and it agrees with market_cap / price within 2% on 2,227 of
    # the 2,258 symbols that carry both - close enough to stand in, far enough
    # from the primary source to survive a partial response that drops one.
    #
    # There is deliberately no third tier. A count implied from filed PAT / EPS
    # is checkable only against a count we already have, so precisely when it is
    # needed it cannot be checked: on the 17 symbols it would rescue it returns
    # 420 trillion shares and a market cap of Rs 1.3 crore-crore. An absent
    # chart is recoverable; a confidently wrong one is not.
    shares_by_symbol, share_src = {}, {"market_cap": 0, "shares_out": 0}
    for r in snaps.to_dict(orient="records"):
        if r.get("market_cap") and r.get("price"):
            shares_by_symbol[r["symbol"]] = r["market_cap"] / r["price"]
            share_src["market_cap"] += 1
        elif r.get("shares_out"):
            shares_by_symbol[r["symbol"]] = r["shares_out"]
            share_src["shares_out"] += 1
    missing_shares = sorted(set(snaps["symbol"]) - set(shares_by_symbol))
    if missing_shares:
        # Named, not merely counted. This used to be invisible, which is why it
        # took a failed publish and a log dig to find two missing numbers.
        print(f"  no share count for {len(missing_shares)} symbols - their ratio "
              f"bands are omitted: {', '.join(missing_shares[:8])}"
              f"{' ...' if len(missing_shares) > 8 else ''}")
    print(f"  share counts: {share_src['market_cap']} from market cap, "
          f"{share_src['shares_out']} from shares outstanding")
    netdebt_by_symbol = net_debt_series(con)
    quarters_by_symbol = quarter_blocks(con)
    wc_ratios = working_capital_ratios(con)
    coverage_by_symbol = coverage_notes(con)
    # symbol -> (exchange, bse code). Older databases have no EXCHANGE column,
    # in which case every company is what it always was: NSE.
    try:
        listing = {r[0]: (r[1] or "NSE", r[2])
                   for r in con.execute("SELECT SYMBOL, EXCHANGE, BSE_CODE FROM universe")}
    except Exception:  # noqa: BLE001
        listing = {}
    actions_by_symbol = corporate_actions(con)
    trends = build_trends(con, shares_by_symbol, only)
    bands = ratio_bands(con, shares_by_symbol, netdebt_by_symbol, only)
    prices_by_symbol: dict[str, dict] = {}
    if con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='prices'").fetchone():
        pr = pd.read_sql("SELECT symbol, freq, date, close, volume FROM prices ORDER BY date", con)
        for (sym_key, freq), grp in pr.groupby(["symbol", "freq"]):
            prices_by_symbol.setdefault(sym_key, {})[freq] = [
                [d, c, None if pd.isna(v) else int(v)]
                for d, c, v in zip(grp["date"], grp["close"], grp["volume"])
            ]
    shp_by_symbol: dict[str, dict] = {}
    if con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='shareholding'").fetchone():
        shp = pd.read_sql("SELECT symbol, date, promoter, public, employee_trusts FROM shareholding ORDER BY date", con)
        for sym_key, grp in shp.groupby("symbol"):
            tail = grp.tail(12)
            shp_by_symbol[sym_key] = {
                "dates": tail["date"].tolist(),
                "promoter": [None if pd.isna(v) else float(v) for v in tail["promoter"]],
                "public": [None if pd.isna(v) else float(v) for v in tail["public"]],
                "employee": [None if pd.isna(v) else float(v) for v in tail["employee_trusts"]],
            }
    anndocs_by_symbol: dict[str, dict] = {}
    if con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='announcement_docs'").fetchone():
        ad = pd.read_sql("SELECT symbol, doc_type, date, title, url FROM announcement_docs ORDER BY date DESC", con)
        for (sym_key, typ), grp in ad.groupby(["symbol", "doc_type"]):
            anndocs_by_symbol.setdefault(sym_key, {})[typ] = [
                {"date": d, "title": t, "url": u}
                for d, t, u in zip(grp["date"], grp["title"], grp["url"])
            ]
    has_docs_table = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='documents'"
    ).fetchone()
    docs_by_symbol: dict[str, list[dict]] = {}
    if has_docs_table:
        for sym, from_yr, to_yr, url in con.execute(
            "SELECT symbol, from_yr, to_yr, url FROM documents WHERE doc_type='annual_report' ORDER BY from_yr DESC"
        ).fetchall():
            docs_by_symbol.setdefault(sym, []).append({"from": from_yr, "to": to_yr, "url": url})
    snaps["debt_to_equity"] = (snaps["debt_to_equity"] / 100).round(3)
    snaps["market_cap"] = (snaps["market_cap"] / 1e7).round(1)
    for col in ["roe", "roa", "net_margin", "op_margin", "gross_margin", "revenue_growth", "earnings_growth"]:
        snaps[col] = (snaps[col] * 100).round(2)
    # same field names the screener app uses (keep in sync with export_json.py)
    snaps = snaps.rename(columns={
        "market_cap": "mcap",
        "dividend_yield": "div_yield",
        "debt_to_equity": "de",
        "revenue_growth": "rev_growth",
        "earnings_growth": "earn_growth",
    })
    snaps = snaps.astype(object).where(pd.notna(snaps), None)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    n_with, n_without = 0, 0
    for _, snap in snaps.iterrows():
        sym = snap["symbol"]
        if only is not None and sym not in only:
            continue
        payload = {
            "generated_at": generated,
            "snapshot": snap.to_dict(),
            "statements": {},
            "documents": {
                "annual_reports": docs_by_symbol.get(sym, []),
                "concalls": anndocs_by_symbol.get(sym, {}).get("concall", []),
                "ratings": anndocs_by_symbol.get(sym, {}).get("rating", []),
            },
            "trend": trends.get(sym, {}),
            "shareholding": shp_by_symbol.get(sym),
            "prices": prices_by_symbol.get(sym),
            "pe_band": bands.get(sym, {}).get("pe"),
            "ev_band": bands.get(sym, {}).get("ev"),
            "pb_band": bands.get(sym, {}).get("pb"),
            "ps_band": bands.get(sym, {}).get("ps"),
            "quarters": quarters_by_symbol.get(sym),
            "actions": actions_by_symbol.get(sym),
            "coverage": coverage_by_symbol.get(sym),
            "ratios": wc_ratios.get(sym),
            # Which exchange this company is listed on, because it decides what
            # can exist on the page. The as-filed quarterly table, the P/E band
            # and the shareholding pattern are all built from NSE endpoints; a
            # company listed only on BSE has none of them and never will from
            # this source. Unsaid, its page is indistinguishable from an NSE
            # company whose data has not been fetched yet, and the reader waits
            # for something that is not coming.
            "exchange": listing.get(sym, ("NSE", None))[0],
            "bse_code": listing.get(sym, ("NSE", None))[1],
        }
        if sym in has_statements:
            stmts = pd.read_sql("SELECT * FROM statements WHERE symbol = ?", con, params=(sym,))
            for key, stmt_type, period_type in [
                ("_yf_quarterly", "income", "quarterly"),
                ("_yf_annual", "income", "annual"),
                ("balance_sheet", "balance", "annual"),
                ("cash_flow", "cashflow", "annual"),
            ]:
                built = build_statement(stmts, stmt_type, period_type)
                if built:
                    payload["statements"][key] = built
        # As-filed wins for the quarterly table; Yahoo only stands in where no
        # filings have been parsed. Exporting both and letting the page pick is
        # what put Yahoo's owners-only profit on screen next to the filed figure.
        for key, tkey, yf_key in (("quarterly_results", "quarterly", "_yf_quarterly"),
                                  ("annual_pnl", "annual", "_yf_annual")):
            asf = asfiled_table((trends.get(sym) or {}).get(tkey),
                                {q["end"]: q.get("announced") for q in (quarters_by_symbol.get(sym) or [])})
            fallback = payload["statements"].pop(yf_key, None)
            chosen = asf or fallback
            if chosen:
                payload["statements"][key] = chosen
                payload.setdefault("sources", {})[key] = "as-filed (NSE)" if asf else "Yahoo Finance"
        if payload["statements"]:
            n_with += 1
        else:
            n_without += 1
        (OUT_DIR / f"{sym}.json").write_text(
            json.dumps(clean_nan(payload), ensure_ascii=False, allow_nan=False), encoding="utf-8"
        )
    con.close()
    print(f"company files: {n_with} with statements, {n_without} snapshot-only -> {OUT_DIR}")


if __name__ == "__main__":
    main()
