"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart, CandlestickSeries, LineSeries, BaselineSeries, HistogramSeries, LineStyle, CrosshairMode,
  type IChartApi, type UTCTimestamp, type MouseEventParams, type Time,
} from "lightweight-charts";
import type { Bar } from "@/lib/commodity";

/** One MCX contract over its life. Top: its daily candles, and - where a
 *  world contract matches - the same delivery month on COMEX/NYMEX in rupees,
 *  dashed. Bottom, by choice: MCX over that world price each day, or the
 *  open interest (how many contracts are outstanding). */

const DAY = 86400;
type Range = "1M" | "3M" | "6M" | "All";
const RANGES: [Range, number][] = [["1M", 31], ["3M", 92], ["6M", 183], ["All", 0]];
type Lower = "world" | "oi";

const toTime = (d: number) => (d * DAY) as UTCTimestamp;
const dateOf = (d: number) =>
  new Date(d * DAY * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string, f: string) => cs.getPropertyValue(k).trim() || f;
  return {
    bg: v("--bg", "#000000"), ink: v("--ink", "#f5f5f5"), ink3: v("--ink3", "#8c8c8c"),
    grid: v("--chart-grid", "#1c1c1c"), line: v("--line", "#1f1f1f"),
    up: v("--chart-pos", "#34d399"), down: v("--chart-neg", "#f87171"),
    world: v("--chart-alt", "#22d3ee"), warn: v("--warn", "#f59e0b"), vol: v("--chart-vol", "#b9cdf2"),
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

const inr = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v >= 1000 ? 0 : 2 })}`;

export default function CommodityChart({ bars, worldLabel, cmpTab = "vs World" }: {
  bars: Bar[]; worldLabel: string | null;
  /** The lower pane's name: "vs World" for MCX, "vs Spot" for NCDEX's mandi price. */
  cmpTab?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const hasWorld = !!worldLabel && bars.some((b) => b[7] !== null);
  // NCDEX's daily candles carry no open interest; nothing is drawn as zero.
  const hasOI = bars.some((b) => b[6] !== null);
  const [choice, setLower] = useState<Lower>("world");
  const lower: Lower | null = hasWorld ? choice : hasOI ? "oi" : null;
  const [range, setRange] = useState<Range>("All");
  const [at, setAt] = useState<Bar | null>(null);
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => {
    const mo = new MutationObserver(() => setThemeKey((k) => k + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-shade", "data-accent"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !bars.length) return;
    const p = palette();
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: p.bg }, textColor: p.ink3, fontSize: 11, fontFamily: p.font,
        panes: { separatorColor: p.line, enableResize: false },
        attributionLogo: false,   // credited in Settings > About
      },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.line },
      timeScale: { borderColor: p.line, rightOffset: 2, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: CrosshairMode.Magnet },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
      handleScroll: { vertTouchDrag: true },
    });
    chartRef.current = chart;

    // Rupees as the page writes them - 1,48,797 not 148797.00.
    const big = bars[bars.length - 1][4] >= 1000;
    const priceFormat = {
      type: "custom" as const, minMove: big ? 1 : 0.01,
      formatter: (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: big ? 0 : 2 }),
    };
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: p.up, downColor: p.down, borderUpColor: p.up, borderDownColor: p.down,
      wickUpColor: p.up, wickDownColor: p.down, priceLineVisible: false, priceFormat,
    });
    candles.setData(bars.map((b) => ({ time: toTime(b[0]), open: b[1], high: b[2], low: b[3], close: b[4] })));
    if (hasWorld) {
      const world = chart.addSeries(LineSeries, {
        color: p.world, lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerRadius: 3, priceFormat,
      });
      world.setData(bars.filter((b) => b[7] !== null).map((b) => ({ time: toTime(b[0]), value: b[7] as number })));
    }

    if (lower === "world" && hasWorld) {
      const prem = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: 0 },
        topLineColor: p.warn, topFillColor1: alpha(p.warn, 0.3), topFillColor2: alpha(p.warn, 0.04),
        bottomLineColor: p.world, bottomFillColor1: alpha(p.world, 0.04), bottomFillColor2: alpha(p.world, 0.3),
        lineWidth: 1, priceLineVisible: false, lastValueVisible: true,
        priceFormat: { type: "custom", formatter: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`, minMove: 0.01 },
      }, 1);
      prem.setData(bars.filter((b) => b[7]).map((b) => ({ time: toTime(b[0]), value: (b[4] / (b[7] as number) - 1) * 100 })));
    } else if (lower === "oi") {
      const oi = chart.addSeries(HistogramSeries, {
        color: alpha(p.vol, 0.8), priceLineVisible: false, lastValueVisible: true,
        priceFormat: { type: "volume" },
      }, 1);
      oi.setData(bars.filter((b) => b[6] !== null).map((b) => ({ time: toTime(b[0]), value: b[6] as number })));
    }
    chart.panes()[0]?.setStretchFactor(2.4);
    chart.panes()[1]?.setStretchFactor(1);

    const byDay = new Map(bars.map((b) => [b[0], b]));
    setAt(bars[bars.length - 1]);
    const onMove = (e: MouseEventParams<Time>) =>
      setAt(e.time === undefined ? bars[bars.length - 1] : byDay.get(Math.round((e.time as number) / DAY)) ?? null);
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, hasWorld, lower, themeKey]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !bars.length) return;
    const last = bars[bars.length - 1][0];
    const days = RANGES.find(([r]) => r === range)?.[1] ?? 0;
    if (!days || last - days <= bars[0][0]) chart.timeScale().fitContent();
    else chart.timeScale().setVisibleRange({ from: toTime(last - days), to: toTime(last) });
  }, [range, bars, lower, themeKey]);

  const prem = at && at[7] ? (at[4] / at[7] - 1) * 100 : null;
  return (
    <div>
      <div className="px-3 pt-2 pb-1 text-[12px] leading-5 tabular-nums">
        <span className="text-[var(--ink3)]">{at ? dateOf(at[0]) : ""}</span>
        {at && (
          <div className="flex flex-wrap gap-x-3">
            <span>O {inr(at[1])}</span><span>H {inr(at[2])}</span><span>L {inr(at[3])}</span>
            <span className="font-semibold">C {inr(at[4])}</span>
            {at[6] !== null && <span className="text-[var(--ink3)]">OI {at[6].toLocaleString("en-IN")}</span>}
            {hasWorld && (
              <span>
                <i className="inline-block w-2.5 mr-1 align-middle border-t-2 border-dashed border-[var(--chart-alt)]" />
                {worldLabel} {inr(at[7])}
                {prem !== null && <b className={prem >= 0 ? "text-[var(--warn-ink)]" : "text-[var(--chart-alt)]"}> {prem >= 0 ? "+" : ""}{prem.toFixed(1)}%</b>}
              </span>
            )}
          </div>
        )}
      </div>
      <div ref={boxRef} className="h-[360px] sm:h-[420px]" />
      <div className="flex items-center gap-1 px-2 py-2 border-t border-[var(--line)]">
        <div role="radiogroup" aria-label="Range" className="flex items-center gap-1">
          {RANGES.map(([r]) => (
            <button key={r} role="radio" aria-checked={range === r} onClick={() => setRange(r)}
              className={`min-h-[34px] px-2.5 rounded-lg text-[13px] font-semibold ${range === r ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`}>
              {r}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Lower pane" className="ml-auto flex items-center gap-1">
          {([["world", cmpTab], ["oi", "OI"]] as const).filter(([k]) => (k !== "world" || hasWorld) && (k !== "oi" || hasOI)).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={lower === k} onClick={() => setLower(k)}
              className={`min-h-[34px] px-2.5 rounded-lg text-[13px] font-semibold ${lower === k ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
