"use client";

/** The volume split: shares DELIVERED (taken into demat) against shares
 *  bought and sold the same day, as stacked bars - daily for a year, weekly
 *  for three, monthly for ten. vol/<SYMBOL>.json (pipeline/export_vol_json.py),
 *  from NSE's and BSE's delivery files. Owner, 14-Nov-2026. */

import { useEffect, useMemo, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { Segmented } from "@/components/ListUI";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
type Bar = [string, number, number];   // period, traded, delivered
type Vol = { d: Bar[]; w: Bar[]; m: Bar[] };
type Range = "d" | "w" | "m";
const RANGES: readonly (readonly [Range, string])[] = [["d", "1Y daily"], ["w", "3Y weekly"], ["m", "10Y monthly"]];

/** 1,23,45,678 shares, short: 1.2 Cr / 45.3 L / 12.4 K. */
function qty(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)} Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(v >= 1e6 ? 0 : 1)} L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
  return String(Math.round(v));
}

function label(p: string, r: Range): string {
  const d = new Date(`${p.length === 7 ? `${p}-01` : p}T00:00:00`);
  return d.toLocaleDateString("en-IN", r === "m" ? { month: "short", year: "numeric" } : { day: "numeric", month: "short", year: "2-digit" });
}

export default function VolumeSplit({ symbol }: { symbol: string }) {
  const [v, setV] = useState<{ sym: string; data: Vol } | null>(null);
  const [range, setRange] = useState<Range>("d");
  const [pick, setPick] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${BASE}/vol/${symbol}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Vol | null) => { if (live && data) setV({ sym: symbol, data }); })
      .catch(() => {});
    return () => { live = false; };
  }, [symbol]);

  // The daily file holds ~400 sessions; the 1-year view shows the last 250.
  const bars = useMemo(() => (v && v.sym === symbol ? (range === "d" ? v.data.d.slice(-250) : v.data[range]) : []), [v, symbol, range]);
  if (!v || v.sym !== symbol || !(v.data.d.length || v.data.w.length)) return null;

  const max = Math.max(1, ...bars.map((b) => b[1]));
  const W = 600, H = 150, gap = bars.length > 150 ? 0.5 : 1.5, bw = W / Math.max(bars.length, 1);
  const tot = bars.reduce((a, b) => [a[0] + b[1], a[1] + b[2]], [0, 0]);
  const avgPct = tot[0] ? (tot[1] / tot[0]) * 100 : null;
  const sel = pick !== null && bars[pick] ? bars[pick] : bars[bars.length - 1];

  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3 sm:p-4 mt-4">
      <h2 className="text-base font-semibold text-[var(--ink)] flex items-center gap-1.5">
        Volume split
        <InfoTip title="Volume split">
          <p><b>Delivered</b>: shares that went into a buyer&apos;s demat account. <b>Same day</b>: shares bought and sold again before the close (traded minus delivered).</p>
          <p>Delivered is <b>not</b> the same as long-term: a share bought today and sold tomorrow counts as delivered, and every delivered share also had a seller.</p>
          <p>From NSE&apos;s daily delivery file (BSE&apos;s for BSE-only companies), back to about 2016. Not checked further.</p>
        </InfoTip>
      </h2>
      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
        <Segmented label="Range" value={range} options={RANGES} onChange={(r) => { setRange(r); setPick(null); }} />
        {avgPct !== null && <span className="text-[12px] text-[var(--ink3)]">Delivered over the range: <b className="text-[var(--ink)]">{avgPct.toFixed(0)}%</b></span>}
      </div>
      {sel && (
        <p className="mt-2 text-[12.5px] text-[var(--ink2)] tabular-nums">
          {label(sel[0], range)}: {qty(sel[1])} traded · <span className="text-[var(--accent-ink)] font-semibold">{qty(sel[2])} delivered ({sel[1] ? ((sel[2] / sel[1]) * 100).toFixed(0) : 0}%)</span> · {qty(sel[1] - sel[2])} same day
        </p>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-1 w-full h-36 touch-none" role="img"
        aria-label={`Shares traded per ${range === "d" ? "day" : range === "w" ? "week" : "month"}, delivered and same-day`}
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPick(Math.min(bars.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * bars.length)))); }}
        onPointerDown={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPick(Math.min(bars.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * bars.length)))); }}>
        {bars.map((b, i) => {
          const ht = (b[1] / max) * H, hd = (b[2] / max) * H, x = i * bw;
          const on = pick === i;
          return (
            <g key={b[0]} opacity={pick === null || on ? 1 : 0.55}>
              <rect x={x} y={H - ht} width={Math.max(bw - gap, 0.6)} height={Math.max(ht - hd, 0)} fill="var(--line2)" />
              <rect x={x} y={H - hd} width={Math.max(bw - gap, 0.6)} height={hd} fill="var(--accent)" />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10.5px] text-[var(--ink3)] tabular-nums">
        <span>{bars[0] ? label(bars[0][0], range) : ""}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--accent)]" />Delivered</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--line2)]" />Same day</span>
        </span>
        <span>{bars.length ? label(bars[bars.length - 1][0], range) : ""}</span>
      </div>
    </section>
  );
}
