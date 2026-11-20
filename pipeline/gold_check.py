"""Cross-checks of the gold page's prices (owner, 20-Nov-2026: "improve the
data accuracy" - picked a general cross-check).

Each source is set against an independent one, not against itself:

  USD/INR    Yahoo's close (INR=X) against FRED's DEXINUS - the Federal
             Reserve's noon New York buying rate. Different hour, different
             publisher; they should sit within a few tenths of a percent.
  MCX-COMEX  MCX gold (the exchange's prices, via Upstox) against COMEX
             (Yahoo) x USD/INR x India's duty, for 10 grams. Two publishers
             and two markets held together by arbitrage: the gap between
             them is the local premium plus carry and drifts slowly. A jump
             in it from one day to the next means one side's price is wrong
             - a stale close, or the wrong contract after a roll.
  Freshness  Each series' last day against the day it should have reached.

A check passes or fails on numbers set below; the page shows the figures
either way. Pure functions over [(day, value)] lists - tested in
tests/test_gold_check.py.
"""
from __future__ import annotations

import statistics
from datetime import date, timedelta

OZ_PER_10G = 10 / 31.1034768
FX_MEDIAN_OK, FX_MAX_OK = 0.5, 1.5     # % apart, Yahoo vs the Fed
GAP_JUMP = 1.5                          # % change in the MCX-COMEX gap in a day
STALE_DAYS = 4                          # calendar days behind the expected day


def _on(series: list[tuple[str, float]], day: str) -> float | None:
    """The value on that exact day."""
    for d, v in reversed(series):
        if d == day:
            return v
        if d < day:
            return None
    return None


def usdinr(yahoo: list[tuple[str, float]], fred: list[tuple[str, float]], days: int = 60) -> dict | None:
    """Yahoo's USD/INR against the Fed's, on the days both have, newest `days`."""
    y = dict(yahoo)
    pairs = [(d, (y[d] / v - 1) * 100) for d, v in fred if d in y and v]
    pairs = pairs[-days:]
    if len(pairs) < 10:
        return None
    worst = max(pairs, key=lambda p: abs(p[1]))
    med = statistics.median(abs(p) for _, p in pairs)
    return {"what": "USD/INR", "against": "Federal Reserve noon rate (FRED DEXINUS)", "n": len(pairs),
            "median": round(med, 2), "worst": round(abs(worst[1]), 2), "worst_day": worst[0],
            "ok": med <= FX_MEDIAN_OK and abs(worst[1]) <= FX_MAX_OK}


FX_BAD = 1.0       # % off the Fed's rate that marks a Yahoo close as wrong
FX_SPIKE = 1.5     # % jump that comes straight back, where the Fed has no figure


def clean_fx(yahoo: list[tuple[str, float]], fred: list[tuple[str, float]]) -> tuple[list[tuple[str, float]], list[str]]:
    """Yahoo's USD/INR without its bad days, and the days removed.

    Found 20-Nov-2026: Yahoo's close for 26 Aug 2026 was 93.55 between 95.72
    and 95.43 - a one-day 2.3% blip, reversed the next day, that put the
    page's world price in rupees 2% too low. A day more than FX_BAD off the
    Fed's own rate is dropped; where the Fed has no figure yet (it publishes
    about a week late), a jump of FX_SPIKE that comes straight back is."""
    ys = sorted(yahoo)
    fed = dict(fred)
    bad = set()
    for i, (d, v) in enumerate(ys):
        if d in fed and fed[d]:
            if abs(v / fed[d] - 1) * 100 > FX_BAD:
                bad.add(d)
        elif 0 < i < len(ys) - 1:
            a, b = (v / ys[i - 1][1] - 1) * 100, (ys[i + 1][1] / v - 1) * 100
            if abs(a) > FX_SPIKE and abs(b) > FX_SPIKE and (a > 0) != (b > 0):
                bad.add(d)
    return [(d, v) for d, v in ys if d not in bad], sorted(bad)


def parity(mcx: list[tuple[str, float]], comex: list[tuple[str, float]], fx: list[tuple[str, float]],
           duty_on, days: int = 60) -> dict | None:
    """MCX against COMEX x USD/INR x duty for 10 g, each MCX day with all three
    on that day. `duty_on(day)` -> (percent, ...) or None. Flags the days the
    gap jumped by more than GAP_JUMP since the day before."""
    gaps = []
    for d, m in mcx:
        c, f, du = _on(comex, d), _on(fx, d), duty_on(d)
        if c and f and du and m:
            world = c * f * OZ_PER_10G * (1 + du[0] / 100)
            gaps.append((d, (m / world - 1) * 100))
    gaps = gaps[-days:]
    if len(gaps) < 10:
        return None
    jumps = [(gaps[i][0], round(gaps[i][1] - gaps[i - 1][1], 2)) for i in range(1, len(gaps))
             if abs(gaps[i][1] - gaps[i - 1][1]) > GAP_JUMP]
    vals = [g for _, g in gaps]
    return {"what": "MCX vs COMEX", "against": "COMEX x USD/INR x India's duty", "n": len(gaps),
            "gap_lo": round(min(vals), 2), "gap_hi": round(max(vals), 2), "gap_now": round(vals[-1], 2),
            "jumps": jumps[-5:], "n_jumps": len(jumps), "ok": not jumps}


def expected_day(today: date) -> date:
    """The last weekday before today - the newest close a nightly run can have."""
    d = today - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def fresh(name: str, series: list[tuple[str, float]], today: date) -> dict:
    last = series[-1][0] if series else None
    behind = (expected_day(today) - date.fromisoformat(last)).days if last else None
    return {"what": name, "last": last, "behind": behind, "ok": behind is not None and behind <= STALE_DAYS}
