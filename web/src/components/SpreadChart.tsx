"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart, BaselineSeries, CrosshairMode,
  type IChartApi, type UTCTimestamp, type MouseEventParams, type Time,
} from "lightweight-charts";

/** The second-nearest expiry over the nearest, each day both traded: above
 *  zero later delivery cost more. As a plain % or spread over the days between
 *  the two expiries as % a year - comparable across a roll, when the gap
 *  between the two months changes. */

const DAY = 86400;
type Mode = "pct" | "pa";

const toTime = (d: number) => (d * DAY) as UTCTimestamp;
const dateOf = (d: number) =>
  new Date(d * DAY * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function alpha(color: string, a: number): string {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return color;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export default function SpreadChart({ rows }: { rows: [number, number, number | null][] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("pct");
  const [at, setAt] = useState<[number, number, number | null] | null>(null);
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => {
    const mo = new MutationObserver(() => setThemeKey((k) => k + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-shade", "data-accent"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !rows.length) return;
    const cs = getComputedStyle(document.documentElement);
    const v = (k: string, f: string) => cs.getPropertyValue(k).trim() || f;
    const up = v("--warn", "#f59e0b"), down = v("--chart-alt", "#22d3ee");
    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: v("--bg", "#000") }, textColor: v("--ink3", "#8c8c8c"), fontSize: 11,
        fontFamily: getComputedStyle(document.body).fontFamily || "system-ui, sans-serif",
        attributionLogo: false,   // credited in Settings > About
      },
      grid: { vertLines: { color: v("--chart-grid", "#1c1c1c") }, horzLines: { color: v("--chart-grid", "#1c1c1c") } },
      rightPriceScale: { borderColor: v("--line", "#1f1f1f") },
      timeScale: { borderColor: v("--line", "#1f1f1f") },
      crosshair: { mode: CrosshairMode.Magnet },
      handleScale: false, handleScroll: false,
    });
    const s = chart.addSeries(BaselineSeries, {
      baseValue: { type: "price", price: 0 },
      topLineColor: up, topFillColor1: alpha(up, 0.3), topFillColor2: alpha(up, 0.04),
      bottomLineColor: down, bottomFillColor1: alpha(down, 0.04), bottomFillColor2: alpha(down, 0.3),
      lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: "custom", formatter: (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(mode === "pa" ? 1 : 2)}%`, minMove: 0.01 },
    });
    s.setData(rows.filter((r) => mode === "pct" || r[2] !== null)
      .map((r) => ({ time: toTime(r[0]), value: (mode === "pct" ? r[1] : r[2]) as number })));
    chart.timeScale().fitContent();
    const byDay = new Map(rows.map((r) => [r[0], r]));
    setAt(rows[rows.length - 1]);
    const onMove = (e: MouseEventParams<Time>) =>
      setAt(e.time === undefined ? rows[rows.length - 1] : byDay.get(Math.round((e.time as number) / DAY)) ?? null);
    chart.subscribeCrosshairMove(onMove);
    return () => { chart.unsubscribeCrosshairMove(onMove); chart.remove(); };
  }, [rows, mode, themeKey]);

  const val = at ? (mode === "pct" ? at[1] : at[2]) : null;
  return (
    <div>
      <div className="flex items-center gap-2 px-3 pt-1 pb-1">
        <p className="text-[12px] tabular-nums text-[var(--ink2)]">
          {at ? <>{dateOf(at[0])} · <b className="text-[var(--ink)]">{val === null ? "—" : `${val > 0 ? "+" : ""}${val.toFixed(mode === "pa" ? 1 : 2)}%`}</b>{mode === "pa" ? " a year" : ""}</> : " "}
        </p>
        <div role="radiogroup" aria-label="Units" className="ml-auto flex items-center gap-1">
          {([["pct", "%"], ["pa", "% a year"]] as const).map(([k, label]) => (
            <button key={k} role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
              className={`min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold ${mode === k ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div ref={boxRef} className="h-[220px]" />
    </div>
  );
}
