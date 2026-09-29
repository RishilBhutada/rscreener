/** Shared by the commodities list and a commodity's page: the file shapes and
 *  how prices, expiries and premiums are written, so the two never disagree. */

export type CommodityListItem = {
  s: string; name: string; group: string; quoted: string; family: string;
  expiry: string; date: string; close: number; chg: number | null;
  next_prem: number | null; carry_pa: number | null; world_prem: number | null;
  oi: number; vol: number; n: number;
};

export type WorldQuote = { ticker: string; usd: number; fx: number; inr: number; prem: number };

export type CurveRow = {
  key: string; expiry: string; days: number; date: string; fresh: boolean; expiring: boolean;
  open: number; high: number; low: number; close: number; chg: number | null;
  vol: number; oi: number; oi_chg: number | null; value: number;
  prem_front?: number | null; carry_pa?: number | null; world?: WorldQuote;
};

/** day, open, high, low, close, volume, open interest, world price in MCX rupees */
export type Bar = [number, number, number, number, number, number, number, number | null];

export type CommodityDoc = {
  s: string; name: string; group: string; quoted: string; family: string; exchange: string;
  asof: string; mult: number; tick: number; active: string; front: string | null;
  world: { label: string; unit: string; front: string } | null;
  curve: CurveRow[];
  world_curve: { expiry: string; usd: number; prem_first: number }[];
  hist: Record<string, Bar[]>;
  /** day, next over nearest %, the same a year */
  spread: [number, number, number | null][];
  untraded: number;
};

export const GROUP_ORDER = ["Bullion", "Energy", "Base metals", "Agri", "Indices", "Other"];

export function rupees(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v >= 1000 ? 0 : digits })}`;
}

/** ₹14.9 L, ₹2.3 Cr - a contract's worth, at a glance. */
export function rupeesShort(v: number): string {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

export function signed(v: number | null | undefined, digits = 1, unit = "%"): string {
  if (v === null || v === undefined) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`;
}

export function signClass(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return "text-[var(--ink3)]";
  return v > 0 ? "text-[var(--pos)]" : "text-[var(--neg)]";
}

/** "Dec 26" - an expiry as traders say it; the day is on the row. */
export function expiryLabel(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  return `${t.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })} ${String(t.getUTCFullYear()).slice(2)}`;
}

export function dayLabel(d: string | null | undefined, year = false): string {
  if (!d) return "—";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC",
  });
}
