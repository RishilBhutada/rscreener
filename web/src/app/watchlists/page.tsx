"use client";

import { PointerEvent as RPointerEvent, TouchEvent as RTouchEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip, { InfoDialog } from "@/components/InfoTip";
import { LiteRow, loadIndex, symbolHref } from "@/lib/index-data";
import { shortName } from "@/lib/names";
import { buildIndex, search } from "@/lib/search";
import { loadPortfolio } from "@/lib/portfolio";
import {
  WatchState, createList, deleteList, loadLists, moveSymbol, removeFrom,
  renameList, reorderList, reorderSymbols, setActive, setListNote, toggleIn,
} from "@/lib/watchlists";
import {
  Chips, Icon, IconButton, SheetAction, Stat, dayMove, money, shortDay, shownSymbol, signed, tone,
} from "@/components/QuoteUI";

/** Watchlists, laid out like a broker's market watch: the lists as tabs, a
 *  search that adds as you go, one line per instrument with the price and the
 *  day's move, and everything else in a sheet a tap away. Read-only - there
 *  is no buy or sell here, by design. */

type SortKey = "manual" | "az" | "chg" | "price" | "mcap";
type Sort = { k: SortKey; d: 1 | -1 };
const SORT_KEY = "rs_wl_sort";
const SORTS: [SortKey, string][] = [
  ["manual", "My order"], ["az", "A–Z"], ["chg", "Change %"], ["price", "Price"], ["mcap", "Market cap"],
];

type Sheet =
  | { kind: "symbol"; sym: string }
  | { kind: "list" }
  | { kind: "new" }
  | { kind: "sort" }
  | null;

function readSort(): Sort {
  try {
    const s = JSON.parse(localStorage.getItem(SORT_KEY) ?? "null") as Sort | null;
    if (s && SORTS.some(([k]) => k === s.k) && (s.d === 1 || s.d === -1)) return s;
  } catch { /* private mode */ }
  return { k: "manual", d: -1 };
}

function kindOf(r: LiteRow | undefined): string {
  if (!r) return "";
  if (r.index) return "INDEX";
  if (r.commodity) return "FUT";
  if (r.etf) return "ETF";
  return "";
}

function chartHref(sym: string, r: LiteRow | undefined): string {
  return `/chart?s=${encodeURIComponent(r?.commodity ? `${sym}1!` : sym)}`;
}

function rememberReturn() {
  // The full chart's back arrow comes back here, not to the company page.
  try { sessionStorage.setItem("rs_chart_from", location.pathname + location.search); } catch { /* private mode */ }
}

export default function WatchlistsPage() {
  const [rows, setRows] = useState<LiteRow[]>([]);
  const [asof, setAsof] = useState<string | null>(null);
  const [state, setState] = useState<WatchState>({ lists: [], activeId: "" });
  const [held, setHeld] = useState<Map<string, number>>(new Map());
  const [ready, setReady] = useState(false);
  const [sort, setSortState] = useState<Sort>({ k: "manual", d: -1 });
  const [query, setQuery] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [editing, setEditing] = useState(false);
  const [nameText, setNameText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const [drag, setDrag] = useState<{ sym: string; dy: number } | null>(null);
  const dragRef = useRef<{ sym: string; startY: number; rowH: number; order: string[] } | null>(null);
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadIndex()
      .then((d) => { setRows(d.rows); setAsof(d.price_modal ?? d.price_asof); })
      .catch(() => {});
    setState(loadLists());
    setHeld(new Map(loadPortfolio().map((h) => [h.symbol, h.qty])));
    setSortState(readSort());
    setReady(true);
  }, []);

  const bySymbol = useMemo(() => new Map(rows.map((r) => [r.symbol, r])), [rows]);
  const active = state.lists.find((l) => l.id === state.activeId) ?? state.lists[0];

  const setSort = (s: Sort) => {
    setSortState(s);
    try { localStorage.setItem(SORT_KEY, JSON.stringify(s)); } catch { /* private mode */ }
  };

  const shown = useMemo(() => {
    if (!active) return [];
    if (editing || sort.k === "manual") return dragOrder ?? active.symbols;
    const val = (s: string): number | string | null => {
      const r = bySymbol.get(s);
      if (sort.k === "az") return shownSymbol(s);
      if (!r) return null;
      return sort.k === "chg" ? r.ret_1d ?? null : sort.k === "price" ? r.price ?? null : r.mcap || null;
    };
    return [...active.symbols].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av === null) return bv === null ? 0 : 1;      // unknowns last, whichever way
      if (bv === null) return -1;
      if (typeof av === "string") return av.localeCompare(String(bv)) * (sort.d === 1 ? 1 : -1);
      return ((av as number) - (bv as number)) * sort.d;
    });
  }, [active, bySymbol, sort, editing, dragOrder]);

  // Search: the matcher the top bar uses - companies, indices, ETFs, MCX and
  // NCDEX alike; "ncdex", "mcx" or "index" lists everything on that market.
  const searchIndex = useMemo(() => buildIndex(rows), [rows]);
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    if (q.length < 2) return rows.filter((r) => r.symbol.toLowerCase().startsWith(q.toLowerCase())).slice(0, 40);
    return search(searchIndex, q, 60).hits as LiteRow[];
  }, [query, rows, searchIndex]);

  const stats = useMemo(() => {
    const present = (active?.symbols ?? []).map((s) => bySymbol.get(s)).filter((r): r is LiteRow => !!r && !r.commodity);
    const med = (k: "pe" | "roe" | "roce") => {
      const v = present.map((r) => r[k]).filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
      if (v.length < 2) return null;
      const m = Math.floor(v.length / 2);
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    const up = present.filter((r) => (r.ret_1d ?? 0) > 0).length;
    const down = present.filter((r) => (r.ret_1d ?? 0) < 0).length;
    return { n: present.length, pe: med("pe"), roe: med("roe"), roce: med("roce"), up, down };
  }, [active, bySymbol]);

  // ── drag to reorder (edit mode) ──
  const dragStart = (e: RPointerEvent<HTMLElement>, sym: string) => {
    if (!active) return;
    e.preventDefault();
    const li = e.currentTarget.closest("li");
    dragRef.current = { sym, startY: e.clientY, rowH: li?.getBoundingClientRect().height || 60, order: [...(dragOrder ?? active.symbols)] };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a synthetic or already-ended pointer */ }
    setDrag({ sym, dy: 0 });
  };
  const dragMove = (e: RPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    let dy = e.clientY - d.startY;
    const i = d.order.indexOf(d.sym);
    if (dy > d.rowH / 2 && i < d.order.length - 1) {
      [d.order[i], d.order[i + 1]] = [d.order[i + 1], d.order[i]];
      d.startY += d.rowH; dy -= d.rowH;
      setDragOrder([...d.order]);
    } else if (dy < -d.rowH / 2 && i > 0) {
      [d.order[i], d.order[i - 1]] = [d.order[i - 1], d.order[i]];
      d.startY -= d.rowH; dy += d.rowH;
      setDragOrder([...d.order]);
    }
    setDrag({ sym: d.sym, dy });
  };
  const dragEnd = () => {
    const d = dragRef.current;
    if (!d) return;
    if (d && active) setState(reorderSymbols(active.id, d.order));
    dragRef.current = null;
    setDrag(null);
    setDragOrder(null);
  };

  // ── swipe sideways between lists, as a broker app does ──
  const swipeStart = (e: RTouchEvent) => {
    if (editing || query) return;
    swipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const swipeEnd = (e: RTouchEvent) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s || !active) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
    const i = state.lists.findIndex((l) => l.id === active.id);
    const j = i + (dx < 0 ? 1 : -1);
    if (j >= 0 && j < state.lists.length) setState(setActive(state.lists[j].id));
  };

  const openList = () => {
    if (!active) return;
    setNameText(active.name);
    setNoteText(active.note ?? "");
    setConfirmDelete(false);
    setSheet({ kind: "list" });
  };

  const sheetSym = sheet?.kind === "symbol" ? sheet.sym : null;
  const sheetRow = sheetSym ? bySymbol.get(sheetSym) : undefined;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <TopNav active="watchlists" />
      <main className="max-w-2xl mx-auto px-4 pt-4 pb-24">
        <div className="flex items-center gap-2 mb-3">
          <h1 className="text-[22px] font-bold tracking-tight text-[var(--ink)]">Watchlists</h1>
          <InfoTip title="Watchlists">
            <p>Keep separate lists for separate questions — what you own, what you are researching, what you decided against and want to check you were right about.</p>
            <p>Prices are each day&apos;s closing prices from the nightly refresh, not live. The change is close against the previous close.</p>
            <p>Tap a row for its figures, chart and list options. Swipe sideways to move between lists. A briefcase marks something you hold in Portfolio.</p>
          </InfoTip>
          {asof && <span className="ml-auto text-[11px] text-[var(--ink3)] tabular-nums">Close {shortDay(asof)}</span>}
        </div>

        {/* ── the lists as tabs ── */}
        <div className="flex items-center border-b border-[var(--line)] mb-3">
          <div className="flex-1 flex overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Watchlists">
            {state.lists.map((l) => {
              const on = l.id === active?.id;
              return (
                <button key={l.id} role="tab" aria-selected={on}
                  onClick={() => (on ? openList() : (setState(setActive(l.id)), setEditing(false)))}
                  className={`shrink-0 px-3 pt-1 pb-2 -mb-px border-b-2 text-[14px] whitespace-nowrap ${
                    on ? "border-[var(--accent)] text-[var(--accent-ink)] font-semibold" : "border-transparent text-[var(--ink2)]"}`}>
                  {l.name}
                  <span className="ml-1.5 text-[11px] opacity-70 tabular-nums">{l.symbols.length}</span>
                </button>
              );
            })}
          </div>
          <IconButton name="plus" label="New watchlist" onClick={() => { setNameText(""); setSheet({ kind: "new" }); }} />
          <IconButton name="more" label="This list's options" onClick={openList} />
        </div>

        {/* ── search and add ── */}
        {active && !editing && (
          <div className="flex items-center gap-1 mb-2">
            <label className="flex-1 flex items-center gap-2 h-11 px-3 rounded-xl border border-[var(--line)] bg-[var(--card)] focus-within:border-[var(--accent-line)]">
              <Icon name="search" className="text-[var(--ink3)] shrink-0" />
              <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
                placeholder="Search & add" aria-label={`Search and add to ${active.name}`}
                className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-[var(--ink)] placeholder:text-[var(--ink3)]" />
              {query ? (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="p-1 -m-1 text-[var(--ink3)]">
                  <Icon name="close" size={16} />
                </button>
              ) : (
                <span className="text-[11px] text-[var(--ink3)] tabular-nums">{active.symbols.length}</span>
              )}
            </label>
            <IconButton name="sliders" label="Sort and edit" onClick={() => setSheet({ kind: "sort" })} active={sort.k !== "manual"} />
          </div>
        )}

        {editing && active && (
          <div className="flex items-center justify-between h-11 mb-2">
            <p className="text-[13px] text-[var(--ink2)]">Drag <Icon name="handle" size={14} className="inline -mt-0.5" /> to reorder</p>
            <button type="button" onClick={() => setEditing(false)}
              className="rs-press min-h-[36px] px-4 rounded-full text-[13px] font-semibold bg-[var(--accent-fill)] text-[var(--accent-fill-ink)]">
              Done
            </button>
          </div>
        )}

        {active?.note && !query && !editing && (
          <p className="text-[12px] text-[var(--ink3)] italic mb-2 px-1">{active.note}</p>
        )}

        {/* ── search results ── */}
        {active && query && !editing && (
          <ul className="divide-y divide-[var(--line)]">
            {results.length === 0 && <li className="py-10 text-center text-[13px] text-[var(--ink3)]">Nothing matches &ldquo;{query}&rdquo;</li>}
            {results.map((r) => {
              const on = active.symbols.includes(r.symbol);
              return (
                <li key={r.symbol}>
                  <button type="button" onClick={() => setState(toggleIn(active.id, r.symbol))}
                    className="w-full flex items-center gap-3 min-h-[56px] py-2 text-left active:bg-[var(--card2)]">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-[var(--ink)] truncate">
                        {r.index ? r.name : shownSymbol(r.symbol)}
                        <span className="ml-2 text-[10px] font-semibold text-[var(--ink3)]">{r.exchange}{kindOf(r) && ` ${kindOf(r)}`}</span>
                      </p>
                      <p className="text-[12px] text-[var(--ink3)] truncate">{r.index ? "Market index" : shortName(r.name, r.symbol)}</p>
                    </div>
                    <span aria-label={on ? `On ${active.name} - tap to remove` : `Add to ${active.name}`}
                      className={`shrink-0 w-8 h-8 rounded-full inline-flex items-center justify-center border ${
                        on ? "bg-[var(--accent-fill)] border-[var(--accent-fill)] text-[var(--accent-fill-ink)]"
                           : "border-[var(--line2)] text-[var(--accent-ink)]"}`}>
                      <Icon name={on ? "check" : "plus"} size={16} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* ── the list ── */}
        {ready && active && (!query || editing) && (
          <div onTouchStart={swipeStart} onTouchEnd={swipeEnd}>
            {active.symbols.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-[15px] text-[var(--ink2)] mb-1">{active.name} is empty</p>
                <button type="button" onClick={() => searchRef.current?.focus()} className="text-[13px] text-[var(--accent-ink)] font-semibold">
                  Search to add
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {shown.map((sym) => {
                  const r = bySymbol.get(sym);
                  const chg = r?.ret_1d ?? null;
                  const move = dayMove(r?.price, chg);
                  const qty = held.get(sym);
                  const dragging = drag?.sym === sym;
                  return (
                    <li key={sym}
                      style={dragging ? { transform: `translateY(${drag.dy}px)`, position: "relative", zIndex: 10 } : undefined}
                      className={dragging ? "bg-[var(--card)] shadow-[0_8px_24px_rgba(0,0,0,0.25)] rounded-lg" : ""}>
                      <div className="flex items-center min-h-[62px]">
                        {editing && (
                          <span onPointerDown={(e) => dragStart(e, sym)} onPointerMove={dragMove}
                            onPointerUp={dragEnd} onPointerCancel={dragEnd} onLostPointerCapture={dragEnd}
                            aria-label={`Drag ${sym} to reorder`} role="button"
                            className="shrink-0 w-10 h-12 -ml-2 inline-flex items-center justify-center text-[var(--ink3)] cursor-grab touch-none">
                            <Icon name="handle" />
                          </span>
                        )}
                        <button type="button" disabled={editing} onClick={() => setSheet({ kind: "symbol", sym })}
                          className="flex-1 min-w-0 flex items-center gap-3 py-2.5 text-left active:bg-[var(--card2)] disabled:active:bg-transparent">
                          <div className="flex-1 min-w-0">
                            <p className="flex items-center gap-1.5 text-[15px] font-medium text-[var(--ink)]">
                              <span className="truncate">{r?.index ? r.name : shownSymbol(sym)}</span>
                              {qty !== undefined && (
                                <span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--accent-ink)]" title={`You hold ${qty}`}>
                                  <Icon name="bag" size={11} />{qty.toLocaleString("en-IN")}
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-[var(--ink3)] truncate">
                              {r ? <>{r.exchange}{kindOf(r) && ` ${kindOf(r)}`} · {shortName(r.name, sym)}</> : "Not in today's data"}
                            </p>
                          </div>
                          {!editing && (
                            <div className="shrink-0 text-right">
                              <p className={`text-[15px] font-medium tabular-nums ${tone(chg)}`}>{money(r?.price)}</p>
                              <p className="text-[11px] tabular-nums text-[var(--ink3)]">
                                {chg === null ? "—" : <>{signed(move)} <span className={tone(chg)}>({signed(chg)}%)</span></>}
                              </p>
                            </div>
                          )}
                        </button>
                        {editing && (
                          <button type="button" onClick={() => setState(removeFrom(active.id, sym))}
                            aria-label={`Remove ${sym} from ${active.name}`}
                            className="shrink-0 w-10 h-10 inline-flex items-center justify-center text-[var(--ink3)] active:text-[var(--neg)]">
                            <Icon name="trash" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {stats.n > 1 && !editing && (
              <div className="mt-3 pt-3 border-t border-[var(--line)] grid grid-cols-4 gap-2 text-center">
                <Stat label="Up / down" value={<><span className="text-[var(--pos)]">{stats.up}</span> / <span className="text-[var(--neg)]">{stats.down}</span></>} />
                <Stat label="Median P/E" value={stats.pe === null ? "—" : stats.pe.toFixed(1)} />
                <Stat label="Median ROE" value={stats.roe === null ? "—" : `${stats.roe.toFixed(1)}%`} />
                <Stat label="Median ROCE" value={stats.roce === null ? "—" : `${stats.roce.toFixed(1)}%`} />
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── one instrument ── */}
      {sheetSym && active && (
        <InfoDialog title={sheetRow ? shortName(sheetRow.name, sheetSym) : shownSymbol(sheetSym)} onClose={() => setSheet(null)}>
          <div className="flex items-baseline flex-wrap gap-x-2">
            <span className="text-[24px] font-semibold tabular-nums text-[var(--ink)]">{money(sheetRow?.price)}</span>
            <span className={`text-[13px] tabular-nums ${tone(sheetRow?.ret_1d)}`}>
              {signed(dayMove(sheetRow?.price, sheetRow?.ret_1d))} ({signed(sheetRow?.ret_1d)}%)
            </span>
          </div>
          <p className="text-[11px] text-[var(--ink3)]">
            {shownSymbol(sheetSym)}{sheetRow?.exchange && ` · ${sheetRow.exchange}`}{asof && ` · Close ${shortDay(asof)}`}
          </p>
          {sheetRow && sheetRow.index && (
            <div className="grid grid-cols-3 gap-3 py-2">
              <Stat label="1M" value={sheetRow.ret_1m === undefined ? "—" : `${signed(sheetRow.ret_1m, 1)}%`} className={tone(sheetRow.ret_1m)} />
              <Stat label="P/E" value={sheetRow.pe === undefined ? "—" : sheetRow.pe.toFixed(1)} />
              <Stat label="Div yield" value={sheetRow.div_yield === undefined ? "—" : `${sheetRow.div_yield.toFixed(2)}%`} />
            </div>
          )}
          {sheetRow && !sheetRow.commodity && !sheetRow.index && (
            <div className="grid grid-cols-3 gap-3 py-2">
              <Stat label="1M" value={sheetRow.ret_1m === undefined ? "—" : `${signed(sheetRow.ret_1m, 1)}%`} className={tone(sheetRow.ret_1m)} />
              <Stat label="P/E" value={sheetRow.pe === undefined ? "—" : sheetRow.pe.toFixed(1)} />
              <Stat label="Market cap" value={sheetRow.mcap ? `₹${money(sheetRow.mcap, 0)} Cr` : "—"} />
              <Stat label="ROE" value={sheetRow.roe === undefined ? "—" : `${sheetRow.roe.toFixed(1)}%`} />
              <Stat label="ROCE" value={sheetRow.roce === undefined ? "—" : `${sheetRow.roce.toFixed(1)}%`} />
              <Stat label="Div yield" value={sheetRow.div_yield === undefined ? "—" : `${sheetRow.div_yield.toFixed(2)}%`} />
            </div>
          )}
          {held.has(sheetSym) && (
            <p className="text-[12px] text-[var(--accent-ink)] inline-flex items-center gap-1">
              <Icon name="bag" size={13} /> You hold {held.get(sheetSym)?.toLocaleString("en-IN")} in Portfolio
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Link href={symbolHref(sheetSym)}
              className="rs-press inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
              <Icon name="page" size={16} /> Overview
            </Link>
            <Link href={chartHref(sheetSym, sheetRow)} onClick={rememberReturn}
              className="rs-press inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl border border-[var(--line2)] text-[var(--ink)] text-[14px] font-semibold">
              <Icon name="chart" size={16} /> Chart
            </Link>
          </div>
          {state.lists.length > 1 && (
            <div className="pt-2">
              <p className="text-[11px] uppercase tracking-wide text-[var(--ink3)] mb-1.5">Move to</p>
              <div className="flex flex-wrap gap-2">
                {state.lists.filter((l) => l.id !== active.id).map((l) => (
                  <button key={l.id} type="button"
                    onClick={() => { setState(moveSymbol(active.id, l.id, sheetSym)); setSheet(null); }}
                    className="rs-press min-h-[34px] px-3 rounded-full border border-[var(--line)] text-[13px] text-[var(--ink)]">
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="pt-1">
            <SheetAction icon="trash" danger onClick={() => { setState(removeFrom(active.id, sheetSym)); setSheet(null); }}>
              Remove from {active.name}
            </SheetAction>
          </div>
        </InfoDialog>
      )}

      {/* ── sort and edit ── */}
      {sheet?.kind === "sort" && (
        <InfoDialog title="Sort" onClose={() => setSheet(null)}>
          <Chips value={sort.k} options={SORTS}
            onChange={(k) => setSort({ k, d: k === sort.k ? (sort.d === 1 ? -1 : 1) : k === "az" ? 1 : -1 })} />
          {sort.k !== "manual" && (
            <button type="button" onClick={() => setSort({ ...sort, d: sort.d === 1 ? -1 : 1 })}
              className="text-[13px] text-[var(--accent-ink)] font-semibold">
              {sort.k === "az" ? (sort.d === 1 ? "A to Z" : "Z to A") : sort.d === -1 ? "Highest first" : "Lowest first"} · Reverse
            </button>
          )}
          <div className="pt-2 border-t border-[var(--line)]">
            <SheetAction icon="edit" onClick={() => { setSort({ k: "manual", d: -1 }); setQuery(""); setEditing(true); setSheet(null); }}>
              Edit {active?.name ?? "list"}
            </SheetAction>
          </div>
        </InfoDialog>
      )}

      {/* ── this list ── */}
      {sheet?.kind === "list" && active && (
        <InfoDialog title={active.name} onClose={() => setSheet(null)}>
          <label className="block">
            <span className="text-[11px] text-[var(--ink3)]">Name</span>
            <input value={nameText} onChange={(e) => setNameText(e.target.value)}
              onBlur={() => setState(renameList(active.id, nameText))}
              onKeyDown={(e) => { if (e.key === "Enter") { setState(renameList(active.id, nameText)); setSheet(null); } }}
              className="mt-1 w-full h-10 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
          </label>
          <label className="block">
            <span className="text-[11px] text-[var(--ink3)]">Note</span>
            <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2}
              onBlur={() => setState(setListNote(active.id, noteText))}
              placeholder="What is this list for?"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[13px] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
          </label>
          <div className="grid grid-cols-2 gap-1">
            <SheetAction icon="handle" onClick={() => setState(reorderList(active.id, -1))}>Move tab left</SheetAction>
            <SheetAction icon="handle" onClick={() => setState(reorderList(active.id, 1))}>Move tab right</SheetAction>
          </div>
          <SheetAction icon="edit" onClick={() => { setSort({ k: "manual", d: -1 }); setQuery(""); setEditing(true); setSheet(null); }}>
            Edit and reorder
          </SheetAction>
          <div className="flex items-center">
            <div className="flex-1">
              <SheetAction icon="page" onClick={() => {
                // Company filings only: the hourly checker reads NSE announcements.
                const syms = active.symbols.filter((x) => !x.startsWith("^") && !x.endsWith("_NCDEX") && !bySymbol.get(x)?.commodity && !bySymbol.get(x)?.etf);
                navigator.clipboard?.writeText(syms.join(String.fromCharCode(10))).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => {});
              }}>
                {copied ? "Copied" : "Copy for phone alerts"}
              </SheetAction>
            </div>
            <InfoTip title="Phone alerts" className="mr-3">
              <p>Your phone is told within the hour when a company here files an announcement with NSE - results, dividends, board meetings. The checker reads alerts/watchlist.txt in the Rscreener repository, not this list.</p>
              <p>This copies the list&apos;s companies, one per line, to paste into that file - the GitHub app on your phone can edit it.</p>
            </InfoTip>
          </div>
          {confirmDelete ? (
            <div className="flex items-center gap-2 px-3 min-h-[46px]">
              <span className="flex-1 text-[13px] text-[var(--neg)]">Delete {active.name} and its {active.symbols.length}?</span>
              <button type="button" onClick={() => { setState(deleteList(active.id)); setSheet(null); }}
                className="rs-press min-h-[34px] px-3 rounded-full bg-[var(--neg)] text-white text-[13px] font-semibold">Delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)}
                className="rs-press min-h-[34px] px-3 rounded-full border border-[var(--line)] text-[13px]">Keep</button>
            </div>
          ) : (
            <SheetAction icon="trash" danger onClick={() => setConfirmDelete(true)}>Delete list</SheetAction>
          )}
        </InfoDialog>
      )}

      {/* ── a new list ── */}
      {sheet?.kind === "new" && (
        <InfoDialog title="New watchlist" onClose={() => setSheet(null)}>
          <form onSubmit={(e) => {
            e.preventDefault();
            setState(createList(nameText || `Watchlist ${state.lists.length + 1}`));
            setEditing(false); setQuery(""); setSheet(null);
          }} className="space-y-3">
            <input autoFocus value={nameText} onChange={(e) => setNameText(e.target.value)}
              placeholder={`Watchlist ${state.lists.length + 1}`} aria-label="Name"
              className="w-full h-11 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
            <button type="submit"
              className="rs-press w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
              Create
            </button>
          </form>
        </InfoDialog>
      )}
    </div>
  );
}
