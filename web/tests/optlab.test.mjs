// The Options lab's backtest engine (src/lib/optlab.ts): research only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, stats, group, costs, DEFAULTS, vixBand, dteBand } from "../src/lib/optlab.ts";

const SPAN = 2;
const arr = (v) => [null, v - 1, v, v + 1, null];   // strikes ATM-2..ATM+2; the ends untraded
// One night: straddle bought for 100 + 100, sold at the open for 110 + 95.
const exp = (e, c0 = 100, p0 = 100, c1o = 110, p1o = 95, c1c = 90, p1c = 90) =>
  [e, 25000, 50, arr(c0), arr(p0), arr(c1o), arr(p1o), arr(c1c), arr(p1c)];
const lab = (days) => ({ generated_at: "", lot: 65, span: SPAN, days });
const FREE = { ...DEFAULTS, slip: 0, charges: false };

test("a straddle's gross result: what it sold for less what it cost", () => {
  const [t] = run(lab([["2026-11-12", "2026-11-13", 25000, 25100, 25050, 15, [exp("2026-11-17")]]]), FREE);
  assert.equal(t.paid, 200);
  assert.equal(t.got, 205);
  assert.equal(t.net, 5);
  assert.equal(t.pct, 2.5);
  assert.equal(t.dte, 5);
  assert.equal(t.wd, 4);                       // a Thursday
  assert.ok(Math.abs(t.move - 0.4) < 1e-9);    // Nifty close 25,000 -> open 25,100
});

test("selling at the next close instead of the open", () => {
  const [t] = run(lab([["2026-11-12", "2026-11-13", 25000, 25100, 25050, 15, [exp("2026-11-17")]]]), { ...FREE, exit: "close" });
  assert.equal(t.got, 180);
  assert.equal(t.net, -20);
});

test("a strangle takes the call above and the put below", () => {
  const [t] = run(lab([["2026-11-12", "2026-11-13", 25000, 25100, 25050, 15, [exp("2026-11-17")]]]), { ...FREE, width: 1 });
  assert.equal(t.callK, 25050);
  assert.equal(t.putK, 24950);
  assert.equal(t.paid, 101 + 99);              // call at ATM+1, put at ATM-1
});

test("a leg that did not trade means no trade that night", () => {
  assert.equal(run(lab([["2026-11-12", "2026-11-13", 25000, 25100, 25050, 15, [exp("2026-11-17")]]]), { ...FREE, width: 2 }).length, 0);
});

test("expiry choice and the days-to-expiry floor", () => {
  const day = ["2026-11-12", "2026-11-13", 25000, 25100, 25050, 15, [exp("2026-11-13"), exp("2026-11-17", 150, 150, 150, 150)]];
  assert.equal(run(lab([day]), FREE)[0].expiry, "2026-11-13");
  assert.equal(run(lab([day]), { ...FREE, minDte: 3 })[0].expiry, "2026-11-17");
  assert.equal(run(lab([day]), { ...FREE, expiry: "next" })[0].expiry, "2026-11-17");
  assert.equal(run(lab([day]), { ...FREE, expiry: "next", minDte: 3 }).length, 0);
});

test("weekday, VIX and date filters", () => {
  const day = ["2026-11-12", "2026-11-13", 25000, 25100, 25050, 15, [exp("2026-11-17")]];
  assert.equal(run(lab([day]), { ...FREE, weekdays: [1, 2] }).length, 0);
  assert.equal(run(lab([day]), { ...FREE, vixMin: 16 }).length, 0);
  assert.equal(run(lab([day]), { ...FREE, vixMax: 16 }).length, 1);
  assert.equal(run(lab([day]), { ...FREE, from: "2026-11-13" }).length, 0);
});

test("costs: spread on four trades, then charges at today's rates", () => {
  assert.equal(costs(200, 205, { slip: 0.5, brokerage: 20, lot: 65, charges: false }), 2);
  const buy = 201, sell = 204, brk = 80 / 65, txn = 0.0003503 * 405, sebi = 0.000001 * 405;
  const want = 2 + brk + 0.001 * sell + txn + sebi + 0.00003 * buy + 0.18 * (brk + txn + sebi);
  assert.ok(Math.abs(costs(200, 205, { slip: 0.5, brokerage: 20, lot: 65, charges: true }) - want) < 1e-9);
});

test("stats: win rate, median, and the deepest fall from a peak", () => {
  const t = (net) => ({ net, pct: net, gross: net, costs: 0 });
  const s = stats([10, -4, -8, 6, -1].map(t));
  assert.equal(s.n, 5);
  assert.equal(s.winRate, 40);
  assert.equal(s.total, 3);
  assert.equal(s.median, -1);
  assert.equal(s.best, 10);
  assert.equal(s.worst, -8);
  assert.equal(s.maxDrawdown, 12);             // from +10 down to -2
  assert.equal(stats([]), null);
});

test("grouping keeps the given order and skips unknowns", () => {
  const ts = [{ net: 5, vix: 11 }, { net: -3, vix: 22 }, { net: 1, vix: 11.5 }, { net: 9, vix: null }];
  const g = group(ts, (t) => vixBand(t.vix), ["Under 12", "20-25"]);
  assert.deepEqual(g, [{ key: "Under 12", n: 2, winRate: 100, avg: 3, total: 6 }, { key: "20-25", n: 1, winRate: 0, avg: -3, total: -3 }]);
  assert.equal(dteBand(2), "1-2 days");
  assert.equal(dteBand(8), "8-14 days");
});
