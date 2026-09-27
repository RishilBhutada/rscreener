"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createChart, createTextWatermark, createSeriesMarkers,
  CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries,
  CrosshairMode, PriceScaleMode, LineStyle, LineType,
  type IChartApi, type ISeriesApi, type SeriesType, type UTCTimestamp, type MouseEventParams,
  type Time, type SeriesMarker, type ISeriesPrimitive, type SeriesAttachedParameter,
  type IPrimitivePaneView, type PrimitiveHoveredItem,
} from "lightweight-charts";
import { loadIndex } from "@/lib/index-data";
import InfoTip, { InfoDialog } from "@/components/InfoTip";
import {
  workingFor, growth, growthText, PE_WINDOWS, CA_LABEL, CA_ORDER, Q_LABEL,
  type ChartBand, type ChartTrendQ, type Quarter, type CorpAction, type Growth, type Working,
} from "@/components/StockChart";

/** The full-screen chart - the view a trading terminal opens when you tap a
 *  chart, with everything the company-page chart can do.
 *
 *  Built on TradingView's open-source Lightweight Charts for the parts a
 *  hand-drawn SVG does badly: pinch-zoom, pan with momentum, a crosshair that
 *  follows a finger. The CALCULATIONS are not re-invented here - growth
 *  wording, the "how this was worked out" breakdown and the labels are
 *  imported from the company chart, so the two cannot disagree about a number.
 *
 *  What it cannot be is intraday: the app holds end-of-day prices only. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DAY = 86400;

type Row = [number, number, number, number, number, number]; // day, o, h, l, c, v
type ChartFile = { s: string; asof?: string | null; d?: Row[]; w?: Row[]; m?: Row[] };
type Company = {
  snapshot?: { name?: string | null };
  exchange?: string | null;
  pe_band?: ChartBand; ev_band?: ChartBand; pb_band?: ChartBand; ps_band?: ChartBand;
  trend?: { quarterly?: ChartTrendQ };
  quarters?: Quarter[] | null;
  actions?: CorpAction[] | null;
  peers?: { symbol?: unknown; name?: unknown }[] | null;
  coverage?: { quarters: number; from?: string | null; gaps?: string[]; gap_count?: number } | null;
};

type View = "price" | "pe" | "sales" | "ev" | "pb" | "ps";
const VIEWS: [View, string][] = [
  ["price", "Price"], ["pe", "PE"], ["sales", "Sales & margin"],
  ["ev", "EV / EBITDA"], ["pb", "Price / Book"], ["ps", "MCap / Sales"],
];
type Interval = "d" | "w" | "m";
type Range = "1M" | "3M" | "6M" | "YTD" | "1Y" | "2Y" | "3Y" | "5Y" | "10Y" | "MAX";
type Kind = "candles" | "hollow" | "bars" | "heikin" | "line" | "area";
type Ind = "vol" | "dma50" | "dma200" | "sma20" | "ema21" | "bb" | "rsi";
/** Results and corporate actions are drawn three ways at once, as the owner
 *  chose on 27-Sep-2026: fiscal quarters as tinted blocks behind the chart, a
 *  faint line through the chart on each event date, and a timeline band along
 *  its foot - results on the upper line, corporate actions on the lower, each
 *  a tag carrying its figure (Q1, ₹75, Bonus 1:1) that opens the details when
 *  tapped. Picked from six candidates: shapes, badges, pins, icons, dots, tags. */
/** The words a tag carries: the amount or ratio where the filing gives one. */
function caTag(k: string, detail?: string | null): string {
  const d = (detail ?? "").split(" (")[0].trim();
  if (k === "dividend") return d.startsWith("₹") ? d : "Div";
  if (k === "bonus") return d ? `Bonus ${d}` : "Bonus";
  if (k === "rights") return d ? `Rights ${d}` : "Rights";
  if (k === "split") return d ? `Split ${d}` : "Split";
  if (k === "buyback") return "Buyback";
  return "Other";
}
/** Indian fiscal quarter of a calendar month: Apr-Jun is Q1. */
const fyQ = (month: number) => (month >= 4 && month <= 6 ? 1 : month >= 7 && month <= 9 ? 2 : month >= 10 ? 3 : 4);

const RANGES: Range[] = ["1M", "3M", "6M", "YTD", "1Y", "2Y", "3Y", "5Y", "10Y", "MAX"];
const RANGE_DAYS: Record<Range, number> = {
  "1M": 31, "3M": 92, "6M": 183, YTD: 0, "1Y": 366, "2Y": 731, "3Y": 1096, "5Y": 1827, "10Y": 3653, MAX: Infinity,
};
/** The candle each range opens on, the way Kite picks it. */
const AUTO: Record<Range, Interval> = {
  "1M": "d", "3M": "d", "6M": "d", YTD: "d", "1Y": "d", "2Y": "d", "3Y": "w", "5Y": "w", "10Y": "m", MAX: "m",
};
const INTERVALS: [Interval, string][] = [["d", "D"], ["w", "W"], ["m", "M"]];
/** 50 and 200 trading days expressed in each candle's own bars - the same
 *  conversion the company chart uses, so "50 DMA" means one thing everywhere. */
const DMA_BARS: Record<Interval, [number, number]> = { d: [50, 200], w: [10, 40], m: [2, 9] };

const KINDS: [Kind, string][] = [
  ["candles", "Candles"], ["hollow", "Hollow candles"], ["bars", "Bars (OHLC)"],
  ["heikin", "Heikin-Ashi"], ["line", "Line"], ["area", "Area"],
];
const INDS: [Ind, string][] = [
  ["vol", "Volume"], ["dma50", "50 DMA"], ["dma200", "200 DMA"], ["sma20", "SMA 20"],
  ["ema21", "EMA 21"], ["bb", "Bollinger Bands (20, 2)"], ["rsi", "RSI (14)"],
];
const FIXED: Partial<Record<Ind, string>> = { sma20: "#3b82f6", ema21: "#14b8a6", rsi: "#a855f7" };

/** The series each non-price view draws, for its on/off switches. */
const LAYERS: Record<Exclude<View, "price">, [string, string][]> = {
  pe: [["line", "PE"], ["median", "Median PE (5 years)"], ["bars", "EPS bars"]],
  ev: [["line", "EV / EBITDA"], ["median", "Median EV multiple"], ["bars", "EBITDA (TTM)"]],
  pb: [["line", "Price / Book"], ["median", "Median P/B"], ["bars", "Book value"]],
  ps: [["line", "Market cap / Sales"], ["median", "Median MCap / Sales"], ["bars", "Sales (TTM)"]],
  sales: [["sales", "Quarter sales"], ["gpm", "GPM %"], ["opm", "OPM %"], ["npm", "NPM %"]],
};

/* ── Arithmetic ─────────────────────────────────────────────────────────── */

function sma(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

function ema(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (n + 1);
  let prev: number | null = null;
  for (let i = 0; i < v.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    if (prev === null) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += v[j];
      prev = s / n;
    } else prev = v[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function bollinger(v: number[], n = 20, width = 2) {
  const mid = sma(v, n);
  const up: (number | null)[] = [], lo: (number | null)[] = [];
  for (let i = 0; i < v.length; i++) {
    const m = mid[i];
    if (m === null) { up.push(null); lo.push(null); continue; }
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j] - m) ** 2;
    const sd = Math.sqrt(s / n);
    up.push(m + width * sd); lo.push(m - width * sd);
  }
  return { mid, up, lo };
}

/** Wilder's RSI - the smoothing every charting platform means by "RSI 14". */
function rsi(v: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) {
      g += up; l += dn;
      if (i < n) { out.push(null); continue; }
      g /= n; l /= n;
    } else {
      g = (g * (n - 1) + up) / n;
      l = (l * (n - 1) + dn) / n;
    }
    out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
  }
  return out;
}

function heikinAshi(rows: Row[]): Row[] {
  const out: Row[] = [];
  let po = 0, pc = 0;
  rows.forEach(([t, o, h, l, c, v], i) => {
    const hc = (o + h + l + c) / 4;
    const ho = i === 0 ? (o + c) / 2 : (po + pc) / 2;
    out.push([t, ho, Math.max(h, ho, hc), Math.min(l, ho, hc), hc, v]);
    po = ho; pc = hc;
  });
  return out;
}

const dayOf = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 1000 / DAY);
const toTime = (day: number) => (day * DAY) as UTCTimestamp;

/** Index of the last time at or before `day`; 0 when every time is later. */
function atOrBefore(times: number[], day: number): number {
  let lo = 0, hi = times.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= day) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** The first bar on or after an event, so a marker lands on a bar that exists.
 *  Null when the event is outside the series altogether. */
function snap(times: number[], day: number): number | null {
  if (!times.length || day < times[0] - 1 || day > times[times.length - 1] + 45) return null;
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < day) lo = mid + 1; else hi = mid;
  }
  return times[lo];
}

/* ── Presentation ───────────────────────────────────────────────────────── */

const price = (x: number) => x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Axis labels: round numbers as round numbers, and nothing below zero on a
 *  price axis - the space kept for the volume bars sits there. */
const axis = (x: number) => (x < 0 ? "" : x.toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const ratio = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: x >= 100 ? 0 : 1 });
const crore = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")} Cr`;
const vol = (x: number) =>
  x >= 1e7 ? `${(x / 1e7).toFixed(2)} Cr` : x >= 1e5 ? `${(x / 1e5).toFixed(2)} L` : x >= 1e3 ? `${(x / 1e3).toFixed(1)} K` : `${x}`;
const dateOf = (day: number, fmt: "day" | "month" = "day") =>
  new Date(day * DAY * 1000).toLocaleDateString("en-IN", fmt === "day"
    ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }
    : { month: "short", year: "numeric", timeZone: "UTC" });

/** Colours come from the app's theme, so the chart is Black on Black and
 *  changes the moment the theme does. */
function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string, f: string) => cs.getPropertyValue(k).trim() || f;
  return {
    bg: v("--bg", "#000000"), card2: v("--card2", "#161616"),
    ink: v("--ink", "#f5f5f5"), ink3: v("--ink3", "#8c8c8c"), line: v("--line", "#1f1f1f"),
    grid: v("--chart-grid", "#1c1c1c"), pos: v("--chart-pos", "#34d399"), neg: v("--chart-neg", "#f87171"),
    accent: v("--accent", "#818cf8"), axisCol: v("--chart-axis", "#6e6e6e"),
    dma50: v("--chart-dma50", "#fbbf24"), dma200: v("--chart-dma200", "#818cf8"),
    vol: v("--chart-vol", "#31517e"), alt: v("--chart-alt", "#22d3ee"), bar: v("--chart-bar", "#55499b"),
    gpm: v("--chart-alt", "#22d3ee"), opm: v("--chart-dma50", "#fbbf24"), npm: v("--chart-pos", "#34d399"),
    q: { 1: v("--q1", "#5d82ad"), 2: v("--q2", "#4e8a6b"), 3: v("--q3", "#a86259"), 4: v("--q4", "#a89050") } as Record<number, string>,
    ca: {
      dividend: v("--ca-div", "#4fb894"), bonus: v("--ca-bon", "#a68bea"), split: v("--ca-spl", "#5aa3e0"),
      rights: v("--ca-rgt", "#e0995a"), buyback: v("--ca-buy", "#e07ab0"), other: v("--ca-oth", "#98a1b2"),
    } as Record<string, string>,
    font: getComputedStyle(document.body).fontFamily || "system-ui, sans-serif",
  };
}
type Pal = ReturnType<typeof palette>;

function alpha(color: string, a: number): string {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return color;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** One date on the timeline band: every event on it. */
type TlEv = { kind: "ca" | "res"; tag: string; color: string };
type TlMark = { day: number; evs: TlEv[] };
type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A fiscal quarter's span of candles, first day to last. */
type QSpan = { key: number; from: number; to: number; color: string };

/** Fiscal quarters as solid tinted blocks behind the chart. Drawn as one
 *  column per candle, as they first were, the gaps between candles showed
 *  through and the tint came out as fine stripes. */
class QuarterBands implements ISeriesPrimitive<Time> {
  private chart: SeriesAttachedParameter<Time>["chart"] | null = null;
  private readonly view: IPrimitivePaneView;
  private readonly spans: QSpan[];

  constructor(spans: QSpan[]) {
    this.spans = spans;
    this.view = {
      zOrder: () => "bottom",
      renderer: () => ({
        draw: () => {},
        drawBackground: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.draw(context, mediaSize.height)),
      }),
    };
  }

  attached(param: SeriesAttachedParameter<Time>) { this.chart = param.chart; }
  detached() { this.chart = null; }
  paneViews() { return [this.view]; }

  private draw(ctx: Ctx, h: number) {
    const chart = this.chart;
    if (!chart) return;
    const ts = chart.timeScale();
    // Half a candle's width either side, so one quarter's block ends exactly
    // where the next one's begins.
    const half = ts.options().barSpacing / 2;
    for (const q of this.spans) {
      const a = ts.timeToCoordinate(toTime(q.from));
      const b = ts.timeToCoordinate(toTime(q.to));
      if (a === null || b === null) continue;
      const x0 = Math.round(a - half), x1 = Math.round(b + half);
      ctx.fillStyle = q.color;
      ctx.fillRect(x0, 0, x1 - x0, h);
    }
  }
}

/** The timeline band along the chart's foot: results on the upper line,
 *  corporate actions on the lower, each a tag carrying its figure.
 *
 *  Drawn on the chart canvas by hand - the library's own markers are shapes
 *  with a letter, not labels. Results and their dividend fall days apart, so
 *  tags that would touch are drawn as ONE ("₹31 +1"), and a tap on it lists
 *  every event it holds; overlapping, the one beneath could not be tapped. */
class TimelineMarks implements ISeriesPrimitive<Time> {
  private chart: SeriesAttachedParameter<Time>["chart"] | null = null;
  private series: SeriesAttachedParameter<Time>["series"] | null = null;
  private placed: { days: number[]; x0: number; y0: number; x1: number; y1: number }[] = [];
  private readonly view: IPrimitivePaneView;
  private readonly marks: TlMark[];
  private readonly p: Pal;

  constructor(marks: TlMark[], p: Pal) {
    this.marks = marks; this.p = p;
    this.view = {
      zOrder: () => "top",
      renderer: () => ({ draw: (target) => target.useMediaCoordinateSpace(({ context }) => this.draw(context)) }),
    };
  }

  attached(param: SeriesAttachedParameter<Time>) { this.chart = param.chart; this.series = param.series; }
  detached() { this.chart = null; this.series = null; }
  paneViews() { return [this.view]; }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const b = this.placed.find((b) => x >= b.x0 - 6 && x <= b.x1 + 6 && y >= b.y0 - 6 && y <= b.y1 + 6);
    return b ? { externalId: `ev:${b.days.join(",")}`, zOrder: "top", cursorStyle: "pointer" } : null;
  }

  /** For a fingertip: the tag nearest a tap in the band, within 16px. */
  near(x: number, y: number): number[] | null {
    let best: number[] | null = null;
    let bd = 17;
    for (const b of this.placed) {
      if (y < b.y0 - 14 || y > b.y1 + 14) continue;
      const d = x < b.x0 ? b.x0 - x : x > b.x1 ? x - b.x1 : 0;
      if (d < bd) { bd = d; best = b.days; }
    }
    return best;
  }

  private draw(ctx: Ctx) {
    this.placed = [];
    const chart = this.chart, series = this.series, p = this.p;
    if (!chart || !series) return;
    const mid = series.priceToCoordinate(0);
    if (mid === null) return;
    const ts = chart.timeScale();
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 10px ${p.font}`;
    // Room for the widest a grouped tag can get ("₹31 +12"), so a group never
    // runs into the next one.
    const half = (tag: string) => ctx.measureText(`${tag} +99`).width / 2 + 5;
    type Group = { x: number; hw: number; evs: TlEv[]; days: number[] };
    const lanes: Group[][] = [[], []];
    for (const m of this.marks) {
      const x = ts.timeToCoordinate(toTime(m.day));
      if (x === null) continue;
      [m.evs.filter((e) => e.kind === "res"), m.evs.filter((e) => e.kind === "ca")].forEach((evs, lane) => {
        if (!evs.length) return;
        const hw = half(evs[0].tag);
        const row = lanes[lane];
        const prev = row[row.length - 1];
        if (prev && x - hw < prev.x + prev.hw + 2) {
          prev.evs.push(...evs);
          prev.days.push(m.day);
        } else row.push({ x, hw, evs: [...evs], days: [m.day] });
      });
    }
    // One line, centred, when a company has only one kind of event.
    const both = lanes[0].length > 0 && lanes[1].length > 0;
    lanes.forEach((row, lane) => {
      const y = both ? (lane === 0 ? mid - 9 : mid + 9) : mid;
      for (const g of row) {
        const e = g.evs[0];
        const label = g.evs.length > 1 ? `${e.tag} +${g.evs.length - 1}` : e.tag;
        const w = ctx.measureText(label).width + 10;
        const t = alpha(e.color, 0.16);
        ctx.fillStyle = t === e.color ? p.card2 : t;
        roundRect(ctx, g.x - w / 2, y - 8, w, 16, 8);
        ctx.fill();
        ctx.strokeStyle = alpha(e.color, 0.6);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = e.color;
        ctx.fillText(label, g.x, y + 0.5);
        this.placed.push({ days: g.days, x0: g.x - w / 2, y0: y - 8, x1: g.x + w / 2, y1: y + 8 });
      }
    });
    ctx.restore();
  }
}

function growthCol(g: Growth | undefined, p: Pal): string {
  if (!g || g.kind === "none") return p.ink3;
  if (g.kind === "pct") return g.pct >= 0 ? p.pos : p.neg;
  return g.kind === "toProfit" || g.kind === "betterLoss" ? p.pos : p.neg;
}

type Prefs = { kind: Kind; inds: Ind[]; log: boolean };
const PREF_KEY = "rs_fullchart";
function loadPrefs(): Prefs {
  const dflt: Prefs = { kind: "candles", inds: ["vol", "dma50", "dma200"], log: false };
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "null");
    if (!p) return dflt;
    return {
      kind: KINDS.some(([k]) => k === p.kind) ? p.kind : "candles",
      inds: Array.isArray(p.inds) ? p.inds.filter((x: string) => INDS.some(([k]) => k === x)) : dflt.inds,
      log: !!p.log,
    };
  } catch {
    return dflt;
  }
}

type LItem = { label: string; value: string; color?: string };
type LegendData = {
  date: string;
  tag?: string;
  ohlc?: [number, number, number, number];
  pct?: number | null;
  items: LItem[];
  working?: Working | null;
  /** Results declared or corporate actions on the bar under the finger. */
  events?: { text: string; color: string }[];
};

type Bar = { day: number; v: number; q?: number; announced?: string | null; chg?: Growth };

/* ── The settings sheet's parts ─────────────────────────────────────────── */

const Switch = ({ on }: { on: boolean }) => (
  <span className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${on ? "bg-[var(--accent)]" : "bg-[var(--line2)]"}`}>
    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
  </span>
);
const Toggle = ({ on, label, sub, dot, onClick }: { on: boolean; label: string; sub?: string; dot?: string; onClick: () => void }) => (
  <button role="switch" aria-checked={on} onClick={onClick}
    className="w-full min-h-[48px] px-3 rounded-xl flex items-center gap-3 text-[15px] text-[var(--ink)] active:bg-[var(--card2)]">
    {dot !== undefined && <span className="w-3 h-3 rounded-full shrink-0" style={{ background: dot || "var(--ink3)" }} />}
    <span className="flex-1 text-left">
      {label}
      {sub && <span className="block text-xs text-[var(--ink3)]">{sub}</span>}
    </span>
    <Switch on={on} />
  </button>
);
const Head = ({ children }: { children: React.ReactNode }) => (
  <p className="px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">{children}</p>
);
const Seg = <T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) => (
  <div className="flex items-center rounded-lg bg-[var(--card2)] p-0.5 shrink-0">
    {options.map(([k, label]) => (
      <button key={k} role="radio" aria-checked={value === k} onClick={() => onChange(k)}
        className={`min-h-[30px] px-2.5 rounded-md text-[13px] font-semibold ${value === k ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>
        {label}
      </button>
    ))}
  </div>
);

export default function FullChart({ symbol }: { symbol: string }) {
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const kept = useRef<{ key: string; from: number; to: number } | null>(null);
  // First and last day of the series on screen, for placing a range. The range
  // used to be placed by fitting the whole chart and reading its width back in
  // the same breath - but the library applies a fit on the next frame, so the
  // reading was stale, the fit won, and "1Y" showed two years.
  const spanRef = useRef<{ first: number; last: number } | null>(null);

  const [file, setFile] = useState<ChartFile | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState<{ symbol: string; name: string; mcap: number }[]>([]);
  const [view, setView] = useState<View>("price");
  const [range, setRange] = useState<Range>("1Y");
  const [interval, setIv] = useState<Interval>("d");
  const [prefs, setPrefs] = useState<Prefs>({ kind: "candles", inds: ["vol", "dma50", "dma200"], log: false });
  const [sheet, setSheet] = useState<null | "type" | "layers" | "cmp">(null);
  const [legend, setLegend] = useState<LegendData | null>(null);
  const [themeKey, setThemeKey] = useState(0);
  const [full, setFull] = useState(false);
  const [canFull, setCanFull] = useState(false);
  // The company chart's own switches, same defaults.
  const [peWin, setPeWin] = useState("ttm");
  const [showQ, setShowQ] = useState(false);
  // Events are on by default in the full view - the owner chose to see them.
  const [showDates, setShowDates] = useState(true);
  const [showChg, setShowChg] = useState(true);
  const [epsCmp, setEpsCmp] = useState<"yoy" | "prev">("yoy");
  const [showCA, setShowCA] = useState(true);
  const [shadeQ, setShadeQ] = useState(true);
  const [evPop, setEvPop] = useState<{ title: string; items: { text: string; sub?: string; color: string }[] } | null>(null);
  const [caOn, setCaOn] = useState<Record<string, boolean>>({ dividend: true, bonus: true, split: true, rights: true, buyback: true, other: true });
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [cmpSym, setCmpSym] = useState<string | null>(null);
  const [cmpFile, setCmpFile] = useState<ChartFile | null>(null);
  const [cmpCo, setCmpCo] = useState<Company | null>(null);
  const [cmpErr, setCmpErr] = useState<string | null>(null);
  const [cmpQ, setCmpQ] = useState("");
  const [vis, setVis] = useState<{ from: number; to: number } | null>(null);

  useEffect(() => { setPrefs(loadPrefs()); }, []);
  const savePrefs = (p: Prefs) => {
    setPrefs(p);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode */ }
  };

  useEffect(() => {
    if (!symbol) return;
    let live = true;
    setFile(null); setCompany(null); setError(null);
    fetch(`${BASE}/charts/${encodeURIComponent(symbol)}.json`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: ChartFile) => { if (live) setFile(d); })
      .catch(() => { if (live) setError("No price history is published for this company yet."); });
    // The valuation views, results and corporate actions live in the company
    // file the company page already uses.
    fetch(`${BASE}/companies/${encodeURIComponent(symbol)}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Company | null) => { if (live && d) setCompany(d); })
      .catch(() => {});
    loadIndex().then((d) => {
      if (!live) return;
      setIndex(d.rows.map((r) => ({ symbol: String(r.symbol), name: String(r.name ?? ""), mcap: Number(r.mcap ?? 0) })));
    }).catch(() => {});
    return () => { live = false; };
  }, [symbol]);

  useEffect(() => {
    if (!cmpSym) { setCmpFile(null); setCmpCo(null); setCmpErr(null); return; }
    let live = true;
    setCmpErr(null);
    Promise.all([
      fetch(`${BASE}/charts/${encodeURIComponent(cmpSym)}.json`).then((r) => (r.ok ? r.json() : null)),
      fetch(`${BASE}/companies/${encodeURIComponent(cmpSym)}.json`).then((r) => (r.ok ? r.json() : null)),
    ]).then(([f, c]) => {
      if (!live) return;
      if (!f && !c) { setCmpErr(`No data for ${cmpSym}`); setCmpSym(null); return; }
      setCmpFile(f); setCmpCo(c);
    }).catch(() => { if (live) setCmpErr(`No data for ${cmpSym}`); });
    return () => { live = false; };
  }, [cmpSym]);

  useEffect(() => {
    const mo = new MutationObserver(() => setThemeKey((k) => k + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-shade", "data-accent"] });
    setCanFull(!!document.fullscreenEnabled);
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => { mo.disconnect(); document.removeEventListener("fullscreenchange", onFs); };
  }, []);

  const name = company?.snapshot?.name || index.find((r) => r.symbol === symbol)?.name || "";
  const exch = company?.exchange === "BSE" ? "BSE" : "NSE";
  const tq = company?.trend?.quarterly ?? null;
  const avail: Record<View, boolean> = {
    price: true, pe: !!company?.pe_band, sales: !!tq?.periods?.length,
    ev: !!company?.ev_band, pb: !!company?.pb_band, ps: !!company?.ps_band,
  };

  // How far back each candle size reaches, for greying out the ones that
  // cannot cover the chosen range.
  const span = useMemo(() => {
    const s = (rows?: Row[]) => (rows && rows.length > 1 ? rows[rows.length - 1][0] - rows[0][0] : 0);
    return { d: s(file?.d), w: s(file?.w), m: s(file?.m) } as Record<Interval, number>;
  }, [file]);
  const rangeDays = (r: Range, last: number) => {
    if (r !== "YTD") return RANGE_DAYS[r];
    const y = new Date(last * DAY * 1000).getUTCFullYear();
    return last - Math.floor(Date.UTC(y, 0, 1) / 1000 / DAY);
  };
  const lastDaily = file?.d?.[file.d.length - 1]?.[0] ?? file?.w?.[file.w.length - 1]?.[0] ?? 0;
  const covers = (iv: Interval, r: Range) => {
    if (!file?.[iv]?.length) return false;
    if (r === "MAX") return span[iv] >= Math.max(span.d, span.w, span.m) - 45;
    return span[iv] + 10 >= rangeDays(r, lastDaily);
  };
  const pickRange = (r: Range) => {
    setRange(r);
    kept.current = null;
    if (view === "price") {
      const next = covers(AUTO[r], r) ? AUTO[r] : (["d", "w", "m"] as Interval[]).find((iv) => covers(iv, r)) ?? "m";
      setIv(next);
    }
  };
  const pickView = (v: View) => {
    setView(v);
    kept.current = null;
    // Valuation series are monthly and start years back; a daily window of a
    // monthly line is three points. Open them on five years, as the company
    // chart does.
    if (v !== "price" && ["1M", "3M", "6M", "YTD", "1Y"].includes(range)) setRange("5Y");
  };

  // One rule, checked after every change rather than on each path that can
  // break it: the candle size on screen must cover the range on screen.
  // PE -> Price used to leave daily candles under a "5Y" label, because the
  // valuation views move the range and only the price view moved the candle.
  useEffect(() => {
    if (view !== "price" || !file || covers(interval, range)) return;
    const next = covers(AUTO[range], range) ? AUTO[range] : (["d", "w", "m"] as Interval[]).find((iv) => covers(iv, range)) ?? "m";
    if (next !== interval) { kept.current = null; setIv(next); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, range, interval, file]);

  const isHidden = (k: string) => !!hidden[`${view}:${k}`];

  /* Build the chart. Rebuilt whole on any change; the window you were looking
     at is carried across so switching a layer does not lose your zoom. */
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !file) return;
    const p = palette();
    const onInd = new Set(prefs.inds);
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: p.bg }, textColor: p.ink3, fontSize: 11, fontFamily: p.font,
        panes: { separatorColor: p.line, separatorHoverColor: alpha(p.ink3, 0.25), enableResize: true },
      },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: alpha(p.ink3, 0.6), labelBackgroundColor: p.card2, style: LineStyle.Dashed },
        horzLine: { color: alpha(p.ink3, 0.6), labelBackgroundColor: p.card2, style: LineStyle.Dashed },
      },
      rightPriceScale: { borderColor: p.line, scaleMargins: { top: 0.1, bottom: 0.08 } },
      leftPriceScale: { borderColor: p.line },
      timeScale: { borderColor: p.line, rightOffset: 5, barSpacing: 7, minBarSpacing: 0.3, lockVisibleTimeRangeOnResize: true },
      localization: {
        locale: "en-IN",
        timeFormatter: (t: Time) => dateOf(Math.round((t as number) / DAY), view === "price" && interval !== "m" ? "day" : "month"),
      },
      handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
      handleScroll: { horzTouchDrag: true, vertTouchDrag: false, mouseWheel: true, pressedMouseMove: true },
    });
    chartRef.current = chart;
    const cleanups: (() => void)[] = [];
    const fmt = (f: (x: number) => string) => ({ type: "custom" as const, formatter: f, minMove: 0.01 });
    const line = (color: string, width: 1 | 2 = 2, dashed = false, pane = 0, curved = false) =>
      chart.addSeries(LineSeries, {
        color, lineWidth: width, lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        lineType: curved ? LineType.Curved : LineType.Simple,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      }, pane);
    const pts = (days: number[], vals: (number | null)[]) =>
      vals.flatMap((x, i) => (x === null || x === undefined ? [] : [{ time: toTime(days[i]), value: x }]));

    let anchor: ISeriesApi<SeriesType> | null = null;   // the series events attach to
    let anchorDays: number[] = [];
    let legendAt: (day: number | null) => LegendData | null = () => null;
    let keyWin = `${view}`;

    if (view === "price") {
      keyWin = `price:${interval}`;
      const rows = file[interval] ?? [];
      if (!rows.length) { chart.remove(); chartRef.current = null; return; }
      const days = rows.map((r) => r[0]);
      const closes = rows.map((r) => r[4]);
      const comparing = !!cmpFile;
      // Room at the foot of the price pane for the timeline band, when there
      // is anything to put in it.
      const stripOn = (showCA && (company?.actions?.length ?? 0) > 0) || (showDates && (company?.quarters?.length ?? 0) > 0);
      chart.priceScale("right").applyOptions({
        mode: comparing ? PriceScaleMode.Percentage : prefs.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: { top: 0.08, bottom: (onInd.has("vol") ? 0.22 : 0.06) + (stripOn ? 0.1 : 0) },
      });
      const ohlc = (rs: Row[]) => rs.map(([t, o, h, l, c]) => ({ time: toTime(t), open: o, high: h, low: l, close: c }));
      const value = (rs: Row[]) => rs.map(([t, , , , c]) => ({ time: toTime(t), value: c }));
      let main: ISeriesApi<SeriesType>;
      const pf = fmt(axis);
      switch (prefs.kind) {
        case "bars":
          main = chart.addSeries(BarSeries, { upColor: p.pos, downColor: p.neg, thinBars: false, priceFormat: pf });
          main.setData(ohlc(rows)); break;
        case "line":
          main = chart.addSeries(LineSeries, { color: p.accent, lineWidth: 2, priceFormat: pf });
          main.setData(value(rows)); break;
        case "area":
          main = chart.addSeries(AreaSeries, {
            lineColor: p.accent, lineWidth: 2, topColor: alpha(p.accent, 0.3), bottomColor: alpha(p.accent, 0), priceFormat: pf,
          });
          main.setData(value(rows)); break;
        case "hollow":
          main = chart.addSeries(CandlestickSeries, {
            upColor: "rgba(0, 0, 0, 0)", downColor: p.neg, borderVisible: true, priceFormat: pf,
            borderUpColor: p.pos, borderDownColor: p.neg, wickUpColor: p.pos, wickDownColor: p.neg,
          });
          main.setData(ohlc(rows)); break;
        default:
          main = chart.addSeries(CandlestickSeries, {
            upColor: p.pos, downColor: p.neg, borderVisible: false, wickUpColor: p.pos, wickDownColor: p.neg, priceFormat: pf,
          });
          main.setData(ohlc(prefs.kind === "heikin" ? heikinAshi(rows) : rows));
      }
      anchor = main; anchorDays = days;

      // A comparison is drawn as percentage change from the left edge of the
      // window - two share prices in rupees have no common scale. Averages
      // mean nothing once rebased, so they step aside, as on the company chart.
      let peerRows: Row[] = [];
      if (comparing && cmpFile) {
        peerRows = cmpFile[interval] ?? cmpFile.w ?? cmpFile.m ?? [];
        const s = line(p.alt, 2);
        s.setData(peerRows.map(([t, , , , c]) => ({ time: toTime(t), value: c })));
      }
      const [w50, w200] = DMA_BARS[interval];
      const d50 = sma(closes, w50), d200 = sma(closes, w200), s20 = sma(closes, 20), e21 = ema(closes, 21);
      const bb = bollinger(closes), r14 = rsi(closes);
      if (!comparing) {
        if (onInd.has("dma50")) line(p.dma50, 2).setData(pts(days, d50));
        if (onInd.has("dma200")) line(p.dma200, 2).setData(pts(days, d200));
        if (onInd.has("sma20")) line(FIXED.sma20!, 2).setData(pts(days, s20));
        if (onInd.has("ema21")) line(FIXED.ema21!, 2).setData(pts(days, e21));
        if (onInd.has("bb")) {
          line(alpha(p.ink3, 0.9), 1, true).setData(pts(days, bb.up));
          line(alpha(p.ink3, 0.6), 1).setData(pts(days, bb.mid));
          line(alpha(p.ink3, 0.9), 1, true).setData(pts(days, bb.lo));
        }
      }
      if (onInd.has("vol")) {
        const v = chart.addSeries(HistogramSeries, {
          priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false,
        });
        chart.priceScale("vol").applyOptions({ scaleMargins: stripOn ? { top: 0.74, bottom: 0.08 } : { top: 0.82, bottom: 0 } });
        v.setData(rows.map(([t, o, , , c, vv]) => ({ time: toTime(t), value: vv, color: alpha(c >= o ? p.pos : p.neg, 0.45) })));
      }
      if (onInd.has("rsi")) {
        const r = line(FIXED.rsi!, 2, false, 1);
        r.setData(pts(days, r14));
        for (const lvl of [70, 30]) {
          r.createPriceLine({ price: lvl, color: alpha(p.ink3, 0.7), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
        }
        chart.panes()[0]?.setStretchFactor(3);
        chart.panes()[1]?.setStretchFactor(1);
      }
      const peerDays = peerRows.map((r) => r[0]);
      legendAt = (day) => {
        const i = day === null ? rows.length - 1 : atOrBefore(days, day);
        const [t, o, h, l, c, vv] = rows[i];
        const prev = i > 0 ? rows[i - 1][4] : null;
        const items: LItem[] = [];
        if (onInd.has("vol")) items.push({ label: "Vol", value: vol(vv) });
        const add = (on: boolean, label: string, arr: (number | null)[], color: string, f = price) => {
          const x = arr[i];
          if (on && x !== null && x !== undefined) items.push({ label, value: f(x), color });
        };
        if (!comparing) {
          add(onInd.has("dma50"), "50 DMA", d50, p.dma50);
          add(onInd.has("dma200"), "200 DMA", d200, p.dma200);
          add(onInd.has("sma20"), "SMA 20", s20, FIXED.sma20!);
          add(onInd.has("ema21"), "EMA 21", e21, FIXED.ema21!);
        }
        add(onInd.has("rsi"), "RSI", r14, FIXED.rsi!, (x) => x.toFixed(1));
        if (comparing && peerRows.length && cmpSym) {
          const j = atOrBefore(peerDays, t);
          items.push({ label: cmpSym, value: `₹${price(peerRows[j][4])}`, color: p.alt });
        }
        return {
          date: dateOf(t, interval === "m" ? "month" : "day"),
          tag: `${interval === "d" ? "Daily" : interval === "w" ? "Weekly" : "Monthly"} · Price on ${exch}`,
          ohlc: [o, h, l, c], pct: prev ? ((c - prev) / prev) * 100 : null, items,
        };
      };
    } else if (view === "sales") {
      if (!tq) { chart.remove(); chartRef.current = null; return; }
      const qd = tq.periods.map(dayOf);
      const sales = tq.revenue;
      chart.applyOptions({ leftPriceScale: { visible: !isHidden("sales"), borderColor: p.line, scaleMargins: { top: 0.35, bottom: 0 } } });
      const s = chart.addSeries(HistogramSeries, {
        priceScaleId: "left", priceLineVisible: false, lastValueVisible: false, priceFormat: fmt((x) => Math.round(x).toLocaleString("en-IN")),
        visible: !isHidden("sales"),
      });
      s.setData(pts(qd, sales).map((d) => ({ ...d, color: alpha(p.bar, 0.8) })));
      const pctFmt = fmt((x) => `${Math.round(x)}%`);
      const margin = (k: "gpm" | "opm" | "npm", color: string) => {
        const arr = tq[k] ?? [];
        const m = chart.addSeries(LineSeries, {
          color, lineWidth: 2, lineType: LineType.Curved, priceFormat: pctFmt,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: !isHidden(k),
        });
        m.setData(pts(qd, arr));
        return arr;
      };
      const g = margin("gpm", p.gpm), o = margin("opm", p.opm), n = margin("npm", p.npm);
      anchor = s; anchorDays = qd;
      legendAt = (day) => {
        const i = day === null ? qd.length - 1 : atOrBefore(qd, day);
        const items: LItem[] = [];
        if (!isHidden("sales") && sales[i] != null) items.push({ label: "Sales", value: crore(sales[i] as number), color: p.bar });
        if (!isHidden("gpm") && g[i] != null) items.push({ label: "GPM", value: `${(g[i] as number).toFixed(1)}%`, color: p.gpm });
        if (!isHidden("opm") && o[i] != null) items.push({ label: "OPM", value: `${(o[i] as number).toFixed(1)}%`, color: p.opm });
        if (!isHidden("npm") && n[i] != null) items.push({ label: "NPM", value: `${(n[i] as number).toFixed(1)}%`, color: p.npm });
        return { date: `Quarter ended ${dateOf(qd[i], "month")}`, items };
      };
    } else {
      // A valuation band: the ratio, its five-year median, and the figure it
      // is a multiple of in its own pane underneath - the company chart's
      // three layers, drawn the same way and from the same numbers.
      const band0 = view === "pe" ? company?.pe_band : view === "ev" ? company?.ev_band : view === "pb" ? company?.pb_band : company?.ps_band;
      if (!band0) { chart.remove(); chartRef.current = null; return; }
      keyWin = `${view}:${peWin}`;
      let series = band0.series;
      let median = band0.median_5y;
      if (view === "pe" && peWin !== "ttm" && band0.alt?.[peWin]) {
        const alt = band0.alt[peWin];
        series = band0.series.map((q, i) => [q[0], alt[i]] as [string, number | null])
          .filter((q): q is [string, number] => q[1] !== null && q[1] !== undefined);
        median = band0.alt_median_5y?.[peWin] ?? median;
      }
      const bd = series.map((q) => dayOf(q[0]));
      const bv = series.map((q) => q[1]);
      const rf = fmt(ratio);
      const main = chart.addSeries(LineSeries, {
        color: p.accent, lineWidth: 2, priceFormat: rf, lastValueVisible: true, priceLineVisible: false,
        visible: !isHidden("line"),
      });
      main.setData(bd.map((d, i) => ({ time: toTime(d), value: bv[i] })));
      if (!isHidden("median")) {
        main.createPriceLine({
          price: median, color: p.axisCol, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true,
          title: `Median ${ratio(median)}`,
        });
      }
      anchor = main; anchorDays = bd;

      // The peer's own ratio on the same axis - the company chart's comparison.
      const peerBand = view === "pe" ? cmpCo?.pe_band : view === "ev" ? cmpCo?.ev_band : view === "pb" ? cmpCo?.pb_band : cmpCo?.ps_band;
      const peerDays = peerBand?.series.map((q) => dayOf(q[0])) ?? [];
      if (peerBand) {
        const s = line(p.alt, 2);
        s.applyOptions({ priceFormat: rf });
        s.setData(peerBand.series.map((q) => ({ time: toTime(dayOf(q[0])), value: q[1] })));
      }

      // The figure underneath, exactly as the company chart builds it.
      const bars: Bar[] = [];
      let barLabel = "";
      let barFmt = (x: number) => `₹${price(x)}`;
      if (tq) {
        const periods = tq.periods;
        const ttm = (arr?: (number | null)[]) => {
          if (!arr) return;
          for (let i = 3; i < periods.length; i++) {
            const w = arr.slice(i - 3, i + 1);
            if (w.every((x) => x !== null && x !== undefined)) bars.push({ day: dayOf(periods[i]), v: (w as number[]).reduce((a, b) => a + b, 0) });
          }
        };
        if (view === "pe") {
          const nQ = peWin === "q1" ? 1 : 4, mult = peWin === "q1" ? 4 : 1;
          for (let i = nQ - 1; i < periods.length; i++) {
            const w = tq.eps.slice(i - nQ + 1, i + 1);
            if (w.length !== nQ || !w.every((x) => x !== null && x !== undefined)) continue;
            const end = periods[i];
            const qi = company?.quarters?.find((x) => x.end === end);
            const mo = Number(end.slice(5, 7));
            const derivedQ = ({ 6: 1, 9: 2, 12: 3, 3: 4 } as Record<number, number>)[mo] ?? Math.floor((mo - 1) / 3) + 1;
            bars.push({ day: dayOf(end), v: (w as number[]).reduce((a, b) => a + b, 0) * mult, q: qi?.q ?? derivedQ, announced: qi?.announced ?? null });
          }
          // Growth over the whole series, then shown - so a figure never
          // changes when you zoom.
          const back = epsCmp === "yoy" ? 4 : 1;
          bars.forEach((b, i) => { b.chg = i >= back ? growth(b.v, bars[i - back].v) : { kind: "none" }; });
          barLabel = peWin === "ttm" ? "EPS (4Q)" : "EPS (1Q×4)";
        } else if (view === "ev") { ttm(tq.ebitda); barLabel = "EBITDA (TTM)"; barFmt = crore; }
        else if (view === "ps") { ttm(tq.revenue); barLabel = "Sales (TTM)"; barFmt = crore; }
        else {
          periods.forEach((d, i) => { const x = tq.book_value?.[i]; if (x !== null && x !== undefined) bars.push({ day: dayOf(d), v: x }); });
          barLabel = "Book value";
        }
      }
      const barDays = bars.map((b) => b.day);
      if (bars.length && !isHidden("bars")) {
        const bs = chart.addSeries(HistogramSeries, {
          priceLineVisible: false, lastValueVisible: false, priceFormat: fmt((x) => (view === "ev" || view === "ps" ? Math.round(x).toLocaleString("en-IN") : ratio(x))),
        }, 1);
        const colour = (b: Bar) => {
          const base = showQ && view === "pe" && b.q ? p.q[b.q] ?? p.vol : p.vol;
          return alpha(base, b.v < 0 ? 0.55 : 0.85);
        };
        bs.setData(bars.map((b) => ({ time: toTime(b.day), value: b.v, color: colour(b) })));
        chart.panes()[0]?.setStretchFactor(3);
        chart.panes()[1]?.setStretchFactor(1.3);
        if (view === "pe" && showChg) {
          // All or none, like the company chart: labels only when every bar on
          // screen has room for one, otherwise a thinned row reads as missing data.
          const all: SeriesMarker<Time>[] = bars
            .filter((b) => b.chg && b.chg.kind !== "none")
            .map((b) => ({
              time: toTime(b.day), position: b.v < 0 ? "belowBar" : "aboveBar", shape: "circle",
              size: 0, color: growthCol(b.chg, p), text: growthText(b.chg),
            }));
          const api = createSeriesMarkers(bs, []);
          const fit = () => {
            const vr = chart.timeScale().getVisibleRange();
            if (!vr) return;
            const f = Math.round((vr.from as number) / DAY), t = Math.round((vr.to as number) / DAY);
            const n = barDays.filter((d) => d >= f && d <= t).length;
            api.setMarkers(n > 0 && el.clientWidth / n >= 34 ? all : []);
          };
          chart.timeScale().subscribeVisibleTimeRangeChange(fit);
          cleanups.push(() => chart.timeScale().unsubscribeVisibleTimeRangeChange(fit));
          requestAnimationFrame(fit);
        }
      }
      const names: Record<string, string> = { pe: "PE", ev: "EV/EBITDA", pb: "P/B", ps: "MCap/Sales" };
      legendAt = (day) => {
        const i = day === null ? bd.length - 1 : atOrBefore(bd, day);
        const items: LItem[] = [];
        if (!isHidden("line")) items.push({ label: names[view] + (view === "pe" && peWin !== "ttm" ? " (1Q×4)" : ""), value: ratio(bv[i]), color: p.accent });
        if (!isHidden("median")) items.push({ label: "Median", value: ratio(median) });
        if (bars.length && !isHidden("bars")) {
          const j = atOrBefore(barDays, bd[i]);
          const b = bars[j];
          const g = b.chg && b.chg.kind !== "none" ? ` ${growthText(b.chg)}` : "";
          items.push({ label: barLabel, value: barFmt(b.v) + g, color: b.chg ? growthCol(b.chg, p) : undefined });
        }
        if (peerBand && cmpSym && peerDays.length) {
          const j = atOrBefore(peerDays, bd[i]);
          items.push({ label: cmpSym, value: ratio(peerBand.series[j][1]), color: p.alt });
        }
        // The breakdown behind the ratio, on the trailing basis it was filed on.
        // A 1Q×4 figure has no such breakdown, so none is offered for it.
        const idx0 = view === "pe" && peWin !== "ttm" ? -1 : band0.series.findIndex((q) => dayOf(q[0]) === bd[i]);
        const working = idx0 >= 0 ? workingFor(view, band0, idx0, company?.quarters) : null;
        return { date: dateOf(bd[i], "month"), items, working };
      };
    }

    // Result dates and corporate actions. Collected once, then drawn in the
    // chosen style - and listed in the legend for the bar under the finger in
    // every style, so the details are never only in a label that may overlap.
    type Ev = { day: number; kind: "ca" | "res"; tag: string; label: string; text: string; sub?: string; color: string };
    const evs: Ev[] = [];
    let tl: TimelineMarks | null = null;
    if (anchor && anchorDays.length) {
      if (showCA) {
        for (const a of company?.actions ?? []) {
          const k = CA_LABEL[a.kind] ? a.kind : "other";
          if (!caOn[k]) continue;
          const d = snap(anchorDays, dayOf(a.date));
          if (d === null) continue;
          const label = a.detail ? `${CA_LABEL[k]} ${a.detail}` : CA_LABEL[k];
          evs.push({
            day: d, kind: "ca", tag: caTag(k, a.detail), label,
            text: `${label} · ex-date ${dateOf(dayOf(a.date))}`, sub: a.subject ?? undefined, color: p.ca[k],
          });
        }
      }
      if (showDates) {
        for (const q of company?.quarters ?? []) {
          if (!q.announced) continue;
          const d = snap(anchorDays, dayOf(q.announced));
          if (d === null) continue;
          evs.push({ day: d, kind: "res", tag: `Q${q.q}`, label: `Q${q.q} results`, text: `${Q_LABEL[q.q] ?? `Q${q.q}`} results declared ${dateOf(dayOf(q.announced))}`, color: p.q[q.q] ?? p.q[1] });
        }
      }
      evs.sort((x, y) => x.day - y.day);

      // 1. Quarters as tinted blocks behind the chart, first candle of each
      //    fiscal quarter to its last. The series only carries the layer.
      if (shadeQ) {
        const spans: QSpan[] = [];
        for (const d of anchorDays) {
          const dt = new Date(d * DAY * 1000);
          const m = dt.getUTCMonth() + 1;
          const q = fyQ(m);
          const key = (m >= 4 ? dt.getUTCFullYear() : dt.getUTCFullYear() - 1) * 10 + q;
          const last = spans[spans.length - 1];
          if (last && last.key === key) last.to = d;
          else spans.push({ key, from: d, to: d, color: alpha(p.q[q], 0.1) });
        }
        const sh = chart.addSeries(LineSeries, {
          priceScaleId: "shade", color: "rgba(0, 0, 0, 0)", lineVisible: false, priceLineVisible: false,
          lastValueVisible: false, crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => ({ priceRange: { minValue: -1, maxValue: 1 } }),
        });
        chart.priceScale("shade").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
        sh.setData(anchorDays.map((d) => ({ time: toTime(d), value: 0 })));
        sh.attachPrimitive(new QuarterBands(spans));
      }
      if (evs.length) {
        // 2. A faint line through the whole chart on each event date - a
        //    full-height bar on a hidden axis, also behind the chart.
        const ln = chart.addSeries(HistogramSeries, { priceScaleId: "ev", priceLineVisible: false, lastValueVisible: false, base: 0 });
        chart.priceScale("ev").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
        const seen = new Map<number, string>();
        for (const e of evs) if (!seen.has(e.day)) seen.set(e.day, e.color);
        ln.setData([...seen].map(([d, c]) => ({ time: toTime(d), value: 1, color: alpha(c, 0.35) })));
        ln.setSeriesOrder(shadeQ ? 1 : 0);
        // 3. The timeline band along the foot. An axis of its own with a fixed
        //    range, so a row of identical values still has somewhere to sit (a
        //    separate pane got zero height and blanked the chart).
        const flat = chart.addSeries(LineSeries, {
          priceScaleId: "strip", color: "rgba(0, 0, 0, 0)", lineVisible: false, priceLineVisible: false,
          lastValueVisible: false, crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => ({ priceRange: { minValue: -1, maxValue: 1 } }),
        });
        chart.priceScale("strip").applyOptions({ scaleMargins: { top: 0.93, bottom: 0.02 }, visible: false });
        flat.setData(anchorDays.map((d) => ({ time: toTime(d), value: 0 })));
        const marks: TlMark[] = [];
        for (const e of evs) {
          const v: TlEv = { kind: e.kind, tag: e.tag, color: e.color };
          const last = marks[marks.length - 1];
          if (last && last.day === e.day) last.evs.push(v);
          else marks.push({ day: e.day, evs: [v] });
        }
        tl = new TimelineMarks(marks, p);
        flat.attachPrimitive(tl);
        // Keep the lines and the chart itself clear of the band.
        if (view !== "price") {
          const m = chart.priceScale("right").options().scaleMargins;
          chart.priceScale("right").applyOptions({ scaleMargins: { top: m.top, bottom: Math.max(0.12, m.bottom) } });
        }
        if (view === "sales") chart.priceScale("left").applyOptions({ scaleMargins: { top: 0.35, bottom: 0.1 } });
      }
    }
    const evAt = new Map<number, { text: string; color: string }[]>();
    for (const e of evs) evAt.set(e.day, [...(evAt.get(e.day) ?? []), { text: e.text, color: e.color }]);
    if (evAt.size) {
      const base = legendAt;
      legendAt = (day) => {
        const d = base(day);
        if (!d || !anchorDays.length) return d;
        const at = day === null ? anchorDays[anchorDays.length - 1] : anchorDays[atOrBefore(anchorDays, day)];
        const e = evAt.get(at);
        return e ? { ...d, events: e } : d;
      };
    }
    if (anchorDays.length) spanRef.current = { first: anchorDays[0], last: anchorDays[anchorDays.length - 1] };

    createTextWatermark(chart.panes()[0], {
      horzAlign: "center", vertAlign: "center",
      lines: [{ text: symbol, color: alpha(p.ink3, 0.09), fontSize: 56, fontStyle: "bold", fontFamily: p.font }],
    });

    // The window: the one you were looking at if nothing structural changed,
    // otherwise the chosen range.
    const k = kept.current;
    if (k && k.key === keyWin) {
      chart.timeScale().setVisibleRange({ from: k.from as UTCTimestamp, to: k.to as UTCTimestamp });
    } else if (anchorDays.length) {
      const last = anchorDays[anchorDays.length - 1];
      const days = rangeDays(range, last);
      if (!Number.isFinite(days) || last - days <= anchorDays[0]) chart.timeScale().fitContent();
      else chart.timeScale().setVisibleRange({ from: toTime(last - days), to: toTime(last) });
    }

    let visTimer: ReturnType<typeof setTimeout> | null = null;
    const onVis = () => {
      if (visTimer) clearTimeout(visTimer);
      visTimer = setTimeout(() => {
        const vr = chart.timeScale().getVisibleRange();
        if (vr) setVis({ from: Math.round((vr.from as number) / DAY), to: Math.round((vr.to as number) / DAY) });
      }, 150);
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(onVis);
    onVis();

    setLegend(legendAt(null));
    const onMove = (e: MouseEventParams<Time>) => {
      setLegend(legendAt(e.time === undefined ? null : Math.round((e.time as number) / DAY)));
    };
    chart.subscribeCrosshairMove(onMove);

    // A tap on a marker in the timeline band opens its events. The layer names
    // the marker it hit; for a fingertip, anything within 16px of a marker in
    // the band counts too - the markers are smaller than a finger.
    const evByDay = new Map<number, typeof evs>();
    for (const e of evs) evByDay.set(e.day, [...(evByDay.get(e.day) ?? []), e]);
    const onClick = (param: MouseEventParams<Time>) => {
      if (!evByDay.size || !param.point) return;
      let days: number[] | null = null;
      const id = param.hoveredObjectId;
      if (typeof id === "string" && id.startsWith("ev:")) days = id.slice(3).split(",").map(Number);
      else if (tl && (param.paneIndex === undefined || param.paneIndex === 0)) days = tl.near(param.point.x, param.point.y);
      const list = [...new Set(days ?? [])].flatMap((d) => evByDay.get(d) ?? []);
      if (!list.length) return;
      setEvPop({
        title: list.length === 1 ? list[0].label : `${list.length} events`,
        items: list.map((e) => ({ text: e.text, sub: e.sub, color: e.color })),
      });
    };
    chart.subscribeClick(onClick);

    return () => {
      const vr = chart.timeScale().getVisibleRange();
      if (vr) kept.current = { key: keyWin, from: vr.from as number, to: vr.to as number };
      if (visTimer) clearTimeout(visTimer);
      cleanups.forEach((f) => f());
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onVis);
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      chart.remove();
      chartRef.current = null;
    };
    // `range` is applied below without a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, company, view, interval, prefs, peWin, showQ, showDates, showChg, epsCmp, showCA, caOn, hidden, cmpFile, cmpCo, cmpSym, themeKey, symbol, shadeQ]);

  const applyRange = () => {
    const chart = chartRef.current, sp = spanRef.current;
    if (!chart || !sp) return;
    const days = rangeDays(range, sp.last);
    if (!Number.isFinite(days) || sp.last - days <= sp.first) chart.timeScale().fitContent();
    else chart.timeScale().setVisibleRange({ from: toTime(sp.last - days), to: toTime(sp.last) });
  };
  // A new range moves the window; it does not rebuild the chart.
  useEffect(() => {
    applyRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const back = () => {
    const from = sessionStorage.getItem("rs_chart_from");
    if (from && from.includes(`s=${encodeURIComponent(symbol)}`)) router.back();
    else router.replace(`/company?s=${encodeURIComponent(symbol)}`);
  };
  const toggleFull = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        await document.documentElement.requestFullscreen();
        await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape").catch(() => {});
      }
    } catch { /* not supported in this browser */ }
  };
  const resetView = () => {
    kept.current = null;
    applyRange();
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
  };

  // The day's move, from the daily series whatever is on screen.
  const daily = file?.d ?? [];
  const lastD = daily[daily.length - 1], prevD = daily[daily.length - 2];
  const dayChg = lastD && prevD ? lastD[4] - prevD[4] : null;

  // Ratio lines start where four consecutive filed quarters first exist, often
  // years after the price. Said, so a short line is not read as a young company.
  const ratioNote = (() => {
    if (view === "price" || view === "sales") return null;
    const band = view === "pe" ? company?.pe_band : view === "ev" ? company?.ev_band : view === "pb" ? company?.pb_band : company?.ps_band;
    const start = band?.series?.[0]?.[0];
    const priceStart = file?.m?.[0]?.[0];
    if (!start || priceStart === undefined) return null;
    if ((dayOf(start) - priceStart) / 365.25 < 1.5) return null;
    return { start: dayOf(start), priceStart };
  })();

  const L = legend;
  const tone = (x: number | null | undefined) => (x == null ? "text-[var(--ink2)]" : x >= 0 ? "text-[var(--pos)]" : "text-[var(--neg)]");
  const indOn = (k: Ind) => prefs.inds.includes(k);
  const kindLabel = KINDS.find(([k]) => k === prefs.kind)?.[1] ?? "Candles";
  const nLayers = view === "price"
    ? prefs.inds.length + (showCA ? 1 : 0) + (showDates ? 1 : 0)
    : (showCA ? 1 : 0) + (showDates ? 1 : 0) + (showQ ? 1 : 0);
  // Counted against the chart's window as it is NOW, read when the sheet
  // renders. A copy kept in state lagged a step behind a range change, so the
  // sheet said "2 in view" over a chart showing 4.
  const caCount: Record<string, number> = {};
  // eslint-disable-next-line react-hooks/refs
  const vr = sheet ? chartRef.current?.timeScale().getVisibleRange() : null;
  const win = vr ? { from: Math.round((vr.from as number) / DAY), to: Math.round((vr.to as number) / DAY) } : vis;
  for (const a of company?.actions ?? []) {
    const k = CA_LABEL[a.kind] ? a.kind : "other";
    const d = dayOf(a.date);
    if (!win || (d >= win.from && d <= win.to)) caCount[k] = (caCount[k] ?? 0) + 1;
  }
  const peerList = (company?.peers ?? [])
    .map((q) => ({ sym: String(q.symbol ?? ""), nm: String(q.name ?? q.symbol ?? "") }))
    .filter((q) => q.sym && q.sym !== symbol);
  const hits = (() => {
    const q = cmpQ.trim().toLowerCase();
    if (!q) return [];
    return index
      .map((c) => {
        const s = c.symbol.toLowerCase(), n = c.name.toLowerCase();
        const sc = s.startsWith(q) ? 0 : n.startsWith(q) ? 1 : n.includes(` ${q}`) ? 2 : s.includes(q) || n.includes(q) ? 3 : 9;
        return [sc, c] as const;
      })
      .filter(([sc, c]) => sc < 9 && c.symbol !== symbol)
      .sort((a, b) => a[0] - b[0] || b[1].mcap - a[1].mcap)
      .slice(0, 12)
      .map(([, c]) => c);
  })();

  const pill = (active: boolean, disabled = false) =>
    `shrink-0 min-h-[34px] px-2 rounded-lg text-[13px] font-semibold tabular-nums transition-colors ${
      disabled ? "text-[var(--ink3)] opacity-35"
        : active ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`;
  const indColour = (k: Ind) =>
    k === "dma50" ? "var(--chart-dma50)" : k === "dma200" ? "var(--chart-dma200)" : k === "vol" ? "var(--chart-vol)" : FIXED[k] ?? "var(--ink3)";

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--bg)] text-[var(--ink)] select-none">
      <header className="shrink-0 flex items-center gap-2 px-2 pt-[env(safe-area-inset-top)] h-[calc(52px+env(safe-area-inset-top))] border-b border-[var(--line)]">
        <button onClick={back} aria-label="Back" className="rs-press w-10 h-10 rounded-full flex items-center justify-center text-[var(--ink2)] active:bg-[var(--card2)]">
          <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight truncate">
            {symbol}
            <span className="ml-1.5 text-[10px] font-semibold rounded px-1 py-0.5 bg-[var(--card2)] text-[var(--ink3)] align-middle">{exch}</span>
            {name && <span className="ml-1.5 text-xs font-medium text-[var(--ink3)]">{name}</span>}
          </p>
          {lastD && (
            <p className="text-xs leading-tight tabular-nums">
              <span className="font-semibold text-[var(--ink)]">₹{price(lastD[4])}</span>
              {dayChg !== null && prevD && (
                <span className={`ml-1.5 font-medium ${tone(dayChg)}`}>
                  {dayChg >= 0 ? "+" : ""}{price(dayChg)} ({dayChg >= 0 ? "+" : ""}{((dayChg / prevD[4]) * 100).toFixed(2)}%)
                </span>
              )}
              <span className="ml-1.5 text-[var(--ink3)]">
                · {new Date(lastD[0] * DAY * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" })}
              </span>
            </p>
          )}
        </div>
        {canFull && (
          <button onClick={toggleFull} aria-label={full ? "Exit full screen" : "Full screen"} className="rs-press w-10 h-10 rounded-full flex items-center justify-center text-[var(--ink2)] active:bg-[var(--card2)]">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d={full ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"} />
            </svg>
          </button>
        )}
      </header>

      {/* What the chart shows: price, or one of the valuation views. */}
      <nav className="shrink-0 flex items-center gap-0.5 overflow-x-auto px-2 py-1 border-b border-[var(--line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {VIEWS.filter(([v]) => avail[v]).map(([v, label]) => (
          <button key={v} onClick={() => pickView(v)} className={`${pill(view === v)} whitespace-nowrap`}>{label}</button>
        ))}
        {cmpSym && (
          <span className="ml-auto shrink-0 inline-flex items-center gap-1 pl-2 text-xs text-[var(--ink3)] whitespace-nowrap">
            <i className="inline-block w-3 h-1 rounded-sm" style={{ background: "var(--chart-alt)" }} />
            vs {cmpSym}
            <button onClick={() => setCmpSym(null)} aria-label="Stop comparing" className="w-6 h-6 rounded-full flex items-center justify-center text-[var(--ink3)]">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </span>
        )}
      </nav>

      <div className="relative flex-1 min-h-0">
        <div ref={boxRef} className="absolute inset-0" />
        {L && (
          <div className="pointer-events-none absolute left-2 top-1.5 z-10 max-w-[calc(100%-72px)] text-[11px] leading-[1.35] tabular-nums">
            <p className="text-[var(--ink3)]">
              {L.date}{L.tag && <span className="ml-1.5">{L.tag}</span>}
            </p>
            {L.ohlc && (
              <p className="flex flex-wrap gap-x-2">
                {(["O", "H", "L", "C"] as const).map((k, j) => (
                  <span key={k}><span className="text-[var(--ink3)]">{k} </span><span className={tone(L.pct)}>{price(L.ohlc![j])}</span></span>
                ))}
                {L.pct != null && <span className={tone(L.pct)}>{L.pct >= 0 ? "+" : ""}{L.pct.toFixed(2)}%</span>}
              </p>
            )}
            <p className="flex flex-wrap gap-x-2">
              {L.items.map((it) => (
                <span key={it.label}>
                  <span className="text-[var(--ink3)]">{it.label} </span>
                  <span style={{ color: it.color ?? "var(--ink2)" }}>{it.value}</span>
                </span>
              ))}
              {L.working && L.working.length > 0 && (
                <span className="pointer-events-auto">
                  <InfoTip title={`How this was worked out · ${L.date}`} label="How this figure was worked out">
                    {L.working.map((r, i) => (
                      <p key={i} className="flex items-baseline gap-3 tabular-nums">
                        <span className="flex-1 whitespace-pre-wrap text-[var(--ink3)]">{r.label}</span>
                        <span className="font-medium text-[var(--ink)]">{r.value}</span>
                        {r.note && <span className="text-[11px] text-[var(--ink3)]">{r.note}</span>}
                      </p>
                    ))}
                  </InfoTip>
                </span>
              )}
            </p>
            {L.events && L.events.length > 0 && (
              <p className="flex flex-wrap gap-x-2">
                {L.events.map((e, i) => (
                  <span key={i} className="inline-flex items-center gap-1">
                    <i className="inline-block w-2 h-2 rounded-full" style={{ background: e.color }} />
                    <span className="text-[var(--ink2)]">{e.text}</span>
                  </span>
                ))}
              </p>
            )}
            {ratioNote && (
              <p className="pointer-events-auto text-[var(--ink3)]">
                Ratio from {dateOf(ratioNote.start, "month")}
                <InfoTip title="Why the ratio starts later than the price" className="ml-1">
                  <p>
                    This ratio starts {dateOf(ratioNote.start, "month")} though the price goes back
                    to {dateOf(ratioNote.priceStart, "month")}.
                  </p>
                  <p>
                    {company?.coverage?.from
                      ? `Earnings on record begin ${dateOf(dayOf(company.coverage.from), "month")}, and a trailing-twelve-month figure needs four consecutive quarters.`
                      : "Earlier earnings for this company have not been fetched yet, so the ratio cannot be computed that far back - it is missing data, not a gap in the business."}
                  </p>
                </InfoTip>
              </p>
            )}
          </div>
        )}
        {!file && !error && <div className="absolute inset-3 rs-skel" aria-busy="true" aria-label="Loading chart" />}
        {error && <p className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-[var(--ink3)]">{error}</p>}
      </div>

      <footer className="shrink-0 border-t border-[var(--line)] pb-[env(safe-area-inset-bottom)] flex flex-col [@media(max-height:500px)]:flex-row [@media(max-height:500px)]:items-center">
        <div className="flex items-center gap-0 overflow-x-auto px-1.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [@media(max-height:500px)]:flex-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => pickRange(r)} className={`${pill(range === r)} px-1.5`}>{r}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 px-2 pb-1.5 [@media(max-height:500px)]:pb-1 overflow-x-auto [scrollbar-width:none]">
          {view === "price" ? (
            <>
              <div role="radiogroup" aria-label="Candle size" className="flex items-center rounded-lg bg-[var(--card2)] p-0.5 shrink-0">
                {INTERVALS.map(([iv, label]) => {
                  const ok = covers(iv, range);
                  return (
                    <button key={iv} role="radio" aria-checked={interval === iv} disabled={!ok}
                      onClick={() => { kept.current = null; setIv(iv); }}
                      title={ok ? undefined : iv === "d" ? "Daily candles go back about two years" : "Weekly candles go back about five years"}
                      className={`min-h-[30px] w-8 rounded-md text-[13px] font-semibold ${
                        !ok ? "text-[var(--ink3)] opacity-35" : interval === iv ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>
                      {label}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => setSheet("type")} className={pill(prefs.log)}>{kindLabel}{prefs.log ? " · Log" : ""} ▾</button>
            </>
          ) : view === "pe" && company?.pe_band?.alt?.q1 ? (
            <Seg value={peWin} options={PE_WINDOWS.map(([k, label]) => [k, label] as [string, string])} onChange={(v) => { kept.current = null; setPeWin(v); }} />
          ) : null}
          <button onClick={() => setSheet("layers")} className={pill(nLayers > 0)}>
            {view === "price" ? "Indicators" : "Layers"}{nLayers > 0 ? ` · ${nLayers}` : ""}
          </button>
          <button onClick={() => setSheet("cmp")} className={pill(!!cmpSym)} aria-label="Compare with another company">
            <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] inline-block" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 4v16M17 4v16M4 8l3-4 3 4M14 16l3 4 3-4" />
            </svg>
          </button>
          <button onClick={resetView} className={`${pill(false)} ml-auto`} aria-label="Reset zoom" title="Reset zoom">
            <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5V9H9" />
            </svg>
          </button>
        </div>
      </footer>

      {sheet && (
        <div className="fixed inset-0 z-[70]" onClick={() => setSheet(null)}>
          <div className="rs-fade absolute inset-0 bg-black/50" />
          <div onClick={(e) => e.stopPropagation()}
            className="rs-sheet absolute bottom-0 inset-x-0 mx-auto max-w-md rounded-t-2xl border-t border-[var(--line)] bg-[var(--card)] p-2 pb-[calc(env(safe-area-inset-bottom)+10px)] max-h-[82vh] overflow-y-auto">

            {sheet === "type" && (
              <>
                <Head>Chart type</Head>
                {KINDS.map(([k, label]) => (
                  <button key={k} onClick={() => { savePrefs({ ...prefs, kind: k }); setSheet(null); }}
                    className={`w-full min-h-[48px] px-3 rounded-xl flex items-center justify-between text-[15px] ${
                      prefs.kind === k ? "text-[var(--accent-ink)] bg-[var(--accent-soft)] font-semibold" : "text-[var(--ink)] active:bg-[var(--card2)]"}`}>
                    {label}
                    {prefs.kind === k && <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                  </button>
                ))}
                <div className="mt-1.5 pt-1.5 border-t border-[var(--line)]">
                  <Toggle on={prefs.log} label="Log scale" sub="Equal percentage moves take equal height"
                    onClick={() => savePrefs({ ...prefs, log: !prefs.log })} />
                </div>
              </>
            )}

            {sheet === "layers" && (
              <>
                {view === "price" ? (
                  <>
                    <Head>Indicators</Head>
                    {INDS.map(([k, label]) => (
                      <Toggle key={k} on={indOn(k)} label={label} dot={indColour(k)}
                        sub={cmpSym && k !== "vol" && k !== "rsi" ? "Hidden while comparing - averages mean nothing once rebased" : undefined}
                        onClick={() => savePrefs({ ...prefs, inds: indOn(k) ? prefs.inds.filter((x) => x !== k) : [...prefs.inds, k] })} />
                    ))}
                  </>
                ) : (
                  <>
                    <Head>On this chart</Head>
                    {LAYERS[view].map(([k, label]) => (
                      <Toggle key={k} on={!isHidden(k)} label={label}
                        onClick={() => setHidden({ ...hidden, [`${view}:${k}`]: !isHidden(k) })} />
                    ))}
                  </>
                )}

                {view === "pe" && (
                  <>
                    <Head>Earnings</Head>
                    <Toggle on={showQ} label="Colour bars by quarter" sub="Q1 Apr–Jun · Q2 Jul–Sep · Q3 Oct–Dec · Q4 Jan–Mar" onClick={() => setShowQ(!showQ)} />
                    {showQ && (
                      <div className="px-3 pb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--ink3)]">
                        {[1, 2, 3, 4].map((n) => (
                          <span key={n} className="inline-flex items-center gap-1">
                            <i className="inline-block w-3 h-3 rounded-sm" style={{ background: `var(--q${n})` }} />{Q_LABEL[n]}
                          </span>
                        ))}
                      </div>
                    )}
                    <Toggle on={showChg} label="Growth %" sub="Printed over each bar when there is room for every one" onClick={() => setShowChg(!showChg)} />
                    {showChg && (
                      <div className="px-3 pb-2">
                        <Seg value={epsCmp}
                          options={peWin === "ttm" ? [["yoy", "Year before"], ["prev", "Quarter before"]] : [["yoy", "Year ago"], ["prev", "Previous"]]}
                          onChange={setEpsCmp} />
                      </div>
                    )}
                  </>
                )}

                <Head>Events</Head>
                {(company?.quarters?.length ?? 0) > 0 && (
                  <Toggle on={showDates} label="Result dates" sub="The day each quarter's results were declared" onClick={() => setShowDates(!showDates)} />
                )}
                {(company?.actions?.length ?? 0) > 0 && (
                  <Toggle on={showCA} label="Corporate actions" sub="Dividends, bonuses, splits and rights, on their ex-date" onClick={() => setShowCA(!showCA)} />
                )}
                <Toggle on={shadeQ} label="Quarter bands" sub="Each fiscal quarter tinted in its colour behind the chart" onClick={() => setShadeQ(!shadeQ)} />
                {showCA && (
                  <div className="pl-6">
                    {CA_ORDER.filter((k) => (company?.actions ?? []).some((a) => (CA_LABEL[a.kind] ? a.kind : "other") === k)).map((k) => (
                      <Toggle key={k} on={!!caOn[k]} label={`${CA_LABEL[k]} (${caCount[k] ?? 0} in view)`} dot={`var(--ca-${({ dividend: "div", bonus: "bon", split: "spl", rights: "rgt", buyback: "buy", other: "oth" } as Record<string, string>)[k]})`}
                        onClick={() => setCaOn({ ...caOn, [k]: !caOn[k] })} />
                    ))}
                  </div>
                )}
              </>
            )}

            {sheet === "cmp" && (
              <>
                <Head>Compare with</Head>
                <p className="px-3 pb-2 text-xs text-[var(--ink3)]">
                  {view === "price" ? "Both drawn as % change from the left edge of the chart." : "Drawn on the same axis as this company's ratio."}
                </p>
                <button onClick={() => { setCmpSym(null); setSheet(null); }}
                  className={`w-full min-h-[46px] px-3 rounded-xl text-left text-[15px] ${!cmpSym ? "text-[var(--accent-ink)] bg-[var(--accent-soft)] font-semibold" : "text-[var(--ink)] active:bg-[var(--card2)]"}`}>
                  None
                </button>
                {peerList.length > 0 && <Head>Peers</Head>}
                {peerList.map((q) => (
                  <button key={q.sym} onClick={() => { setCmpSym(q.sym); setSheet(null); }}
                    className={`w-full min-h-[46px] px-3 rounded-xl flex items-baseline justify-between gap-3 text-left ${cmpSym === q.sym ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink)] active:bg-[var(--card2)]"}`}>
                    <span className="text-[15px] truncate">{q.nm}</span><span className="text-xs text-[var(--ink3)] shrink-0">{q.sym}</span>
                  </button>
                ))}
                <Head>Any company</Head>
                <div className="px-3 pb-2">
                  <input value={cmpQ} onChange={(e) => setCmpQ(e.target.value)} placeholder="Search by name or symbol"
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--card2)] px-3 py-2.5 text-[15px] text-[var(--ink)] placeholder:text-[var(--ink3)] focus:outline-none focus:border-[var(--accent)]" />
                </div>
                {hits.map((c) => (
                  <button key={c.symbol} onClick={() => { setCmpSym(c.symbol); setCmpQ(""); setSheet(null); }}
                    className="w-full min-h-[44px] px-3 rounded-xl flex items-baseline justify-between gap-3 text-left text-[var(--ink)] active:bg-[var(--card2)]">
                    <span className="text-[15px] truncate">{c.name || c.symbol}</span><span className="text-xs text-[var(--ink3)] shrink-0">{c.symbol}</span>
                  </button>
                ))}
                {cmpErr && <p className="px-3 py-2 text-xs text-[var(--neg)]">{cmpErr}</p>}
              </>
            )}
          </div>
        </div>
      )}
      {evPop && (
        <InfoDialog title={evPop.title} onClose={() => setEvPop(null)}>
          {evPop.items.map((e, i) => (
            <div key={i} className="flex gap-2.5">
              <i className="mt-1.5 inline-block w-2.5 h-2.5 shrink-0 rounded-full" style={{ background: e.color }} />
              <div>
                <p className="text-[var(--ink)]">{e.text}</p>
                {e.sub && <p className="text-xs text-[var(--ink3)]">{e.sub}</p>}
              </div>
            </div>
          ))}
        </InfoDialog>
      )}
    </div>
  );
}
