"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { Segmented } from "@/components/ListUI";
import { Row } from "@/lib/query";
import { shortName } from "@/lib/names";
import { Chips, Stat, dayMove, money, signed, tone } from "@/components/QuoteUI";

/** Sectors, then one sector's companies - in the app's row layout rather
 *  than a table that scrolls sideways on a phone. Every figure is a MEDIAN of
 *  the sector's companies, so one Reliance cannot speak for the rest. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
type Data = { generated_at: string; price_asof?: string | null; rows: Row[] };
type Agg = { name: string; count: number; mcap: number; pe: number | null; roe: number | null; ret: number | null; day: number | null; up: number; down: number };

const SHOWS = [["ret", "1Y"], ["day", "Day"], ["pe", "P/E"], ["roe", "ROE"]] as const;
type Show = (typeof SHOWS)[number][0];
const SORTS: ["mcap" | "ret_1d" | "ret_1y" | "pe", string][] = [["mcap", "Market cap"], ["ret_1d", "Day"], ["ret_1y", "1Y"], ["pe", "P/E"]];

function median(xs: number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const crore = (v: number) => (v >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L Cr` : `₹${Math.round(v).toLocaleString("en-IN")} Cr`);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function aggregate(name: string, rows: Row[]): Agg {
  const pe = rows.map((r) => n(r.pe)).filter((x): x is number => x !== null && x > 0);
  const num = (k: string) => rows.map((r) => n(r[k])).filter((x): x is number => x !== null);
  const day = num("ret_1d");
  return {
    name, count: rows.length, mcap: rows.reduce((t, r) => t + (n(r.mcap) ?? 0), 0),
    pe: median(pe), roe: median(num("roe")), ret: median(num("ret_1y")), day: median(day),
    up: day.filter((x) => x > 0).length, down: day.filter((x) => x < 0).length,
  };
}

function SectorsView() {
  const params = useSearchParams();
  const sector = params.get("s") ?? "";
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [show, setShow] = useState<Show>("ret");
  const [industry, setIndustry] = useState("");
  const [sortKey, setSortKey] = useState<"mcap" | "ret_1d" | "ret_1y" | "pe">("mcap");
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    fetch(`${BASE}/data.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const sectors = useMemo(() => {
    if (!data) return [];
    const by = new Map<string, Row[]>();
    for (const r of data.rows) {
      const s = (r.sector as string) || "Unclassified";
      by.set(s, [...(by.get(s) ?? []), r]);
    }
    return Array.from(by.entries()).map(([k, rows]) => aggregate(k, rows)).sort((a, b) => b.mcap - a.mcap);
  }, [data]);

  const members = useMemo(() => (data && sector
    ? data.rows.filter((r) => ((r.sector as string) || "Unclassified") === sector) : []), [data, sector]);
  const industries = useMemo(() => {
    const by = new Map<string, Row[]>();
    for (const r of members) {
      const k = String(r.industry ?? "") || "Other";
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    return Array.from(by.entries()).map(([k, rows]) => aggregate(k, rows)).sort((a, b) => b.mcap - a.mcap);
  }, [members]);
  const shown = useMemo(() => {
    const rows = industry ? members.filter((r) => (String(r.industry ?? "") || "Other") === industry) : members;
    return [...rows].sort((a, b) => {
      const av = n(a[sortKey]), bv = n(b[sortKey]);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return sortKey === "pe" ? av - bv : bv - av;
    });
  }, [members, industry, sortKey]);

  if (error) return <p className="text-[var(--neg)] text-sm">{error}</p>;
  if (!data) return <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />;

  if (!sector) {
    const cell = (a: Agg): [string, string] =>
      show === "pe" ? [a.pe === null ? "—" : a.pe.toFixed(1), "text-[var(--ink)]"]
        : show === "roe" ? [a.roe === null ? "—" : `${a.roe.toFixed(1)}%`, "text-[var(--ink)]"]
        : show === "day" ? [a.day === null ? "—" : `${signed(a.day)}%`, tone(a.day)]
        : [a.ret === null ? "—" : `${signed(a.ret, 1)}%`, tone(a.ret)];
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          Sectors
          <InfoTip title="Sectors">
            <p>Each figure is the median of the sector&apos;s companies, so one very large member cannot speak for the rest.</p>
            <p>Loss-makers are left out of the median P/E — a negative P/E is a loss, not a cheap share.</p>
          </InfoTip>
        </h1>
        <Segmented label="Show" value={show} options={SHOWS} onChange={setShow} />
        <ul className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)] overflow-hidden">
          {sectors.map((a) => {
            const [text, cls] = cell(a);
            return (
              <li key={a.name}>
                <Link href={`/sectors?s=${encodeURIComponent(a.name)}`} className="rs-press flex items-center gap-3 px-3 py-2.5 active:bg-[var(--card2)]">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[15px] truncate">{a.name}</p>
                    <p className="text-xs text-[var(--ink3)] truncate">{a.count.toLocaleString("en-IN")} companies · {crore(a.mcap)}</p>
                  </div>
                  <div className="text-right shrink-0 tabular-nums">
                    <p className={`text-[15px] font-semibold ${cls}`}>{text}</p>
                    <p className="text-[11px] text-[var(--ink3)]">
                      <span className="text-[var(--pos)]">{a.up}</span> / <span className="text-[var(--neg)]">{a.down}</span> today
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const agg = aggregate(sector, members);
  return (
    <div className="space-y-3">
      <header>
        <Link href="/sectors" className="text-[12px] font-semibold text-[var(--accent-ink)]">All sectors</Link>
        <h1 className="text-xl font-bold">{sector}</h1>
        <p className="text-sm text-[var(--ink2)]">{agg.count.toLocaleString("en-IN")} companies · {crore(agg.mcap)}</p>
      </header>
      <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-3 grid grid-cols-4 gap-2">
        <Stat label="Median P/E" value={agg.pe === null ? "—" : agg.pe.toFixed(1)} />
        <Stat label="Median ROE" value={agg.roe === null ? "—" : `${agg.roe.toFixed(1)}%`} />
        <Stat label="Median 1Y" value={agg.ret === null ? "—" : `${signed(agg.ret, 1)}%`} className={tone(agg.ret)} />
        <Stat label="Today" value={<><span className="text-[var(--pos)]">{agg.up}</span> / <span className="text-[var(--neg)]">{agg.down}</span></>} />
      </section>

      {industries.length > 1 && (
        <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] -mx-4 px-4">
          {[["", `All ${agg.count}`] as const, ...industries.map((i) => [i.name, `${i.name} ${i.count}`] as const)].map(([k, label]) => (
            <button key={k || "all"} type="button" onClick={() => { setIndustry(k); setLimit(50); }}
              className={`shrink-0 min-h-[34px] px-3 rounded-full text-[13px] border whitespace-nowrap ${industry === k
                ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)] font-semibold" : "text-[var(--ink2)] border-[var(--line)]"}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      <Chips value={sortKey} options={SORTS} onChange={(k) => setSortKey(k)} />

      <ul className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)] overflow-hidden">
        {shown.slice(0, limit).map((r) => {
          const sym = String(r.symbol);
          const price = n(r.price), chg = n(r.ret_1d);
          return (
            <li key={sym}>
              <Link href={`/company?s=${encodeURIComponent(sym)}`} className="rs-press block px-3 py-2.5 active:bg-[var(--card2)]">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[15px] font-medium">{sym}</span>
                  <span className={`shrink-0 text-[15px] font-medium tabular-nums ${tone(chg)}`}>{money(price)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-[11px] text-[var(--ink3)]">
                  <span className="min-w-0 truncate">{shortName(String(r.name ?? ""), sym)}</span>
                  <span className="shrink-0 tabular-nums">{chg === null ? "—" : <>{signed(dayMove(price, chg))} <span className={tone(chg)}>({signed(chg)}%)</span></>}</span>
                </div>
                <p className="mt-0.5 text-[12px] text-[var(--ink2)] tabular-nums truncate">
                  <span className="text-[var(--ink3)]">P/E</span> {n(r.pe)?.toFixed(1) ?? "—"}
                  <span className="text-[var(--ink3)]"> · ROE</span> {n(r.roe) === null ? "—" : `${n(r.roe)!.toFixed(1)}%`}
                  <span className="text-[var(--ink3)]"> · MCap</span> {n(r.mcap) === null ? "—" : crore(n(r.mcap)!)}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit(limit + 100)}
          className="rs-press w-full min-h-[44px] rounded-xl border border-[var(--line)] text-[14px] font-semibold text-[var(--ink2)]">
          Show more · {(shown.length - limit).toLocaleString("en-IN")} left
        </button>
      )}
    </div>
  );
}

export default function SectorsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="sectors" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5">
        <Suspense fallback={<div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}>
          <SectorsView />
        </Suspense>
      </main>
    </div>
  );
}
