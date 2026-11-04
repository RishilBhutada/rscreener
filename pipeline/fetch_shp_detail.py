"""Rscreener - who owns the public part: FIIs, DIIs, mutual funds, insurers.

fetch_shareholding.py stores promoter / public / employee trusts from NSE's
summary. The split of "public" lives only inside each quarter's shareholding
XBRL. One summary call per company lists the quarters and their files; the
newest missing ones are read, a few a company per run, so the history fills
in over the nights without a night of downloads (TCS's file is 1.25 MB, a
small company's ~140 KB).

Two formats. From about 2023 SEBI's pattern states "Institutions (Domestic)"
and "Institutions (Foreign)" separately, and those are stored as DII and FII.
The older one has a single "Institutions" total: for those quarters only
mutual funds, insurers and FPIs are stored and DII/FII stay empty - an
estimate of the split would be a guess at which old line belongs where.
Checked on TCS, 30-Jun-2026: promoters 71.77, DII 13.47 (mutual funds 5.68,
insurance 6.71), FII 9.06 (FPI 8.23 + 0.84), others 5.69 - 99.99%.

Table shareholding_detail(symbol, date, dii, fii, mf, insurance, fpi, others,
gov, n_holders), percent of total shares; gov = central and state governments,
n_holders = number of shareholders. Table shp_holders(symbol, date, category,
name, pct): every holder the filing names - promoters, and anyone else holding
more than 1% - with the group it is filed under (screener.in's "+" under each
row). Checked on RELIANCE, 30-Sep-2026: government 0.10%, 50,72,456
shareholders (screener.in: 50,72,457).

Usage:
  python fetch_shp_detail.py --symbols @data/nse_symbols.txt --limit 300 --per-company 2
"""
import argparse
import re
import sqlite3
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import budget
import nse_session
from db_lib import retry as db_retry

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
API = "https://www.nseindia.com/api/corporate-share-holdings-master?index=equities&symbol={sym}"
XBRLI = "{http://www.xbrl.org/2003/instance}"
PCT = "ShareholdingAsAPercentageOfTotalNumberOfShares"


# The axis a named holder is filed under -> the row it belongs to on the page.
def holder_group(axis: str) -> str:
    a = axis.lower()
    if "custodian" in a or "drholder" in a:
        return "DR holders"
    if "foreign" in a or "portfolio" in a:
        return "FIIs"
    if re.search(r"mutualfund|insurance|provident|pension|bank|alternateinvestment|financialinstitution|venturecapital|sovereign", a):
        return "DIIs"
    if a in ("detailssharesheldbyindividualsorhufaxis", "detailsofsharesheldbyothersindianshareholdersaxis"):
        return "Promoters"
    if "promoter" in a:
        return "Promoters"
    return "Public"


def parse(xml: bytes) -> dict:
    """Percent of total shares held by each group, from one SHP XBRL."""
    root = ET.fromstring(xml)
    single: dict[str, str] = {}   # context id -> its one member (lower case, no prefix)
    typed: dict[str, str] = {}    # context id -> the axis of a named-holder context
    for c in root.iter(XBRLI + "context"):
        mem = [m.text.split(":")[-1].lower() for m in c.iter() if m.tag.endswith("explicitMember") and m.text]
        tm = [m for m in c.iter() if m.tag.endswith("typedMember")]
        if len(mem) == 1 and not tm:
            single[c.get("id")] = mem[0]
        if tm and not mem:
            typed[c.get("id")] = (tm[0].get("dimension") or "").split(":")[-1]
    v: dict[str, float] = {}
    counts: dict[str, int] = {}
    names: dict[str, str] = {}
    hpct: dict[str, float] = {}
    for el in root:
        tag, ref = el.tag.split("}")[-1], el.get("contextRef")
        if ref in typed:
            # The name sits on the duration context (D_X_Context15), the share
            # on its instant twin (X_Context15): one holder, two ids.
            key = ref[2:] if ref.startswith("D_") else ref
            if tag == "NameOfTheShareholder" and el.text:
                names[key] = " ".join(el.text.split())
                typed.setdefault(key, typed[ref])
            elif tag == PCT:
                try:
                    hpct[key] = float(el.text)
                except (TypeError, ValueError):
                    pass
            continue
        if ref not in single:
            continue
        if tag == "NumberOfShareholders":
            try:
                counts[single[ref]] = int(float(el.text))
            except (TypeError, ValueError):
                pass
            continue
        if tag != PCT:
            continue
        try:
            v[single[ref]] = float(el.text)
        except (TypeError, ValueError):
            continue
    # Most files write 12.01% as 0.1201; some (TCS's and Kaveri's Jun-2025
    # filings) write it as 12.01. A share above 1 can only be the second kind.
    scale = 1 if v and max(v.values()) > 1.0 else 100
    v = {k: x * scale for k, x in v.items()}
    # Named holders: promoters at any size, everyone else from 1% (the
    # filing's own threshold; a row the filing marks as a category total -
    # "Foreign Institutional Investors" - is not a holder and is skipped).
    holders = []
    for ref, name in names.items():
        pct = hpct.get(ref)
        if pct is None:
            continue
        pct = round(pct * scale, 2)
        grp = holder_group(typed[ref])
        if grp != "Promoters" and pct < 1.0:
            continue
        if re.fullmatch(r"(foreign institutional investors|fdi.*|others?|any other.*|clearing members?|trusts?)", name.lower()):
            continue
        holders.append((grp, name[:120], pct))
    n_holders = sum(counts.get(k, 0) for k in ("shareholdingofpromoterandpromotergroupmember", "publicshareholdingmember",
                                                "sharesheldbynonpromoternonpublicshareholdersmember")) or None

    def first(*names):
        return next((v[n] for n in names if n in v), None)

    fpi_new = [x for k, x in v.items() if re.fullmatch(r"institutionsforeignportfolioinvestorcate?r?gory(one|two)member", k)]
    fpi = sum(fpi_new) if fpi_new else first("institutionsforeignportfolioinvestormember", "foreignportfolioinvestormember")
    r = lambda x: None if x is None else round(x, 2)  # noqa: E731
    return {
        "dii": r(v.get("institutionsdomesticmember")),
        "fii": r(v.get("institutionsforeignmember")),
        "mf": r(first("mutualfundsorutimember")),
        "insurance": r(first("insurancecompaniesmember")),
        "fpi": r(fpi),
        "others": r(v.get("noninstitutionsmember")),
        "gov": r(v.get("governmentsmember")),
        "n_holders": n_holders,
        "holders": holders,
    }


def iso(d: str | None) -> str | None:
    try:
        return datetime.strptime((d or "").strip().title(), "%d-%b-%Y").date().isoformat()
    except ValueError:
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", required=True, help="comma list, or @path to file")
    ap.add_argument("--limit", type=int, default=300, help="companies per run")
    ap.add_argument("--quarters", type=int, default=5, help="how many of the newest quarters to hold")
    ap.add_argument("--per-company", type=int, default=2, help="files read per company per run, newest missing first")
    ap.add_argument("--max-age-hours", type=float, default=168)
    ap.add_argument("--sleep", type=float, default=0.4)
    args = ap.parse_args()
    raw = (ROOT / args.symbols[1:]).read_text(encoding="utf-8") if args.symbols.startswith("@") else args.symbols
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]

    con = sqlite3.connect(DB, timeout=180)
    con.execute("PRAGMA busy_timeout=180000")
    con.execute("CREATE TABLE IF NOT EXISTS shareholding_detail (symbol TEXT, date TEXT, dii REAL, fii REAL, mf REAL,"
                " insurance REAL, fpi REAL, others REAL, PRIMARY KEY (symbol, date))")
    con.execute("CREATE TABLE IF NOT EXISTS shp_detail_log (symbol TEXT PRIMARY KEY, fetched_at TEXT, error TEXT, n INTEGER)")
    cols = {r[1] for r in con.execute("PRAGMA table_info(shareholding_detail)")}
    for c, t in (("gov", "REAL"), ("n_holders", "INTEGER")):
        if c not in cols:
            con.execute(f"ALTER TABLE shareholding_detail ADD COLUMN {c} {t}")
    con.execute("CREATE TABLE IF NOT EXISTS shp_holders (symbol TEXT, date TEXT, category TEXT, name TEXT, pct REAL,"
                " PRIMARY KEY (symbol, date, category, name))")
    con.commit()
    log = {s: t for s, t in con.execute("SELECT symbol, fetched_at FROM shp_detail_log WHERE error IS NULL")}
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=args.max_age_hours)).strftime("%Y-%m-%d %H:%M:%S")
    due = sorted((s for s in symbols if log.get(s, "") < cutoff), key=lambda s: log.get(s) or "")[:args.limit]
    # A quarter read before holders and counts were parsed (27-Oct-2026) is
    # read again, newest first, a few a company per run.
    held = {(s, d) for s, d in con.execute("SELECT symbol, date FROM shareholding_detail WHERE n_holders IS NOT NULL")}
    print(f"shareholding detail for {len(due)} companies...", flush=True)

    s = requests.Session()
    s.headers.update(nse_session.HEADERS)
    try:
        s.get(nse_session.HOME, timeout=20)
    except requests.RequestException:
        pass
    ok = files = 0
    for i, sym in enumerate(due):
        if budget.stop(i, len(due)):
            break
        n, err = 0, None
        try:
            r = nse_session.get(s, API.format(sym=nse_session.q(sym)))
            body = r.json()
            rows = body if isinstance(body, list) else body.get("data", [])
            quarters = sorted(((iso(x.get("date")), x.get("xbrl")) for x in rows if iso(x.get("date")) and x.get("xbrl")),
                              reverse=True)[:args.quarters]
            for d, url in [q for q in quarters if (sym, q[0]) not in held][:args.per_company]:
                time.sleep(args.sleep)
                try:
                    got = parse(nse_session.get(s, url).content)
                except (ET.ParseError, requests.RequestException) as e:
                    print(f"  {sym} {d}: {type(e).__name__}")
                    continue
                if not any(x is not None for k, x in got.items() if k != "holders"):
                    continue
                db_retry(lambda: con.execute(
                    "INSERT OR REPLACE INTO shareholding_detail (symbol, date, dii, fii, mf, insurance, fpi, others, gov, n_holders)"
                    " VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (sym, d, got["dii"], got["fii"], got["mf"], got["insurance"], got["fpi"], got["others"], got["gov"], got["n_holders"])))
                db_retry(lambda: con.execute("DELETE FROM shp_holders WHERE symbol=? AND date=?", (sym, d)))
                db_retry(lambda: con.executemany("INSERT OR REPLACE INTO shp_holders VALUES (?,?,?,?,?)",
                                                 [(sym, d, g, nm, pc) for g, nm, pc in got["holders"]]))
                n += 1
                files += 1
            ok += 1
        except Exception as e:  # noqa: BLE001 - one company's failure costs that company
            err = f"{type(e).__name__}: {str(e)[:150]}"
            print(f"  {sym}: {err}")
        db_retry(lambda: con.execute("INSERT OR REPLACE INTO shp_detail_log VALUES (?,?,?,?)",
                                     (sym, datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), err, n)))
        db_retry(con.commit)
        time.sleep(args.sleep)
    print(f"shareholding detail: {ok} of {len(due)} companies read, {files} quarterly files parsed")
    con.close()


if __name__ == "__main__":
    main()
