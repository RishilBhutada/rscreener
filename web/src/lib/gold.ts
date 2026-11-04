/** The gold page's file (pipeline/export_gold_json.py). */

export type GoldQuote = { date: string; close: number; chg: number };

export type GoldEvent = {
  /** UTC ISO time */
  t: string; c: string; title: string; fam: string; stars: number; src: string;
  forecast?: string; previous?: string; actual?: string;
  /** [session date, % move] - the first close after the event */
  comex?: [string, number]; mcx?: [string, number];
  /** an announcement found in the news: the article, and the rule it matched */
  url?: string; why?: string;
  /** US releases, once out: the 2-year Treasury yield's move that day (basis
   *  points) - the market's verdict on whether the data surprised. `sur`: big
   *  enough to count as a surprise for this kind of release. `with`: a more
   *  important release the same day owns the move. */
  dy?: number; sur?: boolean; with?: string;
  /** CPI and PCE: the Cleveland Fed model's nowcast for the month, month on
   *  month, as it stood the day before the release (or now): headline, core. */
  now?: { m: string; h?: number; c?: number; d: string };
};

/** How gold moved when a kind of US release surprised - the third of its
 *  releases with the biggest 2-year yield move - and when it landed in line
 *  (the smallest third). */
export type GoldSurprise = { n: number; bp: number; move: number; quiet: number; ratio: number; stars: number };

export type GoldFamily = {
  label: string; why: string; rule: number; stars: number; n: number;
  median_move?: number; normal_move?: number; ratio?: number; since?: string;
  /** a date, not news: never measured */
  fixed?: boolean;
  /** where the moves are measured: COMEX, or MCX for India's own events */
  market?: "COMEX" | "MCX";
  surprise?: GoldSurprise;
  /** "surprise": the stars come from the surprise measure, higher than the plain one */
  basis?: "surprise";
};

export type GoldNews = { t: string; title: string; url: string; src: string; stars: number; why: string };

export type GoldDoc = {
  generated_at: string;
  snapshot: {
    mcx?: GoldQuote; comex?: GoldQuote; usdinr?: GoldQuote; silver?: GoldQuote;
    parity?: number; parity_date?: string; mcx_prem?: number; gold_silver?: number;
    /** India's import duty in force (%), since when and why; the world price with it; MCX against that */
    duty?: number; duty_since?: string; duty_why?: string; landed?: number; mcx_vs_landed?: number;
  };
  events: GoldEvent[];
  families: Record<string, GoldFamily>;
  news: GoldNews[];
  min_measured: number;
};

const IST = "Asia/Kolkata";

export function istDay(t: string): string {
  return new Date(t).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: IST });
}

export function istTime(t: string): string {
  return new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: IST });
}

export function istDate(t: string): string {
  return new Date(t).toLocaleDateString("en-CA", { timeZone: IST });
}

export function ago(t: string, now: number): string {
  const h = Math.max(0, (now - new Date(t).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Countries as two letters a reader knows. */
export const COUNTRY: Record<string, string> = {
  USD: "US", EUR: "EU", CNY: "CN", JPY: "JP", GBP: "UK", INR: "IN", AUD: "AU", CAD: "CA", CHF: "CH", NZD: "NZ",
};
