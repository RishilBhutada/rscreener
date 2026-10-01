/** The small table: enough to search, name and price a company, nothing more.
 *
 *  Every page carrying the top nav used to download the full screener export -
 *  5.6 MB, fifty-odd fields for each of 4,746 companies - to run a search box
 *  over three of those fields. index.json holds six, as parallel arrays, and is
 *  20x smaller. Pages that genuinely need the full table (the screener, the
 *  sector drill-down) still fetch data.json; nothing else should.
 */

import { isRefreshLoad } from "@/components/TopNav";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export type LiteRow = {
  symbol: string;
  name: string;
  exchange?: string;
  price?: number;
  ret_1m?: number;
  mcap: number;
  pe?: number;
  roe?: number;
  roce?: number;
  div_yield?: number;
  /** An ETF - it has a page of its own, not a company page. */
  etf?: boolean;
  /** An MCX or NCDEX contract type - its page is the commodity page. */
  commodity?: boolean;
  /** A market index (Nifty 50, Sensex, India VIX) - its own page. */
  index?: boolean;
  /** The last session's change, close on close, in %. */
  ret_1d?: number;
};

export type LiteIndex = {
  rows: LiteRow[];
  /** The newest close anywhere in the file. */
  price_asof: string | null;
  /** The close MOST companies are actually on, and how many. */
  price_modal: string | null;
  price_modal_n: number;
  covered: number | null;
  generated_at: string | null;
};

let cache: LiteIndex | null = null;
const etfs = new Set<string>();
const commodities = new Set<string>();
const indices = new Set<string>();

/** Where a symbol's page is. ETFs left the company table on 27-Sep-2026 and
 *  have their own page; a portfolio, a watchlist or a search can hold either.
 *  Reads the loaded index, which every page listing symbols has asked for. */
export function symbolHref(symbol: string): string {
  const s = encodeURIComponent(symbol);
  if (commodities.has(symbol)) return `/commodity?s=${s}`;
  if (indices.has(symbol) || symbol.startsWith("^")) return `/indices/view?s=${s}`;
  return etfs.has(symbol) ? `/etf?s=${s}` : `/company?s=${s}`;
}
let inflight: Promise<LiteIndex> | null = null;

/** Fetched once per page load and shared - the nav search and the page body
 *  both want it, and two components asking must not mean two downloads. */
export function loadIndex(): Promise<LiteIndex> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  // On the load a refresh produced, go past the HTTP cache for the data too.
  // Reloading the shell around cached numbers is the same staleness wearing a
  // different coat, and it is the exact thing the refresh button exists to end.
  inflight = fetch(`${BASE}/index.json`, isRefreshLoad() ? { cache: "reload" } : undefined)
    .then((r) => {
      if (!r.ok) throw new Error("no index");
      return r.json();
    })
    .then((d) => {
      const rows: LiteRow[] = (d.rows as unknown[][]).map((r) => ({
        symbol: String(r[0]),
        name: String(r[1] ?? ""),
        exchange: (r[2] as string) ?? undefined,
        price: (r[3] as number) ?? undefined,
        ret_1m: (r[4] as number) ?? undefined,
        mcap: (r[5] as number) ?? 0,
        pe: (r[6] as number) ?? undefined,
        roe: (r[7] as number) ?? undefined,
        roce: (r[8] as number) ?? undefined,
        div_yield: (r[9] as number) ?? undefined,
        etf: r[10] === 1 ? true : undefined,
        commodity: r[10] === 2 ? true : undefined,
        index: r[10] === 3 ? true : undefined,
        ret_1d: (r[11] as number) ?? undefined,
      }));
      for (const r of rows) {
        if (r.etf) etfs.add(r.symbol);
        if (r.commodity) commodities.add(r.symbol);
        if (r.index) indices.add(r.symbol);
      }
      cache = {
        rows,
        price_asof: d.price_asof ?? null,
        price_modal: d.price_modal ?? null,
        price_modal_n: d.price_modal_n ?? 0,
        covered: d.covered ?? null,
        generated_at: d.generated_at ?? null,
      };
      return cache;
    })
    .finally(() => { inflight = null; });
  return inflight;
}
