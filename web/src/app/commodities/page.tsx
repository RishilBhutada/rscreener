"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { Segmented } from "@/components/ListUI";
import { GROUP_ORDER, dayLabel, expiryLabel, rupees, signClass, signed, type CommodityListItem } from "@/lib/commodity";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Data = { generated_at: string; asof: string | null; items: CommodityListItem[] };

const SHOWS = [["next", "Next expiry"], ["world", "vs World / Spot"], ["chg", "Day"]] as const;
type Show = (typeof SHOWS)[number][0];

export default function CommoditiesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [show, setShow] = useState<Show>("next");
  const [minis, setMinis] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/commodities.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const groups = useMemo(() => {
    if (!data) return [];
    const shown = data.items.filter((x) => minis || x.s === x.family);
    return GROUP_ORDER.map((g) => [g, shown.filter((x) => x.group === g)] as const).filter(([, xs]) => xs.length);
  }, [data, minis]);

  const cell = (x: CommodityListItem) => {
    if (show === "world") {
      // MCX against the world; NCDEX, which has no world contract, against its mandi.
      const v = x.world_prem ?? x.spot_prem ?? null;
      return [signed(v), v === null ? "text-[var(--ink3)]" : "text-[var(--ink)]"];
    }
    if (show === "chg") return [signed(x.chg, 2), signClass(x.chg)];
    return [signed(x.next_prem, 2), x.next_prem === null ? "text-[var(--ink3)]" : "text-[var(--ink)]"];
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="commodities" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          Commodities
          <InfoTip title="Commodities">
            <p>MCX and NCDEX futures: the same commodity trades for several delivery months at once, each at its own price.</p>
            <p><b>Next expiry</b> is how far the second month sits above the first. Above zero, later delivery costs more — usually the interest and storage on holding the metal. Below zero, the market wants it now.</p>
            <p><b>vs World</b> is MCX against the same month on COMEX or NYMEX, in rupees at the day&apos;s dollar rate. For gold and silver most of the gap is import duty; for crude and gas, which MCX settles on the US price, it should be near zero.</p>
            <p>For NCDEX the same column is the contract against the physical (mandi) price at its delivery centre - Unjha for jeera, Deesa for castor - from Agmarknet. Most of that gap is grade and place.</p>
            <p>MCX prices are its own daily closes, from Upstox&apos;s public data; world prices from Yahoo. NCDEX prices come through your Angel One login, read-only.</p>
          </InfoTip>
        </h1>

        {error && <p className="text-[var(--neg)] text-sm">{error}</p>}
        {!data && !error && <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}

        {data && (
          <>
            <p className="text-sm text-[var(--ink2)]">
              Closes of {dayLabel(data.asof, true)} · MCX and NCDEX
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Segmented label="Show" value={show} options={SHOWS} onChange={setShow} />
              <button type="button" onClick={() => setMinis((m) => !m)} aria-pressed={minis}
                className={`min-h-[34px] px-3 rounded-xl border text-[13px] font-medium ${minis ? "border-[var(--accent)] text-[var(--accent-ink)] bg-[var(--accent-soft)]" : "border-[var(--line)] text-[var(--ink3)]"}`}>
                Mini sizes
              </button>
            </div>

            {groups.map(([g, xs]) => (
              <section key={g}>
                <h2 className="px-1 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">{g}</h2>
                <ul className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)] overflow-hidden">
                  {xs.map((x) => {
                    const [text, cls] = cell(x);
                    return (
                      <li key={x.s}>
                        <Link href={`/commodity?s=${encodeURIComponent(x.s)}`} className="rs-press flex items-center gap-3 px-3 py-2.5 active:bg-[var(--card2)]">
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-[15px] truncate">{x.name}</p>
                            <p className="text-xs text-[var(--ink3)] truncate">
                              {expiryLabel(x.expiry)} · {x.quoted}
                              {x.date !== data.asof && <> · last traded {dayLabel(x.date)}</>}
                            </p>
                          </div>
                          <div className="text-right shrink-0 tabular-nums">
                            <p className="text-[15px] font-semibold">{rupees(x.close)}</p>
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
