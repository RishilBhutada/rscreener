"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Sub = { category: string; times: number | null; offered: number | null; bid: number | null; as_of: string };
type Issue = {
  symbol: string; company: string | null; open: string | null; close: string | null;
  band: string | null; size: number | null; status: string | null; segment?: string; subscription: Sub[];
};
type Listed = {
  symbol: string; company: string | null; listing_date: string | null;
  issue_price: number | null; listing_close: number | null; listing_gain_pct: number | null;
  segment?: string;
};
type GmpRow = {
  ipo_name: string; gmp: number | null; price: number | null; est_listing: number | null;
  est_gain_pct: number | null; ipo_dates: string | null; ipo_type: string | null;
  status: string | null; source_updated: string | null;
};
type Scored = {
  symbol: string; company: string | null; listing_date: string | null;
  gmp: number | null; gmp_implied_pct: number | null; actual_gain_pct: number | null; error_pct: number | null;
};
type Data = {
  generated_at: string;
  current: Issue[]; upcoming: Issue[]; recent: Listed[];
  listing_stats: { n: number; positive_pct: number | null; avg_gain_pct: number | null; median_gain_pct: number | null };
  gmp: { as_of: string | null; source: string; rows: GmpRow[] };
  gmp_scoreboard: { rows: Scored[]; summary: { n?: number; direction_hit_pct?: number; avg_abs_error_pct?: number; overstated_pct?: number } };
};

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

function Pct({ v, bold }: { v: number | null | undefined; bold?: boolean }) {
  if (v === null || v === undefined) return <span className="text-[var(--ink3)]">—</span>;
  const c = v > 0 ? "var(--pos)" : v < 0 ? "var(--neg)" : "var(--ink2)";
  return (
    <span className={`tabular-nums ${bold ? "font-semibold" : ""}`} style={{ color: c }}>
      {v > 0 ? "+" : ""}{v.toFixed(1)}%
    </span>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3 sm:p-4">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
        {sub && <p className="text-xs text-[var(--ink3)] mt-0.5">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function IssueCard({ it }: { it: Issue }) {
  const total = it.subscription.find((s) => /total/i.test(s.category)) ?? it.subscription[0];
  return (
    <div className="rounded-lg bg-[var(--card2)] p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <span className="font-semibold text-[var(--ink)]">{it.company || it.symbol}</span>
          <span className="text-xs text-[var(--ink3)] ml-2">{it.symbol}</span>
        </div>
        {it.status && (
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent-ink)]">
            {it.status}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--ink2)]">
        <span>Price band</span><span className="text-right text-[var(--ink)] tabular-nums">{it.band || "—"}</span>
        <span>Opens</span><span className="text-right tabular-nums">{fmtDate(it.open)}</span>
        <span>Closes</span><span className="text-right tabular-nums">{fmtDate(it.close)}</span>
      </div>
      {total?.times !== null && total?.times !== undefined && (
        <div>
          <div className="flex items-baseline justify-between text-xs mb-1">
            <span className="text-[var(--ink2)]">Subscribed ({total.category})</span>
            <span className="font-semibold text-[var(--ink)] tabular-nums">{total.times.toFixed(2)}×</span>
          </div>
          <div className="h-2 rounded-full bg-[var(--line)] overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (total.times / 10) * 100)}%`,
                background: total.times >= 1 ? "var(--pos)" : "var(--accent)",
              }}
            />
          </div>
          <p className="text-[10px] text-[var(--ink3)] mt-1">bar scaled to 10× · as of {total.as_of}</p>
        </div>
      )}
    </div>
  );
}

/** SME issues behave nothing like mainboard ones - different lot sizes, listing
 *  bands and liquidity - so mixing them in one list makes both harder to read. */
function segmentOf(x: { ipo_type?: string | null; symbol?: string; band?: string | null }): "Mainboard" | "SME" {
  return /sme/i.test(String(x.ipo_type ?? "")) ? "SME" : "Mainboard";
}

export default function IpoPage() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [seg, setSeg] = useState<"All" | "Mainboard" | "SME">("All");
  const [tab, setTab] = useState<"open" | "upcoming" | "listed" | "gmp">("open");
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch(`${BASE}/ipos.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setD)
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  const s = d?.listing_stats;
  const sb = d?.gmp_scoreboard;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="ipo" />
      <main className="max-w-6xl mx-auto px-4 py-5 sm:py-6 space-y-4 sm:space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--ink)]">IPOs</h1>
          <p className="text-sm text-[var(--ink2)] mt-1">
            Official issue and subscription data from NSE, the grey-market premium reported by the market, and
            what past IPOs actually did on listing day.
          </p>
        </div>

        {err && <p className="text-[var(--neg)] text-sm">{err} — run the pipeline&apos;s fetch_ipos step first.</p>}
        {!d && !err && <p className="text-[var(--ink3)] text-sm">Loading…</p>}

        {d && (() => {
          const ql = q.trim().toLowerCase();
          const hit = (...fields: (string | null | undefined)[]) =>
            !ql || fields.some((f) => String(f ?? "").toLowerCase().includes(ql));
          const bySeg = <T extends { segment?: string }>(xs: T[]) =>
            xs.filter((x) => seg === "All" || (x.segment ?? "Mainboard") === seg);

          const open = bySeg(d.current).filter((x) => hit(x.company, x.symbol));
          const upcoming = bySeg(d.upcoming).filter((x) => hit(x.company, x.symbol));
          const listed = bySeg(d.recent).filter((x) => hit(x.company, x.symbol));
          const gmpRows = d.gmp.rows.filter(
            (r) => (seg === "All" || segmentOf(r) === seg) && hit(r.ipo_name),
          );
          const counts = { open: open.length, upcoming: upcoming.length, listed: listed.length, gmp: gmpRows.length };
          const TABS: [typeof tab, string][] = [
            ["open", "Open now"], ["upcoming", "Upcoming"],
            ["listed", "Recently listed"], ["gmp", "Grey market"],
          ];

          return (
          <>
            {/* one control bar instead of four stacked walls of content */}
            <div className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3 sm:p-4 space-y-3">
              <div className="flex gap-2 flex-wrap items-center">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search an IPO by name or symbol"
                  aria-label="Search IPOs"
                  className="flex-1 min-w-48 text-sm bg-[var(--card2)] border border-[var(--line)] rounded-full px-4 py-2.5 sm:py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <div className="flex gap-1 text-xs" role="group" aria-label="Segment">
                  {(["All", "Mainboard", "SME"] as const).map((sgm) => (
                    <button key={sgm} onClick={() => setSeg(sgm)}
                      className={`rounded-full px-3.5 py-2 sm:py-1 border ${seg === sgm ? "bg-[var(--btn)] border-[var(--btn)] text-[var(--btn-ink)] font-semibold" : "bg-[var(--card)] border-[var(--line)] text-[var(--ink3)]"}`}>
                      {sgm}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-1 flex-wrap text-sm">
                {TABS.map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)}
                    className={`rounded-lg px-3 py-2 sm:py-1.5 font-medium ${tab === k ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--ink2)] hover:bg-[var(--card2)]"}`}>
                    {label} <span className="text-xs text-[var(--ink3)]">{counts[k]}</span>
                  </button>
                ))}
              </div>
            </div>

            {tab === "open" && (
              <Card title="Open now" sub="Live subscription from NSE — official">
                {open.length === 0 ? (
                  <p className="text-sm text-[var(--ink3)]">Nothing open under these filters.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {open.map((it) => <IssueCard key={it.symbol + it.open} it={it} />)}
                  </div>
                )}
              </Card>
            )}

            {tab === "upcoming" && (
              <Card title="Upcoming" sub="Announced, not yet open — official">
                {upcoming.length === 0 ? (
                  <p className="text-sm text-[var(--ink3)]">Nothing upcoming under these filters.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {upcoming.map((it) => <IssueCard key={it.symbol + it.open} it={it} />)}
                  </div>
                )}
              </Card>
            )}

            {tab === "gmp" && (<>
            <Card
              title="Grey market premium"
              sub={`Unofficial · source ${d.gmp.source}${d.gmp.as_of ? ` · captured ${d.gmp.as_of}` : ""}`}
            >
              <div className="rounded-lg border border-[var(--warn-line)] bg-[var(--warn-soft)] p-3 mb-3">
                <p className="text-xs text-[var(--warn-ink)] leading-relaxed">
                  <strong>GMP is not exchange data.</strong> It is a price quoted by a small number of unregulated
                  grey-market dealers. There is no exchange, no audit trail and no official source; SEBI does not
                  recognise it, and because it is thinly quoted it can be moved deliberately to create interest.
                  Treat it as a rumour with a track record — which is exactly what the next section measures.
                </p>
              </div>
              {gmpRows.length === 0 ? (
                <p className="text-sm text-[var(--ink3)]">No grey-market quotes under these filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
                        <th className="px-2 py-2 sm:px-3 text-left font-medium">IPO</th>
                        <th className="px-2 py-2 sm:px-3 text-right font-medium">GMP ₹</th>
                        <th className="px-2 py-2 sm:px-3 text-right font-medium">Band ₹</th>
                        <th className="px-2 py-2 sm:px-3 text-right font-medium whitespace-nowrap">Implied</th>
                        <th className="px-2 py-2 sm:px-3 text-left font-medium hidden sm:table-cell">Type</th>
                        <th className="px-2 py-2 sm:px-3 text-left font-medium hidden sm:table-cell">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gmpRows.map((r, i) => (
                        <tr key={r.ipo_name + i} className="border-b border-[var(--line)]">
                          <td className="px-2 py-2 sm:px-3 max-w-[42vw] sm:max-w-none truncate">{r.ipo_name}</td>
                          <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{r.gmp ?? "—"}</td>
                          <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{r.price ?? "—"}</td>
                          <td className="px-2 py-2 sm:px-3 text-right"><Pct v={r.est_gain_pct} /></td>
                          <td className="px-2 py-2 sm:px-3 text-[var(--ink2)] hidden sm:table-cell">{r.ipo_type || "—"}</td>
                          <td className="px-2 py-2 sm:px-3 text-[var(--ink2)] hidden sm:table-cell">{r.status || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card
              title="Does the grey market get it right?"
              sub="Every quote above is stored, then scored against the real listing-day move once the IPO lists"
            >
              {sb && sb.summary && sb.summary.n ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    {[
                      ["IPOs scored", `${sb.summary.n}`],
                      ["Right direction", `${sb.summary.direction_hit_pct}%`],
                      ["Avg error", `${sb.summary.avg_abs_error_pct}pp`],
                      ["Overstated the gain", `${sb.summary.overstated_pct}%`],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-[var(--card2)] p-3">
                        <div className="text-xs text-[var(--ink3)]">{k}</div>
                        <div className="text-xl font-bold tabular-nums text-[var(--ink)]">{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
                          <th className="px-2 py-2 sm:px-3 text-left font-medium">Company</th>
                          <th className="px-2 py-2 sm:px-3 text-right font-medium">GMP said</th>
                          <th className="px-2 py-2 sm:px-3 text-right font-medium">Actually</th>
                          <th className="px-2 py-2 sm:px-3 text-right font-medium">Off by</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sb.rows.slice(0, 30).map((r) => (
                          <tr key={r.symbol} className="border-b border-[var(--line)]">
                            <td className="px-2 py-2 sm:px-3">
                              <Link href={`/company?s=${r.symbol}`} className="font-medium text-[var(--accent-ink)] hover:underline">
                                {r.company || r.symbol}
                              </Link>
                            </td>
                            <td className="px-2 py-2 sm:px-3 text-right"><Pct v={r.gmp_implied_pct} /></td>
                            <td className="px-2 py-2 sm:px-3 text-right"><Pct v={r.actual_gain_pct} bold /></td>
                            <td className="px-2 py-2 sm:px-3 text-right tabular-nums text-[var(--ink2)]">
                              {r.error_pct === null ? "—" : `${r.error_pct > 0 ? "+" : ""}${r.error_pct.toFixed(1)}pp`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="text-sm text-[var(--ink3)] leading-relaxed">
                  Nothing scored yet. This scoreboard fills itself: each day&apos;s grey-market quotes are saved, and
                  when those IPOs list, the app compares what GMP implied against the actual listing-day return.
                  Historical GMP can&apos;t be bought or backfilled, so the record starts from the first snapshot and
                  grows — the first entries appear once the currently open issues list.
                </p>
              )}
            </Card>
            </>)}

            {tab === "listed" && (
            <Card
              title="Recent listings — what actually happened"
              sub="Listing-day close vs issue price, computed from exchange prices — official"
            >
              {s && s.n > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  {[
                    ["IPOs measured", `${s.n}`],
                    ["Listed above issue", `${s.positive_pct}%`],
                    ["Average", `${s.avg_gain_pct}%`],
                    ["Median", `${s.median_gain_pct}%`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-[var(--card2)] p-3">
                      <div className="text-xs text-[var(--ink3)]">{k}</div>
                      <div className="text-xl font-bold tabular-nums text-[var(--ink)]">{v}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
                      <th className="px-2 py-2 sm:px-3 text-left font-medium">Company</th>
                      <th className="px-2 py-2 sm:px-3 text-right font-medium">Issue ₹</th>
                      <th className="px-2 py-2 sm:px-3 text-right font-medium">Listed ₹</th>
                      <th className="px-2 py-2 sm:px-3 text-right font-medium">Gain</th>
                      <th className="px-2 py-2 sm:px-3 text-right font-medium hidden sm:table-cell">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listed.map((r) => (
                      <tr key={r.symbol + (r.listing_date ?? "")} className="border-b border-[var(--line)]">
                        <td className="px-2 py-2 sm:px-3 max-w-[38vw] sm:max-w-none truncate">
                          <Link href={`/company?s=${r.symbol}`} className="font-medium text-[var(--accent-ink)] hover:underline">
                            {r.company || r.symbol}
                          </Link>
                        </td>
                        <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{r.issue_price ?? "—"}</td>
                        <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{r.listing_close ?? "—"}</td>
                        <td className="px-2 py-2 sm:px-3 text-right"><Pct v={r.listing_gain_pct} bold /></td>
                        <td className="px-2 py-2 sm:px-3 text-right tabular-nums text-[var(--ink2)] hidden sm:table-cell whitespace-nowrap">
                          {fmtDate(r.listing_date)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            )}

            <p className="text-xs text-[var(--ink2)] leading-relaxed">
              <strong>Rscreener does not tell you whether to apply for an IPO.</strong> Official figures come from NSE;
              grey-market figures are unofficial and unverified. Every number here is worth checking against the
              company&apos;s own filings before it informs a decision. Data as of {d.generated_at}.
            </p>
          </>
          );
        })()}
      </main>
    </div>
  );
}
