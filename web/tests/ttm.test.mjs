// fourInRow (src/lib/ttm.ts): the trailing-twelve-months rule. Runs on
// Node's own test runner with type stripping - no test library to install:
//   node --experimental-strip-types --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { fourInRow, TTM_SPAN_DAYS, ttmSums, ttmMargins, quarterX4 } from "../src/lib/ttm.ts";

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

test("twelve-month sales: four in a row added up, nothing across a hole", () => {
  assert.deepEqual(ttmSums(Q, [1, 2, 3, 4, 5, 6]), [null, null, null, 10, 14, 18]);
  // Jun-24 missing: every twelve months that holds it is blank; the first without it is not.
  assert.deepEqual(ttmSums(Q, [1, null, 3, 4, 5, 6]), [null, null, null, null, null, 18]);
  const gap = ["2024-03-31", "2024-06-30", "2024-12-31", "2025-03-31", "2025-06-30"];
  assert.deepEqual(ttmSums(gap, [1, 1, 1, 1, 1]), [null, null, null, null, null]);
  assert.deepEqual(ttmSums(Q, undefined), [null, null, null, null, null, null]);
});

test("twelve-month margin is the year's profit over the year's sales", () => {
  // Sales 100, 100, 100, 300 at margins 10%, 10%, 10%, 30%: profit 10+10+10+90 = 120 on 600 = 20%.
  const m = ttmMargins(Q.slice(0, 4), [10, 10, 10, 30], [100, 100, 100, 300]);
  assert.equal(m[3], 20);
  assert.equal(ttmMargins(Q.slice(0, 4), [10, null, 10, 30], [100, 100, 100, 300])[3], null);
  assert.equal(ttmMargins(Q.slice(0, 4), [10, 10, 10, 30], [0, 0, 0, 0])[3], null);
});

test("latest quarter x4", () => {
  assert.deepEqual(quarterX4([1, null, 2.5]), [4, null, 10]);
  assert.deepEqual(quarterX4(undefined), []);
});
