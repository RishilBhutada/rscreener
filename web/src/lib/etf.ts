/** Shared by the ETFs list and the ETF page: the file shapes and how a
 *  premium is written and coloured, so the two can never disagree. */

export type EtfListItem = {
  s: string; name: string; underlying: string; class: string; index: string | null;
  price: number | null; price_date: string | null; nav: number | null; nav_date: string | null;
  prem: number | null; prem_date: string | null; prem_avg_1m: number | null;
  turnover_cr: number; thin: boolean; r1y_price: number | null; r1y_nav: number | null;
};

export type Returns = Partial<Record<"1m" | "6m" | "1y" | "3y", number | null>>;

export type EtfDoc = {
  s: string; name: string; underlying: string; class: string; isin: string | null; listed: string | null;
  amfi_code: string | null; index: { label: string; ticker: string; fx: string | null } | null;
  price: number | null; price_date: string | null; nav: number | null; nav_date: string | null;
  prem: number | null; prem_date: string | null; prem_avg_1m: number | null;
  prem_hi_1y: [string, number] | null; prem_lo_1y: [string, number] | null;
  /** Share of the past year's days with a LOWER premium than today's. */
  prem_pct_1y?: number | null;
  same_index?: { s: string; name: string; prem: number | null; prem_avg_1m: number | null;
    turnover_cr: number; thin: boolean; r1y_nav: number | null; ter?: number | null }[];
  ret_price: Returns; ret_nav: Returns; ret_index: Returns;
  turnover_cr: number; traded_days_20: number; thin: boolean;
  /** Expense ratio, % a year, as filed with AMFI - and the day it applies to. */
  ter?: number | null; ter_date?: string | null;
  rows: [number, number, number | null, number | null, number?][];
};

/** How far from NAV counts as "away" - inside it, the price and the holdings
 *  agree to within normal day-to-day noise. */
export const NEAR_NAV = 0.5;

export const CLASS_LABEL: Record<string, string> = {
  equity: "Equity", international: "Global", gold: "Gold", silver: "Silver", debt: "Debt", hybrid: "Hybrid",
};

export function premText(p: number | null | undefined): string {
  if (p === null || p === undefined) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;
}

export function premClass(p: number | null | undefined): string {
  if (p === null || p === undefined || Math.abs(p) < NEAR_NAV) return "text-[var(--ink3)]";
  return p > 0 ? "text-[var(--warn-ink)]" : "text-[var(--chart-alt)]";
}

/** The premium as a sentence, for the ETF page's headline. */
export function premSentence(p: number | null | undefined): string {
  if (p === null || p === undefined) return "No same-day NAV to compare with";
  if (Math.abs(p) < NEAR_NAV) return "Trading in line with its NAV";
  return `Trading ${Math.abs(p).toFixed(1)}% ${p > 0 ? "above" : "below"} its NAV`;
}

/** Today's premium against its own past year, as a sentence. */
export function pctRankText(pct: number | null | undefined): string | null {
  if (pct === null || pct === undefined) return null;
  return pct >= 50 ? `Higher than on ${pct}% of days in the past year`
    : `Lower than on ${100 - pct}% of days in the past year`;
}

export function pctText(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}
