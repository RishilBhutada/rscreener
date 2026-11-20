/** Named chart set-ups (owner's pick A, 2-Nov-2026): a row of chips above the
 *  company chart; one tap sets the view, range, overlays, lines, window and
 *  growth basis for whichever company is open. Kept in rs_chart_presets, which
 *  is synced to the reader's account (lib/sync.ts), so they follow him from
 *  phone to PC. Four ready-made ones are there the first time; they can be
 *  renamed, updated or deleted like any other. */
import { readPick, readOwn, type ChartPick, type ChartSide } from "@/lib/chartpick";

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
  // The window draws on every ratio view that carries one (18-Nov-2026).
  if ((a.view === "ps" || a.view === "ev") && a.win !== b.win) return false;
  if (a.view === "sales" && (a.sw ?? "q") !== (b.sw ?? "q")) return false;
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

const WIN_WORDS: Record<string, string> = { ttm: "TTM", q1: "Latest quarter ×4" };
const PER_WORDS: Record<string, string> = { eps: "EPS", sps: "SPS", debt: "Debt", cash: "Cash flow" };
const growthWords = (p: ChartPick) => (!p.chg ? "Off" : p.cmp === "yoy" ? "Vs year ago" : "Vs quarter before");
const viewWords = (p: ChartPick) => (p.view === "pe" && p.per === "sps" ? "P/S Ratio" : VIEW_WORDS[p.view] ?? p.view);
const lineWords = (k: string) => {
  const parts = k.split(":");
  const w = LAYER_WORDS[parts[parts.length - 1]] ?? parts[parts.length - 1];
  return parts[0] === "ov" ? `${VIEW_WORDS[parts[1]] ?? parts[1]} overlay: ${w}` : `${VIEW_WORDS[parts[0]] ?? parts[0]}: ${w}`;
};

/** A saved pick with every field filled - what a chart shows for a missing one. */
export function fillPick(p: Partial<ChartPick> | null | undefined): ChartPick {
  return {
    view: p?.view ?? "price", range: p?.range ?? "5Y", overlays: p?.overlays ?? [], vis: p?.vis ?? {},
    win: p?.win ?? "ttm", cmp: p?.cmp ?? "yoy", per: p?.per ?? "eps", chg: p?.chg ?? true, sw: p?.sw ?? "q",
  };
}

/** Every setting that differs between two picks, in plain words - "Range: 1Y
 *  → 5Y" - for the confirmations before a change is made (owner, 21-Nov-2026:
 *  "it should ask for confirmation and list the changes too before actually
 *  making it"). Empty when nothing differs. */
export function pickChanges(from: ChartPick, to: ChartPick, sameRange: (x: string, y: string) => boolean = (x, y) => x === y): string[] {
  const out: string[] = [];
  if (viewWords(from) !== viewWords(to)) out.push(`View: ${viewWords(from)} → ${viewWords(to)}`);
  if (!sameRange(from.range, to.range)) out.push(`Range: ${from.range} → ${to.range}`);
  if ((from.win || "ttm") !== (to.win || "ttm")) out.push(`Window: ${WIN_WORDS[from.win] ?? from.win} → ${WIN_WORDS[to.win] ?? to.win}`);
  if (from.per !== to.per && !(from.view === "pe" && to.view === "pe" && viewWords(from) !== viewWords(to) && [from.per, to.per].includes("sps")))
    out.push(`P/E bars: ${PER_WORDS[from.per] ?? from.per} → ${PER_WORDS[to.per] ?? to.per}`);
  if ((from.sw ?? "q") !== (to.sw ?? "q")) out.push(`Sales: ${from.sw === "ttm" ? "TTM" : "Each quarter"} → ${to.sw === "ttm" ? "TTM" : "Each quarter"}`);
  const ov = (p: ChartPick) => [...p.overlays].sort().map((o) => VIEW_WORDS[o] ?? o).join(", ") || "None";
  if (ov(from) !== ov(to)) out.push(`Overlays: ${ov(from)} → ${ov(to)}`);
  if (growthWords(from) !== growthWords(to)) out.push(`Growth on bars: ${growthWords(from)} → ${growthWords(to)}`);
  const keys = [...new Set([...Object.keys(from.vis), ...Object.keys(to.vis)])].sort();
  for (const k of keys) {
    const a = from.vis[k] ?? defaultOn(k), b = to.vis[k] ?? defaultOn(k);
    if (a !== b) out.push(`${lineWords(k)}: ${a ? "Shown" : "Hidden"} → ${b ? "Shown" : "Hidden"}`);
  }
  return out;
}

const declinedKey = (by: ChartSide) => `rs_chart_pick_declined_${by}`;

/** Opening a chart after the OTHER chart changed the shared set-up: this one
 *  starts on its own last set-up and `offer` holds the other's, to be listed
 *  and applied only on a yes. A set-up already declined here is not offered
 *  again - only new changes are. A chart never changed here follows the
 *  other as before, without asking. */
export function carryOver(by: ChartSide, sameRange?: (x: string, y: string) => boolean): { start: Partial<ChartPick> | null; offer: ChartPick | null } {
  const shared = readPick();
  if (typeof window === "undefined" || !shared || !shared.by || shared.by === by) return { start: shared, offer: null };
  const own = readOwn(by);
  if (!own) return { start: shared, offer: null };
  const offer = fillPick(shared);
  try {
    if (localStorage.getItem(declinedKey(by)) === JSON.stringify(offer)) return { start: own, offer: null };
  } catch { /* private mode */ }
  return pickChanges(fillPick(own), offer, sameRange).length ? { start: own, offer } : { start: shared, offer: null };
}

/** "Keep this chart's": the other chart's set-up is not offered again. */
export function declineOffer(by: ChartSide, offer: ChartPick) {
  try { localStorage.setItem(declinedKey(by), JSON.stringify(offer)); } catch { /* private mode */ }
}

/** What a preset sets, in plain words, for the save sheet. */
export function describe(p: ChartPick): string[] {
  const out = [`View: ${p.view === "pe" && p.per === "sps" ? "P/S Ratio" : VIEW_WORDS[p.view] ?? p.view}`, `Range: ${p.range}`];
  if ((p.view === "pe" || p.view === "ps" || p.view === "ev") && p.win === "q1") out.push("Window: latest quarter x4");
  if (p.view === "sales") out.push(`Sales: ${p.sw === "ttm" ? "twelve months to each quarter (TTM)" : "each quarter"}`);
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
