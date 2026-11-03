"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { compile, QueryError, Row } from "@/lib/query";
import { FIELD_CATALOG } from "@/lib/fields";

/** A screen tested against history (P10, 1-Nov-2026). Each 30 June from 2008
 *  the screen is run on what could be known that day - quarters count from
 *  their announcement date - and the companies that passed are followed for a
 *  year. Snapshots come from pipeline/export_backtest.py. A record of what
 *  happened, not a forecast and not a recommendation. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
type Index = { generated_at: string; fields: string[]; dates: string[]; counts: Record<string, number>; nifty: Record<string, number>;
  /** symbol -> sector, so a screen's sector filter applies here too */
  sectors?: Record<string, string> };
type YearResult = {
  year: string; universe: number; passed: number; unknown: number;
  /** Too few companies had the figures this screen needs for the year to mean
   *  anything: not a year of "nothing qualified" but a year that cannot be judged. */
  untestable: boolean;
  screenAvg: number | null; screenMed: number | null; allAvg: number | null; allMed: number | null; nifty: number | null;
  picks: [string, number | null][];
};

/** A year counts only when at least this many companies could be judged. */
const MIN_JUDGED = 100;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const med = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const tone = (v: number | null | undefined) => (v === null || v === undefined ? "text-[var(--ink3)]" : v >= 0 ? "text-[var(--pos)]" : "text-[var(--neg)]");
/** Growth of 100 across the years, each year's return compounded; a year with
 *  nothing passing sits in cash at 0%. */
const compound = (rs: (number | null)[]) => rs.reduce<number>((acc, r) => acc * (1 + (r ?? 0) / 100), 100);

function readRatios(): Record<string, string> {
  try {
    const list = JSON.parse(localStorage.getItem("rscreener_ratios") ?? "[]") as { name: string; formula: string }[];
    return Object.fromEntries(list.map((r) => [r.name, r.formula]));
  } catch { return {}; }
}

function BacktestInner() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get("q") ?? "pe < 20 and roe > 15";
  // The screen's sector filter, as the screener passes it (?sec=A,B).
  const secParam = params.get("sec") ?? "";
  const secs = useMemo(() => secParam.split(",").filter(Boolean), [secParam]);
  const [index, setIndex] = useState<Index | null>(null);
  const [years, setYears] = useState<Record<string, (string | number | null)[][]> | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${BASE}/backtest/index.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("The history has not been built yet."))))
      .then(async (ix: Index) => {
        if (!live) return;
        setIndex(ix);
        const all = await Promise.all(ix.dates.map((dt) => fetch(`${BASE}/backtest/${dt.slice(0, 4)}.json`).then((r) => r.json())));
        if (live) setYears(Object.fromEntries(ix.dates.map((dt, i) => [dt.slice(0, 4), all[i]])));
      })
      .catch((e) => { if (live) setErr(String(e.message ?? e)); });
    return () => { live = false; };
  }, []);

  const result = useMemo((): { rows: YearResult[]; error?: string } => {
    if (!index || !years) return { rows: [] };
    let run: (row: Row) => boolean | null;
    let used: string[] = [];
    try {
      const c = compile(q, readRatios(), index.fields);
      run = c.run;
      used = c.fields;
    } catch (e) {
      const msg = e instanceof QueryError ? e.message : String(e);
      return { rows: [], error: msg };
    }
    const F = index.fields;
    const rows: YearResult[] = [];
    for (const dt of index.dates) {
      const y = dt.slice(0, 4);
      const list = years[y] ?? [];
      const pass: number[] = [], every: number[] = [], picks: [string, number | null][] = [];
      let passed = 0, unknown = 0, complete = 0;
      for (const r of list) {
        const fwd = r[F.length + 1] as number | null;
        if (fwd !== null) every.push(fwd);
        const row: Row = { symbol: r[0] as string };
        F.forEach((f, i) => { row[f] = r[i + 1] as number | null; });
        if (used.every((f) => row[f] !== null && row[f] !== undefined)) complete++;
        // Outside the screen's sectors: not a pick, as on the screener.
        if (secs.length && index.sectors && !secs.includes(index.sectors[r[0] as string] ?? "")) continue;
        const ok = run(row);
        if (ok === null) { unknown++; continue; }
        if (!ok) continue;
        passed++;
        picks.push([r[0] as string, fwd]);
        if (fwd !== null) pass.push(fwd);
      }
      picks.sort((a, b) => (b[1] ?? -1e9) - (a[1] ?? -1e9));
      // Judged on companies holding EVERY field the screen uses: "P/E < 15 and
      // ROE > 15" is false for any P/E of 15 or more whatever ROE is, so a year
      // with no ROE at all would otherwise pass as tested.
      rows.push({
        year: y, universe: list.length, passed, unknown,
        untestable: complete < MIN_JUDGED,
        screenAvg: avg(pass), screenMed: med(pass), allAvg: avg(every), allMed: med(every),
        nifty: index.nifty[y] ?? null, picks,
      });
    }
    return { rows };
  }, [q, index, years, secs]);

  const rows = result.rows;
  // Only years the screen could be judged in, for all three columns alike, so
  // the comparison stays like for like.
  const usable = rows.filter((r) => !r.untestable);
  const skipped = rows.length - usable.length;
  const tested = usable.filter((r) => r.passed > 0);
  const total = {
    screen: compound(usable.map((r) => r.screenAvg)),
    all: compound(usable.map((r) => r.allAvg)),
    nifty: compound(usable.map((r) => r.nifty)),
  };
  // The middle company each year, compounded: what a typical pick did, which
  // a handful of tiny companies that multiplied cannot move.
  const typical = { screen: compound(usable.map((r) => r.screenMed)), all: compound(usable.map((r) => r.allMed)) };
  const beatMed = tested.filter((r) => r.screenMed !== null && r.allMed !== null && r.screenMed > r.allMed).length;
  const beatNifty = tested.filter((r) => r.screenAvg !== null && r.nifty !== null && r.screenAvg > r.nifty).length;
  const nYears = usable.length;
  const cagr = (v: number) => (nYears ? (Math.pow(v / 100, 1 / nYears) - 1) * 100 : null);
  const history = new Set(index?.fields ?? []);
  const label = (k: string) => FIELD_CATALOG.find((f) => f.key === k)?.label ?? k;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="screens" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          Test on history
          <InfoTip title="Test on history">
            <p>On 30 June of each year from 2008, the screen is run on the figures that could be known that day: a quarter counts only from the date it was announced. The companies that passed are then followed for twelve months, equal amounts in each.</p>
            <p><b>What this leaves out.</b> Only companies listed today are included; those that delisted or failed are missing, which makes every result look better than it was. Returns are price only, without dividends, and before costs and tax.</p>
            <p>Fields with no history (debt, ROCE, shareholding and others) cannot be tested and are named if a screen uses them.</p>
            <p>A record of what happened in these years, not a forecast and not a recommendation.</p>
          </InfoTip>
        </h1>

        <form key={q} onSubmit={(e) => {
          e.preventDefault();
          const v = String(new FormData(e.currentTarget).get("q") ?? "").trim();
          router.replace(`/backtest?q=${encodeURIComponent(v)}${secParam ? `&sec=${encodeURIComponent(secParam)}` : ""}`);
        }}
          className="flex gap-2">
          <input name="q" defaultValue={q} aria-label="Screen"
            className="flex-1 min-w-0 rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-[13px] font-mono" />
          <button className="rs-press shrink-0 rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] px-4 text-[13px] font-semibold">Run</button>
        </form>
        <p className="text-[11px] text-[var(--ink3)] flex items-center gap-1 flex-wrap">
          {history.size ? `${history.size} fields have history` : "Loading history"}
          {history.size > 0 && (
            <InfoTip title="Fields with history">
              <p>{[...history].map((k) => `${label(k)} (${k})`).join(", ")}.</p>
            </InfoTip>
          )}
          <Link href={`/screens?q=${encodeURIComponent(q)}${secParam ? `&sec=${encodeURIComponent(secParam)}` : ""}`} className="ml-auto underline">Open in Screener</Link>
        </p>
        {secs.length > 0 && (
          <p className="text-[12px] text-[var(--ink2)]">
            Only {secs.join(", ")}{index && !index.sectors ? " - not applied: this history was built before sectors were added; it applies after the next nightly run" : ""}
          </p>
        )}

        {err && <p className="text-sm text-[var(--neg)]">{err}</p>}
        {result.error && (
          <p className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 text-[13px] text-[var(--ink2)]">
            This screen cannot be tested: {result.error}.
            {" "}Only fields with history can be used here.
          </p>
        )}
        {!err && !result.error && !rows.length && <p className="text-sm text-[var(--ink3)]">Loading {index ? `${index.dates.length} years` : "history"}...</p>}

        {rows.length > 0 && (
          <>
            <section className="grid grid-cols-3 gap-2">
              {([["Screen", total.screen, typical.screen], ["All companies", total.all, typical.all], ["Nifty 50", total.nifty, null]] as [string, number, number | null][]).map(([k, v, m]) => (
                <div key={k} className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-2.5">
                  <p className="text-[11px] text-[var(--ink3)]">{k}</p>
                  <p className="text-[17px] font-bold tabular-nums">₹{Math.round(v).toLocaleString("en-IN")}</p>
                  <p className={`text-[11px] tabular-nums ${tone(cagr(v))}`}>{fmt(cagr(v))} a year</p>
                  {m !== null && <p className={`text-[11px] tabular-nums ${tone(cagr(m))}`}>Median {fmt(cagr(m))}</p>}
                </div>
              ))}
            </section>
            <p className="text-[12px] text-[var(--ink2)]">
              ₹100 over the {nYears} years the screen could be tested.
              {" "}Its median pick beat the median company in {beatMed} of {tested.length} years it picked anything, and its average beat the Nifty 50 in {beatNifty}.
              {tested.length < usable.length ? ` ${usable.length - tested.length} years with no pick sat in cash.` : ""}
              {skipped > 0 ? ` ${skipped} year${skipped === 1 ? "" : "s"} left out: too few companies had the figures this screen needs.` : ""}
            </p>

            <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--card)]">
              <table className="w-full text-[12.5px] tabular-nums">
                <thead className="text-[var(--ink3)] text-[11px]">
                  <tr className="border-b border-[var(--line)]">
                    <th className="px-2 py-2 text-left font-medium">From</th>
                    <th className="px-1.5 py-2 text-right font-medium">Passed</th>
                    <th className="px-1.5 py-2 text-right font-medium">Screen</th>
                    <th className="px-1.5 py-2 text-right font-medium">All</th>
                    <th className="px-1.5 py-2 text-right font-medium">Nifty</th>
                    <th className="px-2 py-2 text-right font-medium">Median</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <Fragment key={r.year}>
                      <tr onClick={() => setOpen(open === r.year ? null : r.year)}
                        className="border-b border-[var(--line)] last:border-0 cursor-pointer active:bg-[var(--card2)]">
                        <td className="px-2 py-1.5">Jun {r.year}</td>
                        {r.untestable ? (
                          <td colSpan={2} className="px-1.5 py-1.5 text-right text-[11px] text-[var(--ink3)]">Too few figures</td>
                        ) : (
                          <>
                            <td className="px-1.5 py-1.5 text-right">{r.passed}<span className="text-[var(--ink3)]">/{r.universe}</span></td>
                            <td className={`px-1.5 py-1.5 text-right font-semibold ${tone(r.screenAvg)}`}>{fmt(r.screenAvg)}</td>
                          </>
                        )}
                        <td className={`px-1.5 py-1.5 text-right ${tone(r.allAvg)}`}>{fmt(r.allAvg)}</td>
                        <td className={`px-1.5 py-1.5 text-right ${tone(r.nifty)}`}>{fmt(r.nifty)}</td>
                        <td className={`px-2 py-1.5 text-right ${tone(r.screenMed)}`}>{fmt(r.screenMed)}</td>
                      </tr>
                      {open === r.year && (
                        <tr className="border-b border-[var(--line)] bg-[var(--card2)]">
                          <td colSpan={6} className="px-2 py-2">
                            {r.picks.length ? (
                              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                                {r.picks.slice(0, 60).map(([s, f]) => (
                                  <Link key={s} href={`/company?s=${encodeURIComponent(s)}`} className="whitespace-nowrap">
                                    {s} <span className={tone(f)}>{fmt(f, 0)}</span>
                                  </Link>
                                ))}
                                {r.picks.length > 60 && <span className="text-[var(--ink3)]">and {r.picks.length - 60} more</span>}
                              </div>
                            ) : <p className="text-[12px] text-[var(--ink3)]">Nothing passed this year.</p>}
                            {(r.unknown > 0 || r.untestable) && <p className="mt-1 text-[11px] text-[var(--ink3)]">{r.untestable ? `Fewer than ${MIN_JUDGED} companies had every figure this screen uses, so this year is not counted.` : `${r.unknown} of ${r.universe} companies lacked a figure the screen needs and were left out.`}</p>}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[var(--ink3)] flex items-center gap-1">
              Screen and All: average one-year return, equal amounts in each company. Tap a year for its companies.
              <InfoTip title="Average and median">
                <p>The average is what equal amounts in every passing company would have returned. A few small companies that multiplied can lift it a long way, so the median, the middle company, is shown beside it.</p>
                <p>&quot;All companies&quot; holds thousands of very small companies, and only the ones still listed today: its average is lifted twice over and is not a fair yardstick. So the summary compares medians with medians, and the screen&apos;s average with the Nifty 50.</p>
                <p>A year where fewer than {MIN_JUDGED} companies had every figure the screen uses is shown as &quot;Too few figures&quot; and left out of all three totals. Book value, and so P/B and ROE, is missing for most companies from 2018 to 2022, when filings carried no balance sheet.</p>
              </InfoTip>
            </p>
          </>
        )}
      </main>
    </div>
  );
}

/** useSearchParams needs a Suspense boundary under static export. */
export default function Backtest() {
  return <Suspense><BacktestInner /></Suspense>;
}
