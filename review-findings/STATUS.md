# Review and fix status (5-Nov-2026)

Where everything from the 4/5-Nov-2026 review session stands, for whoever picks it up.

## Tests

`python -m pytest tests -q` (115 tests) and `cd web && npm test` (17 tests) run in
`.github/workflows/tests.yml` on every push and pull request to `main`, with
`npx tsc --noEmit`. Tests describe current intended behaviour; a test that exposes
a real bug is marked `xfail` with a reason rather than the code being changed alongside.

## Review findings (one branch each, file `review-findings/<name>.md`)

| Branch | Area |
|---|---|
| `review/findings-pipeline-core` | prices, fundamentals, ratios, screener fields (plus a section re-checking the PLAUSIBLE rows against the stored database) |
| `review/findings-pipeline-markets` | ETFs, indices, commodities, gold, calendar, IPOs (plus a data re-check section) |
| `review/findings-web-screens` | screener, watchlists, portfolio, home page |
| `review/findings-web-markets` | ETF, index, commodity, gold, calendar, news pages |
| `review/findings-results-history` | the filings reader, checked against the stored database |
| `review/findings-company-page` | company page export and display - 7 CONFIRMED, 1 PLAUSIBLE (pushed 5-Nov) |
| `review/findings-alerts-workflows` | alert scripts and workflow data safety - 11 CONFIRMED, 8 PLAUSIBLE (pushed 5-Nov) |

## Fixed on `main` (commit subjects say which finding)

Sync of portfolio / saved screens / watchlists (last saved wins); demerger lookups
retried; every exchange close checked; Yahoo ratios that stop applying go blank;
partial statements keep the rest; IPO listing gains on the listing day's share basis
(calendar too); ETF price = last traded, stale premiums dated; continuous commodity
charts back-adjusted; filings with a misread unit or a year read from its quarter
column dropped (and refused at fetch); COMEX/NYMEX bars dated one way; AGMs no longer
treated as share-count changes; split ratios read; US-listed names' dollar figures
converted; EV needs both debt and cash; PEG on 5-year growth; no negative EV/EBITDA;
day changes only against the previous session; bad prints dropped both ways;
Piotroski debt gap; portfolio import asks replace/add; index breadth, calendar day
and holdings checks say what they cover; partial BSE list carried forward; MCX event
day by its real close; gold parity dated; quarterly sales/profit shown in Cr;
notes safe in private mode; growth rates never measured across a consolidated/standalone
switch (company-page #1, CAGR part); company-page Piotroski adjusts for splits (#3);
Consolidated/Standalone choice stays with its company (#8); nightly stops if the stored
database cannot be downloaded (alerts #1); ETF premium alert sent once per crossing and
only counted when ntfy accepted it (alerts #3, #17); results alert pushes "FAILED" (alerts #6);
results tables mark a year on the other basis (company-page #1); CFO / EBITDA % uses the EBITDA
shown, consolidated years only (#2); P/E tooltip quarters add up to the trailing EPS (#4); a
refused refetch save fails the run (alerts #19); filings dated by first broadcast (pipeline-core
#8); Ind-AS tags win over older ones (results-history #4); "%" refused on non-percent fields
(web-screens #8); ETF monthly bars refreshed (pipeline-markets #11).

## Still open (confirmed, not fixed)

- alerts-workflows #9 `guarded_fetch.sh` lets exit 1 pass with a warning - by design (a source
  crash is tolerated); owner's call. The other PLAUSIBLE rows of that file are unchanged.
- Not testable without live data: pipeline-core #12 (rescale across a split), #18.

## Fixed 8-Nov-2026 (the rest of the list above it)

- alerts-workflows #2 database saves go through `pipeline/store_db.sh` (upload beside, then
  rename; last copy kept as `.prev`; nightly restore falls back to it); #4 ETF / screen alerts run
  only after the publish guards; #5 the ratchet commit runs after `check_depth.py`; #8 that push
  rebases onto current main and retries (commit 095b18cd3). #16 price alerts fire on a crossing,
  not every day beyond the level.
- company-page #5 the old-file fallback is guarded and clears peers; #6 peers, industry medians
  and industry rank from one pool (NSE basic industry with 5+ members, else the source's);
  #7 payout % puts the dividend on the post-demerger base.
- web-screens #5 sector exclusions stay exclusions (`!Sector`), keeping companies with no
  sector (screener, saved screens, holdings, backtest, screen alerts); #6 money fields are read
  in crore in a screen, as shown.
- pipeline-core #10 ratio inputs from one year (newest with income and balance sheet); #11
  payout and debtor days from that year's statement; #17 NSE's answer replaces corrected
  corporate actions from its earliest date on.
- pipeline-markets #9 foreign-index chart file dated the day a US close is known in India.
- results-history #3 unreadable filings log the symbol as due again (once).
- `alerts/screen_alerts.py` refuses "%" on a field that is not a percentage, from the
  screener's own unit list.

## Watch on the next nightly run

- The filings check drops 69 annual periods in 62 companies on its first run (none in
  `check_depth.py`'s watch list). If `check_sources.py` or `check_depth.py` fails, look there first.
- COMEX `GC=F` rows are re-dated on the first run; gold event measurements shift slightly.
- Each device's first sync after the sync fix still joins lists once, by design;
  anything wrongly brought back before should be deleted once afterwards.
