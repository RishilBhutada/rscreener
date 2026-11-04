"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart, LineSeries, LineStyle, CrosshairMode,
  type IChartApi, type UTCTimestamp, type MouseEventParams, type Time,
} from "lightweight-charts";

/** The valuation of what an ETF holds, over time: its index's PE, PB or
 *  dividend yield, with the median of the window on screen as a dashed line -
 *  the same reading as a share's PE band, for a basket of shares. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DAY = 86400;
type Row = [number, number, number | null, number | null]; // day, pe, pb, dy
type Metric = "pe" | "pb" | "dy";
const METRICS: [Metric, string, number][] = [["pe", "PE", 1], ["pb", "PB", 2], ["dy", "Div yield", 3]];
type Range = "1Y" | "3Y" | "5Y" | "10Y" | "All";
const RANGES: [Range, number][] = [["1Y", 366], ["3Y", 1096], ["5Y", 1827], ["10Y", 3653], ["All", 100000]];

const toTime = (d: number) => (d * DAY) as UTCTimestamp;
const dateOf = (d: number) =>
  new Date(d * DAY * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b), m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export default function EtfValChart({ file }: { file: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [metric, setMetric] = useState<Metric>("pe");
  const [range, setRange] = useState<Range>("5Y");
  const [hover, setHover] = useState<{ day: number; v: number } | null>(null);
  const [themeKey, setThemeKey] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`${BASE}/etf-val/${encodeURIComponent(file)}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d?.rows) setRows(d.rows); })
      .catch(() => {});
    return () => { live = false; };
  }, [file]);

  useEffect(() => {
    const mo = new MutationObserver(() => setThemeKey((k) => k + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-shade", "data-accent"] });
    return () => mo.disconnect();
  }, []);

  const col = METRICS.find(([m]) => m === metric)![2];
  const shown = useMemo(() => {
    if (!rows?.length) return [];
    const last = rows[rows.length - 1][0];
    const span = RANGES.find(([r]) => r === range)![1];
    return rows.filter((r) => r[0] >= last - span && r[col] !== null).map((r) => ({ day: r[0], v: r[col] as number }));
  }, [rows, range, col]);
  const med = useMemo(() => median(shown.map((x) => x.v)), [shown]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !shown.length) return;
    const cs = getComputedStyle(document.documentElement);
    const v = (k: string, f: string) => cs.getPropertyValue(k).trim() || f;
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
    const s = chart.addSeries(LineSeries, {
      color: v("--accent", "#818cf8"), lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
      priceFormat: { type: "custom", formatter: (x: number) => (metric === "dy" ? `${x.toFixed(2)}%` : x.toFixed(metric === "pb" ? 2 : 1)), minMove: 0.01 },
    });
    s.setData(shown.map((x) => ({ time: toTime(x.day), value: x.v })));
    if (med !== null) {
      s.createPriceLine({ price: med, color: v("--ink3", "#8c8c8c"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Median" });
    }
    chart.timeScale().fitContent();
    const onMove = (e: MouseEventParams<Time>) => {
      const d = e.seriesData.get(s) as { value?: number } | undefined;
      setHover(e.time !== undefined && d?.value !== undefined ? { day: Math.round((e.time as number) / DAY), v: d.value } : null);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => { chart.unsubscribeCrosshairMove(onMove); chart.remove(); };
  }, [shown, med, metric, themeKey]);

  if (rows && !rows.length) return null;
  const label = METRICS.find(([m]) => m === metric)![1];
  const fmt = (x: number) => (metric === "dy" ? `${x.toFixed(2)}%` : x.toFixed(metric === "pb" ? 2 : 1));
  const now = hover ?? (shown.length ? { day: shown[shown.length - 1].day, v: shown[shown.length - 1].v } : null);
  return (
    <div className="border-t border-[var(--line)]">
      <div className="flex items-center gap-1 px-2 pt-2">
        {METRICS.map(([m, name]) => (
          <button key={m} onClick={() => setMetric(m)} aria-pressed={metric === m}
            className={`min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold ${metric === m ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`}>
            {name}
          </button>
        ))}
      </div>
      <p className="px-3 pt-1 text-[12px] tabular-nums text-[var(--ink2)]">
        {now ? <>{dateOf(now.day)} · {label} <b className="text-[var(--ink)]">{fmt(now.v)}</b></> : " "}
        {med !== null && <span className="text-[var(--ink3)]"> · median {fmt(med)}</span>}
      </p>
      <div ref={boxRef} className="h-[260px]" />
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
