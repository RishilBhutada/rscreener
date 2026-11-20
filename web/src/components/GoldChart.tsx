"use client";

/** Gold's price with the events that moved it marked on the line (owner,
 *  20-Nov-2026: "improve the gold section about the details chart" - picked a
 *  gold chart with the events on it).
 *
 *  COMEX since 2000 or MCX, each starred event of the chosen level as a
 *  marker on the day it happened: green if gold rose the session after, red
 *  if it fell. A tap on a marker names the event and the move; anywhere else
 *  reads the price. The file is pipeline/export_gold_json.py's
 *  gold_prices.json, fetched when the card comes near the screen. Drawn as
 *  SVG at the box's real width, like the US economy charts beside it. */

import { useEffect, useMemo, useRef, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { type GoldFamily, istDay } from "@/lib/gold";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DAY = 86400000;
const toT = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);

/** [day, title, family, stars, [COMEX session, % move] | null, [MCX session, % move] | null] */
type HistEvent = [string, string, string, number, [string, number] | null, [string, number] | null];
type Prices = { comex: [string, number][]; mcx: [string, number][]; events: HistEvent[] };
type Market = "comex" | "mcx";
const RANGES: [string, number][] = [["1Y", 1], ["3Y", 3], ["5Y", 5], ["10Y", 10], ["Max", 0]];

function niceTicks(lo: number, hi: number, count = 4): number[] {
  const span = hi - lo || 1;
  const raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

const chip = (on: boolean) =>
  `min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold ${on ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`;

export default function GoldChart({ families }: { families: Record<string, GoldFamily> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Prices | null>(null);
  const [failed, setFailed] = useState(false);
  const [market, setMarket] = useState<Market>("comex");
  const [range, setRange] = useState("5Y");
  const [minStars, setMinStars] = useState(4);
  const [W, setW] = useState(0);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [picked, setPicked] = useState<HistEvent | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let live = true;
    const load = () => fetch(`${BASE}/gold_prices.json`).then((r) => (r.ok ? r.json() : null))
      .then((d: Prices | null) => { if (!live) return; if (d?.comex?.length) setData(d); else setFailed(true); })
      .catch(() => { if (live) setFailed(true); });
    if (typeof IntersectionObserver === "undefined") { load(); return () => { live = false; }; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); load(); } },
      { rootMargin: "300px 0px" });
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setW(Math.floor(el.clientWidth));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const hasMcx = (data?.mcx.length ?? 0) >= 20;
  const mkt: Market = market === "mcx" && hasMcx ? "mcx" : "comex";
  const pts = useMemo(() => (data ? data[mkt] : []), [data, mkt]);
  const times = useMemo(() => pts.map((p) => toT(p[0])), [pts]);
  const avail = RANGES.filter(([, y]) => !y || (times.length > 1 && times[times.length - 1] - y * 365.25 * DAY > times[0]));
  const eff = avail.some(([r]) => r === range) ? range : "Max";
  const H = W > 0 && W < 520 ? 230 : 270;

  const g = useMemo(() => {
    if (pts.length < 2 || W < 120) return null;
    const years = RANGES.find(([r]) => r === eff)?.[1] ?? 0;
    const t1 = times[times.length - 1];
    const from = years ? t1 - years * 365.25 * DAY : times[0];
    let i0 = times.findIndex((t) => t >= from);
    if (i0 < 0 || i0 > times.length - 2) i0 = 0;
    const d0 = times[i0], d1 = t1;
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i < pts.length; i++) { lo = Math.min(lo, pts[i][1]); hi = Math.max(hi, pts[i][1]); }
    const room = (hi - lo) * 0.08 || 1;
    // A price never goes below zero, so neither does the axis.
    const lo2 = Math.max(0, lo - room);
    const ticks = niceTicks(lo2, hi + room).filter((v) => v >= 0);
    const yLo = Math.max(0, Math.min(lo2, ticks[0] ?? lo2)), yHi = Math.max(hi + room, ticks[ticks.length - 1] ?? hi);
    const fmt = (v: number) => (mkt === "mcx" ? `₹${Math.round(v / 1000)}k` : `$${Math.round(v).toLocaleString("en-US")}`);
    const labels = ticks.map(fmt);
    const ML = 6, MT = 14, MB = 20;
    const MR = Math.ceil(Math.max(...labels.map((l) => l.length)) * 6.6) + 12;
    const plotW = W - ML - MR, plotH = H - MT - MB;
    const x = (t: number) => ML + ((t - d0) / Math.max(1, d1 - d0)) * plotW;
    const y = (v: number) => MT + (1 - (v - yLo) / Math.max(1e-9, yHi - yLo)) * plotH;
    let line = "";
    for (let i = i0; i < pts.length; i++) line += `${i === i0 ? "M" : "L"}${x(times[i]).toFixed(1)},${y(pts[i][1]).toFixed(1)}`;
    // the price on or before a day, for placing a marker on the line
    const priceAt = (t: number) => {
      let a = i0, b = pts.length - 1;
      if (t < times[a]) return null;
      while (a < b) { const m = (a + b + 1) >> 1; if (times[m] <= t) a = m; else b = m - 1; }
      return pts[a][1];
    };
    const marks = (data?.events ?? []).filter((e) => e[3] >= minStars).flatMap((e) => {
      const mv = mkt === "mcx" ? e[5] : e[4];
      const t = toT(e[0]);
      const p = priceAt(t);
      if (!mv || p === null || t < d0 || t > d1) return [];
      return [{ e, mx: x(t), my: y(p), up: mv[1] >= 0, move: mv[1] }];
    });
    const ya = new Date(d0).getUTCFullYear(), yb = new Date(d1).getUTCFullYear();
    const fit = Math.max(2, Math.floor(plotW / 48));
    const ystep = [1, 2, 5, 10].find((s) => (yb - ya) / s <= fit) ?? 20;
    const yearTicks: number[] = [];
    for (let yr = Math.ceil(ya / ystep) * ystep; yr <= yb; yr += ystep) {
      const t = Date.UTC(yr, 0, 1);
      if (t >= d0 && t <= d1 && x(t) >= ML + 14) yearTicks.push(t);
    }
    return { i0, d0, d1, x, y, ML, MR, MT, plotW, plotH, ticks, labels, line, marks, yearTicks, fmt };
  }, [pts, times, eff, W, H, mkt, data, minStars]);

  const onPoint = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!g) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / Math.max(1, r.width)), py = (e.clientY - r.top) * (H / Math.max(1, r.height));
    // a marker within a fingertip wins over the price reading
    let best: (typeof g.marks)[number] | null = null, bd = 14 * 14;
    for (const m of g.marks) {
      const d = (m.mx - px) ** 2 + (m.my - py) ** 2;
      if (d < bd) { bd = d; best = m; }
    }
    if (best && e.type === "pointerdown") { setPicked(best.e); setHoverT(null); return; }
    setHoverT(g.d0 + ((px - g.ML) / Math.max(1, g.plotW)) * (g.d1 - g.d0));
  };

  let reading: { d: string; v: number } | null = null;
  if (g && pts.length) {
    if (hoverT === null) reading = { d: pts[pts.length - 1][0], v: pts[pts.length - 1][1] };
    else {
      let k = g.i0;
      while (k < pts.length - 1 && times[k + 1] <= hoverT) k++;
      reading = { d: pts[k][0], v: pts[k][1] };
    }
  }
  const nMarks = g?.marks.length ?? 0;

  return (
    <div ref={rootRef}>
      {!data && !failed && <div className="mx-3 mb-3 h-[300px] rs-skel" aria-busy="true" aria-label="Loading" />}
      {failed && <p className="px-3 pb-3 text-[13px] text-[var(--ink3)]">The gold chart arrives with the next data run</p>}
      {data && (
        <>
          <div className="flex items-center gap-1 px-2">
            <button type="button" className={chip(mkt === "comex")} aria-pressed={mkt === "comex"} onClick={() => { setMarket("comex"); setHoverT(null); }}>COMEX $/oz</button>
            {hasMcx && <button type="button" className={chip(mkt === "mcx")} aria-pressed={mkt === "mcx"} onClick={() => { setMarket("mcx"); setHoverT(null); }}>MCX ₹/10 g</button>}
            <span className="ml-auto inline-flex items-center gap-1">
              <button type="button" className={chip(minStars === 4)} aria-pressed={minStars === 4} onClick={() => setMinStars(4)}>4★+</button>
              <button type="button" className={chip(minStars === 3)} aria-pressed={minStars === 3} onClick={() => setMinStars(3)}>3★+</button>
            </span>
          </div>
          {reading && (
            <p className="px-3 pt-2 flex items-baseline gap-2 tabular-nums">
              <span className="text-xl font-bold">{mkt === "mcx" ? `₹${Math.round(reading.v).toLocaleString("en-IN")}` : `$${reading.v.toLocaleString("en-US")}`}</span>
              <span className="text-[12px] text-[var(--ink3)]">{istDay(`${reading.d}T12:00:00Z`)} {reading.d.slice(0, 4)}</span>
            </p>
          )}
          <div ref={boxRef} className="mt-1" style={{ height: H }}>
            {g && (
              <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" className="block select-none touch-pan-y cursor-crosshair"
                aria-label={`${mkt === "mcx" ? "MCX" : "COMEX"} gold with ${nMarks} events marked`}
                onPointerDown={onPoint} onPointerMove={(e) => { if (e.pointerType === "mouse" || e.buttons) onPoint(e); }}
                onPointerLeave={(e) => { if (e.pointerType === "mouse") setHoverT(null); }} onPointerCancel={() => setHoverT(null)}>
                {g.ticks.map((v, i) => (
                  <g key={v}>
                    <line x1={g.ML} x2={W - g.MR} y1={g.y(v)} y2={g.y(v)} stroke="var(--chart-grid)" strokeWidth="1" />
                    <text x={W - g.MR + 6} y={g.y(v) + 4} fontSize="11" fill="var(--chart-axis)" className="tabular-nums">{g.labels[i]}</text>
                  </g>
                ))}
                <line x1={g.ML} x2={W - g.MR} y1={g.MT + g.plotH} y2={g.MT + g.plotH} stroke="var(--line)" strokeWidth="1" />
                {g.yearTicks.map((t) => (
                  <text key={t} x={g.x(t)} y={H - 5} fontSize="11" fill="var(--chart-axis)" textAnchor="middle" className="tabular-nums">{new Date(t).getUTCFullYear()}</text>
                ))}
                <path d={g.line} fill="none" stroke="#d4a017" strokeWidth="1.6" strokeLinejoin="round" />
                {g.marks.map((m, i) => (
                  <path key={i} d={m.up ? `M${m.mx},${m.my - 9}l-4,6h8z` : `M${m.mx},${m.my + 9}l-4,-6h8z`}
                    fill={m.up ? "var(--pos)" : "var(--neg)"} stroke={picked === m.e ? "var(--ink)" : "none"} strokeWidth="1.2" opacity="0.9" />
                ))}
                {hoverT !== null && hoverT >= g.d0 && hoverT <= g.d1 && (
                  <line x1={g.x(hoverT)} x2={g.x(hoverT)} y1={g.MT} y2={g.MT + g.plotH} stroke="var(--chart-axis)" strokeWidth="1" strokeDasharray="2 3" pointerEvents="none" />
                )}
              </svg>
            )}
          </div>
          <div className="flex items-center gap-1 px-2 pt-1">
            {avail.map(([r]) => (
              <button key={r} type="button" className={chip(eff === r)} aria-pressed={eff === r} onClick={() => { setRange(r); setHoverT(null); }}>{r}</button>
            ))}
            <span className="ml-auto pr-1 inline-flex items-center gap-1 text-[11px] text-[var(--ink3)]">
              <span className="text-[var(--pos)]">▲</span><span className="text-[var(--neg)]">▼</span> next session
              <InfoTip title="Events on the chart">
                <p>Each marker is an event rated {minStars} stars or more - a Fed decision, a US election, a jobs report and the rest - on the day it happened. Green: gold rose the session after; red: it fell. Tap one to see what it was and how far gold moved.</p>
                <p>COMEX from 2000; MCX for as long as its contracts are on record. Events are on the record from 2000 for elections, 2021 for most US data and the Fed. A record of what happened, not a forecast.</p>
              </InfoTip>
            </span>
          </div>
          {picked && (() => {
            const mv = mkt === "mcx" ? picked[5] : picked[4];
            const fam = families[picked[2]];
            return (
              <div className="mx-3 mt-2 rounded-lg border border-[var(--line)] bg-[var(--card2)] px-3 py-2 text-[13px]">
                <div className="flex items-start gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{picked[1]}</p>
                    <p className="text-[12px] text-[var(--ink3)]">{istDay(`${picked[0]}T12:00:00Z`)} {picked[0].slice(0, 4)} · {fam?.label ?? picked[2]} · {"★".repeat(picked[3])}</p>
                  </div>
                  <button type="button" onClick={() => setPicked(null)} aria-label="Close" className="ml-auto text-[var(--ink3)] px-1">✕</button>
                </div>
                {mv && <p className={`mt-1 tabular-nums font-semibold ${mv[1] >= 0 ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>
                  {mkt === "mcx" ? "MCX" : "COMEX"} {mv[1] >= 0 ? "+" : ""}{mv[1].toFixed(2)}% <span className="font-normal text-[var(--ink3)]">the session after ({istDay(`${mv[0]}T12:00:00Z`)})</span>
                </p>}
              </div>
            );
          })()}
          <p className="px-3 pt-2 pb-3 text-[11px] text-[var(--ink3)]">{nMarks} event{nMarks === 1 ? "" : "s"} marked in this range.</p>
        </>
      )}
    </div>
  );
}
