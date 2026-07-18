"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import { Row } from "@/lib/query";
import { loadNote, loadWatchlist, saveNote, toggleWatch } from "@/lib/store";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Stmt = { periods: string[]; items: { label: string; values: (number | null)[] }[] };
type AnnualReport = { from: string; to: string; url: string };
type AnnDoc = { date: string; title: string; url: string };
type Trend = {
  periods: string[];
  revenue: (number | null)[];
  pat: (number | null)[];
  eps: (number | null)[];
  source: string[];
};
type Shareholding = {
  dates: string[];
  promoter: (number | null)[];
  public: (number | null)[];
  employee: (number | null)[];
};
type Pt = [string, number] | [string, number, number | null];
type Prices = { monthly?: Pt[]; weekly?: Pt[]; daily?: Pt[] };
type PeBand = { series: [string, number][]; median_5y: number };

function sma(series: Pt[], window: number): (number | null)[] {
  let sum = 0;
  return series.map((pt, i) => {
    sum += pt[1];
    if (i >= window) sum -= series[i - window][1];
    return i >= window - 1 ? sum / window : null;
  });
}
type Company = {
  generated_at: string;
  snapshot: Row;
  statements: Record<string, Stmt>;
  documents?: { annual_reports?: AnnualReport[]; concalls?: AnnDoc[]; ratings?: AnnDoc[] };
  trend?: { annual?: Trend; quarterly?: Trend };
  shareholding?: Shareholding;
  prices?: Prices | null;
  pe_band?: PeBand | null;
};

const RANGES: [string, number, "d" | "m"][] = [
  ["1M", 22, "d"], ["6M", 125, "d"], ["1Y", 250, "d"],
  ["3Y", 36, "m"], ["5Y", 60, "m"], ["10Y", 120, "m"], ["Max", 0, "m"],
];

function fmtVol(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

function PriceChart({ prices, peBand, trendQ, livePrice }: { prices: Prices; peBand?: PeBand | null; trendQ?: Trend | null; livePrice: number | null }) {
  const [range, setRange] = useState("1Y");
  const [view, setView] = useState<"price" | "pe" | "sales" | "eps">("price");
  const [showDma, setShowDma] = useState(false);
  const [hover, setHover] = useState<{ idx: number; px: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const daily = useMemo(() => prices.daily ?? [], [prices]);
  const rangeDef = RANGES.find(([r]) => r === range) ?? RANGES[2];
  const rN = rangeDef[1], rFreq = rangeDef[2];

  const { pts, dmaWindowed } = useMemo(() => {
    if (view === "pe") {
      const s: Pt[] = (peBand?.series ?? []) as Pt[];
      const n = rFreq === "d" ? 12 : rN === 0 ? s.length : rN;
      return { pts: s.slice(-Math.max(n, 12)), dmaWindowed: null as { d50: (number | null)[]; d200: (number | null)[] } | null };
    }
    let base: Pt[];
    if (rFreq === "d" && daily.length > 30) base = daily.slice(-rN);
    else if (rFreq === "d") base = (prices.weekly ?? prices.monthly ?? []).slice(-Math.ceil(rN / 5));
    else base = (prices.monthly ?? []).slice(rN === 0 ? 0 : -rN);
    let dmaW: { d50: (number | null)[]; d200: (number | null)[] } | null = null;
    if (showDma && rFreq === "d" && daily.length >= 220) {
      dmaW = { d50: sma(daily, 50).slice(-base.length), d200: sma(daily, 200).slice(-base.length) };
    }
    if (livePrice !== null && base.length > 0) {
      base = [...base, [new Date().toISOString().slice(0, 10), livePrice, null]];
      if (dmaW) { dmaW.d50.push(dmaW.d50[dmaW.d50.length - 1]); dmaW.d200.push(dmaW.d200[dmaW.d200.length - 1]); }
    }
    return { pts: base, dmaWindowed: dmaW };
  }, [prices, peBand, daily, rN, rFreq, view, livePrice, showDma]);

  if (view === "sales" || view === "eps") {
    return (
      <QuarterChart view={view} setView={setView} trendQ={trendQ ?? null} hasPe={!!peBand} hasSales={!!trendQ} />
    );
  }
  if (pts.length < 2) return null;

  const W = 900, mainH = 208, volH = 50, padTop = 16, gap = 8;
  const H = padTop + mainH + gap + volH + 22;
  const padX = 2;
  const values = pts.map((pt) => pt[1]);
  const vols = pts.map((pt) => (pt.length > 2 ? (pt[2] as number | null) : null));
  const hasVol = vols.some((v) => v !== null && v > 0);
  const median = view === "pe" ? peBand?.median_5y ?? null : null;
  const dmaVals = dmaWindowed ? [...dmaWindowed.d50, ...dmaWindowed.d200].filter((v): v is number => v !== null) : [];
  const min = Math.min(...values, ...(median !== null ? [median] : []), ...dmaVals);
  const max = Math.max(...values, ...(median !== null ? [median] : []), ...dmaVals);
  const span = max - min || 1;
  const x = (i: number) => padX + (i / (pts.length - 1)) * (W - 2 * padX);
  const y = (v: number) => padTop + (1 - (v - min) / span) * mainH;
  const maxVol = Math.max(...vols.map((v) => v ?? 0), 1);
  const volY0 = padTop + mainH + gap + volH;
  const line = pts.map((pt, i) => `${x(i).toFixed(1)},${y(pt[1]).toFixed(1)}`).join(" ");
  const change = ((values[values.length - 1] / values[0]) - 1) * 100;
  const up = change >= 0;
  const color = view === "pe" ? "var(--chart-line2)" : up ? "var(--chart-pos)" : "var(--chart-neg)";
  const dateLbl = (iso: string, full = false) =>
    new Date(iso).toLocaleDateString("en-IN", full ? { day: "numeric", month: "short", year: "numeric" } : { month: "short", year: "2-digit" });

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHover({ idx: Math.round(frac * (pts.length - 1)), px: e.clientX - rect.left });
  };
  const h = hover && pts[hover.idx] ? hover : null;
  const hp = h ? pts[h.idx] : null;
  const boxW = svgRef.current?.getBoundingClientRect().width ?? 600;

  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="flex items-center gap-3 flex-wrap">
          <ChartTabs view={view} setView={setView} hasPe={!!peBand} hasSales={!!trendQ} />
          <p className="text-sm font-semibold text-[var(--ink2)]">
            {view === "pe" ? (
              <>P/E {values[values.length - 1]?.toFixed(1)} <span className="font-normal text-[var(--ink3)]">· 5y median {peBand?.median_5y}</span></>
            ) : (
              <>
                <span className={`font-bold ${up ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>{up ? "+" : ""}{change.toFixed(1)}%</span>
                <span className="font-normal text-[var(--ink3)]"> {range}</span>
              </>
            )}
          </p>
          {view === "price" && rFreq === "d" && daily.length >= 220 && (
            <button onClick={() => setShowDma(!showDma)}
              className={`text-xs rounded-full px-3 py-1 border ${showDma ? "bg-[var(--warn-soft)] border-[var(--warn-line)] text-[var(--warn-ink)] font-semibold" : "bg-[var(--card)] border-[var(--line)] text-[var(--ink3)]"}`}>
              50/200 DMA
            </button>
          )}
        </div>
        <div className="flex gap-1 text-xs">
          {RANGES.map(([r]) => (
            <button key={r} onClick={() => setRange(r)}
              className={`rounded-full px-2.5 py-1 border ${range === r ? "bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--accent-ink)] font-semibold" : "bg-[var(--card)] border-[var(--line)] text-[var(--ink3)]"}`}>
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="w-full touch-none select-none"
          style={{ height: 300 }}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="rsPriceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={view === "pe" ? "#8b5cf6" : up ? "#10b981" : "#ef4444"} stopOpacity="0.16" />
              <stop offset="100%" stopColor={view === "pe" ? "#8b5cf6" : up ? "#10b981" : "#ef4444"} stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={padX} x2={W - padX} y1={padTop + mainH * f} y2={padTop + mainH * f} stroke="var(--chart-grid)" strokeWidth="1" strokeDasharray="3 5" />
          ))}

          <polygon points={`${padX},${y(values[0]).toFixed(1)} ${line} ${(W - padX).toFixed(1)},${padTop + mainH} ${padX},${padTop + mainH}`} fill="url(#rsPriceFill)" />
          <polyline points={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />

          {dmaWindowed && (
            <g>
              <polyline points={dmaWindowed.d50.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(" ")} fill="none" stroke="var(--chart-dma50)" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
              <polyline points={dmaWindowed.d200.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(" ")} fill="none" stroke="var(--chart-dma200)" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
            </g>
          )}

          {median !== null && (
            <g>
              <line x1={padX} y1={y(median)} x2={W - padX} y2={y(median)} stroke="var(--chart-axis)" strokeWidth="1" strokeDasharray="6 4" />
              <text x={W - padX} y={y(median) - 5} fontSize="11" fill="var(--chart-axis)" textAnchor="end">median {median}</text>
            </g>
          )}

          {hasVol && vols.map((v, i) => {
            if (v === null || v <= 0) return null;
            const bh = (v / maxVol) * volH;
            const bw = Math.max(((W - 2 * padX) / pts.length) * 0.65, 1);
            return <rect key={i} x={x(i) - bw / 2} y={volY0 - bh} width={bw} height={bh} fill="var(--chart-axis)" opacity="0.35" />;
          })}

          <text x={padX + 2} y={padTop - 4} fontSize="11" fill="var(--chart-axis)">{view === "pe" ? "" : "₹"}{max.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</text>
          <text x={padX + 2} y={padTop + mainH - 4} fontSize="11" fill="var(--chart-axis)">{view === "pe" ? "" : "₹"}{min.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</text>
          <text x={padX} y={H - 6} fontSize="11" fill="var(--chart-axis)">{dateLbl(String(pts[0][0]))}</text>
          <text x={W / 2} y={H - 6} fontSize="11" fill="var(--chart-axis)" textAnchor="middle">{dateLbl(String(pts[Math.floor(pts.length / 2)][0]))}</text>
          <text x={W - padX} y={H - 6} fontSize="11" fill="var(--chart-axis)" textAnchor="end">{dateLbl(String(pts[pts.length - 1][0]))}</text>

          {h && hp && (
            <g>
              <line x1={x(h.idx)} x2={x(h.idx)} y1={padTop} y2={volY0} stroke="var(--chart-axis)" strokeWidth="1" strokeDasharray="2 3" />
              <circle cx={x(h.idx)} cy={y(hp[1])} r="3.5" fill={color} stroke="var(--card)" strokeWidth="1.5" />
            </g>
          )}
        </svg>

        {h && hp && (
          <div
            className="absolute top-1 pointer-events-none bg-[var(--card)] border border-[var(--line2)] rounded-lg shadow-lg px-3 py-2 text-xs space-y-0.5 z-10"
            style={h.px < boxW / 2 ? { left: h.px + 14 } : { right: boxW - h.px + 14 }}
          >
            <p className="font-semibold text-[var(--ink)]">{dateLbl(String(hp[0]), true)}</p>
            <p className="text-[var(--ink2)]">{view === "pe" ? "P/E " : "₹ "}<span className="font-semibold tabular-nums">{hp[1].toLocaleString("en-IN")}</span></p>
            {dmaWindowed && dmaWindowed.d50[h.idx] != null && (
              <p className="tabular-nums" style={{ color: "var(--chart-dma50)" }}>DMA50 ₹{Math.round(dmaWindowed.d50[h.idx] as number).toLocaleString("en-IN")}</p>
            )}
            {dmaWindowed && dmaWindowed.d200[h.idx] != null && (
              <p className="tabular-nums" style={{ color: "var(--chart-dma200)" }}>DMA200 ₹{Math.round(dmaWindowed.d200[h.idx] as number).toLocaleString("en-IN")}</p>
            )}
            {hasVol && vols[h.idx] != null && (vols[h.idx] as number) > 0 && (
              <p className="text-[var(--ink3)] tabular-nums">Vol {fmtVol(vols[h.idx] as number)}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ChartTabs({ view, setView, hasPe, hasSales }: {
  view: string; setView: (v: "price" | "pe" | "sales" | "eps") => void; hasPe: boolean; hasSales: boolean;
}) {
  const tabs: [string, string][] = [["price", "Price"]];
  if (hasPe) tabs.push(["pe", "P/E"]);
  if (hasSales) tabs.push(["sales", "Sales & Margin"], ["eps", "EPS"]);
  if (tabs.length < 2) return null;
  return (
    <div className="flex gap-1 text-xs">
      {tabs.map(([v, label]) => (
        <button key={v} onClick={() => setView(v as "price" | "pe" | "sales" | "eps")}
          className={`rounded-full px-3 py-1 border ${view === v ? "bg-[var(--btn)] border-[var(--btn)] text-[var(--btn-ink)] font-semibold" : "bg-[var(--card)] border-[var(--line)] text-[var(--ink3)]"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function QuarterChart({ view, setView, trendQ, hasPe, hasSales }: {
  view: "sales" | "eps"; setView: (v: "price" | "pe" | "sales" | "eps") => void;
  trendQ: Trend | null; hasPe: boolean; hasSales: boolean;
}) {
  if (!trendQ) return null;
  const n = trendQ.periods.length;
  const W = 640, H = 200, padX = 14, base = 150;
  const bw = Math.min(36, (W - 2 * padX) / n - 10);
  const step = (W - 2 * padX) / n;
  const qLbl = (iso: string) => {
    const d = new Date(iso);
    return `${["Q4", "Q1", "Q2", "Q3"][Math.floor(d.getMonth() / 3)]}'${String(d.getFullYear()).slice(-2)}`;
  };

  if (view === "eps") {
    const vals = trendQ.eps.map((v) => v ?? 0);
    const maxAbs = Math.max(...vals.map(Math.abs), 1);
    const scale = 110 / maxAbs;
    return (
      <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <ChartTabs view={view} setView={setView} hasPe={hasPe} hasSales={hasSales} />
          <p className="text-sm font-semibold text-[var(--ink2)]">EPS <span className="font-normal text-[var(--ink3)]">₹ per quarter, as filed</span></p>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          <line x1={padX} y1={base} x2={W - padX} y2={base} stroke="var(--chart-grid)" />
          {vals.map((v, i) => {
            const x0 = padX + i * step + (step - bw) / 2;
            const h = Math.abs(v) * scale;
            const y0 = v >= 0 ? base - h : base;
            return (
              <g key={i}>
                <rect x={x0} y={y0} width={bw} height={Math.max(h, 1)} rx="2" fill={v >= 0 ? "var(--chart-alt)" : "var(--chart-neg)"} />
                {i % 2 === 0 && <text x={x0 + bw / 2} y={H - 24} textAnchor="middle" fontSize="9" fill="var(--chart-axis)">{qLbl(trendQ.periods[i])}</text>}
                <text x={x0 + bw / 2} y={v >= 0 ? y0 - 4 : base + h + 10} textAnchor="middle" fontSize="8.5" fill="var(--chart-value)">{v.toFixed(1)}</text>
              </g>
            );
          })}
        </svg>
      </section>
    );
  }

  const revs = trendQ.revenue.map((v) => v ?? 0);
  const maxRev = Math.max(...revs, 1);
  const scale = 110 / maxRev;
  const margins = trendQ.periods.map((_, i) => {
    const r = trendQ.revenue[i], p = trendQ.pat[i];
    return r && p !== null && p !== undefined ? (p / r) * 100 : null;
  });
  const mVals = margins.filter((m): m is number => m !== null);
  const mMin = Math.min(...mVals, 0), mMax = Math.max(...mVals, 1);
  const mSpan = mMax - mMin || 1;
  const mY = (m: number) => 30 + (1 - (m - mMin) / mSpan) * 100;
  const mLine = margins
    .map((m, i) => (m === null ? null : `${(padX + i * step + step / 2).toFixed(1)},${mY(m).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");

  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <ChartTabs view={view} setView={setView} hasPe={hasPe} hasSales={hasSales} />
        <p className="text-sm font-semibold text-[var(--ink2)]">
          Sales &amp; Margin <span className="font-normal text-[var(--ink3)]">· <span className="text-[var(--pos)]">bars ₹Cr revenue</span> · <span className="text-violet-600">line PAT margin %</span></span>
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1={padX} y1={base} x2={W - padX} y2={base} stroke="var(--chart-grid)" />
        {revs.map((v, i) => {
          const x0 = padX + i * step + (step - bw) / 2;
          const h = v * scale;
          return (
            <g key={i}>
              <rect x={x0} y={base - h} width={bw} height={Math.max(h, 1)} rx="2" fill="var(--chart-pos)" opacity="0.85" />
              {i % 2 === 0 && <text x={x0 + bw / 2} y={H - 24} textAnchor="middle" fontSize="9" fill="var(--chart-axis)">{qLbl(trendQ.periods[i])}</text>}
            </g>
          );
        })}
        <polyline points={mLine} fill="none" stroke="var(--chart-line2)" strokeWidth="2" />
        {margins.map((m, i) =>
          m === null ? null : (
            <circle key={i} cx={padX + i * step + step / 2} cy={mY(m)} r="2.5" fill="var(--chart-line2)" />
          )
        )}
        {mVals.length > 0 && (
          <text x={W - padX} y={mY(margins[margins.length - 1] ?? mVals[mVals.length - 1]) - 6} fontSize="10" fill="var(--chart-line2)" textAnchor="end">
            {(margins[margins.length - 1] ?? mVals[mVals.length - 1]).toFixed(1)}%
          </text>
        )}
      </svg>
    </section>
  );
}
type ScreenData = { rows: Row[] };

function trendToStmt(t: Trend): Stmt {
  const margin = t.periods.map((_, i) => {
    const r = t.revenue[i], p = t.pat[i];
    return r && p !== null && p !== undefined ? Math.round((p / r) * 1000) / 10 : null;
  });
  return {
    periods: t.periods,
    items: [
      { label: "Revenue", values: t.revenue },
      { label: "Net Profit", values: t.pat },
      { label: "EPS (Rs)", values: t.eps },
      { label: "PAT margin %", values: margin },
    ],
  };
}

const STMT_TITLES: Record<string, string> = {
  quarterly_results: "Quarterly Results",
  annual_pnl: "Profit & Loss (annual)",
  balance_sheet: "Balance Sheet",
  cash_flow: "Cash Flow",
};

function fmtNum(v: number | string | null | undefined, dec = 2): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return v.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

function periodLabel(p: string): string {
  return new Date(p).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function StatementTable({ title, stmt, subtitle, boldRows }: { title: string; stmt: Stmt; subtitle?: string; boldRows?: string[] }) {
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
      <div className="px-4 pt-3.5 pb-2">
        <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
        <p className="text-xs text-[var(--ink3)] mt-0.5">{subtitle ?? "Figures in ₹ Crores"}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
              <th className="px-3 py-2 text-left font-medium sticky left-0 bg-[var(--card)]"> </th>
              {stmt.periods.map((p) => (
                <th key={p} className="px-3 py-2 text-right font-medium whitespace-nowrap">{periodLabel(p)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stmt.items.map((it) => {
              const bold = boldRows?.includes(it.label);
              return (
                <tr key={it.label} className="border-b border-[var(--line)] hover:bg-[var(--card2)]">
                  <td className={`px-3 py-1.5 whitespace-nowrap sticky left-0 bg-[var(--card)] ${bold ? "font-semibold text-[var(--ink)]" : "text-[var(--ink2)]"}`}>{it.label}</td>
                  {it.values.map((v, i) => (
                    <td key={i} className={`px-3 py-1.5 text-right whitespace-nowrap tabular-nums ${bold ? "font-semibold" : ""} ${typeof v === "number" && v < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]"}`}>
                      {fmtNum(v, it.label.includes("EPS") || it.label.includes("%") ? 2 : 0)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function cagr(values: (number | null)[], years: number): number | null {
  const clean = values.filter((v): v is number => v !== null && v !== undefined);
  if (clean.length < years + 1) return null;
  const last = clean[clean.length - 1], start = clean[clean.length - 1 - years];
  if (!last || !start || start <= 0 || last <= 0) return null;
  return Math.round((Math.pow(last / start, 1 / years) - 1) * 100);
}

function GrowthCard({ title, rows }: { title: string; rows: [string, number | null][] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-[var(--ink2)] mb-1.5">{title}</p>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, v]) => (
            <tr key={label} className="border-b border-[var(--line)] last:border-0">
              <td className="py-1 text-[var(--ink3)]">{label}</td>
              <td className={`py-1 text-right font-medium tabular-nums ${v !== null && v < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]"}`}>
                {v === null ? "—" : `${v}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompoundedGrowth({ trend, prices }: { trend?: { annual?: Trend }; prices?: Prices | null }) {
  const a = trend?.annual;
  if (!a) return null;
  const monthly = prices?.monthly ?? [];
  const stockCagr = (months: number): number | null => {
    if (monthly.length <= months) return null;
    const last = monthly[monthly.length - 1][1], start = monthly[monthly.length - 1 - months][1];
    if (!last || !start || start <= 0) return null;
    return Math.round((Math.pow(last / start, 12 / months) - 1) * 100);
  };
  const cards: [string, [string, number | null][]][] = [
    ["Compounded sales growth", [["10 years", cagr(a.revenue, 10)], ["5 years", cagr(a.revenue, 5)], ["3 years", cagr(a.revenue, 3)], ["1 year", cagr(a.revenue, 1)]]],
    ["Compounded profit growth", [["10 years", cagr(a.pat, 10)], ["5 years", cagr(a.pat, 5)], ["3 years", cagr(a.pat, 3)], ["1 year", cagr(a.pat, 1)]]],
    ["Stock price CAGR", [["10 years", stockCagr(120)], ["5 years", stockCagr(60)], ["3 years", stockCagr(36)], ["1 year", stockCagr(12)]]],
  ];
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 grid sm:grid-cols-3 gap-6">
      {cards.map(([title, rows]) => (
        <GrowthCard key={title} title={title} rows={rows} />
      ))}
    </section>
  );
}

function num(r: Row | null, k: string): number | null {
  const v = r?.[k];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function ProsCons({ row }: { row: Row | null }) {
  if (!row) return null;
  const pros: string[] = [];
  const cons: string[] = [];
  const roce = num(row, "roce"), roe = num(row, "roe"), dy = num(row, "div_yield");
  const de = num(row, "de"), sg = num(row, "sales_cagr_5y"), pg = num(row, "profit_cagr_5y");
  const payout = num(row, "div_payout"), prom = num(row, "promoter_holding");
  const pe = num(row, "pe"), medpe = num(row, "median_pe_5y"), offHigh = num(row, "off_52w_high");

  if (roce !== null && roce > 20) pros.push(`Efficient use of capital — ROCE of ${roce.toFixed(0)}%.`);
  if (roe !== null && roe > 15) pros.push(`Strong return on equity of ${roe.toFixed(0)}%.`);
  if (dy !== null && dy > 2) pros.push(`Healthy dividend yield of ${dy.toFixed(1)}%.`);
  if (de !== null && de < 0.1) pros.push(`Nearly debt-free (debt-to-equity ${de.toFixed(2)}).`);
  if (pg !== null && pg > 15) pros.push(`Profit compounded at ${pg.toFixed(0)}% a year over 5 years.`);
  if (payout !== null && payout >= 20 && payout <= 80) pros.push(`Sustainable dividend payout of ${payout.toFixed(0)}%.`);

  if (sg !== null && sg < 10) cons.push(`Modest sales growth of ${sg.toFixed(0)}% a year over 5 years.`);
  if (de !== null && de > 1) cons.push(`Carries meaningful debt (debt-to-equity ${de.toFixed(1)}).`);
  if (roe !== null && roe < 10) cons.push(`Low return on equity of ${roe.toFixed(0)}%.`);
  if (pe !== null && medpe !== null && pe > medpe * 1.3) cons.push(`Trading above its 5-year median P/E (${pe.toFixed(0)} vs ${medpe.toFixed(0)}).`);
  if (prom !== null && prom < 35) cons.push(`Low promoter holding of ${prom.toFixed(0)}%.`);
  if (offHigh !== null && offHigh < -40) cons.push(`Down ${Math.abs(offHigh).toFixed(0)}% from its 52-week high.`);

  if (pros.length === 0 && cons.length === 0) return null;
  return (
    <section className="grid sm:grid-cols-2 gap-4">
      <div className="rounded-xl border border-[var(--pos)] bg-[color-mix(in_oklab,var(--pos)_8%,var(--card))] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--pos)] mb-2">Pros</p>
        <ul className="space-y-1.5 text-sm text-[var(--ink2)] list-disc pl-4">
          {pros.length ? pros.map((p) => <li key={p}>{p}</li>) : <li className="list-none text-[var(--ink3)]">No standout positives from the current numbers.</li>}
        </ul>
      </div>
      <div className="rounded-xl border border-[var(--neg)] bg-[color-mix(in_oklab,var(--neg)_8%,var(--card))] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--neg)] mb-2">Cons</p>
        <ul className="space-y-1.5 text-sm text-[var(--ink2)] list-disc pl-4">
          {cons.length ? cons.map((c) => <li key={c}>{c}</li>) : <li className="list-none text-[var(--ink3)]">No obvious red flags from the current numbers.</li>}
        </ul>
      </div>
      <p className="sm:col-span-2 text-xs text-[var(--ink3)]">These are generated from the numbers by simple rules — not analysis, and never a recommendation. Verify against the filings before trusting anything.</p>
    </section>
  );
}

function RatioGrid({ snapshot, row }: { snapshot: Row; row: Row | null }) {
  const g = (k: string) => num(row, k) ?? num(snapshot, k);
  const cells: [string, string][] = [
    ["Market Cap", `₹ ${fmtNum(g("mcap"), 0)} Cr`],
    ["Current Price", `₹ ${fmtNum(g("price"))}`],
    ["High / Low", `₹ ${fmtNum(g("wk52_high"), 0)} / ${fmtNum(g("wk52_low"), 0)}`],
    ["Stock P/E", fmtNum(g("pe"))],
    ["Book Value", `₹ ${fmtNum(g("book_value"))}`],
    ["Dividend Yield", `${fmtNum(g("div_yield"))} %`],
    ["ROCE", `${fmtNum(g("roce"))} %`],
    ["ROE", `${fmtNum(g("roe"))} %`],
    ["Sales growth 5Y", `${fmtNum(g("sales_cagr_5y"))} %`],
    ["Profit growth 5Y", `${fmtNum(g("profit_cagr_5y"))} %`],
    ["Debt / Equity", fmtNum(g("de"))],
    ["Promoter holding", `${fmtNum(g("promoter_holding"))} %`],
  ];
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
        {cells.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between border-b border-[var(--line)] pb-2">
            <span className="text-sm text-[var(--ink3)]">{label}</span>
            <span className="text-sm font-semibold text-[var(--ink)] tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CompanyView() {
  const params = useSearchParams();
  const symbol = (params.get("s") ?? "").toUpperCase();
  const [company, setCompany] = useState<Company | null>(null);
  const [peers, setPeers] = useState<Row[]>([]);
  const [fullRow, setFullRow] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [watched, setWatched] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setWatched(loadWatchlist().includes(symbol));
    setNote(loadNote(symbol));
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    fetch(`${BASE}/companies/${symbol}.json`)
      .then((r) => { if (!r.ok) throw new Error(`no data for ${symbol}`); return r.json(); })
      .then(setCompany)
      .catch((e) => setError(String(e.message ?? e)));
  }, [symbol]);

  useEffect(() => {
    if (!company) return;
    fetch(`${BASE}/data.json`)
      .then((r) => r.json())
      .then((d: ScreenData) => {
        setFullRow(d.rows.find((r) => r.symbol === company.snapshot.symbol) ?? null);
        const ind = company.snapshot.industry;
        if (!ind) return;
        setPeers(
          d.rows
            .filter((r) => r.industry === ind && r.symbol !== company.snapshot.symbol)
            .sort((a, b) => ((b.mcap as number) ?? 0) - ((a.mcap as number) ?? 0))
            .slice(0, 8)
        );
      })
      .catch(() => { /* peers are optional */ });
  }, [company]);

  const exportCompanyCsv = () => {
    if (!company) return;
    const esc = (v: unknown) => {
      const sv = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(sv) ? `"${sv.replace(/"/g, '""')}"` : sv;
    };
    const lines: string[] = [`${symbol} — Rscreener export,${company.generated_at}`, ""];
    lines.push("SNAPSHOT");
    for (const [k, v] of Object.entries(company.snapshot)) lines.push(`${k},${esc(v)}`);
    const pushStmt = (title: string, stmt: Stmt) => {
      lines.push("", title.toUpperCase());
      lines.push(`,${stmt.periods.join(",")}`);
      for (const it of stmt.items) lines.push(`${esc(it.label)},${it.values.map(esc).join(",")}`);
    };
    if (company.trend?.annual) pushStmt("Track record annual", trendToStmt(company.trend.annual));
    if (company.trend?.quarterly) pushStmt("Track record quarterly", trendToStmt(company.trend.quarterly));
    for (const [key, title] of Object.entries(STMT_TITLES)) {
      if (company.statements[key]) pushStmt(title, company.statements[key]);
    }
    if (company.shareholding && company.shareholding.dates.length > 0) {
      pushStmt("Shareholding pattern", {
        periods: company.shareholding.dates,
        items: [
          { label: "Promoters %", values: company.shareholding.promoter },
          { label: "Public %", values: company.shareholding.public },
          { label: "Employee trusts %", values: company.shareholding.employee },
        ],
      });
    }
    const bom = String.fromCharCode(0xfeff);
    const blob = new Blob([bom + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${symbol}_rscreener.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!symbol) return <p className="text-[var(--ink3)] p-6">No company selected. <Link className="text-[var(--accent-ink)] underline" href="/">Back to screener</Link></p>;
  if (error) return <p className="text-[var(--neg)] p-6">{error} — <Link className="text-[var(--accent-ink)] underline" href="/">back to screener</Link></p>;
  if (!company) return <p className="text-[var(--ink3)] p-6">Loading {symbol}…</p>;

  const s = company.snapshot;
  const price = num(fullRow, "price") ?? num(s, "price");
  const off = num(fullRow, "off_52w_high");
  const quarterly = company.statements.quarterly_results ?? (company.trend?.quarterly ? trendToStmt(company.trend.quarterly) : null);
  const pnl = company.statements.annual_pnl ?? (company.trend?.annual ? trendToStmt(company.trend.annual) : null);
  const balance = company.statements.balance_sheet;
  const cashflow = company.statements.cash_flow;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">{String(s.name ?? symbol)} <span className="text-[var(--accent-ink)]">({symbol})</span></h1>
          <p className="text-sm text-[var(--ink3)]">
            {s.sector ? (
              <Link href={`/sectors?s=${encodeURIComponent(String(s.sector))}`} className="hover:text-[var(--accent-ink)] hover:underline">{String(s.sector)}</Link>
            ) : "—"}
            {" · "}{String(s.industry ?? "—")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={exportCompanyCsv}
            className="text-xs font-semibold bg-[var(--card2)] hover:bg-[var(--accent-soft)] border border-[var(--line)] rounded-lg px-3 py-1.5"
          >
            Export CSV
          </button>
          <button
            onClick={() => { toggleWatch(symbol); setWatched(!watched); }}
            aria-label={watched ? "remove from watchlist" : "add to watchlist"}
            title={watched ? "On your watchlist — tap to remove" : "Add to watchlist"}
            className={`text-2xl leading-none ${watched ? "text-[var(--accent)]" : "text-[var(--line2)] hover:text-[var(--accent)]"}`}
          >
            ★
          </button>
        </div>
      </div>

      {price !== null && (
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold text-[var(--ink)] tabular-nums">₹ {fmtNum(price)}</span>
          {off !== null && (
            <span className={`text-sm font-semibold ${off < 0 ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}>
              {off < 0 ? "" : "+"}{off.toFixed(1)}% from 52w high
            </span>
          )}
        </div>
      )}

      <nav className="sticky top-14 z-20 -mx-4 px-4 bg-[var(--card)] border-y border-[var(--line)] flex gap-1 overflow-x-auto text-sm font-medium py-1.5">
        {([
          ["summary", "Summary"], ["chart", "Chart"], ["analysis", "Analysis"], ["peers", "Peers"],
          ["quarters", "Quarters"], ["profit-loss", "Profit & Loss"], ["balance-sheet", "Balance Sheet"],
          ["cash-flows", "Cash Flow"], ["shareholding", "Investors"], ["documents", "Documents"],
        ] as [string, string][]).map(([id, label]) => (
          <a key={id} href={`#${id}`} className="px-3 py-1 rounded-lg whitespace-nowrap text-[var(--ink2)] hover:bg-[var(--card2)] hover:text-[var(--accent-ink)]">
            {label}
          </a>
        ))}
      </nav>

      <div id="summary" className="scroll-mt-32">
        <RatioGrid snapshot={s} row={fullRow} />
      </div>

      <div id="chart" className="scroll-mt-32">
        {company.prices && (company.prices.monthly?.length || company.prices.weekly?.length) ? (
          <PriceChart prices={company.prices} peBand={company.pe_band} trendQ={company.trend?.quarterly} livePrice={price} />
        ) : null}
      </div>

      <div id="analysis" className="scroll-mt-32">
        <ProsCons row={fullRow} />
      </div>

      {peers.length > 0 && (
        <section id="peers" className="scroll-mt-32 bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
          <div className="px-4 pt-3.5 pb-2">
            <h2 className="text-base font-semibold text-[var(--ink)]">Peer comparison</h2>
            <p className="text-xs text-[var(--ink3)] mt-0.5">{String(s.industry)}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-right font-medium">CMP ₹</th>
                  <th className="px-3 py-2 text-right font-medium">P/E</th>
                  <th className="px-3 py-2 text-right font-medium">MCap ₹Cr</th>
                  <th className="px-3 py-2 text-right font-medium">Div Yld %</th>
                  <th className="px-3 py-2 text-right font-medium">ROCE %</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--line)] bg-[var(--card2)]">
                  <td className="px-3 py-1.5"><span className="font-semibold text-[var(--ink)]">{symbol}</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(price)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(num(fullRow, "pe"))}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(num(fullRow, "mcap"), 0)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(num(fullRow, "div_yield"))}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(num(fullRow, "roce"))}</td>
                </tr>
                {peers.map((p) => (
                  <tr key={String(p.symbol)} className="border-b border-[var(--line)] hover:bg-[var(--card2)]">
                    <td className="px-3 py-1.5"><Link className="font-medium text-[var(--accent-ink)] hover:underline" href={`/company?s=${p.symbol}`}>{String(p.name ?? p.symbol)}</Link></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(p.price as number)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(p.pe as number)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(p.mcap as number, 0)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(p.div_yield as number)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(p.roce as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {quarterly && <div id="quarters" className="scroll-mt-32"><StatementTable title="Quarterly results" stmt={quarterly} subtitle="Consolidated figures in ₹ Crores" boldRows={["Net Profit", "Net profit"]} /></div>}

      {pnl && (
        <div id="profit-loss" className="scroll-mt-32 space-y-6">
          <StatementTable title="Profit & loss" stmt={pnl} subtitle="Consolidated figures in ₹ Crores" boldRows={["Net Profit", "Net profit"]} />
          <CompoundedGrowth trend={company.trend} prices={company.prices} />
        </div>
      )}

      {balance && <div id="balance-sheet" className="scroll-mt-32"><StatementTable title="Balance sheet" stmt={balance} subtitle="Consolidated figures in ₹ Crores" boldRows={["Total Assets", "Total Liabilities"]} /></div>}
      {cashflow && <div id="cash-flows" className="scroll-mt-32"><StatementTable title="Cash flows" stmt={cashflow} subtitle="Consolidated figures in ₹ Crores" boldRows={["Free Cash Flow"]} /></div>}

      {Object.keys(company.statements).length === 0 && !company.trend?.annual && (
        <div className="bg-[var(--warn-soft)] border border-[var(--warn-line)] text-[var(--warn-ink)] rounded-xl p-4 text-sm">
          Financial statements haven&apos;t been fetched for this company yet — showing the snapshot only.
          Statements coverage grows as the pipeline runs.
        </div>
      )}

      {company.shareholding && company.shareholding.dates.length > 0 && (
        <div id="shareholding" className="scroll-mt-32"><StatementTable
          title="Shareholding pattern"
          subtitle="Figures in %"
          stmt={{
            periods: company.shareholding.dates,
            items: [
              { label: "Promoters %", values: company.shareholding.promoter },
              { label: "Public %", values: company.shareholding.public },
              { label: "Employee trusts %", values: company.shareholding.employee },
            ],
          }}
        /></div>
      )}

      <section id="documents" className="scroll-mt-32 bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-3">
        <h2 className="text-sm font-bold text-[var(--ink)]">Documents</h2>
        {(company.documents?.annual_reports?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs text-[var(--ink3)] mb-1.5">Annual reports (PDF, straight from NSE)</p>
            <div className="flex gap-2 flex-wrap">
              {company.documents!.annual_reports!.slice(0, 18).map((ar) => (
                <a key={ar.url} href={ar.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-semibold bg-[var(--card2)] hover:bg-[var(--accent-soft)] border border-[var(--line)] rounded-full px-3 py-1">
                  FY{ar.from}–{String(ar.to).slice(-2)}
                </a>
              ))}
            </div>
          </div>
        )}
        {(company.documents?.concalls?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs text-[var(--ink3)] mb-1.5">Concalls, transcripts &amp; investor meets (newest first)</p>
            <ul className="space-y-1">
              {company.documents!.concalls!.slice(0, 8).map((d) => (
                <li key={d.url} className="text-sm truncate">
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] hover:underline">
                    <span className="text-[var(--ink3)] font-mono text-xs mr-2">{d.date}</span>{d.title || "document"}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(company.documents?.ratings?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs text-[var(--ink3)] mb-1.5">Credit-rating updates</p>
            <ul className="space-y-1">
              {company.documents!.ratings!.slice(0, 5).map((d) => (
                <li key={d.url} className="text-sm truncate">
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] hover:underline">
                    <span className="text-[var(--ink3)] font-mono text-xs mr-2">{d.date}</span>{d.title || "rating document"}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-4 flex-wrap text-sm">
          <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] font-semibold hover:underline">
            All NSE filings &amp; announcements ↗
          </a>
          <a href={`https://www.screener.in/company/${encodeURIComponent(symbol)}/`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] font-semibold hover:underline">
            Cross-check on Screener.in ↗
          </a>
        </div>
        <p className="text-xs text-[var(--ink3)]">Use the cross-check link before trusting any number here — this app&apos;s data is unverified.</p>
      </section>

      <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-2">
        <h2 className="text-sm font-bold text-[var(--ink)]">Your notes</h2>
        <textarea
          value={note}
          onChange={(e) => { setNote(e.target.value); saveNote(symbol, e.target.value); }}
          rows={4}
          placeholder="Private notes in your own words — stored only on this device, never uploaded."
          className="w-full text-sm border border-[var(--line2)] rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </section>

      <footer className="text-xs text-[var(--ink3)] leading-relaxed pb-8">
        Data: Yahoo Finance via yfinance, as of {company.generated_at} — <strong>every number is unverified until checked against a company filing</strong>. This tool screens; it never recommends.
      </footer>
    </div>
  );
}

export default function CompanyPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Suspense fallback={<p className="text-[var(--ink3)]">Loading…</p>}>
          <CompanyView />
        </Suspense>
      </main>
    </div>
  );
}
