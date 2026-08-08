"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import { Row } from "@/lib/query";
import { shortName } from "@/lib/names";
import {
  WatchState, addTo, createList, deleteList, loadLists, moveSymbol,
  removeFrom, renameList, reorderList, setActive, setListNote,
} from "@/lib/watchlists";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Data = { generated_at: string; rows: Row[]; price_asof?: string };

function fmt(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

function crore(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (v >= 100000) return `${(v / 100000).toFixed(2)}L Cr`;
  return v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/** Columns the table can show. Kept small deliberately - a watchlist is for
 *  glancing at, and every column added is a column of noise on a phone. */
// data.json already stores roe / roce / div_yield AS PERCENTAGES (TCS roe is
// 47.74, not 0.4774). Multiplying by 100 here printed "4,774%" - and defaulting
// a missing value to 0 first printed RELIANCE's absent ROE as a confident "0".
// A number we do not have is a dash.
const COLS: { key: string; label: string; num: boolean; fmt: (r: Row) => string }[] = [
  { key: "price", label: "Price ₹", num: true, fmt: (r) => fmt(r.price as number) },
  { key: "pe", label: "P/E", num: true, fmt: (r) => fmt(r.pe as number, 1) },
  { key: "roe", label: "ROE %", num: true, fmt: (r) => fmt(r.roe as number, 1) },
  { key: "roce", label: "ROCE %", num: true, fmt: (r) => fmt(r.roce as number, 1) },
  { key: "div_yield", label: "Div Yld %", num: true, fmt: (r) => fmt(r.div_yield as number, 2) },
  { key: "mcap", label: "MCap ₹Cr", num: true, fmt: (r) => crore(r.mcap as number) },
];

export default function WatchlistsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<WatchState>({ lists: [], activeId: "" });
  const [ready, setReady] = useState(false);
  const [adding, setAdding] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [moving, setMoving] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${BASE}/data.json`).then((r) => r.json()).then(setData).catch(() => {});
    setState(loadLists());
    setReady(true);
  }, []);

  const bySymbol = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of data?.rows ?? []) m.set(String(r.symbol), r);
    return m;
  }, [data]);

  const active = state.lists.find((l) => l.id === state.activeId) ?? state.lists[0];

  const rows = useMemo(() => {
    if (!active) return [];
    const out = active.symbols.map((s) => ({ symbol: s, row: bySymbol.get(s) }));
    if (!sortKey) return out;
    return [...out].sort((a, b) => {
      const av = (a.row?.[sortKey] as number) ?? -Infinity;
      const bv = (b.row?.[sortKey] as number) ?? -Infinity;
      return (av - bv) * sortDir;
    });
  }, [active, bySymbol, sortKey, sortDir]);

  // Suggestions for the add box: match on symbol or name, skip anything already
  // on this list, and cap the list so it never covers the table below it.
  const suggestions = useMemo(() => {
    const q = adding.trim().toLowerCase();
    if (q.length < 2 || !active) return [];
    const has = new Set(active.symbols);
    return (data?.rows ?? [])
      .filter((r) => !has.has(String(r.symbol)))
      .map((r) => {
        const sym = String(r.symbol).toLowerCase();
        const nm = String(r.name ?? "").toLowerCase();
        const score = sym.startsWith(q) ? 0 : nm.startsWith(q) ? 1 : nm.includes(` ${q}`) ? 2 : sym.includes(q) || nm.includes(q) ? 3 : 9;
        return [score, r] as const;
      })
      .filter(([s]) => s < 9)
      .sort((a, b) => a[0] - b[0] || ((b[1].mcap as number) ?? 0) - ((a[1].mcap as number) ?? 0))
      .slice(0, 7)
      .map(([, r]) => r);
  }, [adding, data, active]);

  const add = (sym: string) => {
    if (!active) return;
    setState(addTo(active.id, [sym]));
    setAdding("");
    addRef.current?.focus();
  };

  const clickSort = (k: string) => {
    if (sortKey === k) setSortDir(sortDir === 1 ? -1 : 1);
    else { setSortKey(k); setSortDir(-1); }
  };

  // Totals give the list a shape - a watchlist of twelve companies with a median
  // P/E of 68 is a different thing from one with a median of 14, and that is not
  // visible from twelve separate numbers.
  const stats = useMemo(() => {
    const present = rows.map((r) => r.row).filter(Boolean) as Row[];
    const med = (k: string) => {
      const v = present.map((r) => r[k] as number).filter((x) => typeof x === "number" && isFinite(x)).sort((a, b) => a - b);
      if (!v.length) return null;
      const m = Math.floor(v.length / 2);
      // Even count: the middle two averaged. Taking the upper one made a list of
      // two companies report the higher of them as "the median", which is a
      // wrong number rather than an imprecise one.
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    // Keyed off COLS rather than a hand-written list, so adding a column can
    // never leave the footer silently one cell out of step with the header.
    const medians: Record<string, number | null> = {};
    for (const c of COLS) medians[c.key] = med(c.key);
    return { n: present.length, missing: rows.length - present.length, medians };
  }, [rows]);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav active="watchlists" />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
          <h1 className="text-2xl font-bold text-[var(--ink)]">Watchlists</h1>
          {data?.price_asof && (
            <span className="text-xs text-[var(--ink3)]">Prices as of {data.price_asof}</span>
          )}
        </div>
        <p className="text-sm text-[var(--ink2)] mb-5">
          Keep separate lists for separate questions — what you own, what you are researching,
          what you decided against and want to check you were right about.
        </p>

        {/* ── the lists themselves ── */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {state.lists.map((l) => {
            const on = l.id === active?.id;
            return (
              <button
                key={l.id}
                onClick={() => setState(setActive(l.id))}
                className={`group rounded-xl px-3 py-2 text-sm border transition-colors ${
                  on
                    ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)] font-semibold"
                    : "bg-[var(--card)] text-[var(--ink2)] border-[var(--line)] hover:border-[var(--line2)]"
                }`}
              >
                {l.name}
                <span className={`ml-2 text-xs ${on ? "opacity-80" : "text-[var(--ink3)]"}`}>{l.symbols.length}</span>
              </button>
            );
          })}
          <button
            onClick={() => {
              const s = createList(`List ${state.lists.length + 1}`);
              setState(s);
              setRenaming(s.activeId);
              setRenameText(s.lists[s.lists.length - 1].name);
            }}
            className="rounded-xl px-3 py-2 text-sm border border-dashed border-[var(--line2)] text-[var(--ink2)] hover:bg-[var(--card2)]"
          >
            + New list
          </button>
        </div>

        {ready && active && (
          <div className="bg-[var(--card)] border border-[var(--line)] rounded-2xl overflow-hidden">
            {/* ── header for the open list ── */}
            <div className="px-4 py-3 border-b border-[var(--line)] flex flex-wrap items-center gap-2">
              {renaming === active.id ? (
                <input
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={() => { setState(renameList(active.id, renameText)); setRenaming(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { setState(renameList(active.id, renameText)); setRenaming(null); }
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="text-lg font-semibold bg-[var(--card2)] border border-[var(--accent-line)] rounded-lg px-2 py-1 outline-none"
                />
              ) : (
                <button
                  onClick={() => { setRenaming(active.id); setRenameText(active.name); }}
                  title="Click to rename"
                  className="text-lg font-semibold text-[var(--ink)] hover:text-[var(--accent-ink)]"
                >
                  {active.name}
                </button>
              )}
              <span className="text-sm text-[var(--ink3)]">
                {active.symbols.length} {active.symbols.length === 1 ? "company" : "companies"}
                {stats.missing > 0 && ` · ${stats.missing} not in the dataset`}
              </span>
              <div className="ml-auto flex items-center gap-1 text-xs">
                <button onClick={() => setState(reorderList(active.id, -1))} title="Move this list left"
                  className="rounded-lg px-2 py-1.5 text-[var(--ink2)] hover:bg-[var(--card2)]">←</button>
                <button onClick={() => setState(reorderList(active.id, 1))} title="Move this list right"
                  className="rounded-lg px-2 py-1.5 text-[var(--ink2)] hover:bg-[var(--card2)]">→</button>
                <button
                  onClick={() => { setNoteFor(noteFor === active.id ? null : active.id); setNoteText(active.note ?? ""); }}
                  className="rounded-lg px-2 py-1.5 text-[var(--ink2)] hover:bg-[var(--card2)]"
                >
                  {active.note ? "Edit note" : "Add note"}
                </button>
                {confirmDelete === active.id ? (
                  <>
                    <span className="text-[var(--neg)]">Delete this list?</span>
                    <button onClick={() => { setState(deleteList(active.id)); setConfirmDelete(null); }}
                      className="rounded-lg px-2 py-1.5 font-semibold text-[var(--neg)] hover:bg-[var(--neg-soft)]">Yes, delete</button>
                    <button onClick={() => setConfirmDelete(null)}
                      className="rounded-lg px-2 py-1.5 text-[var(--ink2)] hover:bg-[var(--card2)]">Keep</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDelete(active.id)}
                    className="rounded-lg px-2 py-1.5 text-[var(--ink2)] hover:bg-[var(--card2)]">Delete</button>
                )}
              </div>
            </div>

            {noteFor === active.id && (
              <div className="px-4 py-3 border-b border-[var(--line)] bg-[var(--card2)]">
                <textarea
                  autoFocus
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onBlur={() => { setState(setListNote(active.id, noteText)); setNoteFor(null); }}
                  placeholder="Why does this list exist? What are you watching for?"
                  rows={2}
                  className="w-full text-sm bg-[var(--card)] border border-[var(--line)] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
            )}
            {active.note && noteFor !== active.id && (
              <div className="px-4 py-2 border-b border-[var(--line)] text-sm text-[var(--ink2)] italic">{active.note}</div>
            )}

            {/* ── add a company ── */}
            <div className="px-4 py-3 border-b border-[var(--line)] relative">
              <input
                ref={addRef}
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && suggestions[0]) add(String(suggestions[0].symbol));
                  if (e.key === "Escape") setAdding("");
                }}
                placeholder="Add a company to this list…"
                className="w-full sm:max-w-md text-sm bg-[var(--card2)] border border-[var(--line)] rounded-full px-4 py-2 outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
              {suggestions.length > 0 && (
                <div className="absolute z-30 mt-1 w-full sm:max-w-md bg-[var(--card)] border border-[var(--line)] rounded-xl shadow-xl overflow-hidden">
                  {suggestions.map((r) => (
                    <button
                      key={String(r.symbol)}
                      onMouseDown={(e) => { e.preventDefault(); add(String(r.symbol)); }}
                      className="block w-full text-left px-4 py-2 text-sm hover:bg-[var(--accent-soft)]"
                    >
                      <span className="font-semibold text-[var(--ink)]">{shortName(String(r.name ?? ""), String(r.symbol))}</span>
                      <span className="text-[var(--ink3)] ml-2 text-xs">{String(r.symbol)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── the companies ── */}
            {active.symbols.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-[var(--ink2)] mb-1">Nothing on this list yet.</p>
                <p className="text-sm text-[var(--ink3)]">
                  Add one above, or star a company from the{" "}
                  <Link href="/screens" className="text-[var(--accent-ink)] underline">screener</Link>.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--card2)] text-[var(--ink2)]">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2">Company</th>
                      {COLS.map((c) => (
                        <th key={c.key} onClick={() => clickSort(c.key)}
                          className="text-right font-semibold px-3 py-2 cursor-pointer whitespace-nowrap hover:text-[var(--accent-ink)]">
                          {c.label}{sortKey === c.key ? (sortDir === 1 ? " ↑" : " ↓") : ""}
                        </th>
                      ))}
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ symbol, row }) => (
                      <tr key={symbol} className="border-t border-[var(--line)] hover:bg-[var(--card2)]">
                        <td className="px-3 py-2">
                          <Link href={`/company?s=${symbol}`} className="font-medium text-[var(--ink)] hover:text-[var(--accent-ink)]">
                            {row ? shortName(String(row.name ?? ""), symbol) : symbol}
                          </Link>
                          <span className="text-[var(--ink3)] text-xs ml-2">{symbol}</span>
                          {!row && <span className="text-[var(--ink3)] text-xs ml-2">· not in the dataset</span>}
                        </td>
                        {COLS.map((c) => (
                          <td key={c.key} className="text-right px-3 py-2 tabular-nums text-[var(--ink2)] whitespace-nowrap">
                            {row ? c.fmt(row) : "—"}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {state.lists.length > 1 && (
                            <select
                              value=""
                              onChange={(e) => { if (e.target.value) { setState(moveSymbol(active.id, e.target.value, symbol)); setMoving(null); } }}
                              title="Move to another list"
                              className="text-xs bg-transparent border border-[var(--line)] rounded-md px-1 py-0.5 mr-1 text-[var(--ink2)]"
                            >
                              <option value="">Move to…</option>
                              {state.lists.filter((l) => l.id !== active.id).map((l) => (
                                <option key={l.id} value={l.id}>{l.name}</option>
                              ))}
                            </select>
                          )}
                          <button
                            onClick={() => setState(removeFrom(active.id, symbol))}
                            title={`Remove ${symbol} from ${active.name}`}
                            aria-label={`Remove ${symbol} from ${active.name}`}
                            className="text-[var(--ink3)] hover:text-[var(--neg)] px-1"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {stats.n > 1 && (
                    <tfoot className="bg-[var(--card2)] text-[var(--ink2)]">
                      <tr className="border-t border-[var(--line)]">
                        <td className="px-3 py-2 font-semibold whitespace-nowrap">
                          Median of {stats.n}
                        </td>
                        {COLS.map((c) => (
                          <td key={c.key} className="text-right px-3 py-2 tabular-nums font-semibold whitespace-nowrap">
                            {/* median of a price or a market cap says nothing about a
                                list of mixed companies; the ratios are the point */}
                            {["pe", "roe", "roce", "div_yield"].includes(c.key) && stats.medians[c.key] !== null
                              ? c.fmt({ [c.key]: stats.medians[c.key] } as unknown as Row)
                              : ""}
                          </td>
                        ))}
                        <td className="px-3 py-2" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        )}

        {ready && state.lists.length === 0 && (
          <p className="text-[var(--ink2)]">No lists yet — create one above.</p>
        )}
        {moving && null}
      </main>
    </div>
  );
}
