"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { Segmented } from "@/components/ListUI";
import { dayLabel, signClass, signed } from "@/lib/commodity";
import { IndexList, IndexListItem, points } from "@/lib/indices";

/** Every NSE index and the Sensex, grouped as NSE groups them, with one
 *  chosen figure on the right. A filter box, because there are 145. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const SHOWS = [["day", "Day"], ["1y", "1Y"], ["pe", "P/E"], ["ath", "From high"]] as const;
type Show = (typeof SHOWS)[number][0];

export default function IndicesPage() {
  const [data, setData] = useState<IndexList | null>(null);
  const [error, setError] = useState("");
  const [show, setShow] = useState<Show>("day");
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
    return data.groups.map((g) => [g, shown.filter((x) => x.group === g)] as const).filter(([, xs]) => xs.length);
  }, [data, q]);

  const cell = (x: IndexListItem): [string, string] => {
    if (show === "1y") return [signed(x.r1y, 1), signClass(x.r1y)];
    if (show === "pe") return [x.pe !== null ? x.pe.toFixed(1) : "—", x.pe_pct !== null && x.pe_pct >= 80 ? "text-[var(--neg)]" : x.pe_pct !== null && x.pe_pct <= 20 ? "text-[var(--pos)]" : "text-[var(--ink)]"];
    if (show === "ath") return [signed(x.from_ath, 1), signClass(x.from_ath)];
    return [signed(x.chg_pct, 2), signClass(x.chg_pct)];
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
              <Segmented label="Show" value={show} options={SHOWS} onChange={setShow} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter indices"
                className="flex-1 min-w-[120px] h-[38px] px-3 rounded-xl border border-[var(--line)] bg-[var(--card)] text-[14px] outline-none focus:border-[var(--accent-line)]" />
            </div>

            {groups.map(([g, xs]) => (
              <section key={g}>
                <h2 className="px-1 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">{g} · {xs.length}</h2>
                <ul className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)] overflow-hidden">
                  {xs.map((x) => {
                    const [text, cls] = cell(x);
                    return (
                      <li key={x.s}>
                        <Link href={`/indices/view?s=${encodeURIComponent(x.s)}`} className="rs-press flex items-center gap-3 px-3 py-2.5 active:bg-[var(--card2)]">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-[15px] truncate">{x.name}</p>
                            <p className="text-xs text-[var(--ink3)] truncate">
                              {x.exch}{x.n ? ` · ${x.n} companies` : ""}{x.date !== data.asof && <> · {dayLabel(x.date)}</>}
                            </p>
                          </div>
                          <div className="text-right shrink-0 tabular-nums">
                            <p className="text-[15px] font-semibold">{points(x.close)}</p>
                            <p className={`text-[12px] font-medium ${cls}`}>{text}</p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
