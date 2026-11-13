"use client";

/** Market pulse: who bought in the cash market, who holds index futures long,
 *  and how many stocks sit above their 200- and 50-day averages. From
 *  market.json (pipeline/export_market_json.py). Descriptive, not a forecast. */

import { useEffect, useState } from "react";
import InfoTip from "@/components/InfoTip";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Market = {
  generated_at: string;
  fii_dii: [string, number | null, number | null][];
  futures: [string, number | null, number | null, number | null, number | null][];
  breadth: [string, number, number, number][];
};

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const cr = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}₹${Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
const tone = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? "text-[var(--ink)]" : v > 0 ? "text-[var(--pos)]" : "text-[var(--neg)]");

export default function MarketPulse() {
  const [m, setM] = useState<Market | null>(null);
  useEffect(() => {
    fetch(`${BASE}/market.json`).then((r) => (r.ok ? r.json() : null)).then(setM).catch(() => setM(null));
  }, []);
  if (!m) return null;
  const flow = m.fii_dii.at(-1), fut = m.futures.at(-1), br = m.breadth.at(-1);
  const brMonth = m.breadth.at(-22);
  const fiiMonth = m.fii_dii.slice(-22).reduce((a, r) => a + (r[1] ?? 0), 0);
  const tiles = [
    flow && { label: "FII cash", value: cr(flow[1]), cls: tone(flow[1]),
      sub: m.fii_dii.length >= 5 ? `${m.fii_dii.slice(-22).length}d ${cr(fiiMonth)}` : day(flow[0]) },
    flow && { label: "DII cash", value: cr(flow[2]), cls: tone(flow[2]), sub: day(flow[0]) },
    fut && fut[1] !== null && { label: "FII index fut.", value: `${fut[1]}% long`, cls: "text-[var(--ink)]", sub: day(fut[0]) },
    br && { label: "Above 200 DMA", value: `${br[1]}%`, cls: "text-[var(--ink)]",
      sub: brMonth ? `a month ago ${brMonth[1]}%` : `of ${br[3]} stocks` },
  ].filter(Boolean) as { label: string; value: string; cls: string; sub: string }[];
  if (!tiles.length) return null;
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3">
      <h2 className="text-[13px] font-semibold text-[var(--ink)] px-1 flex items-center gap-1">
        Market pulse
        <InfoTip title="Market pulse">
          <p><b>FII / DII cash</b>: net buying by foreign and domestic institutions in the cash market, from NSE&apos;s daily report. NSE gives one day at a time, so the running total grows night by night.</p>
          <p><b>FII index futures</b>: the share of their index-futures contracts that are long, from NSE&apos;s participant-wise open interest. Information only - the plan puts F&amp;O after Phase-3.</p>
          <p><b>Above 200 DMA</b>: the share of NSE stocks closing above their 200-day average, from this app&apos;s own daily closes. A measure of how broad a move is.</p>
          <p>All of it describes what happened. None of it has been tested here as a forecast.</p>
        </InfoTip>
      </h2>
      <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {tiles.map((t) => (
          <div key={t.label} className="min-w-0 rounded-lg bg-[var(--card2)] px-2 py-1.5">
            <p className="text-[10.5px] leading-tight text-[var(--ink3)] truncate">{t.label}</p>
            <p className={`text-[13px] leading-[18px] font-semibold tabular-nums truncate ${t.cls}`}>{t.value}</p>
            <p className="text-[10px] leading-tight text-[var(--ink3)] truncate">{t.sub}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
