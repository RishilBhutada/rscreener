# Parity tracker — Rscreener vs screener.in

Owner's standing order: **everything screener.in has, Rscreener gets — then better.**
This file is the checklist. An item is checked only after it is live and verified
on the deployed site. "Better than" ideas go at the bottom, locked until parity.

## Screening
- [x] Query language (comparisons, and/or, parentheses)
- [x] Arithmetic in queries (+ - * / and nesting)
- [x] Custom user-defined ratios
- [x] Saved screens (device)
- [x] ~40 built-in fields incl. ROCE, EV/EBITDA, PEG, promoter holding
- [x] Historical fields: sales/profit CAGR 5y/10y, median P/E 5y, avg margin 5y
- [x] Returns fields: ret_1m/3m/6m/1y/3y/5y + off_52w_high (936 cos, grows with bands)
- [ ] Historical-average fields batch 2: avg ROE 5y, avg ROCE 5y (needs equity/capital history)
- [ ] Screen result count parity spot-check vs screener.in on 10 classic queries

## Company page
- [x] Metric tiles (price, mcap, P/E, P/B, ROE, yield, D/E, book, 52wk)
- [x] Quarterly results, annual P&L, balance sheet, cash flow tables
- [x] Long-term as-filed track record (annual + quarterly) with source tags
- [x] Peer comparison by industry
- [x] Shareholding pattern (promoter / public / employee trusts)
- [ ] Shareholding: FII / DII split (SHP XBRL parsing)
- [x] Documents: annual report PDFs (15+ yrs on big caps), NSE filings link, cross-check link
- [ ] Concall transcripts list per company
- [ ] Credit ratings list per company
- [x] Private notes (device-only)
- [x] Per-company CSV export
- [ ] Per-company XLSX export (theirs is .xlsx with a template)

## Charts
- [x] Price chart 1Y/5Y/10Y
- [x] P/E band with 5-year median line
- [x] 50 & 200 DMA overlays on price (1Y view; extend when daily depth grows)
- [x] Sales & margin chart view (quarterly bars + margin line)
- [x] EPS chart view
- [ ] Volume on price chart (needs volume series in the price fetcher)
- [x] Revenue / Net-profit long-term bar charts

## App-wide
- [x] Search with ranked matches
- [x] Sectors browse + drill-down
- [x] Results calendar (upcoming board meetings, filters)
- [x] Watchlist (star toggles, home section)
- [x] Screen results CSV export
- [x] Alerts on announcements (cloud, hourly, failure heartbeat)
- [x] Installable app: PWA + Android APK
- [x] Nightly self-refresh of all data (cloud)
- [x] Portfolio import (Zerodha / Angel One / Groww files) — beyond screener.in
- [ ] Portfolio auto-sync via Zerodha API (waiting: owner "kite login")
- [ ] Cross-device sync of watchlist/screens/notes (waiting: owner Firebase setup)
- [ ] Community screens — impossible without users; permanent honest gap

## Data depth
- [x] Full NSE universe snapshot (2,353) refreshed nightly
- [x] Top-500: statements, track records, prices, shareholding, documents
- [ ] Companies 501–1000 (expansion band running)
- [ ] Companies 1001–2353 (queued bands)
- [ ] Pre-2019 as-filed history — SCOPED 12-Jul: old-format ANNUAL filings have NO
      XBRL on NSE (placeholder links). Routes: (a) 2016-18 New-format files we may
      have skipped, (b) old-format QUARTERLY XBRLs (Q4 cumulative = annual),
      (c) BSE results API as fallback
- [ ] 10-yr balance sheet / cash flow depth
- [ ] Weekly auto-ingest of newly filed quarters (--newer-than mode)

## After parity: "make it better" (owner's phase 2 — parked)
- Portfolio overlap with screens ("which holdings fail my quality screen?")
- CAS (CDSL monthly statement) importer
- Screen backtesting against the as-filed history we already store
