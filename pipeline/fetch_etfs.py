"""Rscreener - exchange-traded funds: what each one holds, per the fund house.

An ETF has two prices. The exchange price is what buyers pay; the NAV is what
the units are worth, struck by the fund house every evening from what the fund
holds. Normally the two sit within a fraction of a percent, because dealers
create or redeem units whenever they drift. When creation stops, nothing pulls
them together: from 2022 RBI's cap on overseas investment kept fund houses from
creating new units of their US-index ETFs, buyers bid the exchange price up to
a quarter above the NAV, and when the gap closed the price fell on days the
Nasdaq did not. Comparing an ETF with its index cannot show that. Comparing it
with its own NAV can - so the NAV is what this fetches.

Sources, all free:
  - NSE's ETF list (symbol, ISIN, underlying index, asset class).
  - AMFI's NAVAll.txt - every scheme's official NAV for the latest day. This is
    the authority; it is matched to each ETF by ISIN.
  - mfapi.in for NAV HISTORY. It mirrors AMFI's own data; a history is written
    only when it agrees with AMFI's figure for every date both have.
  - Yahoo for five years of NSE daily closes per ETF, and for the underlying
    index where it carries a full history, with the currency rate that
    converts a foreign index into rupees.

Prices are the ETF's NSE closes, kept in a table of their own. About 195 ETFs
also sit in the company universe as BSE listings, priced from BSE - where they
barely trade: MON100 had one daily close in two years there. A premium over
NAV worked out from a close that old is mostly the market having moved since.

Usage:
  python fetch_etfs.py [--limit 60] [--history-max-age-hours 168] [--sleep 0.3]
  (about four minutes for all 351 ETFs)
"""
import argparse
import csv
import io
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import budget

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
NSE_LIST = "https://archives.nseindia.com/content/equities/eq_etfseclist.csv"
AMFI_NAV = "https://portal.amfiindia.com/spages/NAVAll.txt"
MFAPI = "https://api.mfapi.in/mf/{code}"
CHART = "https://query2.finance.yahoo.com/v8/finance/chart/{sym}?range={rng}&interval={itv}"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "*/*",
}

# The underlying index, where Yahoo carries its full daily history (checked
# 27-Sep-2026 - most sector indices come back as a single day and are left
# out rather than drawn as a line that stops). Keyed by NSE's "Underlying
# Key", lower-cased. A PRICE index: the fund tracks the total-return version,
# so over a year the NAV runs ahead of this line by roughly the dividends.
INDIAN = {
    "nifty 50": ("^NSEI", "Nifty 50"),
    "nifty bank": ("^NSEBANK", "Nifty Bank"),
    "bse sensex": ("^BSESN", "Sensex"),
    "nifty next 50": ("^NSMIDCP", "Nifty Next 50"),
    "nifty it": ("^CNXIT", "Nifty IT"),
    "nifty 100": ("^CNX100", "Nifty 100"),
    "nifty 500": ("^CRSLDX", "Nifty 500"),
    "nifty midcap 150": ("NIFTYMIDCAP150.NS", "Nifty Midcap 150"),
    "nifty smallcap 250": ("NIFTYSMLCAP250.NS", "Nifty Smallcap 250"),
    "nifty midcap 50": ("^NSEMDCP50", "Nifty Midcap 50"),
    "nifty pharma": ("^CNXPHARMA", "Nifty Pharma"),
}
# Foreign indices, matched on NSE's "Underlying Asset" text (their key is just
# "GLOBAL INDICES"), with the rate that turns them into rupees.
GLOBAL = [
    ("nasdaq100", "^NDX", "INR=X", "Nasdaq-100"),
    ("nasdaq 100", "^NDX", "INR=X", "Nasdaq-100"),
    ("nyse fang", "^NYFANG", "INR=X", "NYSE FANG+"),
    ("hang seng index", "^HSI", "HKDINR=X", "Hang Seng"),
]


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def asset_class(r: dict) -> str:
    """equity | international | gold | silver | debt | hybrid."""
    kind = (r.get("ETF Underlying") or "").strip().lower()
    key = (r.get("Underlying Key") or "").strip().lower()
    if kind == "global indices":
        return "international"
    if kind == "commodity":
        return "silver" if "silver" in key else "gold"
    if kind == "debt":
        return "debt"
    if kind == "hybrid":
        return "hybrid"
    return "equity"


def index_for(r: dict) -> tuple[str | None, str | None, str | None]:
    """(index ticker, fx ticker, label) for an ETF, or Nones."""
    key = (r.get("Underlying Key") or "").strip().lower()
    if key in INDIAN:
        t, label = INDIAN[key]
        return t, None, label
    text = f"{r.get('Underlying Asset') or ''} {r.get('SecurityName') or ''}".lower()
    if key == "global indices":
        for needle, t, fx, label in GLOBAL:
            if needle in text:
                return t, fx, label
    return None, None, None


def schema(con: sqlite3.Connection) -> None:
    con.executescript("""
        CREATE TABLE IF NOT EXISTS etfs (
            symbol TEXT PRIMARY KEY, name TEXT, security TEXT, underlying TEXT,
            underlying_key TEXT, asset_class TEXT, isin TEXT, listed TEXT,
            amfi_code TEXT, scheme TEXT, index_ticker TEXT, fx_ticker TEXT,
            index_label TEXT, updated_at TEXT);
        CREATE TABLE IF NOT EXISTS etf_nav (
            symbol TEXT, date TEXT, nav REAL, source TEXT, PRIMARY KEY (symbol, date));
        CREATE TABLE IF NOT EXISTS etf_nav_log (
            symbol TEXT PRIMARY KEY, fetched_at TEXT, rows INTEGER, error TEXT);
        CREATE TABLE IF NOT EXISTS index_prices (
            ticker TEXT, date TEXT, close REAL, PRIMARY KEY (ticker, date));
        CREATE TABLE IF NOT EXISTS etf_prices (
            symbol TEXT, date TEXT, close REAL, volume REAL, PRIMARY KEY (symbol, date));
        CREATE TABLE IF NOT EXISTS etf_prices_monthly (
            symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL,
            PRIMARY KEY (symbol, date));
    """)
    # Open, high and low arrived with the full-screen chart's candles; the
    # table was first written with closes only.
    have = {r[1] for r in con.execute("PRAGMA table_info(etf_prices)")}
    for col in ("open", "high", "low"):
        if col not in have:
            con.execute(f"ALTER TABLE etf_prices ADD COLUMN {col} REAL")


def load_list(session: requests.Session, con: sqlite3.Connection) -> list[dict]:
    r = session.get(NSE_LIST, timeout=30)
    r.raise_for_status()
    rows = [x for x in csv.DictReader(io.StringIO(r.content.decode("utf-8-sig")))
            if (x.get("Symbol") or "").strip()]
    if len(rows) < 100:
        # A short or reshaped file is a changed source, not 90% of ETFs delisting.
        raise SystemExit(f"NSE ETF list has only {len(rows)} rows - not replacing the stored list")
    stamp = now_utc()
    for x in rows:
        t, fx, label = index_for(x)
        listed = None
        try:
            listed = datetime.strptime(x["DateofListing"].strip(), "%d-%b-%y").strftime("%Y-%m-%d")
        except (KeyError, ValueError):
            pass
        con.execute(
            """INSERT INTO etfs (symbol, name, security, underlying, underlying_key, asset_class,
                   isin, listed, index_ticker, fx_ticker, index_label, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, security=excluded.security,
                   underlying=excluded.underlying, underlying_key=excluded.underlying_key,
                   asset_class=excluded.asset_class, isin=excluded.isin, listed=excluded.listed,
                   index_ticker=excluded.index_ticker, fx_ticker=excluded.fx_ticker,
                   index_label=excluded.index_label, updated_at=excluded.updated_at""",
            (x["Symbol"].strip().upper(), (x.get("Underlying Asset") or "").strip(),
             (x.get("SecurityName") or "").strip(), (x.get("Underlying Asset") or "").strip(),
             (x.get("Underlying Key") or "").strip(), asset_class(x), (x.get("ISINNumber") or "").strip(),
             listed, t, fx, label, stamp))
    con.commit()
    (ROOT / "data" / "etf_symbols.txt").write_text(
        ",".join(sorted(x["Symbol"].strip().upper() for x in rows)), encoding="utf-8")
    print(f"ETF list: {len(rows)} ETFs, {sum(1 for x in rows if index_for(x)[0])} with an index line")
    return rows


def load_amfi(session: requests.Session, con: sqlite3.Connection) -> None:
    """Today's official NAV for every ETF, matched by ISIN."""
    r = session.get(AMFI_NAV, timeout=60)
    r.raise_for_status()
    by_isin: dict[str, tuple[str, str, float, str]] = {}
    for line in r.text.splitlines():
        f = line.split(";")
        if len(f) < 8 or not f[0].strip().isdigit():
            continue
        try:
            nav = float(f[6])
            day = datetime.strptime(f[7].strip(), "%d-%b-%Y").strftime("%Y-%m-%d")
        except ValueError:
            continue
        for isin in (f[1].strip(), f[2].strip()):
            if isin and isin != "-":
                by_isin[isin] = (f[0].strip(), f[3].strip(), nav, day)
    matched = 0
    for sym, isin in con.execute("SELECT symbol, isin FROM etfs").fetchall():
        hit = by_isin.get(isin)
        if not hit:
            continue
        code, scheme, nav, day = hit
        con.execute("UPDATE etfs SET amfi_code=?, scheme=? WHERE symbol=?", (code, scheme, sym))
        con.execute("INSERT OR REPLACE INTO etf_nav VALUES (?,?,?,'amfi')", (sym, day, nav))
        matched += 1
    con.commit()
    print(f"AMFI NAVs: {matched} ETFs matched by ISIN")


def load_history(session: requests.Session, con: sqlite3.Connection, limit: int,
                 max_age_hours: float, sleep: float) -> None:
    """Full NAV history per ETF, from the mirror, only where it agrees with AMFI.

    Rotated: each ETF is re-read once `max_age_hours` have passed, so a night
    the job missed is filled in within the week."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).strftime("%Y-%m-%d %H:%M:%S")
    last = dict(con.execute("SELECT symbol, fetched_at FROM etf_nav_log WHERE error IS NULL"))
    todo = [(s, c) for s, c in con.execute(
        "SELECT symbol, amfi_code FROM etfs WHERE amfi_code IS NOT NULL ORDER BY symbol")
        if (last.get(s) or "") < cutoff]
    todo.sort(key=lambda t: last.get(t[0]) or "")
    if limit:
        todo = todo[:limit]
    print(f"NAV history: {len(todo)} ETFs to read")
    ok = bad = 0
    for i, (sym, code) in enumerate(todo):
        if budget.stop(i, len(todo), "ETFs"):
            break
        try:
            r = session.get(MFAPI.format(code=code), timeout=30)
            r.raise_for_status()
            data = r.json().get("data") or []
            hist = {}
            for x in data:
                try:
                    hist[datetime.strptime(x["date"], "%d-%m-%Y").strftime("%Y-%m-%d")] = float(x["nav"])
                except (KeyError, ValueError):
                    continue
            official = dict(con.execute(
                "SELECT date, nav FROM etf_nav WHERE symbol=? AND source='amfi'", (sym,)))
            clash = [d for d, v in official.items() if d in hist and abs(hist[d] / v - 1) > 0.0005]
            if clash:
                raise ValueError(f"history disagrees with AMFI on {len(clash)} day(s), e.g. {clash[0]}")
            con.executemany("INSERT OR IGNORE INTO etf_nav VALUES (?,?,?,'history')",
                            [(sym, d, v) for d, v in hist.items() if v > 0])
            con.execute("INSERT OR REPLACE INTO etf_nav_log VALUES (?,?,?,NULL)", (sym, now_utc(), len(hist)))
            ok += 1
        except Exception as e:  # noqa: BLE001 - one fund's failure is not the run's
            con.execute("INSERT OR REPLACE INTO etf_nav_log VALUES (?,?,0,?)", (sym, now_utc(), str(e)[:200]))
            bad += 1
        con.commit()
        time.sleep(sleep)
    print(f"NAV history: {ok} read, {bad} failed")


def yahoo_bars(session: requests.Session, ticker: str, rng: str, itv: str = "1d") -> list[tuple]:
    """(date, open, high, low, close, volume) per bar, dated in the market's
    own time zone (Yahoo stamps a bar by its opening instant) - so a monthly
    bar is dated the 1st of its month, not the last day of the one before."""
    r = session.get(CHART.format(sym=requests.utils.quote(ticker, safe=""), rng=rng, itv=itv), timeout=30)
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    off = timedelta(seconds=res["meta"].get("gmtoffset") or 0)
    q = res["indicators"]["quote"][0]
    n = len(res.get("timestamp") or [])
    col = lambda k: (q.get(k) or [None] * n)  # noqa: E731
    out = {}
    for ts, o, h, lo, c, v in zip(res.get("timestamp") or [], col("open"), col("high"), col("low"), col("close"), col("volume")):
        if c:
            out[(datetime.fromtimestamp(ts, timezone.utc) + off).strftime("%Y-%m-%d")] = (o, h, lo, c, v or 0)
    return [(d, *vals) for d, vals in sorted(out.items())]


def load_prices(session: requests.Session, con: sqlite3.Connection, sleep: float) -> None:
    """Five years of NSE daily bars for every ETF, replaced per ETF only when
    a response actually arrived - an empty answer never erases a history. And,
    once per ETF, its monthly bars back to listing, for the long view of the
    full-screen chart (NIFTYBEES reaches 2002)."""
    syms = [s for (s,) in con.execute("SELECT symbol FROM etfs ORDER BY symbol")]
    have_monthly = {s for (s,) in con.execute("SELECT DISTINCT symbol FROM etf_prices_monthly")}
    ok = bad = 0
    for i, sym in enumerate(syms):
        if budget.stop(i, len(syms), "ETF price histories"):
            break
        try:
            rows = yahoo_bars(session, f"{sym}.NS", "5y")
            if not rows:
                raise ValueError("no closes returned")
            con.execute("DELETE FROM etf_prices WHERE symbol=?", (sym,))
            con.executemany("INSERT INTO etf_prices (symbol, date, open, high, low, close, volume) VALUES (?,?,?,?,?,?,?)",
                            [(sym, *r) for r in rows])
            if sym not in have_monthly:
                time.sleep(sleep)
                month = yahoo_bars(session, f"{sym}.NS", "max", "1mo")
                if month:
                    con.executemany("INSERT OR REPLACE INTO etf_prices_monthly VALUES (?,?,?,?,?,?,?)",
                                    [(sym, *r) for r in month])
            con.commit()
            ok += 1
        except Exception as e:  # noqa: BLE001 - one ETF's failure is not the run's
            print(f"  {sym}: {e}")
            bad += 1
        time.sleep(sleep)
    print(f"ETF prices: {ok} read, {bad} failed")


AMFI_H = {"Accept": "application/json, text/plain, */*", "Referer": "https://www.amfiindia.com/ter-of-mf-schemes"}
AMC_API = "https://www.amfiindia.com/api/populate-mf"
TER_API = ("https://www.amfiindia.com/api/populate-te-rdata-revised?MF_ID={mf}&Month={month}"
           "&strCat=-1&strType=-1&page={page}&pageSize=100")
IST = timezone(timedelta(hours=5, minutes=30))


def scheme_key(name: str | None) -> str:
    """A scheme name with case, spaces and punctuation gone - how AMFI's TER
    file and its NAV file are matched (all 24 Nippon ETFs match exactly)."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def load_ter(session: requests.Session, con: sqlite3.Connection, page_budget: int, sleep: float) -> None:
    """Each scheme's expense ratio, from the TER every fund house must file with
    AMFI daily (SEBI Regulation 52). ETFs file theirs under the direct plan.

    AMFI serves 100 rows a page, one row per scheme per DAY: a month is ~500
    pages across 57 fund houses. So a few houses a night, within a page
    budget, until the month is covered; then nothing until the next month."""
    con.executescript("""
        CREATE TABLE IF NOT EXISTS etf_ter (
            scheme_key TEXT PRIMARY KEY, scheme TEXT, ter REAL, ter_date TEXT, mf_id TEXT, fetched_at TEXT);
        CREATE TABLE IF NOT EXISTS etf_ter_log (mf_id TEXT PRIMARY KEY, month TEXT, fetched_at TEXT);
    """)
    month = datetime.now(IST).strftime("%m-%Y")
    done = dict(con.execute("SELECT mf_id, month FROM etf_ter_log"))
    body = session.get(AMC_API, headers=AMFI_H, timeout=40).json()
    amcs = (body.get("data") or []) if isinstance(body, dict) else body   # a bare list today
    todo = [a for a in amcs if done.get(str(a.get("mfId"))) != month]
    pages = houses = schemes = 0
    for a in todo:
        if pages >= page_budget or budget.stop(houses, len(todo), "fund houses' TER"):
            break
        mf, page, latest = str(a["mfId"]), 1, {}
        while True:
            j = session.get(TER_API.format(mf=mf, month=month, page=page), headers=AMFI_H, timeout=60).json()
            for x in j.get("data") or []:
                nm = x.get("Scheme_Name")
                if nm and (nm not in latest or (x.get("TER_Date") or "") > (latest[nm].get("TER_Date") or "")):
                    latest[nm] = x
            pages += 1
            if page >= ((j.get("meta") or {}).get("pageCount") or 1):
                break
            page += 1
            time.sleep(sleep)
        # Nothing filed yet this month (the 1st, say): tried again tomorrow.
        if not latest:
            continue
        stamp = now_utc()
        for nm, x in latest.items():
            try:
                direct, regular = float(x.get("D_TER") or 0), float(x.get("R_TER") or 0)
            except ValueError:
                continue
            ter = direct if direct > 0 else regular
            if ter > 0:
                con.execute("INSERT OR REPLACE INTO etf_ter VALUES (?,?,?,?,?,?)",
                            (scheme_key(nm), nm, ter, (x.get("TER_Date") or "")[:10], mf, stamp))
                schemes += 1
        con.execute("INSERT OR REPLACE INTO etf_ter_log VALUES (?,?,?)", (mf, month, stamp))
        con.commit()
        houses += 1
        time.sleep(sleep)
    left = len(todo) - houses
    print(f"TER: {houses} fund houses read ({pages} pages, {schemes} schemes); "
          f"{left} left for later nights this month")


def load_indices(session: requests.Session, con: sqlite3.Connection) -> None:
    """Daily closes for each underlying index and currency rate, dated in the
    index's own time zone (Yahoo stamps a session by its opening instant)."""
    tickers = sorted({t for (t,) in con.execute("SELECT DISTINCT index_ticker FROM etfs WHERE index_ticker IS NOT NULL")}
                     | {t for (t,) in con.execute("SELECT DISTINCT fx_ticker FROM etfs WHERE fx_ticker IS NOT NULL")})
    for t in tickers:
        try:
            rows = [(d, c) for d, _o, _h, _l, c, _v in yahoo_bars(session, t, "10y")]
            if len(rows) < 200:
                raise ValueError(f"only {len(rows)} days")
            con.executemany("INSERT OR REPLACE INTO index_prices VALUES (?,?,?)", [(t, d, c) for d, c in rows])
            con.commit()
            print(f"  {t}: {len(rows)} days to {rows[-1][0]}")
        except Exception as e:  # noqa: BLE001
            print(f"  {t}: FAILED - {e}")
        time.sleep(0.3)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="NAV histories to read this run (0 = all due)")
    ap.add_argument("--history-max-age-hours", type=float, default=168)
    ap.add_argument("--sleep", type=float, default=0.3)
    ap.add_argument("--ter-pages", type=int, default=160, help="AMFI TER pages to read this run")
    args = ap.parse_args()
    con = sqlite3.connect(DB, timeout=180)
    schema(con)
    session = requests.Session()
    session.headers.update(HEADERS)
    load_list(session, con)
    load_amfi(session, con)
    load_history(session, con, args.limit, args.history_max_age_hours, args.sleep)
    load_prices(session, con, args.sleep)
    load_indices(session, con)
    try:
        load_ter(session, con, args.ter_pages, 0.4)
    except Exception as e:  # noqa: BLE001 - the fees are a nicety; prices and NAVs are not
        print(f"TER: skipped this run - {e}")
    con.close()


if __name__ == "__main__":
    main()
