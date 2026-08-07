"""Rscreener P1 - fetches fundamentals for NSE symbols via yfinance.

Reads data/universe.csv, writes into data/rscreener.db:
  fundamentals - one snapshot row per symbol (price, mcap, PE, ROE, ...)
  statements   - long-form annual + quarterly P&L / balance sheet / cash flow
  fetch_log    - per-symbol last fetch time + error, makes runs resumable

Usage:
  python fetch_fundamentals.py --symbols RELIANCE,TCS
  python fetch_fundamentals.py --sample 25
  python fetch_fundamentals.py --all            (resumes where it stopped)
  python fetch_fundamentals.py --all --refresh  (ignores previous progress)
"""
import argparse
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
DB = DATA / "rscreener.db"

# yfinance `info` keys -> our snapshot columns
INFO_FIELDS = {
    "longName": "name",
    "sector": "sector",
    "industry": "industry",
    "currentPrice": "price",
    "marketCap": "market_cap",
    "trailingPE": "pe",
    "forwardPE": "forward_pe",
    "priceToBook": "pb",
    "bookValue": "book_value",
    "returnOnEquity": "roe",
    "returnOnAssets": "roa",
    "debtToEquity": "debt_to_equity",
    "dividendYield": "dividend_yield",
    "profitMargins": "net_margin",
    "operatingMargins": "op_margin",
    "grossMargins": "gross_margin",
    "revenueGrowth": "revenue_growth",
    "earningsGrowth": "earnings_growth",
    "totalRevenue": "revenue",
    "netIncomeToCommon": "net_income",
    "totalDebt": "total_debt",
    "totalCash": "total_cash",
    "freeCashflow": "free_cashflow",
    "sharesOutstanding": "shares_out",
    "fiftyTwoWeekHigh": "wk52_high",
    "fiftyTwoWeekLow": "wk52_low",
    "beta": "beta",
}

# (yfinance Ticker attribute, statement type, period type)
STATEMENT_ATTRS = [
    ("income_stmt", "income", "annual"),
    ("quarterly_income_stmt", "income", "quarterly"),
    ("balance_sheet", "balance", "annual"),
    ("quarterly_balance_sheet", "balance", "quarterly"),
    ("cashflow", "cashflow", "annual"),
    ("quarterly_cashflow", "cashflow", "quarterly"),
]


def now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def statements_long(tkr: yf.Ticker, symbol: str) -> pd.DataFrame:
    frames = []
    for attr, stmt_type, period_type in STATEMENT_ATTRS:
        try:
            df = getattr(tkr, attr)
        except Exception:
            continue
        if df is None or getattr(df, "empty", True):
            continue
        # pandas 3.0's melt chokes on Timestamp column labels; stringify + stack instead
        sub = df.copy()
        sub.columns = [
            pd.Timestamp(c).date().isoformat() if not isinstance(c, str) else c
            for c in sub.columns
        ]
        long = sub.stack().dropna().reset_index()
        long.columns = ["item", "period_end", "value"]
        long["symbol"] = symbol
        long["stmt_type"] = stmt_type
        long["period_type"] = period_type
        frames.append(long[["symbol", "stmt_type", "period_type", "period_end", "item", "value"]])
    if not frames:
        return pd.DataFrame(columns=["symbol", "stmt_type", "period_type", "period_end", "item", "value"])
    return pd.concat(frames, ignore_index=True)


def fetch_one(symbol: str, snapshot_only: bool = False) -> tuple[dict, pd.DataFrame]:
    tkr = yf.Ticker(f"{symbol}.NS")
    info = tkr.info or {}
    row = {"symbol": symbol, "fetch_date": now_utc()}
    for src, dst in INFO_FIELDS.items():
        row[dst] = info.get(src)
    # A quote carrying a price but no market cap is a half-built answer, not a
    # company without a market cap. On 4-Aug-2026 exactly two symbols out of
    # 2,367 came back that way - RELIANCE and TCS, both far into the sweep - and
    # each cost its company four twenty-year charts. Ask once more before
    # believing it; a second miss is then treated as genuinely unknown, and
    # keep_known_values stops it overwriting whatever we already had.
    if row.get("price") is not None and row.get("market_cap") is None:
        time.sleep(1.5)
        info = yf.Ticker(f"{symbol}.NS").info or {}
        for src, dst in INFO_FIELDS.items():
            if row.get(dst) is None:
                row[dst] = info.get(src)
    if row.get("price") is None and row.get("market_cap") is None:
        raise ValueError("no data returned (symbol unknown to Yahoo or delisted)")
    if snapshot_only:
        empty = pd.DataFrame(columns=["symbol", "stmt_type", "period_type", "period_end", "item", "value"])
        return row, empty
    return row, statements_long(tkr, symbol)


def keep_known_values(con: sqlite3.Connection, table: str, df: pd.DataFrame) -> pd.DataFrame:
    """Carry forward any field the new payload left blank.

    Yahoo answers a quote request field by field, and a throttled or half-built
    response omits fields rather than failing. Because the write below DELETEs
    before it appends, an omitted field did not mean "unchanged" - it meant the
    stored value was destroyed, while the fetch still printed `ok`.

    On 4-Aug-2026 that emptied market_cap for RELIANCE and TCS. Share count is
    derived as market_cap / price, and a symbol with no share count is skipped
    outright by the band builder, so twenty years of P/E, P/B, P/S and EV/EBITDA
    history disappeared from both charts and the publish guard stopped the whole
    nightly run. Two absent numbers, four charts, one dead pipeline.

    A blank field is the absence of an answer, not an answer of zero. Only a
    different known value may overwrite a known value.
    """
    if df.empty or "symbol" not in df.columns:
        return df
    cols = ",".join(f'"{c}"' for c in df.columns)
    qmarks = ",".join("?" * len(df))
    stored = {
        r[0]: dict(zip(df.columns, r))
        for r in con.execute(
            f"SELECT {cols} FROM {table} WHERE symbol IN ({qmarks})",
            df["symbol"].tolist(),
        ).fetchall()
    }
    if not stored:
        return df
    df = df.copy()
    for i, sym in enumerate(df["symbol"]):
        old = stored.get(sym)
        if not old:
            continue
        for c in df.columns:
            if c == "symbol":
                continue
            new = df.iloc[i][c]
            if (new is None or (isinstance(new, float) and pd.isna(new))) and old.get(c) is not None:
                df.iloc[i, df.columns.get_loc(c)] = old[c]
    return df


def replace_symbol_rows(con: sqlite3.Connection, table: str, symbols: list[str], df: pd.DataFrame,
                        coalesce: bool = False) -> None:
    existing = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    if existing:
        # coalesce only for one-row-per-symbol tables. `statements` holds many
        # rows per symbol keyed by period and item, where a row absent from the
        # new payload genuinely is a row that should go.
        if coalesce:
            df = keep_known_values(con, table, df)
        qmarks = ",".join("?" * len(symbols))
        con.execute(f"DELETE FROM {table} WHERE symbol IN ({qmarks})", symbols)
    if not df.empty:
        df.to_sql(table, con, if_exists="append", index=False)


def already_done(con: sqlite3.Connection, max_age_hours: float = 0) -> set[str]:
    existing = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='fetch_log'"
    ).fetchone()
    if not existing:
        return set()
    if max_age_hours > 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).strftime("%Y-%m-%d %H:%M:%S")
        rows = con.execute(
            "SELECT symbol FROM fetch_log WHERE error IS NULL AND fetched_at >= ?", (cutoff,)
        ).fetchall()
    else:
        rows = con.execute("SELECT symbol FROM fetch_log WHERE error IS NULL").fetchall()
    return {r[0] for r in rows}


def main() -> None:
    ap = argparse.ArgumentParser()
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--symbols", help="comma-separated NSE symbols")
    group.add_argument("--sample", type=int, help="first N symbols of the universe")
    group.add_argument("--all", action="store_true", help="entire universe")
    ap.add_argument("--refresh", action="store_true", help="re-fetch even if already done")
    ap.add_argument("--sleep", type=float, default=0.8, help="seconds between symbols")
    ap.add_argument("--snapshot-only", action="store_true", help="skip statements (faster; enough for screening)")
    ap.add_argument("--max-age-hours", type=float, default=0,
                    help="re-fetch symbols last fetched more than this many hours ago (0 = skip all previously-fetched)")
    args = ap.parse_args()

    universe = pd.read_csv(DATA / "universe.csv")
    if args.symbols:
        raw = args.symbols
        if raw.startswith("@"):
            raw = (ROOT / raw[1:]).read_text(encoding="utf-8")
        symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]
    elif args.sample:
        symbols = universe["SYMBOL"].head(args.sample).tolist()
    else:
        symbols = universe["SYMBOL"].tolist()

    con = sqlite3.connect(DB, timeout=180)
    if not args.refresh:
        done = already_done(con, args.max_age_hours)
        symbols = [s for s in symbols if s not in done]
    print(f"fetching {len(symbols)} symbols...")

    ok = err = 0
    for i, sym in enumerate(symbols, 1):
        log_row = {"symbol": sym, "fetched_at": now_utc(), "error": None}
        try:
            snap, stmts = fetch_one(sym, snapshot_only=args.snapshot_only)
            replace_symbol_rows(con, "fundamentals", [sym], pd.DataFrame([snap]),
                                coalesce=True)
            if not args.snapshot_only:
                replace_symbol_rows(con, "statements", [sym], stmts)
            ok += 1
            missing = [k for k in ("price", "market_cap") if snap.get(k) is None]
            note = f" [Yahoo omitted {', '.join(missing)}; kept the stored value]" if missing else ""
            print(f"[{i}/{len(symbols)}] {sym}: ok ({len(stmts)} statement lines){note}")
        except Exception as e:  # noqa: BLE001 - one bad symbol must not kill the run
            log_row["error"] = str(e)[:300]
            err += 1
            print(f"[{i}/{len(symbols)}] {sym}: ERROR {e}")
        replace_symbol_rows(con, "fetch_log", [sym], pd.DataFrame([log_row]))
        con.commit()
        time.sleep(args.sleep)

    con.close()
    print(f"done: {ok} ok, {err} errors")


if __name__ == "__main__":
    main()
