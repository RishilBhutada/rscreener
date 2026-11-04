# Review findings: `pipeline/fetch_results_history.py` (the filings reader)

Read-only review of the whole file on `main` (4-Nov-2026). Nothing here has been
fixed. This is the script that reads every company's results from NSE (XBRL
since ~2018, the older HTML detail sheets before that) into `results_history`,
the source of every P/E, growth figure, results table and trend chart.

Unlike Parts 2-5, the suspicions here were **checked against the real stored
database** (the `data-db` release as of 4-Nov-2026, opened read-only), and the
worst ones were run through `trend_lib.build_trends` to see what reaches the
pages. Numbers below are from that check.

**CONFIRMED** = seen in the code AND in the stored data.
**PLAUSIBLE** = the code allows it; the data neither shows nor rules it out.

| # | file:line | Status | The problem, in plain words | What it means for you | Suggested fix |
|---|---|---|---|---|---|
| 1 | `pipeline/fetch_results_history.py:178-186`, `:210` (old HTML sheets) and the XBRL path | CONFIRMED | Some filings are stored **100× or 1,000× off** - a unit read wrongly. In the stored data, consecutive periods jump by about 100×, 1,000× or 100,000× for **70 annual figures (53 companies) and 270 quarterly figures (141 companies)**, from 2005 to 2026. After the pipeline's own outlier filters (`trend_lib`: the 20× quarterly spike test and the 5× cross-source test, which only covers years Yahoo also has), **49 companies' annual tables and 69 companies' quarterly tables still carry such a jump**. Clear examples, as the trend builder outputs them (₹ Cr): CONCOR FY14 5,108.5 → **FY15 61.5** → FY16 6,306.2; Bank of Baroda FY13 40,952.7 → **FY14 460.2** → FY15 50,364.2; Chennai Petroleum FY13 42,883.3 → **FY14 493.4** → FY15 41,866.0; Balaji Amines FY15 6.2 between 610 and 643. The 100× pattern (values in crore read with a lakh multiplier) points at the old sheets' unit detection: it takes the first "Amount (Rs. in …)" header it finds and knows only crore, million and lakh - no "lacs" or thousands - and a sheet whose header disagrees with its figures cannot be caught. Some of the 49/69 may be shell companies whose revenue really did change. | Wrong bars on those companies' revenue/profit charts and results tables, wrong margins for those periods, and any growth figure, CAGR or valuation band whose start or end lands on a bad year. The figure looks real on screen. | (a) Store nothing from a sheet whose unit cannot be read; add "lacs" and "thousand". (b) On parse, check each period's revenue against the same company's neighbouring periods and refuse a ~100×/1,000× step that comes back (the annual series has no such test today; the quarterly one catches only a single-quarter spike of 20×+). (c) Re-fetch the companies listed by a one-off scan like the one used here. |
| 2 | `pipeline/fetch_results_history.py:271` (and the HTML path) | CONFIRMED (15 periods) | For an annual filing, the full-year figures are read from the year-to-date column (`FourD`), but if that is missing the code **falls back to the quarter column** (`OneD`) and stores one quarter as the whole year. In the stored data, **15 annual revenue figures (14 companies) and 10 annual profit figures exactly equal that year's March-quarter figure**, e.g. Heritage Foods FY2015 (₹2,073 Cr both), Gallantt FY2006, Oriental Trimex FY2016. In some of these the quarterly row is the wrong one (it holds the year). | A year shown at a quarter's size (or a quarter at a year's size) on those companies' tables and charts; a 4× error passes the 5× cross-source test. Few companies, but the error is large. | Do not fall back from `FourD` to `OneD` for an annual filing - store nothing for that year instead (the four-quarter sum then fills it). Refuse to store an annual figure equal to its own March quarter. |
| 3 | `pipeline/fetch_results_history.py:617-629`, `:643-647` | CONFIRMED (code) | A filing whose document fails to download or parse is counted as "skipped", but the company is still logged as fetched with no error. The weekly pass will see it again in a week; the **deep (full-history) pass logs it for 180 days**. | A missing old quarter can stay missing for six months, shortening charts and breaking the four-quarter sums that need it, while the run looks clean. | Log the periods that failed and retry just those on the next run. |
| 4 | `pipeline/fetch_results_history.py:85`, `:268` | CONFIRMED (code) / PLAUSIBLE (impact) | The comment says the older tag names are a fallback and "setdefault keeps Ind-AS values when both taxonomies appear in one file", but the code simply assigns, so whichever tag comes LAST in the file wins. | If a filing carries both an Ind-AS and an older tag for the same item with different values, the older one can win. No case was looked for in the data. | Read the Ind-AS tags first and use the older ones only for items still missing, as the comment says. |
| 5 | `pipeline/fetch_results_history.py:399` | CONFIRMED (already reported) | The results watcher dates a quarter by its **revised** date rather than its broadcast date. Same fault as `pipeline-core` #8; listed here so it is fixed in both places. | See `pipeline-core` #8. | Use `broadcast_Date`. |

Counts: 4 CONFIRMED (#1-4), 0 PLAUSIBLE; #5 repeats pipeline-core #8.

Checked and looked right (not reported): the old sheets' "Total expenditure" convention
(interest folded back in so EBITDA is computed the same way in every era); EPS read
unscaled; the bank P&L shape (interest earned as revenue, filed operating profit);
quarterly picks limited to filings that span ~one quarter; consolidated preferred over
standalone, one basis per period (the stored data has no period stored twice with
different values); the segment note parser.

How the data was checked (for whoever fixes this): download `rscreener.db.gz` from the
`data-db` release, then for each company and item list consecutive periods' revenue
and flag ratios within ±0.25 of 10², 10³ or 10⁵ on a log scale; run
`trend_lib.build_trends` on just those companies (temp tables, as `export_json --symbols`
does) to see which survive into the published tables.
