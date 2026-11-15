"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { Segmented } from "@/components/ListUI";
import { labOn } from "@/lib/destinations";
import {
  DEFAULTS, DTE_BANDS, MOVE_BANDS, OptLab, Params, VIX_BANDS, WEEKDAYS,
  dteBand, group, GroupRow, moveBand, run, stats, vixBand,
} from "@/lib/optlab";

/** The Options lab: buy a Nifty call and put near one day's close, sell both
 *  the next trading day - tested on ten years of the exchange's daily files.
 *  RESEARCH ONLY: no order is placed or prepared here. The owner's plan puts
 *  F&O after Phase-3 (owner, 15-Nov-2026). optlab.json + lib/optlab.ts. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const pts = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: d })}`;
const rs = (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
const tone = (v: number) => (v > 0 ? "text-[var(--pos)]" : v < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]");
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });

const EXPIRY: readonly (readonly [Params["expiry"], string])[] = [["near", "Nearest"], ["next", "Next one"]];
const EXIT: readonly (readonly [Params["exit"], string])[] = [["open", "Next open"], ["close", "Next close"]];
const ONOFF: readonly (readonly ["on" | "off", string])[] = [["on", "On"], ["off", "Off"]];

function Num({ label, value, onChange, step = 1, min = 0, hint }: {
  label: string; value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; hint?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-2 min-h-[40px]">
      <span className="text-[13px] text-[var(--ink2)]">{label}{hint && <span className="block text-[11px] text-[var(--ink3)]">{hint}</span>}</span>
      <input type="number" inputMode="decimal" step={step} min={min} value={value ?? ""} placeholder="any"
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-20 h-9 px-2 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-right text-[14px] tabular-nums outline-none focus:border-[var(--accent-line)]" />
    </label>
  );
}

function Breakdown({ title, rows, note, lot }: { title: string; rows: GroupRow[]; note?: string; lot: number }) {
  if (!rows.length) return null;
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
      <h3 className="px-3 pt-2.5 text-[13px] font-semibold">{title}</h3>
      {note && <p className="px-3 text-[11px] text-[var(--ink3)]">{note}</p>}
      <div className="grid grid-cols-[minmax(0,1fr)_40px_40px_54px_78px] gap-1 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ink3)] border-b border-[var(--line)]">
        <span /><span className="text-right">Nights</span><span className="text-right">Win</span><span className="text-right">Avg pts</span><span className="text-right">Total / lot</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_40px_40px_54px_78px] gap-1 px-3 py-1.5 text-[12.5px] tabular-nums border-b border-[var(--line)] last:border-b-0">
          <span className="truncate">{r.key}</span>
          <span className="text-right text-[var(--ink2)]">{r.n}</span>
          <span className="text-right text-[var(--ink2)]">{r.winRate.toFixed(0)}%</span>
          <span className={`text-right ${tone(r.avg)}`}>{pts(r.avg)}</span>
          <span className={`text-right ${tone(r.total)}`}>{rs(r.total * lot)}</span>
        </div>
      ))}
    </section>
  );
}

export default function OptLabPage() {
  const [lab, setLab] = useState<OptLab | null>(null);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [p, setP] = useState<Params>(DEFAULTS);
  const set = (x: Partial<Params>) => setP((q) => ({ ...q, ...x }));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from this browser's storage after mount; the prerendered page has none
    setEnabled(labOn());
    fetch(`${BASE}/optlab.json`)
      .then((r) => { if (!r.ok) throw new Error(r.status === 404 ? "The option history has not been published yet. It is written by the nightly run." : `HTTP ${r.status}`); return r.json(); })
      .then((d: OptLab) => { setLab(d); setP((q) => ({ ...q, lot: d.lot })); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  const trades = useMemo(() => (lab ? run(lab, p) : []), [lab, p]);
  const st = useMemo(() => stats(trades), [trades]);
  const years = useMemo(() => (lab ? [...new Set(lab.days.map((d) => d[0].slice(0, 4)))] : []), [lab]);
  const curve = useMemo(
    () => trades.reduce<number[]>((acc, t) => { acc.push((acc[acc.length - 1] ?? 0) + t.net * p.lot); return acc; }, []),
    [trades, p.lot]);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="optlab" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          Options lab
          <InfoTip title="Options lab">
            <p><b>The test.</b> Near one day&apos;s close, buy one Nifty call and one Nifty put. Sell both the next trading day. Repeat every night for ten years and add it up.</p>
            <p><b>Prices.</b> From NSE&apos;s daily F&amp;O files: each option&apos;s closing price on the entry day and its first traded price (or close) the next day. A night is skipped if either option did not trade on either day.</p>
            <p><b>At the money</b> is the strike where the call and the put cost most nearly the same.</p>
            <p><b>Costs</b>, at today&apos;s rates for every year: the bid-ask spread on four trades, brokerage on four orders, STT 0.1% of the premium sold, exchange and SEBI charges, stamp duty, GST. Not checked against a contract note.</p>
            <p>Nifty and India VIX levels are from Yahoo Finance. Nothing here is checked further.</p>
          </InfoTip>
        </h1>

        <section className="rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] text-[var(--warn-ink)] px-3 py-2.5 text-[13px] leading-relaxed">
          <b>Research only.</b>{" "}This page places no trade and gives no advice. Your plan puts futures and options after Phase-3,
          and SEBI found about 9 in 10 retail F&amp;O traders lose money. A result on history is not a forecast.
          <span className="block mt-1"><b>What it cannot test:</b> selling &quot;at break-even or a profit&quot; during the morning. That needs
          minute-by-minute option prices; this uses the next day&apos;s first trade or its close.</span>
        </section>

        {enabled === false && (
          <p className="text-[13px] text-[var(--ink3)]">The Options lab tab is switched off. <Link href="/settings" className="text-[var(--accent-ink)] underline">Turn it on in Settings</Link> to keep it under Research.</p>
        )}
        {error && <p className="text-[var(--neg)] text-sm">{error}</p>}
        {!lab && !error && <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}

        {lab && (
          <>
            <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3 space-y-1">
              <h2 className="text-[13px] font-semibold mb-1">The trade</h2>
              <Num label="Strikes out of the money" hint="0 = both at the money (straddle)" value={p.width} min={0} onChange={(v) => set({ width: Math.min(lab.span, Math.max(0, Math.round(v ?? 0))) })} />
              <div className="flex items-center justify-between gap-2 min-h-[40px]"><span className="text-[13px] text-[var(--ink2)]">Expiry</span><Segmented label="Expiry" value={p.expiry} options={EXPIRY} onChange={(v) => set({ expiry: v })} /></div>
              <Num label="Days to expiry, at least" value={p.minDte} min={1} onChange={(v) => set({ minDte: Math.max(1, Math.round(v ?? 1)) })} />
              <div className="flex items-center justify-between gap-2 min-h-[40px]"><span className="text-[13px] text-[var(--ink2)]">Sell at</span><Segmented label="Sell at" value={p.exit} options={EXIT} onChange={(v) => set({ exit: v })} /></div>
              <h2 className="text-[13px] font-semibold pt-2">Costs</h2>
              <Num label="Spread lost per option, per trade" hint="Index points; 4 trades a night" value={p.slip} step={0.25} onChange={(v) => set({ slip: Math.max(0, v ?? 0) })} />
              <Num label="Brokerage per order, ₹" value={p.brokerage} step={5} onChange={(v) => set({ brokerage: Math.max(0, v ?? 0) })} />
              <Num label="Lot size" value={p.lot} min={1} onChange={(v) => set({ lot: Math.max(1, Math.round(v ?? lab.lot)) })} />
              <div className="flex items-center justify-between gap-2 min-h-[40px]"><span className="text-[13px] text-[var(--ink2)]">Taxes and exchange charges</span><Segmented label="Charges" value={p.charges ? "on" : "off"} options={ONOFF} onChange={(v) => set({ charges: v === "on" })} /></div>
              <h2 className="text-[13px] font-semibold pt-2">Which nights</h2>
              <div className="flex items-center justify-between gap-2 min-h-[40px] flex-wrap">
                <span className="text-[13px] text-[var(--ink2)]">Entry day</span>
                <span className="inline-flex gap-1">
                  {[1, 2, 3, 4, 5].map((d) => {
                    const on = p.weekdays.includes(d);
                    return (
                      <button key={d} type="button" aria-pressed={on} onClick={() => set({ weekdays: on ? p.weekdays.filter((x) => x !== d) : [...p.weekdays, d] })}
                        className={`w-10 h-9 rounded-lg text-[12.5px] font-medium border ${on ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-transparent" : "border-[var(--line)] text-[var(--ink3)]"}`}>
                        {WEEKDAYS[d].slice(0, 3)}
                      </button>
                    );
                  })}
                </span>
              </div>
              <Num label="India VIX at least" value={p.vixMin} onChange={(v) => set({ vixMin: v })} />
              <Num label="India VIX at most" value={p.vixMax} onChange={(v) => set({ vixMax: v })} />
              <label className="flex items-center justify-between gap-2 min-h-[40px]">
                <span className="text-[13px] text-[var(--ink2)]">From year</span>
                <select value={p.from?.slice(0, 4) ?? ""} onChange={(e) => set({ from: e.target.value ? `${e.target.value}-01-01` : null })} aria-label="From year"
                  className="h-9 px-2 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[14px]">
                  <option value="">All</option>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => setP({ ...DEFAULTS, lot: lab.lot })} className="rs-press w-full min-h-[40px] mt-1 rounded-xl border border-[var(--line)] text-[13px] font-medium text-[var(--ink2)]">Reset</button>
            </section>

            {!st && <p className="text-[13px] text-[var(--ink3)]">No night matches these settings.</p>}
            {st && (
              <>
                <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3">
                  <h2 className="text-[13px] font-semibold">Result, after costs · {day(trades[0].d0)} to {day(trades[trades.length - 1].d0)}</h2>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {([
                      ["Nights traded", st.n.toLocaleString("en-IN"), "", ""],
                      ["Nights in profit", `${st.winRate.toFixed(0)}%`, "", `${st.wins} of ${st.n}`],
                      ["Average night", `${pts(st.avg)} pts`, tone(st.avg), `${rs(st.avg * p.lot)} · ${pts(st.avgPct)}% of paid`],
                      ["All nights added", rs(st.total * p.lot), tone(st.total), `${pts(st.total, 0)} pts, one lot`],
                      ["Before costs", `${pts(st.avgGross)} pts`, tone(st.avgGross), "Average night"],
                      ["Costs", `−${st.avgCosts.toFixed(1)} pts`, "", `${rs(-st.avgCosts * p.lot)} a night`],
                      ["Worst night", rs(st.worst * p.lot), tone(st.worst), `Best ${rs(st.best * p.lot)}`],
                      ["Deepest fall", rs(-st.maxDrawdown * p.lot), tone(-st.maxDrawdown), "From a peak, one lot"],
                    ] as const).map(([label, value, cls, sub]) => (
                      <div key={label} className="min-w-0 rounded-lg bg-[var(--card2)] px-2 py-1.5">
                        <p className="text-[10.5px] leading-tight text-[var(--ink3)] truncate">{label}</p>
                        <p className={`text-[14px] leading-[19px] font-semibold tabular-nums truncate ${cls}`}>{value}</p>
                        <p className="text-[10px] leading-tight text-[var(--ink3)] truncate">{sub}</p>
                      </div>
                    ))}
                  </div>
                  {curve.length > 1 && (() => {
                    const W = 600, H = 120, lo = Math.min(0, ...curve), hi = Math.max(0, ...curve), y = (v: number) => H - ((v - lo) / Math.max(hi - lo, 1)) * H;
                    return (
                      <>
                        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-3 w-full h-28" role="img" aria-label="Running total, rupees per lot">
                          <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="var(--line2)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                          <polyline fill="none" stroke={curve[curve.length - 1] >= 0 ? "var(--pos)" : "var(--neg)"} strokeWidth="1.6" vectorEffect="non-scaling-stroke"
                            points={curve.map((v, i) => `${(i / (curve.length - 1)) * W},${y(v)}`).join(" ")} />
                        </svg>
                        <p className="text-[11px] text-[var(--ink3)]">Running total, one lot every night. Dashed line: zero.</p>
                      </>
                    );
                  })()}
                </section>

                <Breakdown title="By year" lot={p.lot} rows={group(trades, (t) => t.d0.slice(0, 4))} />
                <Breakdown title="By entry day" lot={p.lot} rows={group(trades, (t) => WEEKDAYS[t.wd], WEEKDAYS.slice(1))} />
                <Breakdown title="By days to expiry" lot={p.lot} rows={group(trades, (t) => dteBand(t.dte), DTE_BANDS)} />
                <Breakdown title="By India VIX on the entry day" lot={p.lot} rows={group(trades, (t) => vixBand(t.vix), VIX_BANDS)} />
                <Breakdown title="By how far Nifty moved overnight" lot={p.lot} rows={group(trades, (t) => moveBand(t.move), MOVE_BANDS)}
                  note="Known only afterwards: it explains a result, it cannot pick a night." />

                <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
                  <h3 className="px-3 pt-2.5 pb-1.5 text-[13px] font-semibold">Latest nights</h3>
                  {trades.slice(-12).reverse().map((t) => (
                    <div key={t.d0} className="grid grid-cols-[minmax(0,1fr)_48px_48px_50px] gap-1 px-3 py-1.5 text-[12.5px] tabular-nums border-t border-[var(--line)]">
                      <span className="min-w-0 truncate">{day(t.d0)} <span className="text-[var(--ink3)]">{t.callK === t.putK ? t.callK : `${t.putK}/${t.callK}`} · {t.dte}d</span></span>
                      <span className="text-right text-[var(--ink2)]">{t.paid.toFixed(0)}</span>
                      <span className="text-right text-[var(--ink2)]">{t.got.toFixed(0)}</span>
                      <span className={`text-right ${tone(t.net)}`}>{pts(t.net)}</span>
                    </div>
                  ))}
                  <p className="px-3 py-1.5 text-[11px] text-[var(--ink3)] border-t border-[var(--line)]">Entry day, strike and days to expiry · paid · sold for · result after costs (index points).</p>
                </section>
              </>
            )}
            <p className="text-[11px] text-[var(--ink3)]">{lab.days.length.toLocaleString("en-IN")} nights of data. Lot size {lab.lot} (the current one, used for every year).</p>
          </>
        )}
      </main>
    </div>
  );
}
