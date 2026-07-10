# Rscreener

A personal, zero-cost stock screener for Indian (NSE) equities, feature-target: [screener.in](https://www.screener.in/) (the official app by Screener.in / Mittal Analytics — Play Store id `com.screener.mobile`).

**This project is completely separate from DemandZone Pro.** No shared code, no shared data.

## Data disclaimer (standing rule)

Every number in this app comes from free sources (yfinance / NSE) and is **unverified until checked against a company filing or broker export**. The app screens; it never recommends. No buy/sell/hold verdicts, ever.

## Architecture

```
[NSE website]        [Yahoo Finance via yfinance]
     |                        |
fetch_universe.py    fetch_fundamentals.py     <- pipeline/ (Python)
     |                        |
     +----------+-------------+
                |
        data/rscreener.db  (SQLite: universe, fundamentals, statements)
                |
             web/  (Next.js app — Phase 2+)
```

## Phase map

| Phase | Contents | Status |
|-------|----------|--------|
| P1 | Project skeleton + NSE universe + yfinance fundamentals pipeline + SQLite DB | **BUILT** |
| P2 | Query screener (formula language, e.g. `pe < 15 and roce > 20`) + saved screens, deployed free (Vercel) | pending |
| P3 | Company pages: statements, charts, peer comparison | pending |
| P4 | Watchlist, results alerts, notes, Excel export | pending |
| P5 | Documents: annual reports / concalls / credit-rating links | pending |
| P6 | BSE/NSE XBRL parsing — free 10-year statement depth | pending |
| P7 | Android APK (Capacitor wrap of the web app) | pending |

## How to run the pipeline

```
python pipeline/fetch_universe.py                 # ~2,000 NSE symbols -> data/universe.csv + DB
python pipeline/fetch_fundamentals.py --sample 25 # fundamentals for 25 symbols
python pipeline/fetch_fundamentals.py --all       # full universe (slow: ~1s/symbol, resumable)
```

Or double-click `run_pipeline.bat` (runs universe + full fundamentals; safe to interrupt — progress is saved after every symbol and it resumes where it stopped).

## Data model (SQLite: `data/rscreener.db`)

| Table | Grain | Contents |
|-------|-------|----------|
| `universe` | 1 row / listed company | symbol, name, series, listing date, ISIN |
| `fundamentals` | 1 row / symbol | snapshot: price, market cap, PE, P/B, ROE, ROA, D/E, dividend yield, margins, growth, 52-week range, sector/industry |
| `statements` | 1 row / symbol / statement / period / line-item | long-form annual + quarterly P&L, balance sheet, cash flow (as deep as yfinance provides, ~4-5 yrs) |
| `fetch_log` | 1 row / symbol | last fetch time + error (if any) |
