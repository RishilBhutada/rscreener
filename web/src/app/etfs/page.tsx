"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { Segmented } from "@/components/ListUI";
import { premClass, premText, type EtfListItem } from "@/lib/etf";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Data = { generated_at: string; nav_asof: string | null; etfs: EtfListItem[] };

const CLASSES = [
  ["all", "All"], ["equity", "Equity"], ["international", "Global"], ["gold", "Gold"], ["silver", "Silver"], ["debt", "Debt"],
] as const;
type Klass = (typeof CLASSES)[number][0];
const SORTS = [["prem", "Premium"], ["r1y", "1Y"], ["liq", "Traded"], ["name", "Name"]] as const;
type Sort = (typeof SORTS)[number][0];

export default function EtfsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [klass, setKlass] = useState<Klass>("all");
  const [sort, setSort] = useState<Sort>("prem");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch(`${BASE}/etfs.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const shown = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const list = data.etfs.filter((e) =>
      (klass === "all" || e.class === klass) &&
      (!needle || e.s.toLowerCase().includes(needle) || e.name.toLowerCase().includes(needle) ||
        e.underlying.toLowerCase().includes(needle)));
    const val = (e: EtfListItem): number => {
      if (sort === "prem") return e.prem ?? -Infinity;
      if (sort === "r1y") return e.r1y_price ?? -Infinity;
      return e.turnover_cr ?? -Infinity;
    };
    return sort === "name" ? list.sort((a, b) => a.s.localeCompare(b.s)) : list.sort((a, b) => val(b) - val(a));
  }, [data, klass, sort, q]);

  const above = data ? data.etfs.filter((e) => (e.prem ?? 0) >= 2 && !e.thin).length : 0;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="etfs" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          ETFs
          <InfoTip title="ETFs">
            <p>
              An ETF has two prices. The <b>price</b> is what the exchange charges; the <b>NAV</b> is
              what each unit actually holds, published by the fund house every evening.
            </p>
            <p>
              <b>Premium</b> is how far the price sits above the NAV. When fund houses cannot
              create new units — as with the US-index ETFs under RBI&apos;s overseas limit — the
              price can run well above the NAV, and fall back to it without the index moving.
            </p>
            <p>
              Premiums use a price and a NAV from the same day. NAVs are AMFI&apos;s official figures;
              prices are exchange closes. A <b>thinly traded</b> ETF&apos;s close can be days old, so its
              premium is less reliable.
            </p>
          </InfoTip>
        </h1>

        {error && <p className="text-[var(--neg)] text-sm">{error}</p>}
        {!data && !error && <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}

        {data && (
          <>
            <p className="text-sm text-[var(--ink2)]">
              {data.etfs.length} ETFs · NAV of {data.nav_asof
                ? new Date(`${data.nav_asof}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })
                : "—"}
              {above > 0 && <> · <span className="text-[var(--warn-ink)] font-semibold">{above} trading 2%+ above NAV</span></>}
            </p>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ETF, index or fund house"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 text-[15px] text-[var(--ink)] placeholder:text-[var(--ink3)] focus:outline-none focus:border-[var(--accent)]" />
            <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] -mx-4 px-4">
              <Segmented label="Type" value={klass} options={CLASSES} onChange={setKlass} />
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--ink3)]">
              Sort
              <Segmented label="Sort" value={sort} options={SORTS} onChange={setSort} />
            </div>

            <ul className="rounded-xl border border-[var(--line)] bg-[var(--card)] divide-y divide-[var(--line)] overflow-hidden">
              {shown.map((e) => (
                <li key={e.s}>
                  <Link href={`/etf?s=${encodeURIComponent(e.s)}`} className="rs-press flex items-center gap-3 px-3 py-2.5 active:bg-[var(--card2)]">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold text-[15px]">{e.s}</span>
                        {e.thin && <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink3)] border border-[var(--line2)] rounded px-1">Thin</span>}
                      </div>
                      <p className="text-xs text-[var(--ink3)] truncate">{e.name}</p>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <p className={`text-[15px] font-semibold ${premClass(e.prem)}`}>{premText(e.prem)}</p>
                      <p className="text-[11px] text-[var(--ink3)]">
                        {sort === "r1y" ? `1Y ${e.r1y_price === null ? "—" : `${e.r1y_price > 0 ? "+" : ""}${e.r1y_price.toFixed(1)}%`}`
                          : sort === "liq" ? `₹${e.turnover_cr.toLocaleString("en-IN")} Cr/day`
                            : e.price === null ? "—" : `₹${e.price.toLocaleString("en-IN")}`}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
              {!shown.length && <li className="px-3 py-6 text-center text-sm text-[var(--ink3)]">No ETF matches</li>}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
