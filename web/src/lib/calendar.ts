/** The calendar page's two files (pipeline/export_calendar_json.py), and one
 *  shape for both so the page can list, filter and search them together. */

export type CalKind = "results" | "dividend" | "bonus" | "split" | "rights" | "buyback" | "other" | "ipo" | "meeting";

/** calendar.json - what is coming. The home page's "Coming up" reads it too,
 *  so its first six fields keep their old names. */
export type UpcomingEvent = {
  kind: "meeting" | "exdate" | "ipo"; symbol: string; company: string; purpose: string; date: string; desc: string;
  type?: CalKind; amt?: number; yld?: number; seg?: string; end?: string;
  /** For a results meeting: the company's last results, and how far the stock
   *  typically moved on its last n results (median, either way). */
  last?: { q?: string; rvy?: number; pty?: number; rvq?: number; ptq?: number; pt?: number; mv?: number };
  typ?: number; n?: number;
  /** When its results usually come out ("15:45", IST): the middle of its last
   *  `un` announcement times. */
  usual?: string; un?: number;
};
/** `recent` is the last three days of the past year (from `recent_from`), in
 *  calendar-past.json's shape: the page re-reads this small file every few
 *  minutes and the year's file hourly. */
export type UpcomingDoc = {
  generated_at: string | null; updated?: string; events: UpcomingEvent[];
  recent_from?: string; recent?: PastEvent[]; recent_names?: Record<string, string>;
};

/** calendar-past.json - the past year, in short keys (about 11,000 events). */
export type PastEvent = {
  d: string; k: CalKind; s: string;
  /** Sales (rv) and net profit (pt) in ₹ crore; growth against a year before
   *  (y) and against the quarter before (q), in %. */
  q?: string; rv?: number; rvy?: number; rvq?: number; pt?: number; pty?: number; ptq?: number; eps?: number; sa?: 1;
  mv?: number; nf?: number; cc?: { t?: string; r?: string };
  /** When NSE stamped the results announcement ("15:40", IST), and its PDF. */
  at?: string; doc?: string; bm?: 1;
  x?: string; amt?: number; yld?: number; r?: string;
  seg?: string; ip?: number; lc?: number; lg?: number; p?: string;
};
export type PastDoc = { from: string; to: string; prices_to: string | null; names: Record<string, string>; events: PastEvent[] };

export type CalEvent = {
  id: string; date: string; kind: CalKind; symbol: string; name: string; upcoming: boolean;
  /** What happened or will: "Financial Results", "Bonus 1:1", "IPO opens". */
  what: string;
  /** Lower-case name and ticker, for search. */
  hay: string;
  past?: PastEvent; next?: UpcomingEvent;
};

export const KIND_LABEL: Record<CalKind, string> = {
  results: "Results", dividend: "Dividend", bonus: "Bonus", split: "Split", rights: "Rights",
  buyback: "Buyback", other: "Other", ipo: "IPO", meeting: "Meeting",
};

/** The type filter: each chip and the kinds it covers. */
export const GROUPS: [string, string, CalKind[]][] = [
  ["all", "All", []],
  ["results", "Results", ["results"]],
  ["dividend", "Dividends", ["dividend"]],
  ["reshape", "Splits & bonuses", ["split", "bonus"]],
  ["ipo", "IPOs", ["ipo"]],
  ["meeting", "Meetings", ["meeting"]],
  ["other", "Rights, buybacks & more", ["rights", "buyback", "other"]],
];

export const NSE_DOCS = "https://nsearchives.nseindia.com/corporate/";
export const docUrl = (u: string) => (u.includes("://") ? u : NSE_DOCS + u);

function hay(name: string, symbol: string): string {
  return `${name} ${symbol}`.toLowerCase();
}

export function fromUpcoming(e: UpcomingEvent, i: number, short: (n: string, s: string) => string): CalEvent {
  const kind: CalKind = e.type ?? (e.kind === "meeting" ? "meeting" : e.kind === "ipo" ? "ipo" : "other");
  const name = short(e.company ?? "", e.symbol);
  return {
    id: `n${i}`, date: e.date, kind, symbol: e.symbol, name, upcoming: true,
    what: e.purpose.replace(/^Ex-date:\s*/, ""), hay: hay(name, e.symbol), next: e,
  };
}

export function fromPast(e: PastEvent, i: number, names: Record<string, string>, short: (n: string, s: string) => string): CalEvent {
  const name = short(names[e.s] ?? "", e.s);
  const what = e.k === "results" ? `${e.q ?? ""} results`.trim()
    : e.k === "ipo" ? "Listed"
    : e.k === "meeting" ? (e.p || "Board meeting")
    : (e.x || KIND_LABEL[e.k]);
  return { id: `p${i}`, date: e.d, kind: e.k, symbol: e.s, name, upcoming: false, what, hay: hay(name, e.s), past: e };
}

/** Every word typed must appear in the name or the ticker. */
export function matches(e: CalEvent, words: string[]): boolean {
  return words.every((w) => e.hay.includes(w));
}

/** The quarter a results meeting on `day` reports - the last to end before
 *  it - as India writes it: 9 Oct 2026 -> "Q2 FY27". */
export function quarterDue(day: string): string {
  const y = Number(day.slice(0, 4)), i = Math.floor((Number(day.slice(5, 7)) - 1) / 3);
  return `Q${[3, 4, 1, 2][i]} FY${String((i <= 1 ? y : y + 1) % 100).padStart(2, "0")}`;
}

export function dayLabel(iso: string, withYear = false): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC",
  });
}

/** "15:40" -> "3:40 pm". */
export function clock(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2)), m = hhmm.slice(3, 5);
  return `${h % 12 || 12}:${m} ${h < 12 ? "am" : "pm"}`;
}

export function crore(v: number): string {
  const s = Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 1 });
  return `${v < 0 ? "−" : ""}₹${s} Cr`;
}
