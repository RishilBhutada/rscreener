"""Mutual funds' monthly portfolios: shares of each listed company held by a
fund house, summed across its schemes. No network here (fetch_mf_holdings.py).

Every fund house publishes, monthly (SEBI rule), one workbook - or a zip of
them - with a sheet per scheme listing each holding's ISIN and quantity. The
layouts differ in every other way, so the reader keys on those two columns
only: in each sheet it finds the header row naming an ISIN column and a
quantity column, then sums the quantity of every row whose ISIN is a listed
company's. Debt, cash and foreign rows have other ISINs and fall away.
"""
from __future__ import annotations

import io
import re
import zipfile

ISIN = re.compile(r"^IN[E9][A-Z0-9]{9}$")


def _num(v) -> float | None:
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v or "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def sheets(data: bytes, name: str = ""):
    """Yield (sheet name, rows) from an xlsx, an old xls, or a zip of them."""
    if data[:2] == b"PK" and not name.lower().endswith((".xlsx", ".xlsm")):
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
            members = [n for n in z.namelist() if n.lower().endswith((".xls", ".xlsx", ".xlsm"))]
        except zipfile.BadZipFile:
            members = []
        if members:
            for n in members:
                yield from sheets(z.read(n), n)
            return
    if data[:2] == b"PK":
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        for ws in wb.worksheets:
            yield ws.title, ws.iter_rows(values_only=True)
        wb.close()
    elif data[:4] == b"\xd0\xcf\x11\xe0":
        import xlrd
        book = xlrd.open_workbook(file_contents=data, on_demand=True)
        for i in range(book.nsheets):
            sh = book.sheet_by_index(i)
            yield sh.name, (sh.row_values(r) for r in range(sh.nrows))


def holdings(data: bytes, isins: set[str], name: str = "") -> dict[str, list]:
    """{isin: [shares, value_as_filed, schemes]} for the ISINs in `isins`.
    value is in the file's own unit (usually Rs lakh) and only summed."""
    out: dict[str, list] = {}
    for _, rows in sheets(data, name):
        col_isin = col_qty = col_val = None
        seen: set[str] = set()
        for row in rows:
            cells = list(row)
            if col_isin is None:
                low = [str(c or "").strip().lower() for c in cells]
                i = next((k for k, c in enumerate(low) if c == "isin" or c.startswith("isin")), None)
                q = next((k for k, c in enumerate(low) if c.startswith("quantity") or c in ("qty", "no. of shares", "units")), None)
                if i is not None and q is not None:
                    col_isin, col_qty = i, q
                    col_val = next((k for k, c in enumerate(low) if "market" in c and "value" in c), None)
                continue
            if col_isin >= len(cells):
                continue
            code = str(cells[col_isin] or "").strip().upper()
            if code not in isins or not ISIN.match(code):
                continue
            qty = _num(cells[col_qty]) if col_qty < len(cells) else None
            if not qty or qty <= 0:
                continue
            o = out.setdefault(code, [0.0, 0.0, 0])
            o[0] += qty
            if col_val is not None and col_val < len(cells):
                o[1] += _num(cells[col_val]) or 0.0
            if code not in seen:          # one scheme holding it, however many rows
                o[2] += 1
                seen.add(code)
    return out


def _months_back(month: str, n: int) -> str:
    y, m = int(month[:4]), int(month[5:7]) - n
    while m <= 0:
        y, m = y - 1, m + 12
    return f"{y:04d}-{m:02d}"


def screen_fields(con) -> dict[str, dict]:
    """{symbol: {mf_month, mf_shares, mf_houses, mf_schemes, mf_chg_1m_pct,
    mf_chg_3m_pct}} for the latest month most covered fund houses have filed.

    The change compares the SAME fund houses in both months, so a house whose
    file is late or missing does not read as selling."""
    if not con.execute("SELECT 1 FROM sqlite_master WHERE name='mf_holdings'").fetchone():
        return {}
    by_month: dict[str, set] = {}
    for amc, month in con.execute("SELECT amc, month FROM mf_months"):
        by_month.setdefault(month, set()).add(amc)
    if not by_month:
        return {}
    most = max(len(v) for v in by_month.values())
    month = max(m for m, v in by_month.items() if len(v) >= max(1, most - 1))
    rows: dict[str, dict] = {}
    for m, amc, sym, sh, sc in con.execute(
        "SELECT month, amc, symbol, shares, schemes FROM mf_holdings WHERE month IN (?,?,?)",
        (month, _months_back(month, 1), _months_back(month, 3)),
    ):
        rows.setdefault(sym, {}).setdefault(m, {})[amc] = (sh, sc)
    # Splits and bonuses between the two months: shares held in the earlier
    # month are put on the later month's base, or a 2:1 bonus reads as funds
    # buying twice the stock (BSE read +148% over three months).
    splits: dict[str, list] = {}
    if con.execute("SELECT 1 FROM sqlite_master WHERE name='splits'").fetchone():
        for sym, d, r in con.execute("SELECT symbol, date, ratio FROM splits WHERE ratio > 0"):
            splits.setdefault(sym, []).append((d, float(r)))

    def factor(sym: str, prev_m: str) -> float:
        f = 1.0
        for d, r in splits.get(sym, []):
            if f"{prev_m}-31" < d <= f"{month}-31":
                f *= r
        return f

    out: dict[str, dict] = {}
    for sym, ms in rows.items():
        now = ms.get(month)
        if not now:
            continue
        o = {"mf_month": month, "mf_shares": sum(v[0] for v in now.values()),
             "mf_houses": len(now), "mf_schemes": sum(v[1] for v in now.values())}
        for n, key in ((1, "mf_chg_1m_pct"), (3, "mf_chg_3m_pct")):
            prev_m = _months_back(month, n)
            both = by_month.get(month, set()) & by_month.get(prev_m, set())
            prev = ms.get(prev_m, {})
            a = sum(v[0] for h, v in now.items() if h in both)
            b = sum(v[0] for h, v in prev.items() if h in both) * factor(sym, prev_m)
            if b > 0:
                o[key] = round((a / b - 1) * 100, 1)
            elif a > 0 and both:
                o[key] = None   # newly bought: no base to grow from
        out[sym] = o
    return out
