"""Rscreener - web/public/vol/<SYMBOL>.json: the volume split for the
company page's chart. Shares DELIVERED (taken into demat) against shares
bought and sold the same day, from fetch_volume_split.py.

  d  [[date, traded, delivered]]   last 250 sessions        (the 1-year view)
  w  [[week, traded, delivered]]   last 156 weeks           (the 3-year view)
  m  [[month, traded, delivered]]  up to 10 years, monthly  (the 10-year view)

Delivered is not the same as long-term: a share bought today and sold
tomorrow is delivered. Generated, never committed.
Usage:  python pipeline/export_vol_json.py
"""
import json
import shutil
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "vol"


def main() -> None:
    con = sqlite3.connect(DB)
    have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "vol_split_w" not in have:
        print("vol: no volume-split history yet - nothing written")
        return
    # Only companies the app has a page for (the files also carry SME and
    # other series the screener does not list).
    listed = {r[0] for r in con.execute("SELECT SYMBOL FROM universe")}
    daily: dict[str, list] = {}
    for s, d, t, dq in con.execute("SELECT symbol, date, traded, delivered FROM vol_split ORDER BY symbol, date"):
        daily.setdefault(s, []).append([d, int(t), int(dq)])
    weekly: dict[str, list] = {}
    for s, w, t, dq in con.execute("SELECT symbol, week, traded, delivered FROM vol_split_w ORDER BY symbol, week"):
        weekly.setdefault(s, []).append([w, int(t), int(dq)])
    con.close()
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    n = 0
    for sym in sorted((set(daily) | set(weekly)) & listed):
        ws = weekly.get(sym, [])
        months: dict[str, list] = {}
        for w, t, dq in ws:
            m = months.setdefault(w[:7], [w[:7], 0, 0])
            m[1] += t
            m[2] += dq
        doc = {"d": daily.get(sym, [])[-250:], "w": ws[-156:], "m": list(months.values())[-120:]}
        # "&" and other symbols safe as file names, the way companies/ is.
        (OUT / f"{sym}.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
        n += 1
    print(f"vol: {n} files written")


if __name__ == "__main__":
    main()
