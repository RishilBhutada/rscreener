/** Cash flow under the P/E chart (owner, 20-Nov-2026: "just like eps i want
 *  bars for cash flow too but with different shade" - picked 3 + A: operating
 *  and free cash flow side by side, with a Price / Cash flow line).
 *
 *  One bar per financial year: Indian companies file a cash flow statement
 *  half-yearly, and the store holds the yearly one (Yahoo, ~5 years). The
 *  line is market value over the latest year's operating cash flow, from the
 *  date that year's results were out (taken as 60 days after the year ends).
 *  Shared by the company chart and the full-screen chart. */

export type CashYear = { end: string; cfo: number | null; fcf: number | null };
type Stmt = { periods: string[]; items: { label: string; values: (number | null)[] }[] } | null | undefined;
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

const DAY = 86400000;
const t = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export const RESULTS_LAG_DAYS = 60;

/** Price / operating cash flow on each date the Market cap / Sales line has
 *  a market value: that value over the latest year's CFO already published.
 *  Years with CFO at or below zero draw nothing - a negative multiple is a
 *  cash burn, not a cheap share. Median over the last five years, from 4 points. */
export function priceToCash(mcapBand: Band, years: CashYear[] | null): { series: [string, number][]; median_5y: number | null } | null {
  if (!mcapBand?.parts || !years?.length) return null;
  const series: [string, number][] = [];
  mcapBand.series.forEach(([d], i) => {
    const mcap = mcapBand.parts?.[i]?.[0];
    if (typeof mcap !== "number") return;
    const known = years.filter((y) => t(y.end) + RESULTS_LAG_DAYS * DAY <= t(d));
    const cfo = known.length ? known[known.length - 1].cfo : null;
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
