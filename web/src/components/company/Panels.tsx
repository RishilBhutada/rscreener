"use client";

/** The company page's smaller panels: data checks, coverage, price history,
 *  announcements, filings, pros and cons, alerts, about, and the refetch button. */

import { ChevronGlyph } from "@/components/Glyphs";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Quarter } from "@/components/StockChart";
import { Row } from "@/lib/query";
import InfoTip, { InfoDialog } from "@/components/InfoTip";
import { markSaved } from "@/lib/sync";
import { IconButton } from "@/components/QuoteUI";
import { Company, Coverage } from "@/components/company/types";
import { BASE, monthYear, fmtNum, num } from "@/components/company/format";

/** Says why the history starts where it starts, instead of leaving a short chart
 *  to look like a fault in the site.
 *
 *  Cemindia Projects is the case that prompted it: NSE's index lists its
 *  2005-2017 results and every one of those archive links returns 404, while
 *  three later quarters were never filed at all. A ratio needs four CONSECUTIVE
 *  quarters, so a single hole pushes the line forward a year - which is
 *  completely invisible unless the page says so.
 */
/** The nightly checks this company's own figures failed (P8, 1-Nov-2026):
 *  two sources that disagree, quarters that do not add up to their year, a
 *  year far from the company's own history. Read from checks.json, written by
 *  pipeline/scorecard.py; nothing shows when every check passed. */
/** The file a company's checks are in: its first letter, or "0". Matches
 *  check_shard in pipeline/scorecard.py. One letter's file is about 15 KB;
 *  the single file it replaced was 389 KB for every company page. */
export function checkShard(symbol: string): string {
  const c = symbol.slice(0, 1).toUpperCase();
  return c >= "A" && c <= "Z" ? c : "0";
}

export const checksCache = new Map<string, Promise<Record<string, [string, string, string][]>>>();

export function DataChecks({ symbol }: { symbol: string }) {
  const [fails, setFails] = useState<[string, string, string][] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // A file that did not arrive is not "every check passed": it is not kept,
    // and the page says the checks could not be read.
    const shard = checkShard(symbol);
    let load = checksCache.get(shard);
    if (!load) {
      load = fetch(`${BASE}/checks/${shard}.json`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d) => d.fails ?? {});
      checksCache.set(shard, load);
    }
    let live = true;
    load.then((all) => { if (live) setFails(all[symbol] ?? []); })
      .catch(() => { checksCache.delete(shard); if (live) setFailed(true); });
    return () => { live = false; };
  }, [symbol]);
  if (failed) return <p className="mt-1 text-[11px] text-[var(--ink3)]">Data checks could not be loaded.</p>;
  if (!fails?.length) return null;
  return (
    <p className="mt-1 text-[11px] text-[var(--ink3)]">
      {fails.length} figure{fails.length === 1 ? "" : "s"} failed a data check
      <InfoTip title="Data checks" className="ml-1">
        <p>Every night each company&apos;s figures are checked against a second source or an identity. These failed:</p>
        <ul className="space-y-1.5">
          {fails.slice(0, 15).map(([check, period, detail], i) => (
            <li key={i}><strong>{monthYear(period)} · {check}</strong><br />{detail}</li>
          ))}
        </ul>
        {fails.length > 15 && <p>and {fails.length - 15} more.</p>}
        <p>Two figures that should agree do not. Often the company restated a figure later or merged a business; sometimes it is a reading error on our side. Compare with the filing before relying on it.</p>
      </InfoTip>
    </p>
  );
}

export function CoverageNote({ cov, bandFrom }: { cov?: Coverage | null; bandFrom?: string | null }) {
  if (!cov || !cov.from) return null;
  const gaps = cov.gaps ?? [];
  const nGaps = cov.gap_count ?? gaps.length;
  // Nothing worth saying about a company with a full, unbroken record that
  // already reaches back further than the chart's own range.
  if (nGaps === 0 && cov.from <= "2008-12-31") return null;
  return (
    <p className="mt-3 text-[11px] text-[var(--ink3)]">
      Filings from {monthYear(cov.from)}
      {nGaps > 0 ? ` · ${nGaps} quarter${nGaps === 1 ? "" : "s"} missing` : ""}
      <InfoTip title="Why the history starts where it does" className="ml-1">
        <p>
          Filings on record for this company begin <strong>{monthYear(cov.from)}</strong> ({cov.quarters} quarters).
        </p>
        {nGaps > 0 && (
          <p>
            {nGaps === 1 ? "One quarter is" : `${nGaps} quarters are`} missing from those records
            {gaps.length > 0 && <> — {gaps.slice(0, 6).join(", ")}{nGaps > gaps.slice(0, 6).length ? " and others" : ""}</>}.
            {" "}A trailing-twelve-month figure needs four consecutive quarters, so each gap moves the ratio lines forward by a year.
          </p>
        )}
        {bandFrom && <p>The valuation lines therefore begin <strong>{monthYear(bandFrom)}</strong>.</p>}
        <p>Nothing here is estimated: a quarter that was never filed is left out rather than filled in.</p>
      </InfoTip>
    </p>
  );
}

/** The indices the company is in: the first few, the rest one tap away. */
export function IndexChips({ list }: { list?: [string, string, string][] | null }) {
  // Behind a small button on the ticker line (owner, 27-Oct-2026: "only by
  // drop down beside the name, not always").
  const [open, setOpen] = useState(false);
  if (!list?.length) return null;
  return (
    <>
      {" · "}
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="inline-flex items-center gap-0.5 text-[var(--accent-ink)] font-medium">
        {list.length} {list.length === 1 ? "index" : "indices"}
        <ChevronGlyph size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
          {list.map(([sym, name]) => (
            <Link key={sym} href={`/indices/view?s=${encodeURIComponent(sym)}`}
              className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[var(--ink2)] hover:bg-[var(--card2)]">
              {name.replace(/^NIFTY\b/, "Nifty")}
            </Link>
          ))}
        </span>
      )}
    </>
  );
}

/** The date the displayed price actually belongs to.
 *  A price with no date on it is untestable — that is how a snapshot from 10-Jul
 *  stayed on screen for three weeks looking exactly like a live quote. If the
 *  close is older than the last trading day, say so instead of implying "now". */
export function PriceAsOf({ row, snapshot }: { row: Row | null; snapshot?: Row | null }) {
  const [now] = useState(() => Date.now());
  const d = row?.["price_date"] ?? snapshot?.["price_date"];
  if (typeof d !== "string" || !d) return null;
  const asof = new Date(d + "T00:00:00");
  const days = Math.floor((now - asof.getTime()) / 86400000);
  const label = asof.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const old = days > 4;
  return (
    <span
      title={old ? "This close is behind the market — the price feed has not refreshed for this stock." : "Closing price on this date"}
      className={`text-xs font-medium ${old ? "text-[var(--neg)]" : "text-[var(--ink3)]"}`}
    >
      Close of {label}{old ? " · stale" : ""}
    </span>
  );
}

/** Behind the "i" on both cards. One set of words, two buttons: whichever
 *  column the reader is looking at when he wonders where these came from is
 *  the one carrying the answer. */
export const PROS_CONS_NOTE = (
  <>
    <p>
      These are generated from the numbers by simple rules — not analysis, and never a
      recommendation.
    </p>
    <p>Verify against the filings before trusting anything.</p>
  </>
);

export function ProsCons({ row }: { row: Row | null }) {
  if (!row) return null;
  const pros: string[] = [];
  const cons: string[] = [];
  const roce = num(row, "roce"), roe = num(row, "roe"), dy = num(row, "div_yield");
  const de = num(row, "de"), sg = num(row, "sales_cagr_5y"), pg = num(row, "profit_cagr_5y");
  const payout = num(row, "div_payout"), prom = num(row, "promoter_holding");
  const pe = num(row, "pe"), medpe = num(row, "median_pe_5y"), offHigh = num(row, "off_52w_high");

  if (roce !== null && roce > 20) pros.push(`Efficient use of capital — ROCE of ${roce.toFixed(0)}%.`);
  if (roe !== null && roe > 15) pros.push(`Strong return on equity of ${roe.toFixed(0)}%.`);
  if (dy !== null && dy > 2) pros.push(`Healthy dividend yield of ${dy.toFixed(1)}%.`);
  if (de !== null && de < 0.1) pros.push(`Nearly debt-free (debt-to-equity ${de.toFixed(2)}).`);
  if (pg !== null && pg > 15) pros.push(`Profit compounded at ${pg.toFixed(0)}% a year over 5 years.`);
  if (payout !== null && payout >= 20 && payout <= 80) pros.push(`Sustainable dividend payout of ${payout.toFixed(0)}%.`);

  if (sg !== null && sg < 10) cons.push(`Modest sales growth of ${sg.toFixed(0)}% a year over 5 years.`);
  if (de !== null && de > 1) cons.push(`Carries meaningful debt (debt-to-equity ${de.toFixed(1)}).`);
  if (roe !== null && roe < 10) cons.push(`Low return on equity of ${roe.toFixed(0)}%.`);
  if (pe !== null && medpe !== null && pe > medpe * 1.3) cons.push(`Trading above its 5-year median P/E (${pe.toFixed(0)} vs ${medpe.toFixed(0)}).`);
  if (prom !== null && prom < 35) cons.push(`Low promoter holding of ${prom.toFixed(0)}%.`);
  if (offHigh !== null && offHigh < -40) cons.push(`Down ${Math.abs(offHigh).toFixed(0)}% from its 52-week high.`);

  if (pros.length === 0 && cons.length === 0) return null;
  return (
    <section className="grid sm:grid-cols-2 gap-4">
      <div className="rounded-xl border border-[var(--pos)] bg-[color-mix(in_oklab,var(--pos)_8%,var(--card))] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--pos)] mb-2">
          Pros
          <InfoTip title="Pros and cons" className="ml-1">{PROS_CONS_NOTE}</InfoTip>
        </p>
        <ul className="space-y-1.5 text-sm text-[var(--ink2)] list-disc pl-4">
          {pros.length ? pros.map((p) => <li key={p}>{p}</li>) : <li className="list-none text-[var(--ink3)]">No standout positives from the current numbers.</li>}
        </ul>
      </div>
      <div className="rounded-xl border border-[var(--neg)] bg-[color-mix(in_oklab,var(--neg)_8%,var(--card))] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--neg)] mb-2">
          Cons
          <InfoTip title="Pros and cons" className="ml-1">{PROS_CONS_NOTE}</InfoTip>
        </p>
        <ul className="space-y-1.5 text-sm text-[var(--ink2)] list-disc pl-4">
          {cons.length ? cons.map((c) => <li key={c}>{c}</li>) : <li className="list-none text-[var(--ink3)]">No obvious red flags from the current numbers.</li>}
        </ul>
      </div>
    </section>
  );
}

/** The company's announcements as NSE lists them (fetch_announcement_docs.py,
 *  newest 50): Recent, or only the kinds that move a share (results, board
 *  outcomes, dividends, ratings, deals, orders), and a search over the subject
 *  and NSE's category - screener.in's Announcements box, without its AI
 *  summaries (the app shows no model-written text). */
export function Announcements({ list }: { list: [string, string, string, string, number][] }) {
  const [tab, setTab] = useState<"recent" | "important">("recent");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = list.filter((a) => (tab === "recent" || a[4] === 1)
    && words.every((w) => `${a[1]} ${a[2]}`.toLowerCase().includes(w)));
  const shown = all || words.length ? rows : rows.slice(0, 8);
  const when = (at: string) => new Date(`${at.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-[13px] font-semibold text-[var(--ink)] mr-auto">Announcements</h3>
        <div className="inline-flex gap-0.5 rounded-lg bg-[var(--card2)] p-0.5 text-xs" role="radiogroup" aria-label="Announcements">
          {([["recent", "Recent"], ["important", "Important"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={tab === k} onClick={() => setTab(k)}
              className={`rounded-md px-2.5 py-1 font-medium ${tab === k ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>{label}</button>
          ))}
        </div>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search announcements"
        className="w-full rounded-lg border border-[var(--line)] bg-[var(--card2)] px-3 py-2 text-sm text-[var(--ink)] placeholder:text-[var(--ink3)]" />
      {shown.length === 0 ? (
        <p className="text-xs text-[var(--ink3)]">{words.length ? "No announcement matches." : "None in the latest fifty."}</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {shown.map((a, i) => (
            <li key={`${a[0]}-${i}`} className="py-1.5">
              <a href={a[3]} target="_blank" rel="noopener noreferrer" className="block hover:underline">
                <span className="text-[13px] text-[var(--ink)] line-clamp-2">{a[2] || a[1]}</span>
                <span className="text-[11px] text-[var(--ink3)]">{when(a[0])} · {a[1]}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {!words.length && rows.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="text-[13px] font-semibold text-[var(--accent-ink)]">
          {all ? "Fewer" : `All ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/** The "i" beside a figure in the summary grid.
 *
 *  This used to be an eye, and opening it pushed a panel onto the bottom of
 *  the section — so the answer appeared several inches away from the number
 *  that raised the question, and on a phone often off-screen entirely. Now
 *  it is the same "i" used everywhere else, and the words arrive on top of
 *  the page rather than under it. */
/** Price history and performance, in one block.
 *
 *  Every figure here was already being published in data.json and none of it
 *  was on the company page. The returns existed only as screener columns, so
 *  you could filter on a stock's three-year return but not read it on its own
 *  page; the 52-week range was two numbers in a corner with no sense of where
 *  today sits between them. Simply Wall St puts the whole ladder in one table
 *  and it is the right shape - a price means little without the path.
 *
 *  Nothing new is fetched. This is layout over numbers the app already had.
 */
export function PriceHistory({ row, snapshot }: { row: Row | null; snapshot: Row }) {
  const g = (k: string) => num(row, k) ?? num(snapshot, k);
  const price = g("price"), hi = g("wk52_high"), lo = g("wk52_low");
  const returns: [string, number | null][] = [
    ["1M", g("ret_1m")], ["3M", g("ret_3m")], ["6M", g("ret_6m")],
    ["1Y", g("ret_1y")], ["3Y", g("ret_3y")], ["5Y", g("ret_5y")],
  ];
  const shown = returns.filter(([, v]) => v !== null && v !== undefined);
  const at = price !== null && hi !== null && lo !== null && hi > lo
    ? Math.min(100, Math.max(0, ((price - lo) / (hi - lo)) * 100))
    : null;
  const off = price !== null && hi ? ((price - hi) / hi) * 100 : null;
  const beta = g("beta");
  if (shown.length === 0 && at === null) return null;
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <h2 className="text-base font-semibold text-[var(--ink)]">
        Price history
        <InfoTip title="Price history" className="ml-1.5">
          <p>Change in the share price alone.</p>
          <p>Dividends are not added back, so a high-yield company has done better than these figures say.</p>
          {beta !== null && beta !== undefined && (
            <p>
              Beta {fmtNum(beta)}: over the last year this share moved about{" "}
              {Math.abs(beta) < 0.05 ? "independently of" : `${fmtNum(Math.abs(beta))}× as far as`} the market on an
              average day. A number below 1 is not safety; it is only a smaller swing.
            </p>
          )}
        </InfoTip>
      </h2>
      {shown.length > 0 && (
        <div className="mt-2.5 grid grid-cols-6 gap-1 text-center">
          {shown.map(([label, v]) => (
            <div key={label}>
              <p className="text-[10.5px] text-[var(--ink3)]">{label}</p>
              <p className="text-[13px] font-semibold tabular-nums" style={{ color: (v as number) > 0 ? "var(--pos)" : (v as number) < 0 ? "var(--neg)" : "var(--ink2)" }}>
                {(v as number) > 0 ? "+" : (v as number) < 0 ? "−" : ""}{fmtNum(Math.abs(v as number), 1)}%
              </p>
            </div>
          ))}
        </div>
      )}
      {at !== null && (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-[11px] text-[var(--ink3)] tabular-nums">
            <span>₹{fmtNum(lo, 0)}</span>
            <div className="relative flex-1 h-1 rounded-full bg-[var(--line)]">
              <div className="absolute -top-1 w-[2px] h-3 bg-[var(--ink)]" style={{ left: `calc(${at}% - 1px)` }} />
            </div>
            <span>₹{fmtNum(hi, 0)}</span>
          </div>
          <div className="flex justify-between text-[10.5px] text-[var(--ink3)] mt-0.5">
            <span>52-week low</span>
            {off !== null && <span className="tabular-nums">From high {off > 0 ? "+" : off < 0 ? "−" : ""}{Math.abs(off).toFixed(1)}%</span>}
            <span>52-week high</span>
          </div>
        </div>
      )}
      {beta !== null && beta !== undefined && (
        <p className="text-[11px] text-[var(--ink3)] mt-2">Beta {fmtNum(beta)}</p>
      )}
    </section>
  );
}

/** The Filings tab's lists (Step 5): each kind of filing on its own, newest
 *  first, four shown and the rest one tap away. A results PDF is the one
 *  attached to that quarter's results announcement on NSE. */
export function FilingLists({ docs, quarters }: { docs?: Company["documents"] | null; quarters?: Quarter[] | null }) {
  const [all, setAll] = useState<Record<string, boolean>>({});
  const day = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
  const qName = (end: string) => `${new Date(`${end}T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })} quarter`;
  const what = (t: string, kind?: string) => kind === "PPT" ? "Presentation" : kind === "Recording" ? "Recording"
    : /transcript/i.test(t) ? "Transcript" : /recording/i.test(t) ? "Recording link" : /presentation/i.test(t) ? "Presentation"
    : /meet/i.test(t) ? "Analyst meet" : (t || "Document").replace(/^.{0,120}?has informed the exchange (?:about|regarding)\s*/i, "").replace(/['".]+$/g, "");
  const pdfUrl = (u: string) => (u.includes("://") ? u : `https://nsearchives.nseindia.com/corporate/${u}`);

  const lists: { key: string; title: string; rows: { left: string; mid: string; url: string; link: string }[] }[] = [
    { key: "results", title: "Results filings",
      rows: [...(quarters ?? [])].filter((q) => q.pdf).reverse()
        .map((q) => ({ left: qName(q.end), mid: q.announced ? day(q.announced) : "", url: pdfUrl(q.pdf!), link: "PDF" })) },
    { key: "reports", title: "Annual reports",
      rows: [...(docs?.annual_reports ?? [])].sort((x, y) => Number(y.to) - Number(x.to))
        .map((r) => ({ left: `FY${String(r.to).slice(-2)}`, mid: `${r.from}–${String(r.to).slice(-2)}`, url: r.url, link: "PDF" })) },
    { key: "concalls", title: "Concalls",
      rows: [...(docs?.concalls ?? []).map((d) => ({ d, k: "" })), ...(docs?.ppts ?? []).map((d) => ({ d, k: "PPT" })), ...(docs?.recordings ?? []).map((d) => ({ d, k: "Recording" }))]
        .sort((x, y) => y.d.date.localeCompare(x.d.date))
        .map(({ d, k }) => ({ left: day(d.date), mid: what(d.title, k), url: d.url, link: "Open" })) },
    { key: "ratings", title: "Credit ratings",
      rows: [...(docs?.ratings ?? [])].sort((x, y) => y.date.localeCompare(x.date))
        .map((d) => ({ left: day(d.date), mid: "Credit rating letter", url: d.url, link: "PDF" })) },
  ].filter((l) => l.rows.length > 0);

  if (lists.length === 0) return null;
  return (
    <div className="space-y-4">
      {lists.map((l) => {
        const open = all[l.key];
        const shown = open ? l.rows : l.rows.slice(0, 4);
        return (
          <div key={l.key}>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="text-[13.5px] font-semibold text-[var(--ink)]">{l.title}</h3>
              {l.rows.length > 4 && (
                <button type="button" onClick={() => setAll({ ...all, [l.key]: !open })} className="text-[12px] font-semibold text-[var(--accent-ink)]">
                  {open ? "Fewer" : `All ${l.rows.length}`}
                </button>
              )}
            </div>
            <ul className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {shown.map((r) => (
                <li key={r.url}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer"
                    className="grid grid-cols-[96px_minmax(0,1fr)_40px] items-center gap-2 py-2 text-[13px] hover:bg-[var(--card2)]">
                    <span className="text-[var(--ink)] tabular-nums truncate">{r.left}</span>
                    <span className="text-[var(--ink2)] truncate">{r.mid}</span>
                    <span className="text-right text-[var(--accent-ink)] font-semibold inline-flex items-center justify-end gap-0.5">{r.link}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** The company's own icon (fetch_logos.py), else its initials on a colour
 *  taken from the ticker - every company gets the same tile every time. */
export function CompanyMark({ name, symbol, logo }: { name: string; symbol: string; logo?: string | null }) {
  const [broken, setBroken] = useState(false);
  const words = name.replace(/\b(limited|ltd|india|industries|corporation|company|the)\b\.?/gi, " ").trim().split(/\s+/).filter(Boolean);
  const initials = ((words[0]?.[0] ?? symbol[0] ?? "") + (words[1]?.[0] ?? symbol[1] ?? "")).toUpperCase();
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) % 360;
  if (logo && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`${BASE}/${logo}`} alt="" width={44} height={44} onError={() => setBroken(true)}
        className="w-11 h-11 rounded-xl bg-white object-contain p-1 border border-[var(--line)] shrink-0" />
    );
  }
  return (
    <span aria-hidden="true" className="w-11 h-11 rounded-xl shrink-0 inline-flex items-center justify-center text-[15px] font-bold text-white"
      style={{ background: `hsl(${h} 45% 42%)` }}>{initials}</span>
  );
}

/** Price alerts for this company (alerts/price_alerts.py): a push when the
 *  price crosses a level, checked every twenty minutes in market hours on a
 *  quote about fifteen minutes behind NSE. Kept as rs_price_alerts, synced -
 *  the cloud check reads them from the signed-in account. */
export type PriceAlert = { s: string; op: ">" | "<"; p: number };

export function loadAlerts(): PriceAlert[] {
  try {
    const v = JSON.parse(localStorage.getItem("rs_price_alerts") ?? "[]");
    return Array.isArray(v) ? v.filter((a) => a && typeof a.s === "string" && (a.op === ">" || a.op === "<") && typeof a.p === "number") : [];
  } catch { return []; }
}

export function PriceAlerts({ symbol, price, onClose }: { symbol: string; price: number | null; onClose: () => void }) {
  const [all, setAll] = useState<PriceAlert[]>([]);
  const [op, setOp] = useState<">" | "<">(">");
  const [level, setLevel] = useState("");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read from this browser's storage after mount; the prerendered page has none
  useEffect(() => { setAll(loadAlerts()); }, []);
  const save = (next: PriceAlert[]) => {
    setAll(next);
    try { localStorage.setItem("rs_price_alerts", JSON.stringify(next)); markSaved("rs_price_alerts"); } catch { /* not remembered */ }
  };
  const mine = all.filter((a) => a.s === symbol);
  const n = Number(level.replace(/,/g, ""));
  const ok = Number.isFinite(n) && n > 0;
  return (
    <InfoDialog title="Price alerts" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-[var(--ink3)] text-xs">A push to your phone when {symbol} crosses a price, once a day per alert. Checked every 20 minutes in market hours on a quote about 15 minutes behind NSE.{price ? ` Now ₹${fmtNum(price)}.` : ""}</p>
        <div className="flex items-center gap-2">
          <div className="inline-flex gap-0.5 rounded-lg bg-[var(--card2)] p-0.5 text-xs" role="radiogroup" aria-label="Direction">
            {([[">", "Above"], ["<", "Below"]] as const).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={op === k} onClick={() => setOp(k)}
                className={`rounded-md px-2.5 py-1.5 font-medium ${op === k ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>{label}</button>
            ))}
          </div>
          <input inputMode="decimal" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="₹ price"
            className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--card2)] px-3 py-2 text-[var(--ink)]" />
          <button type="button" disabled={!ok} onClick={() => { save([...all, { s: symbol, op, p: n }]); setLevel(""); }}
            className="rounded-lg px-3 py-2 font-semibold bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] disabled:opacity-40">Add</button>
        </div>
        {mine.length > 0 && (
          <ul className="divide-y divide-[var(--line)]">
            {mine.map((a, i) => (
              <li key={i} className="py-1.5 flex items-center justify-between">
                <span>{a.op === ">" ? "Above" : "Below"} ₹{fmtNum(a.p)}</span>
                <button type="button" onClick={() => save(all.filter((x) => x !== a))} className="text-xs text-[var(--ink3)]">Remove</button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-[var(--ink3)]">Pushes reach your phone once you are signed in (the cloud check reads your account) and the ntfy app is subscribed - Settings › Phone alerts.</p>
      </div>
    </InfoDialog>
  );
}

/** "What it does" under the company's name, opened on tap (owner, 15-Oct-2026).
 *  From the company's Wikipedia article, shown with its title, link and
 *  licence as CC BY-SA asks; only an article whose infobox carries this
 *  company's ticker is used. No article, no control - nothing dead to tap. */
export function AboutCompany({ about }: { about?: Company["about"] }) {
  const [open, setOpen] = useState(false);
  if (!about || (!about.text && !about.short)) return null;
  return (
    <div className="-mt-4">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="inline-flex items-center gap-1 text-[13px] text-[var(--accent-ink)]">
        {about.short ? about.short.charAt(0).toUpperCase() + about.short.slice(1) : "What it does"}
        <ChevronGlyph size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 text-[13px] leading-relaxed text-[var(--ink2)] space-y-2">
          {(about.text ?? "").split("\n\n").filter(Boolean).map((para, i) => <p key={i}>{para}</p>)}
          <p className="text-[11px] text-[var(--ink3)]">
            From Wikipedia&apos;s article{" "}
            <a href={about.url} target="_blank" rel="noopener noreferrer" className="underline">{about.title}</a>
            , under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer" className="underline">CC BY-SA 4.0</a>.
            Written by its editors, not checked by Rscreener.
          </p>
        </div>
      )}
    </div>
  );
}

export const REPO = "https://github.com/RishilBhutada/rscreener";

/** Data missing or stale on this page? Re-fetch all of it (owner, 15-Oct-2026).
 *
 *  The fetching runs on GitHub, and starting a run needs a token - which must
 *  never ship inside the app, where anyone could lift it. So this opens a
 *  pre-filled issue "Refetch SYMBOL"; submitting it starts refetch.yml, which
 *  acts only on issues from the owner's account, re-reads everything for the
 *  company, republishes its page, replies on the issue and closes it. */
export function RefetchButton({ symbol }: { symbol: string }) {
  const [open, setOpen] = useState(false);
  const body = `Requested from the Rscreener app: ${symbol}'s data looks missing or out of date.\n\n`
    + `Submitting this re-fetches everything for ${symbol} and republishes its page. `
    + "The run replies here and closes this when it is done.";
  const url = `${REPO}/issues/new?title=${encodeURIComponent(`Refetch ${symbol}`)}&body=${encodeURIComponent(body)}`;
  return (
    <>
      <IconButton name="refresh" label="Refetch this company's data" onClick={() => setOpen(true)} />
      {open && (
        <InfoDialog title={`Refetch ${symbol}'s data`} onClose={() => setOpen(false)}>
          <p>If something on this page is missing or out of date, this fetches everything for {symbol} again - prices, quarterly results and statements, shareholding, filing dates, corporate actions, annual reports and announcements - and republishes its page.</p>
          <p>It runs on GitHub. The button opens your request there, already filled in: tap <b>Submit new issue</b>. Only requests from your GitHub account are acted on. It takes about 10 to 20 minutes - longer while the nightly refresh is running - and your phone is told when it is done.</p>
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="rs-press mt-1 inline-flex items-center justify-center w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
            Open the request on GitHub
          </a>
          <p className="text-[11px] text-[var(--ink3)]">Sources that refuse programs stay as they are: a company listed only on BSE has fewer sources to fetch from.</p>
        </InfoDialog>
      )}
    </>
  );
}
