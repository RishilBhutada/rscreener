"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
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
type Headline = NewsDoc["items"][number];

/** Headlines by Indian calendar day (owner, 12-Nov-2026: "News B"). The page
 *  drew 200 headlines in one column - 18,268 px on a phone. Now the newest day
 *  opens with five and "Show 30 more"; each earlier day is one row with its
 *  count, opened in place. */
const FIRST = 5;
const STEP = 30;
const IST = 330 * 60000;
const istDay = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
type Scope = "all" | "mine" | "commod";

const tone = (b: string | null | undefined) =>
  b === "Buy" ? "text-[var(--pos)]" : b === "Sell" ? "text-[var(--neg)]" : "text-[var(--ink2)]";

/** A section as a grid: the stock fixed on the left, any heading sorts (high
 *  to low, then low to high), a row per item (Step 5). */
type Col<T> = { key: string; label: string; get?: (r: T) => number | string | null | undefined; cell: (r: T) => ReactNode; left?: boolean };
// `limit` caps the rows drawn AFTER sorting, so sorting by size shows the
// biggest of all of them, not of whichever came first in the file.
function Grid<T>({ rows, cols, first, sortBy, limit }: { rows: T[]; cols: Col<T>[]; first: (r: T) => ReactNode; sortBy?: string; limit?: number }) {
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(sortBy ? { key: sortBy, desc: true } : null);
  const shown = useMemo(() => {
    const c = sort && cols.find((x) => x.key === sort.key);
    if (!c?.get) return limit ? rows.slice(0, limit) : rows;
    const sorted = [...rows].sort((a, b) => {
      const va = c.get!(a), vb = c.get!(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      const d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort!.desc ? -d : d;
    });
    return limit ? sorted.slice(0, limit) : sorted;
  }, [rows, cols, sort, limit]);
  return (
    <>
    <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--card)] [scrollbar-width:none]">
      <table className="w-full text-[13px] border-collapse tabular-nums">
        <thead>
          <tr className="text-[11px] text-[var(--ink3)] border-b border-[var(--line)]">
            <th scope="col" className="px-2.5 py-2 text-left font-medium sticky left-0 z-10 bg-[var(--card)]">Stock</th>
            {cols.map((c) => (
              <th key={c.key} scope="col" aria-sort={sort?.key === c.key ? (sort.desc ? "descending" : "ascending") : undefined}
                className={`px-2 py-2 font-medium whitespace-nowrap ${c.left ? "text-left" : "text-right"}`}>
                {c.get ? (
                  <button type="button" onClick={() => setSort(!sort || sort.key !== c.key ? { key: c.key, desc: true } : sort.desc ? { key: c.key, desc: false } : null)}
                    className={sort?.key === c.key ? "text-[var(--accent-ink)] font-semibold" : ""}>
                    {c.label}{sort?.key === c.key && <span aria-hidden="true">{sort.desc ? "\u25BE" : "\u25B4"}</span>}
                  </button>
                ) : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i} className="border-b border-[var(--line)] last:border-b-0">
              <th scope="row" className="px-2.5 py-2 text-left font-semibold sticky left-0 bg-[var(--card)] max-w-[30vw] sm:max-w-none truncate">{first(r)}</th>
              {cols.map((c) => <td key={c.key} className={`px-2 py-2 whitespace-nowrap ${c.left ? "text-left max-w-[44vw] truncate" : "text-right"}`}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {limit && rows.length > limit && (
      <p className="mt-2 px-1 text-[11px] text-[var(--ink3)]">
        Showing {limit.toLocaleString("en-IN")} of {rows.length.toLocaleString("en-IN")}{sort ? ", after sorting" : ", newest first in the file"}.
      </p>
    )}
    </>
  );
}

export default function NewsPage() {
  const [doc, setDoc] = useState<NewsDoc | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("news");
  const [scope, setScope] = useState<Scope>("all");
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [now, setNow] = useState(0);
  // Headlines shown per day; a day not in it shows FIRST if it is the newest, else none.
  const [perDay, setPerDay] = useState<Record<string, number>>({});

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

  const days = useMemo(() => {
    const by = new Map<string, Headline[]>();
    for (const n of items) {
      const d = istDay(new Date(n.t).getTime());
      const xs = by.get(d);
      if (xs) xs.push(n); else by.set(d, [n]);
    }
    return Array.from(by, ([d, xs]) => [d, xs.sort((a, b) => (a.t < b.t ? 1 : -1))] as const).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [items]);
  const shownOf = (d: string) => perDay[d] ?? (d === days[0]?.[0] ? FIRST : 0);
  const dayName = (d: string) => {
    const label = new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    if (!now) return label;
    return d === istDay(now) ? `Today · ${label}` : d === istDay(now - 86400000) ? `Yesterday · ${label}` : label;
  };
  const headlines = (d: string, xs: readonly Headline[]) => {
    const n = shownOf(d);
    return (
      <>
        <ul className="divide-y divide-[var(--line)]">
          {xs.slice(0, n).map((h) => (
            <li key={h.url} className="px-3 py-2.5">
              <a href={h.url} target="_blank" rel="noopener noreferrer" className="block text-[14px] leading-snug hover:underline">{h.title}</a>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ink3)]">
                <span>{h.src} · {since(h.t, now)}</span>
                {h.syms.map(chip)}
              </div>
            </li>
          ))}
        </ul>
        {xs.length > n && (
          <button type="button" onClick={() => setPerDay({ ...perDay, [d]: n + STEP })}
            className="w-full py-2.5 text-[13px] font-semibold text-[var(--accent-ink)] border-t border-[var(--line)]">
            Show {Math.min(STEP, xs.length - n)} more · {xs.length - n} left
          </button>
        )}
      </>
    );
  };

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
            options={[["news", "News"], ["calls", `Calls ${calls.length}`], ["deals", `Deals ${deals.length}`], ["sast", `Stakes ${sast.length}`]] as const} onChange={setTab} />
        </div>
        <div className="mb-4">
          <Chips value={scope} options={[["all", "All"], ["mine", "My stocks"], ["commod", "Commodities"]] as [Scope, string][]} onChange={setScope} />
        </div>

        {error && <p className="text-[13px] text-[var(--neg)]">News could not load ({error}).</p>}
        {!doc && !error && <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}

        {doc && tab === "news" && (days.length === 0 ? empty("headlines") : (
          <div className="space-y-4">
            <section>
              <h2 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">{dayName(days[0][0])} · {days[0][1].length}</h2>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">{headlines(days[0][0], days[0][1])}</div>
            </section>
            {days.length > 1 && (
              <section>
                <h2 className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">Earlier days</h2>
                <ul className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)] overflow-hidden">
                  {days.slice(1).map(([d, xs]) => {
                    const open = shownOf(d) > 0;
                    return (
                      <li key={d}>
                        <button type="button" aria-expanded={open} onClick={() => setPerDay({ ...perDay, [d]: open ? 0 : FIRST })}
                          className="rs-press w-full min-h-[46px] flex items-center gap-2 px-3 text-left active:bg-[var(--card2)]">
                          <span className="flex-1 text-[14px] font-semibold">{dayName(d)}</span>
                          <span className="text-[12px] text-[var(--ink3)] tabular-nums">{xs.length} headlines</span>
                          <svg viewBox="0 0 24 24" className={`w-4 h-4 text-[var(--ink3)] transition-transform ${open ? "rotate-90" : ""}`} fill="none"
                            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                        </button>
                        {open && <div className="border-t border-[var(--line)]">{headlines(d, xs)}</div>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        ))}

        {doc && tab === "calls" && (calls.length === 0 ? empty("broker calls") : (
          <Grid rows={calls}
            first={(c) => c.sym ? <Link href={symbolHref(c.sym)} title={name(c.sym)} className="text-[var(--accent-ink)]">{c.sym}</Link> : "—"}
            cols={[
              { key: "call", label: "Call", get: (c) => c.bucket ?? c.rating ?? null, cell: (c) => <span className={`font-semibold ${tone(c.bucket)}`}>{c.bucket ?? c.rating ?? "view"}</span>, left: true },
              { key: "broker", label: "Broker", get: (c) => c.broker, cell: (c) => c.broker, left: true },
              { key: "target", label: "Target ₹", get: (c) => c.target ?? null, cell: (c) => (c.target ? inr(c.target) : "—") },
              { key: "when", label: "When", get: (c) => c.t, cell: (c) => <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[var(--ink3)] underline">{since(c.t, now)}</a> },
            ]} />
        ))}

        {doc && tab === "deals" && (deals.length === 0 ? empty("deals") : (
          <Grid rows={deals} limit={300}
            first={(d) => d.sym ? <Link href={symbolHref(d.sym)} className="text-[var(--accent-ink)]">{d.sym}</Link> : "—"}
            cols={[
              { key: "side", label: "Side", get: (d) => d.side, cell: (d) => <span className={`font-semibold ${d.side === "BUY" ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>{d.side === "BUY" ? "Buy" : "Sell"}</span>, left: true },
              { key: "cr", label: "₹ Cr", get: (d) => d.cr ?? null, cell: (d) => <span className="font-semibold">{inr(d.cr)}</span> },
              { key: "client", label: "Client", get: (d) => d.client, cell: (d) => <span className="text-[var(--ink2)]">{d.client}</span>, left: true },
              { key: "qty", label: "Shares", get: (d) => d.qty ?? null, cell: (d) => qtyShort(d.qty) },
              { key: "price", label: "Price ₹", get: (d) => d.price ?? null, cell: (d) => inr(d.price) },
              { key: "d", label: "Day", get: (d) => d.d, cell: (d) => <span className="text-[var(--ink3)]">{d.d.slice(8)}/{d.d.slice(5, 7)} · {d.kind}</span> },
            ]} />
        ))}

        {doc && tab === "sast" && (sast.length === 0 ? empty("stake filings") : (
          <Grid rows={sast}
            first={(x) => x.sym ? <Link href={symbolHref(x.sym)} className="text-[var(--accent-ink)]">{x.sym}</Link> : <span className="text-[var(--ink2)]">{x.company}</span>}
            cols={[
              { key: "side", label: "Side", get: (x) => x.side, cell: (x) => <span className={`font-semibold ${x.side === "Sale" ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}>{x.side === "Sale" ? "Sell" : x.side === "Acquisition" ? "Buy" : x.side}</span>, left: true },
              { key: "by", label: "Filed by", get: (x) => x.acquirer, cell: (x) => <span className="text-[var(--ink2)]">{x.acquirer}{x.promoter ? " · promoter" : ""}</span>, left: true },
              { key: "shares", label: "Shares", get: (x) => x.shares ?? null, cell: (x) => (x.shares !== null ? qtyShort(x.shares) : "—") },
              { key: "after", label: "Holds after", get: (x) => x.after ?? null, cell: (x) => (x.after !== null ? qtyShort(x.after) : "—") },
              { key: "t", label: "Filed", get: (x) => x.t, cell: (x) => x.doc ? <a href={x.doc} target="_blank" rel="noopener noreferrer" className="text-[var(--ink3)] underline">{since(x.t, now)}</a> : since(x.t, now) },
            ]} />
        ))}

        {doc?.fetched && <p className="mt-4 px-1 text-[11px] text-[var(--ink3)]">Last checked {since(doc.fetched, now)}.</p>}
      </main>
    </div>
  );
}
