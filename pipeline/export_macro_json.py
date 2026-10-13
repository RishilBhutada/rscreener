"""Rscreener - the US economy's history (web/public/macro.json).

Every series in macro_series.py that fetch_macro.py has stored, oldest
reading first, with its latest reading and the one before it, and the NBER
recessions as [first month, last month] pairs to shade behind the charts.

Written even before FRED has ever been read - with no series - so the gold
page can say the history is not loaded yet instead of failing to find a file.

Usage:  python export_macro_json.py
"""
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

from macro_series import ALL, GROUPS, RECESSIONS, SERIES

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "macro.json"
# FRED's terms ask every product built on its API to carry this sentence.
NOTICE = "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis."


def stored() -> tuple[dict[str, list[tuple[str, float]]], str | None]:
    """Each series' readings, oldest first, and when FRED last answered."""
    if not DB.exists():
        return {}, None
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        if not con.execute("SELECT 1 FROM sqlite_master WHERE name='macro_obs'").fetchone():
            return {}, None
        rows = defaultdict(list)
        for sid, d, v in con.execute("SELECT series, date, value FROM macro_obs ORDER BY series, date"):
            rows[sid].append((d, v))
        ids = [s.id for s in ALL]
        last = con.execute(f"SELECT MAX(fetched_at) FROM macro_log WHERE series IN ({','.join('?' * len(ids))})",
                           ids).fetchone()[0]
    finally:
        con.close()
    return rows, last


def recessions(rows: list[tuple[str, float]]) -> list[list[str]]:
    """Each run of recession months as [first, last]. A recession still
    under way ends at the newest month."""
    out, start, prev = [], None, None
    for d, v in rows:
        if v >= 0.5 and start is None:
            start = d
        elif v < 0.5 and start is not None:
            out.append([start, prev])
            start = None
        prev = d
    if start is not None:
        out.append([start, prev])
    return out


def number(v: float, n: int) -> float:
    return round(v, n) or 0.0  # 0.0, not -0.0: a reading of "-0.0%" reads as a fall


def main() -> None:
    data, read_at = stored()
    out = []
    for s in SERIES:
        rows = data.get(s.id)
        if not rows:
            continue
        # One decimal more than shown, so the chart's line does not step.
        pts = [[d, number(v * s.scale, s.dec + 1)] for d, v in rows]
        prev = pts[-2] if len(pts) > 1 else [None, None]
        out.append({
            "id": s.id, "fred": s.fred, "title": s.title, "group": s.group, "unit": s.unit, "kind": s.kind,
            "dec": s.dec, "freq": s.freq, "about": s.about, "source": s.source, "first": pts[0][0],
            "last": {"date": pts[-1][0], "value": pts[-1][1], "prev": prev[1], "prev_date": prev[0]},
            "points": pts,
        })
    rec = recessions(data.get(RECESSIONS.id) or [])
    OUT.write_text(json.dumps({
        "generated_at": read_at, "notice": NOTICE, "recessions": rec,
        "groups": [g for g in GROUPS if any(x["group"] == g for x in out)], "series": out,
    }, separators=(",", ":"), ensure_ascii=False, allow_nan=False), encoding="utf-8")
    missing = [s.fred for s in SERIES if not data.get(s.id)]
    print(f"macro: {len(out)} series, {sum(len(x['points']) for x in out)} points, {len(rec)} recessions; "
          f"FRED last read {read_at or 'never'}" + (f"; not loaded yet: {', '.join(missing)}" if missing else ""))


if __name__ == "__main__":
    main()
