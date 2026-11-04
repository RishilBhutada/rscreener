# Review findings: web - ETFs, indices, commodities, gold, calendar, news

Read-only review of whole files on `main` (4-Nov-2026), not diffs. Nothing here
has been fixed. Items fixed on 4-Nov-2026 were skipped (ETF Years tab reloading
per ETF and weekly closes dated on the week's last day, the calendar strip's
"…" for unloaded days, news deals sorting, the gold calendar's next-year dates).

Files read: `web/src/app/etf/`, `etfs/`, `indices/` (list and `view/`),
`commodities/`, `commodity/`, `gold/`, `calendar/`, `news/`; `web/src/lib/etf.ts`,
`indices.ts`, `index-data.ts`, `commodity.ts`, `gold.ts`, `calendar.ts`,
`news.ts`, `levels.ts`; `components/EtfChart.tsx`, `IndexChart.tsx`,
`CommodityChart.tsx`, `EtfValChart.tsx`, `SpreadChart.tsx`.

**CONFIRMED** = the code does this; it can be seen by reading the lines named.
**PLAUSIBLE** = the code allows it, but whether it bites depends on data or
usage that was not checked.

The web side of these pages is in better shape than the pipeline behind them:
most wrong figures a reader could see here come from the pipeline (see
`review-findings/pipeline-markets.md`, e.g. its #2 continuous-chart roll jumps,
#5 stale ETF price dated today, #6 commodity day change). Below are only the
faults in the web code itself.

| # | file:line | Status | The problem, in plain words | What it means for you | Suggested fix |
|---|---|---|---|---|---|
| 1 | `web/src/app/etf/page.tsx:151` with `web/src/lib/etf.ts:54-58` | CONFIRMED | The ETF page's headline - "Trading 4.2% above its NAV" - is built from the LAST same-day premium on file, whatever its date. For a thinly traded ETF, or when the NAV feed lags, that pair can be days or weeks old. The date is printed only in small type under the "Premium" figure. | A stale premium is announced in the present tense as the ETF's state today - the one number this page exists to show. | When `prem_date` is not the latest price/NAV date, say so in the headline ("On 12 Oct it traded 4.2% above its NAV"). |
| 2 | `web/src/app/etfs/page.tsx:41-47`, `:105-115` | CONFIRMED | The ETFs list shows each fund's premium and price with no date, and sorts by premium across all funds - mixing today's premiums with weeks-old ones. The commodities and indices lists already mark a row whose date lags ("last traded ..."); the ETF list does not. | The top of "sorted by premium" can be led by funds whose premium is stale, read as today's biggest gaps. | Show `prem_date` when it is older than the list's `nav_asof`, and/or sort stale premiums below current ones. |
| 3 | `web/src/app/etfs/page.tsx:43-47` | CONFIRMED | Missing premiums (or 1Y returns) are given `-Infinity` and sorted with `val(b) - val(a)`. Two missing values give `-Infinity - -Infinity = NaN`, which breaks the sort's ordering rule. | Funds without a premium can appear in a jumbled, run-to-run different order, and in some browsers neighbouring rows can be misplaced. Minor. | Put nulls last explicitly (as the screener does) instead of using `-Infinity`. |
| 4 | `web/src/app/indices/view/page.tsx:121-125` | CONFIRMED | Index breadth (up / down / flat) treats a member with no data, or no day change, as `0` - so it is counted as "flat". | An index whose members include unpriced or newly listed companies shows extra "flat" members that did not trade flat. | Count "no data" separately and leave it out of up/down/flat. |
| 5 | `web/src/app/calendar/page.tsx:192-193` | PLAUSIBLE | "Today" on the calendar is the device's own date and time zone, while every event date is an Indian date. | Opened outside India (or on a phone set to another zone) around midnight, the calendar's "today", its upcoming/past split and its strip are off by a day. Matters only when travelling. | Take today in `Asia/Kolkata` (as `lib/gold.ts` does with `istDate`). |
| 6 | `web/src/app/gold/page.tsx:159-162` | CONFIRMED | The "World in ₹" parity and "MCX over world" are worked out on MCX's last day (`parity_date`), but that date is never shown; the COMEX quote shown just above may be from a later session. | On a day COMEX has traded and MCX has not (or the reverse), the card silently compares figures from different days. | Show `parity_date` under "World in ₹". |

Counts: 5 CONFIRMED (#1-4, #6), 1 PLAUSIBLE (#5).

Checked and looked right (not reported): every `YYYY-MM-DD` date in these pages is
parsed with an explicit `T00:00:00Z` / `T12:00:00Z` and formatted in UTC or IST, so
no one-day shift; chart day numbers are formatted in UTC; ETF, index, valuation and
commodity charts are remounted when the symbol changes (the page shows a skeleton
until the new symbol's file arrives), so no data from the previous symbol is shown;
the commodity page falls back to the active expiry if the picked one is absent;
index returns use the pipeline's calendar-day spans; the broker-call tally relies on
newest-first order, which the export guarantees (`ORDER BY t DESC`); support /
resistance levels skip volume shelves for volume-less index charts.
