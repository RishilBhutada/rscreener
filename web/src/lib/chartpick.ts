/** What the reader picked on a chart - the view, range, overlays, lines
 *  switched on or off, earnings window and growth comparison. Kept on this
 *  device and shared by every company (owner, 2-Nov-2026: "remember the
 *  settings when switched from one company's chart to another"), so the
 *  company chart and the full chart each open as the last one was left.
 *  A company that lacks the saved view shows Price, and the saved choice is
 *  kept for the next company that has it.
 *
 *  Stored in the full chart's words: ranges as its buttons ("5Y"), lines as
 *  "<view>:<layer>" (pe:line, pe:median, pe:bars, sales:opm, ebitda:eb_ttm)
 *  and an overlay's lines as "ov:<view>:<layer>". The company chart's own
 *  series keys are translated here, in one place. */

export type ChartPick = {
  view: string;
  range: string;
  overlays: string[];
  /** true = shown, false = hidden; a line not listed keeps its default */
  vis: Record<string, boolean>;
  win: string;            // "ttm" | "q1"
  cmp: "yoy" | "prev";
  per: "eps" | "sps";
  chg: boolean;
};

const KEY = "rs_chart_pick";

export function readPick(): Partial<ChartPick> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<ChartPick>) : null;
  } catch { return null; }
}

export function writePick(pick: ChartPick) {
  try { localStorage.setItem(KEY, JSON.stringify(pick)); } catch { /* private mode */ }
}

/* ── ranges ──────────────────────────────────────────────────────────────── */

const TO_FULL: Record<string, string> = { "1M": "1M", "6M": "6M", "1Yr": "1Y", "3Yr": "3Y", "5Yr": "5Y", "10Yr": "10Y", Max: "MAX" };
// The full chart has more buttons; each maps to the company chart's nearest.
const TO_COMPANY: Record<string, string> = {
  "1M": "1M", "3M": "6M", "6M": "6M", YTD: "1Yr", "1Y": "1Yr", "2Y": "3Yr", "3Y": "3Yr", "5Y": "5Yr", "10Y": "10Yr", MAX: "Max",
};
export const rangeToFull = (r: string) => TO_FULL[r] ?? "5Y";
export const rangeToCompany = (r?: string) => (r && TO_COMPANY[r]) || null;

/* ── line keys ───────────────────────────────────────────────────────────── */

const BANDS = ["pe", "ev", "pb", "ps"];
const SALES = ["sales", "gpm", "opm", "npm"];
const viewOfKey = (k: string): string | null =>
  BANDS.find((b) => k.startsWith(`${b}_`)) ?? (SALES.includes(k) ? "sales"
    : k === "ebitda" || k.startsWith("eb_") || k === "ebitda_m" ? "ebitda"
    : ["price", "dma50", "dma200", "volume"].includes(k) ? "price" : null);
const layerOf = (v: string, k: string) =>
  BANDS.includes(v) ? ({ [`${v}_line`]: "line", [`${v}_median`]: "median", [`${v}_bar`]: "bars" } as Record<string, string>)[k] ?? k : k;
const keyOf = (v: string, layer: string) =>
  BANDS.includes(v) ? ({ line: `${v}_line`, median: `${v}_median`, bars: `${v}_bar` } as Record<string, string>)[layer] ?? layer : layer;

/** A company-chart series key ("pe_line", "ov_ebitda_eb_ttm") in stored words. */
export function canonKey(k: string): string | null {
  const ov = /^ov_(pe|ev|pb|ps|sales|ebitda|price)_(.+)$/.exec(k);
  if (ov) return `ov:${ov[1]}:${layerOf(ov[1], ov[2])}`;
  const v = viewOfKey(k);
  return v ? `${v}:${layerOf(v, k)}` : null;
}

/** Stored words back to the company chart's series key. */
export function companyKey(c: string): string | null {
  const p = c.split(":");
  if (p[0] === "ov" && p.length === 3) return `ov_${p[1]}_${keyOf(p[1], p[2])}`;
  if (p.length === 2) return keyOf(p[0], p[1]);
  return null;
}
