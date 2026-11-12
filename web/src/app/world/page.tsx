"use client";

import { useEffect, useState } from "react";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { Segmented } from "@/components/ListUI";
import { HeatLegend, HeatTile, HeatTiles } from "@/components/Heatmap";
import { HEAT_FULL, HeatPeriod, modal } from "@/lib/treemap";
import { dayLabel, signClass, signed } from "@/lib/commodity";

/** The world's stock markets as a heatmap: one tile a market, in blocks by
 *  region, each on its own last finished close. Written by
 *  pipeline/export_world_json.py. Read-only, like the rest. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Moves = { date: string; close: number; d1: number | null; w1: number | null; m1: number | null; y1: number | null };
type WorldItem = Moves & { s: string; name: string; country: string; region: string; cur: string | null; page?: boolean };
type WorldExtra = Moves & { s: string; name: string; what: string; abs: boolean };
type World = { generated_at: string; asof: string | null; regions: string[]; items: WorldItem[]; extras: WorldExtra[] };

const PERIODS: readonly (readonly [HeatPeriod, string])[] = [["d1", "Day"], ["w1", "1W"], ["m1", "1M"], ["y1", "1Y"]];
const EMPTY: World = { generated_at: "", asof: null, regions: [], items: [], extras: [] };

/** An index level: no decimals once it is in the thousands. */
function level(v: number, india = false): string {
  return v.toLocaleString(india ? "en-IN" : "en-US", { maximumFractionDigits: v >= 1000 ? 0 : 2 });
}

export default function WorldPage() {
  const [data, setData] = useState<World | null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<HeatPeriod>("d1");

  useEffect(() => {
    fetch(`${BASE}/world.json`)
      // No file yet is not a fault: the first nightly run after this page shipped writes it.
      .then((r) => { if (r.status === 404) return EMPTY; if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const full = HEAT_FULL[period];
  const digits = period === "d1" ? 2 : 1;
  const extraDate = data ? modal(data.extras.map((x) => x.date)) : null;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="world" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          World
          <InfoTip title="World markets">
            <p>Thirty stock indices around the world beside the Nifty 50 and the Sensex, one tile each, coloured by how far it moved.</p>
            <p><b>Its own currency.</b> Every figure is the index as its own exchange prints it: a Nikkei move is in yen, not rupees.</p>
            <p><b>Its own day.</b> Each market shows its last finished session. Markets close at different hours, so the newest close is not the same date everywhere; a tile carries its date when it differs from its region&apos;s.</p>
            <p><b>Colour.</b> Green is a rise and red a fall, at full strength from 3% for a day, 6% for a week, 10% for a month and 40% for a year.</p>
            <p>Closes from Yahoo Finance, read once a night; the two Indian indices from this app&apos;s own index data. Not checked further. GIFT Nifty is not here: it has no open source.</p>
          </InfoTip>
        </h1>

        {error && <p className="text-[var(--neg)] text-sm">{error}</p>}
        {!data && !error && <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}

        {data && data.items.length === 0 && (
          <p className="text-sm text-[var(--ink2)]">The world&apos;s markets have not been read yet. They arrive with the next nightly run.</p>
        )}

        {data && data.items.length > 0 && (
          <>
            <p className="text-sm text-[var(--ink2)]">
              Last finished close of each market{data.asof ? ` · newest ${dayLabel(data.asof, true)}` : ""}
            </p>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Segmented label="Change over" value={period} options={PERIODS} onChange={setPeriod} />
              <HeatLegend full={full} />
            </div>

            {data.regions.map((region) => {
              const xs = data.items.filter((x) => x.region === region);
              const day = modal(xs.map((x) => x.date));
              const tiles: HeatTile[] = xs.map((x) => ({
                key: x.s, label: x.name, sub: x.country, right: level(x.close, x.region === "India"), v: x[period],
                note: x.date !== day ? dayLabel(x.date) : undefined,
                href: x.page ? `/indices/view?s=${encodeURIComponent(x.s)}` : undefined,
              }));
              return (
                <section key={region}>
                  <h2 className="px-1 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
                    {region} · {xs.length}<span className="normal-case tracking-normal font-normal"> · {dayLabel(day)}</span>
                  </h2>
                  <HeatTiles tiles={tiles} full={full} digits={digits} min={136} />
                </section>
              );
            })}

            {data.regions.length <= 1 && (
              <p className="text-[12px] text-[var(--ink3)]">The other regions arrive with the next nightly run.</p>
            )}

            {data.extras.length > 0 && (
              <section>
                <h2 className="px-1 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
                  Alongside<span className="normal-case tracking-normal font-normal"> · {dayLabel(extraDate)}</span>
                </h2>
                <ul className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)]">
                  {data.extras.map((x) => (
                    <li key={x.s} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-medium truncate">{x.name}</span>
                        <span className="block text-[11px] text-[var(--ink3)] truncate">
                          {x.what}{x.date !== extraDate ? ` · ${dayLabel(x.date)}` : ""}
                        </span>
                      </span>
                      <span className="text-right tabular-nums">
                        <span className="block text-[14px] font-medium">{x.close.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
                        {/* A yield's change is in percentage points, never a percent of a percent. */}
                        <span className={`block text-[12px] ${signClass(x[period])}`}>{signed(x[period], 2, x.abs ? " pts" : "%")}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
