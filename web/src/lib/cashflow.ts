/** Cash flow under the P/E chart (owner, 20-Nov-2026: "just like eps i want
 *  bars for cash flow too but with different shade" - picked 3 + A: operating
 *  and free cash flow side by side, with a Price / Cash flow line).
 *
 *  Half-yearly where the filings give it (owner, same day: "yes, add
 *  half-yearly cash flow"): each half-year and year-end results XBRL carries
 *  the cash flow statement year to date, so H1 is the half-year figure and H2
 *  the year less H1 (pipeline/cashflow_half.py), back to FY22. Otherwise one
 *  bar per year from the yearly statement (Yahoo, ~5 years). The line is
 *  market value over the latest twelve months' operating cash flow, from the
 *  date those results were out (taken as 60 days after the period ends).
 *  Shared by the company chart and the full-screen chart. */

export type CashYear = { end: string; cfo: number | null; fcf: number | null };
export type CashRows = { rows: CashYear[]; months: 6 | 12 };
type Stmt = { periods: string[]; items: { label: string; values: (number | null)[] }[] } | null | undefined;
type Half = { periods: string[]; cfo: (number | null)[]; fcf: (number | null)[]; basis?: string } | null | undefined;
type Band = { series: [string, number][]; parts?: (number | string[])[][] } | null | undefined;

/** Operating and free cash flow per year (Rs Cr), oldest first; null when the company file has none. */
export function cashYears(cf: Stmt): CashYear[] | null {
  if (!cf?.periods?.length) return null;
  const row = (l: string) => cf.items.find((it) => it.label === l)?.values;
  const cfo = row("Cash from Operations"), fcf = row("Free Cash Flow");
  if (!cfo) return null;
  const out = cf.periods.map((end, i) => ({ end, cfo: cfo[i] ?? null, fcf: fcf?.[i] ?? null }))
    .filter((y) => y.cfo !== null || y.fcf !== null);
  return out.length >= 2 ? out : null;
}

/** Half-years from the filings (Rs Cr), oldest first; null under four. */
export function cashHalves(h: Half): CashYear[] | null {
  if (!h?.periods?.length) return null;
  const out = h.periods.map((end, i) => ({ end, cfo: h.cfo?.[i] ?? null, fcf: h.fcf?.[i] ?? null }))
    .filter((y) => y.cfo !== null || y.fcf !== null);
  return out.length >= 4 ? out : null;
}

/** Halves where there are four or more, else years; null when neither. */
export function cashRows(cf: Stmt, half: Half): CashRows | null {
  const h = cashHalves(half);
  if (h) return { rows: h, months: 6 };
  const y = cashYears(cf);
  return y ? { rows: y, months: 12 } : null;
}

/** The row a bar's change is measured against: the same half a year
 *  earlier for halves (H1 against H1 - halves differ by season), else the
 *  year before. */
export const cashPrevStep = (months: 6 | 12) => (months === 6 ? 2 : 1);

const DAY = 86400000;
const t = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export const RESULTS_LAG_DAYS = 60;

/** Twelve months' operating cash flow known at time `at`: the latest year,
 *  or the latest two consecutive halves. null when not all of it is known. */
function cfoKnown(c: CashRows, at: number): number | null {
  const known = c.rows.filter((y) => t(y.end) + RESULTS_LAG_DAYS * DAY <= at);
  if (!known.length) return null;
  if (c.months === 12) return known[known.length - 1].cfo;
  if (known.length < 2) return null;
  const a = known[known.length - 2], b = known[known.length - 1];
  // consecutive halves only: a gap would make it something other than a year
  if (a.cfo === null || b.cfo === null || t(b.end) - t(a.end) > 200 * DAY) return null;
  return a.cfo + b.cfo;
}

/** Price / operating cash flow on each date the Market cap / Sales line has
 *  a market value: that value over the twelve months' CFO already published.
 *  Twelve months at or below zero draw nothing - a negative multiple is a
 *  cash burn, not a cheap share. Median over the last five years, from 4 points.
 *  A bare list of years (the earlier signature) is still accepted. */
export function priceToCash(mcapBand: Band, cash: CashRows | CashYear[] | null): { series: [string, number][]; median_5y: number | null } | null {
  const c: CashRows | null = Array.isArray(cash) ? { rows: cash, months: 12 } : cash;
  if (!mcapBand?.parts || !c?.rows.length) return null;
  const series: [string, number][] = [];
  mcapBand.series.forEach(([d], i) => {
    const mcap = mcapBand.parts?.[i]?.[0];
    if (typeof mcap !== "number") return;
    const cfo = cfoKnown(c, t(d));
    if (cfo !== null && cfo > 0) series.push([d, Math.round((mcap / cfo) * 10) / 10]);
  });
  if (series.length < 4) return null;
  const last = t(series[series.length - 1][0]);
  const vals = series.filter(([d]) => t(d) >= last - 5 * 365.25 * DAY).map(([, v]) => v).sort((a, b) => a - b);
  const n = vals.length;
  const median = n >= 4 ? (n % 2 ? vals[(n - 1) / 2] : (vals[n / 2 - 1] + vals[n / 2]) / 2) : null;
  return { series, median_5y: median === null ? null : Math.round(median * 10) / 10 };
}

/** The two shades: operating cash light, free cash dark - teal, apart from
 *  EPS's four quarter colours. */
export const CASH_COLOUR = { cfo: "#2dd4bf", fcf: "#0f766e" };
