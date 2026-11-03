"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { compile, Row } from "@/lib/query";
import { loadSaved, SavedScreen } from "@/lib/saved-screens";
import InfoTip from "@/components/InfoTip";

/** Which holdings pass each saved screen, on today's figures (P10, 1-Nov-2026).
 *  Read-only: it shows where holdings stand against the reader's own rules and
 *  says nothing about what to do with them. */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
let dataCache: Promise<Row[]> | null = null;

function readRatios(): Record<string, string> {
  try {
    const list = JSON.parse(localStorage.getItem("rscreener_ratios") ?? "[]") as { name: string; formula: string }[];
    return Object.fromEntries(list.map((r) => [r.name, r.formula]));
  } catch { return {}; }
}

export default function HoldingsScreens({ symbols, nameOf }: { symbols: string[]; nameOf: (s: string) => string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [screens] = useState<SavedScreen[]>(() => (typeof window === "undefined" ? [] : loadSaved()));
  const [open, setOpen] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    dataCache ??= fetch(`${BASE}/data.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => d.rows as Row[]);
    let live = true;
    dataCache.then((r) => { if (live) setRows(r); }).catch(() => {
      // Not kept: the next visit tries again rather than showing "none pass"
      // from a download that never arrived.
      dataCache = null;
      if (live) setFailed(true);
    });
    return () => { live = false; };
  }, []);

  const results = useMemo(() => {
    if (!rows) return [];
    const mine = new Set(symbols);
    const held = rows.filter((r) => mine.has(String(r.symbol)));
    const ratios = readRatios();
    return screens.map((s) => {
      try {
        const run = compile(s.query, ratios).run;
        const pass: string[] = [], fail: string[] = [], unknown: string[] = [];
        for (const r of held) {
          if (s.sectors?.length && !s.sectors.includes(String(r.sector ?? ""))) { fail.push(String(r.symbol)); continue; }
          const ok = run(r);
          (ok === null ? unknown : ok ? pass : fail).push(String(r.symbol));
        }
        return { s, pass, fail, unknown, error: "" };
      } catch (e) {
        return { s, pass: [], fail: [], unknown: [], error: e instanceof Error ? e.message : String(e) };
      }
    });
  }, [rows, screens, symbols]);

  if (!screens.length) {
    return (
      <div className="py-8 text-center">
        <p className="text-[15px] text-[var(--ink2)] mb-1">No saved screens yet</p>
        <p className="text-[13px] text-[var(--ink3)]">Save a screen in the <Link href="/screens" className="underline">Screener</Link>; each one is checked against your holdings here.</p>
      </div>
    );
  }
  if (failed) return <p className="py-6 text-sm text-[var(--ink3)]">Could not load today&apos;s figures. Pull down from the top to try again.</p>;
  if (!rows) return <p className="py-6 text-sm text-[var(--ink3)]">Checking holdings...</p>;

  const list = (title: string, syms: string[]) => syms.length ? (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)] mb-1">{title} ({syms.length})</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
        {syms.map((s) => <Link key={s} href={`/company?s=${encodeURIComponent(s)}`} className="whitespace-nowrap">{nameOf(s)}</Link>)}
      </div>
    </div>
  ) : null;

  return (
    <div className="pt-2">
      <p className="text-[11px] text-[var(--ink3)] flex items-center gap-1 mb-2">
        Your holdings against each saved screen, on today&apos;s figures
        <InfoTip title="Holdings and screens">
          <p>Each saved screen is run on today&apos;s data and your holdings are sorted into those that pass, those that do not, and those missing a figure the screen needs.</p>
          <p>It shows where each holding stands against your own rules; what to do about it is yours to decide.</p>
        </InfoTip>
      </p>
      <ul className="divide-y divide-[var(--line)]">
        {results.map(({ s, pass, fail, unknown, error }) => (
          <li key={s.name}>
            <button onClick={() => setOpen(open === s.name ? null : s.name)} className="w-full flex items-center gap-3 py-2.5 text-left">
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-medium truncate">{s.name}</span>
                <span className="block text-[11px] text-[var(--ink3)] font-mono truncate">{s.query}</span>
              </span>
              {error ? <span className="text-[12px] text-[var(--ink3)]">Cannot run</span> : (
                <span className="shrink-0 text-[12.5px] tabular-nums text-right">
                  <b>{pass.length}</b> pass <span className="text-[var(--ink3)]">· {fail.length} fail{unknown.length ? ` · ${unknown.length} ?` : ""}</span>
                </span>
              )}
            </button>
            {open === s.name && (
              <div className="pb-3 space-y-2">
                {error && <p className="text-[12px] text-[var(--ink3)]">{error}</p>}
                {list("Pass", pass)}
                {list("Do not pass", fail)}
                {list("Missing a figure", unknown)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
