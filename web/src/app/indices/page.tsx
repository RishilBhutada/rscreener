"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { dayLabel, signClass, signed } from "@/lib/commodity";
import { IndexList, IndexListItem, points } from "@/lib/indices";

/** Every NSE index and the Sensex, grouped as NSE groups them, with one
 *  chosen figure on the right. A filter box, because there are 145. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** The grid's columns: level, then the four figures that used to be picked one at a time. */
const COLS: [string, string][] = [["close", "Level"], ["chg_pct", "Day"], ["r1y", "1Y"], ["pe", "P/E"], ["from_ath", "From high"]];

export default function IndicesPage() {
  const [data, setData] = useState<IndexList | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [q, setQ] = useState("");

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
    // P/E keeps its own reading: red when dearer than on 80% of ten years' days, green when cheaper.
    return <span className={x.pe_pct !== null && x.pe_pct >= 80 ? "text-[var(--neg)]" : x.pe_pct !== null && x.pe_pct <= 20 ? "text-[var(--pos)]" : "text-[var(--ink2)]"}>{x.pe !== null ? x.pe.toFixed(1) : "—"}</span>;
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="indices" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          Indices
          <InfoTip title="Indices">
            <p>Every equity index NSE publishes each day, India VIX and the Sensex, grouped as NSE Indices groups them.</p>
            <p><b>P/E</b> is the index&apos;s own, as NSE publishes it: red when dearer than on 80% of the last ten years&apos; days, green when cheaper than on 80%. <b>From high</b> is the distance below the index&apos;s highest close.</p>
            <p>Closes from NSE&apos;s daily index file and NSE Indices; the Sensex from Yahoo. Not checked further.</p>
          </InfoTip>
        </h1>

        {error && <p className="text-[var(--neg)] text-sm">{error}</p>}
        {!data && !error && <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}

        {data && (
          <>
            <p className="text-sm text-[var(--ink2)]">Closes of {dayLabel(data.asof, true)}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter indices"
                className="flex-1 min-w-[120px] h-[38px] px-3 rounded-xl border border-[var(--line)] bg-[var(--card)] text-[14px] outline-none focus:border-[var(--accent-line)]" />
            </div>

            {groups.map(([g, xs]) => (
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
