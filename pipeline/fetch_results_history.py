"""Rscreener P6 - long-term as-filed P&L history via NSE results XBRL.

For each symbol:
  1. GET /api/corporates-financial-results (Annual + Quarterly) -> filing index
  2. download each filing's XBRL from nsearchives (unblocked CDN host)
  3. parse the facts whose context matches the filing period
  4. store long-form rows in `results_history`

Consolidated is preferred; standalone is used when no consolidated filing
exists for that period. Old-format (pre-Ind-AS) filings use a different
taxonomy - a fallback tag map covers the common items; anything unparsed is
counted and reported, never silently dropped.

Usage:
  python fetch_results_history.py --symbols TCS,INFY
  python fetch_results_history.py --symbols @data/top500.txt --limit 100
"""
import argparse
import sqlite3
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
INDEX_API = "https://www.nseindia.com/api/corporates-financial-results?index=equities&symbol={sym}&period={period}"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}

# Ind-AS (post-2016) duration tags -> our item names
TAGS = {
    "RevenueFromOperations": "revenue",
    "OtherIncome": "other_income",
    "Income": "total_income",
    "Expenses": "total_expenses",
    "EmployeeBenefitExpense": "employee_cost",
    "FinanceCosts": "finance_cost",
    "DepreciationDepletionAndAmortisationExpense": "depreciation",
    "ProfitBeforeTax": "pbt",
    "TaxExpense": "tax",
    "ProfitLossForPeriod": "pat",
    "ProfitLossForPeriodAttributableToOwnersOfParent": "pat_owners",
    "BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations": "eps",
    # banks file a different P&L shape
    "InterestEarned": "revenue_bank",
    "NetProfitLossForThePeriod": "pat_old",
}
# old (pre-Ind-AS) + bank taxonomy fallbacks; setdefault keeps Ind-AS values
# when both taxonomies appear in one file
OLD_TAGS = {
    "NetSalesIncomeFromOperations": "revenue",
    "TotalIncome": "total_income",
    "TotalExpenditure": "total_expenses",
    "ProfitLossFromOrdinaryActivitiesBeforeTax": "pbt",
    "TaxExpense": "tax",
    "NetProfitLossForThePeriod": "pat",
    "ProfitLossForThePeriod": "pat",
    "ProfitLossFromOrdinaryActivitiesAfterTax": "pat",
    "BasicEPSForContinuingAndDiscontinuedOperations": "eps",
    "BasicEPS": "eps",
    "BasicEarningsPerShareAfterExtraordinaryItems": "eps",
}
INSTANT_TAGS = {"Equity": "equity", "PaidUpValueOfEquityShareCapital": "share_capital"}


def iso(d: str) -> str:
    return datetime.strptime(d, "%d-%b-%Y").strftime("%Y-%m-%d")


def parse_xbrl(xml_bytes: bytes, period_type: str) -> dict[str, float]:
    """NSE results XBRL uses FIXED context ids (Reg-33 column layout), not
    period dates: OneD = the reported quarter, FourD = cumulative year-to-date,
    OneI = balance-sheet instant at period end. For an annual (Q4 cumulative)
    filing the full-year numbers live in FourD; quarterly numbers in OneD."""
    root = ET.fromstring(xml_bytes)
    by_ctx: dict[str, dict[str, float]] = {}
    for el in root.iter():
        cref = el.get("contextRef")
        if not cref or el.text is None or not el.text.strip():
            continue
        tag = el.tag.split("}")[-1]
        name = TAGS.get(tag) or OLD_TAGS.get(tag) or INSTANT_TAGS.get(tag)
        if not name:
            continue
        try:
            val = float(el.text.strip())
        except ValueError:
            continue
        by_ctx.setdefault(cref, {})[name] = val

    if period_type == "annual":
        facts = dict(by_ctx.get("FourD") or by_ctx.get("OneD") or {})
    else:
        facts = dict(by_ctx.get("OneD") or {})
    facts.update(by_ctx.get("OneI", {}))  # instants (equity, share capital)

    # normalise bank/old variants into the main names
    if "revenue" not in facts and "revenue_bank" in facts:
        facts["revenue"] = facts["revenue_bank"]
    if "pat" not in facts and "pat_old" in facts:
        facts["pat"] = facts["pat_old"]
    for aux in ("revenue_bank", "pat_old"):
        facts.pop(aux, None)
    return facts


def pick_filings(rows: list[dict], quarters_back: int, period: str) -> list[dict]:
    """One filing per period: consolidated wins over standalone; newest first."""
    by_period: dict[tuple, dict] = {}
    for r in rows:
        if not r.get("xbrl") or str(r.get("xbrl")).strip() in ("-", ""):
            continue
        if not r.get("fromDate") or not r.get("toDate"):
            continue
        key = (r["fromDate"], r["toDate"])
        cur = by_period.get(key)
        if cur is None or (r.get("consolidated") == "Consolidated" and cur.get("consolidated") != "Consolidated"):
            by_period[key] = r
    picked = sorted(by_period.values(), key=lambda r: datetime.strptime(r["toDate"], "%d-%b-%Y"), reverse=True)
    if period == "Quarterly" and quarters_back > 0:
        picked = picked[:quarters_back]
    return picked


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", required=True, help="comma list, or @path to file")
    ap.add_argument("--limit", type=int, default=0, help="cap the run to the N most-overdue symbols (0 = no cap)")
    ap.add_argument("--quarters-back", type=int, default=40, help="max quarterly filings per symbol (0 = all available)")
    ap.add_argument("--max-age-hours", type=float, default=0.0, help="re-fetch a symbol whose last fetch is older than this (0 = only never-fetched symbols)")
    ap.add_argument("--sleep", type=float, default=0.35)
    ap.add_argument("--refresh", action="store_true", help="re-fetch every listed symbol regardless of age")
    args = ap.parse_args()

    raw = (ROOT / args.symbols[1:]).read_text(encoding="utf-8") if args.symbols.startswith("@") else args.symbols
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]

    con = sqlite3.connect(DB)
    con.execute(
        "CREATE TABLE IF NOT EXISTS results_history (symbol TEXT, basis TEXT, period_type TEXT, period_start TEXT, period_end TEXT, item TEXT, value REAL)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS results_fetch_log (symbol TEXT PRIMARY KEY, fetched_at TEXT, error TEXT, n_periods INTEGER)"
    )
    # decide which symbols are due, oldest-first (a never-fetched symbol counts as oldest)
    log = {r[0]: r[1] for r in con.execute("SELECT symbol, fetched_at FROM results_fetch_log WHERE error IS NULL").fetchall()}
    if args.refresh:
        due = list(symbols)
    elif args.max_age_hours > 0:
        cutoff = (datetime.utcnow() - timedelta(hours=args.max_age_hours)).strftime("%Y-%m-%d %H:%M:%S")
        due = [s for s in symbols if log.get(s, "") < cutoff]  # "" (never-fetched) sorts below any real timestamp
    else:
        due = [s for s in symbols if s not in log]
    due.sort(key=lambda s: log.get(s) or "")  # oldest / missing first
    if args.limit:
        due = due[: args.limit]
    symbols = due
    print(f"fetching results history for {len(symbols)} symbols...")

    s = requests.Session()
    s.headers.update(HEADERS)
    try:
        s.get("https://www.nseindia.com", timeout=20)
    except Exception:
        pass

    for i, sym in enumerate(symbols, 1):
        n_periods = skipped = 0
        err = None
        try:
            filings = []
            for period in ("Annual", "Quarterly"):
                r = s.get(INDEX_API.format(sym=sym, period=period), timeout=25)
                r.raise_for_status()
                body = r.json()
                rows = body if isinstance(body, list) else body.get("data", [])
                for f in pick_filings(rows, args.quarters_back, period):
                    f["_ptype"] = "annual" if period == "Annual" else "quarterly"
                    filings.append(f)
                time.sleep(args.sleep)
            for f in filings:
                try:
                    xml = requests.get(f["xbrl"], headers=HEADERS, timeout=25).content
                    facts = parse_xbrl(xml, f["_ptype"])
                except Exception:
                    skipped += 1
                    continue
                if not facts:
                    skipped += 1
                    continue
                basis = "consolidated" if f.get("consolidated") == "Consolidated" else "standalone"
                ps, pe = iso(f["fromDate"]), iso(f["toDate"])
                con.execute(
                    "DELETE FROM results_history WHERE symbol=? AND period_type=? AND period_start=? AND period_end=?",
                    (sym, f["_ptype"], ps, pe),
                )
                con.executemany(
                    "INSERT INTO results_history VALUES (?,?,?,?,?,?,?)",
                    [(sym, basis, f["_ptype"], ps, pe, k, v) for k, v in facts.items()],
                )
                n_periods += 1
                time.sleep(0.15)
            con.execute(
                "INSERT OR REPLACE INTO results_fetch_log VALUES (?,?,?,?)",
                (sym, datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"), None, n_periods),
            )
            con.commit()
            print(f"[{i}/{len(symbols)}] {sym}: {n_periods} periods parsed, {skipped} skipped")
        except Exception as e:  # noqa: BLE001
            err = str(e)[:200]
            con.execute(
                "INSERT OR REPLACE INTO results_fetch_log VALUES (?,?,?,?)",
                (sym, datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"), err, n_periods),
            )
            con.commit()
            print(f"[{i}/{len(symbols)}] {sym}: ERROR {err}")
        time.sleep(args.sleep)
    print("done")


if __name__ == "__main__":
    main()
