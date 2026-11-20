"""Half-yearly cash flow from the results NSE files (owner, 20-Nov-2026:
"yes, add half-yearly cash flow").

Since FY21 a listed company's results XBRL carries its cash flow statement,
year-to-date: the September (half-year) filing holds April-September, the
March filing the whole year. So

    H1 = the half-year figure as filed
    H2 = the year less H1, on the same basis, from the same start date

Before FY21 the statement is only in the PDF (checked 20-Nov-2026 on TCS:
the Sep-2019 / Sep-2020 XBRL have no cash flow tags), so the history starts
at FY21's year and FY22's first half.

Context ids differ between eras (FourD for the year-to-date column; one
2021 file put the year in OneD), so a context is taken by the dates it
declares, never by its id.

Stored long-form in `cashflow_ytd` as filed (rupees); the halves are worked
out at export time by `halves()`, which is pure and tested.
"""
from __future__ import annotations

import sqlite3
import xml.etree.ElementTree as ET
from datetime import date

# Ind-AS results taxonomy, read off TCS's Mar-2026 filing (20-Nov-2026).
CF_TAGS = {
    "CashFlowsFromUsedInOperatingActivities": "cfo",
    "CashFlowsFromUsedInInvestingActivities": "cfi",
    "CashFlowsFromUsedInFinancingActivities": "cff",
    "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities": "capex_ppe",
    "PurchaseOfIntangibleAssetsClassifiedAsInvestingActivities": "capex_intang",
}
# a half-year column is ~183 days, a year ~365; anything else (a quarter,
# nine months) is not a cash flow column we can use
HALF = (170, 195)
YEAR = (350, 380)


def _span(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def _ytd_start(end: str, fy_end_month: int) -> str | None:
    """Start of the year-to-date a column ending `end` covers: 12 months back
    when it ends the financial year, 6 when it ends the half; else None."""
    e = date.fromisoformat(end)
    half_month = (fy_end_month + 5) % 12 + 1
    if e.month == fy_end_month:
        months = 12
    elif e.month == half_month:
        months = 6
    else:
        return None
    m = e.month - months + 1
    y = e.year + (m - 1) // 12 if m > 0 else e.year - 1
    m = (m - 1) % 12 + 1
    return date(y, m, 1).isoformat()


def parse(xml_bytes: bytes, fy_end_month: int | None = None) -> list[tuple[str, str, dict[str, float]]]:
    """[(start, end, {item: rupees})] for every half-year or year column in a
    results XBRL that holds operating cash flow. Empty when the file has none.

    Filings before 2025 declare the year-to-date column (FourD; OneD in some
    2021 files) with the QUARTER's dates while its cash flow values are year
    to date (TCS Sep-2023: FourD dated 1-Jul to 30-Sep, CFO = April-September).
    A cash flow statement is never filed for a lone quarter, so a cash flow
    column dated as anything but a half or a year is read as year to date
    from the financial year's start (`fy_end_month`), and dropped where its
    end is neither a half nor a year end. Without `fy_end_month` (a caller
    that does not know the company's year) only columns whose own dates fit
    are kept: a December-year company's September filing is nine months to
    date, and re-dating it as a half would be wrong."""
    root = ET.fromstring(xml_bytes)
    dates: dict[str, tuple[str, str]] = {}
    for ctx in root.iter():
        if ctx.tag.split("}")[-1] != "context" or not ctx.get("id"):
            continue
        d = {el.tag.split("}")[-1]: (el.text or "").strip()[:10] for el in ctx.iter()}
        if d.get("startDate") and d.get("endDate"):
            dates[ctx.get("id")] = (d["startDate"], d["endDate"])
    # The filer's own statement of each column's dates, as facts: the most
    # reliable source (TCS Sep-2021 declares no context dates at all; Sep-2023
    # dates FourD as the quarter), so it overrides the context declaration.
    stated: dict[str, dict[str, str]] = {}
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        if tag in ("DateOfStartOfReportingPeriod", "DateOfEndOfReportingPeriod") and el.get("contextRef"):
            side = "start" if "Start" in tag else "end"
            stated.setdefault(el.get("contextRef"), {})[side] = (el.text or "").strip()[:10]
    for cref, d in stated.items():
        if d.get("start") and d.get("end"):
            dates[cref] = (d["start"], d["end"])
    by_ctx: dict[str, dict[str, float]] = {}
    for el in root.iter():
        name = CF_TAGS.get(el.tag.split("}")[-1])
        cref = el.get("contextRef")
        if not name or not cref or cref not in dates or not (el.text or "").strip():
            continue
        try:
            by_ctx.setdefault(cref, {})[name] = float(el.text.strip())
        except ValueError:
            continue
    # (start, end) -> (rank, facts): a column whose own dates fit beats a
    # re-dated one, and FourD (the year-to-date column by definition) beats OneD.
    best: dict[tuple[str, str], tuple[int, dict[str, float]]] = {}
    for cref, facts in by_ctx.items():
        if "cfo" not in facts:
            continue
        a, b = dates[cref]
        try:
            n = _span(a, b)
        except ValueError:
            continue
        if HALF[0] <= n <= HALF[1] or YEAR[0] <= n <= YEAR[1]:
            rank = 0
        else:
            a = _ytd_start(b, fy_end_month) if fy_end_month else None
            if a is None:
                continue
            rank = 1 if cref == "FourD" else 2
        if (a, b) not in best or rank < best[(a, b)][0]:
            best[(a, b)] = (rank, facts)
    return [(a, b, f) for (a, b), (_, f) in sorted(best.items())]


def ensure_table(con: sqlite3.Connection) -> None:
    con.execute(
        "CREATE TABLE IF NOT EXISTS cashflow_ytd (symbol TEXT, basis TEXT, period_start TEXT, period_end TEXT,"
        " item TEXT, value REAL, PRIMARY KEY (symbol, basis, period_start, period_end, item))")


def store(con: sqlite3.Connection, sym: str, basis: str, cols: list[tuple[str, str, dict[str, float]]]) -> int:
    """Upsert parsed columns; returns how many columns were written."""
    if not cols:
        return 0
    ensure_table(con)
    for a, b, facts in cols:
        con.execute("DELETE FROM cashflow_ytd WHERE symbol=? AND basis=? AND period_start=? AND period_end=?",
                    (sym, basis, a, b))
        con.executemany("INSERT INTO cashflow_ytd VALUES (?,?,?,?,?,?)",
                        [(sym, basis, a, b, k, v) for k, v in facts.items()])
    return len(cols)


def _fcf(f: dict[str, float]) -> float | None:
    """Operating cash flow less what was spent on fixed and intangible assets.
    Filers write purchases as positive outflows, a few as negative: abs()."""
    if f.get("cfo") is None or f.get("capex_ppe") is None:
        return None
    return f["cfo"] - abs(f["capex_ppe"]) - abs(f.get("capex_intang") or 0.0)


def halves(cols: dict[tuple[str, str], dict[str, float]]) -> list[dict]:
    """{(start, end): facts} for ONE basis -> half-years, oldest first:
    [{"start", "end", "cfo", "fcf"}] in rupees. H2 needs both the year and
    its H1 (same start date); a year without its H1 gives nothing."""
    out: dict[str, dict] = {}
    h1_by_start = {a: (b, f) for (a, b), f in cols.items() if HALF[0] <= _span(a, b) <= HALF[1]}
    for a, (b, f) in h1_by_start.items():
        out[b] = {"start": a, "end": b, "cfo": f.get("cfo"), "fcf": _fcf(f)}
    for (a, b), f in cols.items():
        if not (YEAR[0] <= _span(a, b) <= YEAR[1]) or a not in h1_by_start:
            continue
        h1_end, h1 = h1_by_start[a]
        cfo = f["cfo"] - h1["cfo"] if f.get("cfo") is not None and h1.get("cfo") is not None else None
        fy, fh = _fcf(f), _fcf(h1)
        h2_start = date.fromordinal(date.fromisoformat(h1_end).toordinal() + 1).isoformat()
        out[b] = {"start": h2_start, "end": b, "cfo": cfo,
                  "fcf": fy - fh if fy is not None and fh is not None else None}
    return [out[k] for k in sorted(out)]


def load(con: sqlite3.Connection) -> dict[str, dict]:
    """{symbol: {"basis", "periods", "cfo", "fcf"}} in Rs crore, for the
    company file. One basis throughout, never mixed between halves."""
    if not con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='cashflow_ytd'").fetchone():
        return {}
    raw: dict[tuple[str, str], dict[tuple[str, str], dict[str, float]]] = {}
    for s, basis, a, b, item, v in con.execute(
            "SELECT symbol, basis, period_start, period_end, item, value FROM cashflow_ytd"):
        raw.setdefault((s, basis), {}).setdefault((a, b), {})[item] = v
    out: dict[str, dict] = {}
    for (s, basis), cols in raw.items():
        hs = halves(cols)
        if len(hs) < 2:
            continue
        # The basis with more halves; consolidated on a tie. ABB files
        # consolidated results only now and then: 2 halves against 8.
        if s in out:
            have = len(out[s]["periods"])
            if len(hs) < have or (len(hs) == have and basis != "consolidated"):
                continue
        cr = lambda v: None if v is None else round(v / 1e7, 1)  # noqa: E731
        out[s] = {"basis": basis, "periods": [h["end"] for h in hs],
                  "cfo": [cr(h["cfo"]) for h in hs], "fcf": [cr(h["fcf"]) for h in hs]}
    return out
