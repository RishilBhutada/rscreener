"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { Segmented } from "@/components/ListUI";
import { premClass, premIsStale, premText, type EtfListItem } from "@/lib/etf";
import { signClass } from "@/lib/commodity";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Data = { generated_at: string; nav_asof: string | null; etfs: EtfListItem[] };

const CLASSES = [
  ["all", "All"], ["equity", "Equity"], ["international", "Global"], ["gold", "Gold"], ["silver", "Silver"], ["debt", "Debt"],
] as const;
type Klass = (typeof CLASSES)[number][0];
/** One sortable grid, 50 rows at a time (owner, 12-Nov-2026: "ETFs C").
 *  It drew all 372 ETFs as cards - 22,684 px on a phone - and showed one of
 *  premium, 1Y or turnover at a time; the grid shows all three side by side
 *  and a heading sorts. */
type Sort = "s" | "prem" | "price" | "r1y" | "liq";
const PAGE = 50;
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

export default function EtfsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [klass, setKlass] = useState<Klass>("all");
  const [sort, setSort] = useState<{ key: Sort; desc: boolean }>({ key: "prem", desc: true });
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  // A new filter, search or sort starts again at the top 50.
  const pickKlass = (k: Klass) => { setKlass(k); setLimit(PAGE); };
  const tap = (k: Sort) => {
    setSort(sort.key !== k ? { key: k, desc: k !== "s" } : { key: k, desc: !sort.desc });
    setLimit(PAGE);
  };

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
    const dir = sort.desc ? -1 : 1;
    if (sort.key === "s") return list.sort((a, b) => dir * a.s.localeCompare(b.s));
    const val = (e: EtfListItem): number | null =>
      sort.key === "prem" ? e.prem : sort.key === "price" ? e.price : sort.key === "r1y" ? e.r1y_price : e.turnover_cr;
    // Missing figures last, either way round; by premium, a premium older
    // than the list's NAV day after every current one - it is not today's gap.
    const tier = (e: EtfListItem) =>
      val(e) === null ? 2 : sort.key === "prem" && premIsStale(e.prem_date, data.nav_asof) ? 1 : 0;
    return list.sort((a, b) => tier(a) - tier(b) || dir * ((val(a) ?? 0) - (val(b) ?? 0)));
  }, [data, klass, sort, q]);

  const above = data ? data.etfs.filter((e) => (e.prem ?? 0) >= 2 && !e.thin && !premIsStale(e.prem_date, data.nav_asof)).length : 0;

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
              premium is less reliable. Its symbol is in grey.
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
            <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search ETF, index or fund house" aria-label="Search ETFs"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 text-[15px] text-[var(--ink)] placeholder:text-[var(--ink3)] focus:outline-none focus:border-[var(--accent)]" />
            <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] -mx-4 px-4">
              <Segmented label="Type" value={klass} options={CLASSES} onChange={pickKlass} />
            </div>

            <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden tabular-nums">
              <div className="grid grid-cols-[minmax(0,1fr)_50px_62px_38px_44px] gap-1 px-3 border-b border-[var(--line)] text-[11px] text-[var(--ink3)]">
                {([["s", "ETF"], ["prem", "Prem"], ["price", "Price ₹"], ["r1y", "1Y"], ["liq", "₹Cr/day"]] as [Sort, string][]).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => tap(k)} aria-pressed={sort.key === k} aria-label={`Sort by ${label}`}
                    className={`min-h-[34px] flex items-center ${k === "s" ? "justify-start" : "justify-end"} ${sort.key === k ? "text-[var(--accent-ink)] font-semibold" : ""}`}>
                    {label}{sort.key === k && <span aria-hidden="true">{sort.desc ? "\u25BE" : "\u25B4"}</span>}
                  </button>
                ))}
              </div>
              <ul className="divide-y divide-[var(--line)]">
                {shown.slice(0, limit).map((e) => {
                  const stale = premIsStale(e.prem_date, data.nav_asof) && !!e.prem_date;
                  return (
                    <li key={e.s}>
                      <Link href={`/etf?s=${encodeURIComponent(e.s)}`} title={e.name}
                        className="rs-press grid grid-cols-[minmax(0,1fr)_50px_62px_38px_44px] gap-1 items-center px-3 py-2 text-[12.5px] active:bg-[var(--card2)]">
                        {/* Thinly traded: the symbol in grey, said out loud for a screen reader. */}
                        <span className={`min-w-0 truncate font-semibold ${e.thin ? "text-[var(--ink3)]" : "text-[var(--ink)]"}`}>
                          {e.s}{e.thin && <span className="sr-only"> (thinly traded)</span>}
                        </span>
                        <span className={`text-right font-semibold ${premClass(e.prem)}`}>
                          {premText(e.prem)}
                          {stale && <span className="block text-[9.5px] font-normal text-[var(--ink3)]">{fmtDay(e.prem_date as string)}</span>}
                        </span>
                        <span className="text-right text-[var(--ink)]">
                          {e.price === null ? "—" : e.price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className={`text-right ${signClass(e.r1y_price)}`}>
                          {e.r1y_price === null ? "—" : `${e.r1y_price > 0 ? "+" : ""}${e.r1y_price.toFixed(0)}%`}
                        </span>
                        <span className="text-right text-[var(--ink2)]">{e.turnover_cr.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</span>
                      </Link>
                    </li>
                  );
                })}
                {!shown.length && <li className="px-3 py-6 text-center text-sm text-[var(--ink3)]">No ETF matches</li>}
              </ul>
            </div>
            {shown.length > limit && (
              <button type="button" onClick={() => setLimit(limit + PAGE)}
                className="rs-press w-full min-h-[44px] rounded-xl border border-[var(--line)] text-[14px] font-semibold text-[var(--ink2)]">
                Show {Math.min(PAGE, shown.length - limit)} more · {shown.length - limit} left
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
