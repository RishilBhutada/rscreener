"""Rscreener - the results history a company filed on BSE before NSE.

Owner, 17-Nov-2026: Hindustan Foods showed a P/E only from May 2024 and EPS
only from the June 2023 quarter, though its prices go back to 2019. The
company listed on NSE on 6-Jun-2023; every result before that was filed on
BSE alone, and Rscreener read results from NSE alone. The same holds for any
company that came to NSE late, and for one whose NSE symbol changed (BSE's
scrip code does not).

BSE's results archive (Result_Arch_ng) lists every results filing a company
has made, with its XBRL - the same structured document NSE serves, which
fetch_results_history.parse_xbrl reads unchanged. Standalone XBRL from about
2016, consolidated from about 2019.

Rules
  * Only periods NOT already stored are taken: NSE's figures are never
    overwritten, so this only ever adds history.
  * One basis per period, consolidated first - the main table's own rule.
  * A revised filing wins over the original of the same period.
  * The units check (filing_checks, via units_wrong) applies as for NSE.
  * The filing time goes to filing_dates (INSERT OR IGNORE: an NSE date
    already there is kept).

The NSE symbol is matched to its BSE scrip code by ISIN from BSE's own scrip
list. The universe table is left as it is: other jobs read its BSE_CODE as
"listed on BSE only".

Usage
  python fetch_bse_results.py --symbols HNDFDS          one company
  python fetch_bse_results.py --scope gaps --max-minutes 20
      every NSE company whose stored quarters start after 2016-06 or that has
      none, oldest-checked first
  python fetch_bse_results.py --scope bse --max-minutes 25
      the companies listed on BSE only (owner, 17-Nov-2026: "add BSE results
      for BSE-only companies too") - their whole results history comes from
      here, as no NSE filing exists for them. Those with no results stored
      come first.
"""
from __future__ import annotations

import argparse
import csv
import io
import sqlite3
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

import budget
import fetch_results_history as frh
from fetch_bhavcopy import BSE_CM
from fetch_universe import BSE_HEADERS
from fetch_bse_documents import HEADERS as BSE_API_HEADERS   # with Origin, as the BSE site sends
from filing_checks import AGREE, WINDOW, is_unit_step

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
ARCH = "https://api.bseindia.com/BseIndiaAPI/api/Result_Arch_ng/w?scrip_cd={code}"
SITE = "https://www.bseindia.com"
MON = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}
XBRL_FROM = "2016-06-30"     # BSE XBRL starts about here; earlier stored history needs nothing from BSE



def get(s: requests.Session, url: str, tries: int = 3) -> requests.Response:
    """GET with backoff, with BSE's headers (fetch_results_history.get_retry
    always sends NSE's, which BSE refuses)."""
    delay, last = 1.5, None
    for attempt in range(tries):
        try:
            r = s.get(url, timeout=30)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            last = e
            if attempt < tries - 1:
                time.sleep(delay)
                delay *= 2
    raise last  # type: ignore[misc]


def month_end(y: int, m: int) -> date:
    return (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1))


def parse_quarter(q: str, kind: str) -> tuple[str, str, str, str] | None:
    """BSE's "Consolidated-Mar-22;MQ2021-2022;113.00;c" with Fld_QuarterName
    ("Quarter" / "Year") -> (basis, period_type, period_start, period_end).
    Half years and anything unreadable -> None."""
    if kind not in ("Quarter", "Year") or not q:
        return None
    head = q.split(";")[0]
    try:
        basis_s, mon, yy = head.split("-")
    except ValueError:
        return None
    basis = "consolidated" if basis_s.strip().lower().startswith("cons") else "standalone"
    if mon not in MON or not yy.isdigit():
        return None
    y = int(yy) + (2000 if int(yy) < 70 else 1900)
    end = month_end(y, MON[mon])
    back = 3 if kind == "Quarter" else 12
    sm, sy = MON[mon] - back + 1, y
    while sm <= 0:
        sm += 12
        sy -= 1
    start = date(sy, sm, 1)
    return basis, ("quarterly" if kind == "Quarter" else "annual"), start.isoformat(), end.isoformat()


def pick(rows: list[dict]) -> list[dict]:
    """One filing per (period_type, period_end): consolidated over standalone,
    then a revised filing over the original. Newest first. Each carries
    `alts`, the best filing on EACH basis, for a gap inside a history that
    must be filled on its neighbours' basis (inside_basis)."""
    best: dict[tuple[str, str], dict] = {}
    per_basis: dict[tuple[str, str, str], dict] = {}
    first: dict[tuple[str, str], str] = {}     # the earliest filing day: the results date
    for r in rows:
        p = parse_quarter(r.get("Quarter") or "", r.get("Fld_QuarterName") or "")
        if not p:
            continue
        basis, ptype, ps, pe = p
        link = r.get("conso_xbrl_link") if basis == "consolidated" else r.get("stand_xbrl_link")
        if not link:
            continue
        cand = {"basis": basis, "ptype": ptype, "ps": ps, "pe": pe, "xbrl": SITE + link,
                "revised": (r.get("Status") or "").lower().startswith("revis"),
                "filed": (r.get("Filing_Date_Time") or "")[:10] or None,
                "at": r.get("Revised_Date_Time") or r.get("Filing_Date_Time") or ""}
        key = (ptype, pe)
        if cand["filed"] and (key not in first or cand["filed"] < first[key]):
            first[key] = cand["filed"]
        cur = best.get(key)
        rank = lambda c: (c["basis"] == "consolidated", c["revised"], c["at"])  # noqa: E731
        if cur is None or rank(cand) > rank(cur):
            best[key] = cand
        bkey = (ptype, pe, basis)
        if bkey not in per_basis or rank(cand) > rank(per_basis[bkey]):
            per_basis[bkey] = cand
    for key, c in best.items():
        c["filed"] = first.get(key)
        c["alts"] = {b: dict(per_basis[(key[0], key[1], b)], filed=first.get(key))
                     for b in ("consolidated", "standalone") if (key[0], key[1], b) in per_basis}
    return sorted(best.values(), key=lambda c: c["pe"], reverse=True)


def inside_basis(stored: list[tuple[str, str]], period_end: str) -> str | None | bool:
    """For a quarter between stored quarters: the basis it must be filled on -
    that of the quarters either side - or False when those two differ (no
    basis would join them). None when the quarter is not inside the history
    (before the first stored quarter or after the last): no neighbour to match.

    Owner, 18-Nov-2026 ("fix F2"): INFY's and TCS's Mar/Jun-2018 holes sit
    between consolidated quarters; a standalone BSE filing would put a smaller
    company's figures in the middle of the group's."""
    before = [b for pe, b in stored if pe < period_end]
    after = [b for pe, b in stored if pe > period_end]
    if not before or not after:
        return None
    return before[-1] if before[-1] == after[0] else False


def holes_after(periods: list[str], since: str = "2016-06-30") -> list[str]:
    """Quarter ends missing between stored quarters, from `since` on."""
    def k(iso: str) -> int:
        return int(iso[:4]) * 4 + (int(iso[5:7]) - 1) // 3
    keys = sorted({k(p) for p in periods})
    out = []
    for a_, b_ in zip(keys, keys[1:]):
        for x in range(a_ + 1, b_):
            y, q = divmod(x, 4)
            pe = f"{y}-{['03-31', '06-30', '09-30', '12-31'][q]}"
            if pe >= since:
                out.append(pe)
    return out


def oldest_units_wrong(con: sqlite3.Connection, sym: str, ptype: str, period_end: str,
                       revenue: float | None) -> bool:
    """A filing OLDER than every stored period whose revenue is a units step
    (100x, 1,000x, 100,000x) ABOVE the next three, which agree with each other.

    filing_checks.unit_outliers never judges the oldest period, on purpose: a
    business can start small (Reliance Power's first year). Backfilling from
    BSE makes the oldest period exactly where each new filing lands, though -
    PB Global's Dec-2018 quarter came in at Rs 1.2 lakh crore against about
    Rs 150 crore after it (17-Nov-2026 test). So the edge is judged here, and
    only one way: the oldest value far ABOVE a steady run is refused. A small
    start is never touched."""
    if not revenue or revenue <= 0:
        return False
    after = [v for (v,) in con.execute(
        "SELECT MAX(value) FROM results_history WHERE symbol=? AND period_type=? AND item='revenue' "
        "AND period_end>? GROUP BY period_end ORDER BY period_end LIMIT ?", (sym, ptype, period_end, WINDOW))]
    older = con.execute("SELECT 1 FROM results_history WHERE symbol=? AND period_type=? AND period_end<? LIMIT 1",
                        (sym, ptype, period_end)).fetchone()
    after = [v for v in after if v and v > 0]
    if older or len(after) < WINDOW:
        return False
    m = sorted(after)[len(after) // 2]
    if not all(1 / AGREE <= v / m <= AGREE for v in after):
        return False
    return revenue > m and is_unit_step(revenue / m)


def bse_codes(con: sqlite3.Connection) -> dict[str, str]:
    """{NSE symbol: BSE scrip code}, matched by ISIN. BSE-only companies
    carry theirs in the universe already. The ISIN-to-code pairs come from
    BSE's daily price file (bhavcopy), which every active scrip is in; BSE's
    scrip-list API refuses scripted requests at times (403), and a refusal is
    not worked around."""
    out = {s: str(c) for s, c in con.execute(
        "SELECT SYMBOL, BSE_CODE FROM universe WHERE BSE_CODE IS NOT NULL AND BSE_CODE != ''")}
    by_isin: dict[str, str] = {}
    for back in range(0, 8):                      # the latest trading day's file
        d = date.today() - timedelta(days=back)
        try:
            r = requests.get(BSE_CM.format(ymd=d.strftime("%Y%m%d")), headers=BSE_HEADERS, timeout=60)
        except requests.RequestException:
            continue
        if r.status_code != 200 or r.content[:200].lstrip().lower().startswith((b"<!doctype", b"<html")):
            continue
        for x in csv.DictReader(io.StringIO(r.content.decode("utf-8-sig"))):
            if x.get("ISIN") and x.get("FinInstrmId"):
                by_isin[x["ISIN"]] = x["FinInstrmId"]
        break
    if not by_isin:
        print("  BSE bhavcopy unavailable - only BSE-only companies' codes are known")
    for sym, isin in con.execute("SELECT SYMBOL, \"ISIN NUMBER\" FROM universe WHERE EXCHANGE = 'NSE'"):
        if isin in by_isin:
            out[sym] = by_isin[isin]
    return out


def remember_codes(con: sqlite3.Connection, codes: dict[str, str]) -> None:
    """Keep the NSE-to-BSE match for the page's data status (data_status.py):
    whether a company is on BSE at all decides if "NSE has no results for it"
    means "BSE's copy is not read yet" or "there is nowhere else to read it".
    A day without the bhavcopy adds nothing and removes nothing."""
    con.execute("CREATE TABLE IF NOT EXISTS bse_code_map (symbol TEXT PRIMARY KEY, bse_code TEXT, seen_at TEXT)")
    seen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    con.executemany("INSERT OR REPLACE INTO bse_code_map VALUES (?,?,?)",
                    [(s_, str(c_), seen) for s_, c_ in codes.items()])
    con.commit()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", default="", help="comma list; overrides --scope")
    ap.add_argument("--scope", choices=["gaps", "bse"], default="gaps")
    ap.add_argument("--max-age-days", type=float, default=90, help="check a company again after this long")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--max-minutes", type=float, default=0)
    ap.add_argument("--sleep", type=float, default=0.3)
    a = ap.parse_args()

    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    con.execute("CREATE TABLE IF NOT EXISTS bse_results_log (symbol TEXT PRIMARY KEY, fetched_at TEXT, error TEXT, n_periods INTEGER)")
    con.execute("CREATE TABLE IF NOT EXISTS filing_dates (symbol TEXT, period_end TEXT, announced_on TEXT, PRIMARY KEY (symbol, period_end))")
    codes = bse_codes(con)
    remember_codes(con, codes)

    if a.symbols:
        due = [s.strip().upper() for s in a.symbols.split(",") if s.strip()]
    else:
        first = dict(con.execute("SELECT symbol, MIN(period_end) FROM results_history WHERE period_type='quarterly' GROUP BY symbol"))
        if a.scope == "bse":
            # Every BSE-only company: NSE has nothing for them, so any period
            # BSE holds is new. The 90-day recheck picks up each new quarter.
            gaps = [s for (s,) in con.execute("SELECT SYMBOL FROM universe WHERE EXCHANGE='BSE'") if s in codes]
        else:
            nse = [s for (s,) in con.execute("SELECT SYMBOL FROM universe WHERE EXCHANGE='NSE'")]
            # ...and, since 18-Nov-2026 (owner, "fix F2"), any whose history has a
            # hole from mid-2016 on, where BSE's XBRL exists (INFY, Mar/Jun-2018).
            qs: dict[str, list[str]] = {}
            for s_, pe_ in con.execute("SELECT DISTINCT symbol, period_end FROM results_history "
                                       "WHERE period_type='quarterly' ORDER BY period_end"):
                qs.setdefault(s_, []).append(pe_)
            gaps = [s for s in nse if s in codes and (first.get(s) is None or first[s] > XBRL_FROM
                                                      or holes_after(qs.get(s, []), XBRL_FROM))]
        log = dict(con.execute("SELECT symbol, fetched_at FROM bse_results_log"))
        cutoff = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=a.max_age_days)).strftime("%Y-%m-%d %H:%M:%S")
        # Never-checked first; among them the widest gap first - prices
        # starting furthest before the first stored quarter is where a chart
        # is most visibly missing its P/E and EPS (Hindustan Foods: 3.8 years).
        px0 = dict(con.execute("SELECT symbol, MIN(date) FROM prices GROUP BY symbol"))

        def gap(s_: str) -> float:
            a_, b_ = px0.get(s_), first.get(s_) or datetime.now().strftime("%Y-%m-%d")
            return 0.0 if not a_ else (date.fromisoformat(b_[:10]) - date.fromisoformat(a_[:10])).days
        due = sorted((s for s in gaps if log.get(s, "") < cutoff), key=lambda s: (log.get(s) or "", -gap(s)))
        print(f"  {len(gaps)} " + ("BSE-only companies" if a.scope == "bse" else
              f"NSE companies with history starting after {XBRL_FROM} (or none) and a BSE listing") + f"; {len(due)} due")
    if a.limit:
        due = due[: a.limit]

    s = requests.Session()
    s.headers.update(BSE_API_HEADERS)
    started = time.monotonic()
    added_total = 0
    for i, sym in enumerate(due, 1):
        if budget.stop(i - 1, len(due)):
            break
        if a.max_minutes and (time.monotonic() - started) / 60 >= a.max_minutes:
            print(f"  time budget reached after {i - 1} of {len(due)} companies; the rest next run")
            break
        code = codes.get(sym)
        if not code:
            print(f"[{i}/{len(due)}] {sym}: no BSE listing found")
            continue
        added = unread = refused = mismatch = 0
        err = None
        try:
            rows = get(s, ARCH.format(code=code)).json().get("Table") or []
            have = {(pt, pe) for pt, pe in con.execute(
                "SELECT DISTINCT period_type, period_end FROM results_history WHERE symbol=?", (sym,))}
            stored = con.execute("SELECT period_end, MAX(basis) FROM results_history WHERE symbol=? "
                                 "AND period_type='quarterly' GROUP BY period_end ORDER BY period_end", (sym,)).fetchall()
            for f in pick(rows):
                if (f["ptype"], f["pe"]) in have:
                    continue
                if f["ptype"] == "quarterly":
                    want = inside_basis(stored, f["pe"])
                    if want is False or (want and want not in f["alts"]):
                        mismatch += 1           # no filing on the basis either side of it
                        continue
                    if want:
                        f = f["alts"][want]
                try:
                    facts = frh.parse_xbrl(get(s, f["xbrl"]).content, f["ptype"])
                except Exception:  # noqa: BLE001 - one unreadable filing costs that filing
                    facts = {}
                if not facts:
                    unread += 1
                    continue
                if (frh.units_wrong(con, "results_history", sym, f["ptype"], f["pe"], facts.get("revenue"))
                        or oldest_units_wrong(con, sym, f["ptype"], f["pe"], facts.get("revenue"))):
                    refused += 1
                    continue
                frh.db_retry(lambda: con.executemany(
                    "INSERT INTO results_history VALUES (?,?,?,?,?,?,?)",
                    [(sym, f["basis"], f["ptype"], f["ps"], f["pe"], k, v) for k, v in facts.items()]))
                if f["ptype"] == "quarterly" and f["filed"]:
                    frh.db_retry(lambda: con.execute("INSERT OR IGNORE INTO filing_dates VALUES (?,?,?)", (sym, f["pe"], f["filed"])))
                added += 1
                time.sleep(a.sleep)
        except Exception as e:  # noqa: BLE001 - one company must not stop the rest
            err = str(e)[:200]
        frh.db_retry(lambda: con.execute("INSERT OR REPLACE INTO bse_results_log VALUES (?,?,?,?)",
                                         (sym, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), err, added)))
        frh.db_retry(con.commit)
        added_total += added
        print(f"[{i}/{len(due)}] {sym} (BSE {code}): {added} periods added"
              + (f", {unread} unreadable" if unread else "") + (f", {refused} refused (units)" if refused else "")
              + (f", {mismatch} left out (not on the basis either side)" if mismatch else "")
              + (f" - ERROR {err}" if err else ""), flush=True)
        time.sleep(a.sleep)
    con.close()
    print(f"done: {added_total} periods added from BSE")


if __name__ == "__main__":
    main()
