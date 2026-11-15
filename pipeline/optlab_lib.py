"""Derivatives for the Lab: parsing the exchanges' daily F&O files and packing
what a backtest needs. No network here (fetch_lab.py).

Research only - nothing here places or prepares a trade. The owner's plan
puts F&O after Phase-3; this is a test on history (owner, 15-Nov-2026;
widened to more instruments and strategies 16-Nov-2026).

Three file layouts, the same facts:
  NSE old   fo15NOV2016bhav.csv         INSTRUMENT (OPTIDX/OPTSTK/FUTIDX/FUTSTK), SYMBOL, ...
  NSE new   BhavCopy_NSE_FO_..._F_0000  FinInstrmTp (IDO/STO/IDF/STF), TckrSymb, ...
  BSE new   BhavCopy_BSE_FO_..._F_0000  the same columns (Sensex)

One packed record per instrument per day (lab_chain.data, JSON):
  {"u": underlying close or null,
   "f": [[expiry, open, close], ...]            the nearest futures
   "pcr": put open interest / call open interest, every strike and expiry
   "e": [[expiry, lowest strike, step, call open[], call close[],
          put open[], put close[]], ...]}       strikes around at-the-money
A price is null where the contract did not trade that day: an untraded
contract's "close" in the file is carried or theoretical, not a price
anyone could deal at.
"""
from __future__ import annotations

import csv
import io
import zipfile
from datetime import datetime

INDEXES = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"}
SPAN_INDEX, SPAN_STOCK = 12, 3      # strikes kept each side of at-the-money
EXP_INDEX, EXP_STOCK = 3, 2         # nearest expiries kept
FUTS = 3


def _f(s) -> float:
    try:
        return float(str(s).strip() or 0)
    except ValueError:
        return 0.0


def _iso(d: str) -> str:
    d = d.strip()
    if len(d) >= 10 and d[4] == "-":
        return d[:10]
    return datetime.strptime(d.title(), "%d-%b-%Y").strftime("%Y-%m-%d")


def read_csv(body: bytes) -> str:
    """The CSV text of a file that is either a zip of one CSV or the CSV itself."""
    if body[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(body)) as z:
            name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
            return z.read(name).decode("utf-8", "replace")
    return body.decode("utf-8", "replace")


def parse(text: str) -> tuple[str | None, dict[str, dict], dict[str, int]]:
    """(trade date, {symbol: {"opt": [...], "fut": [...], "und": x}}, {symbol: lot}).
    opt row: (expiry, strike, cp, open, close, volume, oi); fut row: (expiry, open, close, volume)."""
    rd = csv.DictReader(io.StringIO(text))
    new = "TckrSymb" in (rd.fieldnames or [])
    day = None
    out: dict[str, dict] = {}
    lots: dict[str, int] = {}
    for r in rd:
        if new:
            tp = (r.get("FinInstrmTp") or "").strip()
            sym = (r.get("TckrSymb") or "").strip()
            if tp not in ("IDO", "STO", "IDF", "STF") or not sym:
                continue
            if tp[0] == "I" and sym not in INDEXES:
                continue
            day = day or _iso(r["TradDt"])
            s = out.setdefault(sym, {"opt": [], "fut": [], "und": None})
            exp = _iso(r["XpryDt"])
            o, c, v = _f(r["OpnPric"]), _f(r["ClsPric"]), _f(r["TtlTradgVol"])
            if tp[2] == "O":
                cp = (r.get("OptnTp") or "").strip()
                if cp in ("CE", "PE"):
                    s["opt"].append((exp, _f(r["StrkPric"]), cp, o, c, v, _f(r.get("OpnIntrst"))))
            else:
                s["fut"].append((exp, o, c, v))
            if s["und"] is None and _f(r.get("UndrlygPric")) > 0:
                s["und"] = _f(r["UndrlygPric"])
            if sym not in lots and _f(r.get("NewBrdLotQty")) > 0:
                lots[sym] = int(_f(r["NewBrdLotQty"]))
        else:
            tp = (r.get("INSTRUMENT") or "").strip()
            sym = (r.get("SYMBOL") or "").strip()
            if tp not in ("OPTIDX", "OPTSTK", "FUTIDX", "FUTSTK") or not sym:
                continue
            if tp.endswith("IDX") and sym not in INDEXES:
                continue
            day = day or _iso(r["TIMESTAMP"])
            s = out.setdefault(sym, {"opt": [], "fut": [], "und": None})
            exp = _iso(r["EXPIRY_DT"])
            o, c, v = _f(r["OPEN"]), _f(r["CLOSE"]), _f(r["CONTRACTS"])
            if tp.startswith("OPT"):
                cp = (r.get("OPTION_TYP") or "").strip()
                if cp in ("CE", "PE"):
                    s["opt"].append((exp, _f(r["STRIKE_PR"]), cp, o, c, v, _f(r.get("OPEN_INT"))))
            else:
                s["fut"].append((exp, o, c, v))
    return day, out, lots


def forward_atm(opts: list[tuple]) -> float | None:
    """The at-the-money strike of ONE expiry's option rows: where the call and
    the put cost most nearly the same (put-call parity puts that at the
    forward price), among strikes both of which traded. Needs no index level,
    so it cannot disagree with the file it was read from."""
    by: dict[float, dict] = {}
    for _e, k, cp, _o, c, v, _oi in opts:
        if v > 0 and c > 0:
            by.setdefault(k, {})[cp] = c
    both = [(abs(v["CE"] - v["PE"]), k) for k, v in by.items() if "CE" in v and "PE" in v]
    return min(both)[1] if both else None


def _px(o: float, c: float, v: float) -> tuple[float | None, float | None]:
    return (round(o, 2) if (v > 0 and o > 0) else None, round(c, 2) if (v > 0 and c > 0) else None)


def pack(sym: str, day: str, rec: dict) -> dict | None:
    """One instrument's day, packed (see the module note). None if nothing usable."""
    index = sym in INDEXES
    span, n_exp = (SPAN_INDEX, EXP_INDEX) if index else (SPAN_STOCK, EXP_STOCK)
    futs = sorted((e, *_px(o, c, v)) for e, o, c, v in rec["fut"] if e >= day)[:FUTS]
    calls = sum(x[6] for x in rec["opt"] if x[2] == "CE")
    puts = sum(x[6] for x in rec["opt"] if x[2] == "PE")
    exps = []
    for e in sorted({x[0] for x in rec["opt"] if x[0] >= day})[:n_exp]:
        sub = [x for x in rec["opt"] if x[0] == e]
        atm = forward_atm(sub)
        if atm is None:
            continue
        ks = sorted({x[1] for x in sub})
        i = ks.index(atm)
        gaps = [b - a for a, b in zip(ks[max(0, i - 4):i + 5], ks[max(0, i - 4) + 1:i + 5]) if b > a]
        step = min(gaps) if gaps else 0
        if step <= 0:
            continue
        px = {(k, cp): _px(o, c, v) for _e, k, cp, o, c, v, _oi in sub}
        grid = [atm + j * step for j in range(-span, span + 1)]
        none = (None, None)
        exps.append([e, grid[0], step,
                     [px.get((k, "CE"), none)[0] for k in grid], [px.get((k, "CE"), none)[1] for k in grid],
                     [px.get((k, "PE"), none)[0] for k in grid], [px.get((k, "PE"), none)[1] for k in grid]])
    if not exps and not futs:
        return None
    return {"u": rec["und"], "f": [list(x) for x in futs], "pcr": round(puts / calls, 3) if calls > 0 else None, "e": exps}


def fii_long_pct(text: str) -> tuple[str, float] | None:
    """(date, FIIs' index futures long as a % of their long + short) from
    NSE's participant-wise open interest file."""
    import re
    lines = text.splitlines()
    # "Nov 15 2019", "June 01, 2017", "Jan 03,2022" - the title's date has
    # been written three ways over the years.
    m = re.search(r"as on\s+([A-Za-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})", lines[0] if lines else "")
    if not m:
        return None
    day = datetime.strptime(f"{m.group(2)} {m.group(1)[:3]} {m.group(3)}", "%d %b %Y").strftime("%Y-%m-%d")
    for row in csv.reader(io.StringIO("\n".join(lines[2:]))):
        if row and row[0].strip() == "FII" and len(row) >= 3:
            lo, sh = _f(row[1]), _f(row[2])
            if lo + sh > 0:
                return day, round(lo / (lo + sh) * 100, 1)
    return None
