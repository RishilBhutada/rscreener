/** The Lab's backtest: any mix of bought and sold calls, puts and futures on
 *  one instrument, entered and left on daily prices. Runs in the browser on
 *  lab/<SYMBOL>.json and lab/index.json (pipeline/export_lab_json.py), so
 *  every setting can be changed.
 *
 *  RESEARCH ONLY. Nothing here places or prepares a trade; the owner's plan
 *  puts F&O after Phase-3 (owner, 15/16-Nov-2026). Pure functions, tested. */

/** [expiry, lowest strike, step, call open[], call close[], put open[], put close[]] */
export type Exp = [string, number, number, (number | null)[], (number | null)[], (number | null)[], (number | null)[]];
/** [date, underlying close, futures [expiry, open, close][], put/call OI ratio, expiries] */
export type Day = [string, number | null, [string, number | null, number | null][], number | null, Exp[]];
export type Chain = { sym: string; lot: number; index: boolean; days: Day[] };
/** Market-wide facts per date: [India VIX close, VIX % change that day, FII
 *  index-futures long %, S&P 500 % change in the US session that ended before
 *  this Indian day opened, event letters ("R" RBI policy, "B" Budget)] */
export type Market = Record<string, [number | null, number | null, number | null, number | null, string]>;

export type Leg = { side: 1 | -1; kind: "C" | "P" | "F"; /** strikes above (+) or below (-) at-the-money */ off: number; /** 0 nearest expiry, 1 the next */ exp: number };
export type Hold = "overnight" | "intraday" | "days" | "expiry";
type Tri = "any" | "only" | "skip";
type Dir = "any" | "up" | "down";

export type Params = {
  legs: Leg[];
  /** overnight: close -> next open. intraday: open -> close. days: close -> close N days on. expiry: close -> settlement. */
  hold: Hold;
  days: number;
  /** calendar days from entry to the nearest expiry used, at least */
  minDte: number;
  slip: number; brokerage: number; lot: number; charges: boolean;
  weekdays: number[];
  vixMin: number | null; vixMax: number | null; vixDir: Dir;
  /** the entry day is an expiry day of this instrument */
  expiryDay: Tri;
  /** an RBI policy or Budget day falls inside the holding period */
  event: Tri;
  /** underlying against its own 200-day average on the entry day */
  trend: "any" | "above" | "below";
  /** the US market's last finished session before entry */
  usDir: Dir;
  pcrMin: number | null; pcrMax: number | null;
  fiiMin: number | null; fiiMax: number | null;
  from: string | null; to: string | null;
};

export const PRESETS: [string, Leg[]][] = [
  ["Long straddle", [{ side: 1, kind: "C", off: 0, exp: 0 }, { side: 1, kind: "P", off: 0, exp: 0 }]],
  ["Short straddle", [{ side: -1, kind: "C", off: 0, exp: 0 }, { side: -1, kind: "P", off: 0, exp: 0 }]],
  ["Long strangle", [{ side: 1, kind: "C", off: 2, exp: 0 }, { side: 1, kind: "P", off: -2, exp: 0 }]],
  ["Short strangle", [{ side: -1, kind: "C", off: 2, exp: 0 }, { side: -1, kind: "P", off: -2, exp: 0 }]],
  ["Bull call spread", [{ side: 1, kind: "C", off: 0, exp: 0 }, { side: -1, kind: "C", off: 2, exp: 0 }]],
  ["Bear put spread", [{ side: 1, kind: "P", off: 0, exp: 0 }, { side: -1, kind: "P", off: -2, exp: 0 }]],
  ["Iron condor", [{ side: -1, kind: "C", off: 2, exp: 0 }, { side: 1, kind: "C", off: 4, exp: 0 }, { side: -1, kind: "P", off: -2, exp: 0 }, { side: 1, kind: "P", off: -4, exp: 0 }]],
  ["Iron butterfly", [{ side: -1, kind: "C", off: 0, exp: 0 }, { side: -1, kind: "P", off: 0, exp: 0 }, { side: 1, kind: "C", off: 4, exp: 0 }, { side: 1, kind: "P", off: -4, exp: 0 }]],
  ["Buy call", [{ side: 1, kind: "C", off: 0, exp: 0 }]],
  ["Buy put", [{ side: 1, kind: "P", off: 0, exp: 0 }]],
  ["Long future", [{ side: 1, kind: "F", off: 0, exp: 0 }]],
  ["Short future", [{ side: -1, kind: "F", off: 0, exp: 0 }]],
];

export const DEFAULTS: Params = {
  legs: PRESETS[0][1], hold: "overnight", days: 1, minDte: 1, slip: 0.5, brokerage: 20, lot: 65, charges: true,
  weekdays: [1, 2, 3, 4, 5], vixMin: null, vixMax: null, vixDir: "any", expiryDay: "any", event: "any", trend: "any", usDir: "any",
  pcrMin: null, pcrMax: null, fiiMin: null, fiiMax: null, from: null, to: null,
};

export type Trade = {
  d0: string; d1: string; dte: number; wd: number;
  vix: number | null; pcr: number | null; fii: number | null; us: number | null;
  above200: boolean | null; onExpiry: boolean; event: boolean;
  /** net premium paid (+) or received (-), index points */
  paid: number;
  gross: number; costs: number; net: number;
  /** the underlying's move from entry to exit, % (known only afterwards) */
  move: number | null;
};

const DAYMS = 86400000;
const gap = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAYMS);
const mid = (e: Exp) => (e[3].length - 1) / 2;
/** A strike's place in an expiry's grid, or -1 when it is outside it. */
const at = (e: Exp, k: number) => { const i = Math.round((k - e[1]) / e[2]); return i >= 0 && i < e[3].length && Math.abs(e[1] + i * e[2] - k) < 1e-6 ? i : -1; };

/** What one leg cost to trade, in points per unit, at today's rates.
 *  Options: STT 0.1% of premium sold (0.125% of the settlement value of a
 *  bought option left to expire in the money), exchange 0.03503%, SEBI
 *  0.0001%, stamp 0.003% of premium bought. Futures: STT 0.02% of value
 *  sold, exchange 0.00173%, stamp 0.002% of value bought. Brokerage per
 *  order and GST 18% on brokerage, exchange and SEBI charges. A leg left to
 *  expire has one order and no spread on the way out. */
export function legCost(leg: Leg, entry: number, exit: number, settled: boolean, p: Pick<Params, "slip" | "brokerage" | "lot" | "charges">): number {
  const orders = settled ? 1 : 2;
  let c = orders * p.slip;
  if (!p.charges) return c;
  const buy = leg.side === 1 ? entry : exit, sell = leg.side === 1 ? exit : entry;
  const brk = (orders * p.brokerage) / Math.max(p.lot, 1);
  const traded = settled ? entry : entry + exit;
  if (leg.kind === "F") {
    const txn = 0.0000173 * traded, sebi = 0.000001 * traded;
    c += brk + 0.0002 * sell + txn + sebi + 0.00002 * buy + 0.18 * (brk + txn + sebi);
  } else {
    const txn = 0.0003503 * traded, sebi = 0.000001 * traded;
    const stt = settled ? (leg.side === 1 ? 0.00125 * exit : 0.001 * entry) : 0.001 * sell;
    c += brk + stt + txn + sebi + 0.00003 * (settled && leg.side === -1 ? 0 : buy) + 0.18 * (brk + txn + sebi);
  }
  return c;
}

export function run(chain: Chain, market: Market, p: Params): Trade[] {
  const D = chain.days, out: Trade[] = [];
  const idx = new Map(D.map((d, i) => [d[0], i]));
  // The underlying each day: the stated close, else the nearest future's.
  const und = D.map((d) => d[1] ?? d[2][0]?.[2] ?? null);
  const avg200: (number | null)[] = [];
  { let s = 0, n = 0; const q: number[] = [];
    for (const u of und) { if (u !== null) { q.push(u); s += u; n++; if (q.length > 200) { s -= q.shift()!; n--; } } avg200.push(n === 200 ? s / 200 : null); } }
  const expiries = new Set(D.flatMap((d) => d[4].map((e) => e[0])));

  for (let i = 0; i < D.length; i++) {
    const [d0, , , pcr] = D[i];
    if (p.from && d0 < p.from) continue;
    if (p.to && d0 > p.to) continue;
    const wd = new Date(`${d0}T00:00:00Z`).getUTCDay();
    if (!p.weekdays.includes(wd)) continue;
    const mk = market[d0] ?? [null, null, null, null, ""];
    const [vix, vixChg, fii, us] = mk;
    if (p.vixMin !== null && (vix === null || vix < p.vixMin)) continue;
    if (p.vixMax !== null && (vix === null || vix > p.vixMax)) continue;
    if (p.vixDir !== "any" && (vixChg === null || (p.vixDir === "up") !== (vixChg > 0))) continue;
    if (p.usDir !== "any" && (us === null || (p.usDir === "up") !== (us > 0))) continue;
    if (p.pcrMin !== null && (pcr === null || pcr < p.pcrMin)) continue;
    if (p.pcrMax !== null && (pcr === null || pcr > p.pcrMax)) continue;
    if (p.fiiMin !== null && (fii === null || fii < p.fiiMin)) continue;
    if (p.fiiMax !== null && (fii === null || fii > p.fiiMax)) continue;
    const onExpiry = expiries.has(d0);
    if (p.expiryDay === "only" ? !onExpiry : p.expiryDay === "skip" && onExpiry) continue;
    const above200 = und[i] !== null && avg200[i] !== null ? und[i]! > avg200[i]! : null;
    if (p.trend !== "any" && (above200 === null || (p.trend === "above") !== above200)) continue;

    // Intraday enters at the open, so at-the-money is yesterday's: today's is
    // worked out from today's closes, which nobody knew at the open.
    const ref = p.hold === "intraday" ? D[i - 1] : D[i];
    if (!ref) continue;
    const live = ref[4].filter((e) => gap(d0, e[0]) >= (p.hold === "intraday" ? 0 : p.minDte));
    const liveF = D[i][2].filter((f) => gap(d0, f[0]) >= (p.hold === "intraday" ? 0 : p.minDte));
    let gross = 0, cost = 0, paid = 0, ok = true, d1 = "", dte = 0;
    const legs: { leg: Leg; exp: string; k: number }[] = [];
    for (const leg of p.legs) {
      if (leg.kind === "F") { const f = liveF[leg.exp]; if (!f) { ok = false; break; } legs.push({ leg, exp: f[0], k: 0 }); }
      else { const e = live[leg.exp]; if (!e) { ok = false; break; } legs.push({ leg, exp: e[0], k: e[1] + (mid(e) + leg.off) * e[2] }); }
    }
    if (!ok || !legs.length) continue;
    const firstExp = legs.map((l) => l.exp).sort()[0];
    dte = gap(d0, firstExp);
    // Where the trade ends.
    let j = -1, settle = false;
    if (p.hold === "overnight") j = i + 1;
    else if (p.hold === "intraday") j = i;
    else if (p.hold === "days") j = i + Math.max(1, p.days);
    else { settle = true; j = idx.get(firstExp) ?? -1; if (j < 0) { for (let x = i + 1; x < D.length && D[x][0] <= firstExp; x++) j = x; } }
    if (j < 0 || j >= D.length || (p.hold !== "intraday" && j <= i)) continue;
    // A multi-day hold may not run past the first expiry among its legs.
    if (p.hold === "days" && D[j][0] > firstExp) continue;
    if (gap(d0, D[j][0]) > (p.hold === "overnight" ? 5 : 400)) continue;   // a hole in the data, not a weekend
    d1 = D[j][0];

    const price = (day: Day, l: { leg: Leg; exp: string; k: number }, when: "open" | "close"): number | null => {
      if (l.leg.kind === "F") { const f = day[2].find((x) => x[0] === l.exp); return f ? f[when === "open" ? 1 : 2] : null; }
      const e = day[4].find((x) => x[0] === l.exp); if (!e) return null;
      const n = at(e, l.k); if (n < 0) return null;
      const col = ((l.leg.kind === "C" ? 3 : 5) + (when === "open" ? 0 : 1)) as 3 | 4 | 5 | 6;
      return e[col][n];
    };
    for (const l of legs) {
      const entry = price(D[i], l, p.hold === "intraday" ? "open" : "close");
      let exit: number | null;
      const legSettles = settle && l.exp === firstExp;
      if (legSettles) {
        const u = und[j];
        exit = u === null ? null : l.leg.kind === "F" ? u : l.leg.kind === "C" ? Math.max(u - l.k, 0) : Math.max(l.k - u, 0);
      } else exit = price(D[j], l, p.hold === "overnight" ? "open" : "close");
      // Every leg must have traded at both ends, or there was no price to deal at.
      if (entry === null || exit === null) { ok = false; break; }
      gross += l.leg.side * (exit - entry);
      if (l.leg.kind !== "F") paid += l.leg.side * entry;
      cost += legCost(l.leg, entry, exit, legSettles, p);
    }
    if (!ok) continue;
    let event = false;
    for (let x = p.hold === "intraday" ? i : i + 1; x <= j; x++) if ((market[D[x][0]]?.[4] ?? "") !== "") event = true;
    if (p.event === "only" ? !event : p.event === "skip" && event) continue;
    const uEnd = p.hold === "overnight" ? (D[j][2][0]?.[1] ?? null) : und[j];
    const uStart = p.hold === "intraday" ? (D[i][2][0]?.[1] ?? null) : (p.hold === "overnight" ? (D[i][2][0]?.[2] ?? und[i]) : und[i]);
    out.push({
      d0, d1, dte, wd, vix, pcr, fii, us, above200, onExpiry, event, paid, gross, costs: cost, net: gross - cost,
      move: uStart && uEnd ? (uEnd / uStart - 1) * 100 : null,
    });
  }
  return out;
}

export type Stats = {
  n: number; wins: number; winRate: number;
  avg: number; median: number; total: number; best: number; worst: number;
  avgGross: number; avgCosts: number; avgPaid: number;
  /** the deepest fall of the running total from an earlier peak, points */
  maxDrawdown: number;
};

export function stats(ts: Pick<Trade, "net" | "gross" | "costs" | "paid">[]): Stats | null {
  if (!ts.length) return null;
  const nets = ts.map((t) => t.net), sorted = [...nets].sort((a, b) => a - b), n = ts.length;
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  let tot = 0, peak = 0, dd = 0;
  for (const v of nets) { tot += v; peak = Math.max(peak, tot); dd = Math.max(dd, peak - tot); }
  const wins = nets.filter((v) => v > 0).length;
  return {
    n, wins, winRate: (wins / n) * 100, avg: sum(nets) / n,
    median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    total: sum(nets), best: sorted[n - 1], worst: sorted[0],
    avgGross: sum(ts.map((t) => t.gross)) / n, avgCosts: sum(ts.map((t) => t.costs)) / n, avgPaid: sum(ts.map((t) => t.paid)) / n,
    maxDrawdown: dd,
  };
}

export type GroupRow = { key: string; n: number; winRate: number; avg: number; total: number };

/** Trades grouped by `key`, in the order given by `order` (else first seen). */
export function group<T extends { net: number }>(ts: T[], key: (t: T) => string | null, order?: string[]): GroupRow[] {
  const m = new Map<string, T[]>();
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
export const DTE_BANDS = ["0-2 days", "3-7 days", "8-14 days", "15+ days"];
export const dteBand = (d: number) => (d <= 2 ? DTE_BANDS[0] : d <= 7 ? DTE_BANDS[1] : d <= 14 ? DTE_BANDS[2] : DTE_BANDS[3]);
export const MOVE_BANDS = ["Under 0.25%", "0.25-0.5%", "0.5-1%", "1%+"];
export const moveBand = (m: number | null) => {
  if (m === null) return null;
  const a = Math.abs(m);
  return a < 0.25 ? MOVE_BANDS[0] : a < 0.5 ? MOVE_BANDS[1] : a < 1 ? MOVE_BANDS[2] : MOVE_BANDS[3];
};
export const PCR_BANDS = ["Under 0.8", "0.8-1.0", "1.0-1.2", "1.2+"];
export const pcrBand = (v: number | null) => (v === null ? null : v < 0.8 ? PCR_BANDS[0] : v < 1 ? PCR_BANDS[1] : v < 1.2 ? PCR_BANDS[2] : PCR_BANDS[3]);
export const FII_BANDS = ["Under 30%", "30-50%", "50-70%", "70%+"];
export const fiiBand = (v: number | null) => (v === null ? null : v < 30 ? FII_BANDS[0] : v < 50 ? FII_BANDS[1] : v < 70 ? FII_BANDS[2] : FII_BANDS[3]);
export const US_BANDS = ["Fell 1%+", "Fell under 1%", "Rose under 1%", "Rose 1%+"];
export const usBand = (v: number | null) => (v === null ? null : v <= -1 ? US_BANDS[0] : v < 0 ? US_BANDS[1] : v < 1 ? US_BANDS[2] : US_BANDS[3]);
