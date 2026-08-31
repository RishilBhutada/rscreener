/** Reader-chosen order for the bottom nav and the company-page sections.
 *
 *  Stored as a list of ids rather than a list of positions, because both lists
 *  change: sections are added, and a company that files no cash-flow statement
 *  has fewer of them than one that does. A saved order must therefore survive
 *  ids it has never seen and ids that have gone away, and it must never be the
 *  thing that decides WHETHER an item appears - only where it sits.
 *
 *  So `applyOrder` is a sort, not a filter: anything saved but absent is
 *  dropped, anything present but unsaved keeps its position relative to the
 *  items around it by falling to the end in its original order. Reordering
 *  four items cannot make a fifth disappear.
 */

const KEYS = {
  nav: "rs_nav_order",
  sections: "rs_section_order",
} as const;

export type OrderKind = keyof typeof KEYS;

export function loadOrder(kind: OrderKind): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEYS[kind]);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];   // a corrupt value is the default order, never an error
  }
}

export function saveOrder(kind: OrderKind, ids: string[]) {
  try {
    localStorage.setItem(KEYS[kind], JSON.stringify(ids));
  } catch { /* private mode: the order simply does not persist */ }
  window.dispatchEvent(new CustomEvent("rs-order", { detail: kind }));
}

export function clearOrder(kind: OrderKind) {
  try {
    localStorage.removeItem(KEYS[kind]);
  } catch { /* nothing to clear */ }
  window.dispatchEvent(new CustomEvent("rs-order", { detail: kind }));
}

/** Sort `items` by the saved order. Items the order does not mention keep
 *  their original sequence and follow the ones it does. */
export function applyOrder<T>(items: T[], idOf: (item: T) => string, order: string[]): T[] {
  if (order.length === 0) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, i, r: rank.get(idOf(item)) }))
    .sort((a, b) => {
      if (a.r === undefined && b.r === undefined) return a.i - b.i;
      if (a.r === undefined) return 1;
      if (b.r === undefined) return -1;
      return a.r - b.r;
    })
    .map((x) => x.item);
}

/** Move one id up or down within a list, returning the new order. */
export function move(ids: string[], id: string, by: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
