# What the other screeners do, and what Rscreener took from them

The last scan of rival apps left no record, so the work could not be checked or
continued and the request had to be repeated. This file is the record. One
section per app, what it does structurally, and the decision: taken, refused, or
queued. An idea is only ticked once it is live and verified on the deployed site.

Scanned 31-Aug-2026 by reading the live company pages.

---

## The pattern every one of them shares

**No bare numbers.** Tickertape prints "Sector PE 12.16" beside "PE 23.83".
Trendlyne labels every single metric "Above industry Median" or "High in
industry". Neither ever shows a ratio alone, because a P/E of 28 means nothing
until you know whether the industry sits at 12 or at 60.

Rscreener showed fourteen bare numbers.

- [x] **Industry median under every comparable metric** — computed in the
      browser from the rows already downloaded for the peer table, so it cost no
      pipeline run and covered all 4,746 companies the moment it shipped.
      Withheld below five companies in an industry, where a "median" is one
      firm's number wearing a statistical hat.
- [x] **Rank by size**, overall and within the industry — Tickertape's "ranked 1".
- **Refused: the colour.** Both apps paint these labels green or red. A P/E above
  the industry median is not good news or bad news, and this app does not hand
  out opinions it cannot defend. The line is grey.

---

## Tickertape (tickertape.in)

Structure: Overview · Sentiment · Forecasts · Financials · Peers · Holdings ·
Events · News.

- **Stock Scorecard** — six graded dimensions (Performance, Valuation, Growth,
  Profitability, Entry point, Red flags), each a word plus a sentence.
  **Refused as designed**: "Entry point: Good — the stock is underpriced" is a
  recommendation. The honest half of it already exists here as Pros & Cons,
  generated from the numbers by stated rules.
- **Analyst ratings and price forecasts** — not available to us at ₹0, and a
  consensus target is an opinion aggregate rather than a fact. Not queued.
- **Earnings-call summary, growth drivers, challenges** — LLM summaries of
  concall transcripts. We already list the transcripts. Queued only as a
  "read the source" link, never as generated prose presented as fact.
- [ ] **Documents grouped by financial year** — theirs lists Annual Report +
      each quarter's investor presentation under FY 2026, FY 2025, and so on. Ours
      is a flat newest-15 list. Queued: a real structural improvement.
- [x] **Peer table with the same ratios as the company** — already had it.
- [x] **Promoter holding TREND stated in words** — "in the last 3 months,
      foreign institutional holding decreased by 1.76%". We store the shareholding
      history and print it as a table; the sentence is arithmetic we already have.
      Queued, and it needs the FII/DII split that PARITY.md already tracks.
- [ ] **Pledged promoter holding** — a genuine red flag we do not carry at all.
      Queued: check whether the NSE shareholding filing exposes it.

## Trendlyne (trendlyne.com)

Structure: Overview · Buy Sell Zone · Financials · Charts & Report · News ·
Technicals · Shareholding · Deals · Corporate Actions · Alerts.

- **Durability / Valuation / Momentum scores** and "Strong Performer, Getting
  Expensive". **Refused**: a composite score whose weights are not published is
  the opposite of what this app is for.
- **"% time spent below current P/E"**, behind a subscription, wrapped in a
  "Strong Sell Zone" verdict.
- [x] **Taken, without the verdict**: "Against its own history" now shows, for
      P/E, P/B, EV/EBITDA and MCap/Sales, where today sits between the low and
      the high, the percentage of months the ratio was lower than it is now, the
      median, and — the part they omit — **the window each series actually
      covers**. It is arithmetic on series this app already publishes.
- **Immediate finding from building it**: the four bands do not reach equally far
  back. EV/EBITDA covers 42 months where P/E covers 224, because it needs net
  debt and the balance sheets only go back about four years. PARITY.md claimed
  every band reached ~2005; that claim was wrong and is now corrected there.
- **Piotroski F-score** — nine objective pass/fail checks on the financials, no
  hidden weights, publishable check by check.
- [x] **Shipped, on that condition.** All nine appear with the total, a test whose
      inputs are missing counts as neither pass nor fail, and every check was
      verified by recomputing it from the filed statements by hand.
- [ ] **Price-range bars** (day / week / month / 52-week, with today marked).
      Queued: we hold the prices; it is presentation only.
- **"Is X worth buying?" vote poll.** Refused, obviously.

## Finology Ticker (ticker.finology.in)

- [x] **Enterprise value, total debt and cash as headline essentials.** They lead
      with these and they are right to. "Debt / Equity 0.37" describes the shape
      of the funding; "Rs 3,98,000 crore of debt against Rs 2,58,147 crore of
      cash" describes the size of it, and the second is the one a reader can hold
      against the profit. Both figures were already in our export and neither was
      on the page. Shipped 31-Aug. Our EV lands within 1.4% of theirs, from
      different debt definitions - theirs standalone, ours consolidated.
- **FinStar rating.** Refused, same reason as the other composites.
- [ ] **~100 user-addable ratio columns on the COMPANY page.** We have custom
      ratios in the screener but not here. Queued.
- [ ] **Standalone vs consolidated toggle.** We publish consolidated only, and
      never say so on the page. screener.in has this too - a genuine parity gap.
      Queued, and the honest interim is a label.
- [ ] **Index membership** - "present in 62 indices", each listed and priced. No
      other app scanned shows it, and index membership drives passive flows. Needs
      an NSE constituents fetcher. Queued as real work.
- **Brands owned by the company.** No source we have. Not queued.

## Simply Wall St (simplywall.st)

- **Snowflake score** (Valuation / Future Growth / Past Performance / Financial
  Health / Dividends, each out of 6). Refused - another composite whose weights
  are not published.
- [x] **Price history and performance as one block.** 1M / 3M / 6M / 1Y / 3Y / 5Y
      change, the 52-week range with today marked on it, and beta. Every one of
      those figures was already published in data.json and NOT ONE was on the
      company page - the returns existed only as screener columns, so you could
      filter on a stock's three-year return but not read it on its own page.
      Shipped 31-Aug. Our beta for Reliance is 0.16; theirs is 0.16, computed
      independently.
- [ ] **A sentence saying what the business actually does.** They open with
      "engages in hydrocarbon exploration and production, petroleum refining...".
      We show a sector and an industry tag and nothing else. Queued - needs a
      business summary the pipeline does not currently store.
- **Community fair values and narratives.** Not for this app.

## Still to scan

StockEdge, MoneyControl, Value Research (its company URLs moved; the id-based
path 404s), Screener.in's own recent changes. PARITY.md tracks screener.in
feature by feature and stays the authority for that one.

---

# Data ceiling — what was measured, and what is not worth doing

Measured 6-Sep-2026 against the live scorecard and the database, in answer to
"is the data as accurate and as vast as it can get".

**Overall 83.6/100.** Fresh 100, Correct 94.7, Complete 73.8, **Deep 25**.

## Where the incompleteness actually comes from

The weakest fields are 5-year sales growth (28.4%) and 5-year profit growth
(19.9%), and neither is a fetching failure. Of 5,069 companies:

  1,315  already hold 6+ annual years
  2,700  BSE-only - the NSE filing archive has nothing for them, ever
    854  listed less than 6 years ago - a 5-year CAGR is genuinely impossible
     25  NSE, old enough, still thin  <- the entire fetchable gap

The NSE backfill is finished. Twenty-five companies is what is left of it.

And 2,120 companies hold EXACTLY five annual years - the Yahoo ceiling - so
they miss a 5-year CAGR by one data point. Nothing free supplies that point.

## Rejected: deriving annual years by adding up four filed quarters

A fiscal year is its four quarters for anything that flows, 2,236 companies
have quarterly filings, and the pipeline only ever read rows already labelled
annual. It looked like free depth. It was built, and then measured against the
5,291 company-years where a filed annual row AND four quarters both exist:

    median error 0.00%     within 1%: 82%     within 5%: 89%

  - so 10.6% of derived years would be materially wrong, and the worst was out
    by a factor of 26,000. The obvious culprit - Indian filers putting the
    audited full year in the Q4 slot - accounts for only 0.2% of it, so the
    remaining 552 disagreements have no cheap test to catch them.

The payoff was 472 new years and about 15 companies gaining a 5-year growth
figure. Publishing 472 numbers with a one-in-nine chance of being materially
wrong, to gain 15 companies, is a bad trade for an app whose whole claim is
that a figure can be traced and is withheld when it cannot. Reverted.

Do not rebuild this without a test that separates the 10%.

## BSE fundamentals: no structured source at zero cost

Probed BSE's public API. `FinancialResult` returns a real table of years and
quarters and 65 links per company - all of them zips of **PDFs**, not XBRL.
Every structured-looking endpoint (ComprehensiveFinancials, Financialratio,
QuarterlyResult, XBRLData, ShareHoldingPattern) returns an HTML error page.
So filed financials for the 2,700 BSE-only companies would mean extracting
tables from PDFs - not a reliable free path, and not attempted.

One endpoint does work and is worth having: `AnnualReport_New` lists annual
report PDFs per scrip - 30 years of them for Reliance. Those 2,700 companies
currently have no Documents section at all.

---

# Scan round three — 7-Sep-2026

Screener.in's own current page and MoneyControl, plus the ones already covered.
The first find was not a feature at all but a fault of ours, which is the best
argument for reading rival apps closely.

## Found by scanning: a caption that was wrong on 1,347 companies

Screener.in labels its statements "Consolidated Figures in Rs. Crores / View
Standalone" and lets you switch. Ours said "Consolidated figures in Rs Crores"
on all four tables, hardcoded, on every company. We store the real basis and
have all along: **1,851 companies file consolidated and 1,347 file standalone.**
So 42% of company pages named a basis the numbers did not have.

Standalone excludes subsidiaries. For a holding company the two are different
businesses, so the caption was describing something other than the table under
it. Fixed: each table now states the basis actually filed, and says only
"Figures in Rs Crores" where the basis was never recorded rather than guessing.
Verified - 3M INDIA reads Standalone, Reliance and ITC read Consolidated.

## Taken from screener.in, still to do

- [ ] **A median row in the peer table.** They print "Median: 8 Co." under the
      peers. We have the peer rows already; this is arithmetic on them.
- [ ] **Quarterly variation columns** - profit and sales growth against the same
      quarter a year earlier, in the peer table. We hold the quarters.
- [ ] **A TTM column** on the P&L. We already compute trailing twelve months for
      the valuation bands; the P&L does not show it.
- [ ] **Standalone/consolidated TOGGLE**, not just the label now fixed above.
      Needs both bases stored; today the fetcher keeps one.
- [ ] **"Part of" index membership** - Sensex, Nifty 50, BSE 500. Finology shows
      it too, so that is two apps. Needs an index-constituent fetcher.
- [ ] **A written description of the business** and its subsidiary structure.
      Screener.in has ABOUT and KEY POINTS with citations; Simply Wall St opens
      with the same thing. We show a sector tag and nothing else. No free
      structured source found yet - this is the biggest content gap.
- [ ] **Raw PDF link per result row**, straight to the filing behind the number.
- [ ] Company website link, and the F&O tag.

## MoneyControl

- **SWOT with counts** - Strengths (13), Weaknesses (4), Opportunities (3),
  Threats (2), each a specific rule-based line such as "FII/FPI decreased their
  shareholding last quarter". Our Pros & Cons is the same idea with less
  structure; the counts and the four-way split are worth copying.
- **"MC Essentials 53% Pass"** - a checklist pass rate, which is what our nine
  Piotroski checks already are.
- **Day range as well as the 52-week range.** We show the 52-week bar; the
  day's range is one more line from data we hold.
- **Open interest and F&O positioning.** NOT TAKEN, and not queued: F&O work
  products are out of bounds under the project's own leverage rule until the
  Phase-3 gate. Recording the decision so it is not re-proposed as an oversight.
- **Broker "Buy Now" buttons.** Refused - this app screens and never routes an
  order.
