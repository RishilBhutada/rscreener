"use client";

import { ChevronGlyph, ExternalGlyph } from "@/components/Glyphs";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { saveFile } from "@/lib/download";
import { buildXlsx, Cell, XLSX_MIME } from "@/lib/xlsx";
import { FIELD_CATALOG } from "@/lib/fields";
import TopNav from "@/components/TopNav";
import { shortName, titleCase } from "@/lib/names";
import StockChart, { CorpAction, Quarter } from "@/components/StockChart";
import { Row } from "@/lib/query";
import { loadNote, pushRecent, saveNote } from "@/lib/store";
import WatchStar from "@/components/WatchStar";
import SeasonsCard, { Seasons } from "@/components/Seasons";
import InstitutionsCard from "@/components/InstitutionsCard";
import { loadSectionMode, SectionMode } from "@/components/Settings";
import { isRefreshLoad } from "@/components/TopNav";
import { applyOrder, loadOrder } from "@/lib/order";
import InfoTip, { InfoDialog, InfoPart } from "@/components/InfoTip";
import { TableKind, TableView, arrange, change, changeText, usePct, useRowOrder, useView } from "@/lib/tableprefs";
import { move } from "@/lib/order";
import { IconButton, dayMove, signed as signedNum, tone } from "@/components/QuoteUI";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** `parent`: a breakdown row, folded under that row's "+" (Material Cost % under Expenses). */
type Stmt = { periods: string[]; items: { label: string; values: (number | null)[]; parent?: string }[]; declared?: (string | null)[] };
type AnnualReport = { from: string; to: string; url: string };
type AnnDoc = { date: string; title: string; url: string; kind?: string };
type Trend = {
  periods: string[];
  revenue: (number | null)[];
  pat: (number | null)[];
  eps: (number | null)[];
  expenses?: (number | null)[];
  ebitda?: (number | null)[];
  book_value?: (number | null)[];
  opm?: (number | null)[];
  gpm?: (number | null)[];
  npm?: (number | null)[];
  /** Return on equity per year, % (annual trend). */
  roe?: (number | null)[];
  source: string[];
};
type Shareholding = {
  /** Central and state governments, %; number of shareholders; holders the
   *  filing names (promoters, and others above 1%), aligned with dates. */
  gov?: (number | null)[];
  holders_n?: (number | null)[];
  named?: { cat: string; name: string; values: (number | null)[] }[];
  dates: string[];
  promoter: (number | null)[];
  public: (number | null)[];
  employee: (number | null)[];
  /** Foreign and domestic institutions and mutual funds, from each quarter's
   *  XBRL - empty for quarters on SEBI's older format. */
  fii?: (number | null)[];
  dii?: (number | null)[];
  mf?: (number | null)[];
};
type Pt = [string, number] | [string, number, number | null];
type Prices = { monthly?: Pt[]; weekly?: Pt[]; daily?: Pt[] };
type PeBand = { series: [string, number][]; median_5y: number | null };
type ScreenData = { rows: Row[] };


type Company = {
  generated_at: string;
  snapshot: Row;
  statements: Record<string, Stmt>;
  documents?: {
    annual_reports?: AnnualReport[]; concalls?: AnnDoc[]; ratings?: AnnDoc[];
    /** Concall presentations and recordings, beside the transcripts. */
    ppts?: AnnDoc[]; recordings?: AnnDoc[];
    /** [at "YYYY-MM-DD HH:MM", NSE category, subject, PDF, important 0/1]. */
    announcements?: [string, string, string, string, number][];
  };
  trend?: { annual?: Trend; quarterly?: Trend };
  shareholding?: Shareholding;
  prices?: Prices | null;
  pe_band?: PeBand | null;
  ev_band?: PeBand | null;
  pb_band?: PeBand | null;
  ps_band?: PeBand | null;
  quarters?: Quarter[] | null;
  actions?: CorpAction[] | null;
  coverage?: Coverage | null;
  ratios?: WcRatios | null;
  no_pe_reason?: string | null;
  /** Whether the filed figures are consolidated or standalone. Captioning one
   *  as the other says the numbers cover a different business than they do. */
  basis?: string | null;
  fscore?: FScoreData | null;
  seasons?: Seasons | null;
  /** [index symbol, name, group] - the indices it is a member of, broad market first. */
  indices?: [string, string, string][] | null;
  /** What the company does: its Wikipedia article (CC BY-SA 4.0), verified by the ticker in its infobox. */
  about?: { title: string; url: string; short: string | null; text: string | null } | null;
  /** Quarterly business updates filed before the results (pipeline/business_updates.py):
   *  n of the last `of` quarters on record, typical days after the quarter ended, the latest. */
  updates?: Updates | null;
  /** Face value per share, Rs (the exchange's equity list). */
  face_value?: number | null;
  /** In NSE's futures & options segment (fetch_fno.py). */
  fno?: boolean | null;
  /** The company's icon, relative to the site root (logos/SYM.png). */
  logo?: string | null;
  segments?: { quarterly?: Segments; annual?: Segments } | null;
  /** [day, name, category, Buy/Sell, shares, value Rs, mode] - newest first. */
  insider?: [string, string, string, string, number | null, number | null, string][] | null;
  exchange?: string | null;
  bse_code?: number | string | null;
  /** Written by pipeline/export_company_json.py so this page need not download
   *  the whole screener table. Optional: a company file exported before that
   *  change has none of the three, and the page falls back to fetching it. */
  row?: Row | null;
  peers?: Row[] | null;
  context?: {
    industry?: string;
    medians?: Record<string, [number, number]>;
    rank?: number | null;
    rank_of?: number;
    ind_rank?: number | null;
    ind_rank_of?: number;
    /** NSE's sector and basic industry where its index files carry them. */
    nse_sector?: string | null;
    nse_basic?: string | null;
    /** What the peers were picked by: NSE's basic industry, or the source's industry. */
    peer_group?: string | null;
  } | null;
};

/** Working-capital ratios per year - how the business is actually financed. */
type WcRatios = {
  periods: string[];
  debtor_days: (number | null)[];
  inventory_days: (number | null)[];
  days_payable: (number | null)[];
  cash_conversion: (number | null)[];
  working_capital_days: (number | null)[];
  roce: (number | null)[];
};

/** What the filings behind this company actually cover. */
type Coverage = { quarters: number; from?: string | null; to?: string | null; gaps?: string[]; gap_count?: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthYear(iso?: string | null): string {
  if (!iso || iso.length < 7) return "—";
  return `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`;
}

/** Says why the history starts where it starts, instead of leaving a short chart
 *  to look like a fault in the site.
 *
 *  Cemindia Projects is the case that prompted it: NSE's index lists its
 *  2005-2017 results and every one of those archive links returns 404, while
 *  three later quarters were never filed at all. A ratio needs four CONSECUTIVE
 *  quarters, so a single hole pushes the line forward a year - which is
 *  completely invisible unless the page says so.
 */
function CoverageNote({ cov, bandFrom }: { cov?: Coverage | null; bandFrom?: string | null }) {
  if (!cov || !cov.from) return null;
  const gaps = cov.gaps ?? [];
  const nGaps = cov.gap_count ?? gaps.length;
  // Nothing worth saying about a company with a full, unbroken record that
  // already reaches back further than the chart's own range.
  if (nGaps === 0 && cov.from <= "2008-12-31") return null;
  return (
    <p className="mt-3 text-[11px] text-[var(--ink3)]">
      Filings from {monthYear(cov.from)}
      {nGaps > 0 ? ` · ${nGaps} quarter${nGaps === 1 ? "" : "s"} missing` : ""}
      <InfoTip title="Why the history starts where it does" className="ml-1">
        <p>
          Filings on record for this company begin <strong>{monthYear(cov.from)}</strong> ({cov.quarters} quarters).
        </p>
        {nGaps > 0 && (
          <p>
            {nGaps === 1 ? "One quarter is" : `${nGaps} quarters are`} missing from those records
            {gaps.length > 0 && <> — {gaps.slice(0, 6).join(", ")}{nGaps > gaps.slice(0, 6).length ? " and others" : ""}</>}.
            {" "}A trailing-twelve-month figure needs four consecutive quarters, so each gap moves the ratio lines forward by a year.
          </p>
        )}
        {bandFrom && <p>The valuation lines therefore begin <strong>{monthYear(bandFrom)}</strong>.</p>}
        <p>Nothing here is estimated: a quarter that was never filed is left out rather than filled in.</p>
      </InfoTip>
    </p>
  );
}


/** EBITDA as companies and brokers quote it: operating profit plus other
 *  income (= profit before tax + interest + depreciation, without one-off
 *  exceptional items). "Operating Profit" above it leaves other income out.
 *  Added after OPM %, with its margin on sales folded under it. */
function withEbitda(stmt: Stmt | null): Stmt | null {
  if (!stmt) return stmt;
  const find = (...ls: string[]) => stmt.items.find((it) => ls.includes(it.label) && !it.parent);
  const op = find("Operating Profit"), oi = find("Other Income"), rev = find("Revenue", "Sales");
  if (!op || !oi || stmt.items.some((it) => it.label === "EBITDA")) return stmt;
  const eb = op.values.map((v, i) => (v === null || v === undefined ? null : v + (oi.values[i] ?? 0)));
  const margin = eb.map((v, i) => {
    const r = rev?.values[i];
    return v === null || !r ? null : Math.round((v / r) * 10000) / 100;
  });
  const at = stmt.items.findIndex((it) => it.label === "OPM %");
  const pos = at >= 0 ? at + 1 : stmt.items.indexOf(op) + 1;
  const items = [...stmt.items];
  items.splice(pos, 0, { label: "EBITDA", values: eb }, { label: "EBITDA margin %", values: margin, parent: "EBITDA" });
  return { ...stmt, items };
}

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

function RatiosTable({ r, symbol }: { r: WcRatios; symbol: string }) {
  // The one section screener.in has that this app did not. Every figure is
  // arithmetic on filed lines, and a year missing an input shows a dash rather
  // than a zero - a nought-day cash conversion cycle is a remarkable business,
  // not an absent number.
  const ROWS: [string, keyof WcRatios, string][] = [
    ["Debtor Days", "debtor_days", "How long customers take to pay"],
    ["Inventory Days", "inventory_days", "How long stock sits before it sells"],
    ["Days Payable", "days_payable", "How long the company takes to pay suppliers"],
    ["Cash Conversion Cycle", "cash_conversion", "Debtor + inventory − payable. Negative means suppliers fund the business"],
    ["Working Capital Days", "working_capital_days", "Working capital as days of sales"],
    ["ROCE %", "roce", "Operating profit over capital employed"],
  ];
  return (
    <div id="ratios" className="scroll-mt-32">
      <StatementTable title="Ratios" kind="ratios" symbol={symbol} subtitle="Days, and ROCE in %"
        stmt={{ periods: r.periods, items: ROWS.map(([label, key]) => ({ label, values: (r[key] as (number | null)[]) ?? [] })) }}
        info={
          <InfoTip title="Ratios" className="ml-1.5">
            <p>How the business is financed, year by year.</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {ROWS.map(([label, , help]) => <li key={label}><strong>{label}</strong>: {help}</li>)}
            </ul>
            <p>
              Computed from the filed balance sheet and income statement — nothing here is
              estimated. A year missing an input shows a dash rather than a zero.
            </p>
          </InfoTip>
        } />
    </div>
  );
}

function periodLabel(p: string): string {
  return new Date(p).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** "Mar 2026" is when the quarter ended; the number only became public on the
 *  day it was declared, which for MTAR Tech was nearly seven months later. The
 *  table states both so the reader is never guessing which they are looking at. */
function declaredLabel(d: string | null | undefined): string | null {
  if (!d) return null;
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

/** Columns a statement table opens with: the latest twelve periods, as
 *  screener.in shows. Reliance's quarterly table carries 85 quarters back to
 *  2005, a thousand cells most visits never look at. */
const RECENT_PERIODS = 12;

/** The quarter after `p`: "2026-06-30" -> "2026-09-30". */
function quarterAfter(p: string): string {
  const m = Number(p.slice(5, 7)) + 3, y = Number(p.slice(0, 4)) + (m > 12 ? 1 : 0), mm = m > 12 ? m - 12 : m;
  return `${y}-${String(mm).padStart(2, "0")}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** The quarter a results meeting on `day` reports: the last one to end before it. */
function quarterBefore(day: string): string {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const qm = [12, 3, 6, 9][Math.floor((m - 1) / 3)], qy = m <= 3 ? y - 1 : y;
  return `${qy}-${String(qm).padStart(2, "0")}-${String(new Date(Date.UTC(qy, qm, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** pipeline/business_updates.py summary(). */
type Updates = { n: number; of: number; typ: number | null; last: { q: string; d: string; at?: string; doc?: string } };
/** The next results meeting on NSE's calendar: undefined while loading, null if none. */
type NextResults = { date: string; purpose: string } | null | undefined;

/** Peer comparison, with screener.in's columns: the quarter's profit and sales
 *  and their change from a year before, a median row across the companies
 *  shown, and a column picker (rs_peer_cols, synced). */
const PEER_COLS: { key: string; label: string; dec: number }[] = [
  { key: "price", label: "CMP ₹", dec: 2 },
  { key: "pe", label: "P/E", dec: 2 },
  { key: "mcap", label: "MCap ₹Cr", dec: 0 },
  { key: "div_yield", label: "Div Yld %", dec: 2 },
  { key: "qtr_profit", label: "NP Qtr ₹Cr", dec: 0 },
  { key: "qtr_profit_yoy", label: "Qtr Profit Var %", dec: 1 },
  { key: "qtr_sales", label: "Sales Qtr ₹Cr", dec: 0 },
  { key: "qtr_sales_yoy", label: "Qtr Sales Var %", dec: 1 },
  { key: "roce", label: "ROCE %", dec: 1 },
  { key: "roe", label: "ROE %", dec: 1 },
  { key: "pb", label: "P/B", dec: 2 },
  { key: "de", label: "Debt / Eq", dec: 2 },
  { key: "net_margin", label: "Net margin %", dec: 1 },
  { key: "sales_cagr_5y", label: "Sales gr 5Y %", dec: 1 },
  { key: "profit_cagr_5y", label: "Profit gr 5Y %", dec: 1 },
];
const PEER_DEFAULT = ["price", "pe", "mcap", "div_yield", "qtr_profit", "qtr_profit_yoy", "qtr_sales", "qtr_sales_yoy", "roce"];

function PeerTable({ symbol, self, peers, industry }: { symbol: string; self: Row; peers: Row[]; industry: string }) {
  const [cols, setCols] = useState<string[]>(PEER_DEFAULT);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("rs_peer_cols") ?? "null");
      if (Array.isArray(v) && v.length) setCols(v.filter((k: string) => PEER_COLS.some((c) => c.key === k)));
    } catch { /* the default columns */ }
  }, []);
  const pick = (k: string) => {
    const next = cols.includes(k) ? cols.filter((x) => x !== k) : PEER_COLS.map((c) => c.key).filter((x) => x === k || cols.includes(x));
    setCols(next);
    try { localStorage.setItem("rs_peer_cols", JSON.stringify(next)); } catch { /* not remembered */ }
  };
  const shownCols = PEER_COLS.filter((c) => cols.includes(c.key));
  const all = [self, ...peers];
  const med = (k: string): number | null => {
    const v = all.map((r) => r[k]).filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
    if (v.length < 3) return null;
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  };
  const cell = (v: unknown, dec: number, k: string, bold = false) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : null;
    const signed = k.endsWith("_yoy");
    return (
      <td key={k} className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${bold ? "font-semibold" : ""} ${signed && n !== null ? (n < 0 ? "text-[var(--neg)]" : n > 0 ? "text-[var(--pos)]" : "") : ""}`}>
        {n === null ? "—" : fmtNum(n, dec)}
      </td>
    );
  };
  return (
    <section id="peers" className="scroll-mt-32 bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
      <div className="px-4 pt-3.5 pb-2 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-[var(--ink)]">Peers</h2>
          <p className="text-xs text-[var(--ink3)] mt-0.5">{industry}</p>
        </div>
        <Link href={`/compare?s=${[symbol, ...peers.slice(0, 3).map((p) => String(p.symbol))].map(encodeURIComponent).join(",")}`}
          className="shrink-0 min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold text-[var(--accent-ink)] bg-[var(--accent-soft)] inline-flex items-center">
          Compare
        </Link>
        <button type="button" onClick={() => setEditing(!editing)} aria-expanded={editing}
          className={`shrink-0 min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold border ${editing ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)]" : "text-[var(--ink2)] border-[var(--line)]"}`}>
          {editing ? "Done" : "Columns"}
        </button>
      </div>
      {editing && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5">
          {PEER_COLS.map((c) => (
            <button key={c.key} type="button" onClick={() => pick(c.key)} aria-pressed={cols.includes(c.key)}
              className={`rounded-full px-2.5 py-1 text-[12px] font-medium border ${cols.includes(c.key) ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)]" : "text-[var(--ink3)] border-[var(--line)]"}`}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
              <th className="px-3 py-2 text-left font-medium sticky left-0 bg-[var(--card)]">Name</th>
              {shownCols.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium whitespace-nowrap">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--line)] bg-[var(--card2)]">
              <td className="px-3 py-1.5 sticky left-0 bg-[var(--card2)]"><span className="font-semibold text-[var(--ink)]">{symbol}</span></td>
              {shownCols.map((c) => cell(self[c.key], c.dec, c.key, true))}
            </tr>
            {peers.map((p) => (
              <tr key={String(p.symbol)} className="border-b border-[var(--line)] hover:bg-[var(--card2)]">
                <td className="px-3 py-1.5 sticky left-0 bg-[var(--card)] max-w-[40vw] truncate"><Link className="font-medium text-[var(--accent-ink)] hover:underline" href={`/company?s=${encodeURIComponent(String(p.symbol))}`}>{shortName(String(p.name ?? ""), String(p.symbol)) || String(p.symbol)}</Link></td>
                {shownCols.map((c) => cell(p[c.key], c.dec, c.key))}
              </tr>
            ))}
            <tr className="text-[var(--ink2)]">
              <td className="px-3 py-1.5 sticky left-0 bg-[var(--card)] font-medium">Median · {all.length} cos</td>
              {shownCols.map((c) => cell(med(c.key), c.dec, `${c.key}_m`))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Your own picks on the top grid - any screener field or a ratio you defined
 *  (screener's "Add ratio to table"). Kept as rs_grid_pins, synced. */
function PinnedRatios({ row }: { row: Row | null }) {
  const [pins, setPins] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("rs_grid_pins") ?? "[]");
      if (Array.isArray(v)) setPins(v.filter((x): x is string => typeof x === "string"));
    } catch { /* none */ }
  }, []);
  const save = (next: string[]) => {
    setPins(next);
    try { localStorage.setItem("rs_grid_pins", JSON.stringify(next)); } catch { /* not remembered */ }
  };
  const byKey = new Map(FIELD_CATALOG.map((f) => [f.key, f]));
  const hits = q.trim().length < 1 ? [] : FIELD_CATALOG
    .filter((f) => !pins.includes(f.key) && `${f.label} ${f.key} ${f.short ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8);
  const value = (k: string, unit: string) => {
    const v = num(row, k);
    if (v === null) return "—";
    return unit === "₹ Cr" ? `₹ ${fmtNum(v, 0)} Cr` : unit === "₹" ? `₹ ${fmtNum(v)}` : unit === "%" ? `${fmtNum(v)} %` : fmtNum(v);
  };
  return (
    <div className="mt-4 pt-3 border-t border-[var(--line)]">
      {pins.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6">
          {pins.map((k) => {
            const f = byKey.get(k);
            if (!f) return null;
            return (
              <div key={k} className="border-b border-[var(--line)] py-1.5 flex items-baseline justify-between gap-2">
                <span className="text-sm text-[var(--ink3)] truncate">{f.label}</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-[var(--ink)] tabular-nums">{value(k, f.unit)}</span>
                  <button type="button" onClick={() => save(pins.filter((x) => x !== k))} aria-label={`Remove ${f.label}`}
                    className="text-[var(--ink3)] text-xs px-1">✕</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {open ? (
        <div className="mt-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a ratio, e.g. PEG or debtor days"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--card2)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)]" />
          <div className="mt-1">
            {hits.map((f) => (
              <button key={f.key} type="button" onClick={() => { save([...pins, f.key]); setQ(""); setOpen(false); }}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--card2)] flex items-baseline justify-between gap-3">
                <span className="text-sm text-[var(--ink)]">{f.label}</span>
                <span className="text-xs text-[var(--ink3)] tabular-nums">{value(f.key, f.unit)}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setOpen(false); setQ(""); }} className="mt-1 text-xs text-[var(--ink3)]">Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 text-[13px] font-semibold text-[var(--accent-ink)]">+ Add ratio</button>
      )}
    </div>
  );
}

/** Segments, as the company reports them in its results (screener.in's
 *  "Product segments"): revenue or profit before interest and tax per segment.
 *  Revenue is before inter-segment sales are removed, so the rows can add up
 *  to more than the company's sales. */
type Segments = { periods: string[]; items: { name: string; rev: (number | null)[]; ebit: (number | null)[] }[] };
function SegmentsTable({ segs, symbol }: { segs: { quarterly?: Segments; annual?: Segments }; symbol: string }) {
  const [pt, setPt] = useState<"quarterly" | "annual">(segs.quarterly ? "quarterly" : "annual");
  const [what, setWhat] = useState<"rev" | "ebit">("rev");
  const sg = segs[pt] ?? segs.quarterly ?? segs.annual;
  if (!sg) return null;
  const seg = (v: string, opts: readonly (readonly [string, string])[], set: (k: never) => void, label: string) => (
    <div className="inline-flex gap-0.5 rounded-lg bg-[var(--card2)] p-0.5 text-xs" role="radiogroup" aria-label={label}>
      {opts.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={v === k} onClick={() => set(k as never)}
          className={`rounded-md px-2.5 py-1 font-medium ${v === k ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>{l}</button>
      ))}
    </div>
  );
  return (
    <div id="segments" className="scroll-mt-32 space-y-1.5">
      <div className="flex justify-end gap-1.5 flex-wrap">
        {segs.quarterly && segs.annual && seg(pt, [["quarterly", "Quarterly"], ["annual", "Yearly"]], setPt as (k: never) => void, "Segment periods")}
        {seg(what, [["rev", "Revenue"], ["ebit", "EBIT"]], setWhat as (k: never) => void, "Segment figure")}
      </div>
      <StatementTable title="Segments" kind="segments" symbol={symbol}
        subtitle={what === "rev" ? "Revenue by segment, ₹ Crores, before inter-segment sales" : "Profit before interest and tax by segment, ₹ Crores"}
        stmt={{ periods: sg.periods, items: sg.items.map((it) => ({ label: it.name, values: what === "rev" ? it.rev : it.ebit })) }} />
    </div>
  );
}

/** Insider trades - directors, promoters and designated employees buying or
 *  selling, as disclosed under SEBI's insider-trading rules (screener.in's
 *  "TRADES"). Shown as NSE lists them; its feed gives the latest twenty at
 *  most and can lag, so the list says so. A trade is a fact, not a signal. */
function InsiderTrades({ list }: { list: [string, string, string, string, number | null, number | null, string][] }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 5);
  const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-2">
      <h3 className="text-[13px] font-semibold text-[var(--ink)]">Insider trades</h3>
      <ul className="divide-y divide-[var(--line)]">
        {shown.map((t, i) => (
          <li key={i} className="py-1.5 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0">
              <span className="block text-[var(--ink)] truncate">{t[1]}</span>
              <span className="block text-[11px] text-[var(--ink3)] truncate">{day(t[0])} · {t[2] || "Insider"}{t[6] ? ` · ${t[6]}` : ""}</span>
            </span>
            <span className="text-right shrink-0">
              <span className="block font-semibold text-[var(--ink2)]">{t[3] || "Trade"}</span>
              <span className="block text-[11px] text-[var(--ink3)] tabular-nums">
                {t[4] !== null ? `${fmtNum(t[4], 0)} sh` : ""}{t[5] ? ` · ₹${fmtNum(t[5] / 1e7, 2)} Cr` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {list.length > 5 && <button type="button" onClick={() => setAll(!all)} className="text-[13px] font-semibold text-[var(--accent-ink)]">{all ? "Fewer" : `All ${list.length}`}</button>}
      <p className="text-[11px] text-[var(--ink3)]">From NSE&apos;s insider-trading disclosures; its feed lists the latest twenty at most and can be incomplete.</p>
    </div>
  );
}

/** Shareholding, quarterly or year by year (the March filing of each year). */
function ShareholdingTable({ sh, symbol }: { sh: NonNullable<Company["shareholding"]>; symbol: string }) {
  const [yearly, setYearly] = useState(false);
  const idx = sh.dates.map((d, i) => [d, i] as const).filter(([d]) => !yearly || String(d).slice(5, 7) === "03").map(([, i]) => i);
  const pickV = (v?: (number | null)[] | null) => (v ? idx.map((i) => v[i] ?? null) : null);
  const parentOf: Record<string, string> = { Promoters: "Promoters %", FIIs: "FIIs %", DIIs: "DIIs %", Public: "Public %", "DR holders": "Public %" };
  const named = (sh.named ?? []).map((h) => ({ label: `${h.name} %`, values: pickV(h.values) ?? [], parent: parentOf[h.cat] ?? "Public %" }))
    .filter((h) => h.values.some((v) => v !== null));
  const items = [
    { label: "Promoters %", values: pickV(sh.promoter) },
    { label: "FIIs %", values: pickV(sh.fii) },
    { label: "DIIs %", values: pickV(sh.dii) },
    { label: "Mutual funds %", values: pickV(sh.mf) },
    { label: "Government %", values: pickV(sh.gov) },
    { label: "Public %", values: pickV(sh.public) },
    { label: "Employee trusts %", values: pickV(sh.employee) },
    { label: "No. of shareholders", values: pickV(sh.holders_n) },
  ].filter((it): it is { label: string; values: (number | null)[] } => !!it.values && it.values.some((v) => v !== null && v !== 0))
    .concat(named.filter((h, i, a) => a.findIndex((x) => x.label === h.label && x.parent === h.parent) === i));
  return (
    <>
      <div className="flex justify-end mb-1.5">
        <div className="inline-flex gap-0.5 rounded-lg bg-[var(--card2)] p-0.5 text-xs" role="radiogroup" aria-label="Shareholding periods">
          {([[false, "Quarterly"], [true, "Yearly"]] as const).map(([y, label]) => (
            <button key={label} type="button" role="radio" aria-checked={yearly === y} onClick={() => setYearly(y)}
              className={`rounded-md px-2.5 py-1 font-medium ${yearly === y ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>{label}</button>
          ))}
        </div>
      </div>
      <StatementTable title="Shareholding pattern" subtitle="Figures in %" kind="shareholding" symbol={symbol}
        stmt={{ periods: idx.map((i) => sh.dates[i]), items }} />
    </>
  );
}

/** Whether a table's columns are quarters (else years), from the dates. */
function isQuarterly(periods: string[]): boolean {
  const n = periods.length;
  if (n < 2) return false;
  const a = Date.parse(periods[n - 2].slice(0, 10)), b = Date.parse(periods[n - 1].slice(0, 10));
  return Number.isFinite(a) && Number.isFinite(b) && (b - a) / 864e5 < 200;
}

/** The value a year before column i, found by DATE: with a quarter missing,
 *  counting back four columns would compare against fifteen months ago. */
function yearBefore(periods: string[], values: (number | null)[], i: number, quarterly: boolean): number | null {
  if (!quarterly) return i > 0 ? values[i - 1] ?? null : null;
  const day = 864e5, target = Date.parse(periods[i].slice(0, 10)) - 365.25 * day;
  for (let j = i - 1; j >= 0; j--) {
    const d = Date.parse(periods[j].slice(0, 10));
    if (Math.abs(d - target) <= 45 * day) return values[j] ?? null;
    if (d < target - 45 * day) break;
  }
  return null;
}

/** One row's last few periods as a line; the end dot says which way it last moved. */
function Spark({ values }: { values: (number | null)[] }) {
  const W = 48, H = 18, P = 2;
  const pts: [number, number][] = [];
  values.forEach((v, i) => { if (typeof v === "number" && Number.isFinite(v)) pts.push([i, v]); });
  if (pts.length < 2) return <span className="block w-[48px]" aria-hidden="true" />;
  const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1])), r = hi - lo || 1;
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, values.length - 1);
  const y = (v: number) => P + ((hi - v) / r) * (H - 2 * P);
  const [li, lv] = pts[pts.length - 1], pv = pts[pts.length - 2][1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden="true" className="block">
      <polyline points={pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
        stroke="var(--ink3)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(li)} cy={y(lv)} r="2" fill={lv > pv ? "var(--pos)" : lv < pv ? "var(--neg)" : "var(--ink3)"} />
    </svg>
  );
}

/** A change, green when the figure rose and red when it fell - the literal
 *  direction, never a judgement on whether that is good. */
function Delta({ cur, prev, points }: { cur: number | null | undefined; prev: number | null | undefined; points: boolean }) {
  const ch = change(cur, prev, points);
  if (ch === null) return <span className="text-[var(--ink3)]">—</span>;
  return (
    <span className={ch > 0 ? "text-[var(--pos)]" : ch < 0 ? "text-[var(--neg)]" : "text-[var(--ink3)]"}>
      {changeText(ch, points, cur, prev)}
    </span>
  );
}

/** The Trend | Grid switch at the top right of every table. */
function ViewSwitch({ view, onChange }: { view: TableView; onChange: (v: TableView) => void }) {
  return (
    <div className="shrink-0 inline-flex gap-0.5 rounded-lg bg-[var(--card2)] p-0.5 text-xs" role="radiogroup" aria-label="Table view">
      {([["trend", "Trend"], ["grid", "Grid"]] as const).map(([k, label]) => (
        <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => onChange(k)}
          className={`min-h-[28px] rounded-md px-2.5 font-medium ${view === k ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** A grid cell's tint: green if it rose from the period before, red if it fell,
 *  stronger the bigger the move (full at 25%, or 3 points for a % row). */
function heatTint(cur: number | null | undefined, prev: number | null | undefined, points: boolean): string | undefined {
  const ch = change(cur, prev, points);
  if (ch === null || ch === 0) return undefined;
  const mag = Math.min(Math.abs(ch) / (points ? 3 : 25), 1);
  if (mag < 0.04) return undefined;
  return `color-mix(in srgb, var(${ch > 0 ? "--pos" : "--neg"}) ${Math.round(6 + 20 * mag)}%, transparent)`;
}

function StatementTable({ title, stmt, subtitle, boldRows, next, kind, symbol, pdfs, info }: {
  title: string; stmt: Stmt; subtitle?: string; boldRows?: string[];
  /** The results PDF for each period, aligned with stmt.periods ("Raw PDF" row). */
  pdfs?: (string | null)[];
  /** Adds the coming quarter as a blank last column - the quarterly table only. */
  next?: NextResults;
  /** Which table this is, for its "%" switch and row order; and whose page. */
  kind: TableKind; symbol: string;
  /** The "i" beside the title, where a table has one. */
  info?: import("react").ReactNode;
}) {
  const [all, setAll] = useState(false);
  const [showPct, setShowPct] = usePct(kind);
  const [view, setView] = useView(kind);
  const trend = view === "trend";
  const quarterlyCols = isQuarterly(stmt.periods);
  const decOf = (label: string) => kind === "ratios" ? 1 : label.includes("EPS") || label.includes("%") ? 2 : 0;
  const saved = useRowOrder(kind, symbol);
  // Reordering: the order being edited, and whether to ask where it applies.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [asking, setAsking] = useState(false);
  const total = stmt.periods.length;
  const from = all ? 0 : Math.max(0, total - RECENT_PERIODS);
  const periods = stmt.periods.slice(from);
  const coming = next !== undefined && total ? quarterAfter(stmt.periods[total - 1]) : null;
  // The meeting's date belongs on that column only if it is that quarter's.
  const due = coming && next && quarterBefore(next.date) === coming ? next.date : null;
  // Breakdown rows (with a parent) fold under their parent's "+" and move with it.
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const top = stmt.items.filter((it) => !it.parent);
  const kids = (l: string) => stmt.items.filter((it) => it.parent === l);
  const labels = top.map((it) => it.label);
  const arranged = arrange(labels, saved.order);
  const order = draft ?? arranged;
  const byLabel = new Map(top.map((it) => [it.label, it]));
  const rows = order.map((l) => byLabel.get(l)).filter((it): it is Stmt["items"][number] => Boolean(it));
  const shown = rows.flatMap((it, r) => [{ it, r, child: false },
    ...(openRows[it.label] && !draft ? kids(it.label).map((k) => ({ it: k, r, child: true })) : [])]);
  const finish = () => {
    if (!draft || draft.join("|") === arranged.join("|")) { setDraft(null); return; }
    setAsking(true);
  };
  const keep = (scope: "company" | "all") => { if (draft) saved.save(draft, scope); setDraft(null); setAsking(false); };
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
      <div className="px-4 pt-3.5 pb-2 flex items-start gap-1.5">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-[var(--ink)]">{title}{info}</h2>
          <p className="text-xs text-[var(--ink3)] mt-0.5">
            {draft ? "Move rows with the arrows, then Done"
              : `${subtitle ?? "Figures in ₹ Crores"}${!trend && showPct ? " · in brackets, change from the period before" : ""}`}
            {/* The coming quarter is a column in the grid; in the trend view it is said here. */}
            {!draft && trend && coming && ` · ${periodLabel(coming)} results ${due ? `due ${declaredLabel(due)}` : "date not out"}`}
          </p>
        </div>
        {draft ? (
          <>
            <button type="button" onClick={() => setDraft(labels)}
              className="shrink-0 min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold text-[var(--ink2)] border border-[var(--line)]">
              Reset
            </button>
            <button type="button" onClick={finish}
              className="shrink-0 min-h-[32px] px-3 rounded-lg text-[12px] font-semibold bg-[var(--accent-fill)] text-[var(--accent-fill-ink)]">
              Done
            </button>
          </>
        ) : (
          <>
            <ViewSwitch view={view} onChange={setView} />
          </>
        )}
      </div>
      {/* The table's other tools sit under the title, so the title keeps the row
          and the Trend | Grid switch stays at the top right. */}
      {!draft && (
        <div className="px-4 pb-2 -mt-0.5 flex justify-end gap-1.5">
              {/* On by default; one tap turns this table's figures' change on or off. */}
              {!trend && <button type="button" onClick={() => setShowPct(!showPct)} aria-pressed={showPct}
                aria-label={showPct ? "Hide the % change" : "Show the % change"} title="% change from the period before"
                className={`shrink-0 min-h-[32px] min-w-[32px] px-2 rounded-lg text-[13px] font-bold border ${showPct
                  ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)]"
                  : "text-[var(--ink3)] border-[var(--line)]"}`}>
                %
              </button>}
              <button type="button" onClick={() => setDraft(arranged)} aria-label="Change the order of the rows" title="Row order"
                className="shrink-0 min-h-[32px] min-w-[32px] px-2 rounded-lg text-[var(--ink2)] border border-[var(--line)] inline-flex items-center justify-center">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 4v16M3.5 7.5 7 4l3.5 3.5M17 20V4M13.5 16.5 17 20l3.5-3.5" />
                </svg>
              </button>
              {!trend && total > RECENT_PERIODS && (
                <button type="button" onClick={() => setAll(!all)}
                  className="shrink-0 min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold text-[var(--accent-ink)] bg-[var(--accent-soft)]">
                  {all ? `Last ${RECENT_PERIODS}` : `All ${total}`}
                </button>
              )}
        </div>
      )}
      {/* Opens on the NEWEST period. These tables carry up to twenty years of
          columns oldest-first, so the page landed on 2005 and the reader had to
          drag sideways every time to reach the year he was actually asking
          about. The pinned label column stays put either way. */}
      {trend && !draft ? (() => {
        const last = total - 1;
        const cols = quarterlyCols ? "grid-cols-[minmax(84px,1fr)_48px_minmax(52px,auto)_46px_46px]" : "grid-cols-[minmax(84px,1fr)_48px_minmax(52px,auto)_56px]";
        const span = Math.min(8, total);
        const recentPdfs = pdfs ? pdfs.map((u, i) => [u, stmt.periods[i]] as const).filter(([u]) => Boolean(u)).slice(-4).reverse() : [];
        return (
          <div className="px-4 pb-3">
            <div className={`grid ${cols} gap-x-1.5 items-end py-1.5 border-y border-[var(--line)] text-[11px] text-[var(--ink3)]`}>
              <span className="truncate">{span} {quarterlyCols ? "quarters" : "years"}</span>
              <span>Trend</span>
              <span className="text-right whitespace-nowrap">{last >= 0 ? periodLabel(stmt.periods[last]) : ""}</span>
              <span className="text-right">{quarterlyCols ? "YoY" : "Change"}</span>
              {quarterlyCols && <span className="text-right">QoQ</span>}
            </div>
            {shown.map(({ it, child }) => {
              const bold = boldRows?.includes(it.label);
              const hasKids = !child && kids(it.label).length > 0;
              const points = it.label.includes("%");
              const cur = last >= 0 ? it.values[last] ?? null : null;
              return (
                <div key={it.label} className={`grid ${cols} gap-x-1.5 items-center py-1.5 border-b border-[var(--line)] text-sm`}>
                  <span className={`min-w-0 truncate ${child ? "pl-3 text-[13px] text-[var(--ink3)]" : bold ? "font-semibold text-[var(--ink)]" : "text-[var(--ink2)]"}`}>
                    {hasKids ? (
                      <button type="button" onClick={() => setOpenRows({ ...openRows, [it.label]: !openRows[it.label] })}
                        aria-expanded={!!openRows[it.label]} className="inline-flex items-center gap-1 text-left max-w-full">
                        <span className="truncate">{it.label}</span>
                        <span className="text-[var(--accent-ink)] font-semibold">{openRows[it.label] ? "−" : "+"}</span>
                      </button>
                    ) : it.label}
                  </span>
                  <Spark values={it.values.slice(Math.max(0, total - span))} />
                  <span className={`text-right tabular-nums whitespace-nowrap ${bold ? "font-semibold" : "font-medium"} ${typeof cur === "number" && cur < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]"}`}>
                    {fmtNum(cur, decOf(it.label))}
                  </span>
                  <span className="text-right text-[11px] sm:text-[12px] tabular-nums whitespace-nowrap">
                    <Delta cur={cur} prev={last >= 0 ? yearBefore(stmt.periods, it.values, last, quarterlyCols) : null} points={points} />
                  </span>
                  {quarterlyCols && (
                    <span className="text-right text-[11px] sm:text-[12px] tabular-nums whitespace-nowrap">
                      <Delta cur={cur} prev={last > 0 ? it.values[last - 1] : null} points={points} />
                    </span>
                  )}
                </div>
              );
            })}
            {recentPdfs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-2 text-[12px]">
                <span className="text-[var(--ink3)]">Raw PDF</span>
                {recentPdfs.map(([u, p]) => (
                  <a key={p} href={u!.includes("://") ? u! : `https://nsearchives.nseindia.com/corporate/${u}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] px-2 py-0.5 text-[var(--ink2)] hover:text-[var(--accent-ink)]">
                    {periodLabel(p)} <ExternalGlyph size={12} />
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })() : (
      <div key={from} className="overflow-x-auto" ref={(el) => { if (el) el.scrollLeft = el.scrollWidth; }}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
              <th className="px-3 py-2 text-left font-medium sticky left-0 bg-[var(--card)]"> </th>
              {periods.map((p, i) => {
                const dec = declaredLabel(stmt.declared?.[from + i]);
                return (
                  <th key={p} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                    {periodLabel(p)}
                    {dec && <span className="block font-normal text-[11px] text-[var(--ink3)]">({dec})</span>}
                  </th>
                );
              })}
              {coming && (
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap text-[var(--accent-ink)]">
                  {periodLabel(coming)}
                  <span className="block font-normal text-[11px]">({due ? `due ${declaredLabel(due)}` : "date not out"})</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ it, r, child }) => {
              const bold = boldRows?.includes(it.label);
              const hasKids = !child && kids(it.label).length > 0;
              return (
                <tr key={it.label} className={`border-b border-[var(--line)] hover:bg-[var(--card2)] ${child ? "text-[13px]" : ""}`}>
                  <td className={`px-3 py-2 sm:py-1.5 truncate max-w-[42vw] sm:max-w-none sm:whitespace-nowrap sticky left-0 bg-[var(--card)] ${child ? "pl-7 text-[var(--ink3)]" : bold ? "font-semibold text-[var(--ink)]" : "text-[var(--ink2)]"}`}>
                    {draft && !child && (
                      <span className="inline-flex align-middle mr-1.5">
                        <button type="button" disabled={r === 0} onClick={() => setDraft(move(order, it.label, -1))}
                          aria-label={`Move ${it.label} up`}
                          className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-[var(--line)] text-[var(--ink2)] disabled:opacity-30">▲</button>
                        <button type="button" disabled={r === rows.length - 1} onClick={() => setDraft(move(order, it.label, 1))}
                          aria-label={`Move ${it.label} down`}
                          className="w-7 h-7 ml-1 inline-flex items-center justify-center rounded-md border border-[var(--line)] text-[var(--ink2)] disabled:opacity-30">▼</button>
                      </span>
                    )}
                    {hasKids && !draft ? (
                      <button type="button" onClick={() => setOpenRows({ ...openRows, [it.label]: !openRows[it.label] })}
                        aria-expanded={!!openRows[it.label]} className="inline-flex items-center gap-1 text-left">
                        {it.label}
                        <span className="text-[var(--accent-ink)] font-semibold">{openRows[it.label] ? "−" : "+"}</span>
                      </button>
                    ) : it.label}
                  </td>
                  {it.values.slice(from).map((v, i) => {
                    // Against the period before - the one off-screen to the
                    // left too, so the first visible column still has one.
                    const at = from + i, points = it.label.includes("%");
                    const prev = at > 0 ? it.values[at - 1] : null;
                    const ch = showPct ? change(v, prev, points) : null;
                    return (
                      <td key={i} style={{ background: heatTint(v, prev, points) }}
                        className={`px-3 py-2 sm:py-1.5 text-right whitespace-nowrap tabular-nums ${bold ? "font-semibold" : ""} ${typeof v === "number" && v < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]"}`}>
                        {fmtNum(v, decOf(it.label))}
                        {ch !== null && (
                          <span className={`ml-1 text-[11px] font-normal ${ch > 0 ? "text-[var(--pos)]" : ch < 0 ? "text-[var(--neg)]" : "text-[var(--ink3)]"}`}>
                            ({changeText(ch, points, v, prev)})
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {coming && <td className="px-3 py-2 sm:py-1.5 bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]" />}
                </tr>
              );
            })}
            {pdfs && !draft && pdfs.slice(from).some(Boolean) && (
              <tr className="border-b border-[var(--line)]">
                <td className="px-3 py-2 sm:py-1.5 sticky left-0 bg-[var(--card)] text-[var(--ink2)]">Raw PDF</td>
                {pdfs.slice(from).map((u, i) => (
                  <td key={i} className="px-3 py-2 sm:py-1.5 text-right">
                    {u ? <a href={u.includes("://") ? u : `https://nsearchives.nseindia.com/corporate/${u}`} target="_blank" rel="noopener noreferrer"
                      aria-label={`Results PDF, ${periodLabel(stmt.periods[from + i])}`} className="inline-flex text-[var(--accent-ink)]"><ExternalGlyph size={14} /></a> : null}
                  </td>
                ))}
                {coming && <td />}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
      {!draft && saved.scope === "company" && (
        <p className="px-4 py-2 text-[11px] text-[var(--ink3)]">Rows in this company&apos;s own order.</p>
      )}
      {asking && draft && (
        <InfoDialog title="Use this order for every company?" onClose={() => setAsking(false)}>
          <p>{title} rows in this order on every company&apos;s page.</p>
          <p className="text-[12px] text-[var(--ink3)]">
            A company with a row this one does not have keeps that row in its usual place. You can change the order again from any company.
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" onClick={() => keep("company")}
              className="rs-press min-h-[44px] rounded-xl border border-[var(--line)] text-[14px] font-medium text-[var(--ink2)]">
              No, only {symbol}
            </button>
            <button type="button" onClick={() => keep("all")}
              className="rs-press min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
              Yes, all companies
            </button>
          </div>
        </InfoDialog>
      )}
    </section>
  );
}

/** Compound growth over the years it says, found by DATE rather than by counting
 *  array positions.
 *
 *  Counting positions assumes the annual series has no gaps. It does: 619 of the
 *  2,253 companies with an annual trend are missing at least one year, and 390
 *  of them are missing one inside the exact window this card renders. TCS has no
 *  FY2018 at all, so its "10 years" was measured across FY2015-FY2026 - eleven
 *  years of growth annualised as if it were ten, printing 10.9% where the truth
 *  is 9.9%. Sayaji Hotels was worse: a "5 years" figure spanning thirteen, and
 *  the sign flipped.
 *
 *  The start has to be the year that is actually `years` before the end. If that
 *  year was never filed, there is no N-year figure to give and the card shows
 *  nothing - better empty than a rate over a window nobody stated.
 */
/** Compound annual growth over `years` CALENDAR years.
 *
 *  Deliberately the same rule as `cagr_pct` in pipeline/trend_lib.py, because
 *  this page prints "Compounded profit growth 5 years" from the statements
 *  while the tile above it prints "Profit growth 5Y" from the screener field,
 *  and the two are the same concept. They did not agree: this one demanded an
 *  exact calendar-year match and returned nothing when the year end had moved,
 *  so ACC showed a growth rate in one place and a dash in the other.
 *
 *  Take the point nearest to `years` before the newest, divide by the span that
 *  ACTUALLY separates them, and withhold when nothing sits within nine months
 *  of the target rather than calling a six-year gap five years.
 */
function cagr(values: (number | null)[], years: number, periods?: string[]): number | null {
  const yearsBetween = (a: string, b: string) =>
    (Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / (365.25 * 864e5);

  const pairs: [string, number][] = [];
  values.forEach((v, i) => {
    if (v !== null && v !== undefined && Number.isFinite(v) && periods?.[i]) {
      pairs.push([String(periods[i]), v]);
    }
  });

  if (!periods || periods.length !== values.length || pairs.length < 2) {
    // No usable dates: fall back to positions, and only when the series is
    // dense enough that positions and years cannot disagree.
    const clean = values.filter((v): v is number => v !== null && v !== undefined);
    if (clean.length < years + 1) return null;
    const last = clean[clean.length - 1], start = clean[clean.length - 1 - years];
    if (!last || !start || start <= 0 || last <= 0) return null;
    return Math.round((Math.pow(last / start, 1 / years) - 1) * 100);
  }

  const [endP, last] = pairs[pairs.length - 1];
  let best: [string, number] | null = null;
  let bestOff = Infinity;
  for (const [p, v] of pairs.slice(0, -1)) {
    const span = yearsBetween(p, endP);
    if (!(span > 0)) continue;
    const off = Math.abs(span - years);
    if (off < bestOff) { bestOff = off; best = [p, v]; }
  }
  if (!best || bestOff > 0.75) return null;
  const span = yearsBetween(best[0], endP);
  const start = best[1];
  if (!last || !start || start <= 0 || last <= 0 || span <= 0) return null;
  return Math.round((Math.pow(last / start, 1 / span) - 1) * 100);
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
    ["Compounded sales growth", [["10 years", cagr(a.revenue, 10, a.periods)], ["5 years", cagr(a.revenue, 5, a.periods)], ["3 years", cagr(a.revenue, 3, a.periods)], ["1 year", cagr(a.revenue, 1, a.periods)]]],
    ["Compounded profit growth", [["10 years", cagr(a.pat, 10, a.periods)], ["5 years", cagr(a.pat, 5, a.periods)], ["3 years", cagr(a.pat, 3, a.periods)], ["1 year", cagr(a.pat, 1, a.periods)]]],
    ["Stock price CAGR", [["10 years", stockCagr(120)], ["5 years", stockCagr(60)], ["3 years", stockCagr(36)], ["1 year", stockCagr(12)]]],
  ];
  // Return on equity, averaged over the years (as screener.in shows it): the
  // middle of a run of years says more than one year's figure.
  const roeAvg = (n: number): number | null => {
    const v = (a.roe ?? []).filter((x): x is number => x !== null && x !== undefined).slice(-n);
    return v.length >= Math.min(n, 2) && v.length >= (n === 1 ? 1 : Math.ceil(n * 0.8))
      ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
  };
  if ((a.roe ?? []).some((x) => x !== null && x !== undefined)) {
    cards.push(["Return on equity", [["10 years", roeAvg(10)], ["5 years", roeAvg(5)], ["3 years", roeAvg(3)], ["Last year", roeAvg(1)]]]);
  }
  return (
    <section className={`bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 grid sm:grid-cols-2 ${cards.length > 3 ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-6`}>
      {cards.map(([title, rows]) => (
        <GrowthCard key={title} title={title} rows={rows} />
      ))}
    </section>
  );
}

/** The indices the company is in: the first few, the rest one tap away. */
function IndexChips({ list }: { list?: [string, string, string][] | null }) {
  // Behind a small button on the ticker line (owner, 27-Oct-2026: "only by
  // drop down beside the name, not always").
  const [open, setOpen] = useState(false);
  if (!list?.length) return null;
  return (
    <>
      {" · "}
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="inline-flex items-center gap-0.5 text-[var(--accent-ink)] font-medium">
        {list.length} {list.length === 1 ? "index" : "indices"}
        <ChevronGlyph size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
          {list.map(([sym, name]) => (
            <Link key={sym} href={`/indices/view?s=${encodeURIComponent(sym)}`}
              className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[var(--ink2)] hover:bg-[var(--card2)]">
              {name.replace(/^NIFTY\b/, "Nifty")}
            </Link>
          ))}
        </span>
      )}
    </>
  );
}

function num(r: Row | null, k: string): number | null {
  const v = r?.[k];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

/** The date the displayed price actually belongs to.
 *  A price with no date on it is untestable — that is how a snapshot from 10-Jul
 *  stayed on screen for three weeks looking exactly like a live quote. If the
 *  close is older than the last trading day, say so instead of implying "now". */
function PriceAsOf({ row, snapshot }: { row: Row | null; snapshot?: Row | null }) {
  const d = row?.["price_date"] ?? snapshot?.["price_date"];
  if (typeof d !== "string" || !d) return null;
  const asof = new Date(d + "T00:00:00");
  const days = Math.floor((Date.now() - asof.getTime()) / 86400000);
  const label = asof.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const old = days > 4;
  return (
    <span
      title={old ? "This close is behind the market — the price feed has not refreshed for this stock." : "Closing price on this date"}
      className={`text-xs font-medium ${old ? "text-[var(--neg)]" : "text-[var(--ink3)]"}`}
    >
      Close of {label}{old ? " · stale" : ""}
    </span>
  );
}

/** Behind the "i" on both cards. One set of words, two buttons: whichever
 *  column the reader is looking at when he wonders where these came from is
 *  the one carrying the answer. */
const PROS_CONS_NOTE = (
  <>
    <p>
      These are generated from the numbers by simple rules — not analysis, and never a
      recommendation.
    </p>
    <p>Verify against the filings before trusting anything.</p>
  </>
);

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
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--pos)] mb-2">
          Pros
          <InfoTip title="Pros and cons" className="ml-1">{PROS_CONS_NOTE}</InfoTip>
        </p>
        <ul className="space-y-1.5 text-sm text-[var(--ink2)] list-disc pl-4">
          {pros.length ? pros.map((p) => <li key={p}>{p}</li>) : <li className="list-none text-[var(--ink3)]">No standout positives from the current numbers.</li>}
        </ul>
      </div>
      <div className="rounded-xl border border-[var(--neg)] bg-[color-mix(in_oklab,var(--neg)_8%,var(--card))] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--neg)] mb-2">
          Cons
          <InfoTip title="Pros and cons" className="ml-1">{PROS_CONS_NOTE}</InfoTip>
        </p>
        <ul className="space-y-1.5 text-sm text-[var(--ink2)] list-disc pl-4">
          {cons.length ? cons.map((c) => <li key={c}>{c}</li>) : <li className="list-none text-[var(--ink3)]">No obvious red flags from the current numbers.</li>}
        </ul>
      </div>
    </section>
  );
}

/** What each figure is, where it comes from, and what it does and does not tell
 *  you. Written about THIS pipeline rather than as textbook definitions - the
 *  point is that a number here can be traced, and its weaknesses stated. */
const METRIC_INFO: Record<string, { how: string; means: string; watch?: string }> = {
  "Market Cap": {
    how: "Latest close multiplied by shares outstanding. The share count is derived as market cap divided by price from the same snapshot, so the two always reconcile - the build refuses to publish if they ever stop agreeing.",
    means: "What the whole company costs at today's price. This is the figure to compare against profit, sales or net worth. The share price alone means nothing without it.",
  },
  "Current Price": {
    how: "The most recent daily close from the exchange feed. Every price carries the trading date it belongs to, and the build blocks any release where prices are more than six trading days old.",
    means: "The last traded price. Checked against Zerodha's official exchange data on a 240-company sample spanning large, mid and small caps: 212 of 212 matched exactly.",
    watch: "End of day, not a live tick. During market hours this is the previous close.",
  },
  "High / Low": {
    how: "Highest and lowest traded price over the last 52 weeks, from the daily price series.",
    means: "The range the market has actually paid this year. How far today sits below the high usually tells you more than the high itself.",
  },
  "Stock P/E": {
    how: "Price divided by earnings per share over the trailing four quarters, taken from the company's own NSE filings rather than a data vendor.",
    means: "Years of current profit you are paying for. Comparable against this company's own history and against genuine peers - never across industries.",
    watch: "Meaningless when profit is near zero or negative. One loss-making quarter inside a profitable year still leaves it positive.",
  },
  "Book Value": {
    how: "Shareholders' funds divided by shares outstanding, from the filed balance sheet.",
    means: "What the accounts say each share owns once every debt is paid. Useful for banks and asset-heavy businesses, nearly meaningless for software or brands whose value never appears on a balance sheet.",
  },
  "Dividend Yield": {
    how: "Dividend per share over the last year divided by the current price.",
    means: "The cash return at today's price, before any capital gain.",
    watch: "A high yield is as often a collapsed price as a generous dividend.",
  },
  "Business update": {
    how: "The company's own early look at the quarter - sales, loans, deposits, store count - filed with NSE before its results. Read off NSE's announcements each day; \"usually day N\" is the middle of the days after quarter end it filed them, from two quarters or more.",
    means: "Some of the quarter is known before the results. Over five quarters (116 companies), the share made a big move on 16.5% of update days - against 5.6% of ordinary days and 25-33% of results days.",
    watch: "Which way the share moved on the update did not tell which way it would move on results day - 46% the same way, close to a coin toss. Voluntary: a company can stop at any quarter.",
  },
  "ROCE": {
    how: "Operating profit divided by capital employed - total assets less current liabilities - from the filed annual statements.",
    means: "How hard the money inside the business works, regardless of how it was funded. The single most useful quality measure for an operating company.",
  },
  "ROE": {
    how: "Net profit divided by shareholders' funds.",
    means: "Return on the owners' money specifically.",
    watch: "Unlike ROCE it flatters companies that borrow heavily, because borrowing shrinks the denominator. Read the two together.",
  },
  "Sales growth 5Y": {
    how: "Compound annual growth in revenue across five years of filed annual results.",
    means: "Whether the business is genuinely bigger than it was, not merely more profitable. Considerably harder to manufacture than profit growth.",
  },
  "Profit growth 5Y": {
    how: "Compound annual growth in net profit across five years of filed annual results.",
    means: "The rate earnings have compounded. Compare against sales growth - profit rising far faster than sales is margin expansion, which eventually runs out.",
  },
  "Debt / Equity": {
    how: "Total borrowings divided by shareholders' funds, from the filed balance sheet.",
    means: "How much of the business is funded by lenders rather than owners. Above 1 means creditors have more at stake than shareholders do.",
    watch: "Normal and uninformative for banks and financial companies, whose business is borrowing.",
  },
  "Promoter holding": {
    how: "The promoter group's stake from the latest shareholding pattern filed with the exchange.",
    means: "How much the founders still own. A stake falling steadily over several quarters is worth understanding; a rising one is usually a good sign.",
  },
  "Volatility 1Y": {
    how: "Annualised Yang-Zhang volatility over roughly 250 trading days. Yang-Zhang uses each day's open, high, low and close rather than closes alone, so it captures overnight gaps and the intraday range and is far less noisy than the textbook close-to-close measure. Companies without OHLC history fall back to close-to-close, and the method used is recorded per company.",
    means: "How violently the price has actually moved, stated per year. Under 20% is calm, over 55% is wild. It sizes the swings you would have had to sit through.",
    watch: "This is REALISED volatility - what already happened. It is not implied volatility and contains no forecast. Computed from Yahoo daily prices and not yet verified against exchange data, unlike the closing price itself.",
  },
  "Volatility 30D": {
    how: "The same Yang-Zhang calculation over the last 30 trading days.",
    means: "Recent turbulence. Read it against the 1-year figure: much higher means something is happening now, much lower means it has gone quiet.",
    watch: "Thirty days is a small sample, so this number jumps around. Realised, not implied.",
  },
};

/** The "i" beside a figure in the summary grid.
 *
 *  This used to be an eye, and opening it pushed a panel onto the bottom of
 *  the section — so the answer appeared several inches away from the number
 *  that raised the question, and on a phone often off-screen entirely. Now
 *  it is the same "i" used everywhere else, and the words arrive on top of
 *  the page rather than under it. */
/** Price history and performance, in one block.
 *
 *  Every figure here was already being published in data.json and none of it
 *  was on the company page. The returns existed only as screener columns, so
 *  you could filter on a stock's three-year return but not read it on its own
 *  page; the 52-week range was two numbers in a corner with no sense of where
 *  today sits between them. Simply Wall St puts the whole ladder in one table
 *  and it is the right shape - a price means little without the path.
 *
 *  Nothing new is fetched. This is layout over numbers the app already had.
 */
function PriceHistory({ row, snapshot }: { row: Row | null; snapshot: Row }) {
  const g = (k: string) => num(row, k) ?? num(snapshot, k);
  const price = g("price"), hi = g("wk52_high"), lo = g("wk52_low");
  const returns: [string, number | null][] = [
    ["1M", g("ret_1m")], ["3M", g("ret_3m")], ["6M", g("ret_6m")],
    ["1Y", g("ret_1y")], ["3Y", g("ret_3y")], ["5Y", g("ret_5y")],
  ];
  const shown = returns.filter(([, v]) => v !== null && v !== undefined);
  const at = price !== null && hi !== null && lo !== null && hi > lo
    ? Math.min(100, Math.max(0, ((price - lo) / (hi - lo)) * 100))
    : null;
  const off = price !== null && hi ? ((price - hi) / hi) * 100 : null;
  const beta = g("beta");
  if (shown.length === 0 && at === null) return null;
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <h2 className="text-base font-semibold text-[var(--ink)]">
        Price history
        <InfoTip title="Price history" className="ml-1.5">
          <p>Change in the share price alone.</p>
          <p>Dividends are not added back, so a high-yield company has done better than these figures say.</p>
          {beta !== null && beta !== undefined && (
            <p>
              Beta {fmtNum(beta)}: over the last year this share moved about{" "}
              {Math.abs(beta) < 0.05 ? "independently of" : `${fmtNum(Math.abs(beta))}× as far as`} the market on an
              average day. A number below 1 is not safety; it is only a smaller swing.
            </p>
          )}
        </InfoTip>
      </h2>
      {shown.length > 0 && (
        <div className="mt-2.5 grid grid-cols-6 gap-1 text-center">
          {shown.map(([label, v]) => (
            <div key={label}>
              <p className="text-[10.5px] text-[var(--ink3)]">{label}</p>
              <p className="text-[13px] font-semibold tabular-nums" style={{ color: (v as number) > 0 ? "var(--pos)" : (v as number) < 0 ? "var(--neg)" : "var(--ink2)" }}>
                {(v as number) > 0 ? "+" : (v as number) < 0 ? "−" : ""}{fmtNum(Math.abs(v as number), 1)}%
              </p>
            </div>
          ))}
        </div>
      )}
      {at !== null && (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-[11px] text-[var(--ink3)] tabular-nums">
            <span>₹{fmtNum(lo, 0)}</span>
            <div className="relative flex-1 h-1 rounded-full bg-[var(--line)]">
              <div className="absolute -top-1 w-[2px] h-3 bg-[var(--ink)]" style={{ left: `calc(${at}% - 1px)` }} />
            </div>
            <span>₹{fmtNum(hi, 0)}</span>
          </div>
          <div className="flex justify-between text-[10.5px] text-[var(--ink3)] mt-0.5">
            <span>52-week low</span>
            {off !== null && <span className="tabular-nums">From high {off > 0 ? "+" : off < 0 ? "−" : ""}{Math.abs(off).toFixed(1)}%</span>}
            <span>52-week high</span>
          </div>
        </div>
      )}
      {beta !== null && beta !== undefined && (
        <p className="text-[11px] text-[var(--ink3)] mt-2">Beta {fmtNum(beta)}</p>
      )}
    </section>
  );
}

/** The company's announcements as NSE lists them (fetch_announcement_docs.py,
 *  newest 50): Recent, or only the kinds that move a share (results, board
 *  outcomes, dividends, ratings, deals, orders), and a search over the subject
 *  and NSE's category - screener.in's Announcements box, without its AI
 *  summaries (the app shows no model-written text). */
function Announcements({ list }: { list: [string, string, string, string, number][] }) {
  const [tab, setTab] = useState<"recent" | "important">("recent");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = list.filter((a) => (tab === "recent" || a[4] === 1)
    && words.every((w) => `${a[1]} ${a[2]}`.toLowerCase().includes(w)));
  const shown = all || words.length ? rows : rows.slice(0, 8);
  const when = (at: string) => new Date(`${at.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-[13px] font-semibold text-[var(--ink)] mr-auto">Announcements</h3>
        <div className="inline-flex gap-0.5 rounded-lg bg-[var(--card2)] p-0.5 text-xs" role="radiogroup" aria-label="Announcements">
          {([["recent", "Recent"], ["important", "Important"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={tab === k} onClick={() => setTab(k)}
              className={`rounded-md px-2.5 py-1 font-medium ${tab === k ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>{label}</button>
          ))}
        </div>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search announcements"
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--card2)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)]" />
      {shown.length === 0 ? (
        <p className="text-xs text-[var(--ink3)]">{words.length ? "No announcement matches." : "None in the latest fifty."}</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {shown.map((a, i) => (
            <li key={`${a[0]}-${i}`} className="py-1.5">
              <a href={a[3]} target="_blank" rel="noopener noreferrer" className="block hover:underline">
                <span className="text-[13px] text-[var(--ink)] line-clamp-2">{a[2] || a[1]}</span>
                <span className="text-[11px] text-[var(--ink3)]">{when(a[0])} · {a[1]}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {!words.length && rows.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="text-[13px] font-semibold text-[var(--accent-ink)]">
          {all ? "Fewer" : `All ${rows.length}`}
        </button>
      )}
    </div>
  );
}


/** The Filings tab's lists (Step 5): each kind of filing on its own, newest
 *  first, four shown and the rest one tap away. A results PDF is the one
 *  attached to that quarter's results announcement on NSE. */
function FilingLists({ docs, quarters }: { docs?: Company["documents"] | null; quarters?: Quarter[] | null }) {
  const [all, setAll] = useState<Record<string, boolean>>({});
  const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
  const qName = (end: string) => `${new Date(`${end}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })} quarter`;
  const what = (t: string, kind?: string) => kind === "PPT" ? "Presentation" : kind === "Recording" ? "Recording"
    : /transcript/i.test(t) ? "Transcript" : /recording/i.test(t) ? "Recording link" : /presentation/i.test(t) ? "Presentation"
    : /meet/i.test(t) ? "Analyst meet" : (t || "Document").replace(/^.{0,120}?has informed the exchange (?:about|regarding)\s*/i, "").replace(/['".]+$/g, "");
  const pdfUrl = (u: string) => (u.includes("://") ? u : `https://nsearchives.nseindia.com/corporate/${u}`);

  const lists: { key: string; title: string; rows: { left: string; mid: string; url: string; link: string }[] }[] = [
    { key: "results", title: "Results filings",
      rows: [...(quarters ?? [])].filter((q) => q.pdf).reverse()
        .map((q) => ({ left: qName(q.end), mid: q.announced ? day(q.announced) : "", url: pdfUrl(q.pdf!), link: "PDF" })) },
    { key: "reports", title: "Annual reports",
      rows: [...(docs?.annual_reports ?? [])].sort((x, y) => Number(y.to) - Number(x.to))
        .map((r) => ({ left: `FY${String(r.to).slice(-2)}`, mid: `${r.from}–${String(r.to).slice(-2)}`, url: r.url, link: "PDF" })) },
    { key: "concalls", title: "Concalls",
      rows: [...(docs?.concalls ?? []).map((d) => ({ d, k: "" })), ...(docs?.ppts ?? []).map((d) => ({ d, k: "PPT" })), ...(docs?.recordings ?? []).map((d) => ({ d, k: "Recording" }))]
        .sort((x, y) => y.d.date.localeCompare(x.d.date))
        .map(({ d, k }) => ({ left: day(d.date), mid: what(d.title, k), url: d.url, link: "Open" })) },
    { key: "ratings", title: "Credit ratings",
      rows: [...(docs?.ratings ?? [])].sort((x, y) => y.date.localeCompare(x.date))
        .map((d) => ({ left: day(d.date), mid: "Credit rating letter", url: d.url, link: "PDF" })) },
  ].filter((l) => l.rows.length > 0);

  if (lists.length === 0) return null;
  return (
    <div className="space-y-4">
      {lists.map((l) => {
        const open = all[l.key];
        const shown = open ? l.rows : l.rows.slice(0, 4);
        return (
          <div key={l.key}>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="text-[13.5px] font-semibold text-[var(--ink)]">{l.title}</h3>
              {l.rows.length > 4 && (
                <button type="button" onClick={() => setAll({ ...all, [l.key]: !open })} className="text-[12px] font-semibold text-[var(--accent-ink)]">
                  {open ? "Fewer" : `All ${l.rows.length}`}
                </button>
              )}
            </div>
            <ul className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {shown.map((r) => (
                <li key={r.url}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                    className="grid grid-cols-[96px_minmax(0,1fr)_40px] items-center gap-2 py-2 text-[13px] hover:bg-[var(--card2)]">
                    <span className="text-[var(--ink)] tabular-nums truncate">{r.left}</span>
                    <span className="text-[var(--ink2)] truncate">{r.mid}</span>
                    <span className="text-right text-[var(--accent-ink)] font-semibold inline-flex items-center justify-end gap-0.5">{r.link}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** What the shareholding table says, in a sentence.
 *
 *  Tickertape gets this right structurally and wrong editorially: it prints
 *  "increasing promoter holding is considered good and reflects management's
 *  positive view" beside the number. That is an opinion about a motive nobody
 *  outside the company knows. The change itself is a fact, it is arithmetic on
 *  a table already on this page, and a reader scanning twelve columns of
 *  50.24 / 50.13 / 50.11 will not otherwise notice that the promoters have been
 *  selling for eight quarters running.
 *
 *  So: the movement, over three windows, and nothing about what it means.
 */
function HoldingTrend({ s }: { s: Shareholding }) {
  const p = s.promoter, d = s.dates;
  const n = p.length;
  if (n < 2) return null;

  const q = (label: string, back: number) => {
    const i = n - 1 - back;
    if (i < 0) return null;
    const from = p[i], to = p[n - 1];
    if (typeof from !== "number" || typeof to !== "number") return null;
    const diff = to - from;
    // Below five hundredths of a point the exchange's own rounding is larger
    // than the movement, so calling it a change would be reading noise.
    const moved = Math.abs(diff) >= 0.05;
    return {
      label,
      from: d[i],
      text: moved
        ? `${diff > 0 ? "rose" : "fell"} ${Math.abs(diff).toFixed(2)} points, ${from.toFixed(2)}% to ${to.toFixed(2)}%`
        : `unchanged at ${to.toFixed(2)}%`,
      up: moved ? diff > 0 : null,
    };
  };

  const windows = [q("Last quarter", 1), q("Over a year", 4), q(`Since ${d[0]?.slice(0, 7)}`, n - 1)]
    .filter(Boolean) as { label: string; from: string; text: string; up: boolean | null }[];

  // A run of consecutive falls is the thing a table of near-identical numbers
  // hides best, and the thing most worth noticing.
  let streak = 0;
  for (let i = n - 1; i > 0; i--) {
    // The series is (number | null)[] - a quarter can be filed with the
    // promoter line missing - so the two values are checked, not the result.
    const a = p[i], b = p[i - 1];
    if (typeof a !== "number" || typeof b !== "number") break;
    if (a - b <= -0.05) streak++;
    else break;
  }

  return (
    <div className="px-4 pb-3.5 pt-1 space-y-1.5 border-t border-[var(--line)]">
      <p className="text-xs font-semibold text-[var(--ink2)] pt-2.5">
        Promoter stake
        <InfoTip title="Promoter stake" className="ml-1">
          <p>A movement is stated, never interpreted.</p>
          <p>
            Promoters sell and buy for reasons no filing discloses — pledges, estate
            planning, an unrelated business.
          </p>
        </InfoTip>
      </p>
      {windows.map((w) => (
        <p key={w.label} className="text-[13px] text-[var(--ink3)]">
          <span className="text-[var(--ink2)]">{w.label}:</span>{" "}
          <span style={{ color: w.up === null ? undefined : w.up ? "var(--pos)" : "var(--neg)" }}>
            {w.text}
          </span>
        </p>
      ))}
      {streak >= 3 && (
        <p className="text-[13px] text-[var(--ink2)]">
          Promoters have reduced their stake in {streak} consecutive quarters.
        </p>
      )}
    </div>
  );
}

/** The nine Piotroski tests, as written by the pipeline. `pass` is null for a
 *  test whose inputs are not in both filed years. */
type FScoreData = {
  score: number;
  measured: number;
  of: number;
  years: [string, string] | string[];
  checks: { name: string; test: string; pass: boolean | null; detail: string | null }[];
};

/** Piotroski F-score, with every one of its nine tests on screen.
 *
 *  The only composite score this app carries, and the condition is that the
 *  total never appears without its workings. Trendlyne shows Durability,
 *  Valuation and Momentum scores whose construction is not published, which
 *  makes them impossible to argue with; Piotroski published his nine tests in
 *  2000 and each is arithmetic on two consecutive years of filed accounts, so
 *  every one can be checked and disagreed with individually.
 *
 *  It is not a recommendation and is not treated as one: a nine is a company
 *  whose accounts improved on nine measures last year, which is a fact about
 *  the past, not a view about the price.
 */
function FScore({ f }: { f: FScoreData }) {
  const [all, setAll] = useState(false);
  const failed = f.checks.filter((c) => c.pass !== true);
  const listed = all ? f.checks : failed;
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="flex-1 text-base font-semibold text-[var(--ink)]">
          Nine tests
          <InfoTip title="Nine tests on the accounts" className="ml-1.5">
            <p>
              The Piotroski F-score, comparing {f.years[1].slice(0, 4)} against {f.years[0].slice(0, 4)}. Every test is
              arithmetic on two filed years, and all nine are shown — a score whose workings are hidden cannot be argued with.
            </p>
            <p>
              A test whose inputs are missing counts as neither a pass nor a fail. Scoring an absent figure as zero would
              turn missing data into bad news, which is not what it is.
            </p>
          </InfoTip>
        </h2>
        <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">{f.score}/{f.measured}</span>
        <button type="button" onClick={() => setAll(!all)} aria-expanded={all}
          className="text-[12px] font-semibold text-[var(--accent-ink)]">{all ? "Failed only" : `All ${f.checks.length}`}</button>
      </div>
      <div className="mt-2.5 grid grid-cols-9 gap-1" role="list" aria-label="Test results">
        {f.checks.map((c) => (
          <span key={c.test} role="listitem" title={`${c.name} - ${c.pass === null ? "not measurable" : c.pass ? "passed" : "failed"}`}
            className="h-6 rounded-md flex items-center justify-center"
            style={{ background: c.pass === null ? "var(--card2)" : `color-mix(in srgb, var(${c.pass ? "--pos" : "--neg"}) 16%, transparent)` }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              stroke={c.pass === null ? "var(--ink3)" : c.pass ? "var(--pos)" : "var(--neg)"}>
              <path d={c.pass === null ? "M12 7v6M12 17v.5" : c.pass ? "M5 12.5l4.5 4.5L19 7.5" : "M7 7l10 10M17 7L7 17"} />
            </svg>
            <span className="sr-only">{c.name}: {c.pass === null ? "not measurable" : c.pass ? "passed" : "failed"}</span>
          </span>
        ))}
      </div>
      {listed.length > 0 && (
        <>
          <p className="mt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ink3)]">
            {all ? "All tests" : "Failed or not measurable"} · {f.years[1].slice(0, 4)} vs {f.years[0].slice(0, 4)}
          </p>
          <ul className="divide-y divide-[var(--line)]">
            {listed.map((c) => (
              <li key={c.test} className="py-1.5 flex items-baseline gap-2 text-[13px]">
                <span className="shrink-0 w-3 text-center font-bold" aria-hidden="true"
                  style={{ color: c.pass === null ? "var(--ink3)" : c.pass ? "var(--pos)" : "var(--neg)" }}>
                  {c.pass === null ? "?" : c.pass ? "\u2713" : "\u2715"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-[var(--ink)]">{c.name}</span>
                  <span className="block text-[11px] text-[var(--ink3)]">
                    {c.test}{c.detail ? ` — ${c.detail}` : " — not reported in both years, so not scored"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Where today's valuation sits inside this company's OWN history.
 *
 *  The one thing a rival screener charges for and none of them show honestly:
 *  Trendlyne puts "99% of time spent below current P/E" behind a subscription
 *  and wraps it in a "Strong Sell Zone" verdict. The percentile is the useful
 *  half and it is arithmetic on a series this app already publishes - no
 *  opinion attached, and the count of months it was taken over is printed so
 *  the reader can discount it.
 *
 *  A ratio is only comparable against its own history when there IS a history:
 *  under three years of monthly points the percentile is noise, so it is
 *  withheld rather than shown small.
 */
/** Whether "Against its own history" has anything to draw.
 *
 *  Exported as its own rule because the SECTION and the MENU ENTRY that points
 *  at it must agree. They did not: the menu asked whether a band exists at all
 *  while the section needs 36 monthly points, so NSDL - BSE-only, no bands -
 *  offered "Own history" and scrolled to an empty div. That is the same fault
 *  as the half-empty section menu fixed on 9-Aug: a menu item that goes
 *  nowhere reads as a broken page, which is worse than an absent one.
 */
function hasValuationHistory(company: Company): boolean {
  return [company.pe_band, company.pb_band, company.ev_band, company.ps_band].some(
    (b) => (b?.series ?? []).filter(
      (p) => Array.isArray(p) && typeof p[1] === "number" && Number.isFinite(p[1])
    ).length >= 36
  );
}

function ValuationHistory({ company }: { company: Company }) {
  const bands: [string, PeBand | null | undefined, string][] = [
    ["Price to earnings", company.pe_band, "P/E"],
    ["Price to book", company.pb_band, "P/B"],
    ["EV to EBITDA", company.ev_band, "EV/EBITDA"],
    ["Market cap to sales", company.ps_band, "MCap/Sales"],
  ];
  const rows = bands.map(([label, band, short]) => {
    const s = (band?.series ?? []).filter((p): p is [string, number] =>
      Array.isArray(p) && typeof p[1] === "number" && Number.isFinite(p[1]));
    if (s.length < 36) return null;
    const now = s[s.length - 1];
    const vals = s.map((p) => p[1]);
    const below = vals.filter((v) => v < now[1]).length;
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    return {
      label, short,
      value: now[1], date: now[0], median,
      pct: Math.round((below / vals.length) * 100),
      n: vals.length, from: s[0][0].slice(0, 7),
      lo: sorted[0], hi: sorted[sorted.length - 1],
    };
  }).filter(Boolean) as {
    label: string; short: string; value: number; date: string; median: number;
    pct: number; n: number; from: string; lo: number; hi: number;
  }[];

  if (rows.length === 0) return null;

  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <h2 className="text-base font-semibold text-[var(--ink)] mb-1">
        Against its own history
        <InfoTip title="Against its own history" className="ml-1.5">
          <p>Where today&rsquo;s valuation sits in this company&rsquo;s own record.</p>
          <p>
            Cheap and expensive mean nothing across industries; against the same
            company&rsquo;s past they mean something. Not a signal — a business can be worth
            more than it used to be.
          </p>
          <p>
            Each series ends {rows[0].date}, the last month with a filed trailing figure —
            not today&rsquo;s price.
          </p>
        </InfoTip>
      </h2>
      <div className="divide-y divide-[var(--line)]">
        {rows.map((r) => {
          // Today's value against the median of its own record, on one scale
          // from zero; the gap is printed, never coloured as good or bad.
          const top = Math.max(r.value, r.median, 0) * 1.15 || 1;
          const gap = r.median ? ((r.value - r.median) / Math.abs(r.median)) * 100 : null;
          return (
            <div key={r.label} className="py-1.5">
              <div className="grid grid-cols-[76px_44px_minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
                <span className="text-[var(--ink2)] truncate">{r.short}</span>
                <span className="text-right font-semibold text-[var(--ink)] tabular-nums">{fmtNum(r.value)}</span>
                <span className="relative h-1.5 rounded-full bg-[var(--line)]" aria-hidden="true">
                  <span className="absolute left-0 top-0 h-1.5 rounded-full bg-[var(--ink3)]" style={{ width: `${Math.max(0, (r.value / top) * 100)}%` }} />
                  <span className="absolute -top-[3px] w-[2px] h-3 bg-[var(--accent)]" style={{ left: `${Math.max(0, (r.median / top) * 100)}%` }} />
                </span>
                <span className="text-[11px] text-[var(--ink3)] tabular-nums whitespace-nowrap">
                  Med {fmtNum(r.median)}{gap !== null && <> · <span className="text-[var(--ink2)]">{gap > 0 ? "+" : gap < 0 ? "−" : ""}{Math.abs(gap).toFixed(0)}%</span></>}
                </span>
              </div>
              {/* The window is stated, not just its length: these series do not
                  reach equally far back. */}
              <p className="text-[10.5px] text-[var(--ink3)] tabular-nums mt-0.5">
                Lower than now on {r.pct}% of {r.n.toLocaleString("en-IN")} months since {periodLabel(`${r.from}-01`)} · range {fmtNum(r.lo)}–{fmtNum(r.hi)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Every company in the same industry, plus where this one sits by size. */
type Cohort = {
  /** Only populated by the fallback path, where medians must be computed here.
   *  With a modern company file the medians arrive precomputed and this is []. */
  rows: Row[];
  /** field -> [median, how many companies it came from] */
  medians: Record<string, [number, number]>;
  industry: string;
  rank: number | null;
  rankOf: number;
  indRank: number | null;
  indRankOf: number;
};

/** The median of one field across the industry, and how many companies it was
 *  taken over. Median rather than mean: one company with a P/E of 900 - and
 *  there are several - drags a mean somewhere no company actually is.
 *  Withheld below five companies, where a "median" is just one firm's number
 *  wearing a statistical hat. */
function industryMedian(cohort: Cohort, field: string): { value: number; n: number } | null {
  const pre = cohort.medians?.[field];
  if (pre) return { value: pre[0], n: pre[1] };
  const rows = cohort.rows;
  const vs = rows
    .map((r) => r[field])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (vs.length < 5) return null;
  const m = vs.length % 2 ? vs[(vs.length - 1) / 2] : (vs[vs.length / 2 - 1] + vs[vs.length / 2]) / 2;
  return { value: m, n: vs.length };
}

/** A ₹ crore figure short enough for a tile whose label carries "₹Cr":
 *  8.13L (lakh crore) or 45,031. */
function crShort(v: number | null): string {
  if (v === null) return "—";
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(2)}L`;
  return `${sign}${fmtNum(a, 0)}`;
}

type Tile = { label: string; value: string; sub?: string | null; field?: string; full?: string; info?: string };

function RatioGrid({ snapshot, row, cohort, next, updates, faceValue }: {
  snapshot: Row; row: Row | null; cohort: Cohort | null; next?: NextResults; updates?: Updates | null; faceValue?: number | null;
}) {
  const g = (k: string) => num(row, k) ?? num(snapshot, k);
  const method = String((row?.["vol_method"] ?? snapshot["vol_method"]) ?? "");
  // A missing value is a bare dash, never "₹ — Cr": a unit wrapped round
  // nothing dresses an absence up as a figure.
  const pct = (v: number | null) => (v === null ? "—" : `${fmtNum(v, Math.abs(v) >= 100 ? 0 : 1)}%`);
  const plain = (v: number | null) => (v === null ? "—" : fmtNum(v));
  const rupee = (v: number | null, dec = 2) => (v === null ? "—" : `₹${fmtNum(v, dec)}`);
  const price = g("price"), hi = g("wk52_high"), lo = g("wk52_low");
  const fromHi = price !== null && hi ? ((price - hi) / hi) * 100 : null;
  const fromLo = price !== null && lo ? ((price - lo) / lo) * 100 : null;
  const signedPct = (v: number | null) => (v === null ? null : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);
  const debt = g("total_debt"), cash = g("total_cash"), mcap = g("mcap");
  const ev = mcap === null ? null : mcap + ((debt ?? 0) - (cash ?? 0)) / 1e7;
  const day = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", opts);

  // Grouped by the question each one answers; four short groups is a page to
  // scan where fourteen rows were a list to read. `field` is the data.json
  // field an industry median is taken on - none for a per-share figure, whose
  // median across an industry compares nothing.
  const groups: [string, Tile[]][] = [
    ["Size and price", [
      { label: "MCap ₹Cr", info: "Market Cap", value: crShort(mcap), full: mcap === null ? undefined : `₹${fmtNum(mcap, 0)} Cr`,
        sub: cohort?.rank ? `#${cohort.rank.toLocaleString("en-IN")} of ${cohort.rankOf.toLocaleString("en-IN")}` : null },
      { label: "Ind. rank", value: cohort?.indRank ? `#${cohort.indRank}` : "—", sub: cohort?.indRank ? `of ${cohort.indRankOf}` : null },
      { label: "52W high", info: "High / Low", value: rupee(hi, 0), sub: fromHi === null ? null : signedPct(fromHi) },
      { label: "52W low", value: rupee(lo, 0), sub: fromLo === null ? null : signedPct(fromLo) },
    ]],
    ["What it costs", [
      { label: "Stock P/E", value: plain(g("pe")), field: "pe" },
      { label: "Book value", info: "Book Value", value: rupee(g("book_value")), sub: "Per share" },
      { label: "Div. yield", info: "Dividend Yield", value: pct(g("div_yield")), field: "div_yield" },
      ...(faceValue ? [{ label: "Face value", value: `₹${fmtNum(faceValue, faceValue % 1 ? 2 : 0)}`, sub: "Per share" }] : []),
    ]],
    ["What it earns", [
      { label: "ROCE", value: pct(g("roce")), field: "roce" },
      { label: "ROE", value: pct(g("roe")), field: "roe" },
      { label: "Sales 5Y", info: "Sales growth 5Y", value: pct(g("sales_cagr_5y")), field: "sales_cagr_5y" },
      { label: "Profit 5Y", info: "Profit growth 5Y", value: pct(g("profit_cagr_5y")), field: "profit_cagr_5y" },
      { label: "Results", value: next ? day(next.date, { day: "numeric", month: "short" }) : "—",
        full: next ? day(next.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : undefined,
        sub: next ? `${periodLabel(quarterBefore(next.date))} qtr` : next === null ? "No date yet" : null },
      // Only for a company that files them (owner: no dead tiles).
      ...(updates ? [{ label: "Update", info: "Business update", value: day(updates.last.d, { day: "numeric", month: "short" }),
        sub: `${updates.n} of ${updates.of} qtrs`,
        full: [`${updates.last.q}`, `${updates.n} of ${updates.of} quarters`, updates.typ != null && `usually day ${updates.typ}`].filter(Boolean).join(" · ") }] : []),
    ]],
    ["Risk and ownership", [
      // Absolute debt and cash as well as the ratio: the ratio gives the shape
      // of the funding, these give its size against the profit.
      { label: "EV ₹Cr", info: "Enterprise value", value: crShort(ev), full: "Market cap plus debt, less cash" },
      { label: "Debt ₹Cr", value: debt === null ? "—" : crShort(debt / 1e7) },
      { label: "Cash ₹Cr", value: cash === null ? "—" : crShort(cash / 1e7) },
      { label: "Debt/equity", info: "Debt / Equity", value: plain(g("de")), field: "de" },
      { label: "Promoter", info: "Promoter holding", value: pct(g("promoter_holding")), field: "promoter_holding" },
      { label: "Vol. 1Y", info: "Volatility 1Y", value: pct(g("volatility_1y")), field: "volatility_1y" },
      { label: "Vol. 30D", info: "Volatility 30D", value: pct(g("volatility_30d")), field: "volatility_30d" },
    ]],
  ];

  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3 sm:p-4">
      <h2 className="text-base font-semibold text-[var(--ink)] px-1">
        Key figures
        <InfoTip title="Key figures" label="How these figures are worked out" className="ml-1.5">
          {groups.flatMap(([, tiles]) => tiles).map((t) => {
            const info = METRIC_INFO[t.info ?? t.label];
            if (!info) return null;
            return (
              <InfoPart key={t.label} head={t.info ?? t.label}>
                {info.how} {info.means}{info.watch ? ` ${info.watch}` : ""}
                {(t.info ?? t.label).startsWith("Volatility") && method && ` Method for this company: ${method === "yang-zhang" ? "Yang-Zhang (OHLC)" : "close-to-close"}.`}
              </InfoPart>
            );
          })}
          <p className="text-[var(--ink3)]">The bar under a figure puts this company (grey) and its industry median (blue line) on one scale. Neither colour means good or bad.</p>
        </InfoTip>
      </h2>
      <div className="mt-1 space-y-3">
        {groups.map(([heading, tiles]) => (
          <div key={heading}>
            <h3 className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ink3)] mb-1.5 px-1">{heading}</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {tiles.map((t) => {
                const med = t.field && cohort ? industryMedian(cohort, t.field) : null;
                const mine = t.field ? g(t.field) : null;
                const medTxt = med ? (Math.abs(med.value) >= 100 ? fmtNum(med.value, 0) : fmtNum(med.value, 1)) : null;
                // Value and industry median on one scale from zero. Grey and
                // blue, never green or red: above the median is not good news.
                const top = med && mine !== null && mine > 0 && med.value > 0 ? Math.max(mine, med.value) * 1.1 : null;
                return (
                  <div key={t.label} className="min-w-0 rounded-lg bg-[var(--card2)] px-2 py-1.5" title={t.full}>
                    <p className="text-[10.5px] leading-tight text-[var(--ink3)] truncate">{t.label}</p>
                    <p className="text-[14px] leading-[18px] font-semibold text-[var(--ink)] tabular-nums truncate">{t.value}</p>
                    {med ? (
                      <p className="text-[10px] leading-tight text-[var(--accent-ink)] truncate tabular-nums"
                        title={`Industry median ${medTxt} across ${med.n} companies`}>
                        Ind {medTxt}{med.n < 15 ? ` (${med.n})` : ""}
                      </p>
                    ) : t.sub ? (
                      <p className="text-[10px] leading-tight text-[var(--ink3)] truncate">{t.sub}</p>
                    ) : null}
                    {top && mine !== null && med && (
                      <div className="relative h-[3px] mt-1.5 rounded-full bg-[var(--line)]" aria-hidden="true">
                        <div className="h-[3px] rounded-full bg-[var(--ink3)]" style={{ width: `${(mine / top) * 100}%` }} />
                        <div className="absolute -top-[2px] w-[2px] h-[7px] bg-[var(--accent)]" style={{ left: `${(med.value / top) * 100}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-[10.5px] text-[var(--ink3)] flex flex-wrap gap-x-3 gap-y-0.5">
        <span>Bar: this company <span className="inline-block align-middle w-3 h-[3px] rounded bg-[var(--ink3)]" /> vs industry median <span className="inline-block align-middle w-[2px] h-[7px] bg-[var(--accent)]" /></span>
      </p>
      <PinnedRatios row={row} />
    </section>
  );
}

/** The shape of a company page, shimmering, while its data loads - instead of
 *  "Loading TCS..." on an empty screen that then jumps into a full page. */
/** The page's tabs, and the sections each one holds. Every section of the old
 *  single scroll lives in exactly one tab, so nothing is lost by the split; a
 *  link to a section (#quarters, #shareholding) opens the tab that holds it. */
type TabKey = "overview" | "results" | "accounts" | "owners" | "filings";
const TABS: { key: TabKey; label: string; sections: string[] }[] = [
  { key: "overview", label: "Overview", sections: ["summary", "chart", "performance", "analysis", "checks", "valuation", "peers"] },
  { key: "results", label: "Results", sections: ["quarters", "segments", "profit-loss"] },
  { key: "accounts", label: "Accounts", sections: ["balance-sheet", "cash-flows", "ratios"] },
  { key: "owners", label: "Owners", sections: ["institutions", "shareholding"] },
  { key: "filings", label: "Filings", sections: ["documents", "notes"] },
];
const TAB_OF: Record<string, TabKey> = Object.fromEntries(TABS.flatMap((t) => [[t.key, t.key], ...t.sections.map((id) => [id, t.key])]));

/** "26 L" holders, "4.2 K", or the plain count. */
function holdersShort(n: number): string {
  if (n >= 1e5) return `${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1)} L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)} K`;
  return String(n);
}

function CompanySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="rs-skel h-8 w-3/4" />
      <div className="rs-skel h-4 w-1/2" />
      <div className="rs-skel h-10 w-2/5 !mt-6" />
      <div className="flex gap-2 !mt-6">{[0, 1, 2, 3].map((i) => <div key={i} className="rs-skel h-9 w-20" />)}</div>
      <div className="rs-skel h-80 w-full" />
    </div>
  );
}

function CompanyView() {
  const params = useSearchParams();
  const symbol = (params.get("s") ?? "").toUpperCase();
  const [company, setCompany] = useState<Company | null>(null);
  const [peers, setPeers] = useState<Row[]>([]);
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [fullRow, setFullRow] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  /** Scroll down the page, or swipe between sections one at a time. Set in
   *  Settings; read here on mount and updated live when Settings changes it,
   *  so you do not have to reload the company you are already looking at.
   *  Starts at "scroll" on the server so the markup matches on hydration. */
  const [mode, setMode] = useState<SectionMode>("scroll");
  const pager = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [panes, setPanes] = useState(0);
  // The id of each pane in order, so the section nav can highlight where you
  // are. Read off the DOM rather than kept as a parallel list, which would go
  // stale the first time a section is added or made conditional.
  const [paneIds, setPaneIds] = useState<string[]>([]);
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  // Whether this company has an Institutions card (it loads on its own).
  const [hasInst, setHasInst] = useState(false);
  useEffect(() => {
    const read = () => setSectionOrder(loadOrder("sections"));
    read();
    window.addEventListener("rs-order", read);
    return () => window.removeEventListener("rs-order", read);
  }, []);

  // Which tab is open. A link to a tab (#results) or to a section inside one
  // (#quarters) opens that tab, then scrolls to the section once it is shown.
  const [tab, setTab] = useState<TabKey>("overview");
  const tabAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const t = TAB_OF[id];
      if (!t) return;
      setTab(t);
      if (id !== t) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [company]);
  const pickTab = (k: TabKey) => {
    setTab(k);
    try { window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${k}`); } catch { /* the tab still opens */ }
    // Opening a tab while scrolled down shows it from its top, under the bar.
    const a = tabAnchor.current;
    if (a) {
      const top = a.getBoundingClientRect().top + window.scrollY - (window.matchMedia("(min-width: 640px)").matches ? 56 : 0);
      if (window.scrollY > top) window.scrollTo({ top });
    }
  };

  useEffect(() => {
    setMode(loadSectionMode());
    const onMode = (e: Event) => setMode((e as CustomEvent).detail as SectionMode);
    window.addEventListener("rs-sections", onMode);
    return () => window.removeEventListener("rs-sections", onMode);
  }, []);

  // Which pane is in view, and how many there are. Counted from the DOM rather
  // than from a list of section names, because half the sections are
  // conditional - a BSE-only company has no quarters, P&L or shareholding, and
  // a hardcoded count would tell you "section 3 of 12" on a page with 6.
  useEffect(() => {
    const el = pager.current;
    if (!el || mode !== "swipe") { setPanes(0); return; }
    const measure = () => {
      setPanes(el.children.length);
      // VISUAL order, not DOM order. With the sections sequenced by CSS `order`
      // the two differ, and every index derived from this list - which pane the
      // menu highlights, which one a jump scrolls to - is an index into what
      // the reader sees, never into the source.
      setPaneIds(applyOrder(Array.from(el.children).map((c) => c.id), (id) => id, sectionOrder));
      setPage(el.clientWidth ? Math.round(el.scrollLeft / el.clientWidth) : 0);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    // Re-measure when the pane list itself changes. A one-shot count read 13
    // where the DOM ended up with 14, because a conditional section can mount
    // a tick after the effect runs, and the count then stayed wrong for the
    // life of the page - "section 1 of 13" on a page with fourteen. Watching
    // childList means the number corrects itself rather than depending on this
    // effect happening to run last.
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true });
    return () => {
      mo.disconnect();
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
    // `company` is a dependency because the pager does not exist until the data
    // arrives - the page renders "Loading…" first. Keyed on `mode` alone it
    // measured an element that was still null and reported "section 1 of 0".
  }, [mode, company, sectionOrder]);

  const sectionNav = useRef<HTMLElement>(null);

  // Swipe to a section and its NAME comes with you.
  //
  // The menu already highlighted the section you were on, which is no use when
  // the highlighted item is off the end of the menu's own horizontal scroll:
  // swipe to Balance Sheet and the menu still reads Summary … Peers, with the
  // highlight somewhere past the right edge. You could see where you were only
  // by scrolling a second thing.
  //
  // Scrolled by hand rather than with scrollIntoView, which reveals an element
  // by scrolling EVERY ancestor that can scroll - here that is the pager and
  // the window, so asking for a menu item would have dragged the section
  // sideways underneath it. Measured off bounding rects rather than offsetLeft,
  // which is relative to whichever ancestor happens to be positioned.
  useEffect(() => {
    if (mode !== "swipe") return;
    const nav = sectionNav.current;
    const id = paneIds[page];
    if (!nav || !id) return;
    const link = nav.querySelector<HTMLElement>(`a[href="#${CSS.escape(id)}"]`);
    if (!link) return;
    const nr = nav.getBoundingClientRect();
    const lr = link.getBoundingClientRect();
    // Centre it where there is room; the clamp inside scrollBy handles the ends.
    const delta = (lr.left - nr.left) - (nav.clientWidth - lr.width) / 2;
    if (Math.abs(delta) <= 4) return;
    // Someone who has asked their device for less motion should not be given a
    // sliding menu on every swipe; they get the same result, immediately.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollBy({ left: delta, behavior: still ? "auto" : "smooth" });
  }, [mode, page, paneIds]);

  // ONE SWIPE, ONE SECTION - driven here rather than left to the browser.
  //
  // scroll-snap-stop: always is supported and still let a single swipe cross
  // several sections in the installed app: snap decides where a scroll comes to
  // REST, and the WebView's fling had already carried it three panes by then.
  // So the horizontal gesture is taken off the browser entirely - CSS
  // touch-action: pan-y - and moved here, where a gesture can only ever commit
  // to the neighbouring section.
  //
  // The finger is tracked 1:1 during the drag, which is what makes it feel
  // attached rather than approximate, and the axis is locked on the first few
  // pixels so a vertical read never drifts sideways and a sideways swipe never
  // scrolls the page.
  useEffect(() => {
    const el = pager.current;
    if (!el || mode !== "swipe") return;

    let startX = 0, startY = 0, startScroll = 0, startIndex = 0;
    let axis: "x" | "y" | null = null;
    let lastX = 0, lastT = 0, velocity = 0, current = 0;

    const width = () => el.clientWidth || 1;

    const settle = (index: number) => {
      const n = el.children.length;
      const target = Math.max(0, Math.min(n - 1, index));
      el.scrollTo({ left: target * width(), behavior: "smooth" });
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = lastX = current = t.clientX;
      startY = t.clientY;
      startScroll = el.scrollLeft;
      startIndex = Math.round(startScroll / width());
      axis = null;
      velocity = 0;
      lastT = e.timeStamp;
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      // Lock the axis once the gesture has committed to a direction. Below the
      // threshold neither is claimed, so a tap or a tiny wobble does nothing.
      if (axis === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (axis === "y") return;   // the page scrolls; touch-action: pan-y allows it

      // Velocity over a FRAME, not between consecutive events. Touch events can
      // arrive a fraction of a millisecond apart - coalesced, or on a 120Hz
      // panel - and dividing a few pixels by that gives a number that looks
      // like a violent flick. A 40px twitch was paging the section on exactly
      // that arithmetic. Sampling no faster than one frame keeps the figure
      // honest.
      const dt = e.timeStamp - lastT;
      if (dt >= 16) {
        velocity = (t.clientX - lastX) / dt;   // px per ms, signed
        lastX = t.clientX;
        lastT = e.timeStamp;
      }
      current = t.clientX;

      // 1:1 with the finger, with resistance at the two ends so the first and
      // last sections feel like edges rather than like a broken control.
      let next = startScroll - dx;
      const max = (el.children.length - 1) * width();
      if (next < 0) next = next / 3;
      else if (next > max) next = max + (next - max) / 3;
      el.scrollLeft = next;
    };

    const onEnd = () => {
      if (axis !== "x") { axis = null; return; }
      const moved = current - startX;
      const travelled = moved / width();
      // Either a decisive flick or a third of the way across commits to the
      // next section; anything less falls back to where it started. One
      // section per gesture whichever way it was earned.
      //
      // A flick also has to have GONE somewhere - 24px at minimum. Speed alone
      // is not intent: a fast twitch while reading is not a request to change
      // section, and it was being treated as one.
      const flicked = Math.abs(velocity) > 0.35 && Math.abs(moved) > 24;
      let index = startIndex;
      if (travelled <= -0.33 || (flicked && velocity < 0)) index = startIndex + 1;
      else if (travelled >= 0.33 || (flicked && velocity > 0)) index = startIndex - 1;
      settle(index);
      axis = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [mode, paneIds]);

  // The pager is exactly as tall as the section you are looking at.
  //
  // A flex row is as tall as its tallest child, so without this the page would
  // carry the height of the longest section under every short one - the empty
  // space below Analysis would be the height of the balance sheet. Re-measured
  // when the pane changes size, because Documents grows when a year is opened.
  useEffect(() => {
    const el = pager.current;
    if (!el || mode !== "swipe") { if (el) el.style.height = ""; return; }
    const id = paneIds[page];
    const pane = id ? (Array.from(el.children).find((c) => c.id === id) as HTMLElement | undefined) : undefined;
    if (!pane) return;
    const fit = () => { el.style.height = `${pane.scrollHeight}px`; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [mode, page, paneIds]);

  const step = useCallback((d: number) => {
    const el = pager.current;
    if (!el) return;
    el.scrollBy({ left: d * el.clientWidth, behavior: "smooth" });
  }, []);

  /** Jump to a named section while in swipe mode.
   *
   *  A plain `#id` link cannot do this job here. The browser scrolls EVERY
   *  ancestor scroll container to reveal the target - the pager sideways, and
   *  the window downwards as well - and since the panes are height-capped the
   *  document is short, so the window scroll left the header stranded above a
   *  blank strip. Paging by index is exact: every pane is exactly one container
   *  wide, so pane n sits at n × clientWidth, and the window stays put.
   *
   *  Returns false if the section is not inside the pager, in which case the
   *  ordinary anchor is left to do its ordinary thing.
   */
  const goTo = useCallback((id: string) => {
    const el = pager.current;
    const target = document.getElementById(id);
    if (!el || !target) return false;
    const pane = Array.from(el.children).find((c) => c === target || c.contains(target));
    if (!pane) return false;
    const visual = applyOrder(Array.from(el.children).map((c) => c.id), (id) => id, sectionOrder);
    const i = visual.indexOf(pane.id);
    if (i < 0) return false;
    // Instant, not smooth. `scroll-snap-type: x mandatory` re-snaps to the
    // NEAREST pane whenever a smooth scroll is interrupted - and the window
    // scroll below interrupts it - so a tap on "Balance Sheet" would set off
    // towards pane 6, get 88px in, and snap straight back to pane 0. Measured:
    // scrollLeft settled at 0.079 of a pane every time. An instant jump has no
    // flight for the snapper to interrupt. It is also the better behaviour for
    // a menu tap: six panes of sideways animation is a long wait for a jump you
    // asked for by name.
    // Width can be zero when the page is laid out in a hidden container - a
    // background tab, a collapsed pane, a print view. Paging by index would
    // then compute 0 for every section and silently go nowhere, so fall back
    // to letting the browser reveal the element the ordinary way.
    if (el.clientWidth > 0) {
      el.scrollLeft = i * el.clientWidth;
    } else {
      target.scrollIntoView({ block: "nearest", inline: "start" });
    }
    (pane as HTMLElement).scrollTop = 0;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.top - 116) > 24) window.scrollBy({ top: r.top - 116, behavior: "smooth" });
    return true;
  }, [sectionOrder]);

  // Arrow keys page through it on a desktop, where there is nothing to swipe.
  useEffect(() => {
    if (mode !== "swipe") return;
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [mode, step]);

  useEffect(() => {
    if (!symbol) return;
    pushRecent(symbol);
    setNote(loadNote(symbol));
  }, [symbol]);

  // The next results meeting, from the calendar the Calendar page reads
  // (8 KB on the wire). Undefined while loading, null if NSE lists none.
  const [nextResults, setNextResults] = useState<NextResults>(undefined);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [basisView, setBasisView] = useState<"consolidated" | "standalone">("consolidated");
  useEffect(() => {
    if (!symbol) return;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    fetch(`${BASE}/calendar.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cal: { events?: { symbol: string; date: string; purpose: string; kind: string; type?: string }[] } | null) => {
        if (!cal?.events) return setNextResults(undefined);
        const hit = cal.events
          .filter((e) => e.symbol === symbol && e.kind === "meeting" && e.date >= today
            && (e.type === "results" || /result/i.test(e.purpose)))
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        setNextResults(hit ? { date: hit.date, purpose: hit.purpose } : null);
      })
      .catch(() => setNextResults(undefined));
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    // Past the HTTP cache on the load a refresh produced - a fresh shell around
    // yesterday's company file is the staleness this button exists to end.
    fetch(`${BASE}/companies/${symbol}.json`, isRefreshLoad() ? { cache: "reload" } : undefined)
      .then((r) => { if (!r.ok) throw new Error(`no data for ${symbol}`); return r.json(); })
      .then(setCompany)
      .catch((e) => {
        // An ETF's old company link - bookmarked, or shared before ETFs left the
        // company table on 27-Sep-2026. It has a page of its own now.
        const fail = () => setError(String(e.message ?? e));
        fetch(`${BASE}/etf/${encodeURIComponent(symbol)}.json`, { method: "HEAD" })
          .then((r) => (r.ok ? window.location.replace(`${BASE}/etf/?s=${encodeURIComponent(symbol)}`) : fail()))
          .catch(fail);
      });
  }, [symbol]);

  useEffect(() => {
    if (!company) return;
    // The row, the peers and the industry context now travel INSIDE this
    // company's own file - about 3 KB of the 32 KB already downloaded. This
    // page used to fetch the whole 5.6 MB screener table and keep three things
    // from it: 99.4% of the transfer discarded, on the app's most-visited page.
    if (company.row || company.peers || company.context) {
      setFullRow((company.row as Row) ?? null);
      setPeers((company.peers as Row[]) ?? []);
      const c = company.context;
      setCohort(c ? {
        rows: [],
        industry: c.industry ?? "",
        medians: c.medians ?? {},
        rank: c.rank ?? null,
        rankOf: c.rank_of ?? 0,
        indRank: c.ind_rank ?? null,
        indRankOf: c.ind_rank_of ?? 0,
      } : null);
      return;
    }
    // Older company files carry none of that. Rather than show a page with no
    // peers and no context, fall back to what this page used to do.
    fetch(`${BASE}/data.json`)
      .then((r) => r.json())
      .then((d: ScreenData) => {
        setFullRow(d.rows.find((r) => r.symbol === company.snapshot.symbol) ?? null);
        const ind = company.snapshot.industry;
        if (!ind) return;
        const sameIndustry = d.rows.filter((r) => r.industry === ind);
        setPeers(
          sameIndustry
            .filter((r) => r.symbol !== company.snapshot.symbol)
            .sort((a, b) => ((b.mcap as number) ?? 0) - ((a.mcap as number) ?? 0))
            .slice(0, 8)
        );
        const withCap = d.rows.filter((r) => typeof r.mcap === "number");
        const byCap = [...withCap].sort((a, b) => (b.mcap as number) - (a.mcap as number));
        const rank = byCap.findIndex((r) => r.symbol === company.snapshot.symbol);
        const indByCap = byCap.filter((r) => r.industry === ind);
        const indRank = indByCap.findIndex((r) => r.symbol === company.snapshot.symbol);
        setCohort({
          rows: sameIndustry,
          industry: String(ind),
          medians: {},
          rank: rank >= 0 ? rank + 1 : null,
          rankOf: byCap.length,
          indRank: indRank >= 0 ? indRank + 1 : null,
          indRankOf: indByCap.length,
        });
      })
      .catch(() => { /* peers are optional */ });
  }, [company]);

  // "Consolidated" is not a safe default: say which one this company files, and
  // say nothing rather than guess when the basis was never recorded.
  const figuresCaption =
    company?.basis === "standalone" ? "Standalone figures in ₹ Crores"
    : company?.basis === "consolidated" ? "Consolidated figures in ₹ Crores"
    : "Figures in ₹ Crores";

  const exportCompanyXlsx = () => {
    if (!company) return;
    // One workbook, a sheet per table - screener.in's "Export to Excel".
    const sheets: { name: string; rows: Cell[][] }[] = [];
    const sheetOf = (name: string, stmt: Stmt) => sheets.push({
      name,
      rows: [["", ...stmt.periods], ...stmt.items.map((it) => [it.parent ? `  ${it.label}` : it.label, ...it.values] as Cell[])],
    });
    sheets.push({ name: "Summary", rows: [[`${symbol} - Rscreener export`, company.generated_at], [], ...Object.entries(company.snapshot).map(([k, v]) => [k, typeof v === "number" ? v : v === null || v === undefined ? "" : String(v)] as Cell[])] });
    for (const [key, title] of Object.entries(STMT_TITLES)) {
      if (company.statements[key]) sheetOf(title, company.statements[key]);
    }
    if (company.trend?.annual) sheetOf("Track record annual", trendToStmt(company.trend.annual));
    if (company.trend?.quarterly) sheetOf("Track record quarterly", trendToStmt(company.trend.quarterly));
    if (company.shareholding && company.shareholding.dates.length > 0) {
      sheetOf("Shareholding", {
        periods: company.shareholding.dates,
        items: [
          { label: "Promoters %", values: company.shareholding.promoter },
          ...(company.shareholding.fii ? [{ label: "FIIs %", values: company.shareholding.fii }] : []),
          ...(company.shareholding.dii ? [{ label: "DIIs %", values: company.shareholding.dii }] : []),
          ...(company.shareholding.mf ? [{ label: "Mutual funds %", values: company.shareholding.mf }] : []),
          { label: "Public %", values: company.shareholding.public },
          { label: "Employee trusts %", values: company.shareholding.employee },
        ],
      });
    }
    sheets.push({ name: "Notes", rows: [["Figures from free sources (NSE / BSE filings, Yahoo); unverified until checked against the company's filing."], ["Rscreener screens; it never recommends."]] });
    void saveFile(`${symbol}_rscreener.xlsx`, buildXlsx(sheets), XLSX_MIME);
  };

  if (!symbol) return <p className="text-[var(--ink3)] p-6">No company selected. <Link className="text-[var(--accent-ink)] underline" href="/">Back to screener</Link></p>;
  if (error) return <p className="text-[var(--neg)] p-6">{error} — <Link className="text-[var(--accent-ink)] underline" href="/">Back to screener</Link></p>;
  if (!company) return <CompanySkeleton />;

  const s = company.snapshot;
  const price = num(fullRow, "price") ?? num(s, "price");
  const nseSector = (company.context?.nse_sector as string | undefined) ?? (fullRow?.["nse_sector"] as string | undefined);
  const nseBasic = (company.context?.nse_basic as string | undefined) ?? (fullRow?.["nse_basic"] as string | undefined);
  const off = num(fullRow, "off_52w_high");
  // Consolidated / Standalone (the switch shows only where both are filed).
  const hasSa = !!(company.statements.quarterly_results_sa || company.statements.annual_pnl_sa);
  const sa = hasSa && basisView === "standalone";
  const quarterly = withEbitda((sa && company.statements.quarterly_results_sa) || company.statements.quarterly_results || (company.trend?.quarterly ? trendToStmt(company.trend.quarterly) : null));
  const pnl = withEbitda((sa && company.statements.annual_pnl_sa) || company.statements.annual_pnl || (company.trend?.annual ? trendToStmt(company.trend.annual) : null));
  const tableCaption = sa ? "Standalone figures in ₹ Crores" : figuresCaption;
  const basisSwitch = hasSa ? (
    <div className="flex justify-end">
      <div className="inline-flex gap-0.5 rounded-lg bg-[var(--card2)] p-0.5 text-xs" role="radiogroup" aria-label="Figures basis">
        {([["consolidated", "Consolidated"], ["standalone", "Standalone"]] as const).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={basisView === k} onClick={() => setBasisView(k)}
            className={`rounded-md px-2.5 py-1 font-medium ${basisView === k ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>{label}</button>
        ))}
      </div>
    </div>
  ) : null;
  const balance = company.statements.balance_sheet;
  const cashflow = company.statements.cash_flow;

  // Tabs show only when they have something in them; swipe mode keeps its
  // one-section-per-pane pager and the section menu.
  const hasHolding = Boolean(company.shareholding && company.shareholding.dates.length > 0);
  const tabHas: Record<TabKey, boolean> = {
    overview: true,
    results: Boolean(quarterly || pnl),
    accounts: Boolean(balance || cashflow || company.ratios),
    owners: hasHolding || hasInst,
    filings: true,
  };
  const activeTab: TabKey = tabHas[tab] ? tab : "overview";
  const tabbed = mode !== "swipe";
  const holders = company.shareholding?.holders_n?.filter((v): v is number => typeof v === "number").pop();
  const badge: Partial<Record<TabKey, string>> = {
    results: quarterly ? `${quarterly.periods.length}Q` : undefined,
    owners: holders ? holdersShort(holders) : undefined,
  };

  return (
    <div className="space-y-6">
      {/* Name, then the ticker and where it sits on one quiet line; the
          export is an icon beside the star, not a button above the price. */}
      <div className="flex items-start gap-2">
        <CompanyMark name={String(s.name ?? symbol)} symbol={symbol} logo={company.logo} />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-[var(--ink)] leading-tight line-clamp-2">{titleCase(String(s.name ?? "")) || symbol}</h1>
          <p className="text-[13px] text-[var(--ink3)] mt-0.5">
            <span className="font-semibold text-[var(--ink2)]">{symbol}</span>
            {company.exchange ? ` · ${company.exchange}` : ""}
            {company.fno && <span className="ml-1.5 align-middle text-[10px] font-bold rounded px-1.5 py-0.5 bg-[var(--accent-soft)] text-[var(--accent-ink)]" title="Trades in NSE's futures & options segment">F&amp;O</span>}
            <IndexChips list={company.indices} />
          </p>
          {/* Sector on a line of its own, one line high: it wrapped the header
              onto four lines when it shared the ticker's line. */}
          <p className="text-[12px] text-[var(--ink3)] mt-0.5 truncate">
            {/* NSE's own sector (and basic industry) where NSE's index files
                carry it; the source's sector and industry otherwise. */}
            {nseSector ? (
              <span title="NSE's classification">{nseSector}{nseBasic ? ` · ${nseBasic}` : ""}</span>
            ) : (
              <>
                {s.sector ? (
                  <Link href={`/sectors?s=${encodeURIComponent(String(s.sector))}`} className="hover:text-[var(--accent-ink)] hover:underline">{String(s.sector)}</Link>
                ) : "—"}
                {s.industry ? ` · ${String(s.industry)}` : ""}
              </>
            )}
            {typeof s.website === "string" && /^https?:\/\//.test(s.website) && (
              <>
                {" · "}
                <a href={s.website} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent-ink)] hover:underline">
                  {s.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                </a>
              </>
            )}
          </p>
        </div>
      </div>
      {alertsOpen && <PriceAlerts symbol={symbol} price={price} onClose={() => setAlertsOpen(false)} />}
      <AboutCompany about={company.about} />

      {/* No price: the icons still need a home. */}
      {price === null && (
        <div className="flex justify-end">
        <div className="flex items-center gap-1 shrink-0 self-center">
          <IconButton name="bell" label="Price alerts" onClick={() => setAlertsOpen(true)} />
          <IconButton name="download" label="Export to Excel" onClick={exportCompanyXlsx} />
          <RefetchButton symbol={symbol} />
          <WatchStar symbol={symbol} />
        </div>
        </div>
      )}
      {price !== null && (() => {
        // The day's move first, as a broker shows it; the distance from the
        // year's high is the second line.
        const chg = num(fullRow, "ret_1d");
        return (
          <div>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex flex-wrap items-baseline gap-x-2.5">
                <span className="text-3xl font-bold text-[var(--ink)] tabular-nums">₹ {fmtNum(price)}</span>
                {chg !== null && (
                  <span className={`text-[15px] font-semibold tabular-nums ${tone(chg)}`}>
                    {signedNum(dayMove(price, chg))} ({signedNum(chg)}%)
                  </span>
                )}
              </div>
            <div className="ml-auto flex items-center gap-1 shrink-0 self-center">
              <IconButton name="bell" label="Price alerts" onClick={() => setAlertsOpen(true)} />
              <IconButton name="download" label="Export to Excel" onClick={exportCompanyXlsx} />
              <RefetchButton symbol={symbol} />
              <WatchStar symbol={symbol} />
            </div>
            </div>
            <p className="flex flex-wrap items-baseline gap-x-2 mt-0.5">
              {off !== null && (
                <span className={`text-xs font-medium ${off < 0 ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}>
                  {off < 0 ? "" : "+"}{off.toFixed(1)}% from 52-week high ·
                </span>
              )}
              <PriceAsOf row={fullRow} snapshot={s} />
            </p>
          </div>
        );
      })()}

      {/* Built once: four tables share it, and they must not disagree. */}
      {tabbed ? (
        <>
          <div ref={tabAnchor} aria-hidden="true" />
          <div role="tablist" aria-label="Company sections"
            className="sticky top-0 sm:top-14 z-20 -mx-4 px-4 !mt-3 bg-[var(--card)] border-b border-[var(--line)] flex justify-between sm:justify-start gap-3 sm:gap-7 overflow-x-auto [scrollbar-width:none] text-[13px] sm:text-[14px]">
            {TABS.filter((t) => tabHas[t.key]).map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={activeTab === t.key} onClick={() => pickTab(t.key)}
                className={`shrink-0 whitespace-nowrap pt-2.5 pb-2 border-b-2 ${activeTab === t.key
                  ? "border-[var(--accent)] text-[var(--ink)] font-semibold"
                  : "border-transparent text-[var(--ink3)] hover:text-[var(--ink2)]"}`}>
                {t.label}
                {badge[t.key] && <span className="ml-0.5 text-[10px] font-normal text-[var(--ink3)]">{badge[t.key]}</span>}
              </button>
            ))}
          </div>
          {/* Sections outside the open tab are hidden, not unmounted, so each
              keeps its state (a table's switches, an open row) across tabs. */}
          <style>{`${TABS.filter((t) => t.key !== activeTab).flatMap((t) => t.sections).map((id) => `.rs-stack > #${id}`).join(",")}{display:none}`}</style>
        </>
      ) : (
      <nav ref={sectionNav} className="sticky top-0 sm:top-14 z-20 -mx-4 px-4 bg-[var(--card)] border-y border-[var(--line)] flex gap-1 overflow-x-auto text-sm font-medium py-2 sm:py-1.5 [scrollbar-width:none]">
        {/* Built from what this company ACTUALLY has. Five of these sections are
            conditionally rendered - quarters, P&L, balance sheet, cash flow and
            shareholding all depend on data that may not exist - while the nav
            listed all ten regardless. On any of the 2,372 BSE-only companies,
            which have no NSE filings at all, half these links pointed at
            nothing: you tapped "Quarters" and the page did not move. Same on an
            NSE company missing one statement type. A menu item that goes nowhere
            is worse than an absent one, because it reads as a broken page. */}
        {([
          ["summary", "Summary", true], ["chart", "Chart", true],
          ["performance", "Price history", true],
          ["analysis", "Analysis", true],
          ["checks", "Nine checks", Boolean(company.fscore)],
          ["valuation", "Own history", hasValuationHistory(company)],
          ["peers", "Peers", true],
          ["quarters", "Quarters", Boolean(quarterly)],
          ["profit-loss", "Profit & Loss", Boolean(pnl)],
          ["balance-sheet", "Balance sheet", Boolean(balance)],
          ["cash-flows", "Cash flow", Boolean(cashflow)],
          ["ratios", "Ratios", Boolean(company.ratios)],
          ["institutions", "Institutions", hasInst],
          ["shareholding", "Investors", Boolean(company.shareholding)],
          ["documents", "Documents", true],
          ["notes", "Notes", true],
        ] as [string, string, boolean][]).filter(([, , show]) => show)
          // The menu reads in the same sequence as the page. A reader who moves
          // Quarters above Chart and then finds the menu still listing Chart
          // first has been given two different answers to the same question.
          .sort((a, b) => {
            const r = (id: string) => {
              const i = sectionOrder.indexOf(id);
              return i < 0 ? Number.MAX_SAFE_INTEGER : i;
            };
            return r(a[0]) - r(b[0]);
          })
          .map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            onClick={(e) => { if (mode === "swipe" && goTo(id)) e.preventDefault(); }}
            className={`px-3 py-2.5 sm:py-1 rounded-lg whitespace-nowrap hover:bg-[var(--card2)] hover:text-[var(--accent-ink)] ${
              mode === "swipe" && panes > 0 && paneIds[page] === id
                ? "text-[var(--accent-ink)] bg-[var(--accent-soft)] font-semibold"
                : "text-[var(--ink2)]"}`}
          >
            {label}
          </a>
        ))}
      </nav>
      )}

      {/* Every section below is a child of this one div, which is the whole
          mechanism: in scroll mode it stacks them with a gap, in swipe mode CSS
          turns the same children into full-width scroll-snap panes. Nothing
          inside the sections knows which mode it is in, so a new section joins
          the pager by existing. */}
      {/* The reader's chosen sequence, applied as CSS `order` rather than by
          rearranging the elements. Reordering React's own children by hand is
          a fight it wins on the next render; `order` is a layout property it
          does not manage and cannot undo. Both modes are flex containers, so
          one rule sequences the scrolled page and the swipe panes alike. */}
      {sectionOrder.length > 0 && (
        <style>{sectionOrder.map((id, i) => `.rs-pager > #${id},.rs-stack > #${id}{order:${i}}`).join("")}</style>
      )}

      <div ref={pager} className={mode === "swipe" ? "rs-pager" : "rs-stack"}>

      {/* Notices sit INSIDE a section. A bare child of the pager has no id, so
          a saved section order gave it CSS order 0 and it jumped to the top,
          and in swipe mode it was a nameless pane of its own (17-Oct-2026). */}
      <div id="summary" className="scroll-mt-32 space-y-4">
        <RatioGrid snapshot={s} row={fullRow} cohort={cohort} next={nextResults} updates={company.updates} faceValue={company.face_value} />
        {Object.keys(company.statements).length === 0 && !company.trend?.annual && (
          <div className="bg-[var(--warn-soft)] border border-[var(--warn-line)] text-[var(--warn-ink)] rounded-xl p-4 text-sm">
            Financial statements haven&apos;t been fetched for this company yet — showing the snapshot only.
            Statements coverage grows as the pipeline runs.
          </div>
        )}
      </div>

      <div id="chart" className="scroll-mt-32 space-y-4">
        {company.prices && (company.prices.monthly?.length || company.prices.weekly?.length) ? (
          <>
            <StockChart prices={company.prices} peBand={company.pe_band} evBand={company.ev_band} pbBand={company.pb_band} psBand={company.ps_band} trendQ={company.trend?.quarterly} livePrice={price} quarters={company.quarters} actions={company.actions} symbol={symbol} peers={peers} coverage={company.coverage} exchange={company.exchange} />
            {company.exchange !== "BSE" && (
              <CoverageNote cov={company.coverage} bandFrom={company.pe_band?.series?.[0]?.[0] ?? null} />
            )}
          </>
        ) : null}
      {/* OUTSIDE the chart block, deliberately. This explanation used to sit
          inside `company.prices && ...`, so a BSE company with no price history
          would have shown a page of empty sections and no reason for any of
          them. Every published BSE company happens to have prices today, so
          this changes nothing on screen - it removes a coupling that would have
          hidden the explanation precisely when it was most needed. */}
      {company.exchange === "BSE" && (
        <p className="text-[13px] leading-relaxed text-[var(--ink3)] border border-[var(--line)] rounded-xl px-3 py-2 bg-[var(--card2)]">
          <span className="font-semibold text-[var(--ink2)]">Listed on BSE only{company.bse_code ? ` — scrip code ${company.bse_code}` : ""}.</span>
          <InfoTip title="Listed on BSE only" className="ml-1">
            <p>Price, market cap and the chart come from the exchange feed and are current.</p>
            <p>
              The as-filed quarterly table, the valuation bands and the shareholding pattern
              are built from NSE&rsquo;s filing archive, which does not carry companies that
              are not listed there — so those sections are absent rather than pending.
            </p>
          </InfoTip>
        </p>
      )}

      </div>

      {/* Three separate sections, not one. They were stacked inside a single
          "analysis" block, which in swipe mode made one pane three screens tall
          and in scroll mode gave the section menu one entry for three different
          questions. Each is now addressable by name. */}
      <div id="performance" className="scroll-mt-32">
        <PriceHistory row={fullRow} snapshot={s} />
      </div>

      <div id="analysis" className="scroll-mt-32 space-y-4">
        <ProsCons row={fullRow} />
        {/* 2,766 of 4,746 companies have no valuation chart and the page said
            nothing about any of them, so every one looked like a fault. None is:
            each is the app declining to publish a P/E that would not mean
            anything. An unexplained absence is indistinguishable from a bug. */}
        {company.no_pe_reason && (
          <p className="text-[13px] leading-relaxed text-[var(--ink3)] border border-[var(--line)] rounded-xl px-3 py-2 bg-[var(--card2)]">
            <span className="font-semibold text-[var(--ink2)]">No price-to-earnings chart for this company.</span>
            <InfoTip title="No price-to-earnings chart" className="ml-1">
              <p>{company.no_pe_reason}</p>
              <p>
                The chart is withheld rather than missing: a P/E built on these numbers would
                not mean anything, so none is published.
              </p>
            </InfoTip>
          </p>
        )}
      </div>

      {company.fscore && (
        <div id="checks" className="scroll-mt-32"><FScore f={company.fscore} /></div>
      )}

      {hasValuationHistory(company) && (
        <div id="valuation" className="scroll-mt-32">
          <ValuationHistory company={company} />
        </div>
      )}

      {peers.length > 0 && (
        <PeerTable symbol={symbol} self={{ ...(fullRow ?? {}), price }} peers={peers} industry={String(company.context?.peer_group ?? s.industry)} />
      )}
      {/* The caption says what the figures ACTUALLY are. It read "Consolidated"
          on every company, hardcoded, and 1,347 of the 3,198 with filed results
          file standalone - which excludes subsidiaries, so for a holding company
          the label named a different business from the one in the table. */}
      {quarterly && (
        <div id="quarters" className="scroll-mt-32 space-y-6">
          {basisSwitch}
          <StatementTable title="Quarterly results" stmt={quarterly} subtitle={tableCaption} boldRows={["Net Profit", "Net profit"]} next={nextResults} kind="quarterly" symbol={symbol}
            pdfs={sa ? undefined : quarterly.periods.map((p) => company.quarters?.find((q) => q.end === p)?.pdf ?? null)} />
          {company.segments && <SegmentsTable segs={company.segments} symbol={symbol} />}
          <SeasonsCard seasons={company.seasons} />
        </div>
      )}

      {pnl && (
        <div id="profit-loss" className="scroll-mt-32 space-y-6">
          {basisSwitch}
          <StatementTable title="Profit & loss" stmt={pnl} subtitle={tableCaption} boldRows={["Net Profit", "Net profit"]} kind="pnl" symbol={symbol} />
          <CompoundedGrowth trend={company.trend} prices={company.prices} />
        </div>
      )}

      {balance && <div id="balance-sheet" className="scroll-mt-32"><StatementTable title="Balance sheet" stmt={balance} subtitle={figuresCaption} boldRows={["Total Assets", "Total Liabilities"]} kind="balance" symbol={symbol} /></div>}
      {cashflow && <div id="cash-flows" className="scroll-mt-32"><StatementTable title="Cash flows" stmt={cashflow} subtitle={figuresCaption} boldRows={["Free Cash Flow"]} kind="cash" symbol={symbol} /></div>}

      {company.ratios && <RatiosTable r={company.ratios} symbol={symbol} />}

      <InstitutionsCard symbol={symbol} onLoad={setHasInst} />

      {company.shareholding && company.shareholding.dates.length > 0 && (
        <div id="shareholding" className="scroll-mt-32"><ShareholdingTable sh={company.shareholding} symbol={symbol} />
          <div className="bg-[var(--card)] rounded-b-xl border border-t-0 border-[var(--line)] -mt-px">
            <HoldingTrend s={company.shareholding} />
          </div>
          {(company.insider?.length ?? 0) > 0 && <div className="mt-4"><InsiderTrades list={company.insider!} /></div>}
        </div>
      )}

      <section id="documents" className="scroll-mt-32 bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-3">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Filings
          <InfoTip title="Filings" className="ml-1.5">
            <p>
              Use the cross-check link before trusting any number here — this app&rsquo;s data
              is unverified.
            </p>
          </InfoTip>
        </h2>
        {(company.documents?.announcements?.length ?? 0) > 0 && <Announcements list={company.documents!.announcements!} />}
        <FilingLists docs={company.documents} quarters={company.quarters} />
        <div className="flex gap-4 flex-wrap text-sm">
          <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] font-semibold hover:underline">
            All NSE filings &amp; announcements <ExternalGlyph />
          </a>
          <a href={`https://www.screener.in/company/${encodeURIComponent(symbol)}/`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] font-semibold hover:underline">
            Cross-check on Screener.in <ExternalGlyph />
          </a>
        </div>
      </section>

      {/* Named, because in swipe mode an unnamed pane is only reachable by
          swiping past every other one. */}
      <section id="notes" className="scroll-mt-32 bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-2">
        <h2 className="text-sm font-bold text-[var(--ink)]">Your notes</h2>
        <textarea
          value={note}
          onChange={(e) => { setNote(e.target.value); saveNote(symbol, e.target.value); }}
          rows={4}
          placeholder="Private notes in your own words — stored only on this device, never uploaded."
          className="w-full text-sm border border-[var(--line2)] rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </section>

      </div>

      <footer className="text-xs text-[var(--ink3)] leading-relaxed pb-8">
        Data as of {company.generated_at}
        <InfoTip title="Where these numbers come from" className="ml-1">
          <p>Yahoo Finance via yfinance, as of {company.generated_at}.</p>
          <p>
            <strong>Every number is unverified until checked against a company filing.</strong>{" "}
            This tool screens; it never recommends.
          </p>
        </InfoTip>
      </footer>
    </div>
  );
}

/** The company's own icon (fetch_logos.py), else its initials on a colour
 *  taken from the ticker - every company gets the same tile every time. */
function CompanyMark({ name, symbol, logo }: { name: string; symbol: string; logo?: string | null }) {
  const [broken, setBroken] = useState(false);
  const words = name.replace(/\b(limited|ltd|india|industries|corporation|company|the)\b\.?/gi, " ").trim().split(/\s+/).filter(Boolean);
  const initials = ((words[0]?.[0] ?? symbol[0] ?? "") + (words[1]?.[0] ?? symbol[1] ?? "")).toUpperCase();
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) % 360;
  if (logo && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`${BASE}/${logo}`} alt="" width={44} height={44} onError={() => setBroken(true)}
        className="w-11 h-11 rounded-xl bg-white object-contain p-1 border border-[var(--line)] shrink-0" />
    );
  }
  return (
    <span aria-hidden="true" className="w-11 h-11 rounded-xl shrink-0 inline-flex items-center justify-center text-[15px] font-bold text-white"
      style={{ background: `hsl(${h} 45% 42%)` }}>{initials}</span>
  );
}

/** Price alerts for this company (alerts/price_alerts.py): a push when the
 *  price crosses a level, checked every twenty minutes in market hours on a
 *  quote about fifteen minutes behind NSE. Kept as rs_price_alerts, synced -
 *  the cloud check reads them from the signed-in account. */
type PriceAlert = { s: string; op: ">" | "<"; p: number };
function loadAlerts(): PriceAlert[] {
  try {
    const v = JSON.parse(localStorage.getItem("rs_price_alerts") ?? "[]");
    return Array.isArray(v) ? v.filter((a) => a && typeof a.s === "string" && (a.op === ">" || a.op === "<") && typeof a.p === "number") : [];
  } catch { return []; }
}
function PriceAlerts({ symbol, price, onClose }: { symbol: string; price: number | null; onClose: () => void }) {
  const [all, setAll] = useState<PriceAlert[]>([]);
  const [op, setOp] = useState<">" | "<">(">");
  const [level, setLevel] = useState("");
  useEffect(() => { setAll(loadAlerts()); }, []);
  const save = (next: PriceAlert[]) => {
    setAll(next);
    try { localStorage.setItem("rs_price_alerts", JSON.stringify(next)); } catch { /* not remembered */ }
  };
  const mine = all.filter((a) => a.s === symbol);
  const n = Number(level.replace(/,/g, ""));
  const ok = Number.isFinite(n) && n > 0;
  return (
    <InfoDialog title="Price alerts" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-[var(--ink3)] text-xs">A push to your phone when {symbol} crosses a price, once a day per alert. Checked every 20 minutes in market hours on a quote about 15 minutes behind NSE.{price ? ` Now ₹${fmtNum(price)}.` : ""}</p>
        <div className="flex items-center gap-2">
          <div className="inline-flex gap-0.5 rounded-lg bg-[var(--card2)] p-0.5 text-xs" role="radiogroup" aria-label="Direction">
            {([[">", "Above"], ["<", "Below"]] as const).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={op === k} onClick={() => setOp(k)}
                className={`rounded-md px-2.5 py-1.5 font-medium ${op === k ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>{label}</button>
            ))}
          </div>
          <input inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="₹ price"
            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--card2)] px-3 py-2 text-[var(--ink)]" />
          <button type="button" disabled={!ok} onClick={() => { save([...all, { s: symbol, op, p: n }]); setLevel(""); }}
            className="rounded-lg px-3 py-2 font-semibold bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] disabled:opacity-40">Add</button>
        </div>
        {mine.length > 0 && (
          <ul className="divide-y divide-[var(--line)]">
            {mine.map((a, i) => (
              <li key={i} className="py-1.5 flex items-center justify-between">
                <span>{a.op === ">" ? "Above" : "Below"} ₹{fmtNum(a.p)}</span>
                <button type="button" onClick={() => save(all.filter((x) => x !== a))} className="text-xs text-[var(--ink3)]">Remove</button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-[var(--ink3)]">Pushes reach your phone once you are signed in (the cloud check reads your account) and the ntfy app is subscribed - Settings › Phone alerts.</p>
      </div>
    </InfoDialog>
  );
}

/** "What it does" under the company's name, opened on tap (owner, 15-Oct-2026).
 *  From the company's Wikipedia article, shown with its title, link and
 *  licence as CC BY-SA asks; only an article whose infobox carries this
 *  company's ticker is used. No article, no control - nothing dead to tap. */
function AboutCompany({ about }: { about?: Company["about"] }) {
  const [open, setOpen] = useState(false);
  if (!about || (!about.text && !about.short)) return null;
  return (
    <div className="-mt-4">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="inline-flex items-center gap-1 text-[13px] text-[var(--accent-ink)]">
        {about.short ? about.short.charAt(0).toUpperCase() + about.short.slice(1) : "What it does"}
        <ChevronGlyph size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 text-[13px] leading-relaxed text-[var(--ink2)] space-y-2">
          {(about.text ?? "").split("\n\n").filter(Boolean).map((para, i) => <p key={i}>{para}</p>)}
          <p className="text-[11px] text-[var(--ink3)]">
            From Wikipedia&apos;s article{" "}
            <a href={about.url} target="_blank" rel="noopener noreferrer" className="underline">{about.title}</a>
            , under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer" className="underline">CC BY-SA 4.0</a>.
            Written by its editors, not checked by Rscreener.
          </p>
        </div>
      )}
    </div>
  );
}

const REPO = "https://github.com/RishilBhutada/rscreener";

/** Data missing or stale on this page? Re-fetch all of it (owner, 15-Oct-2026).
 *
 *  The fetching runs on GitHub, and starting a run needs a token - which must
 *  never ship inside the app, where anyone could lift it. So this opens a
 *  pre-filled issue "Refetch SYMBOL"; submitting it starts refetch.yml, which
 *  acts only on issues from the owner's account, re-reads everything for the
 *  company, republishes its page, replies on the issue and closes it. */
function RefetchButton({ symbol }: { symbol: string }) {
  const [open, setOpen] = useState(false);
  const body = `Requested from the Rscreener app: ${symbol}'s data looks missing or out of date.\n\n`
    + `Submitting this re-fetches everything for ${symbol} and republishes its page. `
    + "The run replies here and closes this when it is done.";
  const url = `${REPO}/issues/new?title=${encodeURIComponent(`Refetch ${symbol}`)}&body=${encodeURIComponent(body)}`;
  return (
    <>
      <IconButton name="refresh" label="Refetch this company's data" onClick={() => setOpen(true)} />
      {open && (
        <InfoDialog title={`Refetch ${symbol}'s data`} onClose={() => setOpen(false)}>
          <p>If something on this page is missing or out of date, this fetches everything for {symbol} again - prices, quarterly results and statements, shareholding, filing dates, corporate actions, annual reports and announcements - and republishes its page.</p>
          <p>It runs on GitHub. The button opens your request there, already filled in: tap <b>Submit new issue</b>. Only requests from your GitHub account are acted on. It takes about 10 to 20 minutes - longer while the nightly refresh is running - and your phone is told when it is done.</p>
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="rs-press mt-1 inline-flex items-center justify-center w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
            Open the request on GitHub
          </a>
          <p className="text-[11px] text-[var(--ink3)]">Sources that refuse programs stay as they are: a company listed only on BSE has fewer sources to fetch from.</p>
        </InfoDialog>
      )}
    </>
  );
}

export default function CompanyPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Suspense fallback={<CompanySkeleton />}>
          <CompanyView />
        </Suspense>
      </main>
    </div>
  );
}
