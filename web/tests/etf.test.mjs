// The ETF premium headline (src/lib/etf.ts): an old premium is told as old.
import { test } from "node:test";
import assert from "node:assert/strict";
import { premIsStale, premSentence } from "../src/lib/etf.ts";

test("a premium from the latest NAV day is current", () => {
  assert.equal(premIsStale("2026-11-03", "2026-11-03"), false);
  assert.equal(premSentence(4.2), "Trading 4.2% above its NAV");
});

test("a premium older than the latest NAV is stale and dated", () => {
  assert.equal(premIsStale("2026-10-12", "2026-11-03"), true);
  assert.match(premSentence(4.2, "12 Oct 2026"), /^4\.2% above its NAV on 12 Oct 2026/);
  assert.doesNotMatch(premSentence(-1.5, "12 Oct 2026"), /^Trading/);
});

test("nothing to compare", () => {
  assert.equal(premIsStale(null, "2026-11-03"), false);
  assert.equal(premSentence(null), "No same-day NAV to compare with");
});
