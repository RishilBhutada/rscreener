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
- [ ] **Promoter/FII/DII holding TREND stated in words** — "in the last 3 months,
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
- [ ] Queued, as the one composite score worth having, and only if every one of
      the nine checks is shown alongside it.
- [ ] **Price-range bars** (day / week / month / 52-week, with today marked).
      Queued: we hold the prices; it is presentation only.
- **"Is X worth buying?" vote poll.** Refused, obviously.

## Still to scan

Finology Ticker, StockEdge, MoneyControl, Value Research, Simply Wall St,
Screener.in's own recent changes. PARITY.md tracks screener.in feature by feature
and stays the authority for that one.
