"""Seasons: whether a company's sales, profit or share price follow the quarter
of the year - and whether that is more than luck.

Measured on 10-Oct-2026 over the whole universe, before this was built:

  pattern in      companies   pass the shuffle   best quarter     four-quarter
                              test (p < 0.05;    still best in    shape repeats in
                              luck: 5%)          later years      later years
                                                 (luck: 25%)      (luck: 25%)
  sales           1,612       54%                52%              55%
  profit          1,205       39%                42%              46%
  share price*    3,282       24%                33%              41%
                                                       * against the Nifty 50

Part of the price figure is one market-wide season, not each company's own:
the median stock trailed the Nifty 50 in Jan-Mar in 22 of 26 years (median
-6%), so a smaller company "repeating" a weak Jan-Mar is often just that.

So a business season is common and real - S Chand sells books in Jan-Mar,
Kaveri seeds in Apr-Jun, defence makers deliver at the government's year-end.
A share-price season is far weaker: a stock's best quarter in its early
years is its best in its later years a third of the time, against a quarter
by luck. The company page shows both, and calls a pattern
reliable only when it passes:

  shuffle   the F statistic of the four quarters against 499 shuffles of the
            quarter labels (seeded by symbol, so every run gives the same
            answer). Business p < 0.05; price p < 0.01, its base being weaker.
  halves    the four-quarter shape of the first half of the years repeats in
            the second (correlation 0.5 or more; luck: 25%). Business: not
            contradicted; price: must hold.

Business: each quarter's figure against the centred 4-quarter moving average
(2x4 MA), so a growing company's later quarters are not mistaken for a season;
five consecutive positive quarters are needed for one value, so a loss quarter
leaves a gap. Quarters are the financial year's: Q1 Apr-Jun ... Q4 Jan-Mar.

Price: each quarter's return minus the Nifty 50's over the same quarter (log),
same four month-ranges. A quarter holding a split, bonus or rights ex-date, or
a move beyond 3x either way, is left out as a share-count change, not a season.

What happened, never a forecast.
"""
from __future__ import annotations

import sqlite3
import zlib
from collections import defaultdict

import numpy as np

QUARTERS = ("Apr–Jun", "Jul–Sep", "Oct–Dec", "Jan–Mar")   # the financial year's Q1..Q4
RESHAPES = ("bonus", "split", "rights", "other")
SHUFFLES = 499


def _has(con: sqlite3.Connection, name: str) -> bool:
    return con.execute("SELECT 1 FROM sqlite_master WHERE name=?", (name,)).fetchone() is not None


def _fq(month: int) -> int:
    """Financial-year quarter 0..3 (Apr-Jun = 0) of a quarter ending in `month`."""
    return {6: 0, 9: 1, 12: 2, 3: 3}[month]


def _between(vals: np.ndarray, labels: np.ndarray) -> float:
    return sum((labels == k).sum() * (vals[labels == k].mean() - vals.mean()) ** 2 for k in range(4))


def shuffle_p(vals: np.ndarray, labels: np.ndarray, seed: str) -> float:
    """Share of label shuffles whose between-quarter spread is at least the real
    one. Group sizes are fixed under a shuffle, so the between-group sum of
    squares orders shuffles exactly as the F statistic does."""
    rng = np.random.default_rng(zlib.crc32(seed.encode()))
    real = _between(vals, labels)
    perms = np.array([rng.permutation(labels) for _ in range(SHUFFLES)])
    grand = vals.mean()
    spread = np.zeros(SHUFFLES)
    for k in range(4):
        m = perms == k
        n = m.sum(1)
        spread += n * ((m * vals).sum(1) / np.maximum(n, 1) - grand) ** 2
    return float(((spread >= real - 1e-12).sum() + 1) / (SHUFFLES + 1))


def halves(rows: list[tuple]) -> bool | None:
    """rows (year, quarter, value): does the four-quarter shape of the early
    years repeat in the later ones - correlation of the two profiles 0.5 or
    more? None with under six years or a quarter missing from either half.

    The shape, not just the best quarter: Voltas sells most in Jan-Mar AND
    Apr-Jun, 1.22x and 1.18x an average quarter, and which of the two comes
    out on top swaps between halves - a real summer season that a "same best
    quarter" test threw out."""
    years = sorted({y for y, _, _ in rows})
    if len(years) < 6:
        return None
    cut = years[len(years) // 2]
    early, late = defaultdict(list), defaultdict(list)
    for y, q, v in rows:
        (early if y < cut else late)[q].append(v)
    if len(early) < 4 or len(late) < 4:
        return None
    e = np.array([np.mean(early[q]) for q in range(4)])
    l = np.array([np.mean(late[q]) for q in range(4)])
    if e.std() == 0 or l.std() == 0:
        return False
    return bool(np.corrcoef(e, l)[0, 1] >= 0.5)


def _in(only: set | None) -> tuple[str, list]:
    if not only:
        return "", []
    return f" AND symbol IN ({','.join('?' * len(only))})", sorted(only)


def business(con: sqlite3.Connection, item: str, only: set | None = None) -> dict[str, dict]:
    """{symbol: season of `item` ("revenue" or "pat")} for companies with three
    years of usable quarters."""
    if not _has(con, "results_history"):
        return {}
    where, args = _in(only)
    series: dict[tuple, dict] = defaultdict(dict)
    for sym, basis, pe, v in con.execute(
            "SELECT symbol, basis, period_end, value FROM results_history WHERE period_type='quarterly' AND item=?"
            + where, (item, *args)):
        if v is not None and pe[5:] in ("03-31", "06-30", "09-30", "12-31"):
            series[(sym, basis)][pe] = v
    # The basis with more quarters; consolidated where they tie.
    chosen: dict[str, dict] = {}
    for (sym, basis), d in sorted(series.items(), key=lambda kv: kv[0][1] != "consolidated"):
        if len(d) > len(chosen.get(sym, {})):
            chosen[sym] = d
    out = {}
    for sym, d in chosen.items():
        ends = sorted(d)
        rows = []
        for i in range(2, len(ends) - 2):
            five = ends[i - 2:i + 3]
            seq = [int(e[:4]) * 4 + (int(e[5:7]) - 1) // 3 for e in five]
            w = [d[e] for e in five]
            if seq != list(range(seq[0], seq[0] + 5)) or min(w) <= 0:
                continue
            cma = (0.5 * w[0] + w[1] + w[2] + w[3] + 0.5 * w[4]) / 4
            m = int(ends[i][5:7])
            rows.append((int(ends[i][:4]) + (1 if m >= 4 else 0), _fq(m), float(np.log(w[2] / cma))))
        labels = np.array([q for _, q, _ in rows])
        if len(rows) < 12 or any((labels == k).sum() < 2 for k in range(4)):
            continue
        vals = np.array([v for _, _, v in rows])
        raw = [float(np.exp(vals[labels == k].mean())) for k in range(4)]
        idx = [x / (sum(raw) / 4) for x in raw]
        peak, low = int(np.argmax(idx)), int(np.argmin(idx))
        # In how many financial years with all four quarters was the peak quarter the biggest.
        by_year = defaultdict(dict)
        for y, q, v in rows:
            by_year[y][q] = v
        full = [qs for qs in by_year.values() if len(qs) == 4]
        p = shuffle_p(vals, labels, f"{sym}:{item}")
        held = halves(rows)
        out[sym] = {
            "idx": [round(x, 2) for x in idx], "peak": peak, "low": low,
            "won": sum(1 for qs in full if max(qs, key=qs.get) == peak), "of": len(full),
            "p": round(p, 3), "holds": held, "ok": p < 0.05 and held is not False,
        }
    return out


def price(con: sqlite3.Connection, only: set | None = None) -> dict[str, dict]:
    """{symbol: share-price season against the Nifty 50} for eight years or more."""
    if not (_has(con, "prices") and _has(con, "idx_bars")):
        return {}
    nifty = {}
    for d, c in con.execute("SELECT date, close FROM idx_bars WHERE name='Nifty 50' AND date >= '1999-12-01' ORDER BY date"):
        if d[5:7] in ("03", "06", "09", "12") and c:
            nifty[d[:7]] = c
    keys = sorted(nifty)
    nq = {b: np.log(nifty[b] / nifty[a]) for a, b in zip(keys, keys[1:])}
    skip = set()
    if _has(con, "corporate_actions"):
        where, args = _in(only)
        for sym, ex in con.execute(f"SELECT symbol, ex_date FROM corporate_actions WHERE kind IN ({','.join('?' * len(RESHAPES))})"
                                   + where, (*RESHAPES, *args)):
            if ex:
                m = int(ex[5:7])
                skip.add((sym, f"{ex[:4]}-{((m - 1) // 3 + 1) * 3:02d}"))
    where, args = _in(only)
    closes: dict[str, dict] = defaultdict(dict)
    for sym, d, c in con.execute(
            "SELECT symbol, date, close FROM prices WHERE freq='monthly' AND date >= '1999-12-01'"
            " AND substr(date, 6, 2) IN ('03','06','09','12')" + where + " ORDER BY date", args):
        if c and c > 0:
            closes[sym][d[:7]] = c
    out = {}
    for sym, d in closes.items():
        ks = sorted(d)
        rows = []
        for a, b in zip(ks, ks[1:]):
            if int(b[:4]) * 12 + int(b[5:]) - int(a[:4]) * 12 - int(a[5:]) != 3 or b not in nq or (sym, b) in skip:
                continue
            r = float(np.log(d[b] / d[a]))
            if abs(r) > np.log(3):
                continue
            m = int(b[5:])
            rows.append((int(b[:4]) + (1 if m >= 4 else 0), _fq(m), r - float(nq[b])))
        labels = np.array([q for _, q, _ in rows])
        if len(rows) < 32 or any((labels == k).sum() < 4 for k in range(4)):
            continue
        vals = np.array([v for _, _, v in rows])
        p = shuffle_p(vals, labels, f"{sym}:price")
        held = halves(rows)
        out[sym] = {
            "avg": [round((float(np.exp(vals[labels == k].mean())) - 1) * 100, 1) for k in range(4)],
            "beat": [int((vals[labels == k] > 0).sum()) for k in range(4)],
            "years": [int((labels == k).sum()) for k in range(4)],
            "p": round(p, 3), "holds": held, "ok": p < 0.01 and held is True,
        }
    return out


def seasons(con: sqlite3.Connection, only: set | None = None) -> dict[str, dict]:
    """{symbol: {"sales": ..., "profit": ..., "price": ...}} - whichever exist."""
    out: dict[str, dict] = defaultdict(dict)
    for key, part in (("sales", business(con, "revenue", only)), ("profit", business(con, "pat", only)),
                      ("price", price(con, only))):
        for sym, v in part.items():
            out[sym][key] = v
    return dict(out)


def screen_fields(all_seasons: dict[str, dict]) -> dict[str, dict]:
    """The screener's three: sales peak and weakest quarter (1-4) and how much
    bigger the peak is (%), for reliable sales seasons only - a screen should
    not be able to pick up a pattern luck would have produced."""
    out = {}
    for sym, s in all_seasons.items():
        sales = s.get("sales")
        if sales and sales["ok"]:
            idx = sales["idx"]
            out[sym] = {"season_peak": sales["peak"] + 1, "season_low": sales["low"] + 1,
                        "season_swing": round((idx[sales["peak"]] / idx[sales["low"]] - 1) * 100, 1)}
    return out
