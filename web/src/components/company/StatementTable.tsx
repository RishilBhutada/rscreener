"use client";

/** The company page's statement tables: one table component shared by the
 *  results, accounts, ratios, segments and shareholding sections. */

import { ExternalGlyph } from "@/components/Glyphs";
import { useState } from "react";
import InfoTip, { InfoDialog } from "@/components/InfoTip";
import { TableKind, TableView, arrange, change, changeText, usePct, useRowOrder, useView } from "@/lib/tableprefs";
import { move } from "@/lib/order";
import { Stmt, Company, WcRatios, NextResults, Segments } from "@/components/company/types";
import { amtDec, fmtNum, periodLabel, declaredLabel, RECENT_PERIODS, quarterAfter, quarterBefore, isQuarterly, yearBefore, heatTint } from "@/components/company/format";

/** One row's last few periods as a line; the end dot says which way it last moved. */
export function Spark({ values }: { values: (number | null)[] }) {
  const W = 48, H = 18, P = 2;
  const pts: [number, number][] = [];
  values.forEach((v, i) => { if (typeof v === "number" && Number.isFinite(v)) pts.push([i, v]); });
  if (pts.length < 2) return <span className="block w-[48px]" aria-hidden="true" />;
  const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1])), r = hi - lo || 1;
  const x = (i: number) => P + (i * (W - 2 * P)) / Math.max(1, values.length - 1);
  const y = (v: number) => P + ((hi - v) / r) * (H - 2 * P);
  const [li, lv] = pts[pts.length - 1], pv = pts[pts.length - 2][1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden="true" className="block">
      <polyline points={pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
        stroke="var(--ink3)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(li)} cy={y(lv)} r="2" fill={lv > pv ? "var(--pos)" : lv < pv ? "var(--neg)" : "var(--ink3)"} />
    </svg>
  );
}

/** A change, green when the figure rose and red when it fell - the literal
 *  direction, never a judgement on whether that is good. */
export function Delta({ cur, prev, points }: { cur: number | null | undefined; prev: number | null | undefined; points: boolean }) {
  const ch = change(cur, prev, points);
  if (ch === null) return <span className="text-[var(--ink3)]">—</span>;
  return (
    <span className={ch > 0 ? "text-[var(--pos)]" : ch < 0 ? "text-[var(--neg)]" : "text-[var(--ink3)]"}>
      {changeText(ch, points, cur, prev)}
    </span>
  );
}

/** The Trend | Grid switch at the top right of every table. */
export function ViewSwitch({ view, onChange }: { view: TableView; onChange: (v: TableView) => void }) {
  return (
    <div className="shrink-0 inline-flex gap-0.5 rounded-lg bg-[var(--card2)] p-0.5 text-xs" role="radiogroup" aria-label="Table view">
      {([["trend", "Trend"], ["grid", "Grid"]] as const).map(([k, label]) => (
        <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => onChange(k)}
          className={`min-h-[28px] rounded-md px-2.5 font-medium ${view === k ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function StatementTable({ title, stmt, subtitle, boldRows, next, kind, symbol, pdfs, info, ttm }: {
  title: string; stmt: Stmt; subtitle?: string; boldRows?: string[];
  /** The annual table's trailing-twelve-month column, shown last in the grid. */
  ttm?: { asOf: string; values: Record<string, number | null> } | null;
  /** The results PDF for each period, aligned with stmt.periods ("Raw PDF" row). */
  pdfs?: (string | null)[];
  /** The coming quarter, named in the grid's top-left corner - the quarterly table only. */
  next?: NextResults;
  /** Which table this is, for its "%" switch and row order; and whose page. */
  kind: TableKind; symbol: string;
  /** The "i" beside the title, where a table has one. */
  info?: import("react").ReactNode;
}) {
  // The basis most of the table's periods are on; any other period is marked.
  const mainBasis = (() => {
    const n: Record<string, number> = {};
    for (const b of stmt.basis ?? []) if (b) n[b] = (n[b] ?? 0) + 1;
    const top = Object.entries(n).sort((x, y) => y[1] - x[1])[0];
    return top ? top[0] : null;
  })();
  const [all, setAll] = useState(false);
  const [showPct, setShowPct] = usePct(kind);
  const [view, setView] = useView(kind);
  const trend = view === "trend";
  const quarterlyCols = isQuarterly(stmt.periods);
  const decOf = (label: string, v?: unknown) => kind === "ratios" ? 1 : label.includes("EPS") || label.includes("%") ? 2 : amtDec(v);
  const saved = useRowOrder(kind, symbol);
  // Reordering: the order being edited, and whether to ask where it applies.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [asking, setAsking] = useState(false);
  const total = stmt.periods.length;
  const from = all ? 0 : Math.max(0, total - RECENT_PERIODS);
  // Newest first (owner, 3-Nov-2026): the latest period is the first column,
  // older ones follow to the right, and the grid scrolls on into history.
  const cols = Array.from({ length: total - from }, (_, k) => total - 1 - k);
  const coming = next !== undefined && total ? quarterAfter(stmt.periods[total - 1]) : null;
  // The meeting's date belongs on that column only if it is that quarter's.
  const due = coming && next && quarterBefore(next.date) === coming ? next.date : null;
  // Breakdown rows (with a parent) fold under their parent's "+" and move with it.
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const top = stmt.items.filter((it) => !it.parent);
  const kids = (l: string) => stmt.items.filter((it) => it.parent === l);
  const labels = top.map((it) => it.label);
  const arranged = arrange(labels, saved.order);
  const order = draft ?? arranged;
  const byLabel = new Map(top.map((it) => [it.label, it]));
  const rows = order.map((l) => byLabel.get(l)).filter((it): it is Stmt["items"][number] => Boolean(it));
  const shown = rows.flatMap((it, r) => [{ it, r, child: false },
    ...(openRows[it.label] && !draft ? kids(it.label).map((k) => ({ it: k, r, child: true })) : [])]);
  const finish = () => {
    if (!draft || draft.join("|") === arranged.join("|")) { setDraft(null); return; }
    setAsking(true);
  };
  const keep = (scope: "company" | "all") => { if (draft) saved.save(draft, scope); setDraft(null); setAsking(false); };
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
      <div className="px-4 pt-3.5 pb-2 flex items-start gap-1.5">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-[var(--ink)]">{title}{info}</h2>
          <p className="text-xs text-[var(--ink3)] mt-0.5">
            {draft ? "Move rows with the arrows, then Done"
              : `${subtitle ?? "₹ Cr"}`}
            {/* The coming quarter sits in the grid's corner; in the trend view it is said here. */}
            {!draft && trend && coming && ` · ${periodLabel(coming)} results ${due ? `due ${declaredLabel(due)}` : "date not out"}`}
          </p>
        </div>
        {draft ? (
          <>
            <button type="button" onClick={() => setDraft(labels)}
              className="shrink-0 min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold text-[var(--ink2)] border border-[var(--line)]">
              Reset
            </button>
            <button type="button" onClick={finish}
              className="shrink-0 min-h-[32px] px-3 rounded-lg text-[12px] font-semibold bg-[var(--accent-fill)] text-[var(--accent-fill-ink)]">
              Done
            </button>
          </>
        ) : (
          <>
            <ViewSwitch view={view} onChange={setView} />
          </>
        )}
      </div>
      {/* The table's other tools sit under the title, so the title keeps the row
          and the Trend | Grid switch stays at the top right. */}
      {!draft && (
        <div className="px-4 pb-2 -mt-0.5 flex justify-end gap-1.5">
              {/* On by default; one tap turns this table's figures' change on or off. */}
              {!trend && <button type="button" onClick={() => setShowPct(!showPct)} aria-pressed={showPct}
                aria-label={showPct ? "Hide the % change" : "Show the % change"} title="% change from the period before"
                className={`shrink-0 min-h-[32px] min-w-[32px] px-2 rounded-lg text-[13px] font-bold border ${showPct
                  ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)]"
                  : "text-[var(--ink3)] border-[var(--line)]"}`}>
                %
              </button>}
              <button type="button" onClick={() => setDraft(arranged)} aria-label="Change the order of the rows" title="Row order"
                className="shrink-0 min-h-[32px] min-w-[32px] px-2 rounded-lg text-[var(--ink2)] border border-[var(--line)] inline-flex items-center justify-center">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 4v16M3.5 7.5 7 4l3.5 3.5M17 20V4M13.5 16.5 17 20l3.5-3.5" />
                </svg>
              </button>
              {!trend && total > RECENT_PERIODS && (
                <button type="button" onClick={() => setAll(!all)}
                  className="shrink-0 min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold text-[var(--accent-ink)] bg-[var(--accent-soft)]">
                  {all ? `Last ${RECENT_PERIODS}` : `All ${total}`}
                </button>
              )}
        </div>
      )}
      {/* Opens on the NEWEST period, which is the first column: newest on the
          left, older to the right, scrolling on into history. The pinned label
          column stays put either way. */}
      {trend && !draft ? (() => {
        const last = total - 1;
        const cols = quarterlyCols ? "grid-cols-[minmax(84px,1fr)_48px_minmax(52px,auto)_46px_46px]" : "grid-cols-[minmax(84px,1fr)_48px_minmax(52px,auto)_56px]";
        const span = Math.min(8, total);
        const recentPdfs = pdfs ? pdfs.map((u, i) => [u, stmt.periods[i]] as const).filter(([u]) => Boolean(u)).slice(-4).reverse() : [];
        return (
          <div className="px-4 pb-3">
            <div className={`grid ${cols} gap-x-1.5 items-end py-1.5 border-y border-[var(--line)] text-[11px] text-[var(--ink3)]`}>
              <span className="truncate">{span} {quarterlyCols ? "quarters" : "years"}</span>
              <span>Trend</span>
              <span className="text-right whitespace-nowrap">{last >= 0 ? periodLabel(stmt.periods[last]) : ""}</span>
              <span className="text-right">{quarterlyCols ? "YoY" : "Change"}</span>
              {quarterlyCols && <span className="text-right">QoQ</span>}
            </div>
            {shown.map(({ it, child }) => {
              const bold = boldRows?.includes(it.label);
              const hasKids = !child && kids(it.label).length > 0;
              const points = it.label.includes("%");
              const cur = last >= 0 ? it.values[last] ?? null : null;
              return (
                <div key={it.label} className={`grid ${cols} gap-x-1.5 items-center py-1.5 border-b border-[var(--line)] text-sm`}>
                  <span className={`min-w-0 truncate ${child ? "pl-3 text-[13px] text-[var(--ink3)]" : bold ? "font-semibold text-[var(--ink)]" : "text-[var(--ink2)]"}`}>
                    {hasKids ? (
                      <button type="button" onClick={() => setOpenRows({ ...openRows, [it.label]: !openRows[it.label] })}
                        aria-expanded={!!openRows[it.label]} className="inline-flex items-center gap-1 text-left max-w-full">
                        <span className="truncate">{it.label}</span>
                        <span className="text-[var(--accent-ink)] font-semibold">{openRows[it.label] ? "−" : "+"}</span>
                      </button>
                    ) : it.label}
                  </span>
                  <Spark values={it.values.slice(Math.max(0, total - span))} />
                  <span className={`text-right tabular-nums whitespace-nowrap ${bold ? "font-semibold" : "font-medium"} ${typeof cur === "number" && cur < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]"}`}>
                    {fmtNum(cur, decOf(it.label, cur))}
                  </span>
                  <span className="text-right text-[11px] sm:text-[12px] tabular-nums whitespace-nowrap">
                    <Delta cur={cur} prev={last >= 0 ? yearBefore(stmt.periods, it.values, last, quarterlyCols) : null} points={points} />
                  </span>
                  {quarterlyCols && (
                    <span className="text-right text-[11px] sm:text-[12px] tabular-nums whitespace-nowrap">
                      <Delta cur={cur} prev={last > 0 ? it.values[last - 1] : null} points={points} />
                    </span>
                  )}
                </div>
              );
            })}
            {recentPdfs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-2 text-[12px]">
                <span className="text-[var(--ink3)]">Raw PDF</span>
                {recentPdfs.map(([u, p]) => (
                  <a key={p} href={u!.includes("://") ? u! : `https://nsearchives.nseindia.com/corporate/${u}`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] px-2 py-0.5 text-[var(--ink2)] hover:text-[var(--accent-ink)]">
                    {periodLabel(p)} <ExternalGlyph size={12} />
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })() : (
      <div key={from} className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
              {/* The corner above the row names carries the coming quarter -
                  no blank column of its own. */}
              <th className="px-3 py-2 text-left font-medium sticky left-0 bg-[var(--card)] align-bottom">
                {coming ? (
                  <span className="block whitespace-nowrap text-[var(--accent-ink)] font-semibold">
                    Next: {periodLabel(coming)}
                    <span className="block font-normal text-[11px] text-[var(--ink3)]">{due ? `due ${declaredLabel(due)}` : "date not out"}</span>
                  </span>
                ) : " "}
              </th>
              {ttm && (
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap border-r border-[var(--line)]">
                  TTM
                  <span className="block font-normal text-[11px] text-[var(--ink3)]">(to {periodLabel(ttm.asOf)})</span>
                </th>
              )}
              {cols.map((at) => {
                const dec = declaredLabel(stmt.declared?.[at]);
                // A period on the other basis from most of the table says so in
                // its header: the newest years can be rebuilt from quarters on
                // the other basis, and one caption for all of them misled
                // (review 5-Nov-2026: 88 companies).
                const b = stmt.basis?.[at];
                const odd = b && mainBasis && b !== mainBasis;
                return (
                  <th key={stmt.periods[at]} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                    {periodLabel(stmt.periods[at])}
                    {dec && <span className="block font-normal text-[11px] text-[var(--ink3)]">({dec})</span>}
                    {odd && <span className="block font-normal text-[11px] text-[var(--warn-ink)]">{b === "standalone" ? "Standalone" : "Consolidated"}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map(({ it, r, child }) => {
              const bold = boldRows?.includes(it.label);
              const hasKids = !child && kids(it.label).length > 0;
              return (
                <tr key={it.label} className={`border-b border-[var(--line)] hover:bg-[var(--card2)] ${child ? "text-[13px]" : ""}`}>
                  <td className={`px-3 py-2 sm:py-1.5 truncate max-w-[42vw] sm:max-w-none sm:whitespace-nowrap sticky left-0 bg-[var(--card)] ${child ? "pl-7 text-[var(--ink3)]" : bold ? "font-semibold text-[var(--ink)]" : "text-[var(--ink2)]"}`}>
                    {draft && !child && (
                      <span className="inline-flex align-middle mr-1.5">
                        <button type="button" disabled={r === 0} onClick={() => setDraft(move(order, it.label, -1))}
                          aria-label={`Move ${it.label} up`}
                          className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-[var(--line)] text-[var(--ink2)] disabled:opacity-30">▲</button>
                        <button type="button" disabled={r === rows.length - 1} onClick={() => setDraft(move(order, it.label, 1))}
                          aria-label={`Move ${it.label} down`}
                          className="w-7 h-7 ml-1 inline-flex items-center justify-center rounded-md border border-[var(--line)] text-[var(--ink2)] disabled:opacity-30">▼</button>
                      </span>
                    )}
                    {hasKids && !draft ? (
                      <button type="button" onClick={() => setOpenRows({ ...openRows, [it.label]: !openRows[it.label] })}
                        aria-expanded={!!openRows[it.label]} className="inline-flex items-center gap-1 text-left">
                        {it.label}
                        <span className="text-[var(--accent-ink)] font-semibold">{openRows[it.label] ? "−" : "+"}</span>
                      </button>
                    ) : it.label}
                  </td>
                  {ttm && (() => {
                    const v = ttm.values[child ? `${it.parent}/${it.label}` : it.label] ?? null;
                    return (
                      <td className={`px-3 py-2 sm:py-1.5 text-right whitespace-nowrap tabular-nums border-r border-[var(--line)] ${bold ? "font-semibold" : ""} ${typeof v === "number" && v < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]"}`}>
                        {fmtNum(v, decOf(it.label, v))}
                      </td>
                    );
                  })()}
                  {cols.map((at) => {
                    // Against the period before it - the column to its right,
                    // or the one past the last shown, so every column has one.
                    const v = it.values[at] ?? null, points = it.label.includes("%");
                    const prev = at > 0 ? it.values[at - 1] : null;
                    const ch = showPct ? change(v, prev, points) : null;
                    return (
                      <td key={at} style={{ background: heatTint(v, prev, points) }}
                        className={`px-3 py-2 sm:py-1.5 text-right whitespace-nowrap tabular-nums ${bold ? "font-semibold" : ""} ${typeof v === "number" && v < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]"}`}>
                        {fmtNum(v, decOf(it.label, v))}
                        {ch !== null && (
                          <span className={`ml-1 text-[11px] font-normal ${ch > 0 ? "text-[var(--pos)]" : ch < 0 ? "text-[var(--neg)]" : "text-[var(--ink3)]"}`}>
                            ({changeText(ch, points, v, prev)})
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {pdfs && !draft && pdfs.slice(from).some(Boolean) && (
              <tr className="border-b border-[var(--line)]">
                <td className="px-3 py-2 sm:py-1.5 sticky left-0 bg-[var(--card)] text-[var(--ink2)]">Raw PDF</td>
                {ttm && <td />}
                {cols.map((at) => {
                  const u = pdfs[at];
                  return (
                    <td key={at} className="px-3 py-2 sm:py-1.5 text-right">
                      {u ? <a href={u.includes("://") ? u : `https://nsearchives.nseindia.com/corporate/${u}`} target="_blank" rel="noopener noreferrer"
                        aria-label={`Results PDF, ${periodLabel(stmt.periods[at])}`} className="inline-flex text-[var(--accent-ink)]"><ExternalGlyph size={14} /></a> : null}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
      {!draft && saved.scope === "company" && (
        <p className="px-4 py-2 text-[11px] text-[var(--ink3)]">Rows in this company&apos;s own order.</p>
      )}
      {asking && draft && (
        <InfoDialog title="Use this order for every company?" onClose={() => setAsking(false)}>
          <p>{title} rows in this order on every company&apos;s page.</p>
          <p className="text-[12px] text-[var(--ink3)]">
            A company with a row this one does not have keeps that row in its usual place. You can change the order again from any company.
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" onClick={() => keep("company")}
              className="rs-press min-h-[44px] rounded-xl border border-[var(--line)] text-[14px] font-medium text-[var(--ink2)]">
              No, only {symbol}
            </button>
            <button type="button" onClick={() => keep("all")}
              className="rs-press min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
              Yes, all companies
            </button>
          </div>
        </InfoDialog>
      )}
    </section>
  );
}

export function RatiosTable({ r, symbol }: { r: WcRatios; symbol: string }) {
  // The one section screener.in has that this app did not. Every figure is
  // arithmetic on filed lines, and a year missing an input shows a dash rather
  // than a zero - a nought-day cash conversion cycle is a remarkable business,
  // not an absent number.
  const ROWS: [string, keyof WcRatios, string][] = [
    ["Debtor Days", "debtor_days", "How long customers take to pay"],
    ["Inventory Days", "inventory_days", "How long stock sits before it sells"],
    ["Days Payable", "days_payable", "How long the company takes to pay suppliers"],
    ["Cash Conversion Cycle", "cash_conversion", "Debtor + inventory − payable. Negative means suppliers fund the business"],
    ["Working Capital Days", "working_capital_days", "Working capital as days of sales"],
    ["ROCE %", "roce", "Operating profit over capital employed"],
  ];
  return (
    <div id="ratios" className="scroll-mt-32">
      <StatementTable title="Ratios" kind="ratios" symbol={symbol} subtitle="Days, and ROCE in %"
        stmt={{ periods: r.periods, items: ROWS.map(([label, key]) => ({ label, values: (r[key] as (number | null)[]) ?? [] })) }}
        info={
          <InfoTip title="Ratios" className="ml-1.5">
            <p>How the business is financed, year by year.</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {ROWS.map(([label, , help]) => <li key={label}><strong>{label}</strong>: {help}</li>)}
            </ul>
            <p>
              Computed from the filed balance sheet and income statement — nothing here is
              estimated. A year missing an input shows a dash rather than a zero.
            </p>
          </InfoTip>
        } />
    </div>
  );
}

export function SegmentsTable({ segs, symbol }: { segs: { quarterly?: Segments; annual?: Segments }; symbol: string }) {
  const [pt, setPt] = useState<"quarterly" | "annual">(segs.quarterly ? "quarterly" : "annual");
  const [what, setWhat] = useState<"rev" | "ebit">("rev");
  const sg = segs[pt] ?? segs.quarterly ?? segs.annual;
  if (!sg) return null;
  const seg = (v: string, opts: readonly (readonly [string, string])[], set: (k: never) => void, label: string) => (
    <div className="inline-flex gap-0.5 rounded-lg bg-[var(--card2)] p-0.5 text-xs" role="radiogroup" aria-label={label}>
      {opts.map(([k, l]) => (
        <button key={k} type="button" role="radio" aria-checked={v === k} onClick={() => set(k as never)}
          className={`rounded-md px-2.5 py-1 font-medium ${v === k ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>{l}</button>
      ))}
    </div>
  );
  return (
    <div id="segments" className="scroll-mt-32 space-y-1.5">
      <div className="flex justify-end gap-1.5 flex-wrap">
        {segs.quarterly && segs.annual && seg(pt, [["quarterly", "Quarterly"], ["annual", "Yearly"]], setPt as (k: never) => void, "Segment periods")}
        {seg(what, [["rev", "Revenue"], ["ebit", "EBIT"]], setWhat as (k: never) => void, "Segment figure")}
      </div>
      <StatementTable title="Segments" kind="segments" symbol={symbol}
        subtitle={what === "rev" ? "₹ Cr · before inter-segment sales" : "₹ Cr · profit before interest and tax"}
        stmt={{ periods: sg.periods, items: sg.items.map((it) => ({ label: it.name, values: what === "rev" ? it.rev : it.ebit })) }} />
    </div>
  );
}

/** Shareholding, quarterly or year by year (the March filing of each year). */
export function ShareholdingTable({ sh, symbol }: { sh: NonNullable<Company["shareholding"]>; symbol: string }) {
  const [yearly, setYearly] = useState(false);
  const idx = sh.dates.map((d, i) => [d, i] as const).filter(([d]) => !yearly || String(d).slice(5, 7) === "03").map(([, i]) => i);
  const pickV = (v?: (number | null)[] | null) => (v ? idx.map((i) => v[i] ?? null) : null);
  const parentOf: Record<string, string> = { Promoters: "Promoters %", FIIs: "FIIs %", DIIs: "DIIs %", Public: "Public %", "DR holders": "Public %" };
  const named = (sh.named ?? []).map((h) => ({ label: `${h.name} %`, values: pickV(h.values) ?? [], parent: parentOf[h.cat] ?? "Public %" }))
    .filter((h) => h.values.some((v) => v !== null));
  const items = [
    { label: "Promoters %", values: pickV(sh.promoter) },
    { label: "FIIs %", values: pickV(sh.fii) },
    { label: "DIIs %", values: pickV(sh.dii) },
    { label: "Mutual funds %", values: pickV(sh.mf) },
    { label: "Government %", values: pickV(sh.gov) },
    { label: "Public %", values: pickV(sh.public) },
    { label: "Employee trusts %", values: pickV(sh.employee) },
    { label: "No. of shareholders", values: pickV(sh.holders_n) },
  ].filter((it): it is { label: string; values: (number | null)[] } => !!it.values && it.values.some((v) => v !== null && v !== 0))
    .concat(named.filter((h, i, a) => a.findIndex((x) => x.label === h.label && x.parent === h.parent) === i));
  return (
    <>
      <div className="flex justify-end mb-1.5">
        <div className="inline-flex gap-0.5 rounded-lg bg-[var(--card2)] p-0.5 text-xs" role="radiogroup" aria-label="Shareholding periods">
          {([[false, "Quarterly"], [true, "Yearly"]] as const).map(([y, label]) => (
            <button key={label} type="button" role="radio" aria-checked={yearly === y} onClick={() => setYearly(y)}
              className={`rounded-md px-2.5 py-1 font-medium ${yearly === y ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>{label}</button>
          ))}
        </div>
      </div>
      <StatementTable title="Shareholding pattern" subtitle="Figures in %" kind="shareholding" symbol={symbol}
        stmt={{ periods: idx.map((i) => sh.dates[i]), items }} />
    </>
  );
}
