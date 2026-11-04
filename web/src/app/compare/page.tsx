"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import { loadIndex } from "@/lib/index-data";
import { buildIndex, search, type SearchIndex, type SearchRow } from "@/lib/search";
import { shortName } from "@/lib/names";

/** Two to four companies side by side - screener.in's "Detailed comparison".
 *  Each company's own file (about 32 KB) is read, not the screener table, and
 *  the list lives in the address (?s=TCS,INFY) so a comparison can be kept or
 *  shared. Figures only - which one is "better" is the reader's call. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const MAX = 4;
type Num = number | null | undefined;
type Trend = { periods: string[]; revenue: Num[]; pat: Num[]; opm?: Num[] };
type Co = { name: string; row: Record<string, unknown>; annual?: Trend; error?: boolean };

const ROWS: [string, [string, string, number, string][]][] = [
  ["Size and price", [["price", "Price", 2, "₹"], ["mcap", "Market cap", 0, "₹ Cr"], ["ret_1y", "Return 1Y", 1, "%"], ["ret_3y", "Return 3Y", 1, "%"]]],
  ["What it costs", [["pe", "P/E", 1, ""], ["pb", "P/B", 2, ""], ["ev_ebitda", "EV / EBITDA", 1, ""], ["div_yield", "Dividend yield", 2, "%"]]],
  ["How it earns", [["roce", "ROCE", 1, "%"], ["roe", "ROE", 1, "%"], ["op_margin", "Operating margin", 1, "%"], ["net_margin", "Net margin", 1, "%"]]],
  ["How it grew", [["sales_cagr_5y", "Sales growth 5Y", 1, "%"], ["profit_cagr_5y", "Profit growth 5Y", 1, "%"], ["qtr_sales_yoy", "Qtr sales YoY", 1, "%"], ["qtr_profit_yoy", "Qtr profit YoY", 1, "%"]]],
  ["Latest quarter", [["qtr_sales", "Sales", 0, "₹ Cr"], ["qtr_profit", "Net profit", 0, "₹ Cr"]]],
  ["Risk and ownership", [["de", "Debt / equity", 2, ""], ["promoter_holding", "Promoters", 1, "%"], ["fii_holding", "FIIs", 1, "%"], ["dii_holding", "DIIs", 1, "%"], ["volatility_1y", "Volatility 1Y", 1, "%"]]],
];

function fmt(v: unknown, dec: number, unit: string): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const n = v.toLocaleString("en-IN", { maximumFractionDigits: dec, minimumFractionDigits: dec });
  return unit === "₹" ? `₹${n}` : unit === "₹ Cr" ? `₹${n} Cr` : unit === "%" ? `${n}%` : n;
}

function CompareView() {
  const params = useSearchParams();
  const router = useRouter();
  const syms = useMemo(() => (params.get("s") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean).slice(0, MAX), [params]);
  const [cos, setCos] = useState<Record<string, Co>>({});
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    loadIndex().then((d) => setIndex(buildIndex(d.rows.filter((r) => !r.etf && !r.commodity && !r.index) as SearchRow[]))).catch(() => {});
  }, []);
  useEffect(() => {
    for (const s of syms) {
      if (cos[s]) continue;
      fetch(`${BASE}/companies/${encodeURIComponent(s)}.json`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => setCos((c) => ({ ...c, [s]: { name: String(d.snapshot?.name ?? s), row: { ...(d.snapshot ?? {}), ...(d.row ?? {}) }, annual: d.trend?.annual } })))
        .catch(() => setCos((c) => ({ ...c, [s]: { name: s, row: {}, error: true } })));
    }
  }, [syms, cos]);

  const go = (next: string[]) => router.replace(`/compare?s=${next.map(encodeURIComponent).join(",")}`);
  const hits = index && q.trim() ? search(index, q, 6).hits.filter((h) => !syms.includes(h.symbol)) : [];
  const years = useMemo(() => {
    const all = new Set<string>();
    for (const s of syms) for (const p of cos[s]?.annual?.periods ?? []) all.add(p);
    return [...all].sort().slice(-5);
  }, [syms, cos]);
  const yearVal = (s: string, key: "revenue" | "pat", y: string) => {
    const a = cos[s]?.annual;
    const i = a?.periods.indexOf(y) ?? -1;
    return a && i >= 0 ? a[key][i] : null;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Compare companies</h1>
        <p className="text-xs text-[var(--ink3)] mt-0.5">Up to {MAX}, side by side. Figures from free sources, unverified until checked against a filing.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {syms.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] pl-3 pr-1 py-1 text-[13px]">
            <Link href={`/company?s=${encodeURIComponent(s)}`} className="font-semibold text-[var(--accent-ink)]">{s}</Link>
            <button type="button" aria-label={`Remove ${s}`} onClick={() => go(syms.filter((x) => x !== s))} className="w-6 h-6 text-[var(--ink3)]">✕</button>
          </span>
        ))}
      </div>
      {syms.length < MAX && (
        <div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a company"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--card2)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)]" />
          {hits.map((h) => (
            <button key={h.symbol} type="button" onClick={() => { go([...syms, h.symbol]); setQ(""); }}
              className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--card2)] flex items-baseline justify-between gap-3">
              <span className="text-sm text-[var(--ink)] truncate">{h.name}</span>
              <span className="text-xs text-[var(--ink3)]">{h.symbol}</span>
            </button>
          ))}
        </div>
      )}
      {syms.length > 0 && (
        <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="px-3 py-2 text-left sticky left-0 bg-[var(--card)]" />
                {syms.map((s) => (
                  <th key={s} className="px-3 py-2 text-right font-semibold whitespace-nowrap">
                    {cos[s] ? shortName(cos[s].name, s) || s : s}
                    {cos[s]?.error && <span className="block text-[11px] font-normal text-[var(--neg)]">not found</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.flatMap(([group, rows]) => [
                <tr key={group}><td colSpan={syms.length + 1} className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink3)] sticky left-0">{group}</td></tr>,
                ...rows.map(([k, label, dec, unit]) => (
                  <tr key={k} className="border-b border-[var(--line)]">
                    <td className="px-3 py-1.5 text-[var(--ink2)] whitespace-nowrap sticky left-0 bg-[var(--card)]">{label}</td>
                    {syms.map((s) => <td key={s} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{fmt(cos[s]?.row[k], dec, unit)}</td>)}
                  </tr>
                )),
              ])}
              {years.length > 0 && ([["revenue", "Sales"], ["pat", "Net profit"]] as const).flatMap(([key, label]) => [
                <tr key={key}><td colSpan={syms.length + 1} className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink3)] sticky left-0">{label}, ₹ Cr</td></tr>,
                ...years.map((y) => (
                  <tr key={`${key}${y}`} className="border-b border-[var(--line)]">
                    <td className="px-3 py-1.5 text-[var(--ink2)] whitespace-nowrap sticky left-0 bg-[var(--card)]">FY{Number(y.slice(0, 4)) + (Number(y.slice(5, 7)) >= 4 ? 1 : 0)}</td>
                    {syms.map((s) => <td key={s} className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{fmt(yearVal(s, key, y), 0, "")}</td>)}
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav />
      <main className="rs-page-in max-w-4xl mx-auto px-4 py-5">
        <Suspense fallback={<div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}>
          <CompareView />
        </Suspense>
      </main>
    </div>
  );
}
