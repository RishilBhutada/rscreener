/** The company page's statement tables, as the reader has set them up: the "%"
 *  switch of each table and the order of its rows.
 *
 *  Both are kept per KIND of table (quarterly results, P&L, ...), not per page,
 *  so a choice made on one company's balance sheet holds on every company's.
 *  A row order can also be kept for one company alone. Both keys are in
 *  SYNCED_KEYS (lib/sync.ts), so signed in they follow the reader. */
import { useEffect, useState } from "react";

export type TableKind = "quarterly" | "pnl" | "balance" | "cash" | "shareholding";

const PCT_KEY = "rs_pct_tables";
const ORDER_KEY = "rs_row_order";
const EVENT = "rs-table-prefs";

function read(key: string): Record<string, unknown> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

function write(key: string, v: Record<string, unknown>) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* not remembered, still applied */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Re-read when any table, or Settings, changes a preference. */
function useVersion(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const bump = () => setN((x) => x + 1);
    const other = (e: StorageEvent) => { if (e.key === PCT_KEY || e.key === ORDER_KEY) bump(); };
    window.addEventListener(EVENT, bump);
    window.addEventListener("storage", other);
    bump();
    return () => { window.removeEventListener(EVENT, bump); window.removeEventListener("storage", other); };
  }, []);
  return n;
}

/** The table's "%" switch: on unless the reader turned it off for this kind. */
export function usePct(kind: TableKind): [boolean, (on: boolean) => void] {
  const v = useVersion();
  const [on, setOn] = useState(true);
  useEffect(() => { setOn(read(PCT_KEY)[kind] !== false); }, [kind, v]);
  return [on, (next: boolean) => { const all = read(PCT_KEY); all[kind] = next; write(PCT_KEY, all); }];
}

const ids = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;

/** The saved row order for this table: this company's own if it has one,
 *  else the one for every company, else none. */
export function useRowOrder(kind: TableKind, symbol: string) {
  const v = useVersion();
  const [state, setState] = useState<{ order: string[] | null; scope: "company" | "all" | null }>({ order: null, scope: null });
  useEffect(() => {
    const all = read(ORDER_KEY);
    const mine = ids(all[`${kind}:${symbol}`]), every = ids(all[kind]);
    setState(mine ? { order: mine, scope: "company" } : every ? { order: every, scope: "all" } : { order: null, scope: null });
  }, [kind, symbol, v]);
  const save = (order: string[], scope: "company" | "all") => {
    const all = read(ORDER_KEY);
    if (scope === "all") { all[kind] = order; delete all[`${kind}:${symbol}`]; }
    else all[`${kind}:${symbol}`] = order;
    write(ORDER_KEY, all);
  };
  return { ...state, save };
}

/** Kinds that have a saved order (for Settings), and clearing them all. */
export function customOrders(): string[] { return Object.keys(read(ORDER_KEY)); }
export function clearOrders() { write(ORDER_KEY, {}); }

/** `labels` in the saved order. Rows the order names are rearranged among the
 *  places such rows hold; rows it does not name - a bank's lines on a
 *  manufacturer's order, say - keep their own place instead of falling to the
 *  bottom. */
export function arrange(labels: string[], order: string[] | null): string[] {
  if (!order?.length) return labels;
  const rank = new Map(order.map((id, i) => [id, i]));
  const known = labels.filter((l) => rank.has(l)).sort((a, b) => rank.get(a)! - rank.get(b)!);
  let k = 0;
  return labels.map((l) => (rank.has(l) ? known[k++] : l));
}

/** The change from `prev` to `cur`: percent, or percentage points for a row
 *  that is itself a percentage (a margin going 20% -> 22% is +2 pts; "+10%"
 *  would read as if it had grown by a tenth). Null when there is no base. */
export function change(cur: number | null | undefined, prev: number | null | undefined, points: boolean): number | null {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (points) return cur - prev;
  if (prev === 0) return null;
  // Against the size of the base, so a loss that narrows reads as a rise.
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export function changeText(v: number, points: boolean, cur?: number | null, prev?: number | null): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (points) return `${sign}${a.toLocaleString("en-IN", { maximumFractionDigits: 1 })} pts`;
  // Both positive and more than ten times the base: say how many times.
  if (a >= 1000 && cur && prev && cur > 0 && prev > 0) return `${Math.round(cur / prev)}×`;
  if (a >= 1000) return `${sign}999%+`;
  return `${sign}${a.toLocaleString("en-IN", { maximumFractionDigits: a >= 100 ? 0 : 1 })}%`;
}
