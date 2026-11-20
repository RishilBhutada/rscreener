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

// Half-yearly from the filings (owner, 20-Nov-2026: "yes, add half-yearly cash flow").
import { cashHalves, cashRows, cashPrevStep } from "../src/lib/cashflow.ts";

const HALF = {
  periods: ["2023-09-30", "2024-03-31", "2024-09-30", "2025-03-31"],
  cfo: [100, 120, 110, 140], fcf: [90, 100, null, 130],
};

test("halves win over years when there are four; else years", () => {
  const c = cashRows(CF, HALF);
  assert.equal(c.months, 6);
  assert.equal(c.rows.length, 4);
  assert.equal(cashHalves({ ...HALF, periods: HALF.periods.slice(0, 3) }), null);
  assert.equal(cashRows(CF, { ...HALF, periods: HALF.periods.slice(0, 3) }).months, 12);
  assert.equal(cashRows(null, null), null);
  assert.equal(cashPrevStep(6), 2);
  assert.equal(cashPrevStep(12), 1);
});

test("price / cash flow on halves uses the latest two halves published", () => {
  const dates = ["2024-06-30", "2024-12-31", "2025-06-30"];
  const band = { series: dates.map((d) => [d, 1]), parts: dates.map(() => [2200, 1]) };
  const r = priceToCash(band, cashRows(CF, { ...HALF, periods: [...HALF.periods], cfo: [...HALF.cfo] }));
  // Jun-24: H1+H2 FY24 = 220 -> 10; Dec-24: H2 FY24 + H1 FY25 = 230; Jun-25: 250 -> 8.8
  assert.equal(r, null);   // three points: under the four a line needs
  const more = ["2024-06-30", "2024-08-30", "2024-12-31", "2025-06-30"];
  const b2 = { series: more.map((d) => [d, 1]), parts: more.map(() => [2200, 1]) };
  const r2 = priceToCash(b2, cashRows(CF, HALF));
  assert.deepEqual(r2.series.map(([, v]) => v), [10, 10, 9.6, 8.8]);
});

test("a gap between halves is not twelve months", () => {
  const gap = { periods: ["2022-09-30", "2023-09-30", "2024-03-31", "2024-09-30"], cfo: [1, 2, 3, 4], fcf: [1, 2, 3, 4] };
  const dates = ["2023-12-31", "2024-01-31", "2024-02-28", "2024-03-15"];
  const band = { series: dates.map((d) => [d, 1]), parts: dates.map(() => [30, 1]) };
  // only Sep-22 and Sep-23 are out by then, a year apart: no twelve-month figure
  assert.equal(priceToCash(band, cashRows(null, gap)), null);
});
