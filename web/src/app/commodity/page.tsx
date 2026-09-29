"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import {
  dayLabel, expiryLabel, rupees, rupeesShort, signClass, signed,
  type CommodityDoc, type CommodityListItem, type CurveRow,
} from "@/lib/commodity";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
// The chart library touches the window, so it loads in the browser only.
const CommodityChart = dynamic(() => import("@/components/CommodityChart"), {
  ssr: false,
  loading: () => <div className="rs-skel h-[420px]" aria-busy="true" aria-label="Loading chart" />,
});
const SpreadChart = dynamic(() => import("@/components/SpreadChart"), {
  ssr: false,
  loading: () => <div className="rs-skel h-[250px]" aria-busy="true" aria-label="Loading chart" />,
});

function Card({ title, tip, children }: { title: string; tip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
      <h2 className="px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)] flex items-center gap-1">
        {title}{tip}
      </h2>
      {children}
    </section>
  );
}

function Stat({ label, value, sub, cls = "" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-[var(--ink3)]">{label}</p>
      <p className={`font-semibold tabular-nums truncate ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--ink3)] truncate">{sub}</p>}
    </div>
  );
}

/** "100 × 10 g", "30 kg", "100 barrels" - one contract, in words. */
function lotText(mult: number, quoted: string): string {
  const basis = quoted.replace(/^₹ per /, "");
  if (quoted === "points") return `${mult} × index`;
  if (/^\d/.test(basis)) return `${mult.toLocaleString("en-IN")} × ${basis}`;
  const plural = mult !== 1 && ["barrel", "tonne", "bale"].includes(basis) ? "s" : "";
  return `${mult.toLocaleString("en-IN")} ${basis}${plural}`;
}

/** Each expiry's premium over the nearest, MCX solid and the world dashed -
 *  the two curves' shapes side by side, however far apart their levels. */
function TermCurve({ doc }: { doc: CommodityDoc }) {
  const front = doc.curve.find((r) => r.expiry === doc.front);
  if (!front) return null;
  const pts = doc.curve.filter((r) => r.fresh && !r.expiring && r.expiry >= front.expiry)
    .map((r) => ({ d: r.days, y: r.expiry === front.expiry ? 0 : r.prem_front ?? 0, label: expiryLabel(r.expiry) }));
  const wBase = front.world?.usd;
  const wpts = wBase ? doc.curve.filter((r) => r.world && r.expiry >= front.expiry && !r.expiring)
    .map((r) => ({ d: r.days, y: ((r.world as NonNullable<CurveRow["world"]>).usd / wBase - 1) * 100 })) : [];
  if (pts.length < 2) return null;
  const W = 340, H = 150, L = 34, R = 10, T = 12, B = 26;
  const xs = [...pts, ...wpts].map((p) => p.d), ys = [0, ...pts.map((p) => p.y), ...wpts.map((p) => p.y)];
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = Math.max((y1 - y0) * 0.15, 0.2); y0 -= pad; y1 += pad;
  const X = (d: number) => L + ((d - x0) / Math.max(x1 - x0, 1)) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const path = (ps: { d: number; y: number }[]) => ps.map((p, i) => `${i ? "L" : "M"}${X(p.d).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  return (
    <div className="px-3 pb-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
        aria-label="Premium of each expiry over the nearest, MCX and world">
        <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} stroke="var(--line2)" strokeWidth="1" />
        {[y0 + pad, y1 - pad].map((v, i) => (
          <text key={i} x={L - 4} y={Y(v) + 3} textAnchor="end" fontSize="9" fill="var(--ink3)">{signed(v, 1)}</text>
        ))}
        {wpts.length > 1 && <path d={path(wpts)} fill="none" stroke="var(--chart-alt)" strokeWidth="1.5" strokeDasharray="4 3" />}
        <path d={path(pts)} fill="none" stroke="var(--accent)" strokeWidth="2" />
        {pts.map((p) => (
          <g key={p.label}>
            <circle cx={X(p.d)} cy={Y(p.y)} r="3" fill="var(--accent)" />
            <text x={X(p.d)} y={H - 8} textAnchor="middle" fontSize="9" fill="var(--ink3)">{p.label}</text>
          </g>
        ))}
      </svg>
      <p className="text-[11px] text-[var(--ink3)] flex gap-3">
        <span><i className="inline-block w-3 h-0.5 mr-1 align-middle bg-[var(--accent)]" />MCX</span>
        {wpts.length > 1 && <span><i className="inline-block w-3 mr-1 align-middle border-t-2 border-dashed border-[var(--chart-alt)]" />{doc.world?.label}, same months</span>}
      </p>
    </div>
  );
}

function Expiries({ doc, pick, onPick }: { doc: CommodityDoc; pick: string; onPick: (e: string) => void }) {
  const hasWorld = doc.curve.some((r) => r.world);
  const num = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: v >= 1000 ? 0 : 2 });
  return (
    <table className="w-full table-fixed text-[12.5px] tabular-nums">
      <thead>
        <tr className="text-[11px] text-[var(--ink3)]">
          <th className="w-[22%] pl-3 pr-1 py-1.5 text-left font-medium">Expiry</th>
          <th className="w-[24%] px-1 py-1.5 text-right font-medium">Price ₹</th>
          <th className="px-1 py-1.5 text-right font-medium">vs nearest</th>
          {hasWorld && <th className="px-1 py-1.5 text-right font-medium">vs World</th>}
          <th className="pl-1 pr-3 py-1.5 text-right font-medium">OI</th>
        </tr>
      </thead>
      <tbody>
        {doc.curve.map((r) => (
          <tr key={r.key} onClick={() => onPick(r.expiry)}
            className={`border-t border-[var(--line)] cursor-pointer ${r.expiry === pick ? "bg-[var(--accent-soft)]" : "active:bg-[var(--card2)]"}`}>
            <td className="pl-3 pr-1 py-2">
              <span className="font-semibold whitespace-nowrap">{expiryLabel(r.expiry)}</span>
              {r.expiry === doc.active && <span aria-label="most traded" title="Most traded"
                className="inline-block w-1.5 h-1.5 ml-1 rounded-full bg-[var(--accent)] align-middle" />}
              <span className="block text-[11px] text-[var(--ink3)] whitespace-nowrap">
                {r.expiring ? "expiring" : `${r.days} days`}
              </span>
            </td>
            <td className={`px-1 py-2 text-right ${r.fresh ? "" : "text-[var(--ink3)]"}`}>
              {num(r.close)}
              <span className={`block text-[11px] ${r.fresh ? signClass(r.chg) : "text-[var(--ink3)]"}`}>
                {r.fresh ? signed(r.chg, 2) : dayLabel(r.date)}
              </span>
            </td>
            <td className="px-1 py-2 text-right">
              {r.expiry === doc.front ? <span className="text-[var(--ink3)]">base</span> : signed(r.prem_front, 2)}
              {r.carry_pa != null && <span className="block text-[11px] text-[var(--ink3)]">{signed(r.carry_pa, 1)}/yr</span>}
            </td>
            {hasWorld && (
              <td className="px-1 py-2 text-right">{r.world && r.fresh ? signed(r.world.prem) : <span className="text-[var(--ink3)]">—</span>}</td>
            )}
            <td className="pl-1 pr-3 py-2 text-right text-[var(--ink2)]">
              {r.oi.toLocaleString("en-IN")}
              {r.oi_chg !== null && r.fresh && <span className={`block text-[11px] ${signClass(r.oi_chg)}`}>{r.oi_chg > 0 ? "+" : ""}{r.oi_chg.toLocaleString("en-IN")}</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CommodityView() {
  const sym = (useSearchParams().get("s") ?? "").toUpperCase();
  const [loaded, setDoc] = useState<CommodityDoc | null>(null);
  const [list, setList] = useState<CommodityListItem[]>([]);
  // Each kept with the symbol it belongs to, so moving between sizes never
  // shows the last one's page or error under the new name.
  const [failed, setError] = useState<{ s: string; msg: string } | null>(null);
  const [pick, setPick] = useState("");
  const doc = loaded?.s === sym ? loaded : null;
  const error = failed?.s === sym ? failed.msg : "";

  useEffect(() => {
    if (!sym) return;
    let live = true;
    fetch(`${BASE}/commodity/${encodeURIComponent(sym)}.json`)
      .then((r) => { if (!r.ok) throw new Error(r.status === 404 ? `No MCX contract called ${sym}` : `HTTP ${r.status}`); return r.json(); })
      .then((d: CommodityDoc) => { if (live) { setDoc(d); setPick(d.active); } })
      .catch((e) => { if (live) setError({ s: sym, msg: String(e.message ?? e) }); });
    fetch(`${BASE}/commodities.json`).then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d?.items) setList(d.items); }).catch(() => {});
    return () => { live = false; };
  }, [sym]);

  const act = useMemo(() => doc?.curve.find((r) => r.expiry === doc.active) ?? null, [doc]);
  const front = useMemo(() => doc?.curve.find((r) => r.expiry === doc.front) ?? null, [doc]);
  const next = useMemo(() => doc?.curve.find((r) => r.fresh && front && r.expiry > front.expiry) ?? null, [doc, front]);
  const family = list.filter((x) => doc && x.family === doc.family && x.s !== doc.s);

  if (error) return <p className="text-[var(--neg)] text-sm">{error}</p>;
  if (!doc || !act) return <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />;
  const bars = doc.hist[pick] ?? doc.hist[doc.active] ?? [];
  const pickRow = doc.curve.find((r) => r.expiry === pick);

  return (
    <div className="space-y-3">
      <header>
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-xl font-bold">{doc.name}</h1>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink3)] border border-[var(--line2)] rounded px-1.5">{doc.group}</span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink3)]">MCX · {doc.s}</span>
        </div>
        <p className="text-sm text-[var(--ink2)]">{doc.quoted} · one contract is {lotText(doc.mult, doc.quoted)}</p>
      </header>

      <section className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-3">
        <p className="text-xs text-[var(--ink3)]">{expiryLabel(act.expiry)} contract · most traded · {dayLabel(act.date, true)}</p>
        <p className="mt-0.5 flex items-baseline gap-2 tabular-nums">
          <span className="text-2xl font-bold">{rupees(act.close)}</span>
          <span className={`text-[15px] font-semibold ${signClass(act.chg)}`}>{signed(act.chg, 2)}</span>
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="Next expiry" value={signed(next?.prem_front, 2)}
            sub={next ? `${expiryLabel(next.expiry)}${next.carry_pa != null ? ` · ${signed(next.carry_pa, 1)}/yr` : ""}` : "one expiry trading"} />
          {doc.world
            ? <Stat label="vs World" value={act.world ? signed(act.world.prem) : "—"} sub={doc.world.label} />
            : <Stat label="Expires" value={dayLabel(act.expiry)} sub={`${act.days} days`} />}
          <Stat label="Open interest" value={act.oi.toLocaleString("en-IN")}
            sub={act.oi_chg !== null ? `${act.oi_chg > 0 ? "+" : ""}${act.oi_chg.toLocaleString("en-IN")} on the day` : undefined} />
          <Stat label="Day high" value={rupees(act.high)} sub={`low ${rupees(act.low)}`} />
          <Stat label="Volume" value={act.vol.toLocaleString("en-IN")} sub="contracts" />
          <Stat label="One contract" value={rupeesShort(act.value)} sub={lotText(doc.mult, doc.quoted)} />
        </div>
      </section>

      <Card title="Expiries" tip={
        <InfoTip title="Expiries">
          <p>Every delivery month MCX has open for {doc.name}, nearest first. Tap one to chart it. The dot marks the most traded month.</p>
          <p><b>vs nearest</b>: the price over the nearest month&apos;s. Below it, that premium spread over the days between the two expiries, as % a year - for metals, roughly the interest and storage the later buyer is paying for.</p>
          <p>A month in its last {5} days is <b>expiring</b>: it is in delivery, few trade it, and it is not used as the base. A grey price last traded on the date shown and is left out of the comparisons.</p>
          {doc.untraded > 0 && <p>{doc.untraded} more month{doc.untraded > 1 ? "s are" : " is"} listed but not traded yet.</p>}
        </InfoTip>
      }>
        <Expiries doc={doc} pick={pick} onPick={setPick} />
      </Card>

      <Card title="The curve" tip={
        <InfoTip title="The curve">
          <p>Each month&apos;s premium over the nearest, plotted by days to expiry. Rising: later delivery costs more (contango). Falling: the market pays up to have it now (backwardation) - for gas and electricity, mostly the season.</p>
          {doc.world && <p>Dashed: {doc.world.label} for the same delivery months, over its own nearest. Where MCX rises faster, the Indian later month carries more than the world&apos;s - Indian interest rates and the rupee&apos;s expected fall against the dollar both push it up.</p>}
        </InfoTip>
      }>
        <TermCurve doc={doc} />
      </Card>

      <Card title={`Chart · ${expiryLabel(pick)}`} tip={
        <InfoTip title="Chart">
          <p>The {expiryLabel(pick)} contract&apos;s daily candles over its life so far.{doc.world ? ` Dashed: ${doc.world.label} for the same delivery month, in rupees at each day's USD/INR.` : ""}</p>
          <p><b>vs World</b>: MCX over that world price each day. <b>OI</b>: open interest, the contracts still outstanding - rising with price means new buyers, rising as it falls means new sellers.</p>
        </InfoTip>
      }>
        <div className="flex gap-1 px-2 pb-1 overflow-x-auto [scrollbar-width:none]">
          {doc.curve.filter((r) => doc.hist[r.expiry]?.length).map((r) => (
            <button key={r.expiry} onClick={() => setPick(r.expiry)} aria-pressed={pick === r.expiry}
              className={`shrink-0 min-h-[32px] px-2.5 rounded-lg text-[12px] font-semibold ${pick === r.expiry ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`}>
              {expiryLabel(r.expiry)}
            </button>
          ))}
        </div>
        <CommodityChart key={pick} bars={bars} worldLabel={pickRow?.world || bars.some((b) => b[7] !== null) ? doc.world?.label ?? null : null} />
      </Card>

      {doc.spread.length > 5 && (
        <Card title="Next expiry over nearest, each day" tip={
          <InfoTip title="Next expiry over nearest">
            <p>Each day, the second-nearest month over the nearest (a month in its last 5 days, or with under 10 contracts open, is skipped). When the nearest expires the pair moves on a month, so the line can step.</p>
            <p>The history starts with the contracts trading today - the oldest about a year back - and lengthens by a day each night.</p>
          </InfoTip>
        }>
          <SpreadChart rows={doc.spread} />
        </Card>
      )}

      {doc.world && act.world && (
        <Card title="World price" tip={
          <InfoTip title="World price">
            <p>{doc.world.label}, the same delivery month, converted: price × USD/INR × the change of unit to MCX&apos;s ({doc.quoted}).</p>
            <p>What is left between the two is import duty and taxes MCX prices carry, Indian supply and demand, and the hour between the two closes. Crude and gas settle on the US price, so theirs should stay near zero; gold and silver carry the duty.</p>
            <p>World prices are CME closes via Yahoo, not checked against CME.</p>
          </InfoTip>
        }>
          <dl className="px-3 pb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm tabular-nums">
            <dt className="text-[var(--ink3)]">{doc.world.label}</dt>
            <dd>${act.world.usd.toLocaleString("en-US", { maximumFractionDigits: 3 })} <span className="text-[var(--ink3)]">{doc.world.unit.replace(/^\$ /, "")} · {expiryLabel(act.expiry)} month</span></dd>
            <dt className="text-[var(--ink3)]">USD/INR</dt><dd>₹{act.world.fx.toFixed(2)}</dd>
            <dt className="text-[var(--ink3)]">In rupees</dt><dd>{rupees(act.world.inr)} <span className="text-[var(--ink3)]">{doc.quoted.replace(/^₹ /, "")}</span></dd>
            <dt className="text-[var(--ink3)]">MCX</dt><dd>{rupees(act.close)}</dd>
            <dt className="text-[var(--ink3)]">Gap</dt>
            <dd className="font-semibold">{signed(act.world.prem)} <span className="font-normal text-[var(--ink3)]">({rupees(act.close - act.world.inr)})</span></dd>
          </dl>
        </Card>
      )}

      {family.length > 0 && (
        <Card title="Other sizes">
          <ul className="divide-y divide-[var(--line)]">
            {family.map((x) => (
              <li key={x.s}>
                <Link href={`/commodity?s=${encodeURIComponent(x.s)}`} className="rs-press flex items-center gap-3 px-3 py-2.5 active:bg-[var(--card2)]">
                  <span className="flex-1 min-w-0">
                    <span className="font-semibold text-[14px]">{x.name}</span>
                    <span className="block text-xs text-[var(--ink3)]">{expiryLabel(x.expiry)} · {x.quoted}</span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="block text-[14px] font-semibold">{rupees(x.close)}</span>
                    <span className={`block text-[12px] ${signClass(x.chg)}`}>{signed(x.chg, 2)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="About">
        <dl className="px-3 pb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-[var(--ink3)]">Exchange</dt><dd>MCX · {doc.s}</dd>
          <dt className="text-[var(--ink3)]">Quoted</dt><dd>{doc.quoted}</dd>
          <dt className="text-[var(--ink3)]">Contract</dt><dd>{lotText(doc.mult, doc.quoted)}</dd>
          {doc.tick > 0 && <><dt className="text-[var(--ink3)]">Tick</dt><dd>₹{doc.tick}</dd></>}
          <dt className="text-[var(--ink3)]">Sources</dt>
          <dd>MCX daily closes via Upstox&apos;s public data{doc.world ? " · world prices and USD/INR via Yahoo" : ""}. Not checked against MCX&apos;s bhavcopy.</dd>
        </dl>
      </Card>
    </div>
  );
}

export default function CommodityPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="commodities" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5">
        <Suspense fallback={<div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}>
          <CommodityView />
        </Suspense>
      </main>
    </div>
  );
}
