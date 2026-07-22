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
- [x] Historical volatility: volatility_1y / volatility_30d (close-to-close, annualised; Yang-Zhang via OHLC queued)
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
- [x] Concall transcripts / investor-meet documents listed per company (newest 15)
- [x] Credit-rating updates listed per company
- [x] Private notes (device-only)
- [x] Per-company CSV export
- [ ] Per-company XLSX export (theirs is .xlsx with a template)

## Charts — full screener.in chart-section parity (studied live, rebuilt to match)
- [x] Exact view set: **Price · PE Ratio · More▾[Sales & Margin · EV / EBITDA · Price to Book · Market Cap / Sales]** — same buttons, same "More" dropdown, same default (5Yr)
- [x] Price view: Price on NSE · 50 DMA · 200 DMA · Volume (checkbox toggles)
- [x] PE Ratio view: PE line · dashed "Median PE = x" · TTM EPS bars — EPS restated for bonus/splits (share-capital ratio) so PE matches screener (RELIANCE 25.6 vs 25.4)
- [x] Sales & Margin view: Quarter Sales bars · GPM % · OPM % · NPM % — OPM fixed to Operating Profit basis (was understated); GPM from as-filed COGS
- [x] EV / EBITDA view: line · "Median EV Multiple = x" · EBITDA bars (EBITDA = Sales − Expenses + Interest + Depreciation)
- [x] Price to Book view: "Price to BV" · "Median PBV = x" · Book Value bars
- [x] Market Cap / Sales view: line · "Median Market Cap to Sales = x" · Sales bars
- [x] Time-scaled axis, dual L/R axes, smoothing, crosshair tooltip listing every visible series
- [x] Full range set: 1M / 6M / 1Yr / 3Yr / 5Yr / 10Yr / Max — Max ~30 years of monthly price history (RELIANCE 1995→2026), vs screener.in's ~20
- [ ] EV / Price-to-Book depth: capped ~4y by free balance-sheet data (net debt, equity are ~6 annual pts); screener has deep balance sheets. PE / MCap-Sales reach ~7y.
- [ ] Pre-2018 ratio depth: XBRL index reaches 2005 but the parser reads the Ind-AS era (~2018+); pre-2016 old-taxonomy filings skipped

## App-wide
- [x] Search with ranked matches
- [x] One-tap data refresh (↻ in top-right nav)
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
- [ ] Pre-2019 as-filed history — SCOPED 12-Jul: NSE routes DEAD (annual AND
      quarterly old-format XBRLs are placeholders). BSE guessed endpoints 404-ish;
      NEXT: discover real BSE API paths via browser network inspection on
      bseindia.com's results page, then port the fetcher
- [ ] QA validators: pipeline consistency checks (price×EPS≈..., series continuity)
      flagging anomalies to a report — the data-reliability mechanism
- [ ] APK polish: pull-to-refresh, back-button handling (phone-app parity)
- [ ] 10-yr balance sheet / cash flow depth
- [ ] Weekly auto-ingest of newly filed quarters (--newer-than mode)

## After parity: "make it better" (owner's phase 2 — parked)
- Portfolio overlap with screens ("which holdings fail my quality screen?")
- CAS (CDSL monthly statement) importer
- Screen backtesting against the as-filed history we already store
