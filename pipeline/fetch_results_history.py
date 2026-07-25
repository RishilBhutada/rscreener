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
import re
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
    "CostOfMaterialsConsumed": "cost_materials",
    "PurchasesOfStockInTrade": "purchases",
    "ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade": "inv_change",
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

# Pre-Ind-AS filings (roughly 2005-2018) have NO XBRL - the index's `xbrl` field is
# the placeholder ".../xbrl/-". Those rows instead carry `resultDetailedDataLink`,
# an HTML page on the (unblocked) nsearchives host holding the same P&L as a
# label/value table. Parsing it is what extends every ratio band back to ~2005.
# Two label dialects appear across the pre-Ind-AS era and both must be read:
#   2005-2011  plain Clause-41 ("Consumption of Raw Materials", "Total Expenditure")
#   2012-2017  revised Clause-41 ("(a) Cost of materials consumed", "Total expenses",
#              and EPS split under "Earnings per share (after extraordinary items)"
#              section headers with a bare "(a) Basic" row beneath)
# Rules are ordered; the first match for a still-unset item wins.
OLD_HTML_RULES: list[tuple[str, str]] = [
    (r"^total income from operations", "revenue"),
    # "...from Operation" (singular) appears in the 2011-era sheets
    (r"^net sales ?/ ?income from operation", "revenue_net"),
    (r"^revenue from operations", "revenue_net"),
    (r"^net income from sales", "revenue_net"),   # services-sector variant
    (r"^gross profit", "gross_profit"),           # some sheets report GP directly
    (r"^interest earned", "revenue_bank"),
    (r"^total income$", "total_income"),
    (r"^other income", "other_income"),
    (r"^total expenditure$", "total_expenses"),
    (r"^total expenses$", "total_expenses"),
    (r"^cost of materials consumed", "cost_materials"),
    (r"^consumption of raw materials", "cost_materials"),
    (r"^purchases? of stock-?in-?trade", "purchases"),
    (r"^purchase of traded goods", "purchases"),
    (r"^changes in inventories", "inv_change"),
    (r"^increase ?/ ?decrease in stock", "inv_change"),
    (r"^employee benefits expense", "employee_cost"),
    (r"^employees cost", "employee_cost"),
    (r"^depreciation", "depreciation"),
    (r"^finance costs?", "finance_cost"),
    (r"^interest$", "finance_cost"),
    (r"from ordinary activities before tax", "pbt"),
    (r"^tax expense", "tax"),
    (r"^net profit.*for the period", "pat"),
    (r"^net profit.*after tax", "pat_old"),
    (r"^paid-?up equity share capital", "share_capital"),
    (r"^reserves? excluding revaluation reserves", "reserves"),
    (r"^basic eps after extraordinary", "eps"),
    (r"^basic eps before extraordinary", "eps_before"),
]
OLD_HTML_RULES_C = [(re.compile(p), k) for p, k in OLD_HTML_RULES]
_EPS_AFTER = re.compile(r"^earnings per share.*after extraordinary")
_EPS_BEFORE = re.compile(r"^earnings per share.*before extraordinary")
_EPS_BASIC = re.compile(r"^basic$")
# values that are per-share rupees, never scaled by the sheet's unit
_UNSCALED = {"eps", "eps_before"}
_AUX = ("revenue_bank", "revenue_net", "pat_old", "eps_before", "reserves")
_UNITS = [("crore", 1e7), ("million", 1e6), ("lakh", 1e5)]


def _num(s: str) -> float | None:
    s = s.replace(",", "").strip()
    if s in ("", "-", "--", "NA", "N.A."):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    # NSE uses -999 as a "not reported" sentinel in the shareholding columns
    return None if v == -999.0 else v


def parse_old_html(text: str) -> dict[str, float]:
    """Extract the P&L from a pre-Ind-AS `resultDetailedDataLink` page.

    Values are reported in a unit named in the sheet header ("Amount(Rs. in
    lakhs)"); they are scaled to plain rupees so they match the XBRL rows.
    """
    body = re.sub(r"<script.*?</script>", "", text, flags=re.S | re.I)
    cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", body, flags=re.S | re.I)
    clean = [re.sub(r"<[^>]+>", "", c).replace("&nbsp;", " ").strip() for c in cells]
    clean = [c for c in clean if c]

    scale = 1.0
    for c in clean:
        m = re.search(r"amount\s*\(?\s*rs\.?\s*in\s*([a-z]+)", c, flags=re.I)
        if m:
            unit = m.group(1).lower()
            for key, mult in _UNITS:
                if unit.startswith(key):
                    scale = mult
            break

    facts: dict[str, float] = {}
    eps_section: str | None = None
    for i, raw in enumerate(clean[:-1]):
        label = re.sub(r"\s+", " ", raw).strip().lower()
        label = re.sub(r"^\(?[a-z]\)\s*", "", label).strip()  # drop "(a) " / "a) " markers
        if _EPS_AFTER.search(label):
            eps_section = "eps"
            continue
        if _EPS_BEFORE.search(label):
            eps_section = "eps_before"
            continue
        key = None
        if _EPS_BASIC.match(label) and eps_section:
            key = eps_section
        else:
            for rx, k in OLD_HTML_RULES_C:
                if rx.search(label):
                    key = k
                    break
        if not key or key in facts:
            continue
        v = _num(clean[i + 1])
        if v is None:
            continue
        facts[key] = v if key in _UNSCALED else v * scale

    if "revenue" not in facts and "revenue_net" in facts:
        facts["revenue"] = facts["revenue_net"]
    if "revenue" not in facts and "revenue_bank" in facts:
        facts["revenue"] = facts["revenue_bank"]
    if "pat" not in facts and "pat_old" in facts:
        facts["pat"] = facts["pat_old"]
    if "eps" not in facts and "eps_before" in facts:
        facts["eps"] = facts["eps_before"]
    # Convention fix: the old sheet's "Total Expenditure" excludes interest
    # (PBT = Total Income - Total Expenditure - Interest), whereas Ind-AS
    # "Expenses" includes it. Fold interest in so downstream EBITDA/OPM math
    # (revenue - expenses + interest + depreciation) is uniform across eras.
    if "total_expenses" in facts and "finance_cost" in facts:
        facts["total_expenses"] += facts["finance_cost"]
    # net worth = paid-up capital + reserves (the old sheet has no single equity line)
    if "equity" not in facts and "share_capital" in facts and "reserves" in facts:
        facts["equity"] = facts["share_capital"] + facts["reserves"]
    for aux in _AUX:
        facts.pop(aux, None)
    return facts


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


def _has_xbrl(r: dict) -> bool:
    x = str(r.get("xbrl") or "").strip()
    return bool(x) and not x.endswith("/-") and x not in ("-", "")


def pick_filings(rows: list[dict], quarters_back: int, period: str) -> list[dict]:
    """One filing per period: consolidated wins over standalone; newest first.

    Accepts both modern XBRL filings and pre-Ind-AS ones that only expose the
    HTML `resultDetailedDataLink`. Quarterly picks are restricted to filings
    that actually cover ~one quarter, so cumulative half/nine-month sheets
    (common in the old format) can't masquerade as a quarter.
    """
    by_period: dict[tuple, dict] = {}
    for r in rows:
        if not _has_xbrl(r) and not r.get("resultDetailedDataLink"):
            continue
        if not r.get("fromDate") or not r.get("toDate"):
            continue
        try:
            d0 = datetime.strptime(r["fromDate"], "%d-%b-%Y")
            d1 = datetime.strptime(r["toDate"], "%d-%b-%Y")
        except ValueError:
            continue
        span = (d1 - d0).days
        if period == "Quarterly" and not (80 <= span <= 100):
            continue
        if period == "Annual" and not (330 <= span <= 400):
            continue
        key = (r["fromDate"], r["toDate"])
        cur = by_period.get(key)
        if cur is None:
            by_period[key] = r
            continue
        # prefer consolidated, then a real XBRL over the HTML fallback
        better = (r.get("consolidated") == "Consolidated" and cur.get("consolidated") != "Consolidated") or (
            r.get("consolidated") == cur.get("consolidated") and _has_xbrl(r) and not _has_xbrl(cur)
        )
        if better:
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
                    if _has_xbrl(f):
                        xml = requests.get(f["xbrl"], headers=HEADERS, timeout=25).content
                        facts = parse_xbrl(xml, f["_ptype"])
                    else:  # pre-Ind-AS: parse the HTML detail sheet instead
                        html = requests.get(f["resultDetailedDataLink"], headers=HEADERS, timeout=25).text
                        facts = parse_old_html(html)
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
