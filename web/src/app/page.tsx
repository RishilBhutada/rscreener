"use client";

import { useEffect, useMemo, useState } from "react";
import { compile, QueryError, Row } from "@/lib/query";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Data = {
  generated_at: string;
  universe_size: number;
  covered: number;
  rows: Row[];
};

type Screen = { name: string; query: string };

const EXAMPLES = [
  "pe < 15 and roe > 20",
  "mcap > 20000 and div_yield > 3",
  "pb < 2 and rev_growth > 15",
  "pe < 25 and net_margin > 15 and mcap > 5000",
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
  const [applied, setApplied] = useState<{ matches: Row[]; skipped: number; fields: string[] } | null>(null);
  const [queryError, setQueryError] = useState("");
  const [sortKey, setSortKey] = useState("mcap");
  const [sortDesc, setSortDesc] = useState(true);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [screenName, setScreenName] = useState("");

  useEffect(() => {
    fetch(`${BASE}/data.json`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setData)
      .catch((e) => setLoadError(`Could not load data.json (${e.message}). Run the pipeline export first.`));
    try {
      setScreens(JSON.parse(localStorage.getItem("rscreener_screens") ?? "[]"));
    } catch { /* corrupted storage - start fresh */ }
  }, []);

  const runQuery = (src: string, rows: Row[]) => {
    try {
      const { run, fields } = compile(src);
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
  }, [data]);

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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold text-emerald-700">Rscreener</h1>
            <p className="text-sm text-slate-500">NSE fundamentals screener — personal, zero-cost</p>
          </div>
          {data && (
            <p className="text-xs text-slate-400">
              {data.covered.toLocaleString("en-IN")} of {data.universe_size.toLocaleString("en-IN")} NSE companies covered · data as of {data.generated_at}
            </p>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {loadError && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{loadError}</div>}

        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
          <label className="text-sm font-semibold text-slate-700" htmlFor="q">Query</label>
          <textarea
            id="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) data && runQuery(query, data.rows); }}
            rows={2}
            spellCheck={false}
            className="w-full font-mono text-sm border border-slate-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            placeholder="e.g. pe < 15 and roe > 20"
          />
          {queryError && <p className="text-sm text-red-600">{queryError}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => data && runQuery(query, data.rows)}
              disabled={!data}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-sm font-semibold px-5 py-2 rounded-lg"
            >
              Run screen
            </button>
            <span className="text-xs text-slate-400">Ctrl+Enter also runs · fields: pe, pb, roe, mcap (₹Cr), div_yield, de, net_margin, rev_growth…</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => { setQuery(ex); data && runQuery(ex, data.rows); }}
                className="text-xs font-mono bg-slate-100 hover:bg-emerald-50 border border-slate-200 rounded-full px-3 py-1">
                {ex}
              </button>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-700">Saved screens</span>
            <input
              value={screenName}
              onChange={(e) => setScreenName(e.target.value)}
              placeholder="name this screen"
              className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button onClick={saveScreen} className="text-sm bg-slate-800 hover:bg-slate-900 text-white px-4 py-1.5 rounded-lg">Save</button>
          </div>
          <div className="flex gap-2 flex-wrap">
            {screens.length === 0 && <span className="text-xs text-slate-400">none yet — saved screens live on this device</span>}
            {screens.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1 text-xs bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
                <button className="font-semibold text-emerald-800" title={s.query}
                  onClick={() => { setQuery(s.query); data && runQuery(s.query, data.rows); }}>
                  {s.name}
                </button>
                <button onClick={() => deleteScreen(s.name)} aria-label={`delete ${s.name}`} className="text-emerald-400 hover:text-red-500">×</button>
              </span>
            ))}
          </div>
        </section>

        {applied && (
          <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 text-sm text-slate-600 border-b border-slate-100">
              <strong className="text-slate-900">{applied.matches.length.toLocaleString("en-IN")}</strong> companies match
              {applied.skipped > 0 && <span className="text-slate-400"> · {applied.skipped.toLocaleString("en-IN")} skipped (missing a queried field)</span>}
              {sorted.length > 300 && <span className="text-slate-400"> · showing top 300 by current sort</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
                    {cols.map((c) => (
                      <th key={c} className="px-3 py-2 cursor-pointer hover:text-emerald-700 whitespace-nowrap select-none" onClick={() => clickSort(c)}>
                        {COL_LABELS[c] ?? c}{sortKey === c ? (sortDesc ? " ↓" : " ↑") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.slice(0, 300).map((r) => (
                    <tr key={String(r.symbol)} className="border-t border-slate-100 hover:bg-emerald-50/40">
                      {cols.map((c) => (
                        <td key={c} className={`px-3 py-2 whitespace-nowrap ${c === "symbol" ? "font-semibold text-emerald-700" : c === "name" ? "max-w-56 truncate" : ""}`}>
                          {fmt(c, r[c] ?? null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer className="text-xs text-slate-400 leading-relaxed pb-8">
          Data: Yahoo Finance via yfinance — <strong>every number is unverified until checked against a company filing</strong>.
          Blank fields are excluded from screens, never treated as zero. This tool screens; it never recommends buying or selling anything.
        </footer>
      </main>
    </div>
  );
}
