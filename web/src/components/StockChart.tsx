"use client";

import { useMemo, useRef, useState } from "react";

type Pt = [string, number] | [string, number, number | null];
export type ChartPrices = { monthly?: Pt[]; weekly?: Pt[]; daily?: Pt[] };
export type ChartPeBand = { series: [string, number][]; median_5y: number } | null;
export type ChartTrendQ = {
  periods: string[];
  revenue: (number | null)[];
  pat: (number | null)[];
  eps: (number | null)[];
  expenses?: (number | null)[];
} | null;

type View = "price" | "pe" | "sales" | "eps";
type XY = { t: number; v: number };

const RANGES: [string, number][] = [
  ["1M", 1 / 12], ["6M", 0.5], ["1Yr", 1], ["3Yr", 3], ["5Yr", 5], ["10Yr", 10], ["Max", 999],
];

const W = 920, H = 470, ML = 62, MR = 62, MT = 12, MB = 30;
const plotW = W - ML - MR, plotH = H - MT - MB;

const toT = (iso: string) => new Date(iso).getTime();

function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = mag * (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10);
  const start = Math.ceil(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.01; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function timeTicks(t0: number, t1: number): { t: number; label: string }[] {
  const spanDays = (t1 - t0) / 86400000;
  const out: { t: number; label: string }[] = [];
  const d0 = new Date(t0), d1 = new Date(t1);
  if (spanDays > 1100) {
    const yStep = Math.max(1, Math.ceil((d1.getFullYear() - d0.getFullYear()) / 6));
    for (let y = d0.getFullYear() + 1; y <= d1.getFullYear(); y += yStep) {
      out.push({ t: new Date(y, 0, 1).getTime(), label: `Jan ${y}` });
    }
  } else {
    const months = Math.max(1, Math.round(spanDays / 30));
    const mStep = Math.max(1, Math.ceil(months / 6));
    const cur = new Date(d0.getFullYear(), d0.getMonth() + 1, 1);
    while (cur.getTime() < t1) {
      out.push({
        t: cur.getTime(),
        label: cur.toLocaleDateString("en-IN", { month: "short", year: spanDays > 200 ? "2-digit" : undefined }),
      });
      cur.setMonth(cur.getMonth() + mStep);
    }
  }
  return out;
}

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function fmtVal(v: number, kind: "rupee" | "plain" | "pct" | "vol" | "cr"): string {
  if (kind === "vol") {
    if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
    if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
    if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    return String(Math.round(v));
  }
  if (kind === "pct") return `${Math.round(v)}%`;
  if (kind === "cr") return v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v));
  const s = v >= 100 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(v >= 10 ? 1 : 2);
  return kind === "rupee" ? `${s}` : s;
}

function sma(vals: number[], win: number): (number | null)[] {
  let sum = 0;
  return vals.map((v, i) => {
    sum += v;
    if (i >= win) sum -= vals[i - win];
    return i >= win - 1 ? sum / win : null;
  });
}

const nearest = (arr: XY[], t: number): XY | null => {
  if (!arr.length) return null;
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t <= t) lo = mid; else hi = mid;
  }
  return Math.abs(arr[lo].t - t) <= Math.abs(arr[hi].t - t) ? arr[lo] : arr[hi];
};

type SeriesDef = {
  key: string;
  label: string;
  color: string;
  kind: "line" | "smooth" | "bars" | "dashed";
  axis: "L" | "R";
  data: XY[];
  fmt: "rupee" | "plain" | "pct" | "vol" | "cr";
};

export default function StockChart({ prices, peBand, trendQ, livePrice }: {
  prices: ChartPrices; peBand?: ChartPeBand; trendQ?: ChartTrendQ; livePrice: number | null;
}) {
  const [view, setView] = useState<View>("price");
  const [range, setRange] = useState("1Yr");
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<{ t: number; px: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const isOn = (k: string, dflt = true) => on[k] ?? dflt;
  const toggle = (k: string, dflt = true) => setOn({ ...on, [k]: !isOn(k, dflt) });

  const years = RANGES.find(([r]) => r === range)?.[1] ?? 1;
  const now = Date.now();
  const cutoff = years >= 999 ? 0 : now - years * 365.25 * 86400000;

  const model = useMemo(() => {
    const daily: Pt[] = prices.daily ?? [];
    const monthly: Pt[] = prices.monthly ?? [];
    const weekly: Pt[] = prices.weekly ?? [];
    const defs: SeriesDef[] = [];

    const filt = (src: Pt[]): Pt[] => src.filter((p) => toT(p[0]) >= cutoff);
    const xy = (src: Pt[]): XY[] => src.map((p) => ({ t: toT(p[0]), v: p[1] }));

    if (view === "price") {
      const dailyStart = daily.length ? toT(daily[0][0]) : Infinity;
      const useDaily = daily.length > 30 && dailyStart <= cutoff + 40 * 86400000 && years <= 3;
      let base = useDaily ? filt(daily) : years <= 1 && weekly.length ? filt(weekly) : filt(monthly);
      if (!base.length) base = filt(monthly);
      const pricePts = xy(base);
      if (livePrice !== null && pricePts.length) pricePts.push({ t: now, v: livePrice });
      defs.push({ key: "price", label: "Price on NSE", color: "var(--accent)", kind: "line", axis: "R", data: pricePts, fmt: "rupee" });

      if (useDaily && daily.length >= 210) {
        const closes = daily.map((p) => p[1]);
        const times = daily.map((p) => toT(p[0]));
        const mk = (win: number): XY[] =>
          sma(closes, win)
            .map((v, i) => (v === null ? null : { t: times[i], v }))
            .filter((p): p is XY => !!p && p.t >= cutoff);
        defs.push({ key: "dma50", label: "50 DMA", color: "var(--chart-dma50)", kind: "line", axis: "R", data: mk(50), fmt: "rupee" });
        defs.push({ key: "dma200", label: "200 DMA", color: "var(--chart-dma200)", kind: "line", axis: "R", data: mk(200), fmt: "rupee" });
      }
      const volPts: XY[] = base
        .filter((p) => p.length > 2 && p[2] !== null && (p[2] as number) > 0)
        .map((p) => ({ t: toT(p[0]), v: p[2] as number }));
      if (volPts.length) defs.push({ key: "volume", label: "Volume", color: "var(--chart-vol)", kind: "bars", axis: "L", data: volPts, fmt: "vol" });
    }

    if (view === "pe" && peBand) {
      const pePts = xy(filt(peBand.series as Pt[]));
      defs.push({ key: "pe", label: "PE", color: "var(--accent)", kind: "line", axis: "R", data: pePts, fmt: "plain" });
      if (pePts.length) {
        defs.push({
          key: "median", label: `Median PE = ${peBand.median_5y}`, color: "var(--chart-axis)", kind: "dashed", axis: "R",
          data: [{ t: pePts[0].t, v: peBand.median_5y }, { t: pePts[pePts.length - 1].t, v: peBand.median_5y }], fmt: "plain",
        });
      }
      if (trendQ) {
        const ttm: XY[] = [];
        for (let i = 3; i < trendQ.periods.length; i++) {
          const w = [trendQ.eps[i - 3], trendQ.eps[i - 2], trendQ.eps[i - 1], trendQ.eps[i]];
          if (w.every((v) => v !== null && v !== undefined)) {
            const t = toT(trendQ.periods[i]);
            if (t >= cutoff) ttm.push({ t, v: (w as number[]).reduce((a, b) => a + b, 0) });
          }
        }
        if (ttm.length) defs.push({ key: "ttmeps", label: "TTM EPS", color: "var(--chart-vol)", kind: "bars", axis: "L", data: ttm, fmt: "plain" });
      }
    }

    if (view === "sales" && trendQ) {
      const rows = trendQ.periods.map((p, i) => ({
        t: toT(p), rev: trendQ.revenue[i], pat: trendQ.pat[i], exp: trendQ.expenses?.[i] ?? null,
      })).filter((r) => r.t >= cutoff);
      const sales = rows.filter((r) => r.rev !== null).map((r) => ({ t: r.t, v: r.rev as number }));
      if (sales.length) defs.push({ key: "sales", label: "Quarter Sales", color: "var(--chart-bar)", kind: "bars", axis: "L", data: sales, fmt: "cr" });
      const opm = rows.filter((r) => r.rev && r.exp !== null).map((r) => ({ t: r.t, v: ((r.rev! - r.exp!) / r.rev!) * 100 }));
      if (opm.length > 1) defs.push({ key: "opm", label: "OPM %", color: "var(--chart-dma50)", kind: "smooth", axis: "R", data: opm, fmt: "pct" });
      const npm = rows.filter((r) => r.rev && r.pat !== null).map((r) => ({ t: r.t, v: (r.pat! / r.rev!) * 100 }));
      if (npm.length > 1) defs.push({ key: "npm", label: "NPM %", color: "var(--chart-pos)", kind: "smooth", axis: "R", data: npm, fmt: "pct" });
    }

    if (view === "eps" && trendQ) {
      const eps = trendQ.periods.map((p, i) => ({ t: toT(p), v: trendQ.eps[i] }))
        .filter((r): r is { t: number; v: number } => r.v !== null && r.v !== undefined && r.t >= cutoff);
      if (eps.length) defs.push({ key: "epsq", label: "EPS", color: "var(--chart-vol)", kind: "bars", axis: "L", data: eps, fmt: "plain" });
    }

    return defs;
  }, [prices, peBand, trendQ, view, cutoff, livePrice, now]);

  const visible = model.filter((s) => isOn(s.key));
  const allPts = visible.flatMap((s) => s.data);
  if (!model.length || !model.some((s) => s.data.length > 1)) {
    return <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 text-sm text-[var(--ink3)]">No chart data yet for this view.</section>;
  }

  const t0 = Math.min(...model.filter((s) => isOn(s.key)).flatMap((s) => s.data.length ? [s.data[0].t] : []));
  const t1 = Math.max(...model.filter((s) => isOn(s.key)).flatMap((s) => s.data.length ? [s.data[s.data.length - 1].t] : []));
  const x = (t: number) => ML + ((t - t0) / Math.max(1, t1 - t0)) * plotW;

  const axisVals = (axis: "L" | "R") => visible.filter((s) => s.axis === axis).flatMap((s) => s.data.map((d) => d.v));
  const mkAxis = (axis: "L" | "R") => {
    const vals = axisVals(axis);
    if (!vals.length) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (axis === "L") lo = Math.min(0, lo);
    const pad = (hi - lo) * 0.06 || hi * 0.06 || 1;
    const ticks = niceTicks(lo, hi + pad, 5);
    const dLo = Math.min(lo, ticks[0] ?? lo), dHi = Math.max(hi + pad, ticks[ticks.length - 1] ?? hi);
    const scale = (v: number) => MT + (1 - (v - dLo) / Math.max(1e-9, dHi - dLo)) * plotH;
    return { ticks, scale };
  };
  const axL = mkAxis("L"), axR = mkAxis("R");
  const xt = timeTicks(t0, t1);

  const fmtKindOf = (axis: "L" | "R") => visible.find((s) => s.axis === axis)?.fmt ?? "plain";

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const fx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const svgX = fx * W;
    const t = t0 + ((svgX - ML) / plotW) * (t1 - t0);
    setHover({ t: Math.min(t1, Math.max(t0, t)), px: e.clientX - rect.left });
  };

  const primary = visible.find((s) => s.kind !== "bars" && s.kind !== "dashed") ?? visible[0];
  const hoverPt = hover && primary ? nearest(primary.data, hover.t) : null;

  const views: [View, string, boolean][] = [
    ["price", "Price", true],
    ["pe", "PE Ratio", !!peBand],
    ["sales", "Sales & Margin", !!trendQ],
    ["eps", "EPS", !!trendQ],
  ];

  const barW = (s: SeriesDef) => Math.max(1.5, Math.min(26, (plotW / Math.max(1, s.data.length)) * 0.62));
  const boxW = svgRef.current?.getBoundingClientRect().width ?? 600;

  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex gap-1 text-xs flex-wrap">
          {RANGES.map(([r]) => (
            <button key={r} onClick={() => setRange(r)}
              className={`rounded-lg px-2.5 py-1.5 font-medium ${range === r ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] hover:bg-[var(--card2)]"}`}>
              {r}
            </button>
          ))}
        </div>
        <div className="flex gap-1 text-xs flex-wrap">
          {views.filter(([, , ok]) => ok).map(([v, label]) => (
            <button key={v} onClick={() => { setView(v); setHover(null); }}
              className={`rounded-lg px-3 py-1.5 font-medium ${view === v ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] hover:bg-[var(--card2)]"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none"
          onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>

          {axR && axR.ticks.map((v) => (
            <g key={`r${v}`}>
              <line x1={ML} x2={W - MR} y1={axR.scale(v)} y2={axR.scale(v)} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={W - MR + 8} y={axR.scale(v) + 4} fontSize="12" fill="var(--chart-axis)">{fmtVal(v, fmtKindOf("R"))}</text>
            </g>
          ))}
          {axL && axL.ticks.map((v) => (
            <text key={`l${v}`} x={ML - 8} y={axL.scale(v) + 4} fontSize="12" fill="var(--chart-axis)" textAnchor="end">{fmtVal(v, fmtKindOf("L"))}</text>
          ))}
          {xt.map((tk) => (
            <text key={tk.t} x={x(tk.t)} y={H - 8} fontSize="12" fill="var(--chart-axis)" textAnchor="middle">{tk.label}</text>
          ))}

          {visible.filter((s) => s.kind === "bars").map((s) => {
            const ax = s.axis === "L" ? axL : axR;
            if (!ax) return null;
            const bw = barW(s);
            const y0 = ax.scale(Math.max(0, ax.ticks[0] ?? 0));
            return (
              <g key={s.key}>
                {s.data.map((d, i) => {
                  const yv = ax.scale(d.v);
                  return <rect key={i} x={x(d.t) - bw / 2} y={Math.min(yv, y0)} width={bw} height={Math.max(1, Math.abs(y0 - yv))} rx={bw > 6 ? 2 : 0} fill={s.color} opacity="0.75" />;
                })}
              </g>
            );
          })}

          {visible.filter((s) => s.kind !== "bars").map((s) => {
            const ax = s.axis === "L" ? axL : axR;
            if (!ax || s.data.length < 2) return null;
            const pts = s.data.map((d) => ({ x: x(d.t), y: ax.scale(d.v) }));
            if (s.kind === "smooth") {
              return <path key={s.key} d={smoothPath(pts)} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" />;
            }
            return (
              <polyline key={s.key}
                points={pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}
                fill="none" stroke={s.color} strokeWidth={s.key === "price" || s.key === "pe" ? 1.9 : 1.4}
                strokeDasharray={s.kind === "dashed" ? "6 5" : undefined}
                strokeLinejoin="round" strokeLinecap="round" />
            );
          })}

          {hover && hoverPt && primary && (
            <g>
              <line x1={x(hoverPt.t)} x2={x(hoverPt.t)} y1={MT} y2={MT + plotH} stroke="var(--chart-axis)" strokeWidth="1" strokeDasharray="2 3" />
              {(() => {
                const ax = primary.axis === "L" ? axL : axR;
                return ax ? <circle cx={x(hoverPt.t)} cy={ax.scale(hoverPt.v)} r="3.5" fill={primary.color} stroke="var(--card)" strokeWidth="1.5" /> : null;
              })()}
            </g>
          )}
        </svg>

        {hover && hoverPt && (
          <div className="absolute top-2 pointer-events-none bg-[var(--card)] border border-[var(--line2)] rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5 z-10"
            style={hover.px < boxW / 2 ? { left: hover.px + 14 } : { right: boxW - hover.px + 14 }}>
            <p className="font-semibold text-[var(--ink)]">
              {new Date(hoverPt.t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </p>
            {visible.filter((s) => s.kind !== "dashed").map((s) => {
              const p = nearest(s.data, hoverPt.t);
              if (!p || Math.abs(p.t - hoverPt.t) > (t1 - t0) * 0.06 + 45 * 86400000) return null;
              return (
                <p key={s.key} className="tabular-nums flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: s.color }} />
                  <span className="text-[var(--ink3)]">{s.label}</span>
                  <span className="font-semibold text-[var(--ink)]">
                    {s.fmt === "rupee" ? "₹" : ""}{fmtVal(p.v, s.fmt === "cr" ? "plain" : s.fmt)}{s.fmt === "cr" ? " Cr" : ""}
                  </span>
                </p>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 flex-wrap mt-2">
        {model.map((s) => (
          <button key={s.key} onClick={() => toggle(s.key)} className="flex items-center gap-1.5 text-sm text-[var(--ink2)]">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded"
              style={{ background: isOn(s.key) ? s.color : "transparent", border: `1.5px solid ${s.color}` }}>
              {isOn(s.key) && <svg viewBox="0 0 10 10" className="w-2.5 h-2.5"><path d="M1.5 5.5 L4 8 L8.5 2.5" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" /></svg>}
            </span>
            {s.label}
          </button>
        ))}
      </div>
    </section>
  );
}
