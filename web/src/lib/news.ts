/** The News page and each stock's Institutions card (pipeline/export_news_json.py). */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export type NewsItem = { t: string; title: string; url: string; src: string; syms: string[] };
export type Bucket = "Buy" | "Hold" | "Sell" | null;
export type Call = { t: string; broker: string; sym?: string; rating: string | null; bucket: Bucket; target: number | null; url: string; title: string };
export type Deal = { d: string; sym?: string; name?: string; client: string; side: string; qty: number; price: number; kind: string; cr: number };
export type Sast = { t: string | null; sym?: string; company?: string; acquirer: string; side: string; shares: number | null; after: number | null; promoter: boolean; period: string; doc: string | null };

export type NewsDoc = { generated_at: string | null; fetched?: string | null; items: NewsItem[]; calls: Call[]; deals: Deal[]; sast: Sast[] };
export type InstDoc = { calls: Call[]; deals: Deal[]; sast: Sast[]; news: Omit<NewsItem, "syms">[] };

export async function loadNews(): Promise<NewsDoc> {
  const r = await fetch(`${BASE}/news.json`, { cache: "no-cache" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** null when the company has nothing - no calls, deals, filings or headlines. */
export async function loadInst(symbol: string): Promise<InstDoc | null> {
  const r = await fetch(`${BASE}/inst/${encodeURIComponent(symbol)}.json`, { cache: "no-cache" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** The latest call per broker within `days`, and how many say what. */
export function tally(calls: Call[], days = 180): { latest: Call[]; buy: number; hold: number; sell: number } {
  const cut = Date.now() - days * 864e5;
  const by = new Map<string, Call>();
  for (const c of calls) {
    if (new Date(c.t).getTime() < cut || !c.bucket) continue;
    if (!by.has(c.broker)) by.set(c.broker, c);   // newest first
  }
  const latest = [...by.values()];
  return {
    latest,
    buy: latest.filter((c) => c.bucket === "Buy").length,
    hold: latest.filter((c) => c.bucket === "Hold").length,
    sell: latest.filter((c) => c.bucket === "Sell").length,
  };
}

export const COMMODITY_WORDS = /\b(gold|silver|crude|brent|copper|natural gas|mcx|bullion|zinc|aluminium|nickel)\b/i;

export const inr = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const qtyShort = (q: number) => q >= 1e7 ? `${(q / 1e7).toFixed(2)} Cr` : q >= 1e5 ? `${(q / 1e5).toFixed(1)} L` : q.toLocaleString("en-IN");

/** "25m ago", "3h ago", "2d ago" - minutes count on a page refreshed every twenty. */
export function since(t: string | null | undefined, now: number): string {
  if (!t || !now) return "";
  const m = Math.max(0, Math.round((now - new Date(t).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}
