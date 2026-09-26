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
from datetime import date
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


if __name__ == "__main__":
    main()
