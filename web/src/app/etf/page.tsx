"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { CLASS_LABEL, pctRankText, pctText, premClass, premSentence, premText, type EtfDoc, type Returns } from "@/lib/etf";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
// The chart library touches the window, so it loads in the browser only.
const EtfChart = dynamic(() => import("@/components/EtfChart"), {
  ssr: false,
  loading: () => <div className="rs-skel h-[440px]" aria-busy="true" aria-label="Loading chart" />,
});

const money = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const when = (d: string | null | undefined) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

function Card({ title, tip, action, children }: { title: string; tip?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
      <h2 className="px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)] flex items-center gap-1">
        {title}{tip}{action && <span className="ml-auto normal-case tracking-normal">{action}</span>}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="px-3 py-2">
      <p className="text-xs text-[var(--ink3)]">{label}</p>
      <p className={`text-[17px] font-semibold tabular-nums ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--ink3)]">{sub}</p>}
    </div>
  );
}

function ReturnsTable({ doc }: { doc: EtfDoc }) {
  const rows: [string, Returns][] = [["Price", doc.ret_price], ["NAV", doc.ret_nav]];
  if (doc.index) rows.push([doc.index.fx ? `${doc.index.label} (₹)` : doc.index.label, doc.ret_index]);
  const keys = ["1m", "6m", "1y", "3y"] as const;
  return (
    <table className="w-full table-fixed text-[13px] tabular-nums">
      <thead>
        <tr className="text-xs text-[var(--ink3)]">
          <th className="w-[31%] px-3 py-1.5 text-left font-medium" />
          {keys.map((k) => <th key={k} className="px-1.5 py-1.5 text-right font-medium">{k.toUpperCase()}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, r]) => (
          <tr key={label} className="border-t border-[var(--line)]">
            <td className="px-3 py-2 text-[var(--ink2)] truncate">{label}</td>
            {keys.map((k) => {
              const v = r[k];
              return (
                <td key={k} className={`px-1.5 py-2 text-right ${v === null || v === undefined ? "text-[var(--ink3)]" : v >= 0 ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>
                  {pctText(v)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Every ETF tracking the same index, this one included, busiest first -
 *  the premium, how much each trades, and what its NAV did in a year (the
 *  same index, so a lower number is mostly a higher fee or worse tracking). */
function SameIndex({ doc }: { doc: EtfDoc }) {
  const rows = [
    { s: doc.s, name: doc.name, prem: doc.prem, turnover_cr: doc.turnover_cr, thin: doc.thin, r1y_nav: doc.ret_nav["1y"] ?? null, self: true },
    ...(doc.same_index ?? []).map((x) => ({ ...x, self: false })),
  ].sort((a, b) => (b.turnover_cr ?? 0) - (a.turnover_cr ?? 0));
  return (
    <Card title={`Same index · ${rows.length} ETFs`}>
      <table className="w-full table-fixed text-[13px] tabular-nums">
        <thead>
          <tr className="text-xs text-[var(--ink3)]">
            <th className="w-[40%] px-3 py-1.5 text-left font-medium">ETF</th>
            <th className="px-1.5 py-1.5 text-right font-medium">vs NAV</th>
            <th className="px-1.5 py-1.5 text-right font-medium">₹Cr/day</th>
            <th className="px-3 py-1.5 text-right font-medium">1Y NAV</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 30).map((r) => (
            <tr key={r.s} className={`border-t border-[var(--line)] ${r.self ? "bg-[var(--accent-soft)]" : ""}`}>
              <td className="px-3 py-2 truncate">
                {r.self ? <span className="font-semibold">{r.s}</span>
                  : <Link href={`/etf?s=${encodeURIComponent(r.s)}`} className="font-semibold text-[var(--accent-ink)]">{r.s}</Link>}
                {r.thin && <span className="ml-1 text-[10px] text-[var(--ink3)]">thin</span>}
              </td>
              <td className={`px-1.5 py-2 text-right ${premClass(r.prem)}`}>{premText(r.prem)}</td>
              <td className="px-1.5 py-2 text-right text-[var(--ink2)]">{r.turnover_cr.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</td>
              <td className="px-3 py-2 text-right text-[var(--ink2)]">{pctText(r.r1y_nav)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function EtfView() {
  const sym = (useSearchParams().get("s") ?? "").toUpperCase();
  const [doc, setDoc] = useState<EtfDoc | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!sym) return;
    let live = true;
    fetch(`${BASE}/etf/${encodeURIComponent(sym)}.json`)
      .then((r) => { if (!r.ok) throw new Error(r.status === 404 ? `No ETF called ${sym}` : `HTTP ${r.status}`); return r.json(); })
      .then((d: EtfDoc) => { if (live) setDoc(d); })
      .catch((e) => { if (live) setError(String(e.message ?? e)); });
    return () => { live = false; };
  }, [sym]);

  if (error) return <p className="text-[var(--neg)] text-sm">{error}</p>;
  if (!doc) return <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />;

  return (
    <div className="space-y-3">
      <header>
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-xl font-bold">{doc.s}</h1>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink3)] border border-[var(--line2)] rounded px-1.5">
            {CLASS_LABEL[doc.class] ?? doc.class}
          </span>
        </div>
        <p className="text-sm text-[var(--ink2)]">{doc.name}</p>
      </header>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-3">
        <p className={`text-lg font-bold ${premClass(doc.prem)}`}>{premSentence(doc.prem)}</p>
        <div className="mt-2 grid grid-cols-3 gap-2 tabular-nums">
          <div>
            <p className="text-xs text-[var(--ink3)]">Price</p>
            <p className="font-semibold">{money(doc.price)}</p>
            <p className="text-[11px] text-[var(--ink3)]">{when(doc.price_date)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--ink3)]">NAV</p>
            <p className="font-semibold">{money(doc.nav)}</p>
            <p className="text-[11px] text-[var(--ink3)]">{when(doc.nav_date)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--ink3)]">Premium</p>
            <p className={`font-semibold ${premClass(doc.prem)}`}>{premText(doc.prem)}</p>
            <p className="text-[11px] text-[var(--ink3)]">{when(doc.prem_date)}</p>
          </div>
        </div>
        {doc.thin && (
          <p className="mt-2 text-xs text-[var(--warn-ink)]">
            Thinly traded — {doc.traded_days_20} of the last 20 sessions, about ₹{doc.turnover_cr.toLocaleString("en-IN")} Cr a day.
            The closing price may be stale, so the premium is less reliable.
          </p>
        )}
      </section>

      <Card title="Price vs what it holds" action={
        <Link href={`/chart?s=${encodeURIComponent(doc.s)}`}
          // Remembered so the full chart's back arrow returns here.
          onClick={() => { try { sessionStorage.setItem("rs_chart_from", location.pathname + location.search); } catch { /* private mode */ } }}
          aria-label="Open the full-screen chart" title="Candles, indicators, full screen"
          className="rs-press inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold text-[var(--accent-ink)] bg-[var(--accent-soft)]">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
          Full view
        </Link>
      } tip={
        <InfoTip title="Price vs what it holds">
          <p>Top: the exchange price, the NAV and {doc.index ? `the ${doc.index.label}` : "no index (none with a free full history)"}, each as % change from the left edge of the chart.</p>
          <p>Bottom: the premium — price over NAV — each day. Above zero, buyers are paying more than the units hold.</p>
          {doc.index && <p>The index is its price version. The fund tracks the version with dividends reinvested, so the NAV should run slightly ahead of it.{doc.index.fx ? " It is converted to rupees at each day's exchange rate, using the previous US close, as the NAV does." : ""}</p>}
        </InfoTip>
      }>
        <EtfChart rows={doc.rows} indexLabel={doc.index ? (doc.index.fx ? `${doc.index.label} (₹)` : doc.index.label) : null} />
      </Card>

      <Card title="Premium">
        <div className="grid grid-cols-2">
          <Stat label="Now" value={premText(doc.prem)} cls={premClass(doc.prem)} sub={when(doc.prem_date)} />
          <Stat label="Last month, average" value={premText(doc.prem_avg_1m)} cls={premClass(doc.prem_avg_1m)} />
          <Stat label="Highest in a year" value={premText(doc.prem_hi_1y?.[1])} cls={premClass(doc.prem_hi_1y?.[1])} sub={when(doc.prem_hi_1y?.[0])} />
          <Stat label="Lowest in a year" value={premText(doc.prem_lo_1y?.[1])} cls={premClass(doc.prem_lo_1y?.[1])} sub={when(doc.prem_lo_1y?.[0])} />
        </div>
        {pctRankText(doc.prem_pct_1y) && (
          <p className="px-3 pb-3 text-sm text-[var(--ink2)]">
            Today&apos;s premium: {pctRankText(doc.prem_pct_1y)?.toLowerCase()}
          </p>
        )}
      </Card>

      {(doc.same_index?.length ?? 0) > 0 && <SameIndex doc={doc} />}

      <Card title="Returns">
        <ReturnsTable doc={doc} />
        <p className="px-3 py-2 text-[11px] text-[var(--ink3)]">
          Price returns include any change in the premium; NAV returns do not.
        </p>
      </Card>

      <Card title="About">
        <dl className="px-3 pb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-[var(--ink3)]">Tracks</dt><dd>{doc.underlying || "—"}</dd>
          <dt className="text-[var(--ink3)]">Traded</dt><dd>₹{doc.turnover_cr.toLocaleString("en-IN")} Cr a day · {doc.traded_days_20} of 20 sessions</dd>
          <dt className="text-[var(--ink3)]">Listed</dt><dd>{when(doc.listed)}</dd>
          <dt className="text-[var(--ink3)]">ISIN</dt><dd className="font-mono text-xs self-center">{doc.isin ?? "—"}</dd>
          <dt className="text-[var(--ink3)]">Sources</dt><dd>NAV: AMFI · Price: NSE close</dd>
        </dl>
      </Card>
    </div>
  );
}

export default function EtfPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="etfs" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5">
        <Suspense fallback={<div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}>
          <EtfView />
        </Suspense>
      </main>
    </div>
  );
}
