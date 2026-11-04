/** Shared by the indices list and an index's page: the file shapes written
 *  by pipeline/export_indices_json.py and how their numbers are written. */

export type IndexListItem = {
  s: string; name: string; group: string; exch: string; date: string; close: number;
  chg: number | null; chg_pct: number | null; r1m: number | null; r1y: number | null;
  pe: number | null; pb: number | null; dy: number | null; pe_pct: number | null;
  from_ath: number | null; n: number;
};

export type IndexList = { generated_at: string; asof: string; groups: string[]; items: IndexListItem[] };

/** One valuation measure: now, its 5- and 10-year medians, and the share of
 *  the last ten years' days on which it was lower than now. */
export type ValStat = { now: number; med5: number | null; med10: number | null; pct10: number | null; years: number };

export type IndexDoc = {
  s: string; name: string; group: string; exch: string; asof: string;
  open: number; high: number; low: number; close: number; prev: number | null;
  chg: number | null; chg_pct: number | null; volume: number | null; turnover: number | null;
  hi52: number; lo52: number; ath: number; ath_date: string; from_ath: number | null;
  vs_dma50: number | null; vs_dma200: number | null; vol_1y: number | null;
  ret: Record<string, number>; cagr: Record<string, number>; since: string; cagr_all: number | null;
  val: { pe?: ValStat; pb?: ValStat; dy?: ValStat };
  /** symbol, company, industry */
  members: [string, string, string][];
  factsheet: string | null;
  etfs: string[];
  val_file?: string;
};

export const RETURN_ORDER = ["1W", "1M", "3M", "6M", "1Y", "3Y", "5Y", "10Y", "20Y"];

/** Index points, as the exchange prints them: 22,620.45. */
export function points(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
