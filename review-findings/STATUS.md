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
only counted when ntfy accepted it (alerts #3, #17); results alert pushes "FAILED" (alerts #6).

## Still open (confirmed, not fixed)

From `review/findings-company-page` (not yet looked at by anyone):
- #1 (rest) the yearly results table still carries one caption although its newest years can be on the
  other basis (88 companies); growth across the switch is now refused, but the table should mark it.
- #2 "CFO / EBITDA %" divides by operating profit without other income, and mixes Yahoo's group
  cash flow with a possibly parent-only filed profit.
- #4-#8 P/E tooltip EPS not split-adjusted; peers vs industry medians from different groupings;
  payout % before a demerger.

From `review/findings-alerts-workflows`:
- #2 every database save deletes the stored copy before uploading (no backup if an upload dies).
- #4 ETF and screen alerts run before the publish guards; #5 the depth baseline is committed before
  check_depth raises it; #8 the nightly's state push fails if main moved; #9 guarded_fetch.sh hides
  exit 1 crashes; #19 a refused refetch save exits green; plus the PLAUSIBLE rows in the file.

From the earlier reviews:
- web-screens #5 Magic Formula / exclude-sector screens drop companies with no sector.
- web-screens #6 money filters compared in rupees, shown in crore.
- web-screens #8 `%` silently ignored on ratio fields (`de < 50%`).
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
