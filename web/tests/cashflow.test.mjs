// lib/cashflow.ts: cash flow bars and the Price / Cash flow line (owner, 20-Nov-2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cashYears, priceToCash } from "../src/lib/cashflow.ts";

const CF = {
  periods: ["2023-03-31", "2024-03-31", "2025-03-31"],
  items: [
    { label: "Cash from Operations", values: [100, 200, -50] },
    { label: "Free Cash Flow", values: [80, 150, -90] },
  ],
};

test("years from the company file, oldest first", () => {
  assert.deepEqual(cashYears(CF), [
    { end: "2023-03-31", cfo: 100, fcf: 80 }, { end: "2024-03-31", cfo: 200, fcf: 150 }, { end: "2025-03-31", cfo: -50, fcf: -90 }]);
  assert.equal(cashYears(null), null);
  assert.equal(cashYears({ periods: ["2025-03-31"], items: [{ label: "Cash from Operations", values: [1] }] }), null);
});

test("price / cash flow uses the latest year already published, never a cash burn", () => {
  const dates = ["2023-05-01", "2023-06-30", "2023-12-31", "2024-04-30", "2024-06-30", "2025-01-31", "2025-06-30"];
  const band = { series: dates.map((d) => [d, 1]), parts: dates.map(() => [1000, 1]) };
  const r = priceToCash(band, cashYears(CF));
  // 2023-05-01 is under 60 days after FY23 - nothing published yet that day... FY22 absent: no point.
  assert.deepEqual(r.series.map(([d]) => d), ["2023-06-30", "2023-12-31", "2024-04-30", "2024-06-30", "2025-01-31"]);
  assert.deepEqual(r.series.map(([, v]) => v), [10, 10, 10, 5, 5]);   // FY25's negative CFO draws nothing
  assert.equal(r.median_5y, 10);
});

test("too few points: no line", () => {
  const band = { series: [["2024-06-30", 1]], parts: [[1000, 1]] };
  assert.equal(priceToCash(band, cashYears(CF)), null);
});
