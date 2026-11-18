/** The one rule for a trailing twelve months, shared by the company chart, the
 *  full-screen chart and the results table's TTM column - the same rule the
 *  pipeline applies to the ratio lines (pipeline/trend_lib.py ratio_bands):
 *
 *  - four CONSECUTIVE quarters: across a missing quarter the window spans five
 *    or more and is not twelve months (span of at most ~300 days);
 *  - on ONE basis: consolidated and standalone quarters describe different
 *    sets of companies and do not add up.
 */
export const TTM_SPAN_DAYS = 300;

const day = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86400000;

/** Whether quarters i-3..i of `periods` make a trailing twelve months. */
export function fourInRow(periods: string[], i: number, basis?: (string | null | undefined)[] | null): boolean {
  if (i < 3 || i >= periods.length) return false;
  if (day(periods[i]) - day(periods[i - 3]) > TTM_SPAN_DAYS) return false;
  if (basis && new Set(basis.slice(i - 3, i + 1).filter(Boolean)).size > 1) return false;
  return true;
}

type Vals = (number | null | undefined)[] | null | undefined;
const known = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

/** Each quarter's twelve-month total - it and the three before it - aligned
 *  with `periods`; null where those four are not a trailing twelve months or
 *  one is missing. The Sales & margin chart's TTM basis (owner, 18-Nov-2026). */
export function ttmSums(periods: string[], vals: Vals, basis?: (string | null | undefined)[] | null): (number | null)[] {
  return periods.map((_, i) => {
    if (!vals || !fourInRow(periods, i, basis)) return null;
    const w = vals.slice(i - 3, i + 1);
    return w.length === 4 && w.every(known) ? (w as number[]).reduce((a, b) => a + b, 0) : null;
  });
}

/** Each quarter's twelve-month margin: the four quarters' margins weighted by
 *  their sales, which is exactly the twelve months' profit over the twelve
 *  months' sales (a quarter's margin x its sales is its profit). */
export function ttmMargins(periods: string[], pct: Vals, sales: Vals, basis?: (string | null | undefined)[] | null): (number | null)[] {
  return periods.map((_, i) => {
    if (!pct || !sales || !fourInRow(periods, i, basis)) return null;
    let profit = 0, total = 0;
    for (let j = i - 3; j <= i; j++) {
      const m = pct[j], s = sales[j];
      if (!known(m) || !known(s)) return null;
      profit += (m / 100) * s;
      total += s;
    }
    return total > 0 ? (profit / total) * 100 : null;
  });
}

/** The latest quarter annualised (x4), aligned with its input - the 1Q x4
 *  figure under a ratio drawn on that window. */
export function quarterX4(vals: Vals): (number | null)[] {
  return (vals ?? []).map((v) => (known(v) ? v * 4 : null));
}
