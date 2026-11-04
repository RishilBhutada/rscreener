"use client";

/** Each calendar year's price path, one line per year, all starting at 0% on
 *  1 January - so this year can be read against the same weeks of earlier
 *  years (owner, 28-Oct-2026: Step 3, from a chart he sent).
 *
 *  A year's return is measured from the last close of the year before, so
 *  the first week of January already shows that week's move. Weekly closes
 *  where the file has them, monthly otherwise. Line colours mean nothing:
 *  never green or red, which mean up and down everywhere else in the app.
 */
import { useEffect, useMemo, useRef, useState } from "react";

type Pt = [string, number] | [string, number, number | null];
type Point = { doy: number; v: number; date: string };

const COLOURS = ["var(--accent)", "#c084fc", "#f5a524", "#94a3b8", "#2dd4bf", "#f472b6", "#a3a3a3", "#fb923c"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY = 864e5;

function dayOfYear(iso: string): number {
  const y = Number(iso.slice(0, 4));
  return Math.round((Date.parse(iso.slice(0, 10)) - Date.UTC(y, 0, 1)) / DAY);
}

function dateOfDay(doy: number): string {
  const d = new Date(Date.UTC(2025, 0, 1) + doy * DAY);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function pct(v: number | null | undefined, dec = 1): string {
  if (v === null || v === undefined) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dec)}%`;
}

const tone = (v: number | null | undefined) =>
  v === null || v === undefined || v === 0 ? "text-[var(--ink3)]" : v > 0 ? "text-[var(--pos)]" : "text-[var(--neg)]";

export default function YearsChart({ prices }: { prices: { weekly?: Pt[]; monthly?: Pt[] } | null | undefined }) {
  const weekly = (prices?.weekly?.length ?? 0) > 60;

  // Every year with a close from the year before to measure from, newest first.
  const years = useMemo(() => {
    const src = (weekly ? prices?.weekly : prices?.monthly) ?? [];
    const pts = src.filter((p) => typeof p[1] === "number" && p[1] > 0);
    const out: { year: number; pts: Point[] }[] = [];
    const first = pts.length ? Number(pts[0][0].slice(0, 4)) : 0;
    const last = pts.length ? Number(pts[pts.length - 1][0].slice(0, 4)) : 0;
    for (let y = last; y > first; y--) {
      const prev = pts.filter((p) => p[0] < `${y}-01-01`);
      const inYear = pts.filter((p) => p[0].startsWith(String(y)));
      if (!prev.length || !inYear.length) continue;
      const base = prev[prev.length - 1][1];
      out.push({ year: y, pts: inYear.map((p) => ({ doy: dayOfYear(p[0]), v: (p[1] / base - 1) * 100, date: p[0] })) });
    }
    return out.slice(0, 8);
  }, [prices, weekly]);

  const [shown, setShown] = useState<number[] | null>(null);
  const on = shown ?? years.slice(0, 3).map((y) => y.year);
  const colourOf = (y: number) => COLOURS[years.findIndex((x) => x.year === y) % COLOURS.length];
  const [at, setAt] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  // Drawn at the box's own width, so text and lines keep their size on a phone
  // instead of a 640-wide drawing shrunk into it.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, Math.round(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [years.length]);

  if (years.length === 0) {
    return <div className="h-56 flex items-center justify-center text-sm text-[var(--ink3)]">Not enough price history for this view.</div>;
  }

  const H = 240, L = 4, R = 40, T = 10, B = 22;
  const visible = years.filter((y) => on.includes(y.year));
  const vals = visible.flatMap((y) => y.pts.map((p) => p.v));
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const pad = Math.max(2, (hi - lo) * 0.08);
  const y0 = lo - pad, y1 = hi + pad;
  const X = (d: number) => L + (d / 365) * (W - L - R);
  const Y = (v: number) => T + ((y1 - v) / (y1 - y0)) * (H - T - B);
  const step = (y1 - y0) > 60 ? 20 : (y1 - y0) > 25 ? 10 : 5;
  const ticks: number[] = [];
  for (let v = Math.ceil(y0 / step) * step; v <= y1; v += step) ticks.push(v);

  // The week pointed at, else the latest week of the newest year shown.
  const newest = visible[0];
  const cursor = at ?? (newest ? newest.pts[newest.pts.length - 1].doy : 0);
  const near = (pts: Point[]) => {
    let best: Point | null = null;
    for (const p of pts) if (!best || Math.abs(p.doy - cursor) < Math.abs(best.doy - cursor)) best = p;
    return best && Math.abs(best.doy - cursor) <= (weekly ? 6 : 20) ? best : null;
  };

  const move = (clientX: number) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const d = ((clientX - r.left) / r.width * W - L) / (W - L - R) * 365;
    setAt(Math.max(0, Math.min(365, Math.round(d))));
  };
  const toggle = (y: number) => setShown(on.includes(y) ? on.filter((x) => x !== y) : [...on, y]);

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Years shown">
        {years.map((y) => {
          const isOn = on.includes(y.year);
          return (
            <button key={y.year} type="button" aria-pressed={isOn} onClick={() => toggle(y.year)}
              className={`inline-flex items-center gap-1.5 min-h-[30px] rounded-full px-2.5 text-[12px] font-medium border ${isOn ? "border-[var(--line2)] text-[var(--ink)]" : "border-dashed border-[var(--line)] text-[var(--ink3)]"}`}>
              <span className="w-2 h-2 rounded-full" style={{ background: isOn ? colourOf(y.year) : "transparent", border: isOn ? "none" : "1px solid var(--ink3)" }} />
              {y.year}
            </button>
          );
        })}
      </div>

      <div ref={box} className="relative">
        {/* While touched: every shown year's return at that week. */}
        {at !== null && visible.length > 0 && (
          <div className="absolute z-10 top-0 pointer-events-none rounded-xl border border-[var(--line2)] bg-[var(--card)] shadow-lg px-3 py-2 text-[12.5px] tabular-nums min-w-[150px]"
            style={{ left: Math.min(Math.max(X(cursor) - 75, 0), W - 160) }}>
            {visible.map((y) => {
              const p = near(y.pts);
              return (
                <div key={y.year} className="flex items-center gap-2 py-0.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: colourOf(y.year) }} />
                  <span className="font-semibold text-[var(--ink)]">{y.year}</span>
                  <span className={`ml-auto ${tone(p?.v)}`}>{pct(p?.v, 2)}</span>
                </div>
              );
            })}
            <p className="text-center text-[11px] text-[var(--ink3)] mt-0.5">{weekly ? "Week of " : ""}{dateOfDay(cursor)}</p>
          </div>
        )}
        <svg ref={svg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block touch-pan-y select-none" role="img"
          aria-label={`Return since 1 January for ${visible.map((v) => v.year).join(", ")}`}
          onPointerMove={(e) => move(e.clientX)} onPointerDown={(e) => move(e.clientX)} onPointerLeave={(e) => { if (e.pointerType === "mouse") setAt(null); }}>
          {[0, 90, 181, 273].map((d, i) => (
            <g key={d}>
              <line x1={X(d)} x2={X(d)} y1={T} y2={H - B} stroke="var(--line)" strokeDasharray="4 5" />
              <text x={X(d) + 3} y={H - 6} fill="var(--ink3)" fontSize="12">{["Jan", "Apr", "Jul", "Oct"][i]}</text>
            </g>
          ))}
          {ticks.map((v) => (
            <text key={v} x={W - R + 6} y={Y(v) + 4} fill="var(--ink3)" fontSize="11">{v > 0 ? "+" : ""}{v}%</text>
          ))}
          <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} stroke="var(--ink3)" strokeWidth="1" />
          {[...visible].reverse().map((y) => (
            <polyline key={y.year} fill="none" stroke={colourOf(y.year)} strokeWidth={y === newest ? 2.4 : 1.5} strokeLinejoin="round"
              points={y.pts.map((p) => `${X(p.doy).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ")} />
          ))}
          <line x1={X(cursor)} x2={X(cursor)} y1={T} y2={H - B} stroke="var(--ink3)" strokeWidth="1" />
          {visible.map((y) => {
            const p = near(y.pts);
            return p ? <circle key={y.year} cx={X(p.doy)} cy={Y(p.v)} r="4.5" fill={colourOf(y.year)} stroke="var(--card)" strokeWidth="2" /> : null;
          })}
        </svg>
      </div>

      {/* The same week in every year shown, then each year's whole result. */}
      <div className="mt-2 rounded-lg border border-[var(--line)] overflow-hidden text-[13px]">
        <div className="grid grid-cols-[64px_1fr_1fr] gap-2 px-3 py-1.5 text-[11px] text-[var(--ink3)] bg-[var(--card2)]">
          <span>Year</span>
          <span className="text-right">To {weekly ? "week of " : ""}{dateOfDay(cursor)}</span>
          <span className="text-right">Full year</span>
        </div>
        {years.map((y, i) => {
          const p = near(y.pts);
          const end = y.pts[y.pts.length - 1];
          const partial = i === 0 && end.doy < 355;
          return (
            <button key={y.year} type="button" onClick={() => toggle(y.year)} aria-pressed={on.includes(y.year)}
              className="w-full grid grid-cols-[64px_1fr_1fr] gap-2 px-3 py-1.5 border-t border-[var(--line)] tabular-nums text-left">
              <span className={`flex items-center gap-1.5 ${on.includes(y.year) ? "text-[var(--ink)] font-semibold" : "text-[var(--ink3)]"}`}>
                <span className="w-2 h-2 rounded-full" style={{ background: colourOf(y.year) }} />{y.year}
              </span>
              <span className={`text-right ${tone(p?.v)}`}>{pct(p?.v)}</span>
              <span className={`text-right ${tone(end.v)}`}>
                {pct(end.v)}{partial && <span className="text-[11px] text-[var(--ink3)]"> so far</span>}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-[var(--ink3)]">
        % from the last close of the year before · {weekly ? "weekly" : "monthly"} closes
      </p>
    </div>
  );
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
type Candle = [number, number, number, number, number, number];
const isoOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

/** A price file from public/charts (index, ETF, commodity): weekly closes
 *  from its weekly and daily candles, the last close of each week winning,
 *  plus its monthly closes for files too short for weeks. */
async function loadCloses(file: string): Promise<{ weekly: Pt[]; monthly: Pt[] } | null> {
  const r = await fetch(`${BASE}/charts/${encodeURIComponent(file)}.json`);
  if (!r.ok) return null;
  const d = await r.json() as { d?: Candle[]; w?: Candle[]; m?: Candle[] };
  const byWeek = new Map<number, [number, number]>();
  for (const c of [...(d.w ?? []), ...(d.d ?? [])]) {
    if (typeof c[4] === "number" && c[4] > 0) byWeek.set(Math.floor((c[0] + 3) / 7), [c[0], c[4]]);
  }
  const weekly = [...byWeek.values()].sort((a, b) => a[0] - b[0]).map(([day, v]) => [isoOf(day), v] as Pt);
  const monthly = (d.m ?? []).filter((c) => typeof c[4] === "number" && c[4] > 0).map((c) => [isoOf(c[0]), c[4]] as Pt);
  return { weekly, monthly };
}

/** Chart | Years above a page's own chart (index, ETF, commodity pages).
 *  `files` are tried in order; the first with two years of closes is used. */
export function YearsSwitch({ files, children }: { files: string[]; children: import("react").ReactNode }) {
  const [view, setView] = useState<"chart" | "years">("chart");
  const [prices, setPrices] = useState<{ weekly: Pt[]; monthly: Pt[] } | null | undefined>(undefined);
  const key = files.join("|");
  useEffect(() => {
    if (view !== "years" || prices !== undefined) return;
    let live = true;
    (async () => {
      for (const f of key.split("|").filter(Boolean)) {
        try {
          const got = await loadCloses(f);
          if (got && (got.weekly.length > 60 || got.monthly.length > 24)) { if (live) setPrices(got); return; }
        } catch { /* next file */ }
      }
      if (live) setPrices(null);
    })();
    return () => { live = false; };
  }, [view, prices, key]);
  return (
    <div>
      <div role="tablist" aria-label="Chart view" className="flex gap-4 px-3 border-b border-[var(--line)] mb-1 text-[13px]">
        {([["chart", "Chart"], ["years", "Years"]] as const).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
            className={`pb-2 pt-1 border-b-2 font-semibold ${view === k ? "border-[var(--accent)] text-[var(--ink)]" : "border-transparent text-[var(--ink3)]"}`}>
            {label}
          </button>
        ))}
      </div>
      {view === "chart" ? children : (
        <div className="px-3 pb-3 pt-1">
          {prices === undefined ? <div className="h-[240px] rs-skel" aria-busy="true" aria-label="Loading" />
            : <YearsChart prices={prices} />}
        </div>
      )}
    </div>
  );
}
