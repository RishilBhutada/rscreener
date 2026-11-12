import { test } from "node:test";
import assert from "node:assert/strict";
import { squarify, heatColor, heatLevel, modal, HEAT_FULL } from "../src/lib/treemap.ts";

const BOX = { x: 0, y: 0, w: 300, h: 200 };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test("each tile's area is its share of the box", () => {
  const items = [{ k: "a", v: 50 }, { k: "b", v: 30 }, { k: "c", v: 15 }, { k: "d", v: 5 }];
  const out = squarify(items, (t) => t.v, BOX);
  assert.equal(out.length, 4);
  for (const p of out) assert.ok(near(p.w * p.h, (p.item.v / 100) * 300 * 200, 1e-6), p.item.k);
});

test("tiles stay inside the box and do not overlap", () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ k: i, v: 1 + ((i * 37) % 23) }));
  const out = squarify(items, (t) => t.v, BOX);
  assert.equal(out.length, 40);
  for (const p of out) {
    assert.ok(p.x >= -1e-9 && p.y >= -1e-9 && p.x + p.w <= 300 + 1e-6 && p.y + p.h <= 200 + 1e-6);
  }
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    const a = out[i], b = out[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    assert.ok(ox <= 1e-6 || oy <= 1e-6, `tiles ${i} and ${j} overlap`);
  }
  const area = out.reduce((s, p) => s + p.w * p.h, 0);
  assert.ok(near(area, 300 * 200, 1e-3));
});

test("largest first, from the top-left corner", () => {
  const out = squarify([{ v: 1 }, { v: 9 }, { v: 4 }], (t) => t.v, BOX);
  assert.equal(out[0].item.v, 9);
  assert.equal(out[0].x, 0);
  assert.equal(out[0].y, 0);
});

test("equal sizes come out close to square, not as slivers", () => {
  const out = squarify(Array.from({ length: 24 }, () => ({ v: 1 })), (t) => t.v, BOX);
  for (const p of out) assert.ok(Math.max(p.w / p.h, p.h / p.w) < 2.5);
});

test("items without a positive size are left out", () => {
  const out = squarify([{ v: 10 }, { v: 0 }, { v: null }, { v: -3 }, { v: NaN }, {}], (t) => t.v, BOX);
  assert.equal(out.length, 1);
  assert.ok(near(out[0].w, 300) && near(out[0].h, 200));
});

test("nothing to draw: no items, or no room", () => {
  assert.deepEqual(squarify([], (t) => t.v, BOX), []);
  assert.deepEqual(squarify([{ v: 1 }], (t) => t.v, { x: 0, y: 0, w: 0, h: 200 }), []);
});

test("a box that does not start at the origin keeps its offset", () => {
  const out = squarify([{ v: 1 }, { v: 1 }], (t) => t.v, { x: 40, y: 20, w: 100, h: 50 });
  assert.ok(out.every((p) => p.x >= 40 && p.y >= 20 && p.x + p.w <= 140 + 1e-6 && p.y + p.h <= 70 + 1e-6));
});

test("heat level: a share of the full move, capped at 1", () => {
  assert.equal(heatLevel(1.5, 3), 0.5);
  assert.equal(heatLevel(-1.5, 3), 0.5);
  assert.equal(heatLevel(12, 3), 1);
  assert.equal(heatLevel(null, 3), 0);
  assert.equal(heatLevel(undefined, 3), 0);
});

test("heat colour: green up, red down, grey for nothing", () => {
  assert.equal(heatColor(null, 3), "var(--card2)");
  assert.equal(heatColor(0, 3), "var(--card2)");
  assert.equal(heatColor(3, HEAT_FULL.d1), "color-mix(in srgb, var(--pos) 52%, var(--card2))");
  assert.equal(heatColor(-30, HEAT_FULL.d1), "color-mix(in srgb, var(--neg) 52%, var(--card2))");
  assert.equal(heatColor(0.01, 3), "color-mix(in srgb, var(--pos) 12%, var(--card2))");
  // The same move is paler over a year than over a day.
  assert.match(heatColor(3, HEAT_FULL.y1), /var\(--pos\) 15%/);
});

test("modal: the value most share, the later one on a tie", () => {
  assert.equal(modal(["2026-11-10", "2026-11-11", "2026-11-10"]), "2026-11-10");
  assert.equal(modal(["2026-11-10", "2026-11-11"]), "2026-11-11");
  assert.equal(modal([null, undefined]), null);
  assert.equal(modal([]), null);
});
