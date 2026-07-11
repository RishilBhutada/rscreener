"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { loadWatchlist } from "@/lib/store";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Ev = { symbol: string; company: string; purpose: string; date: string; desc: string };
type Calendar = { generated_at: string; events: Ev[] };

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

export default function CalendarPage() {
  const [cal, setCal] = useState<Calendar | null>(null);
  const [error, setError] = useState("");
  const [resultsOnly, setResultsOnly] = useState(true);
  const [watchOnly, setWatchOnly] = useState(false);
  const [watch, setWatch] = useState<string[]>([]);

  useEffect(() => {
    fetch(`${BASE}/calendar.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setCal)
      .catch((e) => setError(String(e.message ?? e)));
    setWatch(loadWatchlist());
  }, []);

  const grouped = useMemo(() => {
    if (!cal) return [];
    const today = new Date().toISOString().slice(0, 10);
    let evs = cal.events.filter((e) => e.date >= today);
    if (resultsOnly) evs = evs.filter((e) => (e.purpose || "").toLowerCase().includes("result"));
    if (watchOnly) evs = evs.filter((e) => watch.includes(e.symbol));
    const by: Record<string, Ev[]> = {};
    for (const e of evs) (by[e.date] ??= []).push(e);
    return Object.entries(by).sort(([a], [b]) => a.localeCompare(b));
  }, [cal, resultsOnly, watchOnly, watch]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="text-sm text-emerald-700 font-semibold hover:underline">← Screener</Link>
          <span className="text-2xl font-bold text-emerald-700">Rscreener</span>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-lg font-bold text-slate-800">Upcoming board meetings</h1>
          <div className="flex gap-2 text-xs">
            <button onClick={() => setResultsOnly(!resultsOnly)}
              className={`rounded-full px-3 py-1 border ${resultsOnly ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold" : "bg-white border-slate-200 text-slate-500"}`}>
              Results only
            </button>
            <button onClick={() => setWatchOnly(!watchOnly)}
              className={`rounded-full px-3 py-1 border ${watchOnly ? "bg-emerald-50 border-emerald-300 text-emerald-800 font-semibold" : "bg-white border-slate-200 text-slate-500"}`}>
              ★ My watchlist
            </button>
          </div>
        </div>
        {error && <p className="text-red-600 text-sm">{error} — run the pipeline&apos;s fetch_events step first.</p>}
        {!cal && !error && <p className="text-slate-400 text-sm">Loading…</p>}
        {cal && grouped.length === 0 && <p className="text-slate-400 text-sm">Nothing upcoming under the current filters.</p>}
        {grouped.map(([date, evs]) => (
          <section key={date} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <h2 className="px-4 py-2.5 text-sm font-bold text-slate-800 border-b border-slate-100">{dateLabel(date)}</h2>
            <ul>
              {evs.map((e, i) => (
                <li key={`${e.symbol}-${i}`} className="px-4 py-2.5 border-t border-slate-50 flex gap-3 items-baseline flex-wrap">
                  <Link href={`/company?s=${e.symbol}`} className="font-semibold text-emerald-700 hover:underline shrink-0">{e.symbol}</Link>
                  <span className="text-xs font-semibold text-slate-500 shrink-0">{e.purpose}</span>
                  <span className="text-xs text-slate-400 truncate max-w-full">{e.desc}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {cal && <p className="text-xs text-slate-400">Source: NSE event calendar · as of {cal.generated_at} · refreshed nightly</p>}
      </main>
    </div>
  );
}
