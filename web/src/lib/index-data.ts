/** The small table: enough to search, name and price a company, nothing more.
 *
 *  Every page carrying the top nav used to download the full screener export -
 *  5.6 MB, fifty-odd fields for each of 4,746 companies - to run a search box
 *  over three of those fields. index.json holds six, as parallel arrays, and is
 *  20x smaller. Pages that genuinely need the full table (the screener, the
 *  sector drill-down) still fetch data.json; nothing else should.
 */

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
};

export type LiteIndex = {
  rows: LiteRow[];
  price_asof: string | null;
  covered: number | null;
  generated_at: string | null;
};

let cache: LiteIndex | null = null;
let inflight: Promise<LiteIndex> | null = null;

/** Fetched once per page load and shared - the nav search and the page body
 *  both want it, and two components asking must not mean two downloads. */
export function loadIndex(): Promise<LiteIndex> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch(`${BASE}/index.json`)
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
      }));
      cache = {
        rows,
        price_asof: d.price_asof ?? null,
        covered: d.covered ?? null,
        generated_at: d.generated_at ?? null,
      };
      return cache;
    })
    .finally(() => { inflight = null; });
  return inflight;
}
