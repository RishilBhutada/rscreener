// fourInRow (src/lib/ttm.ts): the trailing-twelve-months rule. Runs on
// Node's own test runner with type stripping - no test library to install:
//   node --experimental-strip-types --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fourInRow, TTM_SPAN_DAYS } from "../src/lib/ttm.ts";

const Q = ["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30"];

test("four consecutive quarters make a TTM", () => {
  assert.equal(fourInRow(Q, 3), true);
  assert.equal(fourInRow(Q, 5), true);
});

test("fewer than four quarters, or an index past the end, do not", () => {
  assert.equal(fourInRow(Q, 2), false);
  assert.equal(fourInRow(Q, 6), false);
});

test("a missing quarter makes the window too long", () => {
  const gap = ["2024-03-31", "2024-06-30", "2024-12-31", "2025-03-31"];   // Sep-24 missing
  assert.equal(fourInRow(gap, 3), false);
  assert.ok(TTM_SPAN_DAYS < 365);
});

test("quarters on two bases do not add up", () => {
  const b = ["consolidated", "consolidated", "standalone", "consolidated", "consolidated", "consolidated"];
  assert.equal(fourInRow(Q, 3, b), false);
  assert.equal(fourInRow(Q, 5, b), false);
  assert.equal(fourInRow(Q, 5, ["x", "x", "x", "c", "c", "c"]), false);
  assert.equal(fourInRow(Q, 5, ["x", "x", "c", "c", "c", "c"]), true);
});

test("an unknown basis is not a change of basis", () => {
  assert.equal(fourInRow(Q, 3, [null, "consolidated", undefined, "consolidated"]), true);
  assert.equal(fourInRow(Q, 3, null), true);
});

test("full timestamps are read by their date", () => {
  const t = Q.map((p) => `${p}T18:30:00Z`);
  assert.equal(fourInRow(t, 3), true);
});
