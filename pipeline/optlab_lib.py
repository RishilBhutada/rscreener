"""Nifty options for the Options lab: parsing NSE's daily F&O files and
choosing which contracts to keep. No network here (fetch_nifty_options.py).

Research only - nothing here places or prepares a trade. The owner's plan
puts F&O after Phase-3; this is a test on history (owner, 15-Nov-2026).

Two file layouts, the same facts:
  old   fo15NOV2016bhav.csv        INSTRUMENT, SYMBOL, EXPIRY_DT, STRIKE_PR, OPTION_TYP,
                                   OPEN, HIGH, LOW, CLOSE, ..., CONTRACTS, ..., TIMESTAMP
  new   BhavCopy_NSE_FO_..._F_0000 FinInstrmTp=IDO, TckrSymb, XpryDt, StrkPric, OptnTp,
        (UDiFF)                    OpnPric, HghPric, LwPric, ClsPric, TtlTradgVol, NewBrdLotQty

A row is (date, expiry, strike, cp, open, high, low, close, volume).
"""
from __future__ import annotations

import csv
import io
import zipfile
from datetime import datetime

KEEP_EXPIRIES = 3     # the nearest three expiries on or after the day
KEEP_POINTS = 800     # strikes within this many index points of the at-the-money one


def _f(s) -> float:
    try:
        return float(str(s).strip() or 0)
    except ValueError:
        return 0.0


def _iso(d: str) -> str:
    d = d.strip()
    for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d-%B-%Y"):
        try:
            return datetime.strptime(d.title() if fmt != "%Y-%m-%d" else d, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    raise ValueError(d)


def parse(zip_bytes: bytes) -> tuple[list[tuple], int | None]:
    """(Nifty option rows, lot size if the file states one) from either layout."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        text = z.read(name).decode("utf-8", "replace")
    rd = csv.DictReader(io.StringIO(text))
    rows: list[tuple] = []
    lot = None
    new = "TckrSymb" in (rd.fieldnames or [])
    for r in rd:
        if new:
            if (r.get("TckrSymb") or "").strip() != "NIFTY" or (r.get("FinInstrmTp") or "").strip() != "IDO":
                continue
            cp = (r.get("OptnTp") or "").strip()
            row = (_iso(r["TradDt"][:10]), _iso(r["XpryDt"][:10]), _f(r["StrkPric"]), cp,
                   _f(r["OpnPric"]), _f(r["HghPric"]), _f(r["LwPric"]), _f(r["ClsPric"]), _f(r["TtlTradgVol"]))
            if lot is None and _f(r.get("NewBrdLotQty")) > 0:
                lot = int(_f(r["NewBrdLotQty"]))
        else:
            if (r.get("SYMBOL") or "").strip() != "NIFTY" or (r.get("INSTRUMENT") or "").strip() != "OPTIDX":
                continue
            cp = (r.get("OPTION_TYP") or "").strip()
            row = (_iso(r["TIMESTAMP"]), _iso(r["EXPIRY_DT"]), _f(r["STRIKE_PR"]), cp,
                   _f(r["OPEN"]), _f(r["HIGH"]), _f(r["LOW"]), _f(r["CLOSE"]), _f(r["CONTRACTS"]))
        if cp in ("CE", "PE"):
            rows.append(row)
    return rows, lot


def forward_atm(rows: list[tuple]) -> float | None:
    """The at-the-money strike of ONE expiry's rows: where the call and the
    put cost most nearly the same (put-call parity puts that at the forward
    price), among strikes both of which traded. Needs no index level, so it
    cannot disagree with the file it was read from."""
    by: dict[float, dict] = {}
    for _, _, k, cp, _, _, _, close, vol in rows:
        if vol > 0 and close > 0:
            by.setdefault(k, {})[cp] = close
    both = [(abs(v["CE"] - v["PE"]), k) for k, v in by.items() if "CE" in v and "PE" in v]
    return min(both)[1] if both else None


def select(rows: list[tuple]) -> list[tuple]:
    """The rows worth keeping from one day's file: the nearest expiries, and
    the strikes around each one's at-the-money strike."""
    if not rows:
        return []
    day = rows[0][0]
    exps = sorted({r[1] for r in rows if r[1] >= day})[:KEEP_EXPIRIES]
    out = []
    for e in exps:
        sub = [r for r in rows if r[1] == e]
        atm = forward_atm(sub)
        if atm is None:
            continue
        out.extend(r for r in sub if abs(r[2] - atm) <= KEEP_POINTS)
    return out
