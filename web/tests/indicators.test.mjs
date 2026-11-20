// lib/indicators.ts pcrAvg: the Nifty put-call ratio drawn as its 10-day
// average (owner, 20-Nov-2026: "its not showing any result" - the daily line
// was a solid block on a phone).
import { test } from "node:test";
import assert from "node:assert/strict";
import { pcrAvg } from "../src/lib/indicators.ts";

test("average of the last n values, null until the window is full", () => {
  assert.deepEqual(pcrAvg([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  assert.deepEqual(pcrAvg([0.8, 1.2], 3), [null, null]);
});

test("a missing day is skipped, never counted as zero", () => {
  assert.deepEqual(pcrAvg([1, null, 3, 5], 2), [null, null, 2, 4]);
});
