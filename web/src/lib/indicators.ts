/** Price indicators shared by the company chart and the full chart, so the
 *  two views compute the same lines (owner, 16-Nov-2026: every addition to a
 *  chart applies to both). Each returns one value per input, null until its
 *  window is full. */

export function sma(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

export function ema(v: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (n + 1);
  let prev: number | null = null;
  for (let i = 0; i < v.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    if (prev === null) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += v[j];
      prev = s / n;
    } else prev = v[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function bollinger(v: number[], n = 20, width = 2) {
  const mid = sma(v, n);
  const up: (number | null)[] = [], lo: (number | null)[] = [];
  for (let i = 0; i < v.length; i++) {
    const m = mid[i];
    if (m === null) { up.push(null); lo.push(null); continue; }
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j] - m) ** 2;
    const sd = Math.sqrt(s / n);
    up.push(m + width * sd); lo.push(m - width * sd);
  }
  return { mid, up, lo };
}

/** Wilder's RSI - the smoothing every charting platform means by "RSI 14". */
export function rsi(v: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) {
      g += up; l += dn;
      if (i < n) { out.push(null); continue; }
      g /= n; l /= n;
    } else {
      g = (g * (n - 1) + up) / n;
      l = (l * (n - 1) + dn) / n;
    }
    out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
  }
  return out;
}

/** The indicator colours, the same in both charts. */
export const IND_COLOUR = {
  sma20: "#3b82f6", ema21: "#14b8a6", rsi: "#a855f7", mvix: "#f59e0b", mfii: "#22c55e", mpcr: "#ec4899",
  rbi: "#f59e0b", budget: "#ec4899",
} as const;
