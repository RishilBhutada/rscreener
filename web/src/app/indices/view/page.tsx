"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { LiteRow, loadIndex, symbolHref } from "@/lib/index-data";
import { shortName } from "@/lib/names";
import { IndexDoc, RETURN_ORDER, ValStat, points } from "@/lib/indices";
import { dayLabel, signClass, signed } from "@/lib/commodity";

/** One index: its level and day, the year's range, returns over every span,
 *  valuation against its own history, a chart, its members joined to today's
 *  prices, and the ETFs that track it. Read-only, like the rest. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const IndexChart = dynamic(() => import("@/components/IndexChart"), {
  ssr: false, loading: () => <div className="rs-skel h-[300px]" aria-busy="true" aria-label="Loading chart" />,
});
const EtfValChart = dynamic(() => import("@/components/EtfValChart"), {
  ssr: false, loading: () => <div className="rs-skel h-[300px]" aria-busy="true" aria-label="Loading chart" />,
});

function Card({ title, tip, action, children }: { title: string; tip?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
      <h2 className="px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)] flex items-center gap-1">
        {title}{tip}{action && <span className="ml-auto normal-case tracking-normal flex gap-1.5">{action}</span>}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-[var(--ink3)]">{label}</p>
      <p className={`font-semibold tabular-nums truncate ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--ink3)] truncate">{sub}</p>}
    </div>
  );
}

function ValTile({ label, v, unit = "", lowIsCheap = true }: { label: string; v?: ValStat; unit?: string; lowIsCheap?: boolean }) {
  if (!v) return <Stat label={label} value="—" />;
  const f = (x: number | null) => (x === null ? "—" : `${x.toFixed(2)}${unit}`);
  // Read as cheap or dear against its own ten years: for P/E and P/B a low
  // value is cheap, for the dividend yield a high one is.
  const pct = v.pct10;
  const cheapness = pct === null ? null : lowIsCheap ? 100 - pct : pct;
  const dear = cheapness !== null && cheapness <= 20;
  const cheap = cheapness !== null && cheapness >= 80;
  return (
    <div className="min-w-0">
      <p className="text-xs text-[var(--ink3)]">{label}</p>
      <p className="font-semibold tabular-nums">{f(v.now)}</p>
      <p className="text-[11px] text-[var(--ink3)] truncate">5y median {f(v.med5)}</p>
      {cheapness !== null && (
        <p className={`text-[11px] truncate ${dear ? "text-[var(--neg)]" : cheap ? "text-[var(--pos)]" : "text-[var(--ink3)]"}`}>
          {cheapness >= 50 ? `Cheaper than ${cheapness}%` : `Dearer than ${100 - cheapness}%`} of 10y
        </p>
      )}
    </div>
  );
}

function RangeBar({ lo, hi, now }: { lo: number; hi: number; now: number }) {
  const pos = hi > lo ? Math.min(100, Math.max(0, ((now - lo) / (hi - lo)) * 100)) : 50;
  return (
    <div className="mt-3">
      <div className="flex justify-between text-[11px] text-[var(--ink3)] tabular-nums">
        <span>52w low {points(lo)}</span><span>52w high {points(hi)}</span>
      </div>
      <div className="relative h-1.5 mt-1 rounded-full bg-[var(--card2)]">
        <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[var(--accent)] border-2 border-[var(--card)]"
          style={{ left: `calc(${pos}% - 5px)` }} />
      </div>
    </div>
  );
}

function IndexView() {
  const sym = useSearchParams().get("s") ?? "";
  const [loaded, setDoc] = useState<IndexDoc | null>(null);
  const [failed, setError] = useState<{ s: string; msg: string } | null>(null);
  const [rows, setRows] = useState<LiteRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [showEtfs, setShowEtfs] = useState(false);
  const doc = loaded?.s === sym ? loaded : null;
  const error = failed?.s === sym ? failed.msg : "";

  useEffect(() => {
    if (!sym) return;
    let live = true;
    fetch(`${BASE}/idx/${encodeURIComponent(sym)}.json`)
      .then((r) => { if (!r.ok) throw new Error(r.status === 404 ? `No index called ${sym}` : `HTTP ${r.status}`); return r.json(); })
      .then((d: IndexDoc) => { if (live) setDoc(d); })
      .catch((e) => { if (live) setError({ s: sym, msg: String(e.message ?? e) }); });
    loadIndex().then((d) => { if (live) setRows(d.rows); }).catch(() => {});
    return () => { live = false; };
  }, [sym]);

  const bySym = useMemo(() => new Map(rows.map((r) => [r.symbol, r])), [rows]);

  // Members joined to today's prices. Weights are each member's share of the
  // members' total market cap - NSE weights by free float, so these are a
  // close guide, not the official figure.
  const members = useMemo(() => {
    if (!doc) return [];
    const list = doc.members.map(([s, comp, ind]) => ({ s, comp, ind, r: bySym.get(s) }));
    const total = list.reduce((t, m) => t + (m.r?.mcap ?? 0), 0);
    return list.map((m) => ({ ...m, w: total > 0 && m.r?.mcap ? (m.r.mcap / total) * 100 : null }))
      .sort((a, b) => (b.w ?? -1) - (a.w ?? -1));
  }, [doc, bySym]);
  const breadth = useMemo(() => {
    const up = members.filter((m) => (m.r?.ret_1d ?? 0) > 0).length;
    const down = members.filter((m) => (m.r?.ret_1d ?? 0) < 0).length;
    return { up, down, flat: members.length - up - down };
  }, [members]);
  const sectors = useMemo(() => {
    const by = new Map<string, number>();
    for (const m of members) if (m.w) by.set(m.ind || "Other", (by.get(m.ind || "Other") ?? 0) + m.w);
    return Array.from(by.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [members]);

  if (error) return <p className="text-[var(--neg)] text-sm">{error}</p>;
  if (!doc) return <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />;
  const vix = doc.name === "India VIX";
  const shown = showAll ? members : members.slice(0, 10);

  return (
    <div className="space-y-3">
      <header>
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-xl font-bold">{doc.name}</h1>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink3)] border border-[var(--line2)] rounded px-1.5">{doc.group}</span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink3)]">{doc.exch} index</span>
        </div>
        {doc.members.length > 0 && <p className="text-sm text-[var(--ink2)]">{doc.members.length} companies</p>}
      </header>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-3">
        <p className="text-xs text-[var(--ink3)]">Close · {dayLabel(doc.asof, true)}</p>
        <p className="mt-0.5 flex items-baseline gap-2 tabular-nums flex-wrap">
          <span className="text-2xl font-bold">{points(doc.close)}</span>
          <span className={`text-[15px] font-semibold ${signClass(doc.chg)}`}>
            {doc.chg !== null ? `${doc.chg > 0 ? "+" : ""}${points(doc.chg)}` : ""} ({signed(doc.chg_pct, 2)})
          </span>
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="Day low" value={points(doc.low, 0)} sub={`high ${points(doc.high, 0)} · open ${points(doc.open, 0)}`} />
          <Stat label="From high" value={signed(doc.from_ath, 1)} sub={`${points(doc.ath, 0)} · ${dayLabel(doc.ath_date, true)}`} cls={signClass(doc.from_ath)} />
          <Stat label="vs 200-day avg" value={signed(doc.vs_dma200, 1)} sub={`50-day ${signed(doc.vs_dma50, 1)}`} cls={signClass(doc.vs_dma200)} />
          <Stat label="Volatility (1y)" value={doc.vol_1y !== null ? `${doc.vol_1y}%` : "—"} sub="annualised" />
          <Stat label={`Since ${doc.since.slice(0, 4)}`} value={doc.cagr_all !== null ? `${signed(doc.cagr_all, 1)}/yr` : "—"} sub="compounded" />
          {doc.turnover
            ? <Stat label="Turnover" value={`₹${Math.round(doc.turnover).toLocaleString("en-IN")} Cr`} sub="members, the day" />
            : <Stat label="Previous close" value={points(doc.prev)} />}
        </div>
        <RangeBar lo={doc.lo52} hi={doc.hi52} now={doc.close} />
      </section>

      <Card title="Chart" tip={
        <InfoTip title="Chart">
          <p>The index&apos;s daily close; Max reaches back to {dayLabel(doc.since, true)} in weekly steps. Full view opens the full chart with candles, indicators and drawing tools.</p>
        </InfoTip>
      } action={
        <Link href={`/chart?s=${encodeURIComponent(doc.s)}`}
          onClick={() => { try { sessionStorage.setItem("rs_chart_from", location.pathname + location.search); } catch { /* private mode */ } }}
          className="rs-press inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold text-[var(--accent-ink)] bg-[var(--accent-soft)]">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
          Full view
        </Link>
      }>
        <IndexChart symbol={doc.s} />
      </Card>

      <Card title="Returns" tip={
        <InfoTip title="Returns">
          <p>Price returns from the close nearest each date: the change for spans up to a year, and the compounded rate a year beyond that. Dividends are not included - the total-return index runs ahead by roughly the dividend yield.</p>
        </InfoTip>
      }>
        <div className="px-3 pb-3 grid grid-cols-3 gap-x-2 gap-y-2.5">
          {RETURN_ORDER.filter((k) => doc.ret[k] !== undefined).map((k) => {
            const yearly = doc.cagr[k];
            const v = yearly ?? doc.ret[k];
            return <Stat key={k} label={k} value={`${signed(v, 1)}${yearly !== undefined ? "/yr" : ""}`}
              sub={yearly !== undefined ? `${signed(doc.ret[k], 0)} in all` : undefined} cls={signClass(v)} />;
          })}
        </div>
      </Card>

      {!vix && (doc.val.pe || doc.val.pb || doc.val.dy) && (
        <Card title="Valuation" tip={
          <InfoTip title="Valuation">
            <p>The index&apos;s P/E, P/B and dividend yield as NSE publishes them each day, against the index&apos;s own past: the median of the last five years, and where today sits among the last ten years&apos; days.</p>
            <p>&ldquo;Cheaper than 99% of 10y&rdquo; means the measure was dearer on 99% of the last ten years&apos; days. Red when dearer than 80% of them, green when cheaper than 80% - a description of history, not a forecast or advice.</p>
          </InfoTip>
        }>
          <div className="px-3 pb-2 grid grid-cols-3 gap-2">
            <ValTile label="P/E" v={doc.val.pe} />
            <ValTile label="P/B" v={doc.val.pb} />
            <ValTile label="Div yield" v={doc.val.dy} unit="%" lowIsCheap={false} />
          </div>
          {doc.val_file && <EtfValChart file={doc.val_file} />}
        </Card>
      )}

      {members.length > 0 && (
        <Card title={`Members · ${members.length}`} tip={
          <InfoTip title="Members">
            <p>The companies in the index, from NSE Indices&apos; list, with today&apos;s close and change.</p>
            <p>Weight is each company&apos;s share of the members&apos; total market cap. NSE weights by free float, so the official weights differ - most for companies whose promoters hold a lot.</p>
          </InfoTip>
        }>
          <p className="px-3 pb-2 text-[12px] tabular-nums">
            <span className="text-[var(--pos)] font-semibold">{breadth.up} up</span>
            <span className="text-[var(--ink3)]"> · </span>
            <span className="text-[var(--neg)] font-semibold">{breadth.down} down</span>
            {breadth.flat > 0 && <span className="text-[var(--ink3)]"> · {breadth.flat} unchanged or no price</span>}
          </p>
          {sectors.length > 1 && (
            <div className="px-3 pb-3 space-y-1.5">
              {sectors.map(([name, w]) => (
                <div key={name}>
                  <div className="flex justify-between text-[12px]"><span className="truncate">{name}</span><span className="tabular-nums text-[var(--ink2)]">{w.toFixed(1)}%</span></div>
                  <div className="h-1.5 rounded-full bg-[var(--card2)] overflow-hidden"><div className="h-full bg-[var(--accent)]" style={{ width: `${Math.max(w, 0.5)}%` }} /></div>
                </div>
              ))}
            </div>
          )}
          <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
            {shown.map((m) => (
              <li key={m.s}>
                <Link href={symbolHref(m.s)} className="rs-press flex items-center gap-3 px-3 py-2.5 active:bg-[var(--card2)]">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-medium truncate">{m.s}</span>
                    <span className="block text-[11px] text-[var(--ink3)] truncate">{shortName(m.comp, m.s)}{m.w !== null ? ` · ${m.w.toFixed(1)}%` : ""}</span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block text-[14px] font-medium">{m.r?.price !== undefined ? m.r.price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}</span>
                    <span className={`block text-[12px] ${signClass(m.r?.ret_1d)}`}>{signed(m.r?.ret_1d, 2)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {members.length > 10 && (
            <button type="button" onClick={() => setShowAll(!showAll)}
              className="w-full py-2.5 text-[13px] font-semibold text-[var(--accent-ink)] border-t border-[var(--line)]">
              {showAll ? "Show top 10" : `Show all ${members.length}`}
            </button>
          )}
        </Card>
      )}

      {doc.etfs.length > 0 && (
        <Card title={`ETFs tracking it · ${doc.etfs.length}`}>
          <ul className="divide-y divide-[var(--line)]">
            {(showEtfs ? doc.etfs : doc.etfs.slice(0, 5)).map((s) => {
              const r = bySym.get(s);
              return (
                <li key={s}>
                  <Link href={`/etf?s=${encodeURIComponent(s)}`} className="rs-press flex items-center gap-3 px-3 py-2.5 active:bg-[var(--card2)]">
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] font-medium">{s}</span>
                      <span className="block text-[11px] text-[var(--ink3)] truncate">{r?.name ?? ""}</span>
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="block text-[14px] font-medium">{r?.price !== undefined ? `₹${r.price.toLocaleString("en-IN")}` : "—"}</span>
                      <span className={`block text-[12px] ${signClass(r?.ret_1d)}`}>{signed(r?.ret_1d, 2)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {doc.etfs.length > 5 && (
            <button type="button" onClick={() => setShowEtfs(!showEtfs)}
              className="w-full py-2.5 text-[13px] font-semibold text-[var(--accent-ink)] border-t border-[var(--line)]">
              {showEtfs ? "Show fewer" : `Show all ${doc.etfs.length}`}
            </button>
          )}
        </Card>
      )}

      <Card title="About">
        <dl className="px-3 pb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-[var(--ink3)]">Exchange</dt><dd>{doc.exch}</dd>
          <dt className="text-[var(--ink3)]">History</dt><dd>From {dayLabel(doc.since, true)}</dd>
          {doc.factsheet && <><dt className="text-[var(--ink3)]">Factsheet</dt>
            <dd><a href={doc.factsheet} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] underline">NSE Indices (PDF)</a></dd></>}
          <dt className="text-[var(--ink3)]">Sources</dt>
          <dd>{doc.exch === "BSE"
            ? "Daily closes via Yahoo. Not checked against BSE's own files."
            : "NSE's daily index file and NSE Indices (niftyindices.com): candles, P/E, P/B and dividend yield as published. Not checked further."}</dd>
        </dl>
      </Card>
    </div>
  );
}

export default function IndexPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="indices" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5">
        <Suspense fallback={<div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}>
          <IndexView />
        </Suspense>
      </main>
    </div>
  );
}
