"""Rscreener - the last quarter of a year that was filed only inside the year.

Owner, 18-Nov-2026 ("fix F1"): the missing-data star showed TCS's Mar-2008 to
Mar-2011 quarters red. Those March quarters were never filed on their own:
the company published audited full-year results instead, and NSE's archive
holds them as an ANNUAL filing. With the year and its first three quarters
on record, the fourth is their difference - the same arithmetic every
analyst does by hand.

Rules
  * Only where NO quarterly row exists for that period: a filed quarter is
    never touched, and a filing that arrives later simply replaces this one
    (fetch_results_history deletes by period before inserting).
  * The year and all three quarters on ONE basis (consolidated or
    standalone) - figures on two bases describe different companies.
  * Flow items (sales, costs, profit, EPS) = year minus the three quarters.
    Stock items (share capital) are the year-end figure itself. Items not on
    all four are left out rather than guessed.
  * Sanity: the worked-out sales must be positive and within 0.25x-4x of the
    three quarters' average, or nothing is written - a units slip in one of
    the four would otherwise print as a real quarter.
  * Every quarter written is logged in derived_quarters with the figures it
    was given, so the page can label it "worked out from the full year" and
    a later real filing is recognised (its figures differ) and kept.

Usage
  python derive_quarters.py                  every company
  python derive_quarters.py --symbols TCS    one or more
"""
from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"

STOCK_ITEMS = {"share_capital", "equity"}      # positions at the date, not flows over the period
NEVER = {"equity"}                            # quarterly rows never carry net worth; left to the annual row
RATIO_LO, RATIO_HI = 0.25, 4.0


def _qkey(iso: str) -> int:
    y, m = int(iso[:4]), int(iso[5:7])
    return y * 4 + (m - 1) // 3


def _qend(k: int) -> str:
    y, q = divmod(k, 4)
    return f"{y}-{['03-31', '06-30', '09-30', '12-31'][q]}"


def _qstart(k: int) -> str:
    y, q = divmod(k, 4)
    return f"{y}-{['01', '04', '07', '10'][q]}-01"


def plan(con: sqlite3.Connection, symbols: list[str] | None = None) -> list[dict]:
    """The quarters that can be worked out, with their items - written by apply()."""
    where, args = "", []
    if symbols:
        where = f" AND symbol IN ({','.join('?' * len(symbols))})"
        args = list(symbols)
    rows: dict[tuple, dict] = {}
    for sym, basis, ptype, pe, item, val in con.execute(
            "SELECT symbol, basis, period_type, period_end, item, value FROM results_history "
            f"WHERE period_type IN ('quarterly','annual'){where}", args):
        if val is None:
            continue
        rows.setdefault((sym, ptype, pe), {"basis": basis, "items": {}})["items"][item] = float(val)
    by_sym: dict[str, dict] = {}
    for (sym, ptype, pe), slot in rows.items():
        by_sym.setdefault(sym, {"quarterly": {}, "annual": {}})[ptype][pe] = slot
    out = []
    for sym, d in sorted(by_sym.items()):
        qs = d["quarterly"]
        for ye, ann in sorted(d["annual"].items()):
            if ye in qs:
                continue                                   # the quarter is on record
            k = _qkey(ye)
            if _qend(k) != ye:
                continue                                   # a year not ending on a quarter end
            three = [qs.get(_qend(k - j)) for j in (3, 2, 1)]
            if any(t is None for t in three):
                continue
            if len({ann["basis"], *(t["basis"] for t in three)}) > 1:
                continue
            items = {}
            for it, v in ann["items"].items():
                if it in NEVER:
                    continue
                if it in STOCK_ITEMS:
                    items[it] = v
                elif all(it in t["items"] for t in three):
                    items[it] = v - sum(t["items"][it] for t in three)
            rev, prev = items.get("revenue"), [t["items"].get("revenue") for t in three]
            if rev is None or rev <= 0 or any(p is None or p <= 0 for p in prev):
                continue
            avg = sum(prev) / 3
            if not (RATIO_LO <= rev / avg <= RATIO_HI):
                continue
            # A bonus or split inside the year (TCS, Jun-2009) puts the year's
            # EPS and its quarters' on different share counts: their difference
            # is no quarter's EPS. Left out - the chart then divides the profit
            # by the share count, as it does for any quarter without an EPS.
            caps = [t["items"].get("share_capital") for t in three] + [ann["items"].get("share_capital")]
            if "eps" in items and (None in caps or max(caps) > 1.01 * min(caps)):
                del items["eps"]
            out.append({"symbol": sym, "basis": ann["basis"], "period_start": _qstart(k), "period_end": ye,
                        "items": items})
    return out


def ensure(con: sqlite3.Connection) -> None:
    con.execute("CREATE TABLE IF NOT EXISTS derived_quarters (symbol TEXT, period_end TEXT, basis TEXT, "
                "revenue REAL, pat REAL, derived_at TEXT, PRIMARY KEY (symbol, period_end))")


def forget_replaced(con: sqlite3.Connection) -> int:
    """Drop the log entry of a worked-out quarter that a real filing has since replaced."""
    ensure(con)
    gone = []
    for sym, pe, rev, pat in con.execute("SELECT symbol, period_end, revenue, pat FROM derived_quarters").fetchall():
        now = dict(con.execute("SELECT item, value FROM results_history WHERE symbol=? AND period_type='quarterly' "
                               "AND period_end=? AND item IN ('revenue','pat')", (sym, pe)).fetchall())
        same = now and abs((now.get("revenue") or 0) - (rev or 0)) < 1 and abs((now.get("pat") or 0) - (pat or 0)) < 1
        if not same:
            gone.append((sym, pe))
    con.executemany("DELETE FROM derived_quarters WHERE symbol=? AND period_end=?", gone)
    return len(gone)


def apply(con: sqlite3.Connection, todo: list[dict]) -> int:
    ensure(con)
    at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    for q in todo:
        con.executemany("INSERT INTO results_history (symbol, basis, period_type, period_start, period_end, item, value) "
                        "VALUES (?,?,?,?,?,?,?)",
                        [(q["symbol"], q["basis"], "quarterly", q["period_start"], q["period_end"], k, v)
                         for k, v in q["items"].items()])
        con.execute("INSERT OR REPLACE INTO derived_quarters VALUES (?,?,?,?,?,?)",
                    (q["symbol"], q["period_end"], q["basis"], q["items"].get("revenue"), q["items"].get("pat"), at))
    con.commit()
    return len(todo)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    syms = [s.strip().upper() for s in a.symbols.split(",") if s.strip()] or None
    dropped = forget_replaced(con)
    todo = plan(con, syms)
    print(f"  {len(todo)} quarters can be worked out from full-year results "
          f"across {len({q['symbol'] for q in todo})} companies; {dropped} earlier ones since replaced by a filing")
    for q in todo[:8]:
        print(f"    {q['symbol']} {q['period_end']} {q['basis']}: revenue {q['items']['revenue'] / 1e7:,.1f} Cr")
    if not a.dry_run:
        apply(con, todo)
    con.commit()


if __name__ == "__main__":
    main()
