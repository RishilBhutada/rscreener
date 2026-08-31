"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import { titleCase } from "@/lib/names";
import StockChart, { CorpAction, Quarter } from "@/components/StockChart";
import { Row } from "@/lib/query";
import { loadNote, pushRecent, saveNote } from "@/lib/store";
import WatchStar from "@/components/WatchStar";
import { loadSectionMode, SectionMode } from "@/components/Settings";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Stmt = { periods: string[]; items: { label: string; values: (number | null)[] }[]; declared?: (string | null)[] };
type AnnualReport = { from: string; to: string; url: string };
type AnnDoc = { date: string; title: string; url: string };
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
type ScreenData = { rows: Row[] };


type Company = {
  generated_at: string;
  snapshot: Row;
  statements: Record<string, Stmt>;
  documents?: { annual_reports?: AnnualReport[]; concalls?: AnnDoc[]; ratings?: AnnDoc[] };
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
  fscore?: FScoreData | null;
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
    <div className="mt-3 text-xs text-[var(--ink2)] bg-[var(--card2)] border border-[var(--line)] rounded-xl px-3 py-2">
      <span className="font-semibold text-[var(--ink)]">Why the history starts where it does. </span>
      Filings on record for this company begin <strong>{monthYear(cov.from)}</strong> ({cov.quarters} quarters).
      {nGaps > 0 && (
        <>
          {" "}
          {nGaps === 1 ? "One quarter is" : `${nGaps} quarters are`} missing from those records
          {gaps.length > 0 && <> — {gaps.slice(0, 6).join(", ")}{nGaps > gaps.slice(0, 6).length ? " and others" : ""}</>}.
          {" "}A trailing-twelve-month figure needs four consecutive quarters, so each gap moves the ratio lines forward by a year.
        </>
      )}
      {bandFrom && <> The valuation lines therefore begin <strong>{monthYear(bandFrom)}</strong>.</>}
      {" "}Nothing here is estimated: a quarter that was never filed is left out rather than filled in.
    </div>
  );
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

function RatiosTable({ r }: { r: WcRatios }) {
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
    <section id="ratios" className="scroll-mt-32 bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
      <div className="px-4 pt-3.5 pb-2">
        <h2 className="text-base font-semibold text-[var(--ink)]">Ratios</h2>
        <p className="text-xs text-[var(--ink3)] mt-0.5">
          How the business is financed, year by year. Computed from the filed balance sheet
          and income statement — nothing here is estimated.
        </p>
      </div>
      <div className="overflow-x-auto" ref={(el) => { if (el) el.scrollLeft = el.scrollWidth; }}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
              <th className="px-3 py-2 text-left font-medium sticky left-0 bg-[var(--card)]"> </th>
              {r.periods.map((p) => (
                <th key={p} className="px-3 py-2 text-right font-medium whitespace-nowrap">{periodLabel(p)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, key, help]) => (
              <tr key={label} className="border-b border-[var(--line)] last:border-b-0">
                <th title={help} className="px-3 py-2 text-left font-medium text-[var(--ink2)] whitespace-nowrap sticky left-0 bg-[var(--card)]">
                  {label}
                </th>
                {(r[key] as (number | null)[]).map((v, i) => (
                  <td key={i} className="px-3 py-2 text-right tabular-nums text-[var(--ink)]">
                    {v === null || v === undefined ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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

function StatementTable({ title, stmt, subtitle, boldRows }: { title: string; stmt: Stmt; subtitle?: string; boldRows?: string[] }) {
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
      <div className="px-4 pt-3.5 pb-2">
        <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
        <p className="text-xs text-[var(--ink3)] mt-0.5">{subtitle ?? "Figures in ₹ Crores"}</p>
      </div>
      {/* Opens on the NEWEST period. These tables carry up to twenty years of
          columns oldest-first, so the page landed on 2005 and the reader had to
          drag sideways every time to reach the year he was actually asking
          about. The pinned label column stays put either way. */}
      <div className="overflow-x-auto" ref={(el) => { if (el) el.scrollLeft = el.scrollWidth; }}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
              <th className="px-3 py-2 text-left font-medium sticky left-0 bg-[var(--card)]"> </th>
              {stmt.periods.map((p, i) => {
                const dec = declaredLabel(stmt.declared?.[i]);
                return (
                  <th key={p} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                    {periodLabel(p)}
                    {dec && <span className="block font-normal text-[11px] text-[var(--ink3)]">({dec})</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {stmt.items.map((it) => {
              const bold = boldRows?.includes(it.label);
              return (
                <tr key={it.label} className="border-b border-[var(--line)] hover:bg-[var(--card2)]">
                  <td className={`px-3 py-2 sm:py-1.5 truncate max-w-[42vw] sm:max-w-none sm:whitespace-nowrap sticky left-0 bg-[var(--card)] ${bold ? "font-semibold text-[var(--ink)]" : "text-[var(--ink2)]"}`}>{it.label}</td>
                  {it.values.map((v, i) => (
                    <td key={i} className={`px-3 py-2 sm:py-1.5 text-right whitespace-nowrap tabular-nums ${bold ? "font-semibold" : ""} ${typeof v === "number" && v < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]"}`}>
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
      close of {label}{old ? " · stale" : ""}
    </span>
  );
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

function InfoDot({ label, onOpen }: { label: string; onOpen: (l: string) => void }) {
  if (!METRIC_INFO[label]) return null;
  return (
    <button
      onClick={() => onOpen(label)}
      aria-label={`How ${label} is calculated`}
      title={`How ${label} is calculated`}
      className="ml-1 align-middle text-[var(--ink3)] hover:text-[var(--accent-ink)]"
    >
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 inline-block" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
        <circle cx="12" cy="12" r="2.6" />
      </svg>
    </button>
  );
}

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
    ["1 month", g("ret_1m")], ["3 months", g("ret_3m")], ["6 months", g("ret_6m")],
    ["1 year", g("ret_1y")], ["3 years", g("ret_3y")], ["5 years", g("ret_5y")],
  ];
  const shown = returns.filter(([, v]) => v !== null && v !== undefined);
  const at = price !== null && hi !== null && lo !== null && hi > lo
    ? Math.min(100, Math.max(0, ((price - lo) / (hi - lo)) * 100))
    : null;
  const beta = g("beta");

  if (shown.length === 0 && at === null) return null;

  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <h2 className="text-base font-semibold text-[var(--ink)]">Price history</h2>
      <p className="text-xs text-[var(--ink3)] mt-0.5">
        Change in the share price alone. Dividends are not added back, so a high-yield
        company has done better than these figures say.
      </p>

      {at !== null && (
        <div className="mt-3">
          <div className="relative h-2 rounded-full bg-[var(--card2)] border border-[var(--line)]">
            <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-[var(--accent)]"
                 style={{ left: `calc(${at}% - 5px)` }} />
          </div>
          <div className="flex justify-between text-[11px] text-[var(--ink3)] mt-1 tabular-nums">
            <span>52w low ₹{fmtNum(lo, 0)}</span>
            <span className="text-[var(--ink2)]">₹{fmtNum(price)} — {at.toFixed(0)}% up the range</span>
            <span>52w high ₹{fmtNum(hi, 0)}</span>
          </div>
        </div>
      )}

      {shown.length > 0 && (
        <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-2">
          {shown.map(([label, v]) => (
            <div key={label}>
              <p className="text-[11px] text-[var(--ink3)]">{label}</p>
              <p className="text-sm font-semibold tabular-nums"
                 style={{ color: (v as number) >= 0 ? "var(--pos)" : "var(--neg)" }}>
                {(v as number) >= 0 ? "+" : ""}{fmtNum(v)}%
              </p>
            </div>
          ))}
        </div>
      )}

      {beta !== null && beta !== undefined && (
        <p className="text-[11px] text-[var(--ink3)] mt-3">
          Beta {fmtNum(beta)} — over the last year this share moved about{" "}
          {Math.abs(beta) < 0.05 ? "independently of" : `${fmtNum(Math.abs(beta))}× as far as`} the market
          on an average day. A number below 1 is not safety; it is only a smaller swing.
        </p>
      )}
    </section>
  );
}

/** Documents grouped by the financial year they belong to.
 *
 *  They were three flat lists by type: annual-report chips, the newest eight
 *  concalls, the newest five rating updates. Two problems with that. The caps
 *  threw away everything older without saying so - a company with forty filed
 *  documents showed thirteen. And the shape answered the wrong question: a
 *  reader looking at FY2024 wants that year's annual report next to that year's
 *  four concalls, not to cross-reference three lists sorted three ways.
 *
 *  Tickertape has this right, and it is the one structural idea worth taking
 *  from their documents section.
 *
 *  A financial year here is named for the year it ENDS, the Indian convention:
 *  FY2026 runs April 2025 to March 2026, so a document dated July 2026 belongs
 *  to FY2027.
 */
function fyOf(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  return mo >= 4 ? y + 1 : y;
}

function DocumentsByYear({ docs }: { docs: NonNullable<Company["documents"]> }) {
  const [openYears, setOpenYears] = useState<Set<number> | null>(null);

  const years = useMemo(() => {
    const bucket = new Map<number, { reports: AnnualReport[]; concalls: AnnDoc[]; ratings: AnnDoc[] }>();
    const get = (y: number) => {
      if (!bucket.has(y)) bucket.set(y, { reports: [], concalls: [], ratings: [] });
      return bucket.get(y)!;
    };
    // An annual report is FOR a financial year, so it is filed by the year it
    // covers rather than by the date the PDF appeared.
    for (const r of docs.annual_reports ?? []) {
      const y = Number(r.to);
      if (Number.isFinite(y)) get(y).reports.push(r);
    }
    for (const d of docs.concalls ?? []) {
      const y = fyOf(d.date);
      if (y !== null) get(y).concalls.push(d);
    }
    for (const d of docs.ratings ?? []) {
      const y = fyOf(d.date);
      if (y !== null) get(y).ratings.push(d);
    }
    return [...bucket.entries()].sort((a, b) => b[0] - a[0]);
  }, [docs]);

  if (years.length === 0) return null;

  // The two newest open, the rest collapsed but counted - so nothing is hidden
  // without the reader being told how much.
  const isOpen = (y: number) =>
    openYears ? openYears.has(y) : years.findIndex(([yy]) => yy === y) < 2;
  const toggle = (y: number) => {
    const next = new Set(openYears ?? years.slice(0, 2).map(([yy]) => yy));
    if (next.has(y)) next.delete(y); else next.add(y);
    setOpenYears(next);
  };

  const Doc = ({ d }: { d: AnnDoc }) => (
    <li className="text-sm">
      <a href={d.url} target="_blank" rel="noopener noreferrer"
         className="text-[var(--accent-ink)] hover:underline line-clamp-2 sm:truncate block">
        <span className="text-[var(--ink3)] font-mono text-xs mr-2">{d.date}</span>
        {d.title || "document"}
      </a>
    </li>
  );

  return (
    <div className="space-y-1">
      {years.map(([y, g]) => {
        const n = g.reports.length + g.concalls.length + g.ratings.length;
        const open = isOpen(y);
        return (
          <div key={y} className="border-t border-[var(--line)] pt-2">
            <button
              onClick={() => toggle(y)}
              aria-expanded={open}
              className="w-full flex items-baseline justify-between gap-3 min-h-[44px] sm:min-h-0 sm:py-1 text-left"
            >
              <span className="text-sm font-semibold text-[var(--ink)]">
                FY{y}
                <span className="text-[var(--ink3)] font-normal ml-2 text-xs">
                  Apr {y - 1} – Mar {y}
                </span>
              </span>
              <span className="text-xs text-[var(--ink3)] shrink-0">
                {n} {n === 1 ? "document" : "documents"} {open ? "▾" : "▸"}
              </span>
            </button>
            {open && (
              <div className="pb-2 space-y-2">
                {g.reports.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {g.reports.map((r) => (
                      <a key={r.url} href={r.url} target="_blank" rel="noopener noreferrer"
                         className="text-xs font-semibold bg-[var(--card2)] hover:bg-[var(--accent-soft)] border border-[var(--line)] rounded-full px-3 py-1.5">
                        Annual report {r.from}–{String(r.to).slice(-2)} ↗
                      </a>
                    ))}
                  </div>
                )}
                {g.concalls.length > 0 && (
                  <ul className="space-y-1">{g.concalls.map((d) => <Doc key={d.url} d={d} />)}</ul>
                )}
                {g.ratings.length > 0 && (
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[var(--ink3)] mb-0.5">Credit rating</p>
                    <ul className="space-y-1">{g.ratings.map((d) => <Doc key={d.url} d={d} />)}</ul>
                  </div>
                )}
              </div>
            )}
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
      <p className="text-xs font-semibold text-[var(--ink2)] pt-2.5">Promoter stake</p>
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
      <p className="text-[11px] text-[var(--ink3)] pt-0.5">
        A movement is stated, never interpreted. Promoters sell and buy for reasons
        no filing discloses — pledges, estate planning, an unrelated business.
      </p>
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
  const total = f.measured || 1;
  // Green above two thirds, red below a third - the same reading Piotroski
  // gave the score, stated on screen rather than left to a colour.
  const tone = f.score / total >= 0.67 ? "var(--pos)"
    : f.score / total <= 0.33 ? "var(--neg)" : "var(--warn)";
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">Nine tests on the accounts</h2>
          <p className="text-xs text-[var(--ink3)] mt-0.5 max-w-xl">
            The Piotroski F-score, comparing {f.years[1].slice(0, 4)} against{" "}
            {f.years[0].slice(0, 4)}. Every test is arithmetic on two filed years, and
            all nine are shown — a score whose workings are hidden cannot be argued with.
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="flex items-baseline gap-0.5">
            <span className="text-3xl font-bold tabular-nums" style={{ color: tone }}>{f.score}</span>
            <span className="text-sm text-[var(--ink3)]">/{f.measured}</span>
          </div>
          {f.measured < f.of && (
            <p className="text-[11px] text-[var(--ink3)]">
              {f.of - f.measured} of {f.of} not measurable
            </p>
          )}
        </div>
      </div>

      <ul className="mt-3 divide-y divide-[var(--line)]">
        {f.checks.map((c) => (
          <li key={c.test} className="py-2 flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{
                background: c.pass === null ? "var(--card2)" : c.pass ? "var(--pos)" : "var(--neg)",
                color: c.pass === null ? "var(--ink3)" : "var(--card)",
                border: c.pass === null ? "1px solid var(--line2)" : "none",
              }}
            >
              {c.pass === null ? "?" : c.pass ? "\u2713" : "\u2715"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-sm text-[var(--ink)]">{c.name}</span>
              <span className="sr-only">
                {c.pass === null ? " - not measurable" : c.pass ? " - passed" : " - failed"}
              </span>
              <span className="block text-[11px] text-[var(--ink3)]">
                {c.test}
                {c.detail ? ` — ${c.detail}` : " — not reported in both years, so not scored"}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-[var(--ink3)] mt-3">
        A test whose inputs are missing counts as neither a pass nor a fail. Scoring an
        absent figure as zero would turn missing data into bad news, which is not what it is.
      </p>
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
      <h2 className="text-base font-semibold text-[var(--ink)]">Against its own history</h2>
      <p className="text-xs text-[var(--ink3)] mt-0.5 mb-3">
        Where today&rsquo;s valuation sits in this company&rsquo;s own record. Cheap and
        expensive mean nothing across industries; against the same company&rsquo;s past
        they mean something. Not a signal — a business can be worth more than it used to be.
      </p>
      <div className="space-y-3.5">
        {rows.map((r) => {
          // Position on the bar, clamped: the newest point IS the max or the
          // min often enough that an unclamped marker sits half off the track.
          const span = r.hi - r.lo;
          const at = span > 0 ? Math.min(100, Math.max(0, ((r.value - r.lo) / span) * 100)) : 50;
          return (
            <div key={r.label}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-[var(--ink2)]">{r.label}</span>
                <span className="font-semibold text-[var(--ink)] tabular-nums">{fmtNum(r.value)}</span>
              </div>
              <div className="relative h-1.5 rounded-full bg-[var(--card2)] mt-1.5 border border-[var(--line)]">
                <div className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[var(--accent)]"
                     style={{ left: `calc(${at}% - 4px)` }} />
              </div>
              <div className="flex justify-between text-[10px] text-[var(--ink3)] mt-1 tabular-nums">
                <span>low {fmtNum(r.lo)}</span>
                {/* The window is stated, not just its length. These four
                    series do NOT reach equally far back: P/E and MCap/Sales
                    come from filed quarterly results to 2006, while EV/EBITDA
                    needs debt and cash, which the balance sheets only give for
                    about four years. "2% of 42 months" invites a conclusion
                    that "42 months since 2023-03" does not. */}
                <span>
                  {r.short} was lower than this in <strong className="text-[var(--ink2)]">{r.pct}%</strong>{" "}
                  of {r.n} months since {r.from} · median {fmtNum(r.median)}
                </span>
                <span>high {fmtNum(r.hi)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-[var(--ink3)] mt-3">
        Each series ends {rows[0].date}, the last month with a filed trailing figure — not today&rsquo;s price.
      </p>
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

function RatioGrid({ snapshot, row, cohort }: { snapshot: Row; row: Row | null; cohort: Cohort | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const g = (k: string) => num(row, k) ?? num(snapshot, k);
  const method = String((row?.["vol_method"] ?? snapshot["vol_method"]) ?? "");
  const vol = (k: string) => {
    const v = g(k);
    return v === null ? "—" : `${v.toFixed(1)} %`;
  };
  // Volatility now sits in the list at the same weight as everything else. It was
  // a large separate card, which gave it an importance out of proportion to market
  // cap, price or P/E.
  // A missing value is shown as a bare dash, not "₹ — Cr". Wrapping a currency
  // symbol and a unit around nothing dresses an absence up as a figure, which is
  // the one thing this app is not supposed to do.
  const money = (v: unknown, dec = 2, suffix = "") =>
    v === null || v === undefined ? "—" : `₹ ${fmtNum(v as number, dec)}${suffix}`;
  const pct = (v: unknown) =>
    v === null || v === undefined ? "—" : `${fmtNum(v as number)} %`;
  const plain = (v: unknown) =>
    v === null || v === undefined ? "—" : fmtNum(v as number);

  // Grouped by the question each one answers. Fourteen numbers in one flat grid
  // is a list to read end to end; four short groups is a page to scan.
  /** Third entry is the data.json field this row can be compared on, or "" for
   *  the ones where an industry median would be nonsense: a book value per
   *  share or a share price is a function of how many shares exist, so its
   *  median across an industry compares nothing. */
  const groups: [string, [string, string, string][]][] = [
    ["Size and price", [
      ["Market Cap", money(g("mcap"), 0, " Cr"), "mcap"],
      ["Current Price", money(g("price")), ""],
      ["High / Low", g("wk52_high") == null && g("wk52_low") == null ? "—"
        : `₹ ${fmtNum(g("wk52_high"), 0)} / ${fmtNum(g("wk52_low"), 0)}`, ""],
    ]],
    ["What it costs", [
      ["Stock P/E", plain(g("pe")), "pe"],
      ["Book Value", money(g("book_value")), ""],
      ["Dividend Yield", pct(g("div_yield")), "div_yield"],
    ]],
    ["What it earns", [
      ["ROCE", pct(g("roce")), "roce"],
      ["ROE", pct(g("roe")), "roe"],
      ["Sales growth 5Y", pct(g("sales_cagr_5y")), "sales_cagr_5y"],
      ["Profit growth 5Y", pct(g("profit_cagr_5y")), "profit_cagr_5y"],
    ]],
    ["Risk and ownership", [
      // Absolute debt and cash, not only the ratio. Finology leads with these
      // and it is right to: "Debt / Equity 0.37" tells you the shape of the
      // funding, "Rs 2,31,381 crore of debt against Rs 1,08,179 crore of cash"
      // tells you the size of it, and the second is the one a reader can hold
      // against the profit. Both were already in the export and neither was on
      // the page.
      ["Enterprise value", g("mcap") === null ? "—"
        : money((g("mcap") ?? 0) + ((g("total_debt") ?? 0) - (g("total_cash") ?? 0)) / 1e7, 0, " Cr"), ""],
      ["Total debt", g("total_debt") === null ? "—" : money((g("total_debt") ?? 0) / 1e7, 0, " Cr"), ""],
      ["Cash", g("total_cash") === null ? "—" : money((g("total_cash") ?? 0) / 1e7, 0, " Cr"), ""],
      ["Debt / Equity", plain(g("de")), "de"],
      ["Promoter holding", pct(g("promoter_holding")), "promoter_holding"],
      ["Volatility 1Y", vol("volatility_1y"), "volatility_1y"],
      ["Volatility 30D", vol("volatility_30d"), "volatility_30d"],
    ]],
  ];

  /** The grey line under a figure: what the rest of the industry does. */
  const context = (field: string) => {
    if (!field || !cohort) return null;
    if (field === "mcap") {
      if (!cohort.rank) return null;
      // The industry name is already printed under the company name at the top
      // of the page; repeating it here wrapped this line onto three.
      return `${cohort.rank.toLocaleString("en-IN")} of ${cohort.rankOf.toLocaleString("en-IN")} by size${
        cohort.indRank ? ` · ${cohort.indRank} of ${cohort.indRankOf} in its industry` : ""}`;
    }
    const med = industryMedian(cohort, field);
    const mine = g(field);
    if (!med) return null;
    const shown = Math.abs(med.value) >= 100 ? fmtNum(med.value, 0) : fmtNum(med.value);
    const side = mine === null ? "" : mine > med.value ? " · above" : mine < med.value ? " · below" : " · at";
    // Say how many companies it was taken over when that number is small.
    // NSDL sits in an industry of six: "industry median 40.27" reads like a
    // fact about an industry, when it is the middle of five other companies.
    const n = med.n < 15 ? ` (of ${med.n})` : "";
    return `industry median ${shown}${n}${side}`;
  };
  const info = open ? METRIC_INFO[open] : null;
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
        {groups.map(([heading, cells]) => (
          <div key={heading}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink3)] mb-1.5">
              {heading}
            </h3>
            {cells.map(([label, value, field]) => {
              const ctx = context(field);
              return (
                <div key={label} className="border-b border-[var(--line)] py-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-[var(--ink3)]">
                      {label}
                      <InfoDot label={label} onOpen={setOpen} />
                    </span>
                    <span className="text-sm font-semibold text-[var(--ink)] tabular-nums">{value}</span>
                  </div>
                  {/* Grey and unemphasised, and never green or red. Tickertape
                      and Trendlyne both colour this line as good or bad news;
                      a P/E above the industry median is neither, and this app
                      does not hand out opinions it cannot defend. */}
                  {ctx && <p className="text-[10px] text-[var(--ink3)] text-right tabular-nums">{ctx}</p>}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {info && (
        <div className="mt-4 rounded-xl border border-[var(--line2)] bg-[var(--card2)] p-4 relative">
          <button
            onClick={() => setOpen(null)}
            aria-label="Close"
            className="absolute top-3 right-3 text-[var(--ink3)] hover:text-[var(--ink)] text-lg leading-none"
          >
            &times;
          </button>
          <h3 className="text-sm font-semibold text-[var(--ink)] pr-6">{open}</h3>
          <dl className="mt-2 space-y-2 text-xs leading-relaxed">
            <div>
              <dt className="text-[var(--ink3)] uppercase tracking-wide text-[11px]">How it is worked out</dt>
              <dd className="text-[var(--ink2)] mt-0.5">{info.how}</dd>
            </div>
            <div>
              <dt className="text-[var(--ink3)] uppercase tracking-wide text-[11px]">What it tells you</dt>
              <dd className="text-[var(--ink2)] mt-0.5">{info.means}</dd>
            </div>
            {info.watch && (
              <div>
                <dt className="text-[var(--ink3)] uppercase tracking-wide text-[11px]">Where it misleads</dt>
                <dd className="text-[var(--ink2)] mt-0.5">{info.watch}</dd>
              </div>
            )}
            {open?.startsWith("Volatility") && method && (
              <p className="text-[var(--ink3)]">
                Method used for this company: {method === "yang-zhang" ? "Yang-Zhang (OHLC)" : "close-to-close"}.
              </p>
            )}
          </dl>
        </div>
      )}
    </section>
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
      setPaneIds(Array.from(el.children).map((c) => c.id));
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
  }, [mode, company]);

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
    const i = Array.from(el.children).findIndex((c) => c === target || c.contains(target));
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
    (el.children[i] as HTMLElement).scrollTop = 0;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.top - 116) > 24) window.scrollBy({ top: r.top - 116, behavior: "smooth" });
    return true;
  }, []);

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

  useEffect(() => {
    if (!symbol) return;
    fetch(`${BASE}/companies/${symbol}.json`)
      .then((r) => { if (!r.ok) throw new Error(`no data for ${symbol}`); return r.json(); })
      .then(setCompany)
      .catch((e) => setError(String(e.message ?? e)));
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">{titleCase(String(s.name ?? "")) || symbol} <span className="text-[var(--accent-ink)]">({symbol})</span></h1>
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
          <WatchStar symbol={symbol} />
        </div>
      </div>

      {price !== null && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-3xl font-bold text-[var(--ink)] tabular-nums">₹ {fmtNum(price)}</span>
          {off !== null && (
            <span className={`text-sm font-semibold ${off < 0 ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}>
              {off < 0 ? "" : "+"}{off.toFixed(1)}% from 52w high
            </span>
          )}
          <PriceAsOf row={fullRow} snapshot={s} />
        </div>
      )}

      <nav className="sticky top-0 sm:top-14 z-20 -mx-4 px-4 bg-[var(--card)] border-y border-[var(--line)] flex gap-1 overflow-x-auto text-sm font-medium py-2 sm:py-1.5 [scrollbar-width:none]">
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
          ["valuation", "Own history", Boolean(company.pe_band || company.pb_band || company.ps_band)],
          ["peers", "Peers", true],
          ["quarters", "Quarters", Boolean(quarterly)],
          ["profit-loss", "Profit & Loss", Boolean(pnl)],
          ["balance-sheet", "Balance Sheet", Boolean(balance)],
          ["cash-flows", "Cash Flow", Boolean(cashflow)],
          ["ratios", "Ratios", Boolean(company.ratios)],
          ["shareholding", "Investors", Boolean(company.shareholding)],
          ["documents", "Documents", true],
          ["notes", "Notes", true],
        ] as [string, string, boolean][]).filter(([, , show]) => show).map(([id, label]) => (
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

      {mode === "swipe" && (
        <div className="flex items-center justify-between gap-2 text-xs text-[var(--ink3)]">
          <button onClick={() => step(-1)} aria-label="Previous section"
            className="min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] font-semibold">←</button>
          <span>Swipe sideways · section {page + 1} of {panes}</span>
          <button onClick={() => step(1)} aria-label="Next section"
            className="min-h-[44px] px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] font-semibold">→</button>
        </div>
      )}

      {/* Every section below is a child of this one div, which is the whole
          mechanism: in scroll mode it stacks them with a gap, in swipe mode CSS
          turns the same children into full-width scroll-snap panes. Nothing
          inside the sections knows which mode it is in, so a new section joins
          the pager by existing. */}
      <div ref={pager} className={mode === "swipe" ? "rs-pager" : "space-y-6"}>

      <div id="summary" className="scroll-mt-32">
        <RatioGrid snapshot={s} row={fullRow} cohort={cohort} />
      </div>

      <div id="chart" className="scroll-mt-32">
        {company.prices && (company.prices.monthly?.length || company.prices.weekly?.length) ? (
          <>
            <StockChart prices={company.prices} peBand={company.pe_band} evBand={company.ev_band} pbBand={company.pb_band} psBand={company.ps_band} trendQ={company.trend?.quarterly} livePrice={price} quarters={company.quarters} actions={company.actions} symbol={symbol} peers={peers} coverage={company.coverage} exchange={company.exchange} />
            {company.exchange !== "BSE" && (
              <CoverageNote cov={company.coverage} bandFrom={company.pe_band?.series?.[0]?.[0] ?? null} />
            )}
          </>
        ) : null}
      </div>

      {/* OUTSIDE the chart block, deliberately. This explanation used to sit
          inside `company.prices && ...`, so a BSE company with no price history
          would have shown a page of empty sections and no reason for any of
          them. Every published BSE company happens to have prices today, so
          this changes nothing on screen - it removes a coupling that would have
          hidden the explanation precisely when it was most needed. */}
      {company.exchange === "BSE" && (
        <p className="text-[13px] leading-relaxed text-[var(--ink3)] border border-[var(--line)] rounded-xl p-3 bg-[var(--card2)]">
          <span className="font-semibold text-[var(--ink2)]">Listed on BSE only{company.bse_code ? ` — scrip code ${company.bse_code}` : ""}.</span>{" "}
          Price, market cap and the chart come from the exchange feed and are current.
          The as-filed quarterly table, the valuation bands and the shareholding
          pattern are built from NSE&rsquo;s filing archive, which does not carry
          companies that are not listed there — so those sections are absent rather
          than pending.
        </p>
      )}

      {/* Three separate sections, not one. They were stacked inside a single
          "analysis" block, which in swipe mode made one pane three screens tall
          and in scroll mode gave the section menu one entry for three different
          questions. Each is now addressable by name. */}
      <div id="performance" className="scroll-mt-32">
        <PriceHistory row={fullRow} snapshot={s} />
      </div>

      <div id="analysis" className="scroll-mt-32">
        <ProsCons row={fullRow} />
      </div>

      {company.fscore && (
        <div id="checks" className="scroll-mt-32"><FScore f={company.fscore} /></div>
      )}

      <div id="valuation" className="scroll-mt-32">
        <ValuationHistory company={company} />
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
                    <td className="px-3 py-1.5"><Link className="font-medium text-[var(--accent-ink)] hover:underline" href={`/company?s=${encodeURIComponent(String(p.symbol))}`}>{titleCase(String(p.name ?? "")) || String(p.symbol)}</Link></td>
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

      {/* 2,766 of 4,746 companies have no valuation chart and the page said
          nothing about any of them, so every one looked like a fault. None is:
          each is the app declining to publish a P/E that would not mean
          anything. An unexplained absence is indistinguishable from a bug. */}
      {company.no_pe_reason && (
        <p className="text-[13px] leading-relaxed text-[var(--ink3)] border border-[var(--line)] rounded-xl p-3 bg-[var(--card2)]">
          <span className="font-semibold text-[var(--ink2)]">No price-to-earnings chart for this company.</span>{" "}
          {company.no_pe_reason}
        </p>
      )}

      {company.ratios && <RatiosTable r={company.ratios} />}

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
        />
          <div className="bg-[var(--card)] rounded-b-xl border border-t-0 border-[var(--line)] -mt-px">
            <HoldingTrend s={company.shareholding} />
          </div>
        </div>
      )}

      <section id="documents" className="scroll-mt-32 bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-3">
        <h2 className="text-sm font-bold text-[var(--ink)]">Documents</h2>
        {company.documents && <DocumentsByYear docs={company.documents} />}
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
