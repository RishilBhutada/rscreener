"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import InfoTip, { InfoDialog } from "@/components/InfoTip";
import { LiteRow, loadIndex, symbolHref } from "@/lib/index-data";
import { shortName } from "@/lib/names";
import { Holding, loadPortfolio, parseHoldings, removeHolding, savePortfolio, upsertHolding } from "@/lib/portfolio";
import {
  Chips, Icon, IconButton, SheetAction, Stat, dayMove, money, shortDay, shownSymbol, signed, tone,
} from "@/components/QuoteUI";

/** Holdings, laid out the way a broker's holdings screen is: the totals in
 *  one card, then one block per holding - quantity and average above, the
 *  symbol and its profit in the middle, cost and today's price below. A
 *  read-only mirror: nothing here can place an order. */

type SortKey = "value" | "pnlpct" | "pnl" | "day" | "az";
const SORT_KEY = "rs_pf_sort";
const SORTS: [SortKey, string][] = [
  ["value", "Current value"], ["pnlpct", "P&L %"], ["pnl", "P&L ₹"], ["day", "Day change"], ["az", "A–Z"],
];
type Tab = "holdings" | "allocation";
type Sheet =
  | { kind: "holding"; sym: string }
  | { kind: "add" }
  | { kind: "import" }
  | { kind: "sort" }
  | null;

type Line = Holding & {
  row?: LiteRow;
  name: string;
  price: number | null;
  invested: number;
  current: number | null;
  pnl: number | null;
  pnlPct: number | null;
  day: number | null;        // ₹ moved today on the whole holding
  dayPct: number | null;
};

function rupees(v: number | null | undefined, dec = 0): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `₹${money(v, dec)}`;
}

function signedRupees(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = signed(v, dec);
  return s.startsWith("+") || s.startsWith("−") ? `${s[0]}₹${s.slice(1)}` : `₹${s}`;
}

export default function PortfolioPage() {
  const [rows, setRows] = useState<LiteRow[]>([]);
  const [asof, setAsof] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("holdings");
  const [sortKey, setSortKeyState] = useState<SortKey>("value");
  const [sheet, setSheet] = useState<Sheet>(null);
  // add / edit form
  const [pick, setPick] = useState("");
  const [pickQuery, setPickQuery] = useState("");
  const [qtyText, setQtyText] = useState("");
  const [avgText, setAvgText] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  // import
  const [pasteText, setPasteText] = useState("");
  const [importError, setImportError] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadIndex()
      .then((d) => { setRows(d.rows); setAsof(d.price_modal ?? d.price_asof); })
      .catch(() => {});
    setHoldings(loadPortfolio());
    try {
      const s = localStorage.getItem(SORT_KEY) as SortKey | null;
      if (s && SORTS.some(([k]) => k === s)) setSortKeyState(s);
    } catch { /* private mode */ }
    setReady(true);
  }, []);

  const setSortKey = (k: SortKey) => {
    setSortKeyState(k);
    try { localStorage.setItem(SORT_KEY, k); } catch { /* private mode */ }
  };

  const bySymbol = useMemo(() => new Map(rows.map((r) => [r.symbol, r])), [rows]);

  const lines: Line[] = useMemo(() => holdings.map((h) => {
    const row = bySymbol.get(h.symbol);
    const price = row?.price ?? null;
    const invested = h.qty * h.avg;
    const current = price !== null ? h.qty * price : null;
    const move = dayMove(price, row?.ret_1d);
    return {
      ...h, row,
      name: row ? shortName(row.name, h.symbol) : h.symbol,
      price, invested, current,
      pnl: current !== null ? current - invested : null,
      pnlPct: current !== null && invested > 0 ? ((current - invested) / invested) * 100 : null,
      day: move !== null ? move * h.qty : null,
      dayPct: row?.ret_1d ?? null,
    };
  }), [holdings, bySymbol]);

  const totals = useMemo(() => {
    // Priced holdings only, on both sides: a holding with no price counted at
    // cost would be a "current value" that is not current. What is left out
    // is said beside the card.
    const priced = lines.filter((h) => h.current !== null);
    const invested = priced.reduce((s, h) => s + h.invested, 0);
    const current = priced.reduce((s, h) => s + (h.current as number), 0);
    const withDay = priced.filter((h) => h.day !== null);
    const day = withDay.reduce((s, h) => s + (h.day as number), 0);
    const dayBase = withDay.reduce((s, h) => s + (h.current as number) - (h.day as number), 0);
    return {
      invested, current,
      pnl: current - invested,
      pnlPct: invested > 0 ? ((current - invested) / invested) * 100 : null,
      day: withDay.length ? day : null,
      dayPct: dayBase > 0 ? (day / dayBase) * 100 : null,
      unpriced: lines.length - priced.length,
      unpricedCost: lines.filter((h) => h.current === null).reduce((s, h) => s + h.invested, 0),
    };
  }, [lines]);

  const sorted = useMemo(() => {
    const v = (h: Line): number | null =>
      sortKey === "value" ? h.current : sortKey === "pnlpct" ? h.pnlPct : sortKey === "pnl" ? h.pnl : h.dayPct;
    if (sortKey === "az") return [...lines].sort((a, b) => a.symbol.localeCompare(b.symbol));
    return [...lines].sort((a, b) => {
      const av = v(a), bv = v(b);
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return bv - av;
    });
  }, [lines, sortKey]);

  const alloc = useMemo(() => {
    const priced = lines.filter((h) => h.current !== null && h.current > 0)
      .sort((a, b) => (b.current as number) - (a.current as number));
    const total = priced.reduce((s, h) => s + (h.current as number), 0);
    const w = priced.map((h) => ({ sym: h.symbol, name: h.name, w: total > 0 ? ((h.current as number) / total) * 100 : 0, pnlPct: h.pnlPct }));
    // Earnings yield averaged by value, then turned back into a P/E: the P/E
    // of the whole holding as if it were one company. Loss-makers are left
    // out, because a negative P/E averaged in means nothing.
    const eligible = priced.filter((h) => h.row?.pe && h.row.pe > 0);
    const ev = eligible.reduce((s, h) => s + (h.current as number), 0);
    const ey = eligible.reduce((s, h) => s + (h.current as number) / (h.row?.pe as number), 0);
    const roceRows = priced.filter((h) => typeof h.row?.roce === "number");
    const rv = roceRows.reduce((s, h) => s + (h.current as number), 0);
    return {
      w,
      top1: w[0]?.w ?? null,
      top5: w.slice(0, 5).reduce((s, x) => s + x.w, 0),
      gainers: lines.filter((h) => (h.pnl ?? 0) > 0).length,
      losers: lines.filter((h) => (h.pnl ?? 0) < 0).length,
      pe: ey > 0 ? ev / ey : null,
      peCover: total > 0 ? (ev / total) * 100 : 0,
      roce: rv > 0 ? roceRows.reduce((s, h) => s + (h.current as number) * (h.row?.roce as number), 0) / rv : null,
    };
  }, [lines]);

  // ── add / edit ──
  const choices = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return [];
    return rows
      .filter((r) => !r.commodity)
      .map((r) => {
        const sym = r.symbol.toLowerCase(), nm = r.name.toLowerCase();
        const score = sym === q ? -1 : sym.startsWith(q) ? 0 : nm.startsWith(q) ? 1 : nm.includes(q) || sym.includes(q) ? 2 : 9;
        return [score, r] as const;
      })
      .filter(([s]) => s < 9)
      .sort((a, b) => a[0] - b[0] || (b[1].mcap ?? 0) - (a[1].mcap ?? 0))
      .slice(0, 6)
      .map(([, r]) => r);
  }, [pickQuery, rows]);

  const openHolding = (h: Line) => {
    setQtyText(String(h.qty));
    setAvgText(String(h.avg));
    setConfirmRemove(false);
    setSheet({ kind: "holding", sym: h.symbol });
  };
  const openAdd = () => {
    setPick(""); setPickQuery(""); setQtyText(""); setAvgText("");
    setSheet({ kind: "add" });
  };
  const qty = parseFloat(qtyText.replace(/,/g, ""));
  const avg = parseFloat(avgText.replace(/,/g, ""));
  const formOk = Number.isFinite(qty) && qty > 0 && Number.isFinite(avg) && avg > 0;

  // ── import ──
  const doImport = (text: string) => {
    const res = parseHoldings(text);
    if (res.error) { setImportError(res.error); return; }
    if (res.holdings.length === 0) { setImportError("No holdings rows found in that file"); return; }
    savePortfolio(res.holdings);
    setHoldings(res.holdings);
    setImportError(""); setPasteText(""); setSheet(null);
  };

  const sheetLine = sheet?.kind === "holding" ? lines.find((h) => h.symbol === sheet.sym) : undefined;
  const already = pick ? holdings.find((h) => h.symbol === pick) : undefined;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="portfolio" />
      <main className="max-w-2xl mx-auto px-4 pt-4 pb-24">
        <div className="flex items-center gap-2 mb-3">
          <h1 className="text-[22px] font-bold tracking-tight">Portfolio</h1>
          <InfoTip title="Portfolio">
            <p>A read-only mirror of what you already own. Nothing here can place, change or cancel an order.</p>
            <p>Prices are closing prices from the nightly refresh, not live. Values are worked out from them and are unverified — check them against your broker&apos;s own statement.</p>
            <p>Holdings stay on this device, and follow you to others only if you sign in. Nothing here is a recommendation to buy, sell or hold anything.</p>
          </InfoTip>
          <div className="ml-auto flex items-center">
            {asof && <span className="text-[11px] text-[var(--ink3)] tabular-nums mr-1">Close {shortDay(asof)}</span>}
            <IconButton name="plus" label="Add a holding" onClick={openAdd} />
            <IconButton name="upload" label="Import from your broker" onClick={() => { setImportError(""); setConfirmClear(false); setSheet({ kind: "import" }); }} />
          </div>
        </div>

        {ready && holdings.length === 0 && (
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] px-5 py-10 text-center">
            <p className="text-[15px] font-semibold mb-1">No holdings yet</p>
            <p className="text-[13px] text-[var(--ink3)] mb-5">Bring them in from your broker&apos;s holdings file, or add them one at a time.</p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <button type="button" onClick={() => setSheet({ kind: "import" })}
                className="rs-press min-h-[44px] px-5 rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
                Import from broker
              </button>
              <button type="button" onClick={openAdd}
                className="rs-press min-h-[44px] px-5 rounded-xl border border-[var(--line2)] text-[14px] font-semibold">
                Add one by hand
              </button>
            </div>
          </div>
        )}

        {holdings.length > 0 && (
          <>
            {/* ── totals ── */}
            <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 mb-4">
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Invested" value={rupees(totals.invested)} />
                <div className="text-right"><Stat label="Current" value={rupees(totals.current)} /></div>
              </div>
              <div className="mt-3 pt-3 border-t border-[var(--line)] space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-[var(--ink2)]">P&amp;L</span>
                  <span className={`text-[17px] font-semibold tabular-nums ${tone(totals.pnl)}`}>
                    {signedRupees(totals.pnl)} <span className="text-[13px]">{totals.pnlPct === null ? "" : `${signed(totals.pnlPct)}%`}</span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-[var(--ink2)]">Day&apos;s P&amp;L</span>
                  <span className={`text-[14px] font-medium tabular-nums ${tone(totals.day)}`}>
                    {signedRupees(totals.day)} <span className="text-[12px]">{totals.dayPct === null ? "" : `${signed(totals.dayPct)}%`}</span>
                  </span>
                </div>
              </div>
              {totals.unpriced > 0 && (
                <p className="mt-2 text-[11px] text-[var(--ink3)] flex items-center">
                  {totals.unpriced} holding{totals.unpriced === 1 ? "" : "s"} without a price left out (cost {rupees(totals.unpricedCost)})
                  <InfoTip title="Holdings without a price" className="ml-1">
                    <p>The totals cover the {lines.length - totals.unpriced} holdings that have a price today.</p>
                    <p>The rest are left out of every total rather than counted at what you paid — that would report a &ldquo;current&rdquo; value that is not current.</p>
                    <p>A symbol is unpriced when it is not in the app&apos;s data: BSE-only, delisted or renamed. Its row says &ldquo;Not in today&apos;s data&rdquo;.</p>
                  </InfoTip>
                </p>
              )}
            </section>

            {/* ── holdings | allocation ── */}
            <div className="flex items-center border-b border-[var(--line)] mb-1" role="tablist">
              {([["holdings", `Holdings (${lines.length})`], ["allocation", "Allocation"]] as [Tab, string][]).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`px-3 pt-1 pb-2 -mb-px border-b-2 text-[14px] ${
                    tab === k ? "border-[var(--accent)] text-[var(--accent-ink)] font-semibold" : "border-transparent text-[var(--ink2)]"}`}>
                  {label}
                </button>
              ))}
              {tab === "holdings" && (
                <div className="ml-auto">
                  <IconButton name="sliders" label="Sort holdings" onClick={() => setSheet({ kind: "sort" })} active={sortKey !== "value"} />
                </div>
              )}
            </div>

            {tab === "holdings" && (
              <ul className="divide-y divide-[var(--line)]">
                {sorted.map((h) => (
                  <li key={h.symbol}>
                    <button type="button" onClick={() => openHolding(h)}
                      className="w-full py-3 text-left active:bg-[var(--card2)]">
                      <div className="flex justify-between text-[11px] text-[var(--ink3)] tabular-nums">
                        <span>Qty {h.qty.toLocaleString("en-IN")} · Avg {money(h.avg)}</span>
                        <span className={tone(h.pnlPct)}>{h.pnlPct === null ? "" : `${signed(h.pnlPct)}%`}</span>
                      </div>
                      <div className="flex justify-between items-baseline gap-3 my-0.5">
                        <span className="min-w-0 truncate text-[15px] font-medium text-[var(--ink)]">{shownSymbol(h.symbol)}</span>
                        <span className={`shrink-0 text-[15px] font-medium tabular-nums ${tone(h.pnl)}`}>{h.pnl === null ? "—" : signed(h.pnl)}</span>
                      </div>
                      <div className="flex justify-between gap-3 text-[11px] text-[var(--ink3)] tabular-nums">
                        <span className="truncate">{h.row ? `Invested ${money(h.invested, 0)}` : "Not in today's data"}</span>
                        <span className="shrink-0">
                          LTP {money(h.price)}{h.dayPct !== null && <> <span className={tone(h.dayPct)}>({signed(h.dayPct)}%)</span></>}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {tab === "allocation" && (
              <div className="pt-3">
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <Stat label="Largest" value={alloc.top1 === null ? "—" : `${alloc.top1.toFixed(1)}%`} />
                  <Stat label="Top 5" value={`${alloc.top5.toFixed(1)}%`} />
                  <Stat label="In profit / loss" value={<><span className="text-[var(--pos)]">{alloc.gainers}</span> / <span className="text-[var(--neg)]">{alloc.losers}</span></>} />
                  <Stat label="Weighted P/E" value={alloc.pe === null ? "—" : alloc.pe.toFixed(1)} />
                  <Stat label="Weighted ROCE" value={alloc.roce === null ? "—" : `${alloc.roce.toFixed(1)}%`} />
                  <div className="flex items-end">
                    <InfoTip title="Weighted figures">
                      <p>Weighted P/E is the P/E of everything you hold as if it were one company: each holding&apos;s earnings yield, weighted by its value, turned back into a P/E. Loss-makers are left out; the rest are {alloc.peCover.toFixed(0)}% of your value.</p>
                      <p>Weighted ROCE averages each holding&apos;s ROCE by its value.</p>
                      <p>Both are worked out from the app&apos;s own figures and are unverified.</p>
                    </InfoTip>
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {alloc.w.map((x) => (
                    <li key={x.sym}>
                      <button type="button" onClick={() => { const h = lines.find((l) => l.symbol === x.sym); if (h) openHolding(h); }}
                        className="w-full text-left">
                        <div className="flex justify-between text-[13px] mb-1">
                          <span className="font-medium truncate">{shownSymbol(x.sym)}</span>
                          <span className="tabular-nums text-[var(--ink2)]">{x.w.toFixed(1)}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-[var(--card2)] overflow-hidden">
                          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(x.w, 0.5)}%` }} />
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── one holding ── */}
      {sheet?.kind === "holding" && sheetLine && (
        <InfoDialog title={sheetLine.name} onClose={() => setSheet(null)}>
          <div className="flex items-baseline flex-wrap gap-x-2">
            <span className="text-[22px] font-semibold tabular-nums text-[var(--ink)]">{rupees(sheetLine.current)}</span>
            <span className={`text-[13px] tabular-nums ${tone(sheetLine.pnl)}`}>
              {signedRupees(sheetLine.pnl)} {sheetLine.pnlPct !== null && `(${signed(sheetLine.pnlPct)}%)`}
            </span>
          </div>
          <p className="text-[11px] text-[var(--ink3)]">{shownSymbol(sheetLine.symbol)}{sheetLine.row?.exchange && ` · ${sheetLine.row.exchange}`}</p>
          <div className="grid grid-cols-3 gap-3 py-2">
            <Stat label="Qty" value={sheetLine.qty.toLocaleString("en-IN")} />
            <Stat label="Avg" value={money(sheetLine.avg)} />
            <Stat label="LTP" value={money(sheetLine.price)} />
            <Stat label="Invested" value={money(sheetLine.invested, 0)} />
            <Stat label="Day" value={sheetLine.day === null ? "—" : signed(sheetLine.day, 0)} className={tone(sheetLine.day)} />
            <Stat label="Weight" value={(() => { const w = alloc.w.find((x) => x.sym === sheetLine.symbol)?.w; return w === undefined ? "—" : `${w.toFixed(1)}%`; })()} />
            <Stat label="P/E" value={sheetLine.row?.pe === undefined ? "—" : sheetLine.row.pe.toFixed(1)} />
            <Stat label="ROCE" value={sheetLine.row?.roce === undefined ? "—" : `${sheetLine.row.roce.toFixed(1)}%`} />
            <Stat label="1M" value={sheetLine.row?.ret_1m === undefined ? "—" : `${signed(sheetLine.row.ret_1m, 1)}%`} className={tone(sheetLine.row?.ret_1m)} />
          </div>
          {sheetLine.row && (
            <div className="grid grid-cols-2 gap-2">
              <Link href={symbolHref(sheetLine.symbol)}
                className="rs-press inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">
                <Icon name="page" size={16} /> Overview
              </Link>
              <Link href={`/chart?s=${encodeURIComponent(sheetLine.symbol)}`}
                onClick={() => { try { sessionStorage.setItem("rs_chart_from", location.pathname); } catch { /* private mode */ } }}
                className="rs-press inline-flex items-center justify-center gap-2 min-h-[44px] rounded-xl border border-[var(--line2)] text-[var(--ink)] text-[14px] font-semibold">
                <Icon name="chart" size={16} /> Chart
              </Link>
            </div>
          )}
          <form className="pt-2 border-t border-[var(--line)] mt-2 space-y-2" onSubmit={(e) => {
            e.preventDefault();
            if (!formOk) return;
            setHoldings(upsertHolding({ symbol: sheetLine.symbol, qty, avg }));
            setSheet(null);
          }}>
            <p className="text-[11px] uppercase tracking-wide text-[var(--ink3)]">Edit</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={qtyText} onChange={(e) => setQtyText(e.target.value)} inputMode="decimal" aria-label="Quantity" placeholder="Qty"
                className="h-10 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
              <input value={avgText} onChange={(e) => setAvgText(e.target.value)} inputMode="decimal" aria-label="Average price" placeholder="Avg ₹"
                className="h-10 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
            </div>
            <button type="submit" disabled={!formOk || (qty === sheetLine.qty && avg === sheetLine.avg)}
              className="rs-press w-full min-h-[40px] rounded-xl border border-[var(--line2)] text-[14px] font-semibold disabled:opacity-40">
              Save
            </button>
          </form>
          {confirmRemove ? (
            <div className="flex items-center gap-2 px-3 min-h-[46px]">
              <span className="flex-1 text-[13px] text-[var(--neg)]">Remove {shownSymbol(sheetLine.symbol)} from Portfolio?</span>
              <button type="button" onClick={() => { setHoldings(removeHolding(sheetLine.symbol)); setSheet(null); }}
                className="rs-press min-h-[34px] px-3 rounded-full bg-[var(--neg)] text-white text-[13px] font-semibold">Remove</button>
              <button type="button" onClick={() => setConfirmRemove(false)}
                className="rs-press min-h-[34px] px-3 rounded-full border border-[var(--line)] text-[13px]">Keep</button>
            </div>
          ) : (
            <SheetAction icon="trash" danger onClick={() => setConfirmRemove(true)}>Remove holding</SheetAction>
          )}
        </InfoDialog>
      )}

      {/* ── add by hand ── */}
      {sheet?.kind === "add" && (
        <InfoDialog title="Add a holding" onClose={() => setSheet(null)}>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            if (!pick || !formOk) return;
            setHoldings(upsertHolding({ symbol: pick, qty, avg }));
            setSheet(null);
          }}>
            {pick ? (
              <div className="flex items-center justify-between h-11 px-3 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)]">
                <span className="text-[14px] font-semibold text-[var(--ink)] truncate">
                  {shownSymbol(pick)} <span className="font-normal text-[var(--ink3)]">{shortName(bySymbol.get(pick)?.name ?? "", pick)}</span>
                </span>
                <button type="button" onClick={() => { setPick(""); setPickQuery(""); }} aria-label="Choose another" className="p-1 -m-1 text-[var(--ink3)]">
                  <Icon name="close" size={16} />
                </button>
              </div>
            ) : (
              <div>
                <input autoFocus value={pickQuery} onChange={(e) => setPickQuery(e.target.value)} placeholder="Company or ETF"
                  aria-label="Company or ETF"
                  className="w-full h-11 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
                {choices.length > 0 && (
                  <ul className="mt-1 rounded-lg border border-[var(--line)] divide-y divide-[var(--line)] overflow-hidden">
                    {choices.map((r) => (
                      <li key={r.symbol}>
                        <button type="button" onClick={() => setPick(r.symbol)} className="w-full px-3 py-2 text-left active:bg-[var(--card2)]">
                          <span className="text-[14px] font-medium text-[var(--ink)]">{r.symbol}</span>
                          <span className="ml-2 text-[12px] text-[var(--ink3)]">{shortName(r.name, r.symbol)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <input value={qtyText} onChange={(e) => setQtyText(e.target.value)} inputMode="decimal" placeholder="Quantity" aria-label="Quantity"
                className="h-11 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
              <input value={avgText} onChange={(e) => setAvgText(e.target.value)} inputMode="decimal" placeholder="Average ₹" aria-label="Average price"
                className="h-11 px-3 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[14px] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
            </div>
            {already && (
              <p className="text-[12px] text-[var(--warn-ink)]">Replaces your {already.qty.toLocaleString("en-IN")} at {money(already.avg)}</p>
            )}
            <button type="submit" disabled={!pick || !formOk}
              className="rs-press w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold disabled:opacity-40">
              {already ? "Replace" : "Add"}
            </button>
          </form>
        </InfoDialog>
      )}

      {/* ── import ── */}
      {sheet?.kind === "import" && (
        <InfoDialog title="Import holdings" onClose={() => setSheet(null)}>
          <p className="flex items-center">
            Your broker&apos;s holdings file, as CSV.
            <InfoTip title="Where to get the file" className="ml-1">
              <p><strong>Zerodha</strong>: Console › Portfolio › Holdings › Download CSV.</p>
              <p><strong>Angel One</strong>: Portfolio › Holdings › export.</p>
              <p><strong>Groww</strong>: the holdings statement.</p>
              <p>Any CSV with a symbol, a quantity and an average-price column works. Importing replaces the holdings you have here.</p>
            </InfoTip>
          </p>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(doImport).catch((err) => setImportError(String(err))); e.target.value = ""; }} />
          <button type="button" onClick={() => fileRef.current?.click()}
            className="rs-press w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold inline-flex items-center justify-center gap-2">
            <Icon name="upload" size={16} /> Choose file
          </button>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4}
            placeholder={"…or paste it here\nSymbol,Quantity,Average Price\nRELIANCE,10,2450.50"}
            className="w-full font-mono text-[12px] px-3 py-2 rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[var(--ink)] outline-none focus:border-[var(--accent-line)]" />
          {pasteText.trim() && (
            <button type="button" onClick={() => doImport(pasteText)}
              className="rs-press w-full min-h-[40px] rounded-xl border border-[var(--line2)] text-[14px] font-semibold">
              Import pasted text
            </button>
          )}
          {importError && <p className="text-[12px] text-[var(--neg)]">{importError}</p>}
          {holdings.length > 0 && (
            <div className="pt-2 border-t border-[var(--line)]">
              {confirmClear ? (
                <div className="flex items-center gap-2 px-3 min-h-[46px]">
                  <span className="flex-1 text-[13px] text-[var(--neg)]">Remove all {holdings.length} holdings?</span>
                  <button type="button" onClick={() => { savePortfolio([]); setHoldings([]); setSheet(null); }}
                    className="rs-press min-h-[34px] px-3 rounded-full bg-[var(--neg)] text-white text-[13px] font-semibold">Remove all</button>
                  <button type="button" onClick={() => setConfirmClear(false)}
                    className="rs-press min-h-[34px] px-3 rounded-full border border-[var(--line)] text-[13px]">Keep</button>
                </div>
              ) : (
                <SheetAction icon="trash" danger onClick={() => setConfirmClear(true)}>Remove all holdings</SheetAction>
              )}
            </div>
          )}
        </InfoDialog>
      )}

      {/* ── sort ── */}
      {sheet?.kind === "sort" && (
        <InfoDialog title="Sort holdings" onClose={() => setSheet(null)}>
          <Chips value={sortKey} options={SORTS} onChange={(k) => { setSortKey(k); setSheet(null); }} />
        </InfoDialog>
      )}
    </div>
  );
}
