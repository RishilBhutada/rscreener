"""Rscreener - the exchanges' own closing prices for the last few sessions,
laid over the stored daily history.

Why this exists. Yahoo's daily history for Indian symbols trails the market
by a session or two, and says nothing about it. The nightly run of 28-Sep-2026
(started 03:41 IST on the 29th, after Monday's close) got Nifty 50 only to
Friday the 25th, and 284 of 351 ETFs likewise - "351 read, 0 failed". So the
ETF page priced NIFTYBEES at 264.13 (25 Sep) against NSE's 259.47 (29 Sep),
and every company's full-screen chart ended on the 25th. Nothing failed,
which is why it went unnoticed: a history that stops two days short looks
exactly like a complete one.

The exchanges publish every session's closing prices as open files the same
evening:
  - NSE's CM bhavcopy (UDiFF)         -> NSE-listed companies and all ETFs
  - BSE's CM bhavcopy (UDiFF)         -> BSE-listed companies
  - NSE's index close file            -> the Nifty indices ETF charts compare with

What it writes, and what it will not:
  - Only sessions AFTER the newest one already stored for each symbol. A
    stored row is never replaced: the provider's history is split-adjusted and
    an exchange file is not, so the two can disagree about the past honestly.
  - Only if the exchange's PREVIOUS close for the first new session matches
    the close already stored (within 1.5%). A split or bonus in the gap moves
    the exchange's previous close to the new basis, the match fails, and the
    symbol is left for the provider's next adjusted history to carry.

Runs on every workflow run - it is about twenty small files - after every
other fetcher, since those replace whole histories and would drop what this
adds.

Usage:
  python fetch_bhavcopy.py [--days 10]
"""
import argparse
import csv
import io
import sqlite3
import time
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

import nse_session

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "rscreener.db"
IST = timezone(timedelta(hours=5, minutes=30))
NSE_CM = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{ymd}_F_0000.csv.zip"
BSE_CM = "https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_{ymd}_F_0000.CSV"
NSE_IDX = "https://nsearchives.nseindia.com/content/indices/ind_close_all_{dmy}.csv"
MATCH = 0.015
# A symbol trades in one of these at a time; EQ first. Everything else in the
# file is a bond, a warrant, a rights entitlement or a different instrument
# that happens to share the ticker.
EQUITY_SERIES = ["EQ", "BE", "BZ", "SM", "ST", "SZ"]


def num(v: str) -> float | None:
    try:
        x = float(v)
        return x if x > 0 else None
    except (TypeError, ValueError):
        return None


def sessions(days: int) -> list[datetime]:
    today = datetime.now(IST).date()
    return [datetime.combine(today - timedelta(days=i), datetime.min.time())
            for i in range(days, -1, -1) if (today - timedelta(days=i)).weekday() < 5]


def read_nse(s: requests.Session, d: datetime) -> dict[str, dict] | None:
    """One NSE session: equity rows by symbol, EQ series preferred."""
    r = nse_session.get(s, NSE_CM.format(ymd=d.strftime("%Y%m%d")), tries=2)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    out: dict[str, dict] = {}
    for x in csv.DictReader(io.StringIO(z.read(z.namelist()[0]).decode("utf-8-sig"))):
        sr = x.get("SctySrs")
        if sr not in EQUITY_SERIES:
            continue
        cur = out.get(x["TckrSymb"])
        if cur is None or EQUITY_SERIES.index(sr) < EQUITY_SERIES.index(cur["SctySrs"]):
            out[x["TckrSymb"]] = x
    return out


def read_bse(s: requests.Session, d: datetime) -> dict[str, dict] | None:
    """One BSE session: rows by BSE scrip code."""
    r = s.get(BSE_CM.format(ymd=d.strftime("%Y%m%d")), timeout=40)
    if r.status_code == 404 or not r.text.startswith("TradDt"):
        return None
    r.raise_for_status()
    return {x["FinInstrmId"]: x for x in csv.DictReader(io.StringIO(r.content.decode("utf-8-sig")))}


def read_indices(s: requests.Session, d: datetime) -> dict[str, dict] | None:
    r = nse_session.get(s, NSE_IDX.format(dmy=d.strftime("%d%m%Y")), tries=2)
    if r.status_code == 404 or not r.text.startswith("Index Name"):
        return None
    return {x["Index Name"].strip().lower(): x for x in csv.DictReader(io.StringIO(r.text))}


def extend(label: str, last: dict[str, tuple[str, float]], files: list[tuple[str, dict]],
           key_of: dict[str, str], write) -> None:
    """Add each symbol's sessions after its newest stored one, provided the
    exchange's previous close for the first of them is the close we hold."""
    added = held = 0
    mismatched = []
    for sym, fkey in key_of.items():
        if sym not in last:
            continue      # never fetched: the provider's full history comes first
        day, close = last[sym]
        new = [(d, f[fkey]) for d, f in files if d > day and fkey in f]
        if not new:
            continue
        prev = num(new[0][1].get("PrvsClsgPric"))
        if not prev or abs(prev / close - 1) > MATCH:
            held += 1
            if len(mismatched) < 8:
                mismatched.append(f"{sym} stored {close} vs exchange's previous {prev}")
            continue
        for d, x in new:
            c = num(x.get("ClsPric"))
            if c:
                write(sym, d, num(x.get("OpnPric")) or c, num(x.get("HghPric")) or c,
                      num(x.get("LwPric")) or c, c, float(x.get("TtlTradgVol") or 0))
                added += 1
    print(f"{label}: {added} sessions added; {held} symbols held back (previous close did not match - a split in the gap, or a different listing)")
    for m in mismatched:
        print(f"  held: {m}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=10, help="calendar days back to read")
    args = ap.parse_args()
    con = sqlite3.connect(DB, timeout=180)
    nse = nse_session.new_session()
    bse = requests.Session()
    bse.headers.update({**nse_session.HEADERS, "Referer": "https://www.bseindia.com/"})

    nse_files, bse_files, idx_files = [], [], []
    for d in sessions(args.days):
        iso = d.strftime("%Y-%m-%d")
        for label, reader, sess, bucket in (("NSE", read_nse, nse, nse_files), ("BSE", read_bse, bse, bse_files),
                                            ("indices", read_indices, nse, idx_files)):
            try:
                f = reader(sess, d)
                if f:
                    bucket.append((iso, f))
            except Exception as e:  # noqa: BLE001 - a missing day is a missing day
                print(f"  {label} {iso}: not read - {e}")
            time.sleep(0.3)
    print(f"read: NSE {[d for d, _ in nse_files]}, BSE {len(bse_files)} sessions, indices {len(idx_files)} sessions")
    if not nse_files and not bse_files:
        print("no exchange files read - nothing to add")
        return

    # Companies: the daily series behind every chart and return.
    last = {s: (d, c) for s, d, c in con.execute("""
        SELECT p.symbol, p.date, p.close FROM prices p
        JOIN (SELECT symbol, MAX(date) AS d FROM prices WHERE freq='daily' GROUP BY symbol) m
          ON m.symbol = p.symbol AND m.d = p.date WHERE p.freq='daily' AND p.close > 0""")}
    uni = con.execute("SELECT SYMBOL, EXCHANGE, BSE_CODE FROM universe").fetchall()

    def write_price(sym, d, o, h, lo, c, v):
        con.execute("DELETE FROM prices WHERE symbol=? AND freq='daily' AND date=?", (sym, d))
        con.execute("INSERT INTO prices (symbol,freq,date,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?,?)",
                    (sym, "daily", d, o, h, lo, c, v))

    extend("companies (NSE)", last, nse_files,
           {s: s for s, ex, _ in uni if ex in ("NSE", None)}, write_price)
    extend("companies (BSE)", last, bse_files,
           {s: str(code) for s, ex, code in uni if ex == "BSE" and code}, write_price)

    # ETFs: their NSE closes.
    if con.execute("SELECT 1 FROM sqlite_master WHERE name='etf_prices'").fetchone():
        last_etf = {s: (d, c) for s, d, c in con.execute("""
            SELECT e.symbol, e.date, e.close FROM etf_prices e
            JOIN (SELECT symbol, MAX(date) AS d FROM etf_prices GROUP BY symbol) m
              ON m.symbol = e.symbol AND m.d = e.date WHERE e.close > 0""")}

        def write_etf(sym, d, o, h, lo, c, v):
            con.execute("INSERT OR REPLACE INTO etf_prices (symbol, date, close, volume, open, high, low) VALUES (?,?,?,?,?,?,?)",
                        (sym, d, c, v, o, h, lo))
        extend("ETFs", last_etf, nse_files, {s: s for s in last_etf}, write_etf)

        # The Nifty indices the ETF charts set beside their NAV. The index
        # file has no previous-close column, so its change column stands in.
        added = 0
        for ticker, label in con.execute(
                "SELECT DISTINCT index_ticker, index_label FROM etfs WHERE index_ticker IS NOT NULL AND fx_ticker IS NULL"):
            row = con.execute("SELECT date, close FROM index_prices WHERE ticker=? ORDER BY date DESC LIMIT 1", (ticker,)).fetchone()
            if not row or not label:
                continue
            day, close = row
            for d, f in idx_files:
                x = f.get(label.strip().lower())
                if d <= day or not x:
                    continue
                c, chg = num(x.get("Closing Index Value")), x.get("Points Change")
                try:
                    prev = c - float(chg) if c else None
                except (TypeError, ValueError):
                    prev = None
                if not c or not prev or abs(prev / close - 1) > MATCH:
                    break
                con.execute("INSERT OR REPLACE INTO index_prices VALUES (?,?,?)", (ticker, d, c))
                day, close = d, c
                added += 1
        print(f"indices: {added} sessions added")
    con.commit()
    con.close()


if __name__ == "__main__":
    main()
