"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import { loadIndex } from "@/lib/index-data";
import { loadRecent } from "@/lib/store";
import { allWatched, loadLists } from "@/lib/watchlists";
import { shortName } from "@/lib/names";
import { buildIndex, search, didYouMean, type SearchIndex, type SearchRow } from "@/lib/search";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Lite = SearchRow & { price?: number; ret_1m?: number; exchange?: string };

/** A spread across sectors, shown only until there is something of the user's own. */
const SUGGESTED = [
  "RELIANCE", "HDFCBANK", "TCS", "INFY", "ITC", "SBIN",
  "LT", "MARUTI", "SUNPHARMA", "TITAN", "ASIANPAINT", "COALINDIA",
];

export default function Home() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Lite[]>([]);
  const [hi, setHi] = useState(0);
  const [watch, setWatch] = useState<string[]>([]);
  // How many named lists those symbols came from. The heading says "Your
  // watchlist" for one and "Across your 3 watchlists" for several, because with
  // several the chips below are a union and it would otherwise look like one
  // list that has silently grown.
  const [lists, setLists] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [asof, setAsof] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const st = loadLists();
    setWatch(allWatched(st));
    setLists(st.lists.filter((l) => l.symbols.length > 0).length);
    setRecent(loadRecent());
    // The landing page needs a name, a symbol, a price and a one-month return.
    // It used to download the entire screener table to get them.
    loadIndex()
      .then((d) => {
        setRows(d.rows);
        // The date most companies are on, not the newest one any single
        // company reached - see pipeline/export_json.py.
        setAsof(d.price_modal ?? d.price_asof);
      })
      .catch(() => { /* search degrades to nothing rather than an error wall */ });
  }, []);

  // The same matcher the top bar uses. This box had its own copy of the old
  // scorer, so the two search fields on the same site behaved differently and
  // multi-word queries died here too.
  const index = useMemo<SearchIndex | null>(() => (rows.length ? buildIndex(rows) : null), [rows]);
  const { hits: matches } = index ? search(index, q, 10) : { hits: [] as SearchRow[] };
  const suggestion = index && q.trim().length >= 2 && matches.length === 0 ? didYouMean(index, q) : null;

  // The user's own companies, joined to the prices already in memory. No extra
  // fetch: data.json is loaded for search regardless.
  const watchRows = useMemo(() => {
    if (!watch.length || !rows.length) return [];
    const by = new Map(rows.map((r) => [r.symbol, r]));
    return watch.map((s) => by.get(s)).filter(Boolean).slice(0, 8) as Lite[];
  }, [watch, rows]);

  const go = (sym: string) => router.push(`/company?s=${encodeURIComponent(sym)}`);
  const nameOf = (sym: string) => {
    const hit = rows.find((r) => r.symbol === sym);
    return hit ? shortName(hit.name, sym) : sym;
  };

  const Chips = ({ title, syms, more }: {
    title: string;
    syms: string[];
    /** optional link on the right of the heading, e.g. "Manage lists" */
    more?: { href: string; label: string };
  }) =>
    syms.length === 0 ? null : (
      <div className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs uppercase tracking-wide text-[var(--ink3)]">{title}</p>
          {more && (
            <Link href={more.href} className="text-xs text-[var(--accent-ink)] hover:underline shrink-0">
              {more.label}
            </Link>
          )}
        </div>
        {/* One line that scrolls sideways, not a block that wraps. Twelve chips
            with real company names wrapped to three or four rows on a phone,
            so "Recently viewed" and "Your watchlist" between them pushed
            everything else off the first screen. A row you swipe costs one
            line whatever it holds - and it can now hold more than twelve. */}
        <div className="flex gap-2 mt-2 overflow-x-auto -mx-4 px-4 pb-1
                        [scrollbar-width:none] [&::-webkit-scrollbar]:hidden
                        [scroll-snap-type:x_proximity] [scroll-padding-inline:1rem]">
          {syms.slice(0, 20).map((sym) => (
            <Link
              key={sym}
              href={`/company?s=${encodeURIComponent(sym)}`}
              className="text-sm rounded-lg border border-[var(--line)] bg-[var(--card)] px-2.5
                         min-h-[44px] flex items-center whitespace-nowrap shrink-0
                         [scroll-snap-align:start]
                         text-[var(--ink2)] hover:border-[var(--line2)] hover:text-[var(--ink)]"
            >
              {nameOf(sym)}
            </Link>
          ))}
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="home" />

      {/* No headline and no strapline. "Every listed company, in one place"
          and a sentence about twenty years of financials sat above the search
          box on every visit - an advert for the app, shown to the one person
          already using it, pushing his own watchlist down the screen. */}
      <main className="max-w-2xl mx-auto px-4 pt-5 sm:pt-12 pb-12">
        <div className="relative">
          <svg viewBox="0 0 24 24" aria-hidden="true"
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--ink3)] pointer-events-none">
            <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M16.5 16.5 L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHi(Math.min(hi + 1, matches.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi(Math.max(hi - 1, 0)); }
              else if (e.key === "Enter" && matches[hi]) go(matches[hi].symbol);
              else if (e.key === "Escape") setQ("");
            }}
            placeholder="Search a company or symbol"
            aria-label="Search for a company"
            autoComplete="off"
            className="w-full rounded-xl border border-[var(--line2)] bg-[var(--card)] pl-11 pr-4 py-3.5 text-base
                       text-[var(--ink)] placeholder:text-[var(--ink3)]
                       focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)]"
          />
          {matches.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-[var(--card)] border border-[var(--line2)]
                            rounded-xl shadow-lg overflow-hidden z-20">
              {matches.map((m, i) => (
                <button
                  key={m.symbol}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => go(m.symbol)}
                  className={`w-full text-left px-4 py-2.5 flex items-baseline justify-between gap-3 ${
                    i === hi ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--card2)]"}`}
                >
                  <span className="font-semibold text-[var(--ink)] truncate">{m.name || m.symbol}</span>
                  <span className="text-[var(--ink3)] text-xs shrink-0">{m.symbol}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Chips title="Recent" syms={recent} />
        {/* Suggestions only for somebody with no watchlist yet. With one, this
            row repeated the same companies the priced list below shows - the
            watchlist appeared twice on one screen. */}
        {watch.length === 0 && <Chips title="Start with" syms={SUGGESTED} />}

        {/* This was a grid of seven tiles - Watchlists, Screener, Sectors, IPO,
            Calendar, Portfolio, Data - every one of them already a link in the
            nav bar directly above. A landing page whose main content is a second
            copy of its own navigation gives the reader nothing to read.
            Replaced with the numbers he came to see: the companies he is
            actually following, priced. */}
        {watchRows.length > 0 && (
          <section className="mt-7">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-xs uppercase tracking-wide text-[var(--ink3)]">
                {lists > 1 ? `Watchlists (${lists})` : "Watchlist"}
              </h2>
              <Link href="/watchlists" className="text-xs font-semibold text-[var(--accent-ink)]">Manage</Link>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
              {/* The column is labelled once, here, instead of a sentence under
                  the list saying what the percentages are. */}
              <div className="flex items-center gap-3 px-3.5 pt-2 pb-1 text-[11px] text-[var(--ink3)]">
                <span className="flex-1" />
                <span className="w-16 text-right">1M</span>
              </div>
              {watchRows.map((r) => (
                <Link
                  key={r.symbol}
                  href={`/company?s=${encodeURIComponent(r.symbol)}`}
                  className="flex items-center gap-3 px-3.5 min-h-[46px] border-t border-[var(--line)] hover:bg-[var(--card2)] active:bg-[var(--card2)]"
                >
                  {/* One line, not two. The name and ticker sat stacked, so eight
                      companies cost sixteen lines of a phone screen. They now sit
                      on a single line that scrolls sideways when a name is long,
                      rather than wrapping or being cut off. */}
                  <span className="flex-1 min-w-0 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <span className="text-sm font-semibold text-[var(--ink)]">
                      {shortName(r.name) || r.symbol}
                    </span>
                    <span className="ml-2 text-[11px] text-[var(--ink3)]">{r.symbol}</span>
                  </span>
                  <span className="text-sm tabular-nums text-[var(--ink)] shrink-0">
                    {r.price != null ? `₹${r.price.toLocaleString("en-IN")}` : "—"}
                  </span>
                  <span
                    className="text-xs tabular-nums shrink-0 w-16 text-right"
                    style={{ color: r.ret_1m == null ? "var(--ink3)" : r.ret_1m >= 0 ? "var(--pos)" : "var(--neg)" }}
                    title="Change over the last month"
                  >
                    {r.ret_1m == null ? "—" : `${r.ret_1m >= 0 ? "+" : ""}${r.ret_1m.toFixed(1)}%`}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* The date, and nothing else. The count of companies on that date
            and the invitation to the status page are one tap away on it. */}
        {asof && (
          <p className="text-center text-[11px] text-[var(--ink3)] mt-8">
            <Link href="/status" className="hover:underline">
              Close of {new Date(asof + "T00:00:00").toLocaleDateString("en-IN",
                { day: "numeric", month: "short", year: "numeric" })}
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}
