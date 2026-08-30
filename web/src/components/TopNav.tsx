"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ThemeControls from "@/components/ThemeControls";
import { buildIndex, search, didYouMean, type SearchIndex, type SearchRow } from "@/lib/search";
import AccountButton from "@/components/AccountButton";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Lite = SearchRow;
let cache: Lite[] | null = null;
let indexCache: SearchIndex | null = null;

export default function TopNav({ active }: { active?: "home" | "screens" | "sectors" | "calendar" | "portfolio" | "watchlists" | "ipo" | "status" }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Lite[]>([]);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const ensureData = async () => {
    if (cache) { if (!indexCache) indexCache = buildIndex(cache); if (rows.length === 0) setRows(cache); return; }
    try {
      const d = await (await fetch(`${BASE}/data.json`)).json();
      cache = (d.rows as Record<string, unknown>[]).map((r) => ({
        symbol: String(r.symbol),
        name: String(r.name ?? ""),
        mcap: (r.mcap as number) ?? 0,
        exchange: r.exchange as string | undefined,
      }));
      indexCache = buildIndex(cache);
      setRows(cache);
    } catch { /* search silently unavailable */ }
  };

  // One shared matcher, so this box and the home page agree. The old inline
  // scorer compared the whole query against the symbol and the name as single
  // strings, so anything with a space in it could only match when the name
  // began with exactly those words: "bank baroda", "larsen toubro", "mahindra
  // mahindra" and "oil natural gas" all returned nothing at all.
  const ql = q.trim();
  const idx = rows.length && indexCache ? indexCache : null;
  const { hits: matches, total } = idx
    ? search(idx, ql, 12)
    : { hits: [] as SearchRow[], total: 0 };
  const suggestion = idx && ql.length >= 2 && matches.length === 0 ? didYouMean(idx, ql) : null;

  const go = (sym: string) => {
    setQ("");
    (document.activeElement as HTMLElement | null)?.blur();
    router.push(`/company?s=${encodeURIComponent(sym)}`);
  };

  const links: [string, string, string][] = [
    ["home", "Home", "/"],
    ["watchlists", "Watchlists", "/watchlists"],
    ["sectors", "Sectors", "/sectors"],
    ["ipo", "IPO", "/ipo"],
    ["calendar", "Calendar", "/calendar"],
    ["portfolio", "Portfolio", "/portfolio"],
    ["screens", "Other screens", "/screens"],
    ["status", "Data", "/status"],
  ];

  return (
    <header className="bg-[var(--card)] border-b border-[var(--line)] sm:sticky sm:top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 h-auto sm:h-14 py-2.5 sm:py-0 flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-4">
        <Link href="/" className="flex items-baseline gap-0.5 shrink-0">
          <span className="text-lg sm:text-xl font-bold tracking-tight text-[var(--ink)]">Rscreener</span>
          <span className="text-lg sm:text-xl font-bold text-[var(--accent)] hidden sm:inline">▮▮▮</span>
        </Link>

        <div ref={boxRef} className="relative order-last w-full sm:order-none sm:flex-1 sm:max-w-md group">
          <input
            value={q}
            onFocus={ensureData}
            onChange={(e) => { setQ(e.target.value); setHi(0); ensureData(); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHi(Math.min(hi + 1, matches.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi(Math.max(hi - 1, 0)); }
              else if (e.key === "Enter" && matches[hi]) go(matches[hi].symbol);
              else if (e.key === "Escape") (e.target as HTMLElement).blur();
            }}
            placeholder="Search for a company"
            aria-label="Search for a company"
            className="w-full text-sm bg-[var(--card2)] border border-[var(--line)] rounded-full px-4 py-2.5 sm:py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:bg-[var(--card)]"
          />
          {(matches.length > 0 || suggestion || (ql.trim().length >= 2 && idx)) && (
            <div className="absolute z-40 mt-1.5 w-full bg-[var(--card)] border border-[var(--line)] rounded-xl shadow-xl overflow-hidden hidden group-focus-within:block">
              {matches.map((m, i) => (
                <button
                  key={m.symbol}
                  onMouseDown={(e) => { e.preventDefault(); go(m.symbol); }}
                  onMouseEnter={() => setHi(i)}
                  className={`block w-full text-left px-4 py-2 text-sm ${i === hi ? "bg-[var(--accent-soft)]" : ""}`}
                >
                  <span className="font-semibold text-[var(--ink)]">{m.name || m.symbol}</span>
                  <span className="text-[var(--ink3)] ml-2 text-xs">{m.symbol}</span>
                  {/* Half the companies here are BSE-only now. Saying which is
                      the difference between "this page has no filings yet" and
                      "this company files nowhere this app can read". */}
                  {m.exchange === "BSE" && (
                    <span className="ml-1.5 text-[11px] rounded px-1 py-0.5 bg-[var(--card2)] text-[var(--ink3)]">BSE</span>
                  )}
                </button>
              ))}
              {/* A blank panel reads as a broken app. When nothing matches, say
                  so and offer the company he probably meant - "relaince"
                  resolves to Reliance Industries. */}
              {matches.length === 0 && (
                <div className="px-4 py-2.5 text-sm">
                  <p className="text-[var(--ink3)]">No company matches &ldquo;{ql.trim()}&rdquo;</p>
                  {suggestion && (
                    <button
                      onMouseDown={(e) => { e.preventDefault(); go(suggestion.symbol); }}
                      className="mt-1 text-left font-semibold text-[var(--accent-ink)]"
                    >
                      Did you mean {suggestion.name || suggestion.symbol}?
                    </button>
                  )}
                </div>
              )}
              {/* The old box cut silently at eight. The sectors page already
                  discloses its cap; the search box was the one place that did
                  not. */}
              {total > matches.length && (
                <p className="px-4 py-1.5 text-[11px] text-[var(--ink3)] border-t border-[var(--line)]">
                  {matches.length} of {total} companies match &mdash; keep typing to narrow it
                </p>
              )}
            </div>
          )}
        </div>

        <nav className="hidden sm:flex items-center gap-1 text-sm font-medium">
          {links.map(([key, label, href]) => (
            <Link
              key={key}
              href={href}
              className={`px-3 py-1.5 rounded-lg ${active === key ? "text-[var(--accent-ink)] bg-[var(--accent-soft)] font-semibold" : "text-[var(--ink2)] hover:bg-[var(--card2)]"}`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="shrink-0 flex items-center gap-2">
          <AccountButton />
          <ThemeControls />
          <button
            onClick={() => window.location.reload()}
            title="Refresh"
            aria-label="Refresh the app"
            className="text-base leading-none rounded-full border border-[var(--line)] bg-[var(--card2)] w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center text-[var(--ink2)] hover:border-[var(--line2)] active:rotate-180 transition-transform"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Content-sized and wrapping, NOT a fixed column count. `grid-cols-5` gave
          every link a 67px cell, which is narrower than "Other screens" — the
          label then overflowed its cell and printed straight over "Data" sitting
          beside it. Any fixed grid breaks the moment a label or the link count
          changes; letting each item take its own width cannot. */}
      <nav className="sm:hidden flex flex-wrap gap-x-1 gap-y-0.5 px-3 pb-2 text-[13px] font-medium">
        {links.map(([key, label, href]) => (
          <Link
            key={key}
            href={href}
            className={`px-2.5 py-2 rounded-lg whitespace-nowrap ${active === key ? "text-[var(--accent-ink)] bg-[var(--accent-soft)] font-semibold" : "text-[var(--ink2)]"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
