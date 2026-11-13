// The company page's number, date and statement helpers
// (src/components/company/format.ts). Every company page prints these, so a
// slip here is a wrong figure on 4,949 pages at once.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthYear, amtDec, fmtNum, periodLabel, declaredLabel, quarterAfter, quarterBefore,
  isQuarterly, yearBefore, heatTint, cagr, num, crShort, withEbitda, ttmOf, trendToStmt,
  industryMedian, hasValuationHistory,
} from "@/components/company/format";

test("monthYear: a date's month and year, a dash when there is none", () => {
  assert.equal(monthYear("2026-03-31"), "Mar 2026");
  assert.equal(monthYear("2025-12"), "Dec 2025");
  assert.equal(monthYear(null), "—");
  assert.equal(monthYear("2026"), "—");
});

test("amtDec: two decimals under Rs 10 Cr, one under 100, none above", () => {
  assert.equal(amtDec(0.4), 2);
  assert.equal(amtDec(-5), 2);
  assert.equal(amtDec(10), 1);
  assert.equal(amtDec(99.9), 1);
  assert.equal(amtDec(100), 0);
  assert.equal(amtDec(NaN), 0);
  assert.equal(amtDec("12"), 0);
});

test("fmtNum: Indian grouping; text passes through; missing is a dash", () => {
  assert.equal(fmtNum(1234567.891), "12,34,567.89");
  assert.equal(fmtNum(45031.4, 0), "45,031");
  assert.equal(fmtNum("n/a"), "n/a");
  assert.equal(fmtNum(null), "—");
  assert.equal(fmtNum(undefined), "—");
});

test("periodLabel and declaredLabel", () => {
  assert.equal(periodLabel("2026-03-31"), "Mar 2026");
  assert.equal(declaredLabel("2026-05-14"), "14 May 26");
  assert.equal(declaredLabel(null), null);
  assert.equal(declaredLabel(""), null);
});

test("quarterAfter: the next quarter end, across the year end", () => {
  assert.equal(quarterAfter("2026-06-30"), "2026-09-30");
  assert.equal(quarterAfter("2026-09-30"), "2026-12-31");
  assert.equal(quarterAfter("2025-12-31"), "2026-03-31");
});

test("quarterBefore: the quarter a results meeting reports", () => {
  assert.equal(quarterBefore("2026-05-14"), "2026-03-31");
  assert.equal(quarterBefore("2026-04-01"), "2026-03-31");
  assert.equal(quarterBefore("2026-07-01"), "2026-06-30");
  assert.equal(quarterBefore("2026-02-10"), "2025-12-31");
});

test("isQuarterly: told apart by the gap between the last two columns", () => {
  assert.equal(isQuarterly(["2025-03-31", "2025-06-30"]), true);
  assert.equal(isQuarterly(["2024-03-31", "2025-03-31"]), false);
  assert.equal(isQuarterly(["2025-03-31"]), false);
});

test("yearBefore: found by date, so a missing quarter does not shift it", () => {
  // September 2024 was never filed.
  const P = ["2024-03-31", "2024-06-30", "2024-12-31", "2025-03-31", "2025-06-30"];
  const V = [1, 2, 3, 4, 5];
  assert.equal(yearBefore(P, V, 4, true), 2);      // June 2024, not four columns back (March)
  assert.equal(yearBefore(P, V, 3, true), 1);
  assert.equal(yearBefore(P, V, 2, true), null);   // nothing a year before
  assert.equal(yearBefore(["2024-03-31", "2025-03-31"], [7, 9], 1, false), 7);
  assert.equal(yearBefore(["2025-03-31"], [9], 0, false), null);
});

test("heatTint: green up, red down, stronger with the move, none when tiny", () => {
  assert.equal(heatTint(110, 100, false), "color-mix(in srgb, var(--pos) 14%, transparent)");
  assert.equal(heatTint(50, 100, false), "color-mix(in srgb, var(--neg) 26%, transparent)");
  assert.equal(heatTint(13, 10, true), "color-mix(in srgb, var(--pos) 26%, transparent)");
  assert.equal(heatTint(-50, -100, false), "color-mix(in srgb, var(--pos) 26%, transparent)"); // a loss that narrows is a rise
  assert.equal(heatTint(100.5, 100, false), undefined);
  assert.equal(heatTint(null, 100, false), undefined);
  assert.equal(heatTint(100, 100, false), undefined);
});

test("cagr: measured over the dates, not the count of columns", () => {
  // FY2018 missing: five columns span five years, and the rate is 10%.
  const P = ["2015-03-31", "2016-03-31", "2017-03-31", "2019-03-31", "2020-03-31"];
  assert.equal(cagr([100, 110, 121, 146.41, 161.051], 5, P), 10);
  // No year near five years back: withheld, not stretched.
  assert.equal(cagr([100, 200], 3, ["2014-03-31", "2020-03-31"]), null);
});

test("cagr: one basis end to end", () => {
  const P = ["2023-03-31", "2024-03-31", "2025-03-31"];
  assert.equal(cagr([100, 150, 200], 2, P), 41);
  assert.equal(cagr([100, 150, 200], 2, P, ["standalone", "consolidated", "consolidated"]), null);
});

test("cagr: without dates, only a dense series, and never from a loss", () => {
  assert.equal(cagr([100, 110, 121], 2), 10);
  assert.equal(cagr([110, 121], 2), null);
  assert.equal(cagr([-100, 110, 121], 2), null);
});

test("num: only a real number counts", () => {
  assert.equal(num({ a: 5 }, "a"), 5);
  assert.equal(num({ a: NaN }, "a"), null);
  assert.equal(num({ a: "5" }, "a"), null);
  assert.equal(num(null, "a"), null);
});

test("crShort: lakh crore above 1,00,000 Cr", () => {
  assert.equal(crShort(813000), "8.13L");
  assert.equal(crShort(45031.4), "45,031");
  assert.equal(crShort(-45031), "−45,031");
  assert.equal(crShort(null), "—");
});

test("withEbitda: operating profit plus other income, placed after OPM %", () => {
  const s = {
    periods: ["2025-03-31", "2026-03-31"],
    items: [
      { label: "Revenue", values: [100, 200] },
      { label: "Operating Profit", values: [20, 30] },
      { label: "OPM %", values: [20, 15] },
      { label: "Other Income", values: [5, null] },
    ],
  };
  const out = withEbitda(s);
  assert.deepEqual(out.items.map((it) => it.label),
    ["Revenue", "Operating Profit", "OPM %", "EBITDA", "EBITDA margin %", "Other Income"]);
  assert.deepEqual(out.items[3].values, [25, 30]);
  assert.deepEqual(out.items[4], { label: "EBITDA margin %", values: [25, 15], parent: "EBITDA" });
  assert.equal(withEbitda(out), out);                              // added once only
  const noOther = { periods: s.periods, items: s.items.slice(0, 3) };
  assert.equal(withEbitda(noOther), noOther);
  assert.equal(withEbitda(null), null);
});

test("ttmOf: four newest quarters added; percentages rebuilt from parts", () => {
  const annual = {
    periods: ["2025-03-31"],
    items: ["Revenue", "Operating Profit", "OPM %", "Profit before tax", "Tax %", "Net Profit"]
      .map((label) => ({ label, values: [1] })),
  };
  const quarterly = {
    periods: ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"],
    items: [
      { label: "Revenue", values: [100, 100, 100, 100] },
      { label: "Operating Profit", values: [10, 20, 30, 40] },
      { label: "Profit before tax", values: [10, 10, 10, 20] },
      { label: "Tax %", values: [25, 25, 25, 20] },
      { label: "Net Profit", values: [8, 8, null, 16] },
    ],
  };
  const t = ttmOf(annual, quarterly);
  assert.equal(t.asOf, "2026-03-31");
  assert.equal(t.values["Revenue"], 400);
  assert.equal(t.values["Operating Profit"], 100);
  assert.equal(t.values["OPM %"], 25);
  assert.equal(t.values["Profit before tax"], 50);
  assert.equal(t.values["Tax %"], 23);              // weighted by profit before tax, not averaged
  assert.equal(t.values["Net Profit"], null);       // a quarter missing: blank, not three-quarters
});

test("ttmOf: nothing when the quarters are not newer than the year, or not in a row", () => {
  const items = [{ label: "Revenue", values: [1, 1, 1, 1] }];
  const q = { periods: ["2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31"], items };
  assert.equal(ttmOf({ periods: ["2025-03-31"], items }, q), null);
  const gap = { periods: ["2025-03-31", "2025-06-30", "2025-12-31", "2026-03-31"], items };
  assert.equal(ttmOf({ periods: ["2025-03-31"], items }, gap), null);
  assert.equal(ttmOf(null, q), null);
});

test("trendToStmt: profit margin to one decimal, blank without revenue", () => {
  const s = trendToStmt({ periods: ["2025-03-31", "2026-03-31"], revenue: [100, 0], pat: [12.34, 5], eps: [1, 2] });
  assert.deepEqual(s.items.map((it) => it.label), ["Revenue", "Net Profit", "EPS (Rs)", "PAT margin %"]);
  assert.deepEqual(s.items[3].values, [12.3, null]);
});

test("industryMedian: precomputed first; withheld under five companies", () => {
  assert.deepEqual(industryMedian({ rows: [], medians: { pe: [20, 31] } }, "pe"), { value: 20, n: 31 });
  const rows = (vs) => vs.map((pe) => ({ pe }));
  assert.equal(industryMedian({ rows: rows([1, 2, 3, 4]), medians: {} }, "pe"), null);
  assert.deepEqual(industryMedian({ rows: rows([5, 1, 3, NaN, "x", 4, 2]), medians: {} }, "pe"), { value: 3, n: 5 });
  assert.deepEqual(industryMedian({ rows: rows([6, 1, 5, 2, 4, 3]), medians: {} }, "pe"), { value: 3.5, n: 6 });
});

test("hasValuationHistory: needs 36 monthly points in some band", () => {
  const band = (n) => ({ series: Array.from({ length: n }, (_, i) => [`m${i}`, 10 + i]), median_5y: null });
  assert.equal(hasValuationHistory({ pe_band: band(36) }), true);
  assert.equal(hasValuationHistory({ pe_band: band(35), pb_band: band(36) }), true);
  assert.equal(hasValuationHistory({ pe_band: band(35) }), false);
  const holes = band(40);
  for (let i = 0; i < 5; i++) holes.series[i][1] = null;
  assert.equal(hasValuationHistory({ pe_band: holes }), false);
  assert.equal(hasValuationHistory({}), false);
});
