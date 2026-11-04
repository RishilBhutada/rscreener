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
