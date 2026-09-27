"""Weekly and monthly price bars: one row per period, labelled by the day its
close belongs to.

What the provider sends, and why it could not be stored as it came:

  - Its timestamps are Indian time. Period bars open at 00:00 IST, which is
    18:30 UTC the day before - so dated in UTC, August's bar was stored as
    31 July and the week of Monday 24 August as Sunday 23 August. Every
    weekly and monthly close sat under the date of the PREVIOUS period.
  - After the last period bar it appends the latest session as a row of its
    own. Stored alongside, the month ended twice: once under the shifted label
    (month-to-date) and once under the session date (one day).
  - For young listings the monthly series comes back as daily rows, some
    repeated up to seven times (48,749 duplicate rows across 178 companies in
    the 6-Sep-2026 database).

Consumers read these rows as (date, close). The one-month return took the
bar labelled a month back - which held a close from a month later - and the
session row, and so measured a single day: TCS showed -0.2% for a month in
which it fell 9.3%. Valuation bands paired each earnings figure with a price
from up to a month later.

So every weekly and monthly row is now: dated in IST, one per period, merged
(first open, highest high, lowest low, last close, summed volume), and
labelled with the period's last day - the day its close is from. The period
still in progress is labelled with its latest session, never a future date.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Callable, Iterable

IST = timezone(timedelta(hours=5, minutes=30))

Row = tuple  # (date_iso, open, high, low, close, volume)


def ist_date(ts: int) -> str:
    """A provider timestamp as the Indian calendar date it belongs to."""
    return datetime.fromtimestamp(ts, tz=IST).strftime("%Y-%m-%d")


def period_start(freq: str, d: date) -> date:
    return d - timedelta(days=d.weekday()) if freq == "weekly" else d.replace(day=1)


def period_end(freq: str, d: date) -> date:
    """Friday of the week, or the month's last calendar day."""
    if freq == "weekly":
        return period_start(freq, d) + timedelta(days=4)
    nxt = (d.replace(day=28) + timedelta(days=4)).replace(day=1)
    return nxt - timedelta(days=1)


def fold(rows: Iterable[Row], freq: str, cap: date | None,
         start_of: Callable[[date], date]) -> list[Row]:
    """One row per date, then one row per period.

    `start_of` maps a row's date to the start of the period it belongs to.
    `cap` is the latest real session: the period in progress is labelled with
    it rather than with a calendar end still in the future."""
    by_date: dict[str, Row] = {}
    for r in rows:
        by_date[r[0]] = r                      # the provider repeats rows; keep one
    groups: dict[date, list[Row]] = {}
    for d in sorted(by_date):
        groups.setdefault(start_of(date.fromisoformat(d)), []).append(by_date[d])
    today = datetime.now(IST).date()
    out: list[Row] = []
    for start in sorted(groups):
        g = groups[start]
        bound = cap if cap is not None and cap >= start else today
        label = min(period_end(freq, start), bound)
        opens = [r[1] for r in g if r[1] is not None]
        highs = [r[2] for r in g if r[2] is not None]
        lows = [r[3] for r in g if r[3] is not None]
        closes = [r[4] for r in g if r[4] is not None]
        vols = [r[5] for r in g if r[5] is not None]
        if not closes:
            continue
        out.append((label.isoformat(), opens[0] if opens else None, max(highs) if highs else None,
                    min(lows) if lows else None, closes[-1], sum(vols) if vols else None))
    return out


def from_fetch(rows: list[Row], freq: str, cap: date | None) -> list[Row]:
    """Rows fresh from the provider, already dated in IST: a period bar is dated
    by its first day, the trailing session row by its own day."""
    return fold(rows, freq, cap, lambda d: period_start(freq, d))


def legacy_start_of(freq: str, dates: list[date]) -> Callable[[date], date]:
    """How to read rows stored before this module existed.

    Period bars were dated a day early in UTC: a Sunday (weekly) or a month's
    last day (monthly) is the day before the period it opens. Anything else is
    a real session date. A series that is really daily rows - young listings -
    is read entirely as session dates; otherwise its month-end sessions would
    be pushed into the following month."""
    dense = sum(1 for a, b in zip(dates, dates[1:]) if (b - a).days < (5 if freq == "weekly" else 20)) > 2
    if dense:
        return lambda d: period_start(freq, d)
    if freq == "weekly":
        return lambda d: d + timedelta(days=1) if d.weekday() == 6 else period_start(freq, d)
    return lambda d: (d + timedelta(days=1)) if (d + timedelta(days=1)).day == 1 else d.replace(day=1)
