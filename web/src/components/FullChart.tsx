"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createChart, createTextWatermark,
  CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries,
  CrosshairMode, PriceScaleMode, LineStyle,
  type IChartApi, type ISeriesApi, type SeriesType, type UTCTimestamp, type MouseEventParams, type Time,
} from "lightweight-charts";
import { loadIndex } from "@/lib/index-data";

/** The full-screen chart - the view a trading terminal opens when you tap a
 *  chart, rather than a panel inside a company page.
 *
 *  Built on TradingView's open-source Lightweight Charts, which does the parts a
 *  hand-drawn SVG does badly: pinch-zoom, pan with momentum, a crosshair that
 *  follows a finger, and tens of thousands of bars without stutter.
 *
 *  What it cannot be is intraday. The app holds end-of-day prices only - daily
 *  candles for about two years, weekly for five, monthly back to listing - so
 *  the finest candle is one day. The interval buttons say which ranges each can
 *  honestly cover and grey out the rest, instead of stretching two years of
 *  daily data across a "5Y" label. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Row = [number, number, number, number, number, number]; // day, o, h, l, c, v
type ChartFile = { s: string; asof?: string | null; d?: Row[]; w?: Row[]; m?: Row[] };

type Interval = "d" | "w" | "m";
type Range = "1M" | "3M" | "6M" | "YTD" | "1Y" | "2Y" | "5Y" | "10Y" | "MAX";
type Kind = "candles" | "hollow" | "bars" | "heikin" | "line" | "area";
type Ind = "vol" | "sma20" | "sma50" | "sma200" | "ema21" | "bb" | "rsi";

const RANGES: Range[] = ["1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y", "10Y", "MAX"];
const RANGE_DAYS: Record<Range, number> = {
  "1M": 31, "3M": 92, "6M": 183, YTD: 0, "1Y": 366, "2Y": 731, "5Y": 1827, "10Y": 3653, MAX: Infinity,
};
/** The candle a range opens with, the way Kite picks it - daily up to two
 *  years, weekly to five, monthly beyond. */
const AUTO: Record<Range, Interval> = {
  "1M": "d", "3M": "d", "6M": "d", YTD: "d", "1Y": "d", "2Y": "d", "5Y": "w", "10Y": "m", MAX: "m",
};
const INTERVALS: [Interval, string][] = [["d", "D"], ["w", "W"], ["m", "M"]];

const KINDS: [Kind, string][] = [
  ["candles", "Candles"], ["hollow", "Hollow candles"], ["bars", "Bars (OHLC)"],
  ["heikin", "Heikin-Ashi"], ["line", "Line"], ["area", "Area"],
];
const INDS: [Ind, string, string][] = [
  ["vol", "Volume", ""],
  ["sma20", "SMA 20", "#f59e0b"],
  ["sma50", "SMA 50", "#3b82f6"],
  ["sma200", "SMA 200", "#a855f7"],
  ["ema21", "EMA 21", "#14b8a6"],
  ["bb", "Bollinger Bands (20, 2)", ""],
  ["rsi", "RSI (14)", "#a855f7"],
];

const DAY = 86400;
const toTime = (day: number) => (day * DAY) as UTCTimestamp;

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
      prev = s / n;                              // seeded with the simple average
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

/* ── Presentation ───────────────────────────────────────────────────────── */

const price = (x: number) => x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Axis labels: round numbers print as round numbers ("3,500", not
 *  "3,500.00") - the axis is the widest thing on a phone chart. */
const axis = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const vol = (x: number) =>
  x >= 1e7 ? `${(x / 1e7).toFixed(2)} Cr` : x >= 1e5 ? `${(x / 1e5).toFixed(2)} L` : x >= 1e3 ? `${(x / 1e3).toFixed(1)} K` : `${x}`;
const dateOf = (day: number, withDay = true) =>
  new Date(day * DAY * 1000).toLocaleDateString("en-IN", withDay
    ? { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }
    : { month: "short", year: "numeric", timeZone: "UTC" });

/** Colours come from the app's theme, so the chart is Black on Black, Light on
 *  Light, and changes the moment the theme does. */
function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string, f: string) => cs.getPropertyValue(k).trim() || f;
  return {
    bg: v("--bg", "#000000"), card: v("--card", "#0b0b0b"), card2: v("--card2", "#161616"),
    ink: v("--ink", "#f5f5f5"), ink3: v("--ink3", "#8c8c8c"), line: v("--line", "#1f1f1f"),
    grid: v("--chart-grid", "#1c1c1c"), pos: v("--pos", "#34d399"), neg: v("--neg", "#f87171"),
    accent: v("--accent", "#818cf8"),
    font: getComputedStyle(document.body).fontFamily || "system-ui, sans-serif",
  };
}

function alpha(color: string, a: number): string {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return color;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

type Prefs = { kind: Kind; inds: Ind[]; log: boolean };
const PREF_KEY = "rs_fullchart";
function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    return {
      kind: KINDS.some(([k]) => k === p.kind) ? p.kind : "candles",
      inds: Array.isArray(p.inds) ? p.inds.filter((x: string) => INDS.some(([k]) => k === x)) : ["vol"],
      log: !!p.log,
    };
  } catch {
    return { kind: "candles", inds: ["vol"], log: false };
  }
}

type Legend = { i: number; row: Row; prev: number | null };

export default function FullChart({ symbol }: { symbol: string }) {
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const kept = useRef<{ interval: Interval; from: number; to: number } | null>(null);

  const [file, setFile] = useState<ChartFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [range, setRange] = useState<Range>("1Y");
  const [interval, setIv] = useState<Interval>("d");
  const [prefs, setPrefs] = useState<Prefs>({ kind: "candles", inds: ["vol"], log: false });
  const [sheet, setSheet] = useState<null | "type" | "ind">(null);
  const [legend, setLegend] = useState<Legend | null>(null);
  const [themeKey, setThemeKey] = useState(0);
  const [full, setFull] = useState(false);
  const [canFull, setCanFull] = useState(false);

  useEffect(() => { setPrefs(loadPrefs()); }, []);
  const savePrefs = (p: Prefs) => {
    setPrefs(p);
    try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode */ }
  };

  useEffect(() => {
    if (!symbol) return;
    let live = true;
    setFile(null); setError(null);
    fetch(`${BASE}/charts/${encodeURIComponent(symbol)}.json`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: ChartFile) => { if (live) setFile(d); })
      .catch(() => { if (live) setError("No price history is published for this company yet."); });
    loadIndex().then((d) => {
      const hit = d.rows.find((r) => r.symbol === symbol);
      if (live && hit?.name) setName(String(hit.name));
    }).catch(() => {});
    return () => { live = false; };
  }, [symbol]);

  // The theme can change under an open chart; rebuild in its colours.
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeKey((k) => k + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-shade", "data-accent"] });
    setCanFull(!!document.fullscreenEnabled);
    const onFs = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => { mo.disconnect(); document.removeEventListener("fullscreenchange", onFs); };
  }, []);

  // How far back each candle size reaches, in days, for greying out the
  // interval buttons that cannot cover the chosen range.
  const span = useMemo(() => {
    const s = (rows?: Row[]) => (rows && rows.length > 1 ? rows[rows.length - 1][0] - rows[0][0] : 0);
    return { d: s(file?.d), w: s(file?.w), m: s(file?.m) } as Record<Interval, number>;
  }, [file]);
  const rangeDays = (r: Range, rows: Row[] | undefined) => {
    if (r !== "YTD" || !rows?.length) return RANGE_DAYS[r];
    const last = rows[rows.length - 1][0];
    const y = new Date(last * DAY * 1000).getUTCFullYear();
    return last - Math.floor(Date.UTC(y, 0, 1) / 1000 / DAY);
  };
  const covers = (iv: Interval, r: Range) => {
    if (!file?.[iv]?.length) return false;
    if (r === "MAX") return span[iv] >= Math.max(span.d, span.w, span.m) - 45;
    return span[iv] + 10 >= rangeDays(r, file.d ?? file[iv]);
  };
  const pickRange = (r: Range) => {
    setRange(r);
    kept.current = null;
    // Keep the candle size you chose if it still covers the range; otherwise
    // fall to the one that does, rather than show a half-empty chart.
    const want = covers(interval, r) && interval !== "m" ? interval : AUTO[r];
    const next = covers(want, r) ? want : (["d", "w", "m"] as Interval[]).find((iv) => covers(iv, r)) ?? "m";
    setIv(next);
  };

  const rows: Row[] = useMemo(() => file?.[interval] ?? [], [file, interval]);
  const closes = useMemo(() => rows.map((r) => r[4]), [rows]);
  const lines = useMemo(() => ({
    sma20: sma(closes, 20), sma50: sma(closes, 50), sma200: sma(closes, 200), ema21: ema(closes, 21),
    bb: bollinger(closes), rsi: rsi(closes),
  }), [closes]);

  /* Build the chart. Rebuilt whole on any change of data, candle, type,
     indicators, scale or theme - it is a thousand points, and one clean build
     is simpler to trust than a web of partial updates. The visible window is
     carried across a rebuild so switching an indicator does not lose your zoom. */
  useEffect(() => {
    const el = boxRef.current;
    if (!el || rows.length === 0) return;
    const p = palette();
    const on = new Set(prefs.inds);
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
      rightPriceScale: {
        borderColor: p.line,
        mode: prefs.log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
        scaleMargins: { top: 0.08, bottom: on.has("vol") ? 0.22 : 0.06 },
      },
      // Locked on resize: turning the phone sideways used to keep the bar width
      // and show two years under a highlighted "1Y". It now keeps the window.
      timeScale: { borderColor: p.line, rightOffset: 5, barSpacing: 7, minBarSpacing: 0.3, lockVisibleTimeRangeOnResize: true },
      localization: {
        locale: "en-IN",
        priceFormatter: (x: number) => axis(x),
        timeFormatter: (t: Time) => dateOf(Math.round((t as number) / DAY), interval !== "m"),
      },
      handleScale: { axisPressedMouseMove: true, pinch: true, mouseWheel: true },
      handleScroll: { horzTouchDrag: true, vertTouchDrag: false, mouseWheel: true, pressedMouseMove: true },
    });
    chartRef.current = chart;

    const ohlc = (rs: Row[]) => rs.map(([t, o, h, l, c]) => ({ time: toTime(t), open: o, high: h, low: l, close: c }));
    const value = (rs: Row[]) => rs.map(([t, , , , c]) => ({ time: toTime(t), value: c }));
    let main: ISeriesApi<SeriesType>;
    switch (prefs.kind) {
      case "bars":
        main = chart.addSeries(BarSeries, { upColor: p.pos, downColor: p.neg, thinBars: false });
        main.setData(ohlc(rows));
        break;
      case "line":
        main = chart.addSeries(LineSeries, { color: p.accent, lineWidth: 2 });
        main.setData(value(rows));
        break;
      case "area":
        main = chart.addSeries(AreaSeries, {
          lineColor: p.accent, lineWidth: 2, topColor: alpha(p.accent, 0.3), bottomColor: alpha(p.accent, 0),
        });
        main.setData(value(rows));
        break;
      case "hollow":
        main = chart.addSeries(CandlestickSeries, {
          upColor: "rgba(0, 0, 0, 0)", downColor: p.neg, borderVisible: true,
          borderUpColor: p.pos, borderDownColor: p.neg, wickUpColor: p.pos, wickDownColor: p.neg,
        });
        main.setData(ohlc(rows));
        break;
      default:
        main = chart.addSeries(CandlestickSeries, {
          upColor: p.pos, downColor: p.neg, borderVisible: false, wickUpColor: p.pos, wickDownColor: p.neg,
        });
        main.setData(ohlc(prefs.kind === "heikin" ? heikinAshi(rows) : rows));
    }

    const overlay = (vals: (number | null)[], color: string, dashed = false, width: 1 | 2 = 1) => {
      const s = chart.addSeries(LineSeries, {
        color, lineWidth: width, lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(vals.flatMap((x, i) => (x === null ? [] : [{ time: toTime(rows[i][0]), value: x }])));
    };
    for (const [key, , color] of INDS) {
      if (!on.has(key) || !color || key === "rsi") continue;
      overlay(lines[key as "sma20" | "sma50" | "sma200" | "ema21"], color, false, 2);
    }
    if (on.has("bb")) {
      overlay(lines.bb.up, alpha(p.ink3, 0.9), true);
      overlay(lines.bb.mid, alpha(p.ink3, 0.6));
      overlay(lines.bb.lo, alpha(p.ink3, 0.9), true);
    }
    if (on.has("vol")) {
      const v = chart.addSeries(HistogramSeries, {
        priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false,
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      v.setData(rows.map(([t, o, , , c, vv]) => ({ time: toTime(t), value: vv, color: alpha(c >= o ? p.pos : p.neg, 0.45) })));
    }
    if (on.has("rsi")) {
      const r = chart.addSeries(LineSeries, {
        color: "#a855f7", lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false,
      }, 1);
      r.setData(lines.rsi.flatMap((x, i) => (x === null ? [] : [{ time: toTime(rows[i][0]), value: x }])));
      for (const lvl of [70, 30]) {
        r.createPriceLine({ price: lvl, color: alpha(p.ink3, 0.7), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
      }
      const panes = chart.panes();
      panes[0]?.setStretchFactor(3);
      panes[1]?.setStretchFactor(1);
    }

    createTextWatermark(chart.panes()[0], {
      horzAlign: "center", vertAlign: "center",
      lines: [{ text: symbol, color: alpha(p.ink3, 0.09), fontSize: 56, fontStyle: "bold", fontFamily: p.font }],
    });

    // The window: the one you were looking at if the candle did not change,
    // otherwise the chosen range.
    const k = kept.current;
    if (k && k.interval === interval) {
      chart.timeScale().setVisibleRange({ from: k.from as UTCTimestamp, to: k.to as UTCTimestamp });
    } else {
      const last = rows[rows.length - 1][0];
      const days = rangeDays(range, file?.d ?? rows);
      if (!Number.isFinite(days) || last - days <= rows[0][0]) chart.timeScale().fitContent();
      else chart.timeScale().setVisibleRange({ from: toTime(last - days), to: toTime(last) });
    }

    const index = new Map(rows.map((r, i) => [r[0], i]));
    const lastLegend = (): Legend => ({ i: rows.length - 1, row: rows[rows.length - 1], prev: rows.length > 1 ? rows[rows.length - 2][4] : null });
    setLegend(lastLegend());
    const onMove = (e: MouseEventParams<Time>) => {
      const i = e.time === undefined ? undefined : index.get(Math.round((e.time as number) / DAY));
      setLegend(i === undefined ? lastLegend() : { i, row: rows[i], prev: i > 0 ? rows[i - 1][4] : null });
    };
    chart.subscribeCrosshairMove(onMove);

    return () => {
      const vr = chart.timeScale().getVisibleRange();
      if (vr) kept.current = { interval, from: vr.from as number, to: vr.to as number };
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
    // `range` is deliberately absent: it is applied by the effect below
    // without a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, prefs, lines, themeKey, symbol]);

  // A new range moves the window; it does not rebuild the chart.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || rows.length === 0) return;
    const last = rows[rows.length - 1][0];
    const days = rangeDays(range, file?.d ?? rows);
    if (!Number.isFinite(days) || last - days <= rows[0][0]) chart.timeScale().fitContent();
    else chart.timeScale().setVisibleRange({ from: toTime(last - days), to: toTime(last) });
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
        // Landscape where the phone allows it; many do not, and that is fine.
        await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape").catch(() => {});
      }
    } catch { /* not supported in this browser */ }
  };
  const resetView = () => {
    kept.current = null;
    const chart = chartRef.current;
    if (!chart || !rows.length) return;
    const last = rows[rows.length - 1][0];
    const days = rangeDays(range, file?.d ?? rows);
    if (!Number.isFinite(days) || last - days <= rows[0][0]) chart.timeScale().fitContent();
    else chart.timeScale().setVisibleRange({ from: toTime(last - days), to: toTime(last) });
    chart.priceScale("right").applyOptions({ autoScale: true });
  };

  // The day's move, from the daily series whatever candle is on screen.
  const daily = file?.d ?? [];
  const lastD = daily[daily.length - 1], prevD = daily[daily.length - 2];
  const dayChg = lastD && prevD ? lastD[4] - prevD[4] : null;

  // The legend is checked against the series on screen before it is used.
  // Switching 1Y to 5Y swaps ~500 daily bars for ~260 weekly ones, and for one
  // render the legend still pointed at bar 499 - past the end of the weekly
  // indicator arrays - and the page crashed. A legend from another series now
  // falls back to the last bar of this one.
  const L: Legend | null =
    legend && legend.i < rows.length && rows[legend.i]?.[0] === legend.row[0] ? legend
      : rows.length ? { i: rows.length - 1, row: rows[rows.length - 1], prev: rows.length > 1 ? rows[rows.length - 2][4] : null }
      : null;
  const lChg = L && L.prev ? L.row[4] - L.prev : null;
  const tone = (x: number | null) => (x === null ? "text-[var(--ink2)]" : x >= 0 ? "text-[var(--pos)]" : "text-[var(--neg)]");
  const indOn = (k: Ind) => prefs.inds.includes(k);
  const kindLabel = KINDS.find(([k]) => k === prefs.kind)?.[1] ?? "Candles";
  const nInds = prefs.inds.filter((k) => k !== "vol").length;

  const pill = (active: boolean, disabled = false) =>
    `shrink-0 min-h-[34px] px-2 rounded-lg text-[13px] font-semibold tabular-nums transition-colors ${
      disabled ? "text-[var(--ink3)] opacity-35"
        : active ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--bg)] text-[var(--ink)] select-none">
      {/* Header: back, what this is, where it closed. */}
      <header className="shrink-0 flex items-center gap-2 px-2 pt-[env(safe-area-inset-top)] h-[calc(52px+env(safe-area-inset-top))] border-b border-[var(--line)]">
        <button onClick={back} aria-label="Back" className="rs-press w-10 h-10 rounded-full flex items-center justify-center text-[var(--ink2)] active:bg-[var(--card2)]">
          <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold leading-tight truncate">
            {symbol}
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

      {/* Chart, with the crosshair legend laid over its top-left corner. */}
      <div className="relative flex-1 min-h-0">
        <div ref={boxRef} className="absolute inset-0" />
        {L && (
          <div className="pointer-events-none absolute left-2 top-1.5 z-10 text-[11px] leading-[1.35] tabular-nums">
            <p className="text-[var(--ink3)]">
              {dateOf(L.row[0], interval !== "m")}
              <span className="ml-1.5 uppercase">{interval === "d" ? "1D" : interval === "w" ? "1W" : "1M"}</span>
            </p>
            <p className="flex flex-wrap gap-x-2">
              {(["O", "H", "L", "C"] as const).map((k, j) => (
                <span key={k}><span className="text-[var(--ink3)]">{k} </span><span className={tone(lChg)}>{price(L.row[j + 1])}</span></span>
              ))}
              {lChg !== null && L.prev && (
                <span className={tone(lChg)}>{lChg >= 0 ? "+" : ""}{((lChg / L.prev) * 100).toFixed(2)}%</span>
              )}
            </p>
            <p className="flex flex-wrap gap-x-2">
              {indOn("vol") && <span><span className="text-[var(--ink3)]">Vol </span><span className="text-[var(--ink2)]">{vol(L.row[5])}</span></span>}
              {INDS.filter(([k, , c]) => indOn(k) && c && k !== "rsi").map(([k, label, c]) => {
                const x = lines[k as "sma20" | "sma50" | "sma200" | "ema21"][L.i];
                return x == null ? null : <span key={k} style={{ color: c }}>{label} {price(x)}</span>;
              })}
              {indOn("rsi") && lines.rsi[L.i] != null && <span style={{ color: "#a855f7" }}>RSI {(lines.rsi[L.i] as number).toFixed(1)}</span>}
            </p>
          </div>
        )}
        {!file && !error && <div className="absolute inset-3 rs-skel" aria-busy="true" aria-label="Loading chart" />}
        {error && <p className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-[var(--ink3)]">{error}</p>}
      </div>

      {/* Controls. Two rows on a phone held upright; one when it is on its side
          and every pixel of height belongs to the chart. */}
      <footer className="shrink-0 border-t border-[var(--line)] pb-[env(safe-area-inset-bottom)] flex flex-col [@media(max-height:500px)]:flex-row [@media(max-height:500px)]:items-center">
        <div className="flex items-center gap-0.5 overflow-x-auto px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [@media(max-height:500px)]:flex-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => pickRange(r)} className={pill(range === r)}>{r}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 px-2 pb-1.5 [@media(max-height:500px)]:pb-1 overflow-x-auto [scrollbar-width:none]">
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
          <button onClick={() => setSheet("ind")} className={pill(nInds > 0)}>
            Indicators{nInds > 0 ? ` · ${nInds}` : ""}
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
            className="rs-sheet absolute bottom-0 inset-x-0 mx-auto max-w-md rounded-t-2xl border-t border-[var(--line)] bg-[var(--card)] p-2 pb-[calc(env(safe-area-inset-bottom)+10px)] max-h-[80vh] overflow-y-auto">
            <p className="px-3 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
              {sheet === "type" ? "Chart type" : "Indicators"}
            </p>
            {sheet === "type"
              ? KINDS.map(([k, label]) => (
                  <button key={k} onClick={() => { savePrefs({ ...prefs, kind: k }); setSheet(null); }}
                    className={`w-full min-h-[48px] px-3 rounded-xl flex items-center justify-between text-[15px] ${
                      prefs.kind === k ? "text-[var(--accent-ink)] bg-[var(--accent-soft)] font-semibold" : "text-[var(--ink)] active:bg-[var(--card2)]"}`}>
                    {label}
                    {prefs.kind === k && <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
                  </button>
                )).concat(
                  <div key="scale" className="mt-1.5 pt-1.5 border-t border-[var(--line)]">
                    <button role="switch" aria-checked={prefs.log}
                      onClick={() => savePrefs({ ...prefs, log: !prefs.log })}
                      className="w-full min-h-[48px] px-3 rounded-xl flex items-center gap-3 text-[15px] text-[var(--ink)] active:bg-[var(--card2)]">
                      <span className="flex-1 text-left">
                        Log scale
                        <span className="block text-xs text-[var(--ink3)]">Equal percentage moves take equal height</span>
                      </span>
                      <span className={`relative w-10 h-6 rounded-full transition-colors ${prefs.log ? "bg-[var(--accent)]" : "bg-[var(--line2)]"}`}>
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${prefs.log ? "left-[18px]" : "left-0.5"}`} />
                      </span>
                    </button>
                  </div>,
                )
              : INDS.map(([k, label, c]) => {
                  const active = indOn(k);
                  return (
                    <button key={k} role="switch" aria-checked={active}
                      onClick={() => savePrefs({ ...prefs, inds: active ? prefs.inds.filter((x) => x !== k) : [...prefs.inds, k] })}
                      className="w-full min-h-[48px] px-3 rounded-xl flex items-center gap-3 text-[15px] text-[var(--ink)] active:bg-[var(--card2)]">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c || "var(--ink3)" }} />
                      <span className="flex-1 text-left">{label}</span>
                      <span className={`relative w-10 h-6 rounded-full transition-colors ${active ? "bg-[var(--accent)]" : "bg-[var(--line2)]"}`}>
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${active ? "left-[18px]" : "left-0.5"}`} />
                      </span>
                    </button>
                  );
                })}
          </div>
        </div>
      )}
    </div>
  );
}
