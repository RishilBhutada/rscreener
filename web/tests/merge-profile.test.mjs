// mergeProfile (src/lib/merge-profile.ts): which device's copy survives a sync.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeProfile } from "../src/lib/merge-profile.ts";

const KEYS = ["rscreener_portfolio", "rscreener_portfolio_at", "rscreener_screens", "rscreener_screens_at",
  "rscreener_watchlists", "rscreener_watchlists_at", "rscreener_notes"];
const join = (a, b) => ({ joined: [a, b] });
const run = (l, r, first = false) => mergeProfile(l, r, KEYS, { first, mergeWatch: join });

const oldPf = [{ symbol: "TCS", qty: 10, avg: 3000 }, { symbol: "INFY", qty: 5, avg: 1500 }];
const newPf = [{ symbol: "TCS", qty: 20, avg: 3100 }];   // qty edited, INFY sold

test("portfolio: the copy saved last wins - an edit and a sale stick", () => {
  const m = run({ rscreener_portfolio: newPf, rscreener_portfolio_at: "200" },
                { rscreener_portfolio: oldPf, rscreener_portfolio_at: "100" });
  assert.deepEqual(m.rscreener_portfolio, newPf);
  assert.equal(m.rscreener_portfolio_at, "200");
});

test("portfolio: a newer copy from the other device wins too", () => {
  const m = run({ rscreener_portfolio: oldPf, rscreener_portfolio_at: "100" },
                { rscreener_portfolio: newPf, rscreener_portfolio_at: "300" });
  assert.deepEqual(m.rscreener_portfolio, newPf);
  assert.equal(m.rscreener_portfolio_at, "300");
});

test("a device's first merge joins, so nothing the account holds is wiped", () => {
  const phone = [{ symbol: "ITC", qty: 1, avg: 400 }];
  const m = run({ rscreener_portfolio: phone, rscreener_portfolio_at: "999" },
                { rscreener_portfolio: oldPf, rscreener_portfolio_at: "100" }, true);
  assert.equal(m.rscreener_portfolio.length, 3);
});

test("a copy with no save time (older build) is joined, not replaced", () => {
  const m = run({ rscreener_portfolio: newPf, rscreener_portfolio_at: "200" },
                { rscreener_portfolio: oldPf });
  assert.equal(m.rscreener_portfolio.length, 3);
});

test("saved screens: an edited query does not revert", () => {
  const edited = [{ name: "Cheap", query: "pe < 10" }], old = [{ name: "Cheap", query: "pe < 20" }];
  const m = run({ rscreener_screens: edited, rscreener_screens_at: "500" },
                { rscreener_screens: old, rscreener_screens_at: "400" });
  assert.deepEqual(m.rscreener_screens, edited);
});

test("watchlists: last saved wins once stamped, joined on a first merge", () => {
  const a = { lists: [{ id: "x", name: "A", symbols: ["TCS"] }], activeId: "x" };
  const b = { lists: [{ id: "x", name: "A", symbols: ["TCS", "INFY"] }], activeId: "x" };
  assert.deepEqual(run({ rscreener_watchlists: a, rscreener_watchlists_at: "9" },
                       { rscreener_watchlists: b, rscreener_watchlists_at: "5" }).rscreener_watchlists, a);
  assert.deepEqual(run({ rscreener_watchlists: a, rscreener_watchlists_at: "9" },
                       { rscreener_watchlists: b, rscreener_watchlists_at: "5" }, true).rscreener_watchlists, { joined: [a, b] });
});

test("unstamped keys keep their old rules", () => {
  const m = run({ rscreener_notes: { TCS: "mine" } }, { rscreener_notes: { TCS: "theirs", INFY: "x" } });
  assert.deepEqual(m.rscreener_notes, { TCS: "mine", INFY: "x" });
});

test("a side with nothing takes the other's copy", () => {
  assert.deepEqual(run({}, { rscreener_portfolio: oldPf }).rscreener_portfolio, oldPf);
});
