"""One-off items in the trailing twelve months, and the P/E without them.

The P/E band (trend_lib.ratio_bands) divides the price by the last four
quarters' EPS exactly as filed with NSE, and filed EPS includes exceptional
items: a land sale, a write-down, a legal settlement. Those do not repeat, so
for the four quarters after one the P/E reads cheap (a gain) or dear (a
charge) for a reason that has nothing to do with the business.

This takes the SAME four quarters the current P/E point used, takes the
exceptional items out after tax, and gives the P/E and EPS without them.

- Exceptional items are filed before tax. Each quarter's own effective tax
  rate (tax / profit before tax) is applied; where that rate is not usable
  (a loss before tax, a negative or implausible rate) the 25.17% corporate
  rate stands in.
- The share is taken against the group's profit for the period; EPS belongs
  to the owners. Where a subsidiary with outside shareholders booked the
  one-off, the owners' share of it is smaller than this assumes.
- Profit from discontinued operations (a business sold or demerged) is a
  one-off too, and is filed after tax. A quarter without that line is taken
  as having none - most filings leave it out when there is nothing to show.
- A quarter whose filing states no exceptional line at all is UNKNOWN, not
  zero: then nothing is worked out, rather than a P/E "without one-offs"
  that may still contain them.
"""
from __future__ import annotations

import sqlite3
from datetime import date

# India's corporate rate under section 115BAA, surcharge and cess included.
TAX_FALLBACK = 0.2517
# One-offs at or above this share of the year's profit are worth a reader's
# attention; the company page shows its tile from here.
FLAG_PCT = 10.0
# The newest P/E point must be about today's, or its four quarters are not
# the current ones (a company whose TTM broke months ago).
MAX_AGE_DAYS = 14


def after_tax(exceptional: float, pbt: float | None, tax: float | None) -> float:
    rate = TAX_FALLBACK
    if pbt is not None and tax is not None and pbt > 0:
        r = tax / pbt
        if 0 <= r <= 0.5:
            rate = r
    return exceptional * (1 - rate)


def core_figures(price: float | None, ttm_eps: float | None, quarters: list[dict]) -> dict:
    """price and ttm_eps from the newest P/E point; quarters = the four it
    used, each {pat, exceptional, pbt, tax, discontinued?} in rupees.

    Returns pe_filed always (when the P/E exists), and oneoff_pct / eps_core
    / pe_core when all four quarters state their exceptional items. pe_core
    and eps_core stay None when, without the one-offs, there is no profit."""
    if price is None or not ttm_eps or ttm_eps <= 0:
        return {}
    out: dict = {"pe_filed": round(price / ttm_eps, 1)}
    if len(quarters) != 4 or any(q.get("pat") is None or q.get("exceptional") is None for q in quarters):
        return out
    pat = sum(q["pat"] for q in quarters)
    if pat <= 0:
        return out
    one = sum(after_tax(q["exceptional"], q.get("pbt"), q.get("tax")) + (q.get("discontinued") or 0.0)
              for q in quarters)
    out["oneoff_pct"] = round(one / pat * 100, 1)
    core = pat - one
    if core > 0:
        eps_core = ttm_eps * core / pat
        out["eps_core"] = round(eps_core, 2)
        out["pe_core"] = round(price / eps_core, 1)
    else:
        out["eps_core"] = None
        out["pe_core"] = None
    return out


def screen_fields(con: sqlite3.Connection, pe_bands: dict[str, dict]) -> dict[str, dict]:
    """{symbol: {pe_filed, oneoff_pct, eps_core, pe_core}} from each symbol's
    P/E band (its newest point's price, TTM EPS and four quarters)."""
    want: dict[str, tuple] = {}
    newest = max((b["series"][-1][0] for b in pe_bands.values() if b.get("series")), default=None)
    if newest is None:
        return {}
    for sym, b in pe_bands.items():
        parts, series = b.get("parts"), b.get("series")
        if not parts or not series or len(parts) != len(series):
            continue
        age = (date.fromisoformat(newest) - date.fromisoformat(series[-1][0])).days
        if age > MAX_AGE_DAYS:
            continue
        price, eps, qs = parts[-1]
        want[sym] = (price, eps, list(qs))
    by: dict[str, dict] = {}
    for sym, pe, item, v in con.execute(
        "SELECT symbol, period_end, item, value FROM results_history "
        "WHERE period_type='quarterly' AND item IN ('pat','exceptional','pbt','tax','discontinued')"
    ):
        if sym in want and pe in want[sym][2] and v is not None:
            by.setdefault(sym, {}).setdefault(pe, {})[item] = float(v)
    out = {}
    for sym, (price, eps, qs) in want.items():
        f = core_figures(price, eps, [by.get(sym, {}).get(q, {}) for q in qs])
        if f:
            out[sym] = f
    flagged = sum(1 for f in out.values() if abs(f.get("oneoff_pct") or 0) >= FLAG_PCT)
    known = sum(1 for f in out.values() if "oneoff_pct" in f)
    print(f"  one-offs: stated for {known} of {len(out)} companies with a P/E; "
          f"{flagged} at {FLAG_PCT:g}% or more of the year's profit")
    return out
