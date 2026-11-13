"""Checks a filed figure must pass before it is believed.

unit_outliers   periods whose revenue sits a units-mistake away (about 100x,
                1,000x or 100,000x) from the company's own neighbouring
                periods while those neighbours agree with each other.

Found 4-Nov-2026 in the stored filings: 70 annual and 270 quarterly revenue
figures were a unit away from the periods either side - CONCOR's FY2015 at
Rs 61.5 Cr between Rs 5,108 Cr and Rs 6,306 Cr, Bank of Baroda's FY2014 at
Rs 460 Cr between Rs 40,953 Cr and Rs 50,364 Cr - and 49 companies' annual
tables still showed one after every other check. Values in crore read with a
lakh multiplier come out exactly 100x small; that exactness is what tells a
misread unit from a real collapse.

Judged against the median of up to three periods each side, not one
neighbour, so a run of two wrong periods is still caught; and only where
those neighbours agree, so a business that really shrank (every later period
small too) is left alone.

No imports beyond the standard library: the fetcher uses it before storing a
filing, and trend_lib uses it on what is already stored.
"""
from __future__ import annotations

import math
from statistics import median

UNIT_STEPS = (2, 3, 5)      # powers of ten: crore/lakh, thousand, lakh/rupee
UNIT_TOL = 0.25             # in log10 terms: 100x means 56x-178x
WINDOW = 3                  # periods each side
AGREE = 3.0                 # a neighbour within this factor of the median agrees


def is_unit_step(ratio: float, tol: float = UNIT_TOL) -> bool:
    """Whether a ratio is a units mistake: 10^2, 10^3 or 10^5 either way."""
    if not ratio or ratio <= 0:
        return False
    lg = abs(math.log10(ratio))
    return any(abs(lg - k) <= tol for k in UNIT_STEPS)


def unit_outliers(seq: list[tuple[str, float | None]]) -> set[str]:
    """Periods of `seq` [(period, value)], oldest first, whose value is a
    units mistake against its neighbours."""
    pts = [(p, v) for p, v in seq if v is not None and v > 0]
    bad: set[str] = set()
    for i, (p, v) in enumerate(pts):
        before = [x for _, x in pts[max(0, i - WINDOW):i]]
        after = [x for _, x in pts[i + 1:i + 1 + WINDOW]]
        near = before + after
        if len(near) < 2:
            continue
        m = median(near)
        agreeing = sum(1 for x in near if 1 / AGREE <= x / m <= AGREE)
        if agreeing < max(2, (len(near) + 1) // 2):
            continue                    # the neighbours do not agree: nothing to judge by
        # Only a jump that COMES BACK. The first and last periods are never
        # judged: a business really can start up or collapse (Reliance Power's
        # first year was before its plants ran), and with neighbours on one
        # side a real change and a misread unit look the same. A wrong newest
        # quarter is caught once the next one is filed.
        # ...and the neighbours that agree must be on BOTH sides: the last big
        # year before a real collapse has small years after it and big ones
        # before, and the median of those is no yardstick.
        ok = lambda x: 1 / AGREE <= x / m <= AGREE  # noqa: E731
        if (before and after and any(ok(x) for x in before) and any(ok(x) for x in after)
                and is_unit_step(v / m)):
            bad.add(p)
    return bad


# A quarter holding the year-to-date instead of its own three months: Coal
# India, Coforge and TVS Holdings Sep-2026 each filed revenue about twice
# their June quarter (13-Nov-2026 scan). The spike test above never judges the
# NEWEST quarter, which is exactly where a fresh misread sits.
YTD_TOL = 0.2        # within 20% of 2x / 3x / 4x the run-rate
YTD_SEASONAL = 1.5   # the same quarter a year earlier this far above ITS run-rate = seasonal business


def quarters_into_year(period_end: str, fy_end_month: int) -> int:
    """1 for the first quarter of the financial year .. 4 for the last."""
    m = int(period_end[5:7])
    return ((m - fy_end_month - 1) % 12) // 3 + 1


def _lift(pts: list, i: int) -> float | None:
    before = [v for _, v in pts[max(0, i - 4):i]]
    if len(before) < 2:
        return None
    return pts[i][1] / median(before)


def ytd_quarters(series: dict[str, list[tuple[str, float | None]]], fy_end_month: int = 3) -> set[str]:
    """Quarters whose figures are the year-to-date total, not the quarter.

    `series` maps an item to its quarterly values [(period_end, value)],
    oldest first: "revenue" is required; "depreciation" and "employee_cost"
    are the witnesses.

    The k-th quarter of a year read as year-to-date is about k times the
    run-rate (the median of up to four quarters before it). Revenue alone
    cannot tell that from a lumpy business - a defence maker's order-heavy
    quarter looks the same - so a STEADY cost has to have jumped by the same
    multiple too: depreciation or staff cost does not double in a quarter
    unless the column holds two quarters. Also cleared:
      - the same quarter a year earlier stood as far above its run-rate
        (a seasonal business);
      - the quarter after it stays up (a real step: an acquisition)."""
    rev = [(p, v) for p, v in series.get("revenue", []) if v is not None and v > 0]
    ridx = {p: i for i, (p, _) in enumerate(rev)}
    steady = []
    for item in ("depreciation", "employee_cost"):
        pts = [(p, v) for p, v in series.get(item, []) if v is not None and v > 0]
        steady.append((pts, {p: i for i, (p, _) in enumerate(pts)}))

    bad: set[str] = set()
    for i, (p, v) in enumerate(rev):
        k = quarters_into_year(p, fy_end_month)
        r = _lift(rev, i)
        if k < 2 or r is None or abs(r / k - 1) > YTD_TOL:
            continue
        j = ridx.get(f"{int(p[:4]) - 1}{p[4:]}")
        r_prev = _lift(rev, j) if j is not None else None
        if r_prev is not None and r_prev >= YTD_SEASONAL:
            continue
        if i + 1 < len(rev):
            base = median([x for _, x in rev[max(0, i - 4):i]])
            if rev[i + 1][1] / base >= YTD_SEASONAL:
                continue
        witnessed = False
        for pts, idx in steady:
            n = idx.get(p)
            w = _lift(pts, n) if n is not None else None
            if w is not None and abs(w / k - 1) <= YTD_TOL + 0.05:
                witnessed = True
        if witnessed:
            bad.add(p)
    return bad
