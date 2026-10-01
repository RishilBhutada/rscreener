"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { CommodityListItem } from "@/lib/commodity";
import type { IndexListItem } from "@/lib/indices";

/** The home page's market snapshot: the main indices, MCX's most traded
 *  contracts and NCDEX's, as tiles - the level and the day's move, each a tap
 *  from its own page. Two small files; nothing shows until they arrive. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const KEY = "rs_home_markets";
const TABS = [["indices", "Indices"], ["mcx", "MCX"], ["ncdex", "NCDEX"]] as const;
type Tab = (typeof TABS)[number][0];
const MAIN_INDICES = ["Nifty 50", "SENSEX", "Nifty Bank", "Nifty Next 50", "Nifty Midcap 150", "India VIX"];

type Tile = { href: string; name: string; value: string; chg: number | null; sub?: string };

const fmt = (v: number, rupee: boolean) =>
  `${rupee ? "₹" : ""}${v.toLocaleString("en-IN", { maximumFractionDigits: v >= 1000 ? 0 : 2 })}`;

export default function Markets() {
  const [idx, setIdx] = useState<IndexListItem[]>([]);
  const [com, setCom] = useState<CommodityListItem[]>([]);
  const [tab, setTabState] = useState<Tab>("indices");

  useEffect(() => {
    fetch(`${BASE}/indices.json`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.items) setIdx(d.items); }).catch(() => {});
    fetch(`${BASE}/commodities.json`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.items) setCom(d.items); }).catch(() => {});
    try {
      const t = localStorage.getItem(KEY) as Tab | null;
      if (t && TABS.some(([k]) => k === t)) setTabState(t);
    } catch { /* private mode */ }
  }, []);

  const setTab = (t: Tab) => {
    setTabState(t);
    try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
  };

  const tiles: Tile[] = useMemo(() => {
    if (tab === "indices") {
      const by = new Map(idx.map((x) => [x.name, x]));
      return MAIN_INDICES.map((n) => by.get(n)).filter((x): x is IndexListItem => !!x).map((x) => ({
        href: `/indices/view?s=${encodeURIComponent(x.s)}`, name: x.name === "SENSEX" ? "Sensex" : x.name,
        value: x.close.toLocaleString("en-IN", { maximumFractionDigits: 2 }), chg: x.chg_pct,
      }));
    }
    const ex = tab === "mcx" ? "MCX" : "NCDEX";
    return com.filter((x) => (x.exchange ?? "MCX") === ex && x.s === x.family)
      .sort((a, b) => b.oi - a.oi).slice(0, 6).map((x) => ({
        href: `/commodity?s=${encodeURIComponent(x.s)}`, name: x.name, value: fmt(x.close, true), chg: x.chg,
        // A contract's first day has no change yet; its gap to the mandi does.
        sub: x.chg === null && x.spot_prem != null ? `${x.spot_prem > 0 ? "+" : ""}${x.spot_prem.toFixed(1)}% vs spot` : undefined,
      }));
  }, [tab, idx, com]);

  if (!idx.length && !com.length) return null;
  return (
    <section className="mt-7">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs uppercase tracking-wide text-[var(--ink3)]">Markets</h2>
        <Link href={tab === "indices" ? "/indices" : "/commodities"} className="text-xs font-semibold text-[var(--accent-ink)]">See all</Link>
      </div>
      <div role="tablist" aria-label="Markets" className="flex gap-1 mb-2">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-[32px] px-3 rounded-full text-[13px] border ${tab === k
              ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)] font-semibold"
              : "text-[var(--ink2)] border-[var(--line)]"}`}>
            {label}
          </button>
        ))}
      </div>
      {tiles.length === 0 ? (
        <p className="text-[13px] text-[var(--ink3)] py-4">No prices yet</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {tiles.map((t) => (
            <Link key={t.href} href={t.href}
              className="rs-press rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2.5 active:bg-[var(--card2)]">
              <p className="text-[12px] text-[var(--ink2)] truncate">{t.name}</p>
              <p className="text-[15px] font-semibold tabular-nums text-[var(--ink)]">{t.value}</p>
              <p className={`text-[12px] tabular-nums ${t.chg === null ? "text-[var(--ink3)]" : t.chg >= 0 ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>
                {t.chg === null ? t.sub ?? "—" : `${t.chg > 0 ? "+" : ""}${t.chg.toFixed(2)}%`}
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
