"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import { loadRecent, loadWatchlist } from "@/lib/store";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Lite = { symbol: string; name: string; mcap: number };

/** A spread across sectors, shown only until there is something of the user's own. */
const SUGGESTED = [
  "RELIANCE", "HDFCBANK", "TCS", "INFY", "ITC", "SBIN",
  "LT", "MARUTI", "SUNPHARMA", "TITAN", "ASIANPAINT", "COALINDIA",
];

/** "Sun Pharmaceutical Industries Limited" is a legal name, not a company name.
 *  Twelve of them wrap into a grey wall that is hard to scan; the short form is
 *  what a person would actually say out loud. */
function shortName(name: string, symbol: string): string {
  const s = name
    .replace(/\s*\(Formerly[^)]*\)\s*/gi, " ")
    // "India" is NOT a suffix to strip: State Bank of India, Coal India and Bank
    // of India all carry it in the actual name, and dropping it produced the
    // headline "State Bank of".
    .replace(/\b(Limited|Ltd\.?|Corporation|Corp\.?|Company|Industries|Enterprises)\b/gi, " ")
    .replace(/[.,]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // A name left dangling on a joining word means the trim cut into it
  const dangling = /\b(of|and|the|&|for|de)$/i.test(s);
  return s.length >= 3 && !dangling ? s : (name || symbol);
}

export default function Home() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Lite[]>([]);
  const [hi, setHi] = useState(0);
  const [watch, setWatch] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [asof, setAsof] = useState<string | null>(null);
  const [covered, setCovered] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setWatch(loadWatchlist());
    setRecent(loadRecent());
    fetch(`${BASE}/data.json`)
      .then((r) => r.json())
      .then((d) => {
        setRows((d.rows as Record<string, unknown>[]).map((r) => ({
          symbol: String(r.symbol),
          name: String(r.name ?? ""),
          mcap: (r.mcap as number) ?? 0,
        })));
        setAsof(d.price_asof ?? null);
        setCovered(d.covered ?? null);
      })
      .catch(() => { /* search degrades to nothing rather than an error wall */ });
  }, []);

  const ql = q.trim().toLowerCase();
  const matches = ql.length < 1 ? [] : rows
    .map((r) => {
      const sym = r.symbol.toLowerCase(), name = r.name.toLowerCase();
      const score = sym.startsWith(ql) ? 0 : name.startsWith(ql) ? 1
        : name.includes(` ${ql}`) ? 2 : sym.includes(ql) || name.includes(ql) ? 3 : 9;
      return [score, r] as const;
    })
    .filter(([sc]) => sc < 9)
    .sort((a, b) => a[0] - b[0] || b[1].mcap - a[1].mcap)
    .slice(0, 8)
    .map(([, r]) => r);

  const go = (sym: string) => router.push(`/company?s=${sym}`);
  const nameOf = (sym: string) => {
    const hit = rows.find((r) => r.symbol === sym);
    return hit ? shortName(hit.name, sym) : sym;
  };

  const Chips = ({ title, syms }: { title: string; syms: string[] }) =>
    syms.length === 0 ? null : (
      <div className="mt-6">
        <p className="text-xs uppercase tracking-wide text-[var(--ink3)]">{title}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          {syms.slice(0, 12).map((sym) => (
            <Link
              key={sym}
              href={`/company?s=${sym}`}
              className="text-sm rounded-lg border border-[var(--line)] bg-[var(--card)] px-2.5 py-1.5
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

      <main className="max-w-2xl mx-auto px-4 pt-10 sm:pt-20 pb-12">
        <h1 className="text-center text-2xl sm:text-3xl font-bold tracking-tight">
          Every NSE company, in one place
        </h1>
        <p className="text-center text-sm text-[var(--ink3)] mt-2">
          Twenty years of financials, valuation charts you can check line by line, and
          a screener over {covered ? covered.toLocaleString("en-IN") : "2,000+"} companies.
        </p>

        <div className="relative mt-7">
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
            placeholder="Search any company — name or symbol"
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

        <Chips title="Recently viewed" syms={recent} />
        <Chips title={watch.length ? "Your watchlist" : "Or start with"} syms={watch.length ? watch : SUGGESTED} />

        <div className="mt-10 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            ["Other screens", "/screens", "Query 40+ ratios"],
            ["Sectors", "/sectors", "Browse by industry"],
            ["IPO", "/ipo", "Open and upcoming"],
            ["Calendar", "/calendar", "Results and events"],
            ["Portfolio", "/portfolio", "Your holdings"],
            ["Data", "/status", "How fresh it is"],
          ].map(([label, href, sub]) => (
            <Link
              key={href}
              href={href}
              className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2.5
                         hover:border-[var(--line2)]"
            >
              <span className="block text-sm font-semibold text-[var(--ink)]">{label}</span>
              <span className="block text-xs text-[var(--ink3)] mt-0.5">{sub}</span>
            </Link>
          ))}
        </div>

        {asof && (
          <p className="text-center text-xs text-[var(--ink3)] mt-8">
            Prices at close of {new Date(asof + "T00:00:00").toLocaleDateString("en-IN",
              { day: "numeric", month: "short", year: "numeric" })}
            {" · "}
            <Link href="/status" className="hover:underline">what else is up to date</Link>
          </p>
        )}
      </main>
    </div>
  );
}
