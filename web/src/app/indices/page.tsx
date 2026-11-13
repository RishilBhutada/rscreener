"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { dayLabel, signClass, signed } from "@/lib/commodity";
import { IndexList, IndexListItem, points } from "@/lib/indices";
import { Segmented } from "@/components/ListUI";
import { HeatLegend, HeatTiles } from "@/components/Heatmap";
import { HEAT_FULL, HeatPeriod } from "@/lib/treemap";
import MarketPulse from "@/components/MarketPulse";

/** Every NSE index and the Sensex, grouped as NSE groups them, with one
 *  chosen figure on the right. A filter box, because there are 145. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** The grid's columns: level, then the four figures that used to be picked one at a time. */
const COLS: [string, string][] = [["close", "Level"], ["chg_pct", "Day"], ["r1y", "1Y"], ["pe", "P/E"], ["from_ath", "From high"]];

/** List or heatmap: the same indices, the same groups. The choice is kept. */
type View = "list" | "map";
const VIEWS: readonly (readonly [View, string])[] = [["list", "List"], ["map", "Heatmap"]];
const VIEW_KEY = "rscreener_indices_view";
function savedView(): View {
  try { return typeof window !== "undefined" && window.localStorage.getItem(VIEW_KEY) === "map" ? "map" : "list"; } catch { return "list"; }
}
/** The figure a tile is coloured by, for each period. */
const HEAT_FIELD: Record<HeatPeriod, "chg_pct" | "r1w" | "r1m" | "r1y"> = { d1: "chg_pct", w1: "r1w", m1: "r1m", y1: "r1y" };

export default function IndicesPage() {
  const [data, setData] = useState<IndexList | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>(savedView);
  const [picked, setPeriod] = useState<HeatPeriod>("d1");
  const pickView = (v: View) => { setView(v); try { window.localStorage.setItem(VIEW_KEY, v); } catch { /* private window: the choice lasts the visit */ } };
  // The week's change is in files written from 12-Nov-2026 on; until one arrives the switch leaves it out.
  const has1w = useMemo(() => !!data && data.items.some((x) => typeof x.r1w === "number"), [data]);
  const periods = useMemo(() => ([["d1", "Day"], ...(has1w ? [["w1", "1W"]] : []), ["m1", "1M"], ["y1", "1Y"]] as [HeatPeriod, string][]), [has1w]);
  const period: HeatPeriod = picked === "w1" && !has1w ? "d1" : picked;

  useEffect(() => {
    fetch(`${BASE}/indices.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const t = q.trim().toLowerCase();
    const shown = data.items.filter((x) => !t || x.name.toLowerCase().includes(t));
    const val = (x: IndexListItem) => (sort ? (x as unknown as Record<string, number | null>)[sort.key] : null);
    const order = (xs: IndexListItem[]) => !sort ? xs : [...xs].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return sort.desc ? vb - va : va - vb;
    });
    return data.groups.map((g) => [g, order(shown.filter((x) => x.group === g))] as const).filter(([, xs]) => xs.length);
  }, [data, q, sort]);

  const tap = (k: string) => setSort(!sort || sort.key !== k ? { key: k, desc: true } : sort.desc ? { key: k, desc: false } : null);
  const tint = (c: number | null) => c ? `color-mix(in srgb, var(${c > 0 ? "--pos" : "--neg"}) ${Math.round(8 + 18 * Math.min(Math.abs(c) / 3, 1))}%, transparent)` : undefined;
  const cell = (x: IndexListItem, k: string) => {
    if (k === "close") return <span className="text-[var(--ink)] font-semibold">{points(x.close)}</span>;
    if (k === "chg_pct") return <span className={signClass(x.chg_pct)}>{signed(x.chg_pct, 2)}</span>;
    if (k === "r1y") return <span className={signClass(x.r1y)}>{signed(x.r1y, 1)}</span>;
    if (k === "from_ath") return <span className={signClass(x.from_ath)}>{signed(x.from_ath, 1)}</span>;
    // P/E is plain (owner, 31-Oct-2026): no good/bad colouring of a ratio.
    return <span className="text-[var(--ink2)]">{x.pe !== null ? x.pe.toFixed(1) : "—"}</span>;
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="indices" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          Indices
          <InfoTip title="Indices">
            <p>Every equity index NSE publishes each day, India VIX and the Sensex, grouped as NSE Indices groups them.</p>
            <p><b>P/E</b> is the index&apos;s own, as NSE publishes it. Where it sits against its own last ten years is in the Screener (Indices, &quot;P/E against its 10 years&quot;). <b>From high</b> is the distance below the index&apos;s highest close.</p>
            <p>Closes from NSE&apos;s daily index file and NSE Indices; the Sensex from Yahoo. Not checked further.</p>
          </InfoTip>
        </h1>

        <MarketPulse />

        {error && <p className="text-[var(--neg)] text-sm">{error}</p>}
        {!data && !error && <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}

        {data && (
          <>
            <p className="text-sm text-[var(--ink2)]">Closes of {dayLabel(data.asof, true)}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter indices"
                className="flex-1 min-w-[120px] h-[38px] px-3 rounded-xl border border-[var(--line)] bg-[var(--card)] text-[14px] outline-none focus:border-[var(--accent-line)]" />
              <Segmented label="View" value={view} options={VIEWS} onChange={pickView} />
            </div>

            {view === "map" && (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Segmented label="Change over" value={period} options={periods} onChange={setPeriod} />
                <HeatLegend full={HEAT_FULL[period]} />
              </div>
            )}
            {view === "map" && groups.map(([g, xs]) => (
              <section key={g}>
                <h2 className="px-1 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">{g} · {xs.length}</h2>
                <HeatTiles full={HEAT_FULL[period]} digits={period === "d1" ? 2 : 1} tiles={xs.map((x) => ({
                  key: x.s, label: x.name, v: x[HEAT_FIELD[period]], href: `/indices/view?s=${encodeURIComponent(x.s)}`,
                  note: x.date !== data.asof ? dayLabel(x.date) : undefined,
                }))} />
              </section>
            ))}

            {view === "list" && groups.map(([g, xs]) => (
              <section key={g}>
                <h2 className="px-1 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">{g} · {xs.length}</h2>
                <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--card)] [scrollbar-width:none]">
                  <table className="w-full text-[13px] border-collapse tabular-nums">
                    <thead>
                      <tr className="text-[11px] text-[var(--ink3)] border-b border-[var(--line)]">
                        <th scope="col" className="px-2.5 py-2 text-left font-medium sticky left-0 z-10 bg-[var(--card)]">Name</th>
                        {COLS.map(([k, label]) => (
                          <th key={k} scope="col" aria-sort={sort?.key === k ? (sort.desc ? "descending" : "ascending") : undefined}
                            className="px-2 py-2 text-right font-medium whitespace-nowrap">
                            <button type="button" onClick={() => tap(k)} className={sort?.key === k ? "text-[var(--accent-ink)] font-semibold" : ""}>
                              {label}{sort?.key === k && <span aria-hidden="true">{sort.desc ? "\u25BE" : "\u25B4"}</span>}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {xs.map((x) => (
                        <tr key={x.s} className="border-b border-[var(--line)] last:border-b-0 hover:bg-[var(--card2)]">
                          <th scope="row" className="px-2.5 py-2 text-left font-semibold sticky left-0 bg-[var(--card)] max-w-[40vw] sm:max-w-none">
                            <Link href={`/indices/view?s=${encodeURIComponent(x.s)}`} className="block truncate text-[var(--ink)]"
                              title={`${x.exch}${x.n ? ` · ${x.n} companies` : ""}`}>{x.name}</Link>
                            {x.date !== data.asof && <span className="block text-[10.5px] font-normal text-[var(--ink3)]">{dayLabel(x.date)}</span>}
                          </th>
                          {COLS.map(([k]) => (
                            <td key={k} className="px-2 py-2 text-right whitespace-nowrap" style={k === "chg_pct" ? { background: tint(x.chg_pct) } : undefined}>{cell(x, k)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
