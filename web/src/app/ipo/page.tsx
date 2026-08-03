"use client";

import Link from "next/link";
import TopNav from "@/components/TopNav";

/** Two sites that do IPOs properly, rather than a thin copy of them.
 *
 *  Rscreener used to carry its own IPO tables and a grey-market-premium snapshot.
 *  GMP is an unofficial, unregulated number quoted by dealers - it is not a price,
 *  nobody publishes it authoritatively, and there is no filing to check it
 *  against. Every other figure in this app traces back to an exchange filing;
 *  that one never could. Rather than keep a page whose numbers cannot be held to
 *  the standard the rest of the app is held to, it points at the people who make
 *  it their business. */
const SITES = [
  {
    name: "InvestorGain",
    url: "https://www.investorgain.com/report/live-ipo-gmp/331/",
    what: "Live IPO grey-market premium, subscription figures and allotment status.",
  },
  {
    name: "IPO Premium",
    url: "https://ipopremium.in/",
    what: "Open, upcoming and closed issues with GMP, lot size and listing dates.",
  },
];

export default function IpoPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="ipo" />
      <main className="max-w-2xl mx-auto px-4 py-8 sm:py-12 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">IPOs</h1>
          <p className="text-sm text-[var(--ink3)] mt-2 leading-relaxed">
            Rscreener doesn&rsquo;t track IPOs. Grey-market premium is an unofficial number
            quoted by dealers &mdash; there is no filing to check it against, so it could never
            be held to the standard everything else here is. These two sites do it properly.
          </p>
        </div>

        <div className="space-y-3">
          {SITES.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3.5
                         hover:border-[var(--line2)]"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-base font-semibold text-[var(--ink)]">{s.name}</span>
                <span className="text-[var(--ink3)] text-sm shrink-0">open &rarr;</span>
              </span>
              <span className="block text-xs text-[var(--ink3)] mt-1">{s.what}</span>
            </a>
          ))}
        </div>

        <p className="text-xs text-[var(--ink3)] leading-relaxed">
          Both open in a new tab and are not affiliated with Rscreener. Once a company lists it
          appears here like any other &mdash; search for it on the{" "}
          <Link href="/" className="hover:underline text-[var(--accent-ink)]">home page</Link>.
        </p>
      </main>
    </div>
  );
}
