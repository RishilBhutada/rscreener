# Rscreener

A zero-cost stock screener for Indian equities — **NSE and BSE**, 4,713 companies —
built to match [screener.in](https://www.screener.in/) feature for feature and then
go past it. Live at <https://rishilbhutada.github.io/rscreener/>.

**Completely separate from DemandZone Pro.** No shared code, no shared data.

## Data disclaimer (standing rule)

Every number here comes from free sources (yfinance, NSE, BSE) and is **unverified
until checked against a company filing or broker export**. The app screens; it never
recommends. No buy/sell/hold verdicts, ever. Where a figure cannot be trusted it is
withheld rather than shown — a dash, with the reason stated on the page.

## Architecture

```
 [NSE]   [BSE]   [Yahoo Finance via yfinance]
    |      |            |
    +------+------------+
           |
   pipeline/  (29 Python scripts: fetchers, guards, exporters)
           |
   data/rscreener.db   (SQLite, ~850 MB, 24 tables)
           |
   +-------+--------+---------------+
   |                |               |
 data.json      index.json     companies/<SYM>.json
 (screener,      (search +      (one file per company:
  5.4 MB)        watchlist,      statements, bands, peers,
                 422 KB)         industry context — ~32 KB)
           |
   web/  (Next.js 16 static export)  ->  GitHub Pages
                                     ->  Android APK (Capacitor)
```

Nothing runs on a server. The nightly GitHub Actions workflow restores the database
from a release asset, fetches, exports, runs the publish guards, builds the site and
deploys it — then stores the database back.

## Publish guards

The build refuses to ship rather than ship something wrong. Each of these has caught
a real failure that was already live:

| Guard | Refuses to publish when |
|-------|------------------------|
| `check_prices.py` | prices are stale, too many companies lag the market, or the export's own arithmetic stops reconciling |
| `check_sources.py` | a filed figure and the provider's figure for the same company-year disagree beyond tolerance |
| `check_depth.py` | chart history went backwards against the stored ratchet |
| `scorecard.py` | (records, never blocks) four measured dimensions — complete, correct, fresh, deep |

## Pipeline

```
python pipeline/fetch_universe.py          # NSE + BSE listed universe -> DB
python pipeline/fetch_fundamentals.py --all --snapshot-only
python pipeline/fetch_prices.py --symbols @data/nse_symbols.txt
python pipeline/fetch_results_history.py   # as-filed quarterly/annual results
python pipeline/export_json.py             # data.json + index.json
python pipeline/export_company_json.py     # one file per company
python pipeline/check_prices.py            # guards, in the order the workflow runs them
```

`.github/workflows/nightly.yml` is the operational source of truth for what runs,
in what order, with which limits and time budgets.

## Data model (`data/rscreener.db`)

| Table | Grain | Contents |
|-------|-------|----------|
| `universe` | 1 / listed company | symbol, name, series, listing date, ISIN, exchange, BSE code |
| `fundamentals` | 1 / symbol | snapshot: price, market cap, P/E, P/B, ROE, D/E, yield, margins, growth, 52-week range, sector/industry |
| `statements` | 1 / symbol / statement / period / line | annual + quarterly P&L, balance sheet, cash flow from the provider |
| `results_history` | 1 / symbol / period / item | **as-filed** NSE results, back to ~2005 where the filings exist |
| `prices` | 1 / symbol / freq / date | daily, weekly and monthly closes — up to ~30 years |
| `shareholding` | 1 / symbol / quarter | promoter / public / employee-trust split |
| `corporate_actions`, `splits` | 1 / symbol / event | dividends, bonuses, splits |
| `documents`, `announcement_docs` | 1 / symbol / document | annual reports, concalls, credit-rating updates |
| `filing_dates` | 1 / symbol / period | when a result was actually published, not when the quarter ended |
| `*_fetch_log` | 1 / symbol / source | last attempt and error, so a rotation can resume |

## Where the project stands

- `PARITY.md` — the screener.in checklist, item by item
- `COMPETITORS.md` — what other screeners do, and what was taken, refused or queued
- `AUDIT.md` — every finding from the full-app audit, with its verified status
