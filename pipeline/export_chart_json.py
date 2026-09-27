"""Per-company candle files for the full-screen chart.

Output: web/public/charts/<SYMBOL>.json

    {"s": "TCS", "asof": "2026-08-27",
     "d": [[day, open, high, low, close, volume], ...],   # daily, ~2 years
     "w": [...],                                            # weekly, ~5 years
     "m": [...]}                                            # monthly, full history

`day` is days since 1970-01-01 - five characters instead of a twelve-character
date string, which on ~1,000 rows a company is most of the file. The chart
multiplies it back into a timestamp.

Kept apart from companies/<SYMBOL>.json on purpose: the company page loads that
file on every visit and needs closes only; the candles are fetched only when the
full chart is actually opened.

A row whose open/high/low are missing - it happens on a few thin days - is drawn
as a flat candle at the close rather than dropped, so the time axis keeps its
trading days and a gap never reads as a market holiday that was not one.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "charts"
EPOCH = date(1970, 1, 1)
FREQ = {"daily": "d", "weekly": "w", "monthly": "m"}


def _day(iso: str) -> int:
    return (date.fromisoformat(iso[:10]) - EPOCH).days


def _px(v: float | None) -> float | None:
    if v is None:
        return None
    # Two decimals under a thousand rupees, one above - the precision a price is
    # quoted at, and every extra digit is a byte in a file sent to a phone.
    return round(v, 2) if abs(v) < 1000 else round(v, 1)


def _period_start(freq: str, d: date) -> date:
    """The first day of the week or month a stored weekly/monthly row covers.

    Since pipeline/price_periods.py (and its one-time migration) every stored
    row is labelled by the day its close belongs to - a period's last day, or
    the latest session for the period in progress - so a row simply belongs
    to the week or month its date falls in."""
    return d - timedelta(days=d.weekday()) if freq == "w" else d.replace(day=1)


def _bucket(freq: str, d: date) -> date:
    """The week (Monday) or month (1st) a trading date falls in."""
    return d - timedelta(days=d.weekday()) if freq == "w" else d.replace(day=1)


def _fold(rows: list[list], start_of) -> list[list]:
    """Merge consecutive rows that belong to the same period into one candle:
    first open, highest high, lowest low, last close, summed volume."""
    out: list[list] = []
    for r in rows:
        k = start_of(r[0])
        if out and out[-1][0] == k:
            p = out[-1]
            out[-1] = [k, p[1], max(p[2], r[2]), min(p[3], r[3]), r[4], p[5] + r[5]]
        else:
            out.append([k, r[1], r[2], r[3], r[4], r[5]])
    return out


def _normalise(doc: dict) -> None:
    """Weekly and monthly candles, built from the daily prices wherever the
    daily series reaches, and from the provider's own bars only before it.

    The provider's weekly and monthly rows could not be used as they arrive:
      - labelled a day early (period start in UTC), so August printed as July;
      - the latest session appended as an extra row, a day past the daily
        series and the header price, on a price no guard had checked;
      - for young listings the "monthly" series is daily rows, stored up to
        seven times over (48,749 duplicates across 178 companies), whose
        volumes do not even agree with the daily series - OMPOWER's May read
        583,122 shares against 7,334,780 in the daily data.
    Resampling from daily - the series the price guards check - fixes all
    three at once for the last two years, which is where every one of these
    faults lives. Older history keeps the provider's bars, de-duplicated and
    re-labelled to the period they cover."""
    daily = doc.get("d") or []
    for key in ("w", "m"):
        raw = doc.get(key) or []
        by_day: dict[int, list] = {r[0]: r for r in raw}
        prov = _fold([by_day[d] for d in sorted(by_day)],
                     lambda day, k=key: (_period_start(k, EPOCH + timedelta(days=day)) - EPOCH).days)
        if not daily:
            doc[key] = prov
            continue
        first_d, last_d = daily[0][0], daily[-1][0]
        derived = _fold(daily, lambda day, k=key: (_bucket(k, EPOCH + timedelta(days=day)) - EPOCH).days)
        # A company listed inside the daily window has no genuine older bars;
        # take every period from daily, including the first, partial one.
        if not raw or min(by_day) >= first_d - 7:
            out = derived
        else:
            full = [c for c in derived if c[0] >= first_d]          # periods daily covers whole
            cut = full[0][0] if full else last_d + 1
            out = [c for c in prov if c[0] < cut] + full
        # A daily series stale by more than a week (9 companies): the provider's
        # later bars are real, and are kept rather than trimmed to match.
        if raw and max(by_day) - last_d > 7:
            out += [c for c in prov if c[0] > out[-1][0]]
        doc[key] = out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    rows = con.execute(
        "SELECT symbol, freq, date, open, high, low, close, volume FROM prices "
        "WHERE close IS NOT NULL ORDER BY symbol, freq, date"
    )
    written, total_bytes = 0, 0
    cur_sym: str | None = None
    doc: dict = {}

    def flush() -> None:
        nonlocal written, total_bytes
        if cur_sym is None:
            return
        _normalise(doc)
        daily = doc.get("d") or doc.get("w") or doc.get("m") or []
        doc["asof"] = str(EPOCH.fromordinal(EPOCH.toordinal() + daily[-1][0])) if daily else None
        text = json.dumps(doc, separators=(",", ":"), allow_nan=False)
        (OUT / f"{cur_sym}.json").write_text(text, encoding="utf-8")
        written += 1
        total_bytes += len(text)

    for sym, freq, d, o, h, lo, c, v in rows:
        key = FREQ.get(freq)
        if key is None:
            continue
        if sym != cur_sym:
            flush()
            cur_sym, doc = sym, {"s": sym}
        close = _px(c)
        o, h, lo = _px(o) if o else close, _px(h) if h else close, _px(lo) if lo else close
        doc.setdefault(key, []).append([_day(d), o, h, lo, close, int(v) if v else 0])
    flush()
    con.close()
    print(f"chart files: {written} -> {OUT}  ({total_bytes / 1e6:.0f} MB, "
          f"{total_bytes / max(written, 1) / 1e3:.0f} KB each on average)")
    # Every company page links to its full chart. A run that writes far fewer
    # files than there are companies (a database restored without prices, say)
    # would publish a site where most of those links open an error - so it
    # stops the publish instead of shipping that quietly.
    companies = sum(1 for _ in (ROOT / "web" / "public" / "companies").glob("*.json"))
    if companies and written < 0.9 * companies:
        raise SystemExit(f"only {written} chart files for {companies} companies - refusing to publish")


if __name__ == "__main__":
    main()
