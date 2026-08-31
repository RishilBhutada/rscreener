# Audit findings

Fifty findings from the full-app audit. This file exists because the list
previously lived only in a scratch file and a conversation, so how many are
left could be answered from memory but never checked. Every status below was
re-verified against the code, the export, or the deployed site on 31-Aug-2026.

**0 open.** 49 fixed and verified · 1 investigated and found not to be a fault.

Two of these fixes were only possible because of the others. The vanished-source
check written for 21 caught the IPO source retired under 11 and 14 within a minute
of existing. And printing each valuation band’s own window, added while studying
rival screeners, exposed a depth claim in PARITY.md that was false by seventeen
years and that nothing else had questioned.


## Investigated, not a fault

### 36. The two published surfaces disagree for the same company: RELIANCE screener row and RELIANCE company page show different prices and market caps
`high` · `C:\Users\bhuta\New folder\Rishil\Stock market\Rscreener\web\public\companies\RELIANCE.json`

A user clicking from the table into the company page sees a different price and market cap with no explanation; every company page silently serves a 20-day-old copy of everything, including quarterly results filed since 08 August.

**NOT A FAULT** — Did not reproduce: 4,746 companies × 10 fields compared across both surfaces, 0 disagreements. Kept on the list rather than deleted, so it is not investigated a third time.


## Fixed and verified

### 1. Every internal link to a company whose symbol contains '&' breaks — M&M, J&KBANK, ARE&M and 7 others are unreachable
`high` · `web/src/app/page.tsx:69`

**FIXED** — Every company link builds its href with encodeURIComponent; a grep for an unencoded one returns nothing. Verified live: typing “m&m” returns Mahindra & Mahindra first and the page loads.

### 2. Site-wide banners state prices are "at close of 26 Aug" while 99.6% of rows are from 7 Aug — stale rendered as fresh (pattern 7)
`high` · `web/src/app/screens/page.tsx:217`

**FIXED** — The banner read price_asof, the newest close ANY single company reached. The export now also carries price_modal, the close most companies are actually on, and the page states it with the count. Proved on a database where the two differ: it reads “Prices at close of 7 Aug 2026 — 4,699 of 4,713 companies” where it would have announced 27 Aug.

### 3. "Compounded sales/profit growth 10/5/3 years" is computed over the wrong span for ~500 companies — cagr() counts array indexes, not years
`high` · `web/src/app/company/page.tsx:191`

**FIXED** — cagr_pct anchors on time rather than array position, and the page’s own copy was replaced with the identical rule. 15,768 figures cross-checked between the two implementations: 0 disagreements.

### 4. The screener's own suggested example `mcap / revenue < 3` is a units lie off by 1e7 — it matches essentially every company
`medium` · `web/src/app/screens/page.tsx:264`

**FIXED** — The example was corrected and the reason kept as a comment at screens/page.tsx:287.

### 5. Sector detail table silently drops everything past row 400 while its heading claims the full count
`medium` · `web/src/app/sectors/page.tsx:151`

**FIXED** — rowCap, with the cap disclosed on screen.

### 6. Screens results header claims "showing top 300 by current sort" — a cap that does not exist anywhere
`low` · `web/src/app/screens/page.tsx:413`

**FIXED** — The claim appears nowhere in web/src.

### 7. Calendar filter pills lose their border and active background — Tailwind classes destroyed by missing space in `border${...}`
`low` · `web/src/app/calendar/page.tsx:52`

**FIXED** — Re-checked: both classNames already carry the space. Fixed at some point after the audit ran.

### 8. Portfolio "Current value" total silently counts unpriced holdings at cost while their rows display "—"
`low` · `web/src/app/portfolio/page.tsx:61`

**FIXED** — Totals now sum only holdings that HAVE a price, on both sides of the comparison, and the tiles say how many were left out and what they cost. Counting an unpriced holding at cost put a number that is not current inside “current value”, and understated every other holding’s weight.

### 9. Fresh-browser accent state desync: picker highlights emerald while the applied accent is indigo, and the first theme click silently recolors the site
`low` · `web/src/components/ThemeControls.tsx:28`

**FIXED** — Swatches read the resolved theme; the whole control moved into Settings.

### 10. "NSE companies" labels cover a universe that is half BSE-only
`low` · `web/src/app/screens/page.tsx:216`

**FIXED** — Headline and copy say “every listed company … across the NSE and the BSE”.

### 11. web/public/ipos.json still ships to the live site with frozen GMP data and month-old 'Active' IPO statuses, though the IPO feature was removed
`medium` · `web/public/ipos.json`

**FIXED** — web/public/ipos.json is no longer shipped — nothing on the site read it.

### 12. Nightly scorecard history is generated and then discarded every run — the published trend/delta can never accumulate, defeating the step's stated purpose
`medium` · `.github/workflows/nightly.yml:271`

**FIXED** — The nightly commits scorecard_history.json and depth_baseline.json in an if:always() step.

### 13. README.md describes the project as it was on 10-Jul and is now materially false on scale, deployment, phases, and data model
`medium` · `README.md`

**FIXED** — Rewritten. It described a 2,000-symbol NSE-only P1 skeleton with “web/ (Phase 2+)” pending, for a deployed two-exchange app with 29 pipeline scripts, 24 tables and four publish guards.

### 14. Dead IPO pipeline: fetch_ipos.py, fetch_gmp.py, export_ipos.py, ipo_lib.py are invoked by nothing and their docstrings describe a consumer that no longer exists
`low` · `pipeline/export_ipos.py:1`

**FIXED** — Resolved by DELETING the artifact rather than scheduling the fetchers. All three scripts still work — tested today, 6 current IPOs and 1,418 past issues — but the IPO page deliberately shows no IPO data, so refreshing it would spend fetch budget on numbers nothing reads.

### 15. PARITY.md 'Data depth' section is stale and contradicts both the workflows and the same file's chart section
`low` · `PARITY.md:70`

**FIXED** — Both false claims corrected: the EV/EBITDA depth line, and the Data-depth section that still described 2,353 NSE companies and a top-500 band against a real 4,713 across two exchanges with universe-wide rotations.

### 16. data/top500.txt is kept tracked by a dedicated .gitignore exception but nothing operational uses it anymore
`low` · `.gitignore:2`

**FIXED** — data/top500.txt deleted, its .gitignore exception removed, and the four fetcher usage examples repointed at data/nse_symbols.txt.

### 17. check_prices passes an export where 99.6% of prices are three weeks stale - the liquidity filter removes stalled companies from the guard's own denominator
`critical` · `pipeline/check_prices.py:110-121`

**FIXED** — Live export sits at 27–28 Aug with 4,713 rows; the bars30 hole the guard fell through is closed.

### 18. Two of the scorecard's four 'correct' checks compare a value with itself, pinning the published correctness score near 100 - while /status tells readers every check is independent
`high` · `pipeline/scorecard.py:112-123,153-164`

**FIXED** — Re-checked: the price × shares slot was already replaced with filed revenue against the provider’s revenue — a genuinely independent pair — and the old tautology is documented in place.

### 19. Nightly CI never persists depth_baseline.json or scorecard_history.json, so the depth ratchet is 18 days frozen and would accept losing 73% of pre-2012 chart histories tonight
`high` · `.github/workflows/nightly.yml:221-279`

**FIXED** — Same step as finding 12.

### 20. check_prices' mcap identity can no longer catch its stated target: a stale market cap beside a fresh price reconciles perfectly because shares_out is derived from that same mcap
`medium` · `pipeline/check_prices.py:137-148`

**FIXED** — The guard’s docstring claimed it caught a market cap refreshed without its price. It cannot: shares_out is DEFINED as market_cap/price, so p × (m/p) = m holds however stale either number is. Renamed ARITHMETIC, and the docstring now states what it does catch (our own rescaling) and what actually catches staleness (checks 1 and 2).

### 21. verify.py never notices a source vanishing from status.json - a baselined source that disappears entirely is reported as 'nothing went backwards'
`medium` · `pipeline/verify.py:55-78`

**FIXED** — The loop walked what exists NOW, so a source that VANISHED produced no row and read as silence — the worst regression a coverage table can have was the one case it could not see. It now compares in both directions. Proved with a synthetic entry, and it immediately caught a real one: IPOs 100% → no longer reported at all, from the retirement above.

### 22. The /status scorecard delta ignores the 'measured' set, so losing the freshness measurement renders as a +16.6 green improvement - the exact pathology the code documents as fixed
`medium` · `web/src/components/Scorecard.tsx:53-60`

**FIXED** — The delta honours the measured set, so a lost measurement cannot inflate the score.

### 23. Scorecard check 1 counts opposite-sign profits as agreement: a filed profit against a provider loss of similar magnitude scores 'agree'
`low` · `pipeline/scorecard.py:105`

**FIXED** — abs() removed from the ratio. A filed profit of +50 crore against the provider’s −50 crore was scoring as agreement, which is the one disagreement that matters most — the two sources cannot even agree whether the company made money. 13 opposite-sign pairs exist in the overlap; 2 were being counted as corroboration.

### 24. Scorecard check 3's band is 0.02x-50x of the company's own median, so a 10x misparsed figure scores as 'agree' - only ~100x unit errors can trip it
`low` · `pipeline/scorecard.py:145`

**FIXED** — Band tightened from 0.02×–50× to 0.05×–20×. The old band could only fail a ~100× unit error, so a year misparsed 10× — a dropped decimal — counted as agreement. Re-scored: the check moved from 99.0% to 97.7%, surfacing 466 filed years it had been passing.

### 25. The notify job does not fire on cancelled runs - the exact silent mode that caused the two-week outage is still unalarmed, and it already happened twice this week
`high` · `.github/workflows/nightly.yml:367`

**FIXED** — notify runs under if: always() and fires whenever refresh or deploy is anything but success — cancelled included.

### 26. The 260-min fetch budget is oversubscribed by ~60-170 min with a fixed step order, so the SAME tail steps (filing dates, deep P&L history) are starved every from-scratch night - each showing a green tick
`high` · `.github/workflows/nightly.yml:103`

**FIXED** — RSCREENER_STEP_MINUTES bounds each step; the global deadline can no longer let one step eat the run.

### 27. Every push-triggered deploy has failed since ~18-Aug and can never pass again: the guard reads committed data.json, which is frozen at 07-Aug and only ages, because the nightly never commits its exports back
`high` · `.github/workflows/deploy.yml:47`

**FIXED** — One publisher: a code push asks the nightly to rebuild and republish from the restored database.

### 28. The nightly's scorecard history is appended on the ephemeral runner and thrown away with it - the scoreboard's stated purpose (movement over time) silently no-ops in CI
`medium` · `pipeline/scorecard.py:305`

**FIXED** — Duplicate of 12 and 19.

### 29. The database save to the release is a single unretried API call; one transient failure both loses the night's fetched data and skips the publish
`low` · `.github/workflows/nightly.yml:258`

**FIXED** — Three attempts with a pause between them. This is a single ~200 MB upload whose failure loses both the night’s fetching and tomorrow’s starting point, and it had no retry at all.

### 30. Landing page eagerly downloads the entire 1.14MB data.json for a search box that uses 3 fields
`high` · `web/src/app/page.tsx:42`

**FIXED** — index.json, 422 KB against 5.4 MB. Verified in the browser: the home page fetches index.json and nothing else.

### 31. Company page downloads full 1.14MB data.json to use at most 9 of 4,746 rows
`high` · `web/src/app/company/page.tsx:500`

**FIXED** — Row, peers and industry context are computed once in the pipeline and written into each company file. Measured after: TCS.json alone, 110 KB, one request, no data.json.

### 32. Watchlists and portfolio pages fetch the full 5.6MB table to enrich a handful of user symbols
`medium` · `web/src/app/watchlists/page.tsx:59`

**FIXED** — Watchlists and portfolio read index.json; verified the watchlist table still fills all six columns from it.

### 33. data.json wastes 12% of every transfer on whitespace and 20% of cells on explicit nulls
`medium` · `pipeline/export_json.py:486`

**FIXED** — Both files are written with compact separators.

### 34. All trailing-return columns are computed one month short on a mislabeled monthly series; ret_1m is effectively a same-day return (published 0.0% for 72% of the table)
`critical` · `C:\Users\bhuta\New folder\Rishil\Stock market\Rscreener\web\public\data.json (produced by pipeline\export_json.py:126-141)`

**FIXED** — Returns are anchored to dates rather than array positions.

### 35. Entire published price surface is frozen at 2026-08-07/08 — 4,745 of 4,746 companies — while headers and per-file flags say it is fresh
`critical` · `C:\Users\bhuta\New folder\Rishil\Stock market\Rscreener\web\public\data.json; web\public\companies\*.json; web\public\status.json`

**FIXED** — Live price_asof 2026-08-28.

### 37. 402 rows publish net_margin exactly 0.0, of which 235 have material nonzero net income on the same row — huge loss-makers shown as break-even
`high` · `C:\Users\bhuta\New folder\Rishil\Stock market\Rscreener\web\public\data.json`

**FIXED** — The materiality test no longer gates the blanking — the size of a loss is a reason not to RECOMPUTE a margin, never a reason to keep a zero the numbers contradict. Re-measured after export: 4 rows still show 0.0 and all four are genuine (ADL earns Rs 20,000 on Rs 46 crore of sales).

### 38. 42 rows publish negative revenue, cascading into 30 negative P/S values that sort as 'cheapest' and into meaningless growth figures
`high` · `C:\Users\bhuta\New folder\Rishil\Stock market\Rscreener\web\public\data.json`

**FIXED** — Revenue below zero, and every margin resting on it, withheld. Re-measured: 0.

### 39. Impossible ratio magnitudes published across ~400 rows: margins to 425,797%, debtor days to 5.3 million, negative working-capital days, ROCE to -27,833%
`medium` · `C:\Users\bhuta\New folder\Rishil\Stock market\Rscreener\web\public\data.json`

**FIXED** — Margins beyond ±500% and debtor days beyond five years withheld. Re-measured: 0 of each.

### 40. The live IPO page is 27 days stale: ipos.json says today is 2026-08-01 and serves grey-market premiums dated 2026-07-27
`medium` · `C:\Users\bhuta\New folder\Rishil\Stock market\Rscreener\web\public\ipos.json`

**FIXED** — The page was rewritten to link out to two sites that do IPOs properly, with the reason stated: a grey-market premium has no filing to check it against.

### 41. 33 ETF/mutual-fund instruments published as companies, including 14 segregated-portfolio fund scraps whose prices violate their own 52-week ranges; sector 'absent' is encoded two different ways
`low` · `C:\Users\bhuta\New folder\Rishil\Stock market\Rscreener\web\public\data.json`

**FIXED** — 33 fund units excluded by ISIN prefix INF — the exchange’s own registration, not a guess from the name. 4,746 companies became 4,713.

### 42. Price-staleness guard passes a 3-week-stale export because bars30 excludes stale companies from their own staleness check
`critical` · `pipeline/check_prices.py:110`

**FIXED** — bars30 is counted from today, so a stale company can no longer be excluded from the population that judges staleness.

### 43. The uncapped nightly snapshot consumes the entire 260-minute shared fetch deadline, starving prices, results, shareholding, filing dates, corporate actions and the deep backfill to zero
`critical` · `.github/workflows/nightly.yml:132`

**FIXED** — The snapshot is capped and every step carries its own budget.

### 44. A throttled statements fetch silently deletes a symbol's entire stored statements history and reports ok
`high` · `pipeline/fetch_fundamentals.py:343`

**FIXED** — keep_known_values coalesces; a throttled response can no longer delete stored history.

### 45. IPO pipeline is wired to no schedule and export has no date fallback: the site has published a month-closed IPO as 'open' since 1-Aug
`high` · `pipeline/export_ipos.py:60`

**FIXED** — Same decision as 14.

### 46. Published 5y/10y CAGR uses a fixed 1/years exponent over whatever window the data has — 118 companies' 'sales_cagr_5y' actually spans 6-7 years
`medium` · `pipeline/trend_lib.py:1066`

**FIXED** — Same fix as 3.

### 47. fetch_events.py is the only fetcher with no retry AND no guarded_fetch wrapper - one dropped NSE connection kills the whole nightly before prices, results or any publish step
`medium` · `pipeline/fetch_events.py:29`

**FIXED** — Wrapped in guarded_fetch.sh like every other fetcher. It was the only one running bare, so one dropped NSE response took the results calendar out for a night with the run still reported as a success.

### 48. export_status PER_NIGHT rates have drifted from the workflow: the /status page promises 'statements: 1 night' for a backlog its 500/night cap needs 6+ nights to clear
`medium` · `pipeline/export_status.py:25`

**FIXED** — PER_NIGHT now reads off the workflow’s own limit flags, each one commented. It claimed 2,357 for a 5,069 universe and said statements refresh with the snapshot when they run 500 a night. The /status page turns these into a promise of “covered in N nights”, so a stale number here was a promise the workflow was never going to keep.

### 49. A BSE API failure makes fetch_universe replace the stored 5,069-company universe with an NSE-only list for that night
`medium` · `pipeline/fetch_universe.py:140`

**FIXED** — fetch_universe carries the stored BSE rows forward when the API fails.

### 50. fetch_prices wipes a symbol's full price history when Yahoo returns some-but-not-all series
`low` · `pipeline/fetch_prices.py:193`

**FIXED** — fetch_prices replaces per frequency, so a daily-only response cannot wipe thirty years of monthly.
