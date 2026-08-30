"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import { titleCase } from "@/lib/names";
import StockChart, { CorpAction, Quarter } from "@/components/StockChart";
import { Row } from "@/lib/query";
import { loadNote, pushRecent, saveNote } from "@/lib/store";
import WatchStar from "@/components/WatchStar";

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
  exchange?: string | null;
  bse_code?: number | string | null;
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
function cagr(values: (number | null)[], years: number, periods?: string[]): number | null {
  if (!periods || periods.length !== values.length) {
    // No dates to anchor to: fall back to positions, but only when the series
    // is dense enough that positions and years cannot disagree.
    const clean = values.filter((v): v is number => v !== null && v !== undefined);
    if (clean.length < years + 1) return null;
    const last = clean[clean.length - 1], start = clean[clean.length - 1 - years];
    if (!last || !start || start <= 0 || last <= 0) return null;
    return Math.round((Math.pow(last / start, 1 / years) - 1) * 100);
  }
  let endIdx = -1;
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v !== undefined && v > 0) { endIdx = i; break; }
  }
  if (endIdx < 0) return null;
  const endYear = Number(String(periods[endIdx]).slice(0, 4));
  const wantYear = endYear - years;
  const startIdx = periods.findIndex((p, i) => {
    const v = values[i];
    return Number(String(p).slice(0, 4)) === wantYear && v !== null && v !== undefined && v > 0;
  });
  if (startIdx < 0) return null;          // that year was never filed
  const last = values[endIdx] as number, start = values[startIdx] as number;
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

function RatioGrid({ snapshot, row }: { snapshot: Row; row: Row | null }) {
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
  const groups: [string, [string, string][]][] = [
    ["Size and price", [
      ["Market Cap", money(g("mcap"), 0, " Cr")],
      ["Current Price", money(g("price"))],
      ["High / Low", g("wk52_high") == null && g("wk52_low") == null ? "—"
        : `₹ ${fmtNum(g("wk52_high"), 0)} / ${fmtNum(g("wk52_low"), 0)}`],
    ]],
    ["What it costs", [
      ["Stock P/E", plain(g("pe"))],
      ["Book Value", money(g("book_value"))],
      ["Dividend Yield", pct(g("div_yield"))],
    ]],
    ["What it earns", [
      ["ROCE", pct(g("roce"))],
      ["ROE", pct(g("roe"))],
      ["Sales growth 5Y", pct(g("sales_cagr_5y"))],
      ["Profit growth 5Y", pct(g("profit_cagr_5y"))],
    ]],
    ["Risk and ownership", [
      ["Debt / Equity", plain(g("de"))],
      ["Promoter holding", pct(g("promoter_holding"))],
      ["Volatility 1Y", vol("volatility_1y")],
      ["Volatility 30D", vol("volatility_30d")],
    ]],
  ];
  const info = open ? METRIC_INFO[open] : null;
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
        {groups.map(([heading, cells]) => (
          <div key={heading}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink3)] mb-1.5">
              {heading}
            </h3>
            {cells.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between border-b border-[var(--line)] py-1.5">
                <span className="text-sm text-[var(--ink3)]">
                  {label}
                  <InfoDot label={label} onOpen={setOpen} />
                </span>
                <span className="text-sm font-semibold text-[var(--ink)] tabular-nums">{value}</span>
              </div>
            ))}
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
  const [fullRow, setFullRow] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

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

      <nav className="static sm:sticky sm:top-14 z-20 -mx-4 px-4 bg-[var(--card)] border-y border-[var(--line)] flex gap-1 overflow-x-auto text-sm font-medium py-2 sm:py-1.5 [scrollbar-width:none]">
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
          ["analysis", "Analysis", true], ["peers", "Peers", true],
          ["quarters", "Quarters", Boolean(quarterly)],
          ["profit-loss", "Profit & Loss", Boolean(pnl)],
          ["balance-sheet", "Balance Sheet", Boolean(balance)],
          ["cash-flows", "Cash Flow", Boolean(cashflow)],
          ["shareholding", "Investors", Boolean(company.shareholding)],
          ["documents", "Documents", true],
        ] as [string, string, boolean][]).filter(([, , show]) => show).map(([id, label]) => (
          <a key={id} href={`#${id}`} className="px-3 py-2.5 sm:py-1 rounded-lg whitespace-nowrap text-[var(--ink2)] hover:bg-[var(--card2)] hover:text-[var(--accent-ink)]">
            {label}
          </a>
        ))}
      </nav>

      <div id="summary" className="scroll-mt-32">
        <RatioGrid snapshot={s} row={fullRow} />
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

      <div id="analysis" className="scroll-mt-32 space-y-4">
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
                <li key={d.url} className="text-sm line-clamp-2 sm:truncate">
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
                <li key={d.url} className="text-sm line-clamp-2 sm:truncate">
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
