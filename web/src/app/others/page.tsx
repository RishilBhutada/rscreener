"use client";

import { ReactNode } from "react";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { Group, PageTitle, Row } from "@/components/ListUI";

/** Other people's sites, grouped by what you would go to them for.
 *
 *  Everything here is a link out. None of it can be held to the standard the
 *  rest of the app is - grey-market premiums have no filing behind them, and
 *  another site's portfolio tables are its own reading of the shareholding
 *  filings - so it is kept apart from the data this app produces and checks,
 *  and labelled as someone else's. IPOs used to be a destination of their own
 *  in the menu; they are one group here now. */

type Site = { name: string; mark: string; url: string; what: string };

const GROUPS: { id: string; title: string; tip?: ReactNode; sites: Site[] }[] = [
  {
    id: "ipo",
    title: "IPO",
    tip: (
      <p>
        Rscreener does not track IPOs. Grey-market premium is an unofficial number quoted by
        dealers &mdash; there is no filing to check it against. Once a company lists, it appears
        in Rscreener like any other.
      </p>
    ),
    sites: [
      { name: "InvestorGain", mark: "IG", url: "https://www.investorgain.com/report/live-ipo-gmp/331/",
        what: "Live GMP, subscription and allotment" },
      { name: "IPO Premium", mark: "IP", url: "https://ipopremium.in/",
        what: "Open, upcoming and closed issues" },
    ],
  },
  {
    id: "data",
    title: "Important data",
    sites: [
      { name: "Forex Factory", mark: "FF", url: "https://www.forexfactory.com/calendar",
        what: "Global economic calendar" },
    ],
  },
  {
    id: "investors",
    title: "Celebrity investors",
    tip: (
      <p>
        What well-known investors hold, as these sites read it from the shareholding filings.
        Their tables, not Rscreener&rsquo;s &mdash; check against the filing before relying on one.
      </p>
    ),
    sites: [
      { name: "Trendlyne", mark: "T", url: "https://trendlyne.com/portfolio/superstar-shareholders/index/",
        what: "Superstar shareholders" },
      { name: "Finology Ticker", mark: "F", url: "https://ticker.finology.in/investor",
        what: "Investor portfolios" },
    ],
  },
];

export default function OthersPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="others" />
      <main className="max-w-xl mx-auto px-4 pt-6 sm:pt-10 pb-12">
        <PageTitle>
          Others
          <InfoTip title="Others" className="ml-2">
            <p>Links to other websites. Each opens in a new tab.</p>
            <p>None is affiliated with Rscreener, and their numbers are theirs &mdash; not checked by this app.</p>
          </InfoTip>
        </PageTitle>
        {GROUPS.map((g) => (
          <Group key={g.id} title={g.title} tip={g.tip}>
            {g.sites.map((s) => (
              <Row
                key={s.url}
                icon={<span className="text-[12px] font-bold tracking-tight">{s.mark}</span>}
                title={s.name}
                sub={s.what}
                href={s.url}
                external
              />
            ))}
          </Group>
        ))}
      </main>
    </div>
  );
}
