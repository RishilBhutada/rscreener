/** Support, resistance, trend lines and volume shelves, worked out from the
 *  bars on screen - the owner picked all three from a preview on 30-Sep-2026.
 *
 *  They describe where the price turned before. They do not say where it will
 *  turn next, and they move with the sensitivity: that is why the sensitivity
 *  is a visible control rather than a hidden constant.
 *
 *  - Turning points: a high no bar within `k` either side beats (a low
 *    likewise). A turn needs `k` bars after it, so the newest bars have none.
 *  - Zones: turning points grouped when they sit within 0.6 of a typical day's
 *    range (ATR) of each other; a zone needs two turns. The three nearest
 *    below the last close are support, the three nearest above resistance.
 *  - Trend lines: every line through two turning points, kept if price has
 *    not closed through it by more than a quarter-ATR (once is forgiven),
 *    touched at least three times, and on the right side of today's price.
 *    The most-touched wins; ties go to the more recent.
 *  - Volume shelves: each bar's volume spread evenly over its high-low range,
 *    in bins across the window; the three tallest local peaks are marked. */

export type LBar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type Sens = "low" | "med" | "high";
export const SENS: [Sens, string, number][] = [["low", "Low", 10], ["med", "Medium", 5], ["high", "High", 3]];

export type Zone = { lo: number; hi: number; turns: number; lastDay: number; side: "sup" | "res" | "in" };
export type TrendLine = { kind: "up" | "down"; d0: number; v0: number; d1: number; v1: number; touches: number };
export type Shelf = { lo: number; hi: number; v: number; peak: boolean };
export type Levels = { zones: Zone[]; trends: TrendLine[]; shelves: Shelf[]; last: number };

function atr(b: LBar[]): number {
  let s = 0, n = 0;
  for (let i = Math.max(1, b.length - 100); i < b.length; i++) {
    s += Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
    n++;
  }
  return n ? s / n : 0;
}

function turns(b: LBar[], k: number): { H: number[]; L: number[] } {
  const H: number[] = [], L: number[] = [];
  for (let i = k; i < b.length - k; i++) {
    let hi = true, lo = true;
    for (let j = i - k; j <= i + k && (hi || lo); j++) {
      if (j === i) continue;
      if (b[j].h > b[i].h || (b[j].h === b[i].h && j < i)) hi = false;
      if (b[j].l < b[i].l || (b[j].l === b[i].l && j < i)) lo = false;
    }
    if (hi) H.push(i);
    if (lo) L.push(i);
  }
  return { H, L };
}

function zonesOf(b: LBar[], tp: { H: number[]; L: number[] }, a: number, last: number): Zone[] {
  const pts = [...tp.H.map((i) => ({ p: b[i].h, i })), ...tp.L.map((i) => ({ p: b[i].l, i }))].sort((x, y) => x.p - y.p);
  const groups: { lo: number; hi: number; n: number; li: number }[] = [];
  let cur: (typeof groups)[number] | null = null;
  for (const q of pts) {
    if (cur && q.p - cur.hi <= 0.6 * a && q.p - cur.lo <= 1.2 * a) {
      cur.hi = q.p; cur.n++; cur.li = Math.max(cur.li, q.i);
    } else {
      cur = { lo: q.p, hi: q.p, n: 1, li: q.i };
      groups.push(cur);
    }
  }
  const all = groups.filter((g) => g.n >= 2).map((g) => {
    let { lo, hi } = g;
    if (hi - lo < 0.3 * a) { const m = (hi + lo) / 2; lo = m - 0.15 * a; hi = m + 0.15 * a; }
    const side: Zone["side"] = hi < last ? "sup" : lo > last ? "res" : "in";
    return { lo, hi, turns: g.n, lastDay: b[g.li].t, side };
  });
  const sup = all.filter((z) => z.side === "sup").sort((x, y) => y.hi - x.hi).slice(0, 3);
  const res = all.filter((z) => z.side === "res").sort((x, y) => x.lo - y.lo).slice(0, 3);
  return [...sup, ...res, ...all.filter((z) => z.side === "in")];
}

function trendOf(b: LBar[], tp: { H: number[]; L: number[] }, a: number, kind: "up" | "down"): TrendLine | null {
  const n = b.length, idx = kind === "up" ? tp.L : tp.H;
  const val = (i: number) => (kind === "up" ? b[i].l : b[i].h);
  let best: (TrendLine & { score: number }) | null = null;
  for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) {
    const i = idx[x], j = idx[y];
    if (j - i < 8 || j < n * 0.45) continue;
    const vi = val(i), vj = val(j);
    if (kind === "up" ? vj <= vi : vj >= vi) continue;
    const m = (vj - vi) / (j - i);
    let bad = 0;
    for (let t = i; t < n && bad <= 1; t++) {
      const at = vi + m * (t - i);
      if (kind === "up" ? b[t].c < at - 0.25 * a : b[t].c > at + 0.25 * a) bad++;
    }
    if (bad > 1) continue;
    let touches = 0;
    for (const t of idx) if (t >= i && Math.abs(val(t) - (vi + m * (t - i))) <= 0.35 * a) touches++;
    const end = vi + m * (n - 1 - i);
    if (kind === "up" ? end > b[n - 1].c : end < b[n - 1].c) continue;
    const score = touches * 3 + j / n;
    if (touches >= 3 && (!best || score > best.score)) {
      best = { kind, d0: b[i].t, v0: vi, d1: b[n - 1].t, v1: end, touches, score };
    }
  }
  if (!best) return null;
  const { score: _score, ...line } = best;
  void _score;
  return line;
}

function shelvesOf(b: LBar[], bins = 48): Shelf[] {
  let lo = Infinity, hi = -Infinity;
  for (const x of b) { lo = Math.min(lo, x.l); hi = Math.max(hi, x.h); }
  if (!(hi > lo)) return [];
  const w = (hi - lo) / bins, v = new Array<number>(bins).fill(0);
  for (const x of b) {
    const a = Math.max(0, Math.floor((x.l - lo) / w)), z = Math.min(bins - 1, Math.floor((x.h - lo) / w));
    for (let k = a; k <= z; k++) v[k] += x.v / (z - a + 1);
  }
  const peaks: number[] = [];
  for (let k = 1; k < bins - 1; k++) if (v[k] > 0 && v[k] >= v[k - 1] && v[k] >= v[k + 1]) peaks.push(k);
  const top = new Set(peaks.sort((p, q) => v[q] - v[p]).slice(0, 3));
  return v.map((x, k) => ({ lo: lo + k * w, hi: lo + (k + 1) * w, v: x, peak: top.has(k) }));
}

export function levelsOf(b: LBar[], sens: Sens): Levels | null {
  if (b.length < 30) return null;
  const k = SENS.find(([s]) => s === sens)?.[2] ?? 5;
  const a = atr(b), tp = turns(b, k), last = b[b.length - 1].c;
  if (!(a > 0)) return null;
  return {
    zones: zonesOf(b, tp, a, last),
    trends: [trendOf(b, tp, a, "up"), trendOf(b, tp, a, "down")].filter((t): t is TrendLine => t !== null),
    shelves: b.some((x) => x.v > 0) ? shelvesOf(b) : [],
    last,
  };
}
