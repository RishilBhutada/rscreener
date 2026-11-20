// lib/chartpresets.ts pickChanges / carryOver: chart changes are listed and
// confirmed before they are made (owner, 21-Nov-2026).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { pickChanges, carryOver, declineOffer, fillPick } = await import("../src/lib/chartpresets.ts");
const { writePick } = await import("../src/lib/chartpick.ts");

const base = fillPick({ view: "pe", range: "1Y" });
beforeEach(() => store.clear());

test("nothing listed when nothing differs", () => {
  assert.deepEqual(pickChanges(base, { ...base }), []);
});

test("each difference in plain words, from and to", () => {
  const to = { ...base, range: "5Y", win: "q1", overlays: ["ebitda"], vis: { "pe:median": false }, chg: false };
  const lines = pickChanges(base, to);
  assert.ok(lines.includes("Range: 1Y → 5Y"));
  assert.ok(lines.includes("Window: TTM → Latest quarter ×4"));
  assert.ok(lines.includes("Overlays: None → EBITDA"));
  assert.ok(lines.includes("Growth on bars: Vs year ago → Off"));
  assert.ok(lines.includes("PE Ratio: median: Shown → Hidden"));
});

test("the company chart counts 2Y and 3Y as one range", () => {
  const same = (a, b) => ({ "2Y": "3Yr", "3Y": "3Yr" }[a] ?? a) === ({ "2Y": "3Yr", "3Y": "3Yr" }[b] ?? b);
  assert.deepEqual(pickChanges({ ...base, range: "2Y" }, { ...base, range: "3Y" }, same), []);
});

test("carry-over: the other chart's changes are offered, not applied", () => {
  writePick({ ...base, range: "1Y" }, "small");              // the company chart, as last set
  writePick({ ...base, range: "5Y", win: "q1" }, "full");     // then the full chart changed it
  const c = carryOver("small");
  assert.equal(c.start.range, "1Y");                          // opens on its own
  assert.equal(c.offer.range, "5Y");                          // and offers the other's
  assert.deepEqual(pickChanges(fillPick(c.start), c.offer), ["Range: 1Y → 5Y", "Window: TTM → Latest quarter ×4"]);
});

test("carry-over: a declined set-up is not offered again; a new change is", () => {
  writePick({ ...base }, "small");
  writePick({ ...base, range: "5Y" }, "full");
  declineOffer("small", carryOver("small").offer);
  assert.equal(carryOver("small").offer, null);
  writePick({ ...base, range: "10Y" }, "full");
  assert.equal(carryOver("small").offer.range, "10Y");
});

test("carry-over: a chart never changed here follows the other without asking", () => {
  writePick({ ...base, range: "5Y" }, "full");
  const c = carryOver("small");
  assert.equal(c.offer, null);
  assert.equal(c.start.range, "5Y");
});

test("carry-over: its own last change asks nothing", () => {
  writePick({ ...base, range: "5Y" }, "small");
  assert.equal(carryOver("small").offer, null);
});
