"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
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

  useEffect(() => {
    fetch(`${BASE}/data.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const sectors = useMemo(() => {
    if (!data) return [];
    const agg = new Map<string, { count: number; mcap: number }>();
    for (const r of data.rows) {
      const s = (r.sector as string) || "Unclassified";
      const cur = agg.get(s) ?? { count: 0, mcap: 0 };
      cur.count += 1;
      cur.mcap += (r.mcap as number) ?? 0;
      agg.set(s, cur);
    }
    return [...agg.entries()].sort((a, b) => b[1].mcap - a[1].mcap);
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
        <h1 className="px-4 py-3 text-sm font-bold text-[var(--ink)] border-b border-[var(--line)]">Sectors</h1>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--card2)] text-xs text-[var(--ink3)] uppercase text-left">
                <th className="px-3 py-2">Sector</th>
                <th className="px-3 py-2 text-right">Companies</th>
                <th className="px-3 py-2 text-right">Total MCap ₹Cr</th>
              </tr>
            </thead>
            <tbody>
              {sectors.map(([name, agg]) => (
                <tr key={name} className="border-t border-[var(--line)] hover:bg-[var(--accent-soft)]">
                  <td className="px-3 py-2">
                    <Link href={`/sectors?s=${encodeURIComponent(name)}`} className="font-semibold text-[var(--accent-ink)] hover:underline">{name}</Link>
                  </td>
                  <td className="px-3 py-2 text-right">{agg.count}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(Math.round(agg.mcap), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
              <th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Industry</th>
              <th className="px-3 py-2 text-right">Price ₹</th><th className="px-3 py-2 text-right">MCap ₹Cr</th>
              <th className="px-3 py-2 text-right">P/E</th><th className="px-3 py-2 text-right">ROE %</th>
              <th className="px-3 py-2 text-right">Div Yld %</th>
            </tr>
          </thead>
          <tbody>
            {companies.slice(0, 400).map((r) => (
              <tr key={String(r.symbol)} className="border-t border-[var(--line)] hover:bg-[var(--accent-soft)]">
                <td className="px-3 py-2"><Link href={`/company?s=${r.symbol}`} className="font-semibold text-[var(--accent-ink)] hover:underline">{String(r.symbol)}</Link></td>
                <td className="px-3 py-2 max-w-56 truncate">{String(r.name ?? "—")}</td>
                <td className="px-3 py-2 max-w-48 truncate">{String(r.industry ?? "—")}</td>
                <td className="px-3 py-2 text-right">{fmtNum(r.price as number)}</td>
                <td className="px-3 py-2 text-right">{fmtNum(r.mcap as number, 0)}</td>
                <td className="px-3 py-2 text-right">{fmtNum(r.pe as number)}</td>
                <td className="px-3 py-2 text-right">{fmtNum(r.roe as number)}</td>
                <td className="px-3 py-2 text-right">{fmtNum(r.div_yield as number)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
