"""Rscreener - web/public/optlab.json for the Options lab (research only).

One record per trading day D that has a next trading day D+1 in the data:

  [D, D+1, nifty close D, nifty open D+1, nifty close D+1, India VIX close D,
   [ per expiry (the two nearest that are still alive on D+1):
     [expiry, at-the-money strike, strike step,
      call close D[], put close D[],          # strikes ATM-8 .. ATM+8 steps
      call open D+1[], put open D+1[],
      call close D+1[], put close D+1[]] ]]

A price is null where that contract did not trade that day - an untraded
contract's "close" in the exchange file is a carried or theoretical figure,
not a price anyone could have dealt at. The backtest itself runs in the
browser (web/src/lib/optlab.ts), so every parameter can be changed there.

Usage:  python pipeline/export_optlab_json.py
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import optlab_lib as lib

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
OUT = ROOT / "web" / "public" / "optlab.json"
SPAN = 8        # strikes each side of at-the-money
EXPIRIES = 2


def _r(v):
    return None if v is None else round(v, 2)


def main() -> None:
    con = sqlite3.connect(DB)
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='nifty_opt'").fetchone():
        print("optlab: no option history yet - nothing written")
        return
    idx: dict[str, dict] = {}
    for t, d, o, _h, _l, c in con.execute("SELECT ticker, date, open, high, low, close FROM optlab_index"):
        idx.setdefault(t, {})[d] = (o, c)
    days = [r[0] for r in con.execute("SELECT date FROM optlab_days WHERE status='ok' ORDER BY date")]
    lot = (con.execute("SELECT lot FROM optlab_days WHERE lot IS NOT NULL ORDER BY date DESC LIMIT 1").fetchone() or [None])[0]
    by_day: dict[str, list] = {}
    for row in con.execute("SELECT date, expiry, strike, cp, open, high, low, close, volume FROM nifty_opt"):
        by_day.setdefault(row[0], []).append(row)
    con.close()

    out = []
    for d0, d1 in zip(days, days[1:]):
        # More than five calendar days apart is a hole in the data, not a
        # weekend or a holiday: no overnight trade spans it.
        if (datetime.fromisoformat(d1) - datetime.fromisoformat(d0)).days > 5:
            continue
        r0, r1 = by_day.get(d0, []), by_day.get(d1, [])
        px1 = {(e, k, cp): (o if (v > 0 and o > 0) else None, c if (v > 0 and c > 0) else None)
               for _, e, k, cp, o, _h, _l, c, v in r1}
        exps = []
        for e in sorted({r[1] for r in r0 if r[1] >= d1})[:EXPIRIES]:
            sub = [r for r in r0 if r[1] == e]
            atm = lib.forward_atm(sub)
            if atm is None:
                continue
            ks = sorted({r[2] for r in sub})
            near = [b - a for a, b in zip(ks, ks[1:]) if abs(a - atm) <= 300 and b - a > 0]
            step = min(near) if near else 50.0
            px0 = {(k, cp): (c if (v > 0 and c > 0) else None) for _, _, k, cp, _o, _h, _l, c, v in sub}
            strikes = [atm + i * step for i in range(-SPAN, SPAN + 1)]
            exps.append([e, atm, step,
                         [_r(px0.get((k, "CE"))) for k in strikes], [_r(px0.get((k, "PE"))) for k in strikes],
                         [_r(px1.get((e, k, "CE"), (None, None))[0]) for k in strikes],
                         [_r(px1.get((e, k, "PE"), (None, None))[0]) for k in strikes],
                         [_r(px1.get((e, k, "CE"), (None, None))[1]) for k in strikes],
                         [_r(px1.get((e, k, "PE"), (None, None))[1]) for k in strikes]])
        if not exps:
            continue
        n0, n1 = idx.get("^NSEI", {}).get(d0), idx.get("^NSEI", {}).get(d1)
        vix = idx.get("^INDIAVIX", {}).get(d0)
        out.append([d0, d1, _r(n0[1]) if n0 else None, _r(n1[0]) if n1 else None, _r(n1[1]) if n1 else None,
                    _r(vix[1]) if vix else None, exps])
    doc = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "lot": lot or 65, "span": SPAN, "days": out}
    OUT.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    print(f"optlab.json: {len(out)} nights, {out[0][0] if out else '-'} to {out[-1][0] if out else '-'}, "
          f"{OUT.stat().st_size // 1024} KB, lot {doc['lot']}")


if __name__ == "__main__":
    main()
