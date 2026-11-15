// The Lab's backtest engine (src/lib/optlab.ts): research only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, stats, group, legCost, DEFAULTS, PRESETS, vixBand, dteBand } from "../src/lib/optlab.ts";

// Strikes 24900..25100 (ATM 25000 in the middle), step 50.
const exp = (e, co, cc, po, pc) => [e, 24900, 50, co, cc, po, pc];
const flat = (v) => [v + 4, v + 2, v, v - 2, v - 4];
const day = (d, u, fo, fc, e, pcr = 1) => [d, u, [["2026-11-26", fo, fc]], pcr, e];
// Thu 12 Nov: straddle closes 100 + 100. Fri 13 Nov: opens 110 + 95, closes 90 + 90.
const D1 = day("2026-11-12", 25000, 25010, 25020, [exp("2026-11-17", flat(98), flat(100), flat(98), flat(100))]);
const D2 = day("2026-11-13", 25050, 25120, 25070, [exp("2026-11-17", flat(110), flat(90), flat(95), flat(90))]);
const D3 = day("2026-11-16", 25100, 25090, 25110, [exp("2026-11-17", flat(80), flat(70), flat(60), flat(50))]);
const D4 = day("2026-11-17", 25075, 25100, 25075, [exp("2026-11-17", flat(60), flat(75), flat(5), flat(1))]);
const chain = { sym: "NIFTY", lot: 65, index: true, days: [D1, D2, D3, D4] };
const M = { "2026-11-12": [15, 2, 40, 0.5, ""], "2026-11-13": [16, 6.7, 42, -1.2, "R"], "2026-11-16": [14, -12, 45, 0.3, ""], "2026-11-17": [14, 0, 45, 0.1, ""] };
const FREE = { ...DEFAULTS, slip: 0, charges: false };
const first = (p) => run(chain, M, p)[0];

test("long straddle overnight: sold at the next open", () => {
  const t = first(FREE);
  assert.equal(t.d1, "2026-11-13");
  assert.equal(t.paid, 200);
  assert.equal(t.net, 5);                         // (110 + 95) - (100 + 100)
  assert.equal(t.dte, 5);
  assert.equal(t.event, true);                    // an RBI day falls on the exit day
});

test("the short side is the mirror image", () => {
  const t = first({ ...FREE, legs: PRESETS.find(([n]) => n === "Short straddle")[1] });
  assert.equal(t.net, -5);
  assert.equal(t.paid, -200);
});

test("intraday: in at the open, out at the close, on yesterday's at-the-money strike", () => {
  const ts = run(chain, M, { ...FREE, hold: "intraday" });
  assert.equal(ts[0].d0, "2026-11-13");           // the first day has no yesterday
  assert.equal(ts[0].net, (90 + 90) - (110 + 95));
});

test("holding N days sells at that day's close", () => {
  const t = first({ ...FREE, hold: "days", days: 2 });
  assert.equal(t.d1, "2026-11-16");
  assert.equal(t.net, (70 + 50) - 200);
});

test("holding to expiry settles on the underlying, with nothing to sell", () => {
  const t = first({ ...FREE, hold: "expiry" });
  assert.equal(t.d1, "2026-11-17");
  assert.equal(t.net, 75 - 200);                  // call worth 25,075 - 25,000; put worth nothing
});

test("spreads and strike offsets", () => {
  const t = first({ ...FREE, legs: [{ side: 1, kind: "C", off: 0, exp: 0 }, { side: -1, kind: "C", off: 2, exp: 0 }] });
  assert.equal(t.paid, 100 - 96);                 // bought at-the-money, sold two strikes up
  assert.equal(t.net, (110 - 100) - (106 - 96));
});

test("a future overnight", () => {
  const t = first({ ...FREE, legs: [{ side: 1, kind: "F", off: 0, exp: 0 }] });
  assert.equal(t.net, 25120 - 25020);
  assert.equal(t.paid, 0);
});

test("a leg with no price at either end means no trade", () => {
  const holed = { ...chain, days: [D1, day("2026-11-13", 25050, 25120, 25070, [exp("2026-11-17", [null, null, null, null, null], flat(90), flat(95), flat(90))])] };
  assert.equal(run(holed, M, FREE).length, 0);
});

test("filters: weekday, VIX, events, US session, PCR, FII, expiry day", () => {
  const n = (p) => run(chain, M, { ...FREE, to: "2026-11-12", ...p }).length;
  assert.equal(n({}), 1);
  assert.equal(n({ weekdays: [1, 2] }), 0);
  assert.equal(n({ vixMin: 16 }), 0);
  assert.equal(n({ vixDir: "down" }), 0);
  assert.equal(n({ event: "skip" }), 0);
  assert.equal(n({ event: "only" }), 1);
  assert.equal(n({ usDir: "down" }), 0);
  assert.equal(n({ pcrMin: 1.1 }), 0);
  assert.equal(n({ fiiMax: 30 }), 0);
  assert.equal(n({ expiryDay: "only" }), 0);
  assert.equal(n({ trend: "above" }), 0);         // no 200 days of history yet: unknown is not "above"
});

test("costs: spread and charges per leg, cheaper when left to expire", () => {
  const p = { slip: 0.5, brokerage: 20, lot: 65, charges: true };
  const leg = { side: 1, kind: "C", off: 0, exp: 0 };
  const brk = 40 / 65, txn = 0.0003503 * 210, sebi = 0.000001 * 210;
  const want = 1 + brk + 0.001 * 110 + txn + sebi + 0.00003 * 100 + 0.18 * (brk + txn + sebi);
  assert.ok(Math.abs(legCost(leg, 100, 110, false, p) - want) < 1e-9);
  assert.equal(legCost(leg, 100, 110, false, { ...p, charges: false }), 1);
  assert.ok(legCost(leg, 100, 110, true, p) < legCost(leg, 100, 110, false, p));
});

test("stats and grouping", () => {
  const t = (net) => ({ net, gross: net, costs: 0, paid: 1 });
  const s = stats([10, -4, -8, 6, -1].map(t));
  assert.equal(s.winRate, 40);
  assert.equal(s.median, -1);
  assert.equal(s.maxDrawdown, 12);
  assert.equal(stats([]), null);
  const g = group([{ net: 5, vix: 11 }, { net: -3, vix: 22 }, { net: 1, vix: 11.5 }, { net: 9, vix: null }], (x) => vixBand(x.vix), ["Under 12", "20-25"]);
  assert.deepEqual(g, [{ key: "Under 12", n: 2, winRate: 100, avg: 3, total: 6 }, { key: "20-25", n: 1, winRate: 0, avg: -3, total: -3 }]);
  assert.equal(dteBand(2), "0-2 days");
});
