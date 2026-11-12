/** Pure helpers for the company page: number and period formatting, and the
 *  statement transforms. No React, so they can be tested on their own. */

import { Row } from "@/lib/query";
import { change } from "@/lib/tableprefs";
import { fourInRow } from "@/lib/ttm";
import { Stmt, Trend, Company, Cohort } from "@/components/company/types";

export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthYear(iso?: string | null): string {
  if (!iso || iso.length < 7) return "—";
  return `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""} ${iso.slice(0, 4)}`;
}

/** Decimals for an amount in Rs crore, by its size. Rounded to whole crore,
 *  a small company's Rs 0.4 Cr profit printed as "0" and Rs 0.9 Cr as "1"
 *  (owner, 8-Nov-2026). Two decimals under 10, one under 100, none above. */
export function amtDec(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  const a = Math.abs(v);
  return a < 10 ? 2 : a < 100 ? 1 : 0;
}

export function fmtNum(v: number | string | null | undefined, dec = 2): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return v.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

export function periodLabel(p: string): string {
  return new Date(p).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

/** "Mar 2026" is when the quarter ended; the number only became public on the
 *  day it was declared, which for MTAR Tech was nearly seven months later. The
 *  table states both so the reader is never guessing which they are looking at. */
export function declaredLabel(d: string | null | undefined): string | null {
  if (!d) return null;
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

/** Columns a statement table opens with: the latest twelve periods, as
 *  screener.in shows. Reliance's quarterly table carries 85 quarters back to
 *  2005, a thousand cells most visits never look at. */
export const RECENT_PERIODS = 12;

/** The quarter after `p`: "2026-06-30" -> "2026-09-30". */
export function quarterAfter(p: string): string {
  const m = Number(p.slice(5, 7)) + 3, y = Number(p.slice(0, 4)) + (m > 12 ? 1 : 0), mm = m > 12 ? m - 12 : m;
  return `${y}-${String(mm).padStart(2, "0")}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** The quarter a results meeting on `day` reports: the last one to end before it. */
export function quarterBefore(day: string): string {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const qm = [12, 3, 6, 9][Math.floor((m - 1) / 3)], qy = m <= 3 ? y - 1 : y;
  return `${qy}-${String(qm).padStart(2, "0")}-${String(new Date(Date.UTC(qy, qm, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** Whether a table's columns are quarters (else years), from the dates. */
export function isQuarterly(periods: string[]): boolean {
  const n = periods.length;
  if (n < 2) return false;
  const a = Date.parse(periods[n - 2].slice(0, 10)), b = Date.parse(periods[n - 1].slice(0, 10));
  return Number.isFinite(a) && Number.isFinite(b) && (b - a) / 864e5 < 200;
}

/** The value a year before column i, found by DATE: with a quarter missing,
 *  counting back four columns would compare against fifteen months ago. */
export function yearBefore(periods: string[], values: (number | null)[], i: number, quarterly: boolean): number | null {
  if (!quarterly) return i > 0 ? values[i - 1] ?? null : null;
  const day = 864e5, target = Date.parse(periods[i].slice(0, 10)) - 365.25 * day;
  for (let j = i - 1; j >= 0; j--) {
    const d = Date.parse(periods[j].slice(0, 10));
    if (Math.abs(d - target) <= 45 * day) return values[j] ?? null;
    if (d < target - 45 * day) break;
  }
  return null;
}

/** A grid cell's tint: green if it rose from the period before, red if it fell,
 *  stronger the bigger the move (full at 25%, or 3 points for a % row). */
export function heatTint(cur: number | null | undefined, prev: number | null | undefined, points: boolean): string | undefined {
  const ch = change(cur, prev, points);
  if (ch === null || ch === 0) return undefined;
  const mag = Math.min(Math.abs(ch) / (points ? 3 : 25), 1);
  if (mag < 0.04) return undefined;
  return `color-mix(in srgb, var(${ch > 0 ? "--pos" : "--neg"}) ${Math.round(6 + 20 * mag)}%, transparent)`;
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
export function cagr(values: (number | null)[], years: number, periods?: string[], basis?: (string | null)[]): number | null {
  const yearsBetween = (a: string, b: string) =>
    (Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / (365.25 * 864e5);

  // One basis end to end, as cagr_pct: a start year on the other basis
  // (standalone under consolidated) is another business (review 5-Nov-2026).
  let endBasis: string | null = null;
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && v !== undefined && Number.isFinite(v)) { endBasis = basis?.[i] ?? null; break; }
  }
  const pairs: [string, number][] = [];
  values.forEach((v, i) => {
    const b = basis?.[i] ?? null;
    if (v !== null && v !== undefined && Number.isFinite(v) && periods?.[i] && !(endBasis && b && b !== endBasis)) {
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

export function num(r: Row | null, k: string): number | null {
  const v = r?.[k];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

/** A ₹ crore figure short enough for a tile whose label carries "₹Cr":
 *  8.13L (lakh crore) or 45,031. */
export function crShort(v: number | null): string {
  if (v === null) return "—";
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(2)}L`;
  return `${sign}${fmtNum(a, 0)}`;
}

/** EBITDA as companies and brokers quote it: operating profit plus other
 *  income (= profit before tax + interest + depreciation, without one-off
 *  exceptional items). "Operating Profit" above it leaves other income out.
 *  Added after OPM %, with its margin on sales folded under it. */
export function withEbitda(stmt: Stmt | null): Stmt | null {
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

/** The trailing twelve months for the annual table's TTM column (P11,
 *  1-Nov-2026): the four newest filed quarters, when they are consecutive and
 *  newer than the last filed year. Amounts are added up; a percentage is
 *  recomputed from its parts (OPM % from operating profit over revenue, Tax %
 *  weighted by profit before tax, cost shares weighted by revenue) - adding four
 *  percentages would be meaningless. A row it cannot work out stays blank. */
export function ttmOf(annual: Stmt | null, quarterly: Stmt | null): { asOf: string; values: Record<string, number | null> } | null {
  if (!annual || !quarterly) return null;
  const qp = quarterly.periods, n = qp.length;
  if (n < 4 || !annual.periods.length || qp[n - 1] <= annual.periods[annual.periods.length - 1]) return null;
  if (!fourInRow(qp, n - 1, quarterly.basis)) return null;   // consecutive, one basis (lib/ttm.ts)
  const q = (label: string, parent?: string) => quarterly.items.find((it) => it.label === label && (it.parent ?? undefined) === parent);
  const last4 = (label: string, parent?: string) => {
    const v = q(label, parent)?.values.slice(n - 4);
    return v && v.length === 4 && v.every((x) => x !== null && x !== undefined) ? (v as number[]) : null;
  };
  const sum = (label: string) => { const v = last4(label); return v ? v.reduce((a, b) => a + b, 0) : null; };
  const rev = sum("Revenue") ?? sum("Sales");
  const revs = last4("Revenue") ?? last4("Sales");
  const weighted = (pcts: number[] | null, w: number[] | null) => {
    if (!pcts || !w) return null;
    const tot = w.reduce((a, b) => a + b, 0);
    return tot ? Math.round((pcts.reduce((a, p, i) => a + p * w[i], 0) / tot) * 100) / 100 : null;
  };
  const values: Record<string, number | null> = {};
  for (const it of annual.items) {
    const key = it.parent ? `${it.parent}/${it.label}` : it.label;
    let v: number | null = null;
    if (it.label === "OPM %") { const op = sum("Operating Profit"); v = op !== null && rev ? Math.round((op / rev) * 10000) / 100 : null; }
    else if (it.label === "EBITDA margin %") { const e = sum("EBITDA"); v = e !== null && rev ? Math.round((e / rev) * 10000) / 100 : null; }
    else if (it.label === "Tax %") v = weighted(last4("Tax %"), last4("Profit before tax"));
    else if (it.parent && it.label.endsWith("%")) v = weighted(last4(it.label, it.parent), revs);
    else if (it.label.includes("%")) v = null;
    else { const x = last4(it.label, it.parent); v = x ? Math.round(x.reduce((a, b) => a + b, 0) * 100) / 100 : null; }
    values[key] = v;
  }
  return { asOf: qp[n - 1], values };
}

export function trendToStmt(t: Trend): Stmt {
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

export const STMT_TITLES: Record<string, string> = {
  quarterly_results: "Quarterly Results",
  annual_pnl: "Profit & Loss (annual)",
  balance_sheet: "Balance Sheet",
  cash_flow: "Cash Flow",
};

/** The median of one field across the industry, and how many companies it was
 *  taken over. Median rather than mean: one company with a P/E of 900 - and
 *  there are several - drags a mean somewhere no company actually is.
 *  Withheld below five companies, where a "median" is just one firm's number
 *  wearing a statistical hat. */
export function industryMedian(cohort: Cohort, field: string): { value: number; n: number } | null {
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
export function hasValuationHistory(company: Company): boolean {
  return [company.pe_band, company.pb_band, company.ev_band, company.ps_band].some(
    (b) => (b?.series ?? []).filter(
      (p) => Array.isArray(p) && typeof p[1] === "number" && Number.isFinite(p[1])
    ).length >= 36
  );
}
