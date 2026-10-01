"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, AreaSeries, CrosshairMode,
  type IChartApi, type UTCTimestamp, type MouseEventParams, type Time,
} from "lightweight-charts";

/** An index's level over time, on its own page: daily closes up to five
 *  years, weekly beyond that, from the same file the full-screen chart reads.
 *  The readout says the level on the day touched and the change from the
 *  start of the range on screen. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DAY = 86400;
type Candle = [number, number, number, number, number, number];
type Range = "1M" | "6M" | "1Y" | "5Y" | "Max";
const RANGES: [Range, number][] = [["1M", 31], ["6M", 183], ["1Y", 366], ["5Y", 1827], ["Max", 0]];

const toTime = (d: number) => (d * DAY) as UTCTimestamp;
const dateOf = (d: number) =>
  new Date(d * DAY * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const pts = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string, f: string) => cs.getPropertyValue(k).trim() || f;
  return {
    bg: v("--bg", "#000000"), ink3: v("--ink3", "#8c8c8c"), grid: v("--chart-grid", "#1c1c1c"),
    line: v("--line", "#1f1f1f"), up: v("--chart-pos", "#34d399"), down: v("--chart-neg", "#f87171"),
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

export default function IndexChart({ symbol }: { symbol: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [file, setFile] = useState<{ d: Candle[]; w: Candle[] } | null>(null);
  const [range, setRange] = useState<Range>("1Y");
  const [at, setAt] = useState<number | null>(null);
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`${BASE}/charts/${encodeURIComponent(symbol)}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setFile({ d: d.d ?? [], w: d.w ?? [] }); })
      .catch(() => {});
    return () => { live = false; };
  }, [symbol]);

  useEffect(() => {
    const mo = new MutationObserver(() => setThemeKey((k) => k + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-shade", "data-accent"] });
    return () => mo.disconnect();
  }, []);

  // Daily candles cover five years; Max steps out to weekly.
  const series = useMemo(() => {
    if (!file?.d.length) return [];
    const last = file.d[file.d.length - 1][0];
    const span = RANGES.find(([r]) => r === range)![1];
    if (!span) {
      const firstDaily = file.d[0][0];
      return [...file.w.filter((c) => c[0] < firstDaily), ...file.d].map((c) => ({ day: c[0], v: c[4] }));
    }
    return file.d.filter((c) => c[0] >= last - span).map((c) => ({ day: c[0], v: c[4] }));
  }, [file, range]);

  const up = series.length > 1 && series[series.length - 1].v >= series[0].v;

  useEffect(() => {
    const el = boxRef.current;
    if (!el || series.length < 2) return;
    const p = palette();
    const col = up ? p.up : p.down;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: p.bg }, textColor: p.ink3, fontSize: 11, fontFamily: p.font, attributionLogo: false },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.line },
      timeScale: { borderColor: p.line, rightOffset: 1, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: CrosshairMode.Magnet },
      handleScale: false, handleScroll: false,
    });
    chartRef.current = chart;
    const area = chart.addSeries(AreaSeries, {
      lineColor: col, topColor: alpha(col, 0.28), bottomColor: alpha(col, 0.02), lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: "custom", minMove: 0.01, formatter: (v: number) => pts(v) },
    });
    area.setData(series.map((s) => ({ time: toTime(s.day), value: s.v })));
    chart.timeScale().fitContent();
    const onMove = (e: MouseEventParams<Time>) => {
      if (e.time === undefined) { setAt(null); return; }
      const d = Math.round((e.time as number) / DAY);
      const i = series.findIndex((s) => s.day >= d);
      setAt(i >= 0 ? i : null);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => { chart.unsubscribeCrosshairMove(onMove); chart.remove(); chartRef.current = null; };
  }, [series, up, themeKey]);

  const shown = at !== null ? series[at] : series[series.length - 1];
  const base = series[0];
  const chg = shown && base ? (shown.v / base.v - 1) * 100 : null;

  return (
    <div>
      <div className="px-3 pt-1 pb-1 text-[12px] tabular-nums flex items-baseline gap-2 flex-wrap">
        {shown && <span className="font-semibold text-[var(--ink)]">{pts(shown.v)}</span>}
        {chg !== null && <span className={chg >= 0 ? "text-[var(--pos)]" : "text-[var(--neg)]"}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>}
        {shown && <span className="text-[var(--ink3)]">{dateOf(shown.day)}{base ? ` · since ${dateOf(base.day)}` : ""}</span>}
      </div>
      {series.length > 1
        ? <div ref={boxRef} className="h-[240px] sm:h-[300px]" />
        : <div className="h-[240px] rs-skel" aria-busy="true" aria-label="Loading" />}
      <div role="radiogroup" aria-label="Range" className="flex items-center gap-1 px-2 py-2">
        {RANGES.map(([r]) => (
          <button key={r} role="radio" aria-checked={range === r} onClick={() => setRange(r)}
            className={`min-h-[34px] px-2.5 rounded-lg text-[13px] font-semibold ${range === r ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`}>
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
