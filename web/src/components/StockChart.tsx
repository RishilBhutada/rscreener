"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Pt = [string, number] | [string, number, number | null];
export type ChartPrices = { monthly?: Pt[]; weekly?: Pt[]; daily?: Pt[] };
export type ChartBand = {
  series: [string, number][];
  median_5y: number;
  /** shorter earnings windows, annualised, aligned index-for-index with `series` */
  alt?: Record<string, (number | null)[]>;
  alt_median_5y?: Record<string, number>;
} | null;

/** earnings window behind the PE line; each is annualised onto the TTM scale */
const PE_WINDOWS: [string, string, string][] = [
  ["ttm", "TTM", "Trailing 4 quarters — the standard PE"],
  ["q1", "1Q×4", "Latest quarter annualised (×4) — fastest to react, but carries that quarter's seasonality and one-offs"],
  ["q2", "2Q×2", "Last two quarters annualised (×2)"],
  ["q3", "3Q×⁴⁄₃", "Last three quarters annualised (×4/3)"],
];
export type ChartTrendQ = {
  periods: string[];
  revenue: (number | null)[];
  pat: (number | null)[];
  eps: (number | null)[];
  expenses?: (number | null)[];
  ebitda?: (number | null)[];
  book_value?: (number | null)[];
  opm?: (number | null)[];
  gpm?: (number | null)[];
  npm?: (number | null)[];
} | null;

type View = "price" | "pe" | "sales" | "ev" | "pb" | "ps";
type XY = { t: number; v: number };
type FmtKind = "rupee" | "plain" | "pct" | "vol" | "cr";

const RANGES: [string, number][] = [
  ["1M", 1 / 12], ["6M", 0.5], ["1Yr", 1], ["3Yr", 3], ["5Yr", 5], ["10Yr", 10], ["Max", 999],
];

// chart geometry is computed inside the component so it can shrink for phones
// (a fixed 920-wide viewBox scaled to ~340px renders 12px text at ~4px)

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

function fmtVal(v: number, kind: FmtKind): string {
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
  fmt: FmtKind;
};

/** One filed quarter: the period it covers, its EPS, and when NSE broadcast it. */
export type Quarter = {
  start: string;
  end: string;
  eps: number;
  announced?: string | null;
  q: number;      // Indian fiscal quarter — Apr-Jun is 1
};

/** Fixed colour per fiscal quarter, repeating every year, so the same quarter is
 *  always the same colour. Q3 is red by request; it does NOT mean a loss. */
const Q_COLOUR: Record<number, string> = {
  1: "var(--q1)",
  2: "var(--q2)",
  3: "var(--q3)",
  4: "var(--q4)",
};
const Q_LABEL: Record<number, string> = { 1: "Q1 Apr–Jun", 2: "Q2 Jul–Sep", 3: "Q3 Oct–Dec", 4: "Q4 Jan–Mar" };

export default function StockChart({ prices, peBand, evBand, pbBand, psBand, trendQ, livePrice, quarters }: {
  prices: ChartPrices;
  peBand?: ChartBand;
  evBand?: ChartBand;
  pbBand?: ChartBand;
  psBand?: ChartBand;
  trendQ?: ChartTrendQ;
  livePrice: number | null;
  quarters?: Quarter[] | null;
}) {
  const [view, setView] = useState<View>("price");
  const [range, setRange] = useState("5Yr");
  const [peWin, setPeWin] = useState("ttm");
  const [showQ, setShowQ] = useState(false);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [moreOpen, setMoreOpen] = useState(false);
  const [hover, setHover] = useState<{ t: number; px: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const W = isMobile ? 470 : 920, H = isMobile ? 420 : 470;
  const ML = isMobile ? 46 : 62, MR = isMobile ? 46 : 62, MT = 12, MB = isMobile ? 32 : 30;
  const plotW = W - ML - MR, plotH = H - MT - MB;
  const FS = isMobile ? 19 : 12;

  const isOn = (k: string, dflt = true) => on[k] ?? dflt;
  const toggle = (k: string) => setOn({ ...on, [k]: !isOn(k) });

  const years = RANGES.find(([r]) => r === range)?.[1] ?? 5;
  const now = Date.now();
  const cutoff = years >= 999 ? 0 : now - years * 365.25 * 86400000;

  const model = useMemo(() => {
    const daily: Pt[] = prices.daily ?? [];
    const monthly: Pt[] = prices.monthly ?? [];
    const weekly: Pt[] = prices.weekly ?? [];
    const defs: SeriesDef[] = [];

    const filt = (src: Pt[]): Pt[] => src.filter((p) => toT(p[0]) >= cutoff);
    const xy = (src: [string, number][]): XY[] => src.map((p) => ({ t: toT(p[0]), v: p[1] }));

    // quarterly metric -> bars aligned to period-end dates, filtered to the range
    // The ratio lines use trailing-twelve-month figures, so the bars beneath them
    // must too - plotting one quarter against a TTM ratio made Sales read 4x
    // smaller than screener's for the same date.
    const ttmBars = (arr?: (number | null)[]): XY[] => {
      if (!trendQ || !arr) return [];
      const out: XY[] = [];
      for (let i = 3; i < trendQ.periods.length; i++) {
        const w = arr.slice(i - 3, i + 1);
        if (w.length === 4 && w.every((v) => v !== null && v !== undefined)) {
          const t = toT(trendQ.periods[i]);
          if (t >= cutoff) out.push({ t, v: (w as number[]).reduce((a, b) => a + b, 0) });
        }
      }
      return out;
    };

    const qBars = (arr?: (number | null)[]): XY[] =>
      trendQ && arr
        ? trendQ.periods
            .map((p, i) => ({ t: toT(p), v: arr[i] }))
            .filter((r): r is XY => r.v !== null && r.v !== undefined && r.t >= cutoff)
        : [];

    // a valuation-band view: ratio line + dashed median + underlying metric bars
    const bandView = (
      band: ChartBand | undefined, lineLabel: string, medianLabel: string, lineFmt: FmtKind,
      bars: XY[], barLabel: string, barFmt: FmtKind,
    ) => {
      if (!band) return;
      const pts = xy(band.series.filter((p) => toT(p[0]) >= cutoff));
      defs.push({ key: `${view}_line`, label: lineLabel, color: "var(--accent)", kind: "line", axis: "R", data: pts, fmt: lineFmt });
      if (pts.length) {
        defs.push({
          key: `${view}_median`, label: `${medianLabel} = ${band.median_5y}`, color: "var(--chart-axis)", kind: "dashed", axis: "R",
          data: [{ t: pts[0].t, v: band.median_5y }, { t: pts[pts.length - 1].t, v: band.median_5y }], fmt: lineFmt,
        });
      }
      if (bars.length) defs.push({ key: `${view}_bar`, label: barLabel, color: "var(--chart-vol)", kind: "bars", axis: "L", data: bars, fmt: barFmt });
    };

    if (view === "price") {
      // Pick the finest series that actually covers the selected window, then
      // express the 50/200-day averages in that series' own bars (50 trading
      // days ~ 10 weeks ~ 2.4 months) so both lines show on every range.
      const covers = (src: Pt[]) => src.length > 30 && toT(src[0][0]) <= cutoff + 40 * 86400000;
      const [src, w50, w200] =
        covers(daily) && years <= 3 ? [daily, 50, 200] as const
        : covers(weekly) ? [weekly, 10, 40] as const
        : [monthly, 2, 9] as const;

      let base = filt(src);
      if (!base.length) base = filt(monthly);
      const pricePts: XY[] = base.map((p) => ({ t: toT(p[0]), v: p[1] }));
      if (livePrice !== null && pricePts.length) pricePts.push({ t: now, v: livePrice });
      defs.push({ key: "price", label: "Price on NSE", color: "var(--accent)", kind: "line", axis: "R", data: pricePts, fmt: "rupee" });

      if (src.length >= w200 + 5) {
        const closes = src.map((p) => p[1]);
        const times = src.map((p) => toT(p[0]));
        const mk = (win: number): XY[] =>
          sma(closes, win)
            .map((v, i) => (v === null ? null : { t: times[i], v }))
            .filter((p): p is XY => !!p && p.t >= cutoff);
        const d50 = mk(w50), d200 = mk(w200);
        if (d50.length > 1) defs.push({ key: "dma50", label: "50 DMA", color: "var(--chart-dma50)", kind: "line", axis: "R", data: d50, fmt: "rupee" });
        if (d200.length > 1) defs.push({ key: "dma200", label: "200 DMA", color: "var(--chart-dma200)", kind: "line", axis: "R", data: d200, fmt: "rupee" });
      }
      const volPts: XY[] = base
        .filter((p) => p.length > 2 && p[2] !== null && (p[2] as number) > 0)
        .map((p) => ({ t: toT(p[0]), v: p[2] as number }));
      if (volPts.length) defs.push({ key: "volume", label: "Volume", color: "var(--chart-vol)", kind: "bars", axis: "L", data: volPts, fmt: "vol" });
    }

    if (view === "pe") {
      // earnings bars follow the selected window, annualised the same way the
      // PE line is, so the two always describe the same earnings
      const nQ = peWin === "q1" ? 1 : peWin === "q2" ? 2 : peWin === "q3" ? 3 : 4;
      const mult = peWin === "q1" ? 4 : peWin === "q2" ? 2 : peWin === "q3" ? 4 / 3 : 1;
      const epsBars: XY[] = [];
      if (trendQ) {
        for (let i = nQ - 1; i < trendQ.periods.length; i++) {
          const w = trendQ.eps.slice(i - nQ + 1, i + 1);
          if (w.length === nQ && w.every((v) => v !== null && v !== undefined)) {
            const t = toT(trendQ.periods[i]);
            if (t >= cutoff) epsBars.push({ t, v: (w as number[]).reduce((a, b) => a + b, 0) * mult });
          }
        }
      }
      const win = PE_WINDOWS.find(([k]) => k === peWin);
      const suffix = peWin === "ttm" ? "" : ` (${win?.[1]})`;
      // swap in the selected window's values; they align index-for-index
      let band = peBand ?? null;
      if (band && peWin !== "ttm" && band.alt?.[peWin]) {
        const vals = band.alt[peWin];
        band = {
          ...band,
          series: band.series
            .map((p, i) => [p[0], vals[i]] as [string, number | null])
            .filter((p): p is [string, number] => p[1] !== null && p[1] !== undefined),
          median_5y: band.alt_median_5y?.[peWin] ?? band.median_5y,
        };
      }
      bandView(band, `PE${suffix}`, "Median PE", "plain", epsBars, `EPS${suffix}`, "plain");
    }

    if (view === "ev") bandView(evBand, "EV / EBITDA", "Median EV Multiple", "plain", ttmBars(trendQ?.ebitda), "EBITDA (TTM)", "cr");
    if (view === "pb") bandView(pbBand, "Price to BV", "Median PBV", "plain", qBars(trendQ?.book_value), "Book Value", "rupee");
    if (view === "ps") bandView(psBand, "Market Cap / Sales", "Median Market Cap to Sales", "plain", ttmBars(trendQ?.revenue), "Sales (TTM)", "cr");

    if (view === "sales" && trendQ) {
      const sales = qBars(trendQ.revenue);
      if (sales.length) defs.push({ key: "sales", label: "Quarter Sales", color: "var(--chart-bar)", kind: "bars", axis: "L", data: sales, fmt: "cr" });
      const gpm = qBars(trendQ.gpm);
      if (gpm.length > 1) defs.push({ key: "gpm", label: "GPM %", color: "var(--chart-alt)", kind: "smooth", axis: "R", data: gpm, fmt: "pct" });
      const opm = qBars(trendQ.opm);
      if (opm.length > 1) defs.push({ key: "opm", label: "OPM %", color: "var(--chart-dma50)", kind: "smooth", axis: "R", data: opm, fmt: "pct" });
      const npm = qBars(trendQ.npm);
      if (npm.length > 1) defs.push({ key: "npm", label: "NPM %", color: "var(--chart-pos)", kind: "smooth", axis: "R", data: npm, fmt: "pct" });
    }

    return defs;
  }, [prices, peBand, evBand, pbBand, psBand, trendQ, view, peWin, cutoff, livePrice, now]);

  const visible = model.filter((s) => isOn(s.key));
  if (!model.length || !model.some((s) => s.data.length > 1)) {
    return (
      <ChartShell range={range} setRange={setRange} view={view} setView={setView}
        moreOpen={moreOpen} setMoreOpen={setMoreOpen} avail={{ pe: !!peBand, sales: !!trendQ, ev: !!evBand, pb: !!pbBand, ps: !!psBand }}>
        <div className="h-64 flex items-center justify-center text-sm text-[var(--ink3)]">No data yet for this view.</div>
      </ChartShell>
    );
  }

  const t0 = Math.min(...visible.flatMap((s) => (s.data.length ? [s.data[0].t] : [])));
  const t1 = Math.max(...visible.flatMap((s) => (s.data.length ? [s.data[s.data.length - 1].t] : [])));
  const x = (t: number) => ML + ((t - t0) / Math.max(1, t1 - t0)) * plotW;

  const axisVals = (axis: "L" | "R") => visible.filter((s) => s.axis === axis).flatMap((s) => s.data.map((d) => d.v));
  const mkAxis = (axis: "L" | "R") => {
    const vals = axisVals(axis);
    if (!vals.length) return null;
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (axis === "L") {
      // Earnings compound ~40x over 20 years. Anchored at zero the early bars
      // collapse into invisible slivers and the series reads as "line goes up"
      // with no detail - which is why screener.in floors this axis near the data
      // minimum. Only applied when the span is genuinely extreme.
      const pos = vals.filter((v) => v > 0);
      const minPos = pos.length ? Math.min(...pos) : 0;
      lo = minPos > 0 && hi / minPos > 15 ? minPos * 0.85 : Math.min(0, lo);
    }
    const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.06 || 1;
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
    const t = t0 + ((fx * W - ML) / plotW) * (t1 - t0);
    setHover({ t: Math.min(t1, Math.max(t0, t)), px: e.clientX - rect.left });
  };

  // EPS bars get their own strip along the bottom of the plot rather than sharing
  // a value axis with price or a ratio — the magnitudes are unrelated, and sharing
  // one would flatten whichever series is smaller into nothing.
  const qShown = (quarters ?? []).filter((q) => toT(q.end) >= t0 && toT(q.start) <= t1);
  const qStripH = plotH * 0.22;
  const qBase = MT + plotH;
  const qMax = Math.max(...qShown.map((q) => Math.abs(q.eps)), 1);
  const qScale = (v: number) => (Math.max(0, v) / qMax) * qStripH;

  const primary = visible.find((s) => s.kind !== "bars" && s.kind !== "dashed") ?? visible[0];
  const hoverPt = hover && primary ? nearest(primary.data, hover.t) : null;
  const barW = (s: SeriesDef) => Math.max(1.5, Math.min(26, (plotW / Math.max(1, s.data.length)) * 0.62));
  const boxW = svgRef.current?.getBoundingClientRect().width ?? 600;

  return (
    <ChartShell range={range} setRange={setRange} view={view} setView={setView}
      moreOpen={moreOpen} setMoreOpen={setMoreOpen} avail={{ pe: !!peBand, sales: !!trendQ, ev: !!evBand, pb: !!pbBand, ps: !!psBand }}
      onViewChange={() => setHover(null)}>
      {view === "pe" && peBand?.alt && (
        <div className="flex items-center gap-2 flex-wrap mb-2 text-xs">
          <span className="text-[var(--ink3)]">Earnings window</span>
          <div className="flex gap-1 flex-wrap">
            {PE_WINDOWS.filter(([k]) => k === "ttm" || peBand.alt?.[k]).map(([k, label, tip]) => (
              <button
                key={k}
                onClick={() => { setPeWin(k); setHover(null); }}
                title={tip}
                className={`rounded-lg px-2.5 py-1.5 sm:py-1 font-medium ${
                  peWin === k
                    ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]"
                    : "text-[var(--ink2)] hover:bg-[var(--card2)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-[var(--ink3)] hidden sm:inline">
            · shorter windows are annualised onto the TTM scale, so they can be read against it
          </span>
        </div>
      )}
      {(quarters?.length ?? 0) > 0 && (
        <div className="flex items-center gap-2 flex-wrap mb-2 text-xs">
          <button
            onClick={() => setShowQ(!showQ)}
            title="Colour each quarter's EPS and mark the day its results were declared"
            className={`rounded-lg px-2.5 py-1.5 sm:py-1 font-medium border ${
              showQ
                ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)]"
                : "text-[var(--ink2)] border-[var(--line)] hover:bg-[var(--card2)]"
            }`}
          >
            {showQ ? "✓ " : ""}Quarterly results
          </button>
          {showQ && (
            <div className="flex items-center gap-2.5 flex-wrap text-[var(--ink3)]">
              {[1, 2, 3, 4].map((n) => (
                <span key={n} className="inline-flex items-center gap-1">
                  <i className="inline-block w-3 h-3 rounded-sm" style={{ background: Q_COLOUR[n] }} />
                  {Q_LABEL[n]}
                </span>
              ))}
              <span className="inline-flex items-center gap-1">
                <i className="inline-block w-4 border-t-2 border-dashed border-[var(--ink3)]" />
                declared
              </span>
            </div>
          )}
        </div>
      )}
      <div className="relative">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none"
          onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>

          {axR && axR.ticks.map((v) => (
            <g key={`r${v}`}>
              <line x1={ML} x2={W - MR} y1={axR.scale(v)} y2={axR.scale(v)} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={W - MR + 8} y={axR.scale(v) + 4} fontSize={FS} fill="var(--chart-axis)">{fmtVal(v, fmtKindOf("R"))}</text>
            </g>
          ))}
          {axL && axL.ticks.map((v) => (
            <text key={`l${v}`} x={ML - 8} y={axL.scale(v) + 4} fontSize={FS} fill="var(--chart-axis)" textAnchor="end">{fmtVal(v, fmtKindOf("L"))}</text>
          ))}
          {xt.map((tk) => (
            <text key={tk.t} x={x(tk.t)} y={H - 8} fontSize={FS} fill="var(--chart-axis)" textAnchor="middle">{tk.label}</text>
          ))}

          {/* Quarter-coloured EPS bars, spanning the period each result actually
              covers so consecutive quarters butt together with no gap, plus a
              dropline on the day NSE broadcast them. The gap between a bar's
              right edge and its own dropline IS the reporting lag - the weeks
              where the market is still valuing the company on older earnings. */}
          {showQ && qShown.length > 0 && (
            <g>
              {qShown.map((q, i) => {
                // A quarter ends 30-Jun and the next starts 01-Jul, so plotting
                // start->end leaves a one-day sliver between every pair. The bar
                // runs to the END of its last day, which closes it exactly.
                const x0 = x(toT(q.start)), x1v = x(toT(q.end) + 86400000);
                const h = qScale(q.eps);
                return (
                  <rect key={`qb${i}`} x={Math.min(x0, x1v)} y={qBase - h}
                    width={Math.max(1, Math.abs(x1v - x0))} height={Math.max(1, h)}
                    fill={Q_COLOUR[q.q] ?? "var(--q1)"} opacity="0.8">
                    <title>{`${Q_LABEL[q.q] ?? `Q${q.q}`} · EPS ₹${q.eps}${q.announced ? ` · declared ${q.announced}` : ""}`}</title>
                  </rect>
                );
              })}
              <line x1={ML} x2={W - MR} y1={qBase} y2={qBase} stroke="var(--chart-grid)" strokeWidth="1" />
            </g>
          )}
          {showQ && qShown.map((q, i) => (
            q.announced && toT(q.announced) >= t0 && toT(q.announced) <= t1 ? (
              <g key={`ql${i}`}>
                <line x1={x(toT(q.announced))} x2={x(toT(q.announced))} y1={MT} y2={MT + plotH}
                  stroke={Q_COLOUR[q.q] ?? "var(--q1)"} strokeWidth="1.4" strokeDasharray="4 3" opacity="0.9" />
                <circle cx={x(toT(q.announced))} cy={MT + 3} r="3" fill={Q_COLOUR[q.q] ?? "var(--q1)"}>
                  <title>{`${Q_LABEL[q.q] ?? `Q${q.q}`} results declared ${q.announced}`}</title>
                </circle>
              </g>
            ) : null
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
                fill="none" stroke={s.color} strokeWidth={s.key === "price" || s.key.endsWith("_line") ? 1.9 : 1.4}
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
    </ChartShell>
  );
}

const MORE_VIEWS: [View, string][] = [
  ["sales", "Sales & Margin"], ["ev", "EV / EBITDA"], ["pb", "Price to Book"], ["ps", "Market Cap / Sales"],
];

function ChartShell({
  range, setRange, view, setView, moreOpen, setMoreOpen, avail, onViewChange, children,
}: {
  range: string; setRange: (r: string) => void;
  view: View; setView: (v: View) => void;
  moreOpen: boolean; setMoreOpen: (b: boolean) => void;
  avail: { pe: boolean; sales: boolean; ev: boolean; pb: boolean; ps: boolean };
  onViewChange?: () => void;
  children: React.ReactNode;
}) {
  const pick = (v: View) => { setView(v); setMoreOpen(false); onViewChange?.(); };
  const moreItems = MORE_VIEWS.filter(([v]) => avail[v as keyof typeof avail]);
  const activeMore = moreItems.find(([v]) => v === view);
  const btn = (active: boolean) =>
    `rounded-lg px-3 py-2 sm:py-1.5 min-h-[38px] sm:min-h-0 inline-flex items-center whitespace-nowrap font-medium ${active ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] hover:bg-[var(--card2)]"}`;

  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap mb-2">
        <div className="flex gap-1 text-xs flex-nowrap overflow-x-auto sm:flex-wrap -mx-1 px-1 [scrollbar-width:none]">
          {RANGES.map(([r]) => (
            <button key={r} onClick={() => setRange(r)} className={btn(range === r)}>{r}</button>
          ))}
        </div>
        <div className="flex gap-1 text-xs flex-wrap items-center">
          <button onClick={() => pick("price")} className={btn(view === "price")}>Price</button>
          {avail.pe && <button onClick={() => pick("pe")} className={btn(view === "pe")}>PE Ratio</button>}
          {moreItems.length > 0 && (
            <div className="relative">
              <button onClick={() => setMoreOpen(!moreOpen)} className={btn(!!activeMore)}>
                {activeMore ? activeMore[1] : "More"} <span className="text-[10px]">▾</span>
              </button>
              {moreOpen && <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />}
              {moreOpen && (
                <div className="absolute right-0 mt-1 z-20 min-w-44 bg-[var(--card)] border border-[var(--line)] rounded-xl shadow-xl overflow-hidden">
                  {moreItems.map(([v, label]) => (
                    <button key={v} onClick={() => pick(v)}
                      className={`block w-full text-left px-3 py-2 ${view === v ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] font-semibold" : "text-[var(--ink2)] hover:bg-[var(--card2)]"}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
