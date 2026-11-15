"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { Segmented } from "@/components/ListUI";
import { labOn } from "@/lib/destinations";
import {
  Chain, DEFAULTS, DTE_BANDS, FII_BANDS, GroupRow, Hold, Leg, MOVE_BANDS, Market, PCR_BANDS, PRESETS, Params, US_BANDS, VIX_BANDS, WEEKDAYS,
  dteBand, fiiBand, group, moveBand, pcrBand, run, stats, usBand, vixBand,
} from "@/lib/optlab";

/** The Lab: any mix of bought and sold calls, puts and futures on an index
 *  or an F&O stock, tested on ten years of the exchanges' daily files.
 *  RESEARCH ONLY: no order is placed or prepared here. The owner's plan puts
 *  F&O after Phase-3 (owner, 15/16-Nov-2026). lab/*.json + lib/optlab.ts. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
type Index = { instruments: [string, "index" | "stock", number, string, number][]; market: Market };

const pts = (v: number, d = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: d })}`;
const rs = (v: number) => `${v < 0 ? "−" : v > 0 ? "+" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
const tone = (v: number) => (v > 0 ? "text-[var(--pos)]" : v < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]");
const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });

const HOLDS: readonly (readonly [Hold, string])[] = [["overnight", "Overnight"], ["intraday", "Same day"], ["days", "N days"], ["expiry", "To expiry"]];
const HOLD_NOTE: Record<Hold, string> = {
  overnight: "In at the close, out at the next day's first trade.",
  intraday: "In at the day's first trade, out at its close.",
  days: "In at the close, out at the close N trading days later.",
  expiry: "In at the close, held until the nearest leg expires and settles.",
};
const ONOFF: readonly (readonly ["on" | "off", string])[] = [["on", "On"], ["off", "Off"]];
const TRI: readonly (readonly ["any" | "only" | "skip", string])[] = [["any", "Any"], ["only", "Only"], ["skip", "Skip"]];
const DIR: readonly (readonly ["any" | "up" | "down", string])[] = [["any", "Any"], ["up", "Up"], ["down", "Down"]];
const TREND: readonly (readonly ["any" | "above" | "below", string])[] = [["any", "Any"], ["above", "Above"], ["below", "Below"]];
const field = "h-9 px-2 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[13.5px] outline-none focus:border-[var(--accent-line)]";

function Line({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 min-h-[42px]">
      <span className="text-[13px] text-[var(--ink2)] min-w-0">{label}{hint && <span className="block text-[11px] text-[var(--ink3)]">{hint}</span>}</span>
      <span className="shrink-0">{children}</span>
    </div>
  );
}

function Num({ value, onChange, step = 1, min, label }: { value: number | null; onChange: (v: number | null) => void; step?: number; min?: number; label: string }) {
  return (
    <input type="number" inputMode="decimal" step={step} min={min} value={value ?? ""} placeholder="any" aria-label={label}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className={`${field} w-[72px] text-right tabular-nums`} />
  );
}

function Breakdown({ title, rows, note, lot }: { title: string; rows: GroupRow[]; note?: string; lot: number }) {
  if (rows.length < 2) return null;
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
      <h3 className="px-3 pt-2.5 text-[13px] font-semibold">{title}</h3>
      {note && <p className="px-3 text-[11px] text-[var(--ink3)]">{note}</p>}
      <div className="grid grid-cols-[minmax(0,1fr)_40px_40px_54px_82px] gap-1 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ink3)] border-b border-[var(--line)]">
        <span /><span className="text-right">Trades</span><span className="text-right">Win</span><span className="text-right">Avg pts</span><span className="text-right">Total / lot</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_40px_40px_54px_82px] gap-1 px-3 py-1.5 text-[12.5px] tabular-nums border-b border-[var(--line)] last:border-b-0">
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

// A stock's file holds three strikes each side of the money, an index's
// twelve: a leg further out is brought to the edge (an iron condor on a stock
// gets wings one strike wide), so every leg has a price to test.
const fit = (legs: Leg[], s: number): Leg[] => legs.map((l) => ({ ...l, off: Math.max(-s, Math.min(s, l.off)) }));

export default function OptLabPage() {
  const [index, setIndex] = useState<Index | null>(null);
  const [chain, setChain] = useState<Chain | null>(null);
  const [sym, setSym] = useState("NIFTY");
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [p, setP] = useState<Params>(DEFAULTS);
  const set = (x: Partial<Params>) => setP((q) => ({ ...q, ...x }));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from this browser's storage after mount; the prerendered page has none
    setEnabled(labOn());
    fetch(`${BASE}/lab/index.json`)
      .then((r) => { if (!r.ok) throw new Error(r.status === 404 ? "The Lab's history has not been published yet. It is written by the nightly run." : `HTTP ${r.status}`); return r.json(); })
      .then(setIndex)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  useEffect(() => {
    let live = true;
    fetch(`${BASE}/lab/${encodeURIComponent(sym)}.json`)
      .then((r) => { if (!r.ok) throw new Error(`No history for ${sym}`); return r.json(); })
      .then((c: Chain) => {
        if (!live) return;
        setChain(c);
        // A stock's file holds three strikes each side of the money, an
        // index's twelve: a leg further out is brought to the edge.
        setP((q) => ({ ...q, lot: c.lot, legs: fit(q.legs, c.index ? 12 : 3) }));
      })
      .catch((e) => { if (live) setError(String(e.message ?? e)); });
    return () => { live = false; };
  }, [sym]);

  const ready = chain && chain.sym === sym && index ? chain : null;
  const trades = useMemo(() => (ready && index ? run(ready, index.market, p) : []), [ready, index, p]);
  const st = useMemo(() => stats(trades), [trades]);
  const years = useMemo(() => (ready ? [...new Set(ready.days.map((d) => d[0].slice(0, 4)))] : []), [ready]);
  const curve = useMemo(
    () => trades.reduce<number[]>((acc, t) => { acc.push((acc[acc.length - 1] ?? 0) + t.net * p.lot); return acc; }, []),
    [trades, p.lot]);
  const span = ready?.index ? 12 : 3;
  const preset = PRESETS.find(([, legs]) => JSON.stringify(fit(legs, span)) === JSON.stringify(p.legs))?.[0] ?? "";
  const setLeg = (i: number, x: Partial<Leg>) => set({ legs: p.legs.map((l, j) => (j === i ? { ...l, ...x } : l)) });
  const sells = p.legs.some((l) => l.side === -1);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="optlab" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          Options lab
          <InfoTip title="Options lab">
            <p><b>The test.</b> Pick an instrument and a strategy - any mix of bought and sold calls, puts and futures - and a holding period. The same trade is repeated on every day that matches your filters, and the results added up.</p>
            <p><b>Prices.</b> From NSE&apos;s and BSE&apos;s daily F&amp;O files: each contract&apos;s first traded price and closing price. A day is skipped if any leg did not trade at either end. A trade held to expiry settles on the underlying&apos;s close that day.</p>
            <p><b>At the money</b> is the strike where the call and the put cost most nearly the same.</p>
            <p><b>Costs</b>, at today&apos;s rates for every year: bid-ask spread, brokerage, STT, exchange and SEBI charges, stamp duty, GST. Not checked against a contract note. <b>Margin</b> for sold options and futures is not modelled.</p>
            <p><b>Filters.</b> India VIX, Nifty and the S&amp;P 500 are from Yahoo Finance; FII positions from NSE&apos;s participant file; RBI policy and Budget days are a hand-kept list, not checked line by line.</p>
          </InfoTip>
        </h1>

        <section className="rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] text-[var(--warn-ink)] px-3 py-2.5 text-[13px] leading-relaxed">
          <b>Research only.</b>{" "}This page places no trade and gives no advice. Your plan puts futures and options after Phase-3,
          and SEBI found about 9 in 10 retail F&amp;O traders lose money. A result on history is not a forecast.
          <span className="block mt-1"><b>What it cannot test:</b> anything decided during the day - a stop-loss, a profit target, selling
          &quot;at break-even&quot; in the morning. That needs minute-by-minute prices; these are daily.</span>
          {sells && <span className="block mt-1"><b>Selling:</b> a sold option or future can lose many times what it collects. The worst trade below is the worst in this history, not the worst possible.</span>}
        </section>

        {enabled === false && (
          <p className="text-[13px] text-[var(--ink3)]">The Options lab tab is switched off. <Link href="/settings" className="text-[var(--accent-ink)] underline">Turn it on in Settings</Link> to keep it under Research.</p>
        )}
        {error && <p className="text-[var(--neg)] text-sm">{error}</p>}
        {!index && !error && <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}

        {index && (
          <>
            <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3">
              <h2 className="text-[13px] font-semibold mb-1">The trade</h2>
              <Line label="Instrument">
                <select value={sym} onChange={(e) => { setError(""); setSym(e.target.value); }} aria-label="Instrument" className={`${field} max-w-[170px]`}>
                  <optgroup label="Indices">{index.instruments.filter((x) => x[1] === "index").map((x) => <option key={x[0]} value={x[0]}>{x[0]} · from {x[3].slice(0, 4)}</option>)}</optgroup>
                  <optgroup label="Stocks">{index.instruments.filter((x) => x[1] === "stock").map((x) => <option key={x[0]} value={x[0]}>{x[0]}</option>)}</optgroup>
                </select>
              </Line>
              <Line label="Strategy">
                <select value={preset} onChange={(e) => { const f = PRESETS.find(([n]) => n === e.target.value); if (f) set({ legs: fit(f[1], span) }); }} aria-label="Strategy" className={`${field} max-w-[170px]`}>
                  {!preset && <option value="">Custom</option>}
                  {PRESETS.map(([n]) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Line>
              <div className="mt-1 space-y-1.5">
                {p.legs.map((l, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <select value={l.side} onChange={(e) => setLeg(i, { side: Number(e.target.value) as 1 | -1 })} aria-label={`Leg ${i + 1} side`} className={`${field} flex-1 min-w-0`}>
                      <option value={1}>Buy</option><option value={-1}>Sell</option>
                    </select>
                    <select value={l.kind} onChange={(e) => setLeg(i, { kind: e.target.value as Leg["kind"] })} aria-label={`Leg ${i + 1} type`} className={`${field} flex-1 min-w-0`}>
                      <option value="C">Call</option><option value="P">Put</option><option value="F">Future</option>
                    </select>
                    {l.kind !== "F" ? (
                      <select value={l.off} onChange={(e) => setLeg(i, { off: Number(e.target.value) })} aria-label={`Leg ${i + 1} strike`} className={`${field} flex-1 min-w-0`}>
                        {Array.from({ length: 2 * span + 1 }, (_, k) => k - span).map((k) => <option key={k} value={k}>{k === 0 ? "ATM" : `ATM ${k > 0 ? "+" : "−"}${Math.abs(k)}`}</option>)}
                      </select>
                    ) : <span className="flex-1" />}
                    <select value={l.exp} onChange={(e) => setLeg(i, { exp: Number(e.target.value) })} aria-label={`Leg ${i + 1} expiry`} className={`${field} flex-1 min-w-0`}>
                      <option value={0}>Near</option><option value={1}>Next</option>
                    </select>
                    <button type="button" onClick={() => set({ legs: p.legs.filter((_, j) => j !== i) })} disabled={p.legs.length === 1} aria-label={`Remove leg ${i + 1}`}
                      className="w-9 h-9 rounded-lg border border-[var(--line)] text-[var(--ink3)] disabled:opacity-40">×</button>
                  </div>
                ))}
                {p.legs.length < 4 && (
                  <button type="button" onClick={() => set({ legs: [...p.legs, { side: 1, kind: "C", off: 0, exp: 0 }] })}
                    className="rs-press w-full min-h-[38px] rounded-xl border border-dashed border-[var(--line2)] text-[13px] text-[var(--ink2)]">+ Add a leg</button>
                )}
                <p className="text-[11px] text-[var(--ink3)]">Strike is counted in steps from at-the-money: ATM +2 is two strikes above.</p>
              </div>
              <div className="mt-2"><Segmented label="Holding period" value={p.hold} options={HOLDS} onChange={(v) => set({ hold: v })} /></div>
              <p className="text-[11.5px] text-[var(--ink3)] mt-1">{HOLD_NOTE[p.hold]}</p>
              {p.hold === "days" && <Line label="Trading days held"><Num label="Days held" value={p.days} min={1} onChange={(v) => set({ days: Math.max(1, Math.round(v ?? 1)) })} /></Line>}
              {p.hold !== "intraday" && <Line label="Days to expiry, at least"><Num label="Minimum days to expiry" value={p.minDte} min={1} onChange={(v) => set({ minDte: Math.max(1, Math.round(v ?? 1)) })} /></Line>}

              <details className="mt-2 border-t border-[var(--line)] pt-2">
                <summary className="text-[13px] font-semibold cursor-pointer">Costs</summary>
                <Line label="Spread lost per contract, per trade" hint="Index points"><Num label="Spread" value={p.slip} step={0.25} min={0} onChange={(v) => set({ slip: Math.max(0, v ?? 0) })} /></Line>
                <Line label="Brokerage per order, ₹"><Num label="Brokerage" value={p.brokerage} step={5} min={0} onChange={(v) => set({ brokerage: Math.max(0, v ?? 0) })} /></Line>
                <Line label="Lot size"><Num label="Lot size" value={p.lot} min={1} onChange={(v) => set({ lot: Math.max(1, Math.round(v ?? 1)) })} /></Line>
                <Line label="Taxes and exchange charges"><Segmented label="Charges" value={p.charges ? "on" : "off"} options={ONOFF} onChange={(v) => set({ charges: v === "on" })} /></Line>
              </details>

              <details className="mt-2 border-t border-[var(--line)] pt-2">
                <summary className="text-[13px] font-semibold cursor-pointer">Which days</summary>
                <Line label="Entry day">
                  <span className="inline-flex gap-1">
                    {[1, 2, 3, 4, 5].map((d) => {
                      const on = p.weekdays.includes(d);
                      return (
                        <button key={d} type="button" aria-pressed={on} onClick={() => set({ weekdays: on ? p.weekdays.filter((x) => x !== d) : [...p.weekdays, d] })}
                          className={`w-9 h-9 rounded-lg text-[12px] font-medium border ${on ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-transparent" : "border-[var(--line)] text-[var(--ink3)]"}`}>
                          {WEEKDAYS[d].slice(0, 2)}
                        </button>
                      );
                    })}
                  </span>
                </Line>
                <Line label="Entry on an expiry day"><Segmented label="Expiry day" value={p.expiryDay} options={TRI} onChange={(v) => set({ expiryDay: v })} /></Line>
                <Line label="RBI policy or Budget day" hint="Inside the holding period"><Segmented label="Event" value={p.event} options={TRI} onChange={(v) => set({ event: v })} /></Line>
                <Line label="Price against its 200-day average"><Segmented label="Trend" value={p.trend} options={TREND} onChange={(v) => set({ trend: v })} /></Line>
                <Line label="US market, last session"><Segmented label="US market" value={p.usDir} options={DIR} onChange={(v) => set({ usDir: v })} /></Line>
                <Line label="India VIX that day"><Segmented label="VIX direction" value={p.vixDir} options={DIR} onChange={(v) => set({ vixDir: v })} /></Line>
                <Line label="India VIX between"><span className="inline-flex gap-1"><Num label="VIX at least" value={p.vixMin} onChange={(v) => set({ vixMin: v })} /><Num label="VIX at most" value={p.vixMax} onChange={(v) => set({ vixMax: v })} /></span></Line>
                <Line label="Put-call ratio between" hint="Open interest"><span className="inline-flex gap-1"><Num label="PCR at least" value={p.pcrMin} step={0.1} onChange={(v) => set({ pcrMin: v })} /><Num label="PCR at most" value={p.pcrMax} step={0.1} onChange={(v) => set({ pcrMax: v })} /></span></Line>
                <Line label="FII index futures long % between"><span className="inline-flex gap-1"><Num label="FII long at least" value={p.fiiMin} onChange={(v) => set({ fiiMin: v })} /><Num label="FII long at most" value={p.fiiMax} onChange={(v) => set({ fiiMax: v })} /></span></Line>
                <Line label="From year">
                  <select value={p.from?.slice(0, 4) ?? ""} onChange={(e) => set({ from: e.target.value ? `${e.target.value}-01-01` : null })} aria-label="From year" className={field}>
                    <option value="">All</option>
                    {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </Line>
              </details>
              <button type="button" onClick={() => setP({ ...DEFAULTS, lot: ready?.lot ?? p.lot })} className="rs-press w-full min-h-[40px] mt-2 rounded-xl border border-[var(--line)] text-[13px] font-medium text-[var(--ink2)]">Reset</button>
            </section>

            {!ready && !error && <div className="rs-skel h-64" aria-busy="true" aria-label="Loading" />}
            {ready && !st && <p className="text-[13px] text-[var(--ink3)]">No day matches these settings.</p>}
            {ready && st && (
              <>
                <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3">
                  <h2 className="text-[13px] font-semibold">{sym} · after costs · {day(trades[0].d0)} to {day(trades[trades.length - 1].d0)}</h2>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {([
                      ["Trades", st.n.toLocaleString("en-IN"), "", `${st.avgPaid >= 0 ? "Pays" : "Collects"} ${Math.abs(st.avgPaid).toFixed(0)} pts on average`],
                      ["In profit", `${st.winRate.toFixed(0)}%`, "", `${st.wins} of ${st.n}`],
                      ["Average trade", `${pts(st.avg)} pts`, tone(st.avg), `${rs(st.avg * p.lot)} a lot`],
                      ["All trades added", rs(st.total * p.lot), tone(st.total), `${pts(st.total, 0)} pts, one lot`],
                      ["Before costs", `${pts(st.avgGross)} pts`, tone(st.avgGross), "Average trade"],
                      ["Costs", `−${st.avgCosts.toFixed(1)} pts`, "", `${rs(-st.avgCosts * p.lot)} a trade`],
                      ["Worst trade", rs(st.worst * p.lot), tone(st.worst), `Best ${rs(st.best * p.lot)}`],
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
                        <p className="text-[11px] text-[var(--ink3)]">Running total, one lot each trade. Dashed line: zero.{p.hold === "days" || p.hold === "expiry" ? " Trades overlap: a new one starts every day." : ""}</p>
                      </>
                    );
                  })()}
                </section>

                <Breakdown title="By year" lot={p.lot} rows={group(trades, (t) => t.d0.slice(0, 4))} />
                <Breakdown title="By entry day" lot={p.lot} rows={group(trades, (t) => WEEKDAYS[t.wd], WEEKDAYS.slice(1))} />
                <Breakdown title="By days to expiry" lot={p.lot} rows={group(trades, (t) => dteBand(t.dte), DTE_BANDS)} />
                <Breakdown title="By India VIX on the entry day" lot={p.lot} rows={group(trades, (t) => vixBand(t.vix), VIX_BANDS)} />
                <Breakdown title="By trend" lot={p.lot} rows={group(trades, (t) => (t.above200 === null ? null : t.above200 ? "Above 200-day" : "Below 200-day"), ["Above 200-day", "Below 200-day"])} />
                <Breakdown title="By the US market's last session" lot={p.lot} rows={group(trades, (t) => usBand(t.us), US_BANDS)} />
                <Breakdown title="By put-call ratio" lot={p.lot} rows={group(trades, (t) => pcrBand(t.pcr), PCR_BANDS)} />
                <Breakdown title="By FII index futures long share" lot={p.lot} rows={group(trades, (t) => fiiBand(t.fii), FII_BANDS)} />
                <Breakdown title="By expiry day and events" lot={p.lot} rows={[
                  ...group(trades, (t) => (t.onExpiry ? "Entry on expiry day" : "Other days"), ["Entry on expiry day", "Other days"]),
                  ...group(trades, (t) => (t.event ? "RBI / Budget inside" : null)),
                ]} />
                <Breakdown title="By how far the price moved while held" lot={p.lot} rows={group(trades, (t) => moveBand(t.move), MOVE_BANDS)}
                  note="Known only afterwards: it explains a result, it cannot pick a day." />

                <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
                  <h3 className="px-3 pt-2.5 pb-1.5 text-[13px] font-semibold">Latest trades</h3>
                  {trades.slice(-12).reverse().map((t) => (
                    <div key={t.d0} className="grid grid-cols-[minmax(0,1fr)_56px_56px] gap-1 px-3 py-1.5 text-[12.5px] tabular-nums border-t border-[var(--line)]">
                      <span className="min-w-0 truncate">{day(t.d0)} <span className="text-[var(--ink3)]">to {day(t.d1)} · {t.dte}d</span></span>
                      <span className="text-right text-[var(--ink2)]">{t.paid.toFixed(0)}</span>
                      <span className={`text-right ${tone(t.net)}`}>{pts(t.net)}</span>
                    </div>
                  ))}
                  <p className="px-3 py-1.5 text-[11px] text-[var(--ink3)] border-t border-[var(--line)]">Entry and exit day, days to expiry · premium paid (negative = collected) · result after costs, points.</p>
                </section>
                <p className="text-[11px] text-[var(--ink3)]">{ready.days.length.toLocaleString("en-IN")} days of data for {sym}. Lot size {ready.lot} (the current one, used for every year).</p>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
