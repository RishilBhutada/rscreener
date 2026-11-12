/** Heatmaps: where each tile goes, and how strongly it is coloured.
 *
 *  Pure - no React, no DOM - so the layout can be tested on its own.
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type Placed<T> = Rect & { item: T };

/** A squarified treemap (Bruls, Huizing and van Wijk, 2000): each item gets a
 *  rectangle whose AREA is its share of the total, laid out in strips along
 *  the shorter side so the tiles stay as close to square as they can - a long
 *  thin sliver can hold neither a name nor a finger.
 *
 *  Items with no size, or a size that is not a positive number, are left out:
 *  a company without a market cap has no area to draw. Largest first, from the
 *  top-left corner.
 */
export function squarify<T>(items: T[], size: (t: T) => number | null | undefined, box: Rect): Placed<T>[] {
  const xs = items
    .map((item) => ({ item, v: Number(size(item)) }))
    .filter((o) => Number.isFinite(o.v) && o.v > 0)
    .sort((a, b) => b.v - a.v);
  const total = xs.reduce((s, o) => s + o.v, 0);
  const out: Placed<T>[] = [];
  if (!total || !(box.w > 0) || !(box.h > 0)) return out;
  const k = (box.w * box.h) / total;   // area for one unit of size
  let { x, y, w, h } = box;
  let i = 0;
  while (i < xs.length) {
    const side = Math.min(w, h);
    // Add tiles to this strip while its worst aspect ratio keeps improving.
    // Sorted largest first, so the strip's biggest tile is its first and its
    // smallest is the one just added.
    const big = xs[i].v * k;
    let j = i, sum = 0, best = Infinity;
    while (j < xs.length) {
      const s2 = sum + xs[j].v * k;
      const worst = Math.max((side * side * big) / (s2 * s2), (s2 * s2) / (side * side * xs[j].v * k));
      if (worst > best) break;
      best = worst; sum = s2; j++;
    }
    const thick = sum / side;
    let off = 0;
    for (let n = i; n < j; n++) {
      const len = (xs[n].v * k) / thick;
      out.push(w >= h
        ? { item: xs[n].item, x, y: y + off, w: thick, h: len }     // a column down the left edge
        : { item: xs[n].item, x: x + off, y, w: len, h: thick });   // a row along the top edge
      off += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    i = j;
  }
  return out;
}

/** The move at which a tile reaches its full colour, by period: a 3% day is
 *  as strong as days get for an index; a year needs 40%. Fixed, not scaled to
 *  the day's range - on a quiet day the map should LOOK quiet. */
export const HEAT_FULL = { d1: 3, w1: 6, m1: 10, y1: 40 } as const;
export type HeatPeriod = keyof typeof HEAT_FULL;

/** 0 to 1: how far a move is toward full colour. */
export function heatLevel(v: number | null | undefined, full: number): number {
  if (v === null || v === undefined || !Number.isFinite(v) || !(full > 0)) return 0;
  return Math.min(Math.abs(v) / full, 1);
}

/** A tile's background. Green for a rise, red for a fall, mixed into the card
 *  grey from 12% to 52% - the top is held there so the page's own ink stays
 *  readable on it in both themes. No figure, or no move: the plain grey. */
export function heatColor(v: number | null | undefined, full: number): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "var(--card2)";
  const pct = Math.round(12 + 40 * heatLevel(v, full));
  return `color-mix(in srgb, var(${v > 0 ? "--pos" : "--neg"}) ${pct}%, var(--card2))`;
}

/** The value most of a list shares - a region's close date, say. Ties go to
 *  the later value. Null for an empty list. */
export function modal(values: (string | null | undefined)[]): string | null {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  let best: string | null = null, top = 0;
  for (const [v, c] of n) if (c > top || (c === top && best !== null && v > best)) { best = v; top = c; }
  return best;
}
