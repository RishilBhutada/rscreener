"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { compile, isValidRatioName, QueryError, Row } from "@/lib/query";
import { loadWatchlist, toggleWatch } from "@/lib/store";
import { FIELD_CATALOG, FIELD_GROUPS } from "@/lib/fields";
import QueryBuilder from "@/components/QueryBuilder";
import TopNav from "@/components/TopNav";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Data = {
  generated_at: string;
  universe_size: number;
  covered: number;
  rows: Row[];
};

type Screen = { name: string; query: string };
type Ratio = { name: string; formula: string };

const EXAMPLES = [
  "roce > 20 and pe < 25",
  "pe < 15 and roe > 20",
  "mcap > 20000 and div_yield > 3",
  "promoter_holding > 60 and sales_cagr_5y > 12",
];

const BASE_COLS = ["symbol", "name", "sector", "price", "mcap", "pe", "pb", "roe", "div_yield"];

const COL_LABELS: Record<string, string> = {
  symbol: "Symbol", name: "Name", sector: "Sector", industry: "Industry",
  price: "Price ₹", mcap: "MCap ₹Cr", pe: "P/E", forward_pe: "Fwd P/E",
  pb: "P/B", book_value: "Book ₹", roe: "ROE %", roa: "ROA %", de: "D/E",
  div_yield: "Div Yld %", net_margin: "Net Mgn %", op_margin: "Op Mgn %",
  gross_margin: "Gross Mgn %", rev_growth: "Rev Gr %", earn_growth: "Earn Gr %",
  revenue: "Revenue ₹", net_income: "Net Profit ₹", total_debt: "Debt ₹",
  total_cash: "Cash ₹", free_cashflow: "FCF ₹", wk52_high: "52w High",
  wk52_low: "52w Low", beta: "Beta",
  sales_cagr_5y: "Sales 5y %", sales_cagr_10y: "Sales 10y %",
  profit_cagr_5y: "Profit 5y %", profit_cagr_10y: "Profit 10y %",
  roce: "ROCE %", ev_ebitda: "EV/EBITDA", ps: "P/S", peg: "PEG",
  int_coverage: "Int Cover", div_payout: "Payout %",
  debtor_days: "Debtor Days", inventory_days: "Inv Days",
  promoter_holding: "Promoter %",
  median_pe_5y: "Median P/E 5y", avg_npm_5y: "Avg Mgn 5y %",
  ret_1m: "Ret 1m %", ret_3m: "Ret 3m %", ret_6m: "Ret 6m %",
  ret_1y: "Ret 1y %", ret_3y: "Ret 3y %", ret_5y: "Ret 5y %",
  off_52w_high: "Off High %",
};

function fmt(key: string, v: string | number | null): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (["mcap", "revenue", "net_income", "total_debt", "total_cash", "free_cashflow"].includes(key)) {
    const val = key === "mcap" ? v : v / 1e7; // non-mcap money fields arrive in ₹, show in Cr
    return val.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  }
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function Home() {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState(EXAMPLES[0]);
  const [qMode, setQMode] = useState<"builder" | "text">("builder");
  const [showFields, setShowFields] = useState(false);
  const [applied, setApplied] = useState<{ matches: Row[]; skipped: number; fields: string[] } | null>(null);
  const [queryError, setQueryError] = useState("");
  const [sortKey, setSortKey] = useState("mcap");
  const [sortDesc, setSortDesc] = useState(true);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [screenName, setScreenName] = useState("");
  const [watch, setWatch] = useState<string[]>([]);
  const [ratios, setRatios] = useState<Ratio[]>([]);
  const [ratioName, setRatioName] = useState("");
  const [ratioFormula, setRatioFormula] = useState("");
  const [ratioError, setRatioError] = useState("");

  useEffect(() => {
    fetch(`${BASE}/data.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setLoadError(`Could not load data.json (${e.message}). Run the pipeline export first.`));
    try {
      setScreens(JSON.parse(localStorage.getItem("rscreener_screens") ?? "[]"));
    } catch { /* corrupted storage - start fresh */ }
    const savedMode = localStorage.getItem("rscreener_qmode");
    if (savedMode === "text" || savedMode === "builder") setQMode(savedMode);
    try {
      setRatios(JSON.parse(localStorage.getItem("rscreener_ratios") ?? "[]"));
    } catch { /* corrupted storage - start fresh */ }
    setWatch(loadWatchlist());
  }, []);

  const ratiosMap = useMemo(
    () => Object.fromEntries(ratios.map((r) => [r.name, r.formula])),
    [ratios]
  );

  const runQuery = (src: string, rows: Row[]) => {
    try {
      const { run, fields } = compile(src, ratiosMap);
      const matches: Row[] = [];
      let skipped = 0;
      for (const row of rows) {
        const res = run(row);
        if (res === true) matches.push(row);
        else if (res === null) skipped++;
      }
      setApplied({ matches, skipped, fields });
      setQueryError("");
    } catch (e) {
      if (e instanceof QueryError) setQueryError(e.message);
      else setQueryError(String(e));
    }
  };

  useEffect(() => {
    if (data) runQuery(query, data.rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ratiosMap]);

  const addRatio = () => {
    const name = ratioName.trim().toLowerCase();
    const formula = ratioFormula.trim();
    const nameErr = isValidRatioName(name);
    if (nameErr) { setRatioError(nameErr); return; }
    if (!formula) { setRatioError("formula is empty"); return; }
    try {
      compile(`${name} > 0`, { ...ratiosMap, [name]: formula });
    } catch (e) {
      setRatioError(e instanceof Error ? e.message : String(e));
      return;
    }
    const next = [...ratios.filter((r) => r.name !== name), { name, formula }];
    setRatios(next);
    localStorage.setItem("rscreener_ratios", JSON.stringify(next));
    setRatioName(""); setRatioFormula(""); setRatioError("");
  };

  const deleteRatio = (name: string) => {
    const next = ratios.filter((r) => r.name !== name);
    setRatios(next);
    localStorage.setItem("rscreener_ratios", JSON.stringify(next));
  };

  const saveScreen = () => {
    if (!screenName.trim()) return;
    const next = [...screens.filter((s) => s.name !== screenName.trim()), { name: screenName.trim(), query }];
    setScreens(next);
    localStorage.setItem("rscreener_screens", JSON.stringify(next));
    setScreenName("");
  };

  const deleteScreen = (name: string) => {
    const next = screens.filter((s) => s.name !== name);
    setScreens(next);
    localStorage.setItem("rscreener_screens", JSON.stringify(next));
  };

  const cols = useMemo(() => {
    const extra = (applied?.fields ?? []).filter((f) => !BASE_COLS.includes(f));
    return [...BASE_COLS, ...extra];
  }, [applied]);

  const sorted = useMemo(() => {
    if (!applied) return [];
    const rows = [...applied.matches];
    rows.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" || typeof bv === "string")
        return sortDesc ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
      return sortDesc ? (bv as number) - (av as number) : (av as number) - (bv as number);
    });
    return rows;
  }, [applied, sortKey, sortDesc]);

  const clickSort = (key: string) => {
    if (sortKey === key) setSortDesc(!sortDesc);
    else { setSortKey(key); setSortDesc(true); }
  };

  const exportCsv = () => {
    if (!applied) return;
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map((c) => COL_LABELS[c] ?? c).join(",")];
    for (const r of sorted) lines.push(cols.map((c) => esc(r[c])).join(","));
    const bom = String.fromCharCode(0xfeff); // Excel needs this to read UTF-8 CSVs
    const blob = new Blob([bom + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "rscreener_screen.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="screens" />
      {data && (
        <p className="max-w-6xl mx-auto px-4 pt-3 text-xs text-[var(--ink3)]">
          {data.covered.toLocaleString("en-IN")} of {data.universe_size.toLocaleString("en-IN")} NSE companies · data as of {data.generated_at}
        </p>
      )}

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {loadError && <div className="bg-[var(--neg-soft)] border border-[var(--neg-line)] text-[var(--neg)] rounded-lg p-4 text-sm">{loadError}</div>}

        <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="text-sm font-semibold text-[var(--ink2)]" htmlFor="q">Build a screen</label>
            <div className="flex gap-1 text-xs" role="group" aria-label="query mode">
              {(["builder", "text"] as const).map((m) => (
                <button key={m}
                  onClick={() => { setQMode(m); localStorage.setItem("rscreener_qmode", m); }}
                  className={`rounded-full px-3 py-1 border ${qMode === m ? "bg-[var(--btn)] border-[var(--btn)] text-[var(--btn-ink)] font-semibold" : "bg-[var(--card)] border-[var(--line)] text-[var(--ink3)]"}`}>
                  {m === "builder" ? "Easy builder" : "Formula"}
                </button>
              ))}
            </div>
          </div>

          {qMode === "builder" ? (
            <QueryBuilder onRun={(q) => { setQuery(q); if (data) runQuery(q, data.rows); }} />
          ) : (
            <>
              <textarea
                id="q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) data && runQuery(query, data.rows); }}
                rows={2}
                spellCheck={false}
                className="w-full font-mono text-sm border border-[var(--line2)] bg-[var(--card)] text-[var(--ink)] rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                placeholder="e.g. pe < 15 and roe > 20"
              />
              {queryError && <p className="text-sm text-[var(--neg)]">{queryError}</p>}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => data && runQuery(query, data.rows)}
                  disabled={!data}
                  className="bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:opacity-40 text-white text-sm font-semibold px-5 py-2 rounded-lg"
                >
                  Run screen
                </button>
                <button onClick={() => setShowFields(!showFields)} className="text-xs font-semibold text-[var(--accent-ink)] hover:underline">
                  {showFields ? "Hide field guide" : "Field guide"}
                </button>
                <span className="text-xs text-[var(--ink3)]">Ctrl+Enter runs · arithmetic works: <code className="font-mono">mcap / revenue &lt; 3</code></span>
              </div>
              {showFields && (
                <div className="border border-[var(--line)] rounded-lg p-3 space-y-2 max-h-64 overflow-auto">
                  {FIELD_GROUPS.map((g) => (
                    <div key={g}>
                      <p className="text-xs font-semibold text-[var(--ink3)] uppercase tracking-wide mb-1">{g}</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {FIELD_CATALOG.filter((f) => f.group === g).map((f) => (
                          <button key={f.key} title={`${f.desc}${f.unit ? ` (${f.unit})` : ""}`}
                            onClick={() => setQuery((q) => (q.trim() ? `${q.trim()} and ${f.key} ` : `${f.key} `))}
                            className="text-xs font-mono bg-[var(--card2)] hover:bg-[var(--accent-soft)] border border-[var(--line)] rounded-full px-2.5 py-0.5 text-[var(--ink2)]">
                            {f.key}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 flex-wrap">
                {EXAMPLES.map((ex) => (
                  <button key={ex} onClick={() => { setQuery(ex); data && runQuery(ex, data.rows); }}
                    className="text-xs font-mono bg-[var(--card2)] hover:bg-[var(--accent-soft)] border border-[var(--line)] rounded-full px-3 py-1 text-[var(--ink2)]">
                    {ex}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[var(--ink2)]">Saved screens</span>
            <input
              value={screenName}
              onChange={(e) => setScreenName(e.target.value)}
              placeholder="name this screen"
              className="text-sm border border-[var(--line2)] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <button onClick={saveScreen} className="text-sm bg-[var(--btn)] hover:opacity-85 text-[var(--btn-ink)] px-4 py-1.5 rounded-lg">Save</button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {screens.length === 0 && <span className="text-xs text-[var(--ink3)]">none yet — saved screens live on this device</span>}
            {screens.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1 text-xs bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded-full px-3 py-1">
                <button className="font-semibold text-[var(--accent-ink)]" title={s.query}
                  onClick={() => { setQuery(s.query); data && runQuery(s.query, data.rows); }}>
                  {s.name}
                </button>
                <button onClick={() => deleteScreen(s.name)} aria-label={`delete ${s.name}`} className="text-[var(--accent)] hover:text-[var(--neg)]">×</button>
              </span>
            ))}
          </div>
        </section>

        <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[var(--ink2)]">Custom ratios</span>
            <input
              value={ratioName}
              onChange={(e) => setRatioName(e.target.value)}
              placeholder="name e.g. earnings_yield"
              className="text-sm font-mono border border-[var(--line2)] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <span className="text-[var(--ink3)]">=</span>
            <input
              value={ratioFormula}
              onChange={(e) => setRatioFormula(e.target.value)}
              placeholder="formula e.g. 100 / pe"
              className="flex-1 min-w-40 text-sm font-mono border border-[var(--line2)] rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <button onClick={addRatio} className="text-sm bg-[var(--btn)] hover:opacity-85 text-[var(--btn-ink)] px-4 py-1.5 rounded-lg">Add</button>
          </div>
          {ratioError && <p className="text-sm text-[var(--neg)]">{ratioError}</p>}
          <div className="flex gap-2 flex-wrap">
            {ratios.length === 0 && (
              <span className="text-xs text-[var(--ink3)]">
                define your own fields for queries — e.g. <code className="font-mono">earnings_yield = 100 / pe</code>, then screen <code className="font-mono">earnings_yield &gt; 6</code>
              </span>
            )}
            {ratios.map((r) => (
              <span key={r.name} className="inline-flex items-center gap-1 text-xs font-mono bg-[var(--card2)] border border-[var(--line)] rounded-full px-3 py-1">
                <span title={r.formula}><strong>{r.name}</strong> = {r.formula}</span>
                <button onClick={() => deleteRatio(r.name)} aria-label={`delete ratio ${r.name}`} className="text-[var(--ink3)] hover:text-[var(--neg)]">×</button>
              </span>
            ))}
          </div>
        </section>

        {data && watch.length > 0 && (
          <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
            <h2 className="px-4 py-3 text-sm font-bold text-[var(--ink)] border-b border-[var(--line)]">
              <span className="text-[var(--accent)]">★</span> Watchlist
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--card2)] text-xs text-[var(--ink3)] uppercase text-left">
                    <th className="px-3 py-2 w-8"> </th><th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2 text-right">Price ₹</th><th className="px-3 py-2 text-right">MCap ₹Cr</th>
                    <th className="px-3 py-2 text-right">P/E</th><th className="px-3 py-2 text-right">ROE %</th>
                  </tr>
                </thead>
                <tbody>
                  {watch.map((sym) => {
                    const r = data.rows.find((x) => x.symbol === sym);
                    if (!r) return null;
                    return (
                      <tr key={sym} className="border-t border-[var(--line)] hover:bg-[var(--accent-soft)]">
                        <td className="px-3 py-2"><button onClick={() => setWatch(toggleWatch(sym))} aria-label={`remove ${sym} from watchlist`} className="text-[var(--accent)] hover:text-[var(--line2)]">★</button></td>
                        <td className="px-3 py-2"><Link href={`/company?s=${sym}`} className="font-semibold text-[var(--accent-ink)] hover:underline">{sym}</Link></td>
                        <td className="px-3 py-2 max-w-56 truncate">{String(r.name ?? "—")}</td>
                        <td className="px-3 py-2 text-right">{fmt("price", r.price ?? null)}</td>
                        <td className="px-3 py-2 text-right">{fmt("mcap", r.mcap ?? null)}</td>
                        <td className="px-3 py-2 text-right">{fmt("pe", r.pe ?? null)}</td>
                        <td className="px-3 py-2 text-right">{fmt("roe", r.roe ?? null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {applied && (
          <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
            <div className="px-4 py-3 text-sm text-[var(--ink2)] border-b border-[var(--line)] flex items-center justify-between flex-wrap gap-2">
              <span>
                <strong className="text-[var(--ink)]">{applied.matches.length.toLocaleString("en-IN")}</strong> companies match
                {applied.skipped > 0 && <span className="text-[var(--ink3)]"> · {applied.skipped.toLocaleString("en-IN")} skipped (missing a queried field)</span>}
                {sorted.length > 300 && <span className="text-[var(--ink3)]"> · showing top 300 by current sort</span>}
              </span>
              <button onClick={exportCsv} className="text-xs font-semibold bg-[var(--card2)] hover:bg-[var(--accent-soft)] border border-[var(--line)] rounded-lg px-3 py-1.5">
                Export CSV (Excel)
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--card2)] text-left text-xs text-[var(--ink3)] uppercase tracking-wide">
                    <th className="px-3 py-2 w-8"> </th>
                    {cols.map((c) => (
                      <th key={c} className="px-3 py-2 cursor-pointer hover:text-[var(--accent-ink)] whitespace-nowrap select-none" onClick={() => clickSort(c)}>
                        {COL_LABELS[c] ?? c}{sortKey === c ? (sortDesc ? " ↓" : " ↑") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 300).map((r) => (
                    <tr key={String(r.symbol)} className="border-t border-[var(--line)] hover:bg-[var(--accent-soft)]">
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setWatch(toggleWatch(String(r.symbol)))}
                          aria-label={`toggle ${r.symbol} on watchlist`}
                          className={watch.includes(String(r.symbol)) ? "text-[var(--accent)]" : "text-[var(--line2)] hover:text-[var(--accent)]"}
                        >
                          ★
                        </button>
                      </td>
                      {cols.map((c) => (
                        <td key={c} className={`px-3 py-2 whitespace-nowrap ${c === "name" ? "max-w-56 truncate" : ""}`}>
                          {c === "symbol" ? (
                            <Link href={`/company?s=${r.symbol}`} className="font-semibold text-[var(--accent-ink)] hover:underline">
                              {String(r.symbol)}
                            </Link>
                          ) : c === "sector" && r.sector ? (
                            <Link href={`/sectors?s=${encodeURIComponent(String(r.sector))}`} className="hover:text-[var(--accent-ink)] hover:underline">
                              {String(r.sector)}
                            </Link>
                          ) : (
                            fmt(c, r[c] ?? null)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer className="text-xs text-[var(--ink3)] leading-relaxed pb-8">
          Data: Yahoo Finance via yfinance — <strong>every number is unverified until checked against a company filing</strong>.
          Blank fields are excluded from screens, never treated as zero. This tool screens; it never recommends buying or selling anything.
        </footer>
      </main>
    </div>
  );
}
