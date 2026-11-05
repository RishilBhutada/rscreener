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
| `review/findings-alerts-workflows` | alert scripts and workflow data safety (if pushed) |

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
day by its real close; gold parity dated.

## Still open (confirmed, not fixed)

From `review/findings-company-page` (not yet looked at by anyone):
- #1 the yearly results table can switch from consolidated to standalone at FY25/FY26 (years rebuilt
  from quarters on the other basis), with growth worked out across the switch - 88 companies in the
  data (CERA, JYOTHYLAB, SANOFI, TIMKEN, AGI...). Highest priority.
- #2 "CFO / EBITDA %" divides by operating profit without other income, and mixes Yahoo's group
  cash flow with a possibly parent-only filed profit.
- #3 the page's Piotroski "owners not diluted" test counts a bonus or split as dilution.
- #4-#8 P/E tooltip EPS not split-adjusted; peers vs industry medians from different groupings;
  payout % before a demerger; Consolidated/Standalone choice carried to the next company.


- web-screens #5 Magic Formula / exclude-sector screens drop companies with no sector.
- web-screens #6 money filters compared in rupees, shown in crore.
- web-screens #7 `qtr_sales` / `qtr_profit` shown without "₹ Cr".
- web-screens #8 `%` silently ignored on ratio fields (`de < 50%`).
- web-screens #11 company notes not saved in private mode.
- pipeline-core #8 / results-history #5 filings dated by revised, not broadcast, date.
- pipeline-core #10, #11 ROCE / payout / debtor days period mismatches (small).
- pipeline-core #17 corrected corporate actions stored twice (17 pairs).
- pipeline-markets #9 foreign-index ETF chart vs page one session apart; #11 ETF monthly bars never refreshed.
- results-history #3 a failed filing waits up to 180 days in the deep pass; #4 tag precedence.
- Not testable without live data: pipeline-core #12 (rescale across a split), #18.

## Watch on the next nightly run

- The filings check drops 69 annual periods in 62 companies on its first run (none in
  `check_depth.py`'s watch list). If `check_sources.py` or `check_depth.py` fails, look there first.
- COMEX `GC=F` rows are re-dated on the first run; gold event measurements shift slightly.
- Each device's first sync after the sync fix still joins lists once, by design;
  anything wrongly brought back before should be deleted once afterwards.
