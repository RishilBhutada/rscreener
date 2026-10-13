"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import InfoTip from "@/components/InfoTip";
import { signed, tone } from "@/components/QuoteUI";

/** The US economy behind gold, each figure as far back as its publisher's
 *  records go: inflation, jobs, interest rates, growth, the dollar and oil,
 *  with recessions shaded behind. The file is pipeline/export_macro_json.py's
 *  and every figure in it is FRED's own - year-on-year changes and monthly
 *  averages included - so the only arithmetic here is the difference between
 *  one reading and the one before it.
 *
 *  Drawn as plain SVG rather than with the chart library the price charts
 *  use: recession bands are rectangles across the whole height, which that
 *  library has no shape for, and a monthly series a century long needs no
 *  zooming or panning - only the four ranges. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const DAY = 86400000;
// FRED's terms require this wherever its data is shown; the file carries it,
// and this stands in should a file ever arrive without it.
const FRED_NOTICE = "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.";

export type MacroSeries = {
  id: string;
  /** FRED's series id */
  fred: string;
  title: string;
  group: string;
  unit: string;
  kind: "line" | "bars";
  dec: number;
  freq: "monthly" | "quarterly" | "weekly";
  about: string;
  source: string;
  first: string;
  last: { date: string; value: number; prev?: number | null; prev_date?: string | null } | null;
  /** [date, value], oldest first; months with no figure are left out */
  points: [string, number][];
};

export type MacroDoc = {
  /** null until FRED has been read once */
  generated_at: string | null;
  notice: string;
  /** NBER recessions, [first month, last month] */
  recessions: [string, string][];
  groups: string[];
  series: MacroSeries[];
};

type Range = "5Y" | "10Y" | "20Y" | "Max";
const RANGES: [Range, number][] = [["5Y", 5], ["10Y", 10], ["20Y", 20], ["Max", 0]];
const STEP: Record<string, number> = { weekly: 7 * DAY, monthly: 30.44 * DAY, quarterly: 91.31 * DAY };

const toT = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
const yearsBefore = (t: number, n: number) => {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear() - n, d.getUTCMonth(), d.getUTCDate());
};

/** A reading's period as its publisher names it: "Aug 2026", "Q2 2026", "4 Oct 2026". */
function period(iso: string, freq: string, withYear = true): string {
  const d = new Date(toT(iso));
  if (freq === "quarterly") return `Q${Math.floor(d.getUTCMonth() / 3) + 1}${withYear ? ` ${d.getUTCFullYear()}` : ""}`;
  return d.toLocaleDateString("en-IN", {
    day: freq === "weekly" ? "numeric" : undefined, month: "short", year: withYear ? "numeric" : undefined, timeZone: "UTC",
  });
}

/** How a series' unit is written beside its figures: "2.9% y/y", "225K",
 *  "$6.62 trillion", "$72.4/barrel", "0.52 pts". */
function units(unit: string) {
  const u = (unit ?? "").trim();
  const pct = u.startsWith("%");
  const usd = u.startsWith("$");
  // Payrolls, claims and job openings come in thousands, unit "K". 225
  // thousand reads as 225K, and 7,744 thousand better as 7.74M.
  const thou = /^(k|thousands?)$/i.test(u);
  return {
    pct, usd, thou,
    rest: pct || usd ? u.slice(1).trim() : thou ? "" : u,
    // A change in a rate is in percentage points, not per cent: CPI going from
    // 2.7% to 2.9% is up 0.2 points, not up 7%.
    pts: pct || /^(pts|points|% ?pts)\b/i.test(u),
  };
}
type Units = ReturnType<typeof units>;

function figure(v: number, dec: number, u: Units, axis = false): string {
  const a = Math.abs(v);
  const fix = (n: number, d: number) => n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
  let s: string;
  if (u.thou && a >= 1000) {
    // On the axis 2,000 thousand is "2M", not "2.00M"; in the readout every digit stays.
    s = `${axis ? String(Number((a / 1000).toFixed(2))) : fix(a / 1000, 2)}M`;
  } else {
    s = `${fix(a, dec)}${u.thou && a > 0 ? "K" : ""}`;
  }
  // The minus comes from the digits shown, not the raw value: -0.04 shows as
  // 0.0%, never "−0.0%", which reads as a fall.
  const neg = v < 0 && /[1-9]/.test(s);
  return `${neg ? "−" : ""}${u.usd ? "$" : ""}${s}${u.pct ? "%" : ""}`;
}

function delta(d: number, s: MacroSeries, u: Units): string {
  if (u.pts) return `${signed(d, s.dec)} pts`;
  const word = u.usd && u.rest && !u.rest.startsWith("/") ? ` ${u.rest}` : "";
  return `${d > 0 ? "+" : ""}${figure(d, s.dec, u)}${word}`;
}

/** Chips name the series without its bracket - "Jobless claims", not
 *  "Jobless claims (weekly, monthly average)" - unless that would leave two
 *  chips reading the same, as the two PPIs would. */
function chipName(s: MacroSeries, all: MacroSeries[]): string {
  const cut = (t: string) => t.replace(/\s*\([^)]*\)\s*$/, "");
  const short = cut(s.title);
  return all.some((o) => o !== s && cut(o.title) === short) ? s.title : short;
}

/** Same rule as the company chart's axes: steps of 1, 2 or 5 of a power of ten. */
function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = mag * (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 0.01; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** Index of the first reading at or after time t (times.length if none). */
function firstFrom(times: number[], t: number, from = 0): number {
  let lo = from, hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Index of the reading nearest time t, from `from` on. */
function nearest(times: number[], from: number, t: number): number {
  const i = Math.min(firstFrom(times, t, from), times.length - 1);
  return i > from && t - times[i - 1] < times[i] - t ? i - 1 : i;
}

const chip = (on: boolean) => `rs-press shrink-0 min-h-[34px] px-3 rounded-full text-[13px] border whitespace-nowrap ${on
  ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)] font-semibold" : "text-[var(--ink2)] border-[var(--line)]"}`;
const pill = (on: boolean) => `shrink-0 min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold whitespace-nowrap ${on
  ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`;
const ROW = "flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** `fredUsed`: the page shows FRED figures elsewhere (the calendar's actuals).
 *  FRED's terms want its notice shown once, prominently; the card carries it,
 *  so when the card has nothing to draw it still prints the notice for them. */
export default function MacroCharts({ fredUsed = false }: { fredUsed?: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [doc, setDoc] = useState<MacroDoc | null>(null);
  const [none, setNone] = useState(false);
  const [id, setId] = useState("");
  // The series last looked at in each group, so going back to a group returns
  // to it rather than to the group's first chart.
  const [lastIn, setLastIn] = useState<Record<string, string>>({});
  const [range, setRange] = useState<Range>("10Y");
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [W, setW] = useState(0);

  // Fetched when the card comes near the screen, not with the page: decades of
  // two dozen series come to a few times the size of the gold page's own file,
  // and a visit for today's price should not pay for them.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let live = true;
    const load = () => fetch(`${BASE}/macro.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MacroDoc | null) => {
        if (!live) return;
        if (d && Array.isArray(d.series)) setDoc(d); else setNone(true);
      })
      // A static host answers a missing file with its HTML 404 page, which
      // fails here as JSON; either way there is nothing to draw yet.
      .catch(() => { if (live) setNone(true); });
    if (typeof IntersectionObserver === "undefined") { load(); return () => { live = false; }; }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
    }, { rootMargin: "300px 0px" });
    io.observe(el);
    return () => { live = false; io.disconnect(); };
  }, []);

  const list = useMemo(() => (doc?.series ?? []).filter((s) => Array.isArray(s.points) && s.points.length >= 2), [doc]);
  const groups = useMemo(() => {
    const order = [...(doc?.groups ?? []), ...list.map((s) => s.group)];
    return order.filter((g, i) => order.indexOf(g) === i && list.some((s) => s.group === g));
  }, [doc, list]);
  const cur = list.find((s) => s.id === id) ?? list[0] ?? null;
  const times = useMemo(() => (cur ? cur.points.map((p) => toT(p[0])) : []), [cur]);
  const u = useMemo(() => units(cur?.unit ?? ""), [cur]);
  const hasChart = !!cur;

  // The chart is drawn at the box's real width, one unit to a pixel, so its
  // labels are the size they say on a phone and on a desktop alike - a fixed
  // viewBox scaled to fit would shrink 11px text to 8px at 375 wide.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fit = () => setW(Math.floor(el.clientWidth));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasChart]);

  // The chosen chips brought fully into their rows: a chip tapped half off
  // the edge, or a group's remembered series further along its row, would
  // otherwise sit cut off. Scrolled by hand rather than scrollIntoView, which
  // would also scroll the page.
  const groupRow = useRef<HTMLDivElement>(null);
  const seriesRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    for (const row of [groupRow.current, seriesRow.current]) {
      const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!row || !on) continue;
      const a = row.getBoundingClientRect(), b = on.getBoundingClientRect();
      if (b.left < a.left) row.scrollTo({ left: row.scrollLeft + b.left - a.left - 12, behavior: "smooth" });
      else if (b.right > a.right) row.scrollTo({ left: row.scrollLeft + b.right - a.right + 12, behavior: "smooth" });
    }
  }, [cur?.id]);

  // A finger lifted leaves the reading on screen; a tap anywhere else clears it.
  useEffect(() => {
    if (hoverT === null) return;
    const away = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" && !svgRef.current?.contains(e.target as Node)) setHoverT(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [hoverT]);

  // Only the ranges this series is long enough for: 20Y on a series that
  // starts in 2006 would draw the same chart as Max.
  const avail = useMemo(() => RANGES.filter(([, n]) => !n || (times.length > 1 && yearsBefore(times[times.length - 1], n) > times[0]))
    .map(([r]) => r), [times]);
  const eff: Range = avail.includes(range) ? range : "Max";

  const H = W > 0 && W < 520 ? 210 : 250;
  const g = useMemo(() => {
    if (!cur || times.length < 2 || W < 120) return null;
    const n = times.length;
    const t1 = times[n - 1];
    const years = RANGES.find(([r]) => r === eff)![1];
    const from = years ? yearsBefore(t1, years) : times[0];
    const i0 = Math.min(firstFrom(times, from), n - 2);
    const vis = cur.points.slice(i0);
    const bars = cur.kind === "bars";
    const step = STEP[cur.freq] ?? (t1 - times[0]) / (n - 1);
    // Bars sit centred on their month, so the window opens half a month
    // early and closes half a month late, or the end bars are cut in half.
    const d0 = times[i0] - (bars ? step / 2 : 0), d1 = t1 + (bars ? step / 2 : 0);

    let lo = Infinity, hi = -Infinity;
    for (const p of vis) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
    // Bars grow from zero, so zero is always on the axis; a line is scaled to
    // its own range - 3% to 5% unemployment is a story, 0% to 5% flattens it.
    if (bars) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    const room = (hi - lo) * 0.06 || Math.abs(hi) * 0.1 || 1;
    const lo2 = bars && lo >= 0 ? 0 : lo - room, hi2 = bars && hi <= 0 ? 0 : hi + room;
    const ticks = niceTicks(lo2, hi2, 4);
    const yLo = Math.min(lo2, ticks[0] ?? lo2), yHi = Math.max(hi2, ticks[ticks.length - 1] ?? hi2);
    const tstep = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    const labels = ticks.map((v) => figure(v, tstep >= 1 ? 0 : tstep >= 0.1 ? 1 : 2, u, true));

    const ML = 6, MT = 8, MB = 20;
    const MR = Math.ceil(Math.max(...labels.map((l) => l.length)) * 6.6) + 12;
    const plotW = W - ML - MR, plotH = H - MT - MB;
    const x = (t: number) => ML + ((t - d0) / Math.max(1, d1 - d0)) * plotW;
    const y = (v: number) => MT + (1 - (v - yLo) / Math.max(1e-9, yHi - yLo)) * plotH;
    const f = (v: number) => v.toFixed(1);

    let line = "", up = "", down = "";
    if (bars) {
      const slot = (plotW * step) / Math.max(1, d1 - d0);
      // Decades of monthly bars are narrower than a pixel; drawn edge to edge
      // they read as a filled shape, which is what a gap-toothed comb at that
      // density would blur into anyway.
      const bw = slot < 3 ? slot : slot * 0.7;
      const y0 = f(y(0));
      vis.forEach((p, i) => {
        const seg = `M${(x(times[i0 + i]) - bw / 2).toFixed(2)},${y0}V${f(y(p[1]))}h${bw.toFixed(2)}V${y0}Z`;
        if (p[1] >= 0) up += seg; else down += seg;
      });
    } else {
      // A missing month or two is joined across; a longer silence - a series
      // that stopped and restarted - is left as a gap, not drawn as a ramp.
      let prev = -Infinity;
      vis.forEach((p, i) => {
        const t = times[i0 + i];
        line += `${t - prev > step * 3.5 ? "M" : "L"}${f(x(t))},${f(y(p[1]))}`;
        prev = t;
      });
    }

    // Each recession is shaded through the end of its last month.
    const bands = (doc?.recessions ?? []).map(([a, b]) => {
      const e = new Date(toT(b));
      return [toT(a), Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 1)];
    }).filter(([a, b]) => b > d0 && a < d1).map(([a, b]) => [x(Math.max(a, d0)), x(Math.min(b, d1))]);

    // Year labels at a whole step that fits about one per 44px.
    const ya = new Date(d0).getUTCFullYear(), yb = new Date(d1).getUTCFullYear();
    const fit = Math.max(2, Math.floor(plotW / 44));
    const ystep = [1, 2, 5, 10, 20, 25, 50].find((s) => (yb - ya) / s <= fit) ?? 100;
    const yearTicks: number[] = [];
    for (let yr = Math.ceil(ya / ystep) * ystep; yr <= yb; yr += ystep) {
      const t = Date.UTC(yr, 0, 1);
      if (t >= d0 && t <= d1 && x(t) >= ML + 14) yearTicks.push(t);
    }

    return {
      i0, vis, bars, ticks, labels, bands, yearTicks, line, up, down, x, y, ML, MR, MT, plotW, plotH,
      zero: yLo < 0 && yHi > 0 ? y(0) : bars ? y(0) : null, d0, d1,
    };
  }, [cur, times, eff, W, H, u, doc]);

  const point = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!g) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / Math.max(1, r.width));
    setHoverT(g.d0 + ((px - g.ML) / Math.max(1, g.plotW)) * (g.d1 - g.d0));
  };

  const pickSeries = (s: MacroSeries) => { setId(s.id); setLastIn((m) => ({ ...m, [s.group]: s.id })); setHoverT(null); };
  const pickGroup = (grp: string) => {
    const s = list.find((o) => o.id === lastIn[grp] && o.group === grp) ?? list.find((o) => o.group === grp);
    if (s) pickSeries(s);
  };

  // The reading on screen: the one under the finger, else the latest.
  const hi = g && hoverT !== null ? nearest(times, g.i0, hoverT) : null;
  let at: { date: string; value: number } | null = null, before: { date: string; value: number } | null = null;
  if (cur) {
    const n = cur.points.length;
    if (hi !== null) {
      at = { date: cur.points[hi][0], value: cur.points[hi][1] };
      before = hi > 0 ? { date: cur.points[hi - 1][0], value: cur.points[hi - 1][1] } : null;
    } else if (cur.last) {
      at = { date: cur.last.date, value: cur.last.value };
      before = cur.last.prev !== null && cur.last.prev !== undefined && cur.last.prev_date
        ? { date: cur.last.prev_date, value: cur.last.prev } : null;
    } else {
      at = { date: cur.points[n - 1][0], value: cur.points[n - 1][1] };
      before = { date: cur.points[n - 2][0], value: cur.points[n - 2][1] };
    }
  }
  // The difference of the two figures AS SHOWN, not of the file's values: the
  // file keeps one decimal more for the line, and 2.94 against 2.86 would
  // otherwise read "2.9%, +0.1 pts" beside a month that also reads 2.9% - where
  // the agency's own headline says unchanged. Rounded the way the figure is
  // written (Intl, halves away from zero), so the colour and the sign always
  // agree with what is on screen: 2.9 against 2.9 is no change, not a green +0.0.
  const asShown = (v: number, d: number) =>
    Number(v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }));
  const chg = cur && at && before
    ? Math.round((asShown(at.value, cur.dec) - asShown(before.value, cur.dec)) * 10 ** cur.dec) / 10 ** cur.dec : null;
  const sameYear = at && before && at.date.slice(0, 4) === before.date.slice(0, 4);

  const inGroup = cur ? list.filter((s) => s.group === cur.group) : [];
  const showRange = avail.length > 1;
  const showBands = !!g && g.bands.length > 0;

  return (
    <div ref={rootRef}>
      {!doc && !none && <div className="mx-3 mb-3 h-[300px] rs-skel" aria-busy="true" aria-label="Loading" />}
      {(none || (doc && !cur)) && (
        <p className="px-3 pb-3 text-[13px] text-[var(--ink3)]">US economic history arrives with the next data run</p>
      )}
      {(none || (doc && !cur)) && fredUsed && (
        <p className="px-3 pb-3 text-[11px] leading-snug text-[var(--ink3)]">{doc?.notice || FRED_NOTICE}</p>
      )}

      {doc && cur && at && (
        <>
          {groups.length > 1 && (
            <div ref={groupRow} className={`${ROW} gap-2 px-3 pb-2`}>
              {groups.map((grp) => (
                <button key={grp} type="button" onClick={() => pickGroup(grp)} aria-pressed={cur.group === grp} className={chip(cur.group === grp)}>
                  {grp}
                </button>
              ))}
            </div>
          )}
          {inGroup.length > 1 && (
            <div ref={seriesRow} className={`${ROW} gap-1 px-2`}>
              {inGroup.map((s) => (
                <button key={s.id} type="button" onClick={() => pickSeries(s)} aria-pressed={cur.id === s.id} className={pill(cur.id === s.id)}>
                  {chipName(s, inGroup)}
                </button>
              ))}
            </div>
          )}

          <div className="px-3 pt-2">
            <div className="flex items-center gap-1 min-w-0">
              <h3 className="text-[13px] font-semibold truncate">{cur.title}</h3>
              <InfoTip title={cur.title}>
                <p>{cur.about}</p>
                <p className="text-[12px] text-[var(--ink3)]">
                  {cur.source} via FRED, series {cur.fred}. {cur.freq.charAt(0).toUpperCase() + cur.freq.slice(1)}, from {period(cur.first || cur.points[0][0], cur.freq)}.
                </p>
              </InfoTip>
              <span className="ml-auto shrink-0 text-[11px] text-[var(--ink3)]">Since {(cur.first || cur.points[0][0]).slice(0, 4)}</span>
            </div>
            <p className="flex items-baseline flex-wrap gap-x-2 tabular-nums">
              <span className="text-2xl font-bold">
                {figure(at.value, cur.dec, u)}
                {u.rest && <span className={`text-[13px] font-normal text-[var(--ink3)] ${u.rest.startsWith("/") ? "" : "ml-1"}`}>{u.rest}</span>}
              </span>
              {chg !== null && before && (
                <span className={`text-[13px] font-semibold ${tone(chg)}`}>
                  {delta(chg, cur, u)} <span className="font-normal text-[var(--ink3)]">vs {period(before.date, cur.freq, !sameYear)}</span>
                </span>
              )}
            </p>
            <p className="text-[12px] text-[var(--ink3)] tabular-nums">{period(at.date, cur.freq)}</p>
          </div>

          <div ref={boxRef} className="mt-1" style={{ height: H }}>
            {g && (
              <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
                aria-label={`${cur.title}, ${period(g.vis[0][0], cur.freq)} to ${period(g.vis[g.vis.length - 1][0], cur.freq)}`}
                // pan-y: a sideways drag reads the chart, an up-down swipe still
                // scrolls the page - the card sits mid-page, and a chart that
                // swallowed every touch would trap the thumb scrolling past it.
                className="block select-none touch-pan-y cursor-crosshair"
                onPointerDown={point} onPointerMove={point}
                onPointerLeave={(e) => { if (e.pointerType === "mouse") setHoverT(null); }}
                // The browser took the touch for a scroll: it was not a reading.
                onPointerCancel={() => setHoverT(null)}>
                {g.ticks.map((v, i) => (
                  <g key={v}>
                    <line x1={g.ML} x2={W - g.MR} y1={g.y(v)} y2={g.y(v)} stroke="var(--chart-grid)" strokeWidth="1" />
                    <text x={W - g.MR + 6} y={g.y(v) + 4} fontSize="11" fill="var(--chart-axis)" className="tabular-nums">{g.labels[i]}</text>
                  </g>
                ))}
                {/* Over the grid, not under it: the dark theme's grid is darker
                    than the shading, and drawn on top it cut each band into blocks. */}
                {g.bands.map(([a, b]) => (
                  <rect key={a} x={a} y={g.MT} width={Math.max(1, b - a)} height={g.plotH} fill="var(--ink3)" opacity="0.16" />
                ))}
                <line x1={g.ML} x2={W - g.MR} y1={g.MT + g.plotH} y2={g.MT + g.plotH} stroke="var(--line)" strokeWidth="1" />
                {g.yearTicks.map((t) => (
                  <text key={t} x={g.x(t)} y={H - 5} fontSize="11" fill="var(--chart-axis)" textAnchor="middle" className="tabular-nums">
                    {new Date(t).getUTCFullYear()}
                  </text>
                ))}
                {g.zero !== null && (
                  <line x1={g.ML} x2={W - g.MR} y1={g.zero} y2={g.zero} stroke="var(--chart-axis)" strokeWidth="1" opacity="0.7" />
                )}
                {g.bars ? (
                  <>
                    <path d={g.up} fill="var(--pos)" opacity="0.85" />
                    <path d={g.down} fill="var(--neg)" opacity="0.85" />
                  </>
                ) : (
                  <path d={g.line} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
                )}
                {hi !== null && (
                  <g pointerEvents="none">
                    <line x1={g.x(times[hi])} x2={g.x(times[hi])} y1={g.MT} y2={g.MT + g.plotH} stroke="var(--chart-axis)" strokeWidth="1" strokeDasharray="2 3" />
                    <circle cx={g.x(times[hi])} cy={g.y(cur.points[hi][1])} r="3.5" stroke="var(--card)" strokeWidth="1.5"
                      fill={!g.bars ? "var(--accent)" : cur.points[hi][1] < 0 ? "var(--neg)" : "var(--pos)"} />
                  </g>
                )}
              </svg>
            )}
          </div>

          {(showRange || showBands) && (
            <div className="flex items-center gap-1 px-2 pt-1">
              {showRange && (
                <div role="radiogroup" aria-label="Range" className="flex items-center gap-1">
                  {RANGES.filter(([r]) => avail.includes(r)).map(([r]) => (
                    <button key={r} role="radio" aria-checked={eff === r} onClick={() => { setRange(r); setHoverT(null); }}
                      className={`min-h-[34px] px-2.5 rounded-lg text-[13px] font-semibold ${eff === r ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`}>
                      {r}
                    </button>
                  ))}
                </div>
              )}
              {showBands && (
                <span className="ml-auto pr-1 inline-flex items-center gap-1.5 text-[11px] text-[var(--ink3)]">
                  <i className="inline-block w-2.5 h-3 rounded-[2px] bg-[var(--ink3)] opacity-40" aria-hidden="true" />
                  Recession
                </span>
              )}
            </div>
          )}

          <p className="px-3 pt-2 pb-3 text-[11px] leading-snug text-[var(--ink3)]">
            {doc.generated_at && !Number.isNaN(Date.parse(doc.generated_at)) && (
              <>Read from FRED {new Date(doc.generated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}. </>
            )}
            {doc.notice || FRED_NOTICE}
          </p>
        </>
      )}
    </div>
  );
}
