"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import { loadWatchlist } from "@/lib/store";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Lite = { symbol: string; name: string; mcap: number };

/** A spread of well-known names across sectors, shown only until the user has a
 *  watchlist of their own. Screener.in does the same thing under "Or analyse:" —
 *  a home page whose only job is to get you to a company shouldn't open with a
 *  wall of data you didn't ask for. */
const SUGGESTED = [
  "RELIANCE", "HDFCBANK", "TCS", "INFY", "ITC",
  "SBIN", "LT", "MARUTI", "SUNPHARMA", "TITAN", "ASIANPAINT", "COALINDIA",
];

export default function Home() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Lite[]>([]);
  const [hi, setHi] = useState(0);
  const [watch, setWatch] = useState<string[]>([]);
  const [asof, setAsof] = useState<string | null>(null);
  const [covered, setCovered] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setWatch(loadWatchlist());
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

  const nameOf = (sym: string) => rows.find((r) => r.symbol === sym)?.name ?? sym;
  const chips = (watch.length ? watch : SUGGESTED).slice(0, 12);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="home" />

      <main className="max-w-2xl mx-auto px-4 pt-14 sm:pt-24 pb-10">
        <h1 className="text-center text-xl sm:text-2xl font-semibold text-[var(--ink)]">
          Stock analysis and screening tool for investors in India
        </h1>

        <div className="relative mt-7">
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
            placeholder="Search for a company…"
            aria-label="Search for a company"
            autoComplete="off"
            className="w-full rounded-xl border border-[var(--line2)] bg-[var(--card)] px-4 py-3.5 text-base
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
                  className={`w-full text-left px-4 py-2.5 ${i === hi ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--card2)]"}`}
                >
                  <span className="font-semibold text-[var(--ink)]">{m.name || m.symbol}</span>
                  <span className="text-[var(--ink3)] ml-2 text-xs">{m.symbol}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-6">
          <p className="text-sm text-[var(--ink3)]">
            {watch.length ? "Your watchlist:" : "Or analyse:"}
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-2">
            {chips.map((sym) => (
              <Link
                key={sym}
                href={`/company?s=${sym}`}
                className="text-sm text-[var(--accent-ink)] hover:underline"
              >
                {nameOf(sym)}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-2 justify-center">
          {[
            ["Other screens", "/screens"],
            ["Sectors", "/sectors"],
            ["IPO", "/ipo"],
            ["Calendar", "/calendar"],
            ["Portfolio", "/portfolio"],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="text-sm rounded-lg border border-[var(--line)] px-3 py-1.5 text-[var(--ink2)] hover:bg-[var(--card2)]"
            >
              {label}
            </Link>
          ))}
        </div>

        {covered !== null && (
          <p className="text-center text-xs text-[var(--ink3)] mt-8">
            {covered.toLocaleString("en-IN")} NSE companies
            {asof && <> · prices at close of {asof}</>}
            {" · "}
            <Link href="/status" className="hover:underline">data status</Link>
          </p>
        )}
      </main>
    </div>
  );
}
