"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart, LineSeries, BaselineSeries, PriceScaleMode, LineStyle, CrosshairMode,
  type IChartApi, type UTCTimestamp, type MouseEventParams, type Time,
} from "lightweight-charts";

/** An ETF against what it holds.
 *
 *  Top: exchange price, NAV and the underlying index, each as % change from
 *  the left edge of the chart - so they start together and any gap that opens
 *  is the story. Below: the premium, price over NAV, day by day. The Nasdaq
 *  ETFs' fall in 2026 is invisible in the top pane if you only look at the
 *  index, and plain in the bottom one. */

const DAY = 86400;
// day, price, nav, index in ₹ - and a 0 on a day nothing traded, whose price
// is only the last trade carried forward and so says nothing about a premium.
export type EtfRow = [number, number, number | null, number | null, number?];
const traded = (r: EtfRow) => !(r.length > 4 && r[4] === 0);
type Range = "1M" | "6M" | "1Y" | "3Y" | "5Y";
const RANGES: [Range, number][] = [["1M", 31], ["6M", 183], ["1Y", 366], ["3Y", 1096], ["5Y", 1827]];

const toTime = (d: number) => (d * DAY) as UTCTimestamp;
const dateOf = (d: number) =>
  new Date(d * DAY * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function palette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string, f: string) => cs.getPropertyValue(k).trim() || f;
  return {
    bg: v("--bg", "#000000"), ink: v("--ink", "#f5f5f5"), ink3: v("--ink3", "#8c8c8c"),
    grid: v("--chart-grid", "#1c1c1c"), line: v("--line", "#1f1f1f"), axis: v("--chart-axis", "#6e6e6e"),
    nav: v("--chart-alt", "#22d3ee"), index: v("--chart-dma200", "#818cf8"), warn: v("--warn", "#f59e0b"),
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

type Legend = { date: string; price: number | null; nav: number | null; prem: number | null; index: number | null };

export default function EtfChart({ rows, indexLabel }: { rows: EtfRow[]; indexLabel: string | null }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [range, setRange] = useState<Range>("1Y");
  const [legend, setLegend] = useState<Legend | null>(null);
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => {
    const mo = new MutationObserver(() => setThemeKey((k) => k + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-shade", "data-accent"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !rows.length) return;
    const p = palette();
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: p.bg }, textColor: p.ink3, fontSize: 11, fontFamily: p.font,
        panes: { separatorColor: p.line, enableResize: false },
        attributionLogo: false,   // credited in Settings > About
      },
      grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.line, mode: PriceScaleMode.Percentage },
      timeScale: { borderColor: p.line, rightOffset: 2, lockVisibleTimeRangeOnResize: true },
      crosshair: { mode: CrosshairMode.Magnet },
      handleScale: { axisPressedMouseMove: false },
    });
    chartRef.current = chart;

    const line = (color: string, width: 1 | 2, style = LineStyle.Solid) => chart.addSeries(LineSeries, {
      color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerRadius: 3,
    });
    const idx = indexLabel ? line(alpha(p.index, 0.85), 1, LineStyle.Dashed) : null;
    const nav = line(p.nav, 2);
    const price = line(p.ink, 2);
    price.setData(rows.map((r) => ({ time: toTime(r[0]), value: r[1] })));
    nav.setData(rows.filter((r) => r[2] !== null).map((r) => ({ time: toTime(r[0]), value: r[2] as number })));
    idx?.setData(rows.filter((r) => r[3] !== null).map((r) => ({ time: toTime(r[0]), value: r[3] as number })));

    // The premium, in a pane of its own: warm above NAV, cool below.
    const prem = chart.addSeries(BaselineSeries, {
      baseValue: { type: "price", price: 0 },
      topLineColor: p.warn, topFillColor1: alpha(p.warn, 0.35), topFillColor2: alpha(p.warn, 0.05),
      bottomLineColor: p.nav, bottomFillColor1: alpha(p.nav, 0.05), bottomFillColor2: alpha(p.nav, 0.3),
      lineWidth: 1, priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: "custom", formatter: (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`, minMove: 0.01 },
    }, 1);
    prem.setData(rows.filter((r) => r[2] && traded(r)).map((r) => ({ time: toTime(r[0]), value: (r[1] / (r[2] as number) - 1) * 100 })));
    // Its own scale in plain %, not "% from the left edge" like the lines
    // above: a premium is already a percentage, of the NAV that same day.
    prem.priceScale().applyOptions({ mode: PriceScaleMode.Normal, scaleMargins: { top: 0.12, bottom: 0.08 } });
    chart.panes()[0]?.setStretchFactor(2.2);
    chart.panes()[1]?.setStretchFactor(1);

    const byDay = new Map(rows.map((r) => [r[0], r]));
    const legendAt = (day: number | null): Legend | null => {
      const r = day === null ? rows[rows.length - 1] : byDay.get(day);
      if (!r) return null;
      return { date: `${dateOf(r[0])}${traded(r) ? "" : " · no trades"}`, price: r[1], nav: r[2],
        prem: r[2] && traded(r) ? (r[1] / r[2] - 1) * 100 : null, index: r[3] };
    };
    setLegend(legendAt(null));
    const onMove = (e: MouseEventParams<Time>) => setLegend(legendAt(e.time === undefined ? null : Math.round((e.time as number) / DAY)));
    chart.subscribeCrosshairMove(onMove);

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, [rows, indexLabel, themeKey]);

  // A new range moves the window; it does not rebuild the chart.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !rows.length) return;
    const last = rows[rows.length - 1][0];
    const days = RANGES.find(([r]) => r === range)?.[1] ?? 366;
    if (last - days <= rows[0][0]) chart.timeScale().fitContent();
    else chart.timeScale().setVisibleRange({ from: toTime(last - days), to: toTime(last) });
  }, [range, rows, themeKey]);

  const money = (v: number | null) => (v === null ? "—" : `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
  return (
    <div>
      <div className="px-3 pt-2.5 pb-1 text-[12px] leading-5 tabular-nums">
        <span className="text-[var(--ink3)]">{legend?.date ?? ""}</span>
        <div className="flex flex-wrap gap-x-3">
          <span><i className="inline-block w-2.5 h-0.5 mr-1 align-middle bg-[var(--ink)]" />Price {money(legend?.price ?? null)}</span>
          <span><i className="inline-block w-2.5 h-0.5 mr-1 align-middle bg-[var(--chart-alt)]" />NAV {money(legend?.nav ?? null)}</span>
          {legend?.prem !== null && legend?.prem !== undefined && (
            <span className={legend.prem >= 0.5 ? "text-[var(--warn-ink)] font-semibold" : legend.prem <= -0.5 ? "text-[var(--chart-alt)] font-semibold" : ""}>
              {legend.prem >= 0 ? "+" : ""}{legend.prem.toFixed(1)}% vs NAV
            </span>
          )}
          {indexLabel && <span className="text-[var(--ink3)]"><i className="inline-block w-2.5 mr-1 align-middle border-t border-dashed border-[var(--chart-dma200)]" />{indexLabel}</span>}
        </div>
      </div>
      <div ref={boxRef} className="h-[380px] sm:h-[440px]" />
      <div role="radiogroup" aria-label="Range" className="flex items-center gap-1 px-2 py-2 border-t border-[var(--line)]">
        {RANGES.map(([r]) => (
          <button key={r} role="radio" aria-checked={range === r} onClick={() => setRange(r)}
            className={`min-h-[34px] px-3 rounded-lg text-[13px] font-semibold ${range === r ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`}>
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
