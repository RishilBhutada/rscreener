"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip from "@/components/InfoTip";
import { Segmented } from "@/components/ListUI";

/** The 200-day average: how often each stock has closed below it, for how
 *  long, and where it stands now; and how much of the market is above it.
 *  dma.json (pipeline/export_dma_json.py) and market.json. Owner, 13-Nov-2026:
 *  "Build it. In the research tab." Past behaviour, not a forecast. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const PAGE = 50;

type Row = [string, string, number, number, number, number | null, number | null, number | null, number, number];
type Dma = { generated_at: string; asof: string | null; median_pct_below: number | null; rows: Row[] };
type Market = { breadth: [string, number, number, number][] };

type Size = "large" | "mid" | "all";
const SIZES: readonly (readonly [Size, string])[] = [["large", "Large"], ["mid", "Mid"], ["all", "All"]];
type Sort = "least" | "most" | "now";
const SORTS: readonly (readonly [Sort, string])[] = [["least", "Least below"], ["most", "Most below"], ["now", "Below now"]];

function inSize(mcapCr: number, s: Size) {
  if (s === "large") return mcapCr >= 20000;
  if (s === "mid") return mcapCr >= 5000 && mcapCr < 20000;
  return true;
}

/** A small line of the share of stocks above the 200-day average. */
function Spark({ pts }: { pts: number[] }) {
  if (pts.length < 2) return null;
  const w = 300, h = 44, lo = Math.min(...pts, 0), hi = Math.max(...pts, 100);
  const xy = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - ((v - lo) / (hi - lo)) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-11" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="var(--line)" strokeDasharray="3 3" />
      <polyline points={xy} fill="none" stroke="var(--accent)" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function DmaPage() {
  const [d, setD] = useState<Dma | null>(null);
  const [m, setM] = useState<Market | null>(null);
  const [error, setError] = useState("");
  const [size, setSize] = useState<Size>("large");
  const [sort, setSort] = useState<Sort>("least");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    fetch(`${BASE}/dma.json`)
      .then((r) => { if (r.status === 404) return null; if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setD).catch((e) => setError(String(e.message ?? e)));
    fetch(`${BASE}/market.json`).then((r) => (r.ok ? r.json() : null)).then(setM).catch(() => setM(null));
  }, []);

  const list = useMemo(() => {
    if (!d) return [];
    const t = q.trim().toLowerCase();
    const xs = d.rows.filter((r) => inSize(r[2], size) && (!t || r[0].toLowerCase().includes(t) || r[1].toLowerCase().includes(t)));
    const by = sort === "least" ? (a: Row, b: Row) => a[3] - b[3]
      : sort === "most" ? (a: Row, b: Row) => b[3] - a[3]
      : (a: Row, b: Row) => (a[7] ?? 1e9) - (b[7] ?? 1e9);
    return [...xs].sort(by);
  }, [d, q, size, sort]);

  const br = m?.breadth ?? [];
  const now = br.at(-1), yearAgo = br.length > 200 ? br[0] : null;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="dma" />
      <main className="rs-page-in max-w-3xl mx-auto px-4 py-5 space-y-3">
        <h1 className="text-xl font-bold flex items-center gap-1.5">
          200-day average
          <InfoTip title="Time below the 200-day average">
            <p><b>Below %</b>: share of weeks over the last ~5 years (at least three measured) the stock closed below its 40-week average (the weekly form of the 200-day).</p>
            <p><b>Typical dip</b> and <b>Longest</b>: how many weeks a stay below lasted, counting stays of two weeks or more.</p>
            <p><b>Now</b>: today&apos;s close against the daily 200-day average, and how many weeks it has been on that side of the weekly line.</p>
            <p>From this app&apos;s own weekly and daily closes (Yahoo, topped up from the exchanges). Not checked further.</p>
          </InfoTip>
        </h1>

        <section className="rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] text-[var(--warn-ink)] px-3 py-2.5 text-[13px] leading-relaxed">
          <b>Past behaviour, not a forecast.</b>{" "}A stock that rarely stayed below the line is not more likely to bounce next time.
          Tested on this app&apos;s data (13-Nov-2026): buying large caps the first time they closed below their 200-day
          average returned a median <b>+8.8% over 12 months</b>, against <b>+15.3%</b> for the same stocks bought at any time.
          Stocks that seldom dipped in one decade were barely more likely to do so in the next.
        </section>

        {now && (
          <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[13px] font-semibold">NSE stocks above their 200-day average</h2>
              <span className="text-lg font-bold tabular-nums">{now[1]}%</span>
            </div>
            <Spark pts={br.map((b) => b[1])} />
            <p className="text-[11px] text-[var(--ink3)]">
              Last {br.length} sessions{yearAgo ? `; ${yearAgo[1]}% a year ago` : ""}. Above 50-day: {now[2]}%. Of {now[3].toLocaleString("en-IN")} stocks.
            </p>
          </section>
        )}

        {error && <p className="text-[var(--neg)] text-sm">{error}</p>}
        {!d && !error && <div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}

        {d && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search stock" aria-label="Search stocks"
                className="flex-1 min-w-[120px] h-[38px] px-3 rounded-xl border border-[var(--line)] bg-[var(--card)] text-[14px] outline-none focus:border-[var(--accent-line)]" />
              <Segmented label="Size" value={size} options={SIZES} onChange={(v) => { setSize(v); setLimit(PAGE); }} />
            </div>
            <Segmented label="Order" value={sort} options={SORTS} onChange={(v) => { setSort(v); setLimit(PAGE); }} />
            <p className="text-[12px] text-[var(--ink3)]">
              {list.length.toLocaleString("en-IN")} stocks. The typical stock spent {d.median_pct_below}% of weeks below the line.
            </p>

            <div className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1fr)_52px_46px_46px_62px] gap-1 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--ink3)] border-b border-[var(--line)]">
                <span>Stock</span><span className="text-right">Below</span><span className="text-right">Dip</span><span className="text-right">Max</span><span className="text-right">Now</span>
              </div>
              {list.slice(0, limit).map((r) => (
                <Link key={r[0]} href={`/company?s=${encodeURIComponent(r[0])}`}
                  className="grid grid-cols-[minmax(0,1fr)_52px_46px_46px_62px] gap-1 px-3 py-2 items-center border-b border-[var(--line)] last:border-b-0 hover:bg-[var(--card2)]">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold truncate">{r[0]}</span>
                    <span className="block text-[11px] text-[var(--ink3)] truncate">{r[1]}</span>
                  </span>
                  <span className="text-right text-[13px] tabular-nums">{r[3]}%</span>
                  <span className="text-right text-[12.5px] tabular-nums text-[var(--ink2)]">{r[5] === null ? "—" : `${r[5]}w`}</span>
                  <span className="text-right text-[12.5px] tabular-nums text-[var(--ink2)]">{r[6] === null ? "—" : `${r[6]}w`}</span>
                  <span className="text-right">
                    <span className={`block text-[13px] tabular-nums ${r[7] === null ? "" : r[7] >= 0 ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>
                      {r[7] === null ? "—" : `${r[7] > 0 ? "+" : r[7] < 0 ? "−" : ""}${Math.abs(r[7])}%`}
                    </span>
                    <span className="block text-[10.5px] text-[var(--ink3)]">{Math.abs(r[8])}w {r[8] < 0 ? "below" : "above"}</span>
                  </span>
                </Link>
              ))}
            </div>
            {list.length > limit && (
              <button type="button" onClick={() => setLimit(limit + PAGE)}
                className="rs-press w-full min-h-[42px] rounded-xl border border-[var(--line)] text-[13.5px] font-medium text-[var(--ink2)]">
                Show {Math.min(PAGE, list.length - limit)} more
              </button>
            )}
            <p className="text-[11px] text-[var(--ink3)]">Closes up to {d.asof ?? "—"}. Below / Dip / Max from weekly closes over ~5 years; Now from the daily 200-day average.</p>
          </>
        )}
      </main>
    </div>
  );
}
