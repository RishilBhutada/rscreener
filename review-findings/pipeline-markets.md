# Review findings: pipeline - ETFs, indices, commodities, gold, calendar, IPOs

Read-only review of whole files on `main` (4-Nov-2026), not diffs. Nothing here
has been fixed. Items fixed on 4-Nov-2026 were skipped (gold's MCX contract-roll
back-adjustment in `export_gold_json.front_series`, the gold headline rules, the
BEA next-year page, calendar dividend amounts, postponed meetings). Not
re-reported, as asked: the stored MCX gold contracts are thin.

Files read: `pipeline/fetch_etfs.py`, `export_etf_json.py`, `fetch_indices.py`,
`export_indices_json.py`, `fetch_commodities.py`, `commodities_lib.py`,
`export_commodities_json.py`, `fetch_ncdex.py`, `fetch_gold.py`, `gold_lib.py`
(duty and event tables), `export_gold_json.py`, `export_calendar_json.py`,
`fetch_events.py`, `fetch_result_times.py`, `fetch_ipos.py`, `ipo_lib.py`,
`export_chart_json.py`.

**CONFIRMED** = the code does this; it can be seen by reading the lines named.
**PLAUSIBLE** = the code allows it, but whether it happens depends on what the
data source actually sends, which was not checked against live data.

Ordered by how much it could mislead you, worst first.

| # | file:line | Status | The problem, in plain words | What it means for you | Suggested fix |
|---|---|---|---|---|---|
| 1 | `pipeline/fetch_commodities.py:136-142` (dating in `fetch_etfs.py:264-271`) and `pipeline/fetch_gold.py:672-688` | PLAUSIBLE (that two writers exist is certain) | Two scripts write COMEX gold (`GC=F`) closes into the same table, `commodity_world`, and **date them differently**. `fetch_commodities` dates a bar by the exchange's own clock (Yahoo's `gmtoffset`, New York); `fetch_gold` dates it in Indian time (`price_periods.ist_date`), and its own comment (`:684`) says Yahoo stamps a COMEX bar at the session's START - 6 pm New York the evening before. If so, the same session is filed one calendar day earlier by the first script. Both use `INSERT OR REPLACE` on (ticker, date). `fetch_gold` re-reads from 2020 every night (`:676`: the oldest stored date is always after 2021-01-01, because the other script keeps 5 years), overwriting most rows - but a date only the first script produces (e.g. a Sunday label for Monday's session) stays, holding a copy of the next session's close. | Gold's day moves and "how gold moved on this event" would be wrong on those days: a Sunday row equal to Monday's close makes Monday's move read 0%. The MCX-vs-world premium on the commodities page would compare MCX with the wrong COMEX session. | One writer for `GC=F` (or a separate key per script), with one dating rule; delete stored weekend-dated rows. Check one known date against CME's settlement to confirm which dating is right. |
| 2 | `pipeline/export_commodities_json.py:242-248` | CONFIRMED | The continuous "front month" chart for every commodity (`GOLD1!`, `CRUDEOIL1!` ...) is stitched from raw closes: on the roll day it jumps from one contract to the next, and the price gap between them (the carry) is drawn as a one-day move. This is the fault fixed for the gold page on 4-Nov (`export_gold_json.front_series`), still present here. | The full-screen continuous chart shows a fake jump every month or two; day change, returns, RSI/moving averages and "levels" on that chart include it. | Use the same back-adjustment as `front_series` (each day's move from that day's own contract), keeping the newest close real. |
| 3 | `pipeline/ipo_lib.py:94-109` | CONFIRMED | Listing gain = listing-day close (Yahoo, adjusted for later splits/bonuses) ÷ issue price (not adjusted). The only guard is "worse than -60% is an artifact". A later 1:1 bonus or 2:1 split halves the adjusted close: a -50% result passes the guard. | An IPO that listed at +20% and later issued a 1:1 bonus is shown as a -40% listing loss, and that wrong figure feeds the GMP scoreboard ("how accurate was the grey market"). | Divide the issue price by `trend_lib.adj_factor(splits, listing_date)` (the split history is already stored) instead of guessing from the size of the loss. |
| 4 | `pipeline/export_calendar_json.py:338-343` | CONFIRMED | The calendar's IPO listing gain uses the first number in NSE's raw issue-price text and the stored closes without any of `ipo_lib`'s protections: no check against the price band (`ipo_lib.issue_price_of` exists because NSE's issue price is "occasionally junk", e.g. 610 for a 53-57 band), no reused-symbol check, no split/bonus adjustment. | The calendar can show a different, wrong listing gain from the IPO page for the same IPO. | Use `ipo_lib.listing_gains()` (or `issue_price_of` plus the same checks) here. |
| 5 | `pipeline/export_etf_json.py:377-378` with `:117-140` | CONFIRMED | Days with no trades are filled with the last traded price ("flattened") so the chart keeps its days. The ETF's displayed `price` and `price_date` are then the last row's - a flattened day's - so a thinly traded ETF shows today's date on a price that may be weeks old. | Stale price shown as current on the ETF list and page (the "thin" flag shows, but the date says today). The premium correctly leaves such days out; the price does not. | Report the last TRADED day's close and date as `price` / `price_date`. |
| 6 | `pipeline/export_commodities_json.py:158-162` | CONFIRMED | A contract's "change" is its close against its previous TRADED bar (untraded days are dropped at `:101-102`), whatever the gap. A far-month contract that last traded two weeks ago shows a two-week move as the day's change; the list page's `chg` for the most active contract follows the same rule. | Misleading day changes on thin contracts (most far months, many agri contracts). | Compare with the previous trading day's bar only, else show no change. |
| 7 | `pipeline/export_indices_json.py:167`, `:193`; `pipeline/fetch_indices.py:97` | CONFIRMED | An index's day change is its last close against the previous STORED close, whatever its date. `fetch_indices.top_up` re-reads only from 3 days before the newest stored day, so a day whose file failed, followed by three good days, is never filled. | After such a gap, "day change" covers two sessions, and the gap stays in the chart and short returns. | Track each weekday's read like `result_times_log` and retry missing ones; compute day change only against the previous trading day. |
| 8 | `pipeline/export_etf_json.py:383` | CONFIRMED | "Average premium, 1 month" is the mean of the last 21 premium readings. Premiums exist only on traded days with a NAV, so for a thinly traded ETF those 21 readings can span several months. | A thin ETF's "1-month" average premium can be a months-old average. | Use readings from the last 30 calendar days only. |
| 9 | `pipeline/export_etf_json.py:288` vs `:325-332` | CONFIRMED | For a foreign-index ETF, the ETF page's index line uses the US close BEFORE each Indian date (`strict`), but the separate full-screen index chart file uses the close ON that date. | The chart and the ETF page's own index line and returns disagree by one US session for Nasdaq / Hang Seng ETFs. Visible on big US days. | Build both from the same function (`index_inr`). |
| 10 | `pipeline/fetch_ipos.py:126-131` | PLAUSIBLE | Current/upcoming IPO rows are written with `listing_date = NULL` by `INSERT OR REPLACE` on (symbol, issue start). If an issue is still in NSE's "current" list after listing, its stored listing date is wiped; the "past" step later in the same run restores it, but not on runs with `--skip-past`. | Between runs a listed IPO can lose its listing date: it drops out of listing-gain figures and the calendar's listings. | Upsert only the fields the current/upcoming lists carry, keeping `listing_date` and `issue_price`. |
| 11 | `pipeline/fetch_etfs.py:293-298` | CONFIRMED | Each ETF's monthly history (the long view before the 5-year daily window) is fetched once and never refreshed. | Nothing wrong yet (daily bars cover 5 years), but once an ETF's first fetch is more than 5 years old, the months between that fetch and the daily window will be missing from its full-screen chart. | Re-read monthly bars occasionally, or extend them from daily. |
| 12 | `pipeline/export_gold_json.py:115-124` | PLAUSIBLE | MCX gold's reaction day rolls to the next day for events at or after 23:00 IST, but MCX trades until 23:30 (23:55 when the US is on winter time). | An event between 23:00 and the MCX close is measured on the next session instead of the one it happened in. Rare. | Use the MCX close time for the season. |

Counts: 9 CONFIRMED (#2-9, #11), 3 PLAUSIBLE (#1, #10, #12).

Checked and looked right (not reported): gold/silver/copper/aluminium unit factors
(troy oz to 10 g, lb to kg, tonne to kg) and the crude/gas next-month shift in
`commodities_lib`; NCDEX mandi unit conversions; the NCDEX script is read-only
(login, logout, candles, quotes only); ETF NAV split adjustment and the same-day
premium rule; TER matching; index returns/CAGR spans (calendar days); the calendar's
results "move" window and its voiding on reshaping events; Fed/BEA/FRED event
times in New York time.

## Checked against the stored database (4-Nov-2026, later the same day)

| # | Verdict | What the data shows |
|---|---|---|
| 1 (COMEX gold dated two ways) | **CONFIRMED, fixed** | `GC=F` held 158 Sunday rows and repeated closes; the December contract had a Sunday 1-Nov row and no Friday 31-Oct, a day off until US clocks changed. Fixed on `main` in ab41034 (one dating rule, `commodities_lib.futures_day`). |
| 10 (IPO listing date wiped) | NOT SEEN | No listed IPO has lost its listing date. What the data does show instead: 12 "upcoming" and 1 "current" rows whose bidding closed weeks ago and never moved to "past" (e.g. MADHURKNIT, SUMAX, ESDS) - harmless today, because the calendar only lists issues still open or listing ahead. Low priority. |
| 12 (MCX 23:00 cut-off) | not testable from the database | |
