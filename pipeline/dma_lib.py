"""Time below the 200-day average: how often, and for how long, a stock has
closed under it. Descriptive only (owner, 13-Nov-2026: "Build it. In the
research tab"); the test of buying those dips is in the page's own note.

Weekly closes against a 40-week average (the weekly stand-in for 200 days);
a "dip" is a run of at least MIN_SPELL weeks below. Pure functions, tested.
"""
from __future__ import annotations

from statistics import median

MA_WEEKS = 40
MIN_SPELL = 2


def moving_average(values: list[float], n: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    s = 0.0
    for i, v in enumerate(values):
        s += v
        if i >= n:
            s -= values[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def spell_stats(closes: list[float], n: int = MA_WEEKS) -> dict | None:
    """{pct_below, dips, median_dip, longest_dip, now_below, run} for a weekly
    series, oldest first. run = weeks in the current state (above or below).
    None when fewer than n + 52 closes (under a year after warm-up)."""
    if len(closes) < n + 52:
        return None
    ma = moving_average(closes, n)
    below = [c < m for c, m in zip(closes, ma) if m is not None]
    spells, cur = [], 0
    for b in below:
        if b:
            cur += 1
        else:
            if cur:
                spells.append(cur)
            cur = 0
    open_dip = cur
    dips = [s for s in spells if s >= MIN_SPELL] + ([open_dip] if open_dip >= MIN_SPELL else [])
    run = 0
    for b in reversed(below):
        if b == below[-1]:
            run += 1
        else:
            break
    return {
        "pct_below": round(sum(below) / len(below) * 100, 1),
        "dips": len(dips),
        "median_dip": int(median(dips)) if dips else None,
        "longest_dip": max(dips) if dips else None,
        "now_below": bool(below[-1]),
        "run": run,
        "weeks": len(below),
    }


def distance(close: float | None, avg: float | None) -> float | None:
    """How far the close is from the average, in percent."""
    if close is None or not avg:
        return None
    return round((close / avg - 1) * 100, 1)
