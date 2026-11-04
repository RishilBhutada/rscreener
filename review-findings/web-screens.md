# Review findings: web - screener, watchlists, portfolio, home page

Read-only review of whole files on `main` (4-Nov-2026), not diffs. Nothing here
has been fixed. Items fixed on 4-Nov-2026 were skipped (one pass count per
filter, "L Cr" market cap, last-saved-wins sync for price alerts / pinned
ratios / peer columns / chart presets, the backtest sector filter).

Files read: `web/src/app/screens/page.tsx`, `watchlists/page.tsx`,
`portfolio/page.tsx`, `app/page.tsx`, `web/src/lib/query.ts`, `fields.ts`,
`screen-library.ts`, `saved-screens.ts`, `watchlists.ts`, `portfolio.ts`,
`search.ts`, `store.ts`, `components/HoldingsScreens.tsx`; and, because the
portfolio and saved screens depend on it, the merge rule in `lib/sync.ts`.

**CONFIRMED** = the code does this; it can be seen by reading the lines named.
**PLAUSIBLE** = the code allows it, but whether it bites depends on data or
usage that was not checked.

Ordered by how much it could mislead you, worst first.

| # | file:line | Status | The problem, in plain words | What it means for you | Suggested fix |
|---|---|---|---|---|---|
| 1 | `web/src/lib/sync.ts:120-127` with `web/src/lib/portfolio.ts:5-18` | CONFIRMED | Holdings sync between devices as a plain **union** of the two arrays. An edited holding (new quantity or average cost) is a different object, so both the old and new copies survive the merge, and `loadPortfolio` keeps the LAST one in the merged array - the cloud copy, i.e. the older one. A holding removed on one device is still in the cloud copy and comes back. The 4-Nov fix ("the copy saved last wins") was applied to price alerts, pins, peer columns and presets, not to the portfolio. | After you edit a holding's quantity/average on one device and sync, the old quantity can come back; a stock you sold reappears. Invested, current value, P&L and day change are then wrong, with nothing on screen to say so. | Put `rscreener_portfolio` in the `WHOLE` set (saved-at timestamp, last saved wins), or merge per symbol by an `updated` time. |
| 2 | `web/src/lib/sync.ts:120-127` with `web/src/lib/saved-screens.ts:29-42` | CONFIRMED | Same union rule for saved screens: an edited screen (same name, new query or sectors) keeps both versions, and `loadSaved` keeps the later one in array order - the cloud copy. A deleted screen comes back. | Editing a saved screen's filters can silently revert to the old filters after a sync; the Saved tab's "new / left" list is then measured against the wrong rules, and the screen alerts run the old query. | As #1: last-saved-wins for `rscreener_screens`, or per-name merge by an edit time. |
| 3 | `web/src/lib/watchlists.ts:189-209` | CONFIRMED (by design, but costly) | Watchlists merge by unioning symbols and keeping every list ever seen ("nothing is deleted here"). A stock removed from a list, or a list deleted, on one device comes back at the next sync from the other. | Removals don't stick across devices - the same fault 4-Nov fixed for price alerts. Home page, calendar "your companies" and watchlist counts include names you removed. | Record removals (tombstones with a time) or keep a saved-at time per list and let the newer list win. |
| 4 | `web/src/app/portfolio/page.tsx:201-207` | CONFIRMED | Importing a broker file **replaces the whole portfolio** with that file's holdings (`savePortfolio(res.holdings)`), with no warning in the import sheet and no undo. | Importing a second broker's CSV (e.g. Zerodha then Groww) wipes the first broker's holdings. | Ask "replace or add to current holdings?", or merge by symbol. |
| 5 | `web/src/app/screens/page.tsx:319` | CONFIRMED (rule) / PLAUSIBLE (size) | Opening a ready-made screen that EXCLUDES sectors (Magic Formula: no financials or utilities) turns that into an INCLUDE list of today's other sector names. A company with no sector on record is not on any include list, so it is dropped. | Magic Formula (and any future exclude-screen) silently leaves out every company without a sector - many BSE-only companies - whether or not it is financial. A saved copy also never picks up a sector name added later. | Apply exclusions as exclusions (`!excluded.has(sector)`), keeping blank-sector companies. |
| 6 | `web/src/app/screens/page.tsx:66-86` with `web/src/lib/fields.ts:50-54` | CONFIRMED | Money fields (`revenue`, `net_income`, `total_debt`, `total_cash`, `free_cashflow`) are stored and compared in **rupees**, but shown in **crore**. The filter sheet shows the median as e.g. "₹5,234 Cr" while the box it fills holds 52,340,000,000; a hand-typed `total_debt < 1000` means ₹1,000, not ₹1,000 Cr. | A user who types crore (as every other money figure on the site reads) gets a filter off by 10 million times - usually "nothing passes" or "everything passes". | Export these in crore like `mcap`, or convert typed values in the chip editor and say "₹ Cr" in the field description. |
| 7 | `web/src/app/screens/page.tsx:74-86` with `web/src/lib/fields.ts:70-71` | CONFIRMED | `qtr_sales` and `qtr_profit` have unit `"₹ Cr"` (with a space). `fmtVal` only knows `"₹Cr"` and `"₹"`, so these values print as bare numbers with no unit. | "Sales qtr 1,234.5" with no ₹ or Cr in result rows and the filter sheet. Cosmetic but ambiguous next to rupee prices. | Use one unit spelling, or handle `"₹ Cr"` in `fmtVal`. |
| 8 | `web/src/lib/query.ts:143` | CONFIRMED | A `%` after any number is silently ignored. That is right for percent fields, but `de < 50%` is read as D/E < 50 (D/E is a plain ratio, 0.5 = 50%). | A filter written as a percentage on a ratio field passes almost every company, with no error. | Reject `%` on fields whose unit is not a percentage, or convert (50% → 0.5) for ratio fields. |
| 9 | `web/src/components/HoldingsScreens.tsx:44-55` | CONFIRMED | Holdings not in the company table (ETFs, unpriced BSE scrips) are dropped before counting, so "pass · fail · ?" adds up to fewer than your holdings, with no line saying how many were not checked. | You may read "3 pass · 2 fail" as your whole portfolio when 4 more holdings were never tested. | Show "n not checked (not companies / no data)". |
| 10 | `web/src/app/portfolio/page.tsx:94-108`, `web/src/app/page.tsx:125-138` | PLAUSIBLE | Holdings are stored as entered (qty, average cost) and never adjusted for splits/bonuses, while the price is post-split. Manually entered holdings are not corrected after a 1:1 bonus. Also, the day's ₹ move uses `ret_1d` with no check of the price's date (index.json carries none), so a stale price contributes an old day's move. | After a bonus/split, a manually entered holding shows a ~50% loss that did not happen until you edit it. The day-change total can include moves from days ago. | Warn when a `splits` / bonus ex-date falls after the holding was entered; carry `price_date` in index.json and leave out stale day moves. |
| 11 | `web/src/lib/store.ts:17-22` | CONFIRMED | `saveNote` writes to localStorage without a try/catch (the other writers all have one). | In private browsing or with a full quota, saving a company note throws and the note is lost without a message. | Wrap it like `pushRecent`. |

Counts: 10 CONFIRMED (#1-9, #11), 1 PLAUSIBLE (#10).

Checked and looked right (not reported): the query parser's precedence, brackets and
three-valued and/or (a missing figure excludes, never passes, never counts as zero);
division by zero gives "missing"; nulls sort last in both directions on the screener,
watchlists and portfolio; Magic Formula's rank-sum; portfolio totals leave unpriced
holdings out on both sides; weighted P/E via earnings yield; search ranking.
