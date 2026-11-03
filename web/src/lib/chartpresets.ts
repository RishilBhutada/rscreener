/** Named chart set-ups (owner's pick A, 2-Nov-2026): a row of chips above the
 *  company chart; one tap sets the view, range, overlays, lines, window and
 *  growth basis for whichever company is open. Kept in rs_chart_presets, which
 *  is synced to the reader's account (lib/sync.ts), so they follow him from
 *  phone to PC. Four ready-made ones are there the first time; they can be
 *  renamed, updated or deleted like any other. */
import type { ChartPick } from "@/lib/chartpick";

export type ChartPreset = { name: string; pick: ChartPick };

const KEY = "rs_chart_presets";
const base = { overlays: [] as string[], win: "ttm", cmp: "yoy" as const, per: "eps" as const, chg: true };

export const READY_MADE: ChartPreset[] = [
  { name: "Earnings vs price", pick: { ...base, view: "ebitda", range: "3Y", vis: { "ebitda:eb_price": true, "ebitda:eb_ttm": true, "ebitda:ebitda": true, "ebitda:eb_eps": true, "ebitda:ebitda_m": false } } },
  { name: "Value check", pick: { ...base, view: "pe", range: "10Y", vis: { "pe:line": true, "pe:median": true, "pe:bars": true } } },
  { name: "Margins", pick: { ...base, view: "sales", range: "5Y", vis: { "sales:sales": true, "sales:gpm": false, "sales:opm": true, "sales:npm": false } } },
  { name: "Trend", pick: { ...base, view: "price", range: "1Y", vis: { "price:price": true, "price:dma50": true, "price:dma200": true, "price:volume": true } } },
];

export function loadPresets(): ChartPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return READY_MADE;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return READY_MADE;
    // One preset per name: a list merged from two devices before the
    // last-saved rule (lib/sync.ts) could hold a name twice.
    const seen = new Set<string>();
    return list.filter((p) => {
      if (!p || typeof p.name !== "string" || !p.pick) return false;
      const n = p.name.trim().toLowerCase();
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
  } catch { return READY_MADE; }
}

export function savePresets(list: ChartPreset[]) {
  try {
    // When it was saved, so syncing devices keeps the newest list (lib/sync.ts).
    localStorage.setItem(`${KEY}_at`, String(Date.now()));
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* private mode */ }
}

/** Lines that start switched off, so a line stored "off" and one never
 *  touched count as the same picture when matching a preset. */
function defaultOn(k: string): boolean {
  if (k === "ebitda:ebitda_m" || k === "ov:ebitda:ebitda_m") return false;
  if (/^ov:[^:]+:(bars|median|sales|ebitda|eb_eps|volume)$/.test(k)) return false;
  return true;
}

/** Whether the chart on screen is exactly this preset - its chip is lit. */
export function samePick(a: ChartPick, b: ChartPick, sameRange: (x: string, y: string) => boolean): boolean {
  if (a.view !== b.view || !sameRange(a.range, b.range)) return false;
  if ([...a.overlays].sort().join() !== [...b.overlays].sort().join()) return false;
  if (a.view === "pe" || a.overlays.includes("pe")) {
    if (a.win !== b.win || a.per !== b.per) return false;
  }
  if (a.chg !== b.chg || (a.chg && a.cmp !== b.cmp)) return false;
  // Only the lines this view and its overlays draw.
  const mine = (k: string) => k.startsWith(`${a.view}:`) || a.overlays.some((o) => k.startsWith(`ov:${o}:`));
  const keys = new Set([...Object.keys(a.vis), ...Object.keys(b.vis)].filter(mine));
  for (const k of keys) if ((a.vis[k] ?? defaultOn(k)) !== (b.vis[k] ?? defaultOn(k))) return false;
  return true;
}

const VIEW_WORDS: Record<string, string> = {
  price: "Price", years: "Years", pe: "PE Ratio", sales: "Sales & Margin", ebitda: "EBITDA",
  ev: "EV / EBITDA", pb: "Price to Book", ps: "Market Cap / Sales",
};
const LAYER_WORDS: Record<string, string> = {
  line: "ratio line", median: "median", bars: "bars", sales: "sales bars", gpm: "GPM %", opm: "OPM %", npm: "NPM %",
  eb_price: "price", eb_ttm: "4-quarter EBITDA line", ebitda: "EBITDA bars", eb_eps: "EPS bars", ebitda_m: "margin %",
  price: "price", dma50: "50 DMA", dma200: "200 DMA", volume: "volume",
};

/** What a preset sets, in plain words, for the save sheet. */
export function describe(p: ChartPick): string[] {
  const out = [`View: ${p.view === "pe" && p.per === "sps" ? "P/S Ratio" : VIEW_WORDS[p.view] ?? p.view}`, `Range: ${p.range}`];
  if (p.view === "pe" && p.win === "q1") out.push("Window: latest quarter x4");
  if (p.overlays.length) out.push(`Overlays: ${p.overlays.map((o) => VIEW_WORDS[o] ?? o).join(", ")}`);
  out.push(`Growth on bars: ${!p.chg ? "off" : p.cmp === "yoy" ? "vs year ago" : "vs quarter before"}`);
  const mine = (k: string) => k.startsWith(`${p.view}:`) || p.overlays.some((o) => k.startsWith(`ov:${o}:`));
  const word = (k: string) => {
    const parts = k.split(":");
    const w = LAYER_WORDS[parts[parts.length - 1]] ?? parts[parts.length - 1];
    return parts[0] === "ov" ? `${VIEW_WORDS[parts[1]] ?? parts[1]} ${w}` : w;
  };
  const off = Object.entries(p.vis).filter(([k, on]) => mine(k) && !on && defaultOn(k)).map(([k]) => word(k));
  const on = Object.entries(p.vis).filter(([k, v]) => mine(k) && v && !defaultOn(k)).map(([k]) => word(k));
  if (off.length) out.push(`Turned off: ${off.join(", ")}`);
  if (on.length) out.push(`Turned on: ${on.join(", ")}`);
  return out;
}
