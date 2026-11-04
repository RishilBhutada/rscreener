"use client";

import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { InstDoc, inr, loadInst, qtyShort, since, tally } from "@/lib/news";

/** What institutions say and do about one company (owner, 15-Oct-2026): the
 *  latest call per broker as headlines reported them (180 days), bulk/block
 *  deals and SAST stake filings (a year), and the month's headlines.
 *  Nothing shown when there is nothing - no empty card. */
export default function InstitutionsCard({ symbol }: { symbol: string }) {
  const [doc, setDoc] = useState<InstDoc | null>(null);
  const [now, setNow] = useState(0);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let live = true;
    loadInst(symbol).then((d) => { if (live) { setDoc(d); setNow(Date.now()); } }).catch(() => {});
    return () => { live = false; };
  }, [symbol]);
  if (!doc) return null;
  const t = tally(doc.calls);
  const tone = (b: string | null) => (b === "Buy" ? "text-[var(--pos)]" : b === "Sell" ? "text-[var(--neg)]" : "text-[var(--ink2)]");
  const head = "px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]";
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
      <h2 className={`${head} flex items-center gap-1`}>
        Institutions
        <InfoTip title="Institutions">
          <p><b>Broker calls</b> are other people&apos;s ratings as news headlines reported them, read automatically - each links to its article. The latest call per broker in the last six months is counted. Brokers often have conflicts of interest; none of this is Rscreener&apos;s view or advice.</p>
          <p><b>Deals</b> are NSE&apos;s bulk and block deals; <b>stake filings</b> are SAST disclosures by acquirers and promoters - the exchange&apos;s own records.</p>
        </InfoTip>
      </h2>

      {t.latest.length > 0 && (
        <div className="px-3 pb-3">
          <p className="text-[13px]">
            <span className="text-[var(--ink3)]">Brokers in the news, last 6 months: </span>
            <b className="text-[var(--pos)]">{t.buy} Buy</b> · <b>{t.hold} Hold</b> · <b className="text-[var(--neg)]">{t.sell} Sell</b>
          </p>
          <ul className="mt-1.5 space-y-1">
            {t.latest.map((c) => (
              <li key={c.broker} className="text-[13px] flex items-baseline gap-2">
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate hover:underline">
                  <b>{c.broker}</b> <span className={tone(c.bucket)}>{c.rating ?? c.bucket}</span>
                  {c.target ? <span className="text-[var(--ink2)]"> · target ₹{inr(c.target)}</span> : null}
                </a>
                <span className="shrink-0 text-[11px] text-[var(--ink3)]">{since(c.t, now)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {doc.deals.length > 0 && (
        <div className="border-t border-[var(--line)]">
          <h3 className={head}>Bulk &amp; block deals, last year</h3>
          <ul className="px-3 pb-3 space-y-1.5">
            {doc.deals.slice(0, more ? 40 : 5).map((d, i) => (
              <li key={`${d.d}${d.client}${d.side}${i}`} className="text-[13px]">
                <div className="flex items-baseline gap-2">
                  <span className={`shrink-0 text-[12px] font-semibold ${d.side === "BUY" ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>{d.side === "BUY" ? "Bought" : "Sold"}</span>
                  <span className="flex-1 min-w-0 truncate">{d.client}</span>
                  <span className="shrink-0 tabular-nums font-semibold">₹{inr(d.cr)} Cr</span>
                </div>
                <p className="text-[11px] text-[var(--ink3)] tabular-nums">{d.d} · {d.kind} · {qtyShort(d.qty)} at ₹{inr(d.price)}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {doc.sast.length > 0 && (
        <div className="border-t border-[var(--line)]">
          <h3 className={head}>Stake filings (SAST), last year</h3>
          <ul className="px-3 pb-3 space-y-1.5">
            {doc.sast.slice(0, more ? 30 : 4).map((s, i) => (
              <li key={`${s.acquirer}${s.t}${i}`} className="text-[13px]">
                <div className="flex items-baseline gap-2">
                  <span className={`shrink-0 text-[12px] font-semibold ${s.side === "Sale" ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}>{s.side}</span>
                  <span className="flex-1 min-w-0 truncate">{s.acquirer}{s.promoter ? " (promoter)" : ""}</span>
                  {s.shares !== null && <span className="shrink-0 tabular-nums">{qtyShort(s.shares)}</span>}
                </div>
                <p className="text-[11px] text-[var(--ink3)]">{s.period}{s.doc && <> · <a href={s.doc} target="_blank" rel="noopener noreferrer" className="underline">filing</a></>}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {doc.news.length > 0 && (
        <div className="border-t border-[var(--line)]">
          <h3 className={head}>In the news, last month</h3>
          <ul className="px-3 pb-3 space-y-1.5">
            {doc.news.slice(0, more ? 30 : 4).map((n) => (
              <li key={n.url} className="text-[13px] leading-snug">
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{n.title}</a>
                <span className="block text-[11px] text-[var(--ink3)]">{n.src} · {since(n.t, now)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(doc.deals.length > 5 || doc.sast.length > 4 || doc.news.length > 4) && (
        <button type="button" onClick={() => setMore(!more)} className="w-full border-t border-[var(--line)] py-2.5 text-[13px] text-[var(--accent-ink)]">
          {more ? "Show less" : "Show more"}
        </button>
      )}
    </section>
  );
}
