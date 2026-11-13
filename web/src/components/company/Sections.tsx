"use client";

/** The company page's financial sections: peers, pinned ratios, the ratio
 *  grid, growth, ownership trends, the F-score and valuation history. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FIELD_CATALOG } from "@/lib/fields";
import { shortName } from "@/lib/names";
import { Row } from "@/lib/query";
import InfoTip, { InfoPart } from "@/components/InfoTip";
import { markSaved } from "@/lib/sync";
import { Trend, Shareholding, Prices, PeBand, Company, Updates, NextResults, FScoreData, Cohort, Tile } from "@/components/company/types";
import { amtDec, fmtNum, periodLabel, quarterBefore, cagr, num, crShort, industryMedian } from "@/components/company/format";

/** Peer comparison, with screener.in's columns: the quarter's profit and sales
 *  and their change from a year before, a median row across the companies
 *  shown, and a column picker (rs_peer_cols, synced). */
export const PEER_COLS: { key: string; label: string; dec: number }[] = [
  { key: "price", label: "CMP ₹", dec: 2 },
  { key: "pe", label: "P/E", dec: 2 },
  { key: "mcap", label: "MCap ₹Cr", dec: 0 },
  { key: "div_yield", label: "Div Yld %", dec: 2 },
  { key: "qtr_profit", label: "NP Qtr ₹Cr", dec: 0 },
  { key: "qtr_profit_yoy", label: "Qtr Profit Var %", dec: 1 },
  { key: "qtr_sales", label: "Sales Qtr ₹Cr", dec: 0 },
  { key: "qtr_sales_yoy", label: "Qtr Sales Var %", dec: 1 },
  { key: "roce", label: "ROCE %", dec: 1 },
  { key: "roe", label: "ROE %", dec: 1 },
  { key: "pb", label: "P/B", dec: 2 },
  { key: "de", label: "Debt / Eq", dec: 2 },
  { key: "net_margin", label: "Net margin %", dec: 1 },
  { key: "sales_cagr_5y", label: "Sales gr 5Y %", dec: 1 },
  { key: "profit_cagr_5y", label: "Profit gr 5Y %", dec: 1 },
];

export const PEER_DEFAULT = ["price", "pe", "mcap", "div_yield", "qtr_profit", "qtr_profit_yoy", "qtr_sales", "qtr_sales_yoy", "roce"];

export function PeerTable({ symbol, self, peers, industry }: { symbol: string; self: Row; peers: Row[]; industry: string }) {
  const [cols, setCols] = useState<string[]>(PEER_DEFAULT);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("rs_peer_cols") ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read from this browser's storage after mount; the prerendered page has none
      if (Array.isArray(v) && v.length) setCols(v.filter((k: string) => PEER_COLS.some((c) => c.key === k)));
    } catch { /* the default columns */ }
  }, []);
  const pick = (k: string) => {
    const next = cols.includes(k) ? cols.filter((x) => x !== k) : PEER_COLS.map((c) => c.key).filter((x) => x === k || cols.includes(x));
    setCols(next);
    try { localStorage.setItem("rs_peer_cols", JSON.stringify(next)); markSaved("rs_peer_cols"); } catch { /* not remembered */ }
  };
  const shownCols = PEER_COLS.filter((c) => cols.includes(c.key));
  const all = [self, ...peers];
  const med = (k: string): number | null => {
    const v = all.map((r) => r[k]).filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
    if (v.length < 3) return null;
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  };
  const cell = (v: unknown, dec: number, k: string, bold = false) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : null;
    const signed = k.endsWith("_yoy");
    return (
      <td key={k} className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${bold ? "font-semibold" : ""} ${signed && n !== null ? (n < 0 ? "text-[var(--neg)]" : n > 0 ? "text-[var(--pos)]" : "") : ""}`}>
        {n === null ? "—" : fmtNum(n, dec === 0 ? amtDec(n) : dec)}
      </td>
    );
  };
  return (
    <section id="peers" className="scroll-mt-32 bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
      <div className="px-4 pt-3.5 pb-2 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-[var(--ink)]">Peers</h2>
          <p className="text-xs text-[var(--ink3)] mt-0.5">{industry}</p>
        </div>
        <Link href={`/compare?s=${[symbol, ...peers.slice(0, 3).map((p) => String(p.symbol))].map(encodeURIComponent).join(",")}`}
          className="shrink-0 min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold text-[var(--accent-ink)] bg-[var(--accent-soft)] inline-flex items-center">
          Compare
        </Link>
        <button type="button" onClick={() => setEditing(!editing)} aria-expanded={editing}
          className={`shrink-0 min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold border ${editing ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)]" : "text-[var(--ink2)] border-[var(--line)]"}`}>
          {editing ? "Done" : "Columns"}
        </button>
      </div>
      {editing && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5">
          {PEER_COLS.map((c) => (
            <button key={c.key} type="button" onClick={() => pick(c.key)} aria-pressed={cols.includes(c.key)}
              className={`rounded-full px-2.5 py-1 text-[12px] font-medium border ${cols.includes(c.key) ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)]" : "text-[var(--ink3)] border-[var(--line)]"}`}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
              <th className="px-3 py-2 text-left font-medium sticky left-0 bg-[var(--card)]">Name</th>
              {shownCols.map((c) => <th key={c.key} className="px-3 py-2 text-right font-medium whitespace-nowrap">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--line)] bg-[var(--card2)]">
              <td className="px-3 py-1.5 sticky left-0 bg-[var(--card2)]"><span className="font-semibold text-[var(--ink)]">{symbol}</span></td>
              {shownCols.map((c) => cell(self[c.key], c.dec, c.key, true))}
            </tr>
            {peers.map((p) => (
              <tr key={String(p.symbol)} className="border-b border-[var(--line)] hover:bg-[var(--card2)]">
                <td className="px-3 py-1.5 sticky left-0 bg-[var(--card)] max-w-[40vw] truncate"><Link className="font-medium text-[var(--accent-ink)] hover:underline" href={`/company?s=${encodeURIComponent(String(p.symbol))}`}>{shortName(String(p.name ?? ""), String(p.symbol)) || String(p.symbol)}</Link></td>
                {shownCols.map((c) => cell(p[c.key], c.dec, c.key))}
              </tr>
            ))}
            <tr className="text-[var(--ink2)]">
              <td className="px-3 py-1.5 sticky left-0 bg-[var(--card)] font-medium">Median · {all.length} cos</td>
              {shownCols.map((c) => cell(med(c.key), c.dec, `${c.key}_m`))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Your own picks on the top grid - any screener field or a ratio you defined
 *  (screener's "Add ratio to table"). Kept as rs_grid_pins, synced. */
export function PinnedRatios({ row }: { row: Row | null }) {
  const [pins, setPins] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem("rs_grid_pins") ?? "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read from this browser's storage after mount; the prerendered page has none
      if (Array.isArray(v)) setPins(v.filter((x): x is string => typeof x === "string"));
    } catch { /* none */ }
  }, []);
  const save = (next: string[]) => {
    setPins(next);
    try { localStorage.setItem("rs_grid_pins", JSON.stringify(next)); markSaved("rs_grid_pins"); } catch { /* not remembered */ }
  };
  const byKey = new Map(FIELD_CATALOG.map((f) => [f.key, f]));
  const hits = q.trim().length < 1 ? [] : FIELD_CATALOG
    .filter((f) => !pins.includes(f.key) && `${f.label} ${f.key} ${f.short ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 8);
  const value = (k: string, unit: string) => {
    const v = num(row, k);
    if (v === null) return "—";
    return unit === "₹ Cr" ? `₹ ${fmtNum(v, 0)} Cr` : unit === "₹" ? `₹ ${fmtNum(v)}` : unit === "%" ? `${fmtNum(v)} %` : fmtNum(v);
  };
  return (
    <div className="mt-4 pt-3 border-t border-[var(--line)]">
      {pins.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6">
          {pins.map((k) => {
            const f = byKey.get(k);
            if (!f) return null;
            return (
              <div key={k} className="border-b border-[var(--line)] py-1.5 flex items-baseline justify-between gap-2">
                <span className="text-sm text-[var(--ink3)] truncate">{f.label}</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-[var(--ink)] tabular-nums">{value(k, f.unit)}</span>
                  <button type="button" onClick={() => save(pins.filter((x) => x !== k))} aria-label={`Remove ${f.label}`}
                    className="text-[var(--ink3)] text-xs px-1">✕</button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      {open ? (
        <div className="mt-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a ratio, e.g. PEG or debtor days"
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--card2)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)]" />
          <div className="mt-1">
            {hits.map((f) => (
              <button key={f.key} type="button" onClick={() => { save([...pins, f.key]); setQ(""); setOpen(false); }}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--card2)] flex items-baseline justify-between gap-3">
                <span className="text-sm text-[var(--ink)]">{f.label}</span>
                <span className="text-xs text-[var(--ink3)] tabular-nums">{value(f.key, f.unit)}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setOpen(false); setQ(""); }} className="mt-1 text-xs text-[var(--ink3)]">Cancel</button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 text-[13px] font-semibold text-[var(--accent-ink)]">+ Add ratio</button>
      )}
    </div>
  );
}

/** Insider trades - directors, promoters and designated employees buying or
 *  selling, as disclosed under SEBI's insider-trading rules (screener.in's
 *  "TRADES"). Shown as NSE lists them; its feed gives the latest twenty at
 *  most and can lag, so the list says so. A trade is a fact, not a signal. */
export function InsiderTrades({ list }: { list: [string, string, string, string, number | null, number | null, string][] }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 5);
  const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-2">
      <h3 className="text-[13px] font-semibold text-[var(--ink)]">
        Insider trades
        <InfoTip title="Insider trades" className="ml-1"><p>From NSE&apos;s insider-trading disclosures; its feed lists the latest twenty at most and can be incomplete.</p></InfoTip>
      </h3>
      <ul className="divide-y divide-[var(--line)]">
        {shown.map((t, i) => (
          <li key={i} className="py-1.5 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0">
              <span className="block text-[var(--ink)] truncate">{t[1]}</span>
              <span className="block text-[11px] text-[var(--ink3)] truncate">{day(t[0])} · {t[2] || "Insider"}{t[6] ? ` · ${t[6]}` : ""}</span>
            </span>
            <span className="text-right shrink-0">
              <span className="block font-semibold text-[var(--ink2)]">{t[3] || "Trade"}</span>
              <span className="block text-[11px] text-[var(--ink3)] tabular-nums">
                {t[4] !== null ? `${fmtNum(t[4], 0)} sh` : ""}{t[5] ? ` · ₹${fmtNum(t[5] / 1e7, 2)} Cr` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {list.length > 5 && <button type="button" onClick={() => setAll(!all)} className="text-[13px] font-semibold text-[var(--accent-ink)]">{all ? "Fewer" : `All ${list.length}`}</button>}
    </div>
  );
}

export function GrowthCard({ title, rows }: { title: string; rows: [string, number | null][] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-[var(--ink2)] mb-1.5">{title}</p>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, v]) => (
            <tr key={label} className="border-b border-[var(--line)] last:border-0">
              <td className="py-1 text-[var(--ink3)]">{label}</td>
              <td className={`py-1 text-right font-medium tabular-nums ${v !== null && v < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]"}`}>
                {v === null ? "—" : `${v}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompoundedGrowth({ trend, prices }: { trend?: { annual?: Trend }; prices?: Prices | null }) {
  const a = trend?.annual;
  if (!a) return null;
  const monthly = prices?.monthly ?? [];
  const stockCagr = (months: number): number | null => {
    if (monthly.length <= months) return null;
    const last = monthly[monthly.length - 1][1], start = monthly[monthly.length - 1 - months][1];
    if (!last || !start || start <= 0) return null;
    return Math.round((Math.pow(last / start, 12 / months) - 1) * 100);
  };
  const cards: [string, [string, number | null][]][] = [
    ["Compounded sales growth", [["10 years", cagr(a.revenue, 10, a.periods, a.basis)], ["5 years", cagr(a.revenue, 5, a.periods, a.basis)], ["3 years", cagr(a.revenue, 3, a.periods, a.basis)], ["1 year", cagr(a.revenue, 1, a.periods, a.basis)]]],
    ["Compounded profit growth", [["10 years", cagr(a.pat, 10, a.periods, a.basis)], ["5 years", cagr(a.pat, 5, a.periods, a.basis)], ["3 years", cagr(a.pat, 3, a.periods, a.basis)], ["1 year", cagr(a.pat, 1, a.periods, a.basis)]]],
    ["Stock price CAGR", [["10 years", stockCagr(120)], ["5 years", stockCagr(60)], ["3 years", stockCagr(36)], ["1 year", stockCagr(12)]]],
  ];
  // Return on equity, averaged over the years (as screener.in shows it): the
  // middle of a run of years says more than one year's figure.
  const roeAvg = (n: number): number | null => {
    const v = (a.roe ?? []).filter((x): x is number => x !== null && x !== undefined).slice(-n);
    return v.length >= Math.min(n, 2) && v.length >= (n === 1 ? 1 : Math.ceil(n * 0.8))
      ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
  };
  if ((a.roe ?? []).some((x) => x !== null && x !== undefined)) {
    cards.push(["Return on equity", [["10 years", roeAvg(10)], ["5 years", roeAvg(5)], ["3 years", roeAvg(3)], ["Last year", roeAvg(1)]]]);
  }
  return (
    <section className={`bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 grid sm:grid-cols-2 ${cards.length > 3 ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-6`}>
      {cards.map(([title, rows]) => (
        <GrowthCard key={title} title={title} rows={rows} />
      ))}
    </section>
  );
}

/** What the shareholding table says, in a sentence.
 *
 *  Tickertape gets this right structurally and wrong editorially: it prints
 *  "increasing promoter holding is considered good and reflects management's
 *  positive view" beside the number. That is an opinion about a motive nobody
 *  outside the company knows. The change itself is a fact, it is arithmetic on
 *  a table already on this page, and a reader scanning twelve columns of
 *  50.24 / 50.13 / 50.11 will not otherwise notice that the promoters have been
 *  selling for eight quarters running.
 *
 *  So: the movement, over three windows, and nothing about what it means.
 */
export function HoldingTrend({ s }: { s: Shareholding }) {
  const p = s.promoter, d = s.dates;
  const n = p.length;
  if (n < 2) return null;

  const q = (label: string, back: number) => {
    const i = n - 1 - back;
    if (i < 0) return null;
    const from = p[i], to = p[n - 1];
    if (typeof from !== "number" || typeof to !== "number") return null;
    const diff = to - from;
    // Below five hundredths of a point the exchange's own rounding is larger
    // than the movement, so calling it a change would be reading noise.
    const moved = Math.abs(diff) >= 0.05;
    return {
      label,
      from: d[i],
      text: moved
        ? `${diff > 0 ? "rose" : "fell"} ${Math.abs(diff).toFixed(2)} points, ${from.toFixed(2)}% to ${to.toFixed(2)}%`
        : `unchanged at ${to.toFixed(2)}%`,
      up: moved ? diff > 0 : null,
    };
  };

  const windows = [q("Last quarter", 1), q("Over a year", 4), q(`Since ${d[0]?.slice(0, 7)}`, n - 1)]
    .filter(Boolean) as { label: string; from: string; text: string; up: boolean | null }[];

  // A run of consecutive falls is the thing a table of near-identical numbers
  // hides best, and the thing most worth noticing.
  let streak = 0;
  for (let i = n - 1; i > 0; i--) {
    // The series is (number | null)[] - a quarter can be filed with the
    // promoter line missing - so the two values are checked, not the result.
    const a = p[i], b = p[i - 1];
    if (typeof a !== "number" || typeof b !== "number") break;
    if (a - b <= -0.05) streak++;
    else break;
  }

  return (
    <div className="px-4 pb-3.5 pt-1 space-y-1.5 border-t border-[var(--line)]">
      <p className="text-xs font-semibold text-[var(--ink2)] pt-2.5">
        Promoter stake
        <InfoTip title="Promoter stake" className="ml-1">
          <p>A movement is stated, never interpreted.</p>
          <p>
            Promoters sell and buy for reasons no filing discloses — pledges, estate
            planning, an unrelated business.
          </p>
        </InfoTip>
      </p>
      {windows.map((w) => (
        <p key={w.label} className="text-[13px] text-[var(--ink3)]">
          <span className="text-[var(--ink2)]">{w.label}:</span>{" "}
          <span style={{ color: w.up === null ? undefined : w.up ? "var(--pos)" : "var(--neg)" }}>
            {w.text}
          </span>
        </p>
      ))}
      {streak >= 3 && (
        <p className="text-[13px] text-[var(--ink2)]">
          Promoters have reduced their stake in {streak} consecutive quarters.
        </p>
      )}
    </div>
  );
}

/** Piotroski F-score, with every one of its nine tests on screen.
 *
 *  The only composite score this app carries, and the condition is that the
 *  total never appears without its workings. Trendlyne shows Durability,
 *  Valuation and Momentum scores whose construction is not published, which
 *  makes them impossible to argue with; Piotroski published his nine tests in
 *  2000 and each is arithmetic on two consecutive years of filed accounts, so
 *  every one can be checked and disagreed with individually.
 *
 *  It is not a recommendation and is not treated as one: a nine is a company
 *  whose accounts improved on nine measures last year, which is a fact about
 *  the past, not a view about the price.
 */
export function FScore({ f }: { f: FScoreData }) {
  const [all, setAll] = useState(false);
  const failed = f.checks.filter((c) => c.pass !== true);
  const listed = all ? f.checks : failed;
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="flex-1 text-base font-semibold text-[var(--ink)]">
          Nine tests
          <InfoTip title="Nine tests on the accounts" className="ml-1.5">
            <p>
              The Piotroski F-score, comparing {f.years[1].slice(0, 4)} against {f.years[0].slice(0, 4)}. Every test is
              arithmetic on two filed years, and all nine are shown — a score whose workings are hidden cannot be argued with.
            </p>
            <p>
              A test whose inputs are missing counts as neither a pass nor a fail. Scoring an absent figure as zero would
              turn missing data into bad news, which is not what it is.
            </p>
          </InfoTip>
        </h2>
        <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">{f.score}/{f.measured}</span>
        <button type="button" onClick={() => setAll(!all)} aria-expanded={all}
          className="text-[12px] font-semibold text-[var(--accent-ink)]">{all ? "Failed only" : `All ${f.checks.length}`}</button>
      </div>
      <div className="mt-2.5 grid grid-cols-9 gap-1" role="list" aria-label="Test results">
        {f.checks.map((c) => (
          <span key={c.test} role="listitem" title={`${c.name} - ${c.pass === null ? "not measurable" : c.pass ? "passed" : "failed"}`}
            className="h-6 rounded-md flex items-center justify-center"
            style={{ background: c.pass === null ? "var(--card2)" : `color-mix(in srgb, var(${c.pass ? "--pos" : "--neg"}) 16%, transparent)` }}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
              stroke={c.pass === null ? "var(--ink3)" : c.pass ? "var(--pos)" : "var(--neg)"}>
              <path d={c.pass === null ? "M12 7v6M12 17v.5" : c.pass ? "M5 12.5l4.5 4.5L19 7.5" : "M7 7l10 10M17 7L7 17"} />
            </svg>
            <span className="sr-only">{c.name}: {c.pass === null ? "not measurable" : c.pass ? "passed" : "failed"}</span>
          </span>
        ))}
      </div>
      {listed.length > 0 && (
        <>
          <p className="mt-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ink3)]">
            {all ? "All tests" : "Failed or not measurable"} · {f.years[1].slice(0, 4)} vs {f.years[0].slice(0, 4)}
          </p>
          <ul className="divide-y divide-[var(--line)]">
            {listed.map((c) => (
              <li key={c.test} className="py-1.5 flex items-baseline gap-2 text-[13px]">
                <span className="shrink-0 w-3 text-center font-bold" aria-hidden="true"
                  style={{ color: c.pass === null ? "var(--ink3)" : c.pass ? "var(--pos)" : "var(--neg)" }}>
                  {c.pass === null ? "?" : c.pass ? "\u2713" : "\u2715"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-[var(--ink)]">{c.name}</span>
                  <span className="block text-[11px] text-[var(--ink3)]">
                    {c.test}{c.detail ? ` — ${c.detail}` : " — not reported in both years, so not scored"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export function ValuationHistory({ company }: { company: Company }) {
  const bands: [string, PeBand | null | undefined, string][] = [
    ["Price to earnings", company.pe_band, "P/E"],
    ["Price to book", company.pb_band, "P/B"],
    ["EV to EBITDA", company.ev_band, "EV/EBITDA"],
    ["Market cap to sales", company.ps_band, "MCap/Sales"],
  ];
  const rows = bands.map(([label, band, short]) => {
    const s = (band?.series ?? []).filter((p): p is [string, number] =>
      Array.isArray(p) && typeof p[1] === "number" && Number.isFinite(p[1]));
    if (s.length < 36) return null;
    const now = s[s.length - 1];
    const vals = s.map((p) => p[1]);
    const below = vals.filter((v) => v < now[1]).length;
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    return {
      label, short,
      value: now[1], date: now[0], median,
      pct: Math.round((below / vals.length) * 100),
      n: vals.length, from: s[0][0].slice(0, 7),
      lo: sorted[0], hi: sorted[sorted.length - 1],
    };
  }).filter(Boolean) as {
    label: string; short: string; value: number; date: string; median: number;
    pct: number; n: number; from: string; lo: number; hi: number;
  }[];

  if (rows.length === 0) return null;

  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <h2 className="text-base font-semibold text-[var(--ink)] mb-1">
        Against its own history
        <InfoTip title="Against its own history" className="ml-1.5">
          <p>Where today&rsquo;s valuation sits in this company&rsquo;s own record.</p>
          <p>
            Cheap and expensive mean nothing across industries; against the same
            company&rsquo;s past they mean something. Not a signal — a business can be worth
            more than it used to be.
          </p>
          <p>
            Each series ends {rows[0].date}, the last month with a filed trailing figure —
            not today&rsquo;s price.
          </p>
        </InfoTip>
      </h2>
      <div className="divide-y divide-[var(--line)]">
        {rows.map((r) => {
          // Today's value against the median of its own record, on one scale
          // from zero; the gap is printed, never coloured as good or bad.
          const top = Math.max(r.value, r.median, 0) * 1.15 || 1;
          const gap = r.median ? ((r.value - r.median) / Math.abs(r.median)) * 100 : null;
          return (
            <div key={r.label} className="py-1.5">
              <div className="grid grid-cols-[76px_44px_minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
                <span className="text-[var(--ink2)] truncate">{r.short}</span>
                <span className="text-right font-semibold text-[var(--ink)] tabular-nums">{fmtNum(r.value)}</span>
                <span className="relative h-1.5 rounded-full bg-[var(--line)]" aria-hidden="true">
                  <span className="absolute left-0 top-0 h-1.5 rounded-full bg-[var(--ink3)]" style={{ width: `${Math.max(0, (r.value / top) * 100)}%` }} />
                  <span className="absolute -top-[3px] w-[2px] h-3 bg-[var(--accent)]" style={{ left: `${Math.max(0, (r.median / top) * 100)}%` }} />
                </span>
                <span className="text-[11px] text-[var(--ink3)] tabular-nums whitespace-nowrap">
                  Med {fmtNum(r.median)}{gap !== null && <> · <span className="text-[var(--ink2)]">{gap > 0 ? "+" : gap < 0 ? "−" : ""}{Math.abs(gap).toFixed(0)}%</span></>}
                </span>
              </div>
              {/* The window is stated, not just its length: these series do not
                  reach equally far back. */}
              <p className="text-[10.5px] text-[var(--ink3)] tabular-nums mt-0.5">
                Lower than now on {r.pct}% of {r.n.toLocaleString("en-IN")} months since {periodLabel(`${r.from}-01`)} · range {fmtNum(r.lo)}–{fmtNum(r.hi)}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** What each figure is, where it comes from, and what it does and does not tell
 *  you. Written about THIS pipeline rather than as textbook definitions - the
 *  point is that a number here can be traced, and its weaknesses stated. */
export const METRIC_INFO: Record<string, { how: string; means: string; watch?: string }> = {
  "Market Cap": {
    how: "Latest close multiplied by shares outstanding. The share count is derived as market cap divided by price from the same snapshot, so the two always reconcile - the build refuses to publish if they ever stop agreeing.",
    means: "What the whole company costs at today's price. This is the figure to compare against profit, sales or net worth. The share price alone means nothing without it.",
  },
  "Current Price": {
    how: "The most recent daily close from the exchange feed. Every price carries the trading date it belongs to, and the build blocks any release where prices are more than six trading days old.",
    means: "The last traded price. Checked against Zerodha's official exchange data on a 240-company sample spanning large, mid and small caps: 212 of 212 matched exactly.",
    watch: "End of day, not a live tick. During market hours this is the previous close.",
  },
  "High / Low": {
    how: "Highest and lowest traded price over the last 52 weeks, from the daily price series.",
    means: "The range the market has actually paid this year. How far today sits below the high usually tells you more than the high itself.",
  },
  "Stock P/E": {
    how: "Price divided by earnings per share over the last four quarters as filed with NSE, one-offs included - the same figure the P/E chart draws. Where there is no current filed figure, Yahoo Finance's P/E stands in and the tile says \"Yahoo\". Where the two differ by more than 10%, Yahoo's is shown under it: on the 500 largest companies that is about one in ten, and either side can be the wrong one (Yahoo a quarter late, or a misread filing).",
    means: "Years of current profit you are paying for. Comparable against this company's own history and against genuine peers - never across industries.",
    watch: "Meaningless when profit is near zero or negative. One loss-making quarter inside a profitable year still leaves it positive.",
  },
  "P/E excl. one-offs": {
    how: "Core P/E is the P/E on the last four quarters' EPS as filed with NSE, then again with the exceptional items those filings state - land sales, write-downs, settlements - taken out at each quarter's own tax rate (25.17% where that rate is unusable).",
    means: "Shown when one-offs are a tenth of the year's profit or more. A one-off gain flatters the filed P/E for four quarters, a charge makes it look dear; the market prices the profit that repeats.",
    watch: "Assumes the one-off belongs wholly to shareholders; where a part-owned subsidiary booked it, the owners' share is smaller. Companies decide what they call exceptional, and some routine costs get the label.",
  },
  "Book Value": {
    how: "Shareholders' funds divided by shares outstanding, from the filed balance sheet.",
    means: "What the accounts say each share owns once every debt is paid. Useful for banks and asset-heavy businesses, nearly meaningless for software or brands whose value never appears on a balance sheet.",
  },
  "Dividend Yield": {
    how: "Dividend per share over the last year divided by the current price.",
    means: "The cash return at today's price, before any capital gain.",
    watch: "A high yield is as often a collapsed price as a generous dividend.",
  },
  "Business update": {
    how: "The company's own early look at the quarter - sales, loans, deposits, store count - filed with NSE before its results. Read off NSE's announcements each day; \"usually day N\" is the middle of the days after quarter end it filed them, from two quarters or more.",
    means: "Some of the quarter is known before the results. Over five quarters (116 companies), the share made a big move on 16.5% of update days - against 5.6% of ordinary days and 25-33% of results days.",
    watch: "Which way the share moved on the update did not tell which way it would move on results day - 46% the same way, close to a coin toss. Voluntary: a company can stop at any quarter.",
  },
  "ROCE": {
    how: "Operating profit divided by capital employed - total assets less current liabilities - from the filed annual statements.",
    means: "How hard the money inside the business works, regardless of how it was funded. The single most useful quality measure for an operating company.",
  },
  "ROE": {
    how: "Net profit divided by shareholders' funds.",
    means: "Return on the owners' money specifically.",
    watch: "Unlike ROCE it flatters companies that borrow heavily, because borrowing shrinks the denominator. Read the two together.",
  },
  "Sales growth 5Y": {
    how: "Compound annual growth in revenue across five years of filed annual results.",
    means: "Whether the business is genuinely bigger than it was, not merely more profitable. Considerably harder to manufacture than profit growth.",
  },
  "Profit growth 5Y": {
    how: "Compound annual growth in net profit across five years of filed annual results.",
    means: "The rate earnings have compounded. Compare against sales growth - profit rising far faster than sales is margin expansion, which eventually runs out.",
  },
  "Debt / Equity": {
    how: "Total borrowings divided by shareholders' funds, from the filed balance sheet.",
    means: "How much of the business is funded by lenders rather than owners. Above 1 means creditors have more at stake than shareholders do.",
    watch: "Normal and uninformative for banks and financial companies, whose business is borrowing.",
  },
  "Promoter holding": {
    how: "The promoter group's stake from the latest shareholding pattern filed with the exchange.",
    means: "How much the founders still own. A stake falling steadily over several quarters is worth understanding; a rising one is usually a good sign.",
  },
  "Volatility 1Y": {
    how: "Annualised Yang-Zhang volatility over roughly 250 trading days. Yang-Zhang uses each day's open, high, low and close rather than closes alone, so it captures overnight gaps and the intraday range and is far less noisy than the textbook close-to-close measure. Companies without OHLC history fall back to close-to-close, and the method used is recorded per company.",
    means: "How violently the price has actually moved, stated per year. Under 20% is calm, over 55% is wild. It sizes the swings you would have had to sit through.",
    watch: "This is REALISED volatility - what already happened. It is not implied volatility and contains no forecast. Computed from Yahoo daily prices and not yet verified against exchange data, unlike the closing price itself.",
  },
  "Volatility 30D": {
    how: "The same Yang-Zhang calculation over the last 30 trading days.",
    means: "Recent turbulence. Read it against the 1-year figure: much higher means something is happening now, much lower means it has gone quiet.",
    watch: "Thirty days is a small sample, so this number jumps around. Realised, not implied.",
  },
};

export function RatioGrid({ snapshot, row, cohort, next, updates, faceValue }: {
  snapshot: Row; row: Row | null; cohort: Cohort | null; next?: NextResults; updates?: Updates | null; faceValue?: number | null;
}) {
  const g = (k: string) => num(row, k) ?? num(snapshot, k);
  const method = String((row?.["vol_method"] ?? snapshot["vol_method"]) ?? "");
  // A missing value is a bare dash, never "₹ — Cr": a unit wrapped round
  // nothing dresses an absence up as a figure.
  const pct = (v: number | null) => (v === null ? "—" : `${fmtNum(v, Math.abs(v) >= 100 ? 0 : 1)}%`);
  const plain = (v: number | null) => (v === null ? "—" : fmtNum(v));
  const rupee = (v: number | null, dec = 2) => (v === null ? "—" : `₹${fmtNum(v, dec)}`);
  const price = g("price"), hi = g("wk52_high"), lo = g("wk52_low");
  const fromHi = price !== null && hi ? ((price - hi) / hi) * 100 : null;
  const fromLo = price !== null && lo ? ((price - lo) / lo) * 100 : null;
  const signedPct = (v: number | null) => (v === null ? null : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`);
  const debt = g("total_debt"), cash = g("total_cash"), mcap = g("mcap");
  const ev = mcap === null ? null : mcap + ((debt ?? 0) - (cash ?? 0)) / 1e7;
  const day = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", opts);
  // Where the P/E came from (export_json.py, 13-Nov-2026): the filings lead;
  // Yahoo's stands in, said so, where there is no current filed figure; and
  // where the two are more than 10% apart the other one is shown, not hidden.
  const peSrc = String(row?.["pe_src"] ?? ""), peGap = g("pe_gap"), peVendor = g("pe_vendor");
  const peNote: Partial<Tile> = peSrc === "vendor"
    ? { sub: "Yahoo", subFirst: true, full: "Yahoo Finance's P/E: no current figure from the company's own filings" }
    : peSrc === "filed" && peGap !== null && Math.abs(peGap) > 10 && peVendor !== null
      ? { sub: `Yahoo ${fmtNum(peVendor, 1)}`, subFirst: true,
          full: `From the filings ${plain(g("pe"))}; Yahoo Finance says ${fmtNum(peVendor, 1)}. The two disagree by ${fmtNum(Math.abs(peGap), 0)}% - check the latest results before relying on either.` }
      : {};
  // The P/E without one-offs, beside the one with them - only where they are
  // a tenth of the year's profit or more (oneoffs_lib.py). No dead tile.
  const oneoff = g("oneoff_pct"), peFiled = g("pe_filed"), peCore = g("pe_core"), epsCore = g("eps_core");
  const oneoffTile: Tile | null = oneoff !== null && peFiled !== null && Math.abs(oneoff) >= 10 ? {
    // Short enough for a quarter of a phone's width; the title carries the rest.
    label: "Core P/E", info: "P/E excl. one-offs",
    value: peCore === null ? "Loss" : plain(peCore),
    // The filed P/E it is measured against; the one-off share fits only in the title.
    sub: `Filed ${fmtNum(peFiled, 1)}`,
    full: `One-offs ${oneoff > 0 ? "+" : "−"}${fmtNum(Math.abs(oneoff), 1)}% of the year's profit. On filed earnings: P/E ${fmtNum(peFiled, 1)}. ` + (peCore === null
      ? "Without the one-offs there is no profit."
      : `Without one-offs: P/E ${fmtNum(peCore, 1)}${epsCore !== null ? `, EPS ₹${fmtNum(epsCore)}` : ""}.`),
  } : null;

  // Grouped by the question each one answers; four short groups is a page to
  // scan where fourteen rows were a list to read. `field` is the data.json
  // field an industry median is taken on - none for a per-share figure, whose
  // median across an industry compares nothing.
  const groups: [string, Tile[]][] = [
    ["Size and price", [
      { label: "MCap ₹Cr", info: "Market Cap", value: crShort(mcap), full: mcap === null ? undefined : `₹${fmtNum(mcap, 0)} Cr`,
        sub: cohort?.rank ? `#${cohort.rank.toLocaleString("en-IN")} of ${cohort.rankOf.toLocaleString("en-IN")}` : null },
      { label: "Ind. rank", value: cohort?.indRank ? `#${cohort.indRank}` : "—", sub: cohort?.indRank ? `of ${cohort.indRankOf}` : null },
      { label: "52W high", info: "High / Low", value: rupee(hi, 0), sub: fromHi === null ? null : signedPct(fromHi) },
      { label: "52W low", value: rupee(lo, 0), sub: fromLo === null ? null : signedPct(fromLo) },
    ]],
    ["What it costs", [
      { label: "Stock P/E", value: plain(g("pe")), field: "pe", ...peNote },
      ...(oneoffTile ? [oneoffTile] : []),
      { label: "Book value", info: "Book Value", value: rupee(g("book_value")), sub: "Per share" },
      { label: "Div. yield", info: "Dividend Yield", value: pct(g("div_yield")), field: "div_yield" },
      ...(faceValue ? [{ label: "Face value", value: `₹${fmtNum(faceValue, faceValue % 1 ? 2 : 0)}`, sub: "Per share" }] : []),
    ]],
    ["What it earns", [
      { label: "ROCE", value: pct(g("roce")), field: "roce" },
      { label: "ROE", value: pct(g("roe")), field: "roe" },
      { label: "Sales 5Y", info: "Sales growth 5Y", value: pct(g("sales_cagr_5y")), field: "sales_cagr_5y" },
      { label: "Profit 5Y", info: "Profit growth 5Y", value: pct(g("profit_cagr_5y")), field: "profit_cagr_5y" },
      { label: "Results", value: next ? day(next.date, { day: "numeric", month: "short" }) : "—",
        full: next ? day(next.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : undefined,
        sub: next ? `${periodLabel(quarterBefore(next.date))} qtr` : next === null ? "No date yet" : null },
      // Only for a company that files them (owner: no dead tiles).
      ...(updates ? [{ label: "Update", info: "Business update", value: day(updates.last.d, { day: "numeric", month: "short" }),
        sub: `${updates.n} of ${updates.of} qtrs`,
        full: [`${updates.last.q}`, `${updates.n} of ${updates.of} quarters`, updates.typ != null && `usually day ${updates.typ}`].filter(Boolean).join(" · ") }] : []),
    ]],
    ["Risk and ownership", [
      // Absolute debt and cash as well as the ratio: the ratio gives the shape
      // of the funding, these give its size against the profit.
      { label: "EV ₹Cr", info: "Enterprise value", value: crShort(ev), full: "Market cap plus debt, less cash" },
      { label: "Debt ₹Cr", value: debt === null ? "—" : crShort(debt / 1e7) },
      { label: "Cash ₹Cr", value: cash === null ? "—" : crShort(cash / 1e7) },
      { label: "Debt/equity", info: "Debt / Equity", value: plain(g("de")), field: "de" },
      { label: "Promoter", info: "Promoter holding", value: pct(g("promoter_holding")), field: "promoter_holding" },
      { label: "Vol. 1Y", info: "Volatility 1Y", value: pct(g("volatility_1y")), field: "volatility_1y" },
      { label: "Vol. 30D", info: "Volatility 30D", value: pct(g("volatility_30d")), field: "volatility_30d" },
    ]],
  ];

  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3 sm:p-4">
      <h2 className="text-base font-semibold text-[var(--ink)] px-1">
        Key figures
        <InfoTip title="Key figures" label="How these figures are worked out" className="ml-1.5">
          {groups.flatMap(([, tiles]) => tiles).map((t) => {
            const info = METRIC_INFO[t.info ?? t.label];
            if (!info) return null;
            return (
              <InfoPart key={t.label} head={t.info ?? t.label}>
                {info.how} {info.means}{info.watch ? ` ${info.watch}` : ""}
                {(t.info ?? t.label).startsWith("Volatility") && method && ` Method for this company: ${method === "yang-zhang" ? "Yang-Zhang (OHLC)" : "close-to-close"}.`}
              </InfoPart>
            );
          })}
          <p className="text-[var(--ink3)]">The bar under a figure puts this company (grey) and its industry median (blue line) on one scale. Neither colour means good or bad.</p>
        </InfoTip>
      </h2>
      <div className="mt-1 space-y-3">
        {groups.map(([heading, tiles]) => (
          <div key={heading}>
            <h3 className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ink3)] mb-1.5 px-1">{heading}</h3>
            <div className="grid grid-cols-4 gap-1.5">
              {tiles.map((t) => {
                const med = t.field && cohort ? industryMedian(cohort, t.field) : null;
                const mine = t.field ? g(t.field) : null;
                const medTxt = med ? (Math.abs(med.value) >= 100 ? fmtNum(med.value, 0) : fmtNum(med.value, 1)) : null;
                // Value and industry median on one scale from zero. Grey and
                // blue, never green or red: above the median is not good news.
                const top = med && mine !== null && mine > 0 && med.value > 0 ? Math.max(mine, med.value) * 1.1 : null;
                return (
                  <div key={t.label} className="min-w-0 rounded-lg bg-[var(--card2)] px-2 py-1.5" title={t.full}>
                    <p className="text-[10.5px] leading-tight text-[var(--ink3)] truncate">{t.label}</p>
                    <p className="text-[14px] leading-[18px] font-semibold text-[var(--ink)] tabular-nums truncate">{t.value}</p>
                    {t.subFirst && t.sub ? (
                      <p className="text-[10px] leading-tight text-[var(--warn-ink)] truncate tabular-nums">{t.sub}</p>
                    ) : med ? (
                      <p className="text-[10px] leading-tight text-[var(--accent-ink)] truncate tabular-nums"
                        title={`Industry median ${medTxt} across ${med.n} companies`}>
                        Ind {medTxt}{med.n < 15 ? ` (${med.n})` : ""}
                      </p>
                    ) : t.sub ? (
                      <p className="text-[10px] leading-tight text-[var(--ink3)] truncate">{t.sub}</p>
                    ) : null}
                    {top && mine !== null && med && (
                      <div className="relative h-[3px] mt-1.5 rounded-full bg-[var(--line)]" aria-hidden="true">
                        <div className="h-[3px] rounded-full bg-[var(--ink3)]" style={{ width: `${(mine / top) * 100}%` }} />
                        <div className="absolute -top-[2px] w-[2px] h-[7px] bg-[var(--accent)]" style={{ left: `${(med.value / top) * 100}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-[10.5px] text-[var(--ink3)] flex flex-wrap gap-x-3 gap-y-0.5">
        <span>Bar: this company <span className="inline-block align-middle w-3 h-[3px] rounded bg-[var(--ink3)]" /> vs industry median <span className="inline-block align-middle w-[2px] h-[7px] bg-[var(--accent)]" /></span>
      </p>
      <PinnedRatios row={row} />
    </section>
  );
}
