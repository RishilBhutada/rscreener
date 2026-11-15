"""Rscreener - the Lab's files (research only):

  web/public/lab/index.json    instruments, and market-wide facts per date
  web/public/lab/<SYMBOL>.json one instrument's daily records for the backtest

index.json
  instruments  [[symbol, "index" | "stock", lot, first date, days]]
  market       {date: [India VIX close, VIX % change that day, FIIs' index
                futures long %, S&P 500 % change in the US session that
                ended before this Indian day opened, events]}
               events: "R" an RBI policy decision, "B" a Union Budget
  series       [[date, vix, fii long %, Nifty put/call OI ratio]] for the
               stock charts' market overlays

<SYMBOL>.json  {sym, lot, index, days: [[date, underlying close,
               futures [expiry, open, close][], put/call OI ratio,
               expiries [expiry, lowest strike, step, call open[], call
               close[], put open[], put close[]][]]]}

The backtest itself runs in the browser (web/src/lib/optlab.ts).
Usage:  python pipeline/export_lab_json.py
"""
import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import optlab_lib as lib

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "lab"
MIN_DAYS = 250

# RBI policy decision days and Union Budget days. Hand-kept: 2016-2025 from
# memory, 2026 from RBI's published FY27 calendar (decision = the meeting's
# last day). NOT checked line by line against RBI's site - the page says so.
RBI = """2016-12-07 2017-02-08 2017-04-06 2017-06-07 2017-08-02 2017-10-04 2017-12-06
2018-02-07 2018-04-05 2018-06-06 2018-08-01 2018-10-05 2018-12-05
2019-02-07 2019-04-04 2019-06-06 2019-08-07 2019-10-04 2019-12-05
2020-02-06 2020-03-27 2020-05-22 2020-08-06 2020-10-09 2020-12-04
2021-02-05 2021-04-07 2021-06-04 2021-08-06 2021-10-08 2021-12-08
2022-02-10 2022-04-08 2022-05-04 2022-06-08 2022-08-05 2022-09-30 2022-12-07
2023-02-08 2023-04-06 2023-06-08 2023-08-10 2023-10-06 2023-12-08
2024-02-08 2024-04-05 2024-06-07 2024-08-08 2024-10-09 2024-12-06
2025-02-07 2025-04-09 2025-06-06 2025-08-06 2025-10-01 2025-12-05
2026-02-06 2026-04-08 2026-06-05 2026-08-05 2026-10-07 2026-12-04 2027-02-05""".split()
BUDGET = """2017-02-01 2018-02-01 2019-02-01 2019-07-05 2020-02-01 2021-02-01 2022-02-01
2023-02-01 2024-02-01 2024-07-23 2025-02-01 2026-02-01""".split()


def _r(v, n=2):
    return None if v is None else round(v, n)


def main() -> None:
    con = sqlite3.connect(DB)
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='lab_chain'").fetchone():
        print("lab: no history yet - nothing written")
        return
    idx: dict[str, list] = {}
    for t, d, _o, _h, _l, c in con.execute("SELECT ticker, date, open, high, low, close FROM optlab_index ORDER BY date"):
        idx.setdefault(t, []).append((d, c))
    fii = dict(con.execute("SELECT date, long_pct FROM lab_fii"))
    lots = dict(con.execute("SELECT sym, lot FROM lab_lots"))
    dates = [r[0] for r in con.execute("SELECT DISTINCT date FROM lab_chain ORDER BY date")]

    def chg(series):
        return {d: (c / series[i - 1][1] - 1) * 100 for i, (d, c) in enumerate(series) if i and series[i - 1][1]}
    vix = dict(idx.get("^INDIAVIX", []))
    vix_chg = chg(idx.get("^INDIAVIX", []))
    us = idx.get("^GSPC", [])
    us_chg = chg(us)
    us_days = [d for d, _ in us]
    market = {}
    j = -1
    for d in dates:
        while j + 1 < len(us_days) and us_days[j + 1] < d:
            j += 1
        ev = ("R" if d in RBI else "") + ("B" if d in BUDGET else "")
        market[d] = [_r(vix.get(d)), _r(vix_chg.get(d)), fii.get(d), _r(us_chg.get(us_days[j])) if j >= 0 else None, ev]

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    instruments, pcr_nifty = [], {}
    # While the nightly is still filling ten years in (newest first, a few
    # months a night), no instrument has 250 days yet: the bar is then the
    # longest history less a fifth, so the page is never left empty.
    longest = con.execute("SELECT MAX(n) FROM (SELECT COUNT(*) AS n FROM lab_chain GROUP BY sym)").fetchone()[0] or 0
    need = max(1, min(MIN_DAYS, int(longest * 0.8)))
    syms = [r[0] for r in con.execute("SELECT sym FROM lab_chain GROUP BY sym HAVING COUNT(*) >= ? ORDER BY sym", (need,))]
    for sym in syms:
        days = []
        for d, data in con.execute("SELECT date, data FROM lab_chain WHERE sym=? ORDER BY date", (sym,)):
            p = json.loads(data)
            days.append([d, _r(p["u"]), p["f"], p["pcr"], p["e"]])
            if sym == "NIFTY":
                pcr_nifty[d] = p["pcr"]
        index = sym in lib.INDEXES
        (OUT / f"{sym}.json").write_text(
            json.dumps({"sym": sym, "lot": lots.get(sym) or 1, "index": index, "days": days}, separators=(",", ":")), encoding="utf-8")
        instruments.append([sym, "index" if index else "stock", lots.get(sym) or 1, days[0][0], len(days)])
    con.close()
    instruments.sort(key=lambda x: (x[1] != "index", x[0]))
    series = [[d, market[d][0], market[d][2], pcr_nifty.get(d)] for d in dates]
    doc = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "instruments": instruments,
           "market": market, "series": series, "events": {"rbi": [d for d in RBI if d <= dates[-1]], "budget": [d for d in BUDGET if d <= dates[-1]]}}
    (OUT / "index.json").write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    size = sum(f.stat().st_size for f in OUT.iterdir()) // (1024 * 1024)
    print(f"lab: {len(instruments)} instruments ({sum(1 for x in instruments if x[1] == 'index')} indices), "
          f"{dates[0]} to {dates[-1]}, {size} MB")


if __name__ == "__main__":
    main()
