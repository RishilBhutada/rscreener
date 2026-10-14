"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { PageTitle, Segmented } from "@/components/ListUI";
import { Chips } from "@/components/QuoteUI";
import { loadIndex, symbolHref } from "@/lib/index-data";
import { allWatched } from "@/lib/watchlists";
import { loadPortfolio } from "@/lib/portfolio";
import { COMMODITY_WORDS, NewsDoc, inr, loadNews, qtyShort, since } from "@/lib/news";

/** News, broker calls, deals and stake changes (owner, 15-Oct-2026), kept
 *  current through the day by the news watcher. Headlines and calls are other
 *  people's words, linked to where they were published; deals and SAST
 *  filings are the exchange's own disclosures. */

type Tab = "news" | "calls" | "deals" | "sast";
type Scope = "all" | "mine" | "commod";

const tone = (b: string | null | undefined) =>
  b === "Buy" ? "text-[var(--pos)]" : b === "Sell" ? "text-[var(--neg)]" : "text-[var(--ink2)]";

export default function NewsPage() {
  const [doc, setDoc] = useState<NewsDoc | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("news");
  const [scope, setScope] = useState<Scope>("all");
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [now, setNow] = useState(0);

  useEffect(() => {
    loadNews().then((d) => { setDoc(d); setNow(Date.now()); }).catch((e) => setError(String(e.message ?? e)));
    setMine(new Set([...allWatched(), ...loadPortfolio().map((h) => h.symbol)]));
    loadIndex().then((ix) => setNames(new Map(ix.rows.map((r) => [r.symbol, r.name])))).catch(() => {});
  }, []);

  const name = (s: string) => names.get(s) ?? s;
  const keep = (syms: string[], text: string) =>
    scope === "all" ? true : scope === "mine" ? syms.some((s) => mine.has(s)) : COMMODITY_WORDS.test(text);

  const items = useMemo(() => (doc?.items ?? []).filter((n) => keep(n.syms, n.title)), [doc, scope, mine]); // eslint-disable-line react-hooks/exhaustive-deps
  const calls = useMemo(() => (doc?.calls ?? []).filter((c) => keep(c.sym ? [c.sym] : [], c.title)), [doc, scope, mine]); // eslint-disable-line react-hooks/exhaustive-deps
  const deals = useMemo(() => (doc?.deals ?? []).filter((d) => keep(d.sym ? [d.sym] : [], d.name ?? "")), [doc, scope, mine]); // eslint-disable-line react-hooks/exhaustive-deps
  const sast = useMemo(() => (doc?.sast ?? []).filter((s) => keep(s.sym ? [s.sym] : [], s.company ?? "")), [doc, scope, mine]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (s: string) => (
    <Link key={s} href={symbolHref(s)} className="text-[11px] font-semibold rounded px-1.5 py-0.5 bg-[var(--card2)] text-[var(--accent-ink)]">{s}</Link>
  );
  const empty = (what: string) => (
    <p className="py-10 text-center text-[13px] text-[var(--ink3)]">
      {scope === "mine" ? `No ${what} on your starred or held stocks.` : scope === "commod" ? `No ${what} on commodities.` : `No ${what} yet.`}
    </p>
  );

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="news" />
      <main className="max-w-xl mx-auto px-4 pt-6 sm:pt-10 pb-12">
        <PageTitle>
          News
          <InfoTip title="News" className="ml-2">
            <p>Checked every twenty minutes from 7am to midnight and published at most every forty; the time of the last check is at the foot of the page.</p>
            <p><b>News:</b> headlines from Mint and the Economic Times feeds and GDELT&apos;s index of Indian business news, each linked to its article. Moneycontrol, NDTV Profit and Business Standard refuse programs and are not included.</p>
            <p><b>Broker calls:</b> a broker&apos;s rating on a stock as a headline reported it - read automatically from the headline, so check the article. Other people&apos;s opinions, often with conflicts of interest; never Rscreener&apos;s, and not advice.</p>
            <p><b>Deals:</b> NSE&apos;s bulk and block deals - who bought or sold how many shares, at what price. <b>Stakes:</b> SAST filings, when an acquirer or promoter crosses an ownership threshold. Both are the exchange&apos;s own disclosures.</p>
          </InfoTip>
        </PageTitle>

        <div className="-mt-3 mb-3 overflow-x-auto">
          <Segmented label="Section" value={tab}
            options={[["news", "News"], ["calls", "Broker calls"], ["deals", "Deals"], ["sast", "Stakes"]] as const} onChange={setTab} />
        </div>
        <div className="mb-4">
          <Chips value={scope} options={[["all", "All"], ["mine", "My stocks"], ["commod", "Commodities"]] as [Scope, string][]} onChange={setScope} />
        </div>

        {error && <p className="text-[13px] text-[var(--neg)]">News could not load ({error}).</p>}
        {!doc && !error && <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}

        {doc && tab === "news" && (items.length === 0 ? empty("headlines") : (
          <ul className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)]">
            {items.slice(0, 200).map((n) => (
              <li key={n.url} className="px-3 py-2.5">
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="block text-[14px] leading-snug hover:underline">{n.title}</a>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ink3)]">
                  <span>{n.src} · {since(n.t, now)}</span>
                  {n.syms.map(chip)}
                </div>
              </li>
            ))}
          </ul>
        ))}

        {doc && tab === "calls" && (calls.length === 0 ? empty("broker calls") : (
          <ul className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)]">
            {calls.map((c, i) => (
              <li key={`${c.url}${c.broker}${c.sym}${i}`} className="px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 text-[14px]">
                    <b>{c.broker}</b>{" "}
                    <span className={`font-semibold ${tone(c.bucket)}`}>{c.bucket ?? c.rating ?? "view"}</span>
                    {c.rating && c.bucket && c.rating.toLowerCase() !== c.bucket.toLowerCase() && <span className="text-[var(--ink3)]"> ({c.rating})</span>}
                    {" on "}{c.sym ? <Link href={symbolHref(c.sym)} className="text-[var(--accent-ink)]">{name(c.sym)}</Link> : "-"}
                  </span>
                  {c.target && <span className="shrink-0 text-[12px] tabular-nums text-[var(--ink2)]">target ₹{inr(c.target)}</span>}
                </div>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-[12px] text-[var(--ink3)] hover:underline truncate">{since(c.t, now)} · {c.title}</a>
              </li>
            ))}
          </ul>
        ))}

        {doc && tab === "deals" && (deals.length === 0 ? empty("deals") : (
          <ul className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)]">
            {deals.slice(0, 300).map((d, i) => (
              <li key={`${d.d}${d.sym}${d.client}${d.side}${d.qty}${i}`} className="px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 text-[14px] truncate">
                    {d.sym ? <Link href={symbolHref(d.sym)} className="text-[var(--accent-ink)] font-medium">{d.sym}</Link> : null}
                    <span className={`ml-2 text-[12px] font-semibold ${d.side === "BUY" ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>{d.side === "BUY" ? "Bought" : "Sold"}</span>
                  </span>
                  <span className="shrink-0 text-[13px] tabular-nums font-semibold">₹{inr(d.cr)} Cr</span>
                </div>
                <p className="mt-0.5 text-[12px] text-[var(--ink2)] truncate">{d.client}</p>
                <p className="text-[11px] text-[var(--ink3)] tabular-nums">{d.d} · {d.kind} · {qtyShort(d.qty)} shares at ₹{inr(d.price)}</p>
              </li>
            ))}
          </ul>
        ))}

        {doc && tab === "sast" && (sast.length === 0 ? empty("stake filings") : (
          <ul className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)]">
            {sast.map((s, i) => (
              <li key={`${s.sym}${s.acquirer}${s.t}${i}`} className="px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 min-w-0 text-[14px] truncate">
                    {s.sym ? <Link href={symbolHref(s.sym)} className="text-[var(--accent-ink)] font-medium">{s.sym}</Link> : s.company}
                    <span className={`ml-2 text-[12px] font-semibold ${s.side === "Sale" ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}>{s.side}</span>
                    {s.promoter && <span className="ml-1.5 text-[11px] text-[var(--ink3)]">promoter</span>}
                  </span>
                  {s.shares !== null && <span className="shrink-0 text-[12px] tabular-nums">{qtyShort(s.shares)} shares</span>}
                </div>
                <p className="mt-0.5 text-[12px] text-[var(--ink2)] truncate">{s.acquirer}</p>
                <p className="text-[11px] text-[var(--ink3)]">
                  {s.period}{s.after !== null ? ` · holds ${qtyShort(s.after)} after` : ""}
                  {s.doc && <> · <a href={s.doc} target="_blank" rel="noopener noreferrer" className="underline">filing</a></>}
                </p>
              </li>
            ))}
          </ul>
        ))}

        {doc?.fetched && <p className="mt-4 px-1 text-[11px] text-[var(--ink3)]">Last checked {since(doc.fetched, now)}.</p>}
      </main>
    </div>
  );
}
