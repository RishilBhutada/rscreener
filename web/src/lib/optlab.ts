/** The Options lab's backtest: buy a Nifty call and a put near one day's
 *  close, sell both the next trading day. Runs in the browser on optlab.json
 *  (pipeline/export_optlab_json.py), so every parameter can be changed.
 *
 *  RESEARCH ONLY. Nothing here places or prepares a trade; the owner's plan
 *  puts F&O after Phase-3 (owner, 15-Nov-2026). Pure functions, tested. */

/** [expiry, ATM strike, step, call close D, put close D, call open D+1,
 *   put open D+1, call close D+1, put close D+1] - arrays over ATM-span..ATM+span. */
export type OptExp = [string, number, number, (number | null)[], (number | null)[], (number | null)[], (number | null)[], (number | null)[], (number | null)[]];
/** [D, D+1, nifty close D, nifty open D+1, nifty close D+1, VIX close D, expiries] */
export type OptDay = [string, string, number | null, number | null, number | null, number | null, OptExp[]];
export type OptLab = { generated_at: string; lot: number; span: number; days: OptDay[] };

export type Params = {
  /** which expiry: the nearest that qualifies, or the one after it */
  expiry: "near" | "next";
  /** calendar days from the entry day to expiry, at least */
  minDte: number;
  /** strikes out of the money for each leg: 0 = both at the money (a straddle) */
  width: number;
  /** sell at the next day's first trade, or at its close */
  exit: "open" | "close";
  /** points lost to the bid-ask spread per option, each time it is traded */
  slip: number;
  /** rupees per order (four orders a night) */
  brokerage: number;
  lot: number;
  /** STT, exchange, SEBI, stamp duty and GST */
  charges: boolean;
  /** entry days: 1 = Monday .. 5 = Friday */
  weekdays: number[];
  vixMin: number | null;
  vixMax: number | null;
  from: string | null;
  to: string | null;
};

export const DEFAULTS: Params = {
  expiry: "near", minDte: 1, width: 0, exit: "open", slip: 0.5, brokerage: 20, lot: 65, charges: true,
  weekdays: [1, 2, 3, 4, 5], vixMin: null, vixMax: null, from: null, to: null,
};

export type Trade = {
  d0: string; d1: string; expiry: string; dte: number; wd: number; vix: number | null;
  callK: number; putK: number;
  /** premium paid for the pair, and what it sold for (index points, before costs) */
  paid: number; got: number;
  gross: number; costs: number; net: number;
  /** net as a percentage of the premium paid */
  pct: number;
  /** Nifty's move from the entry close to the exit, % (known only afterwards) */
  move: number | null;
};

const DAY = 86400000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** Every cost of one night, in index points per unit, at today's rates:
 *  spread on four trades; brokerage on four orders; STT 0.1% of the premium
 *  sold; exchange charge 0.03503% and SEBI 0.0001% of premium both ways;
 *  stamp duty 0.003% of the premium bought; GST 18% on brokerage, exchange
 *  and SEBI charges. (Rates as of late 2024 - earlier years were charged a
 *  little less STT.) */
export function costs(paid: number, got: number, p: Pick<Params, "slip" | "brokerage" | "lot" | "charges">): number {
  const buy = paid + 2 * p.slip, sell = Math.max(got - 2 * p.slip, 0);
  let c = 4 * p.slip;
  if (p.charges) {
    const brk = (4 * p.brokerage) / Math.max(p.lot, 1);
    const txn = 0.0003503 * (buy + sell), sebi = 0.000001 * (buy + sell);
    c += brk + 0.001 * sell + txn + sebi + 0.00003 * buy + 0.18 * (brk + txn + sebi);
  }
  return c;
}

export function run(lab: OptLab, p: Params): Trade[] {
  const out: Trade[] = [];
  const mid = lab.span;
  for (const [d0, d1, n0, n1o, n1c, vix, exps] of lab.days) {
    if (p.from && d0 < p.from) continue;
    if (p.to && d0 > p.to) continue;
    const wd = new Date(`${d0}T00:00:00Z`).getUTCDay();
    if (!p.weekdays.includes(wd)) continue;
    if (p.vixMin !== null && (vix === null || vix < p.vixMin)) continue;
    if (p.vixMax !== null && (vix === null || vix > p.vixMax)) continue;
    const ok = exps.filter((e) => days(d0, e[0]) >= p.minDte);
    const e = ok[p.expiry === "near" ? 0 : 1];
    if (!e) continue;
    const ci = mid + p.width, pi = mid - p.width;
    if (ci >= e[3].length || pi < 0) continue;
    const c0 = e[3][ci], p0 = e[4][pi];
    const c1 = (p.exit === "open" ? e[5] : e[7])[ci], p1 = (p.exit === "open" ? e[6] : e[8])[pi];
    // Both legs must have traded on both days, or there was no price to deal at.
    if (c0 === null || p0 === null || c1 === null || p1 === null) continue;
    const paid = c0 + p0, got = c1 + p1, gross = got - paid, cost = costs(paid, got, p), net = gross - cost;
    const n1 = p.exit === "open" ? n1o : n1c;
    out.push({
      d0, d1, expiry: e[0], dte: days(d0, e[0]), wd, vix, callK: e[1] + p.width * e[2], putK: e[1] - p.width * e[2],
      paid, got, gross, costs: cost, net, pct: paid > 0 ? (net / paid) * 100 : 0,
      move: n0 && n1 ? (n1 / n0 - 1) * 100 : null,
    });
  }
  return out;
}

export type Stats = {
  n: number; wins: number; winRate: number;
  /** per night, index points */
  avg: number; median: number; total: number; best: number; worst: number;
  avgPct: number; avgGross: number; avgCosts: number;
  /** the deepest fall of the running total from an earlier peak, points */
  maxDrawdown: number;
};

export function stats(ts: Trade[]): Stats | null {
  if (!ts.length) return null;
  const nets = ts.map((t) => t.net), sorted = [...nets].sort((a, b) => a - b), n = ts.length;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  let run = 0, peak = 0, dd = 0;
  for (const v of nets) { run += v; peak = Math.max(peak, run); dd = Math.max(dd, peak - run); }
  const wins = nets.filter((v) => v > 0).length;
  return {
    n, wins, winRate: (wins / n) * 100, avg: sum(nets) / n,
    median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    total: sum(nets), best: sorted[n - 1], worst: sorted[0],
    avgPct: sum(ts.map((t) => t.pct)) / n, avgGross: sum(ts.map((t) => t.gross)) / n, avgCosts: sum(ts.map((t) => t.costs)) / n,
    maxDrawdown: dd,
  };
}

export type GroupRow = { key: string; n: number; winRate: number; avg: number; total: number };

/** Trades grouped by `key`, in the order given by `order` (else first seen). */
export function group(ts: Trade[], key: (t: Trade) => string | null, order?: string[]): GroupRow[] {
  const m = new Map<string, Trade[]>();
  for (const t of ts) {
    const k = key(t);
    if (k === null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(t);
  }
  const keys = order ? order.filter((k) => m.has(k)) : [...m.keys()];
  return keys.map((k) => {
    const g = m.get(k)!, tot = g.reduce((a, t) => a + t.net, 0);
    return { key: k, n: g.length, winRate: (g.filter((t) => t.net > 0).length / g.length) * 100, avg: tot / g.length, total: tot };
  });
}

export const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
export const VIX_BANDS = ["Under 12", "12-15", "15-20", "20-25", "25+"];
export const vixBand = (v: number | null) => (v === null ? null : v < 12 ? VIX_BANDS[0] : v < 15 ? VIX_BANDS[1] : v < 20 ? VIX_BANDS[2] : v < 25 ? VIX_BANDS[3] : VIX_BANDS[4]);
export const DTE_BANDS = ["1-2 days", "3-7 days", "8-14 days", "15+ days"];
export const dteBand = (d: number) => (d <= 2 ? DTE_BANDS[0] : d <= 7 ? DTE_BANDS[1] : d <= 14 ? DTE_BANDS[2] : DTE_BANDS[3]);
export const MOVE_BANDS = ["Under 0.25%", "0.25-0.5%", "0.5-1%", "1%+"];
export const moveBand = (m: number | null) => {
  if (m === null) return null;
  const a = Math.abs(m);
  return a < 0.25 ? MOVE_BANDS[0] : a < 0.5 ? MOVE_BANDS[1] : a < 1 ? MOVE_BANDS[2] : MOVE_BANDS[3];
};
