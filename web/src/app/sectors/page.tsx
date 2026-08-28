"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import { titleCase } from "@/lib/names";
import { Row } from "@/lib/query";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Data = { generated_at: string; rows: Row[] };

function fmtNum(v: string | number | null | undefined, dec = 2): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return v.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

function SectorsView() {
  const params = useSearchParams();
  const sector = params.get("s") ?? "";
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  // The table rendered companies.slice(0, 400) with nothing on screen saying so,
  // while the heading above it stated the sector's full company count - so a
  // 653-company sector showed 400 rows and claimed 653. A limit is fine; a
  // silent one is not.
  const [rowCap, setRowCap] = useState(400);

  useEffect(() => {
    fetch(`${BASE}/data.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  /** Median, not mean. One Reliance would drag a sector's average P/E somewhere
   *  no company in it actually trades, and the point of the number is to say
   *  what is TYPICAL for the sector. */
  const median = (xs: number[]): number | null => {
    const v = xs.filter((x) => typeof x === "number" && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };

  const sectors = useMemo(() => {
    if (!data) return [];
    // A list of counts and totals answers "how big is this sector", which is
    // the one question you can already guess. Adding the medians answers the
    // question worth opening the page for: is this sector expensive, does it
    // earn well on its capital, and how has it done - each against every other
    // sector on the same screen.
    const agg = new Map<string, { count: number; mcap: number; pe: number[]; roe: number[]; ret: number[] }>();
    for (const r of data.rows) {
      const s = (r.sector as string) || "Unclassified";
      const cur = agg.get(s) ?? { count: 0, mcap: 0, pe: [], roe: [], ret: [] };
      cur.count += 1;
      cur.mcap += (r.mcap as number) ?? 0;
      // A negative P/E is a loss, not a cheap share, and including it would pull
      // the median of a loss-making sector towards zero and read as bargain.
      const pe = r.pe as number;
      if (typeof pe === "number" && pe > 0) cur.pe.push(pe);
      const roe = r.roe as number;
      if (typeof roe === "number") cur.roe.push(roe);
      const ret = r.ret_1y as number;
      if (typeof ret === "number") cur.ret.push(ret);
      agg.set(s, cur);
    }
    return [...agg.entries()]
      .map(([name, a]) => [name, {
        count: a.count, mcap: a.mcap,
        pe: median(a.pe), roe: median(a.roe), ret: median(a.ret),
        priced: a.pe.length,
      }] as const)
      .sort((a, b) => b[1].mcap - a[1].mcap);
  }, [data]);

  const companies = useMemo(() => {
    if (!data || !sector) return [];
    return data.rows
      .filter((r) => ((r.sector as string) || "Unclassified") === sector)
      .sort((a, b) => (((b.mcap as number) ?? 0) - ((a.mcap as number) ?? 0)));
  }, [data, sector]);

  if (error) return <p className="text-[var(--neg)]">{error}</p>;
  if (!data) return <p className="text-[var(--ink3)]">Loading…</p>;

  if (!sector) {
    return (
      <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--line)]">
          <h1 className="text-sm font-bold text-[var(--ink)]">Sectors</h1>
          <p className="text-xs text-[var(--ink3)] mt-0.5">
            Median of the companies in each sector, so one very large member cannot speak for the rest.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--card2)] text-xs text-[var(--ink3)] uppercase text-left">
                <th className="px-2 py-2 sm:px-3">Sector</th>
                <th className="px-2 py-2 sm:px-3 text-right">Companies</th>
                <th className="px-2 py-2 sm:px-3 text-right">Total MCap ₹Cr</th>
                <th className="px-2 py-2 sm:px-3 text-right">Median P/E</th>
                <th className="px-2 py-2 sm:px-3 text-right">Median ROE %</th>
                <th className="px-2 py-2 sm:px-3 text-right">Median 1Y %</th>
              </tr>
            </thead>
            <tbody>
              {sectors.map(([name, agg]) => (
                <tr key={name} className="border-t border-[var(--line)] hover:bg-[var(--accent-soft)]">
                  <td className="px-2 py-2 sm:px-3">
                    <Link href={`/sectors?s=${encodeURIComponent(name)}`} className="font-semibold text-[var(--accent-ink)] hover:underline">{name}</Link>
                  </td>
                  <td className="px-2 py-2 sm:px-3 text-right">{agg.count}</td>
                  <td className="px-2 py-2 sm:px-3 text-right">{fmtNum(Math.round(agg.mcap), 0)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right" title={`${agg.priced} of ${agg.count} are profitable and priced`}>
                    {fmtNum(agg.pe, 1)}
                  </td>
                  <td className="px-2 py-2 sm:px-3 text-right">{fmtNum(agg.roe, 1)}</td>
                  <td className={`px-2 py-2 sm:px-3 text-right ${
                    agg.ret == null ? "" : agg.ret >= 0 ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>
                    {agg.ret == null ? "—" : `${agg.ret > 0 ? "+" : ""}${fmtNum(agg.ret, 1)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2.5 text-xs text-[var(--ink3)] border-t border-[var(--line)]">
          Loss-making companies are left out of the median P/E — a negative P/E is a loss, not a cheap share,
          and counting it would make a struggling sector look like a bargain.
        </p>
      </section>
    );
  }

  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
      <h1 className="px-4 py-3 text-sm font-bold text-[var(--ink)] border-b border-[var(--line)]">
        {sector} <span className="font-normal text-[var(--ink3)]">· {companies.length} companies · <Link href="/sectors" className="text-[var(--accent-ink)] hover:underline">all sectors</Link></span>
      </h1>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--card2)] text-xs text-[var(--ink3)] uppercase text-left">
              <th className="px-2 py-2 sm:px-3">Symbol</th><th className="px-2 py-2 sm:px-3">Name</th><th className="px-2 py-2 sm:px-3">Industry</th>
              <th className="px-2 py-2 sm:px-3 text-right">Price ₹</th><th className="px-2 py-2 sm:px-3 text-right">MCap ₹Cr</th>
              <th className="px-2 py-2 sm:px-3 text-right">P/E</th><th className="px-2 py-2 sm:px-3 text-right">ROE %</th>
              <th className="px-2 py-2 sm:px-3 text-right">Div Yld %</th>
            </tr>
          </thead>
          <tbody>
            {companies.slice(0, rowCap).map((r) => (
              <tr key={String(r.symbol)} className="border-t border-[var(--line)] hover:bg-[var(--accent-soft)]">
                <td className="px-2 py-2 sm:px-3"><Link href={`/company?s=${encodeURIComponent(String(r.symbol))}`} className="font-semibold text-[var(--accent-ink)] hover:underline">{String(r.symbol)}</Link></td>
                <td className="px-2 py-2 sm:px-3 max-w-56 truncate">{titleCase(String(r.name ?? "")) || "—"}</td>
                <td className="px-2 py-2 sm:px-3 max-w-48 truncate">{String(r.industry ?? "—")}</td>
                <td className="px-2 py-2 sm:px-3 text-right">{fmtNum(r.price as number)}</td>
                <td className="px-2 py-2 sm:px-3 text-right">{fmtNum(r.mcap as number, 0)}</td>
                <td className="px-2 py-2 sm:px-3 text-right">{fmtNum(r.pe as number)}</td>
                <td className="px-2 py-2 sm:px-3 text-right">{fmtNum(r.roe as number)}</td>
                <td className="px-2 py-2 sm:px-3 text-right">{fmtNum(r.div_yield as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {companies.length > rowCap && (
          <div className="px-3 py-2 text-xs text-[var(--ink3)] border-t border-[var(--line)]">
            Showing {rowCap.toLocaleString("en-IN")} of {companies.length.toLocaleString("en-IN")} companies in this sector
            <button onClick={() => setRowCap(companies.length)}
              className="ml-2 font-semibold text-[var(--accent-ink)] underline underline-offset-2">show all</button>
          </div>
        )}
      </div>
    </section>
  );
}

export default function SectorsPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="sectors" />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Suspense fallback={<p className="text-[var(--ink3)]">Loading…</p>}>
          <SectorsView />
        </Suspense>
      </main>
    </div>
  );
}
