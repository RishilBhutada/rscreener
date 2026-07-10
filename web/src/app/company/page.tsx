"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Row } from "@/lib/query";
import { loadNote, loadWatchlist, saveNote, toggleWatch } from "@/lib/store";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Stmt = { periods: string[]; items: { label: string; values: (number | null)[] }[] };
type AnnualReport = { from: string; to: string; url: string };
type Company = {
  generated_at: string;
  snapshot: Row;
  statements: Record<string, Stmt>;
  documents?: { annual_reports?: AnnualReport[] };
};
type ScreenData = { rows: Row[] };

const STMT_TITLES: Record<string, string> = {
  quarterly_results: "Quarterly Results",
  annual_pnl: "Profit & Loss (annual)",
  balance_sheet: "Balance Sheet",
  cash_flow: "Cash Flow",
};

function fmtNum(v: number | string | null | undefined, dec = 2): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return v.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

function periodLabel(p: string): string {
  return new Date(p).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function Bars({ title, periods, values }: { title: string; periods: string[]; values: (number | null)[] }) {
  const nums = values.map((v) => v ?? 0);
  const maxAbs = Math.max(...nums.map(Math.abs), 1);
  const W = 300, H = 130, base = 95, scale = 80 / maxAbs;
  const bw = Math.min(40, (W - 20) / values.length - 8);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-700 mb-2">{title} <span className="font-normal text-slate-400">₹Cr</span></p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1="8" y1={base} x2={W - 8} y2={base} stroke="#e2e8f0" />
        {nums.map((v, i) => {
          const x = 12 + i * ((W - 24) / values.length);
          const h = Math.abs(v) * scale;
          const y = v >= 0 ? base - h : base;
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw} height={Math.max(h, 1)} rx="2" fill={v >= 0 ? "#059669" : "#dc2626"} />
              <text x={x + bw / 2} y={H - 22} textAnchor="middle" fontSize="9" fill="#94a3b8">
                {periodLabel(periods[i]).replace(" ", "'")}
              </text>
              <text x={x + bw / 2} y={v >= 0 ? y - 4 : base + h + 10} textAnchor="middle" fontSize="8.5" fill="#475569">
                {Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function StatementTable({ title, stmt }: { title: string; stmt: Stmt }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <h2 className="px-4 py-3 text-sm font-bold text-slate-800 border-b border-slate-100">
        {title} <span className="font-normal text-slate-400">figures in ₹Cr</span>
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs text-slate-500 uppercase">
              <th className="px-3 py-2 text-left"> </th>
              {stmt.periods.map((p) => (
                <th key={p} className="px-3 py-2 text-right whitespace-nowrap">{periodLabel(p)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stmt.items.map((it) => (
              <tr key={it.label} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap">{it.label}</td>
                {it.values.map((v, i) => (
                  <td key={i} className={`px-3 py-2 text-right whitespace-nowrap ${typeof v === "number" && v < 0 ? "text-red-600" : ""}`}>
                    {fmtNum(v, it.label.includes("EPS") ? 2 : 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CompanyView() {
  const params = useSearchParams();
  const symbol = (params.get("s") ?? "").toUpperCase();
  const [company, setCompany] = useState<Company | null>(null);
  const [peers, setPeers] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [watched, setWatched] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!symbol) return;
    setWatched(loadWatchlist().includes(symbol));
    setNote(loadNote(symbol));
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    fetch(`${BASE}/companies/${symbol}.json`)
      .then((r) => { if (!r.ok) throw new Error(`no data for ${symbol}`); return r.json(); })
      .then(setCompany)
      .catch((e) => setError(String(e.message ?? e)));
  }, [symbol]);

  useEffect(() => {
    if (!company) return;
    fetch(`${BASE}/data.json`)
      .then((r) => r.json())
      .then((d: ScreenData) => {
        const ind = company.snapshot.industry;
        if (!ind) return;
        setPeers(
          d.rows
            .filter((r) => r.industry === ind && r.symbol !== company.snapshot.symbol)
            .sort((a, b) => ((b.mcap as number) ?? 0) - ((a.mcap as number) ?? 0))
            .slice(0, 8)
        );
      })
      .catch(() => { /* peers are optional */ });
  }, [company]);

  if (!symbol) return <p className="text-slate-500 p-6">No company selected. <Link className="text-emerald-700 underline" href="/">Back to screener</Link></p>;
  if (error) return <p className="text-red-600 p-6">{error} — <Link className="text-emerald-700 underline" href="/">back to screener</Link></p>;
  if (!company) return <p className="text-slate-400 p-6">Loading {symbol}…</p>;

  const s = company.snapshot;
  const annual = company.statements.annual_pnl;
  const revenue = annual?.items.find((i) => i.label === "Revenue");
  const profit = annual?.items.find((i) => i.label === "Net Profit");

  const tiles: [string, string][] = [
    ["Price", `₹${fmtNum(s.price as number)}`],
    ["Market Cap", `₹${fmtNum(s.mcap as number, 0)} Cr`],
    ["P/E", fmtNum(s.pe as number)],
    ["P/B", fmtNum(s.pb as number)],
    ["ROE", `${fmtNum(s.roe as number)}%`],
    ["Div Yield", `${fmtNum(s.div_yield as number)}%`],
    ["D/E", fmtNum(s.de as number)],
    ["Book Value", `₹${fmtNum(s.book_value as number)}`],
    ["52w High", `₹${fmtNum(s.wk52_high as number)}`],
    ["52w Low", `₹${fmtNum(s.wk52_low as number)}`],
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{String(s.name ?? symbol)} <span className="text-emerald-700">({symbol})</span></h1>
          <p className="text-sm text-slate-500">{String(s.sector ?? "—")} · {String(s.industry ?? "—")}</p>
        </div>
        <button
          onClick={() => { toggleWatch(symbol); setWatched(!watched); }}
          aria-label={watched ? "remove from watchlist" : "add to watchlist"}
          title={watched ? "On your watchlist — tap to remove" : "Add to watchlist"}
          className={`text-2xl leading-none ${watched ? "text-emerald-500" : "text-slate-300 hover:text-emerald-400"}`}
        >
          ★
        </button>
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="bg-white rounded-xl border border-slate-200 p-3">
            <p className="text-xs text-slate-400">{label}</p>
            <p className="text-base font-semibold text-slate-800">{value}</p>
          </div>
        ))}
      </section>

      {revenue && profit && annual && (
        <section className="grid sm:grid-cols-2 gap-4">
          <Bars title="Revenue" periods={annual.periods} values={revenue.values} />
          <Bars title="Net Profit" periods={annual.periods} values={profit.values} />
        </section>
      )}

      {Object.keys(company.statements).length === 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
          Financial statements haven&apos;t been fetched for this company yet — showing the snapshot only.
          Statements coverage grows as the pipeline runs.
        </div>
      )}

      {Object.entries(STMT_TITLES).map(([key, title]) =>
        company.statements[key] ? <StatementTable key={key} title={title} stmt={company.statements[key]} /> : null
      )}

      {peers.length > 0 && (
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <h2 className="px-4 py-3 text-sm font-bold text-slate-800 border-b border-slate-100">
            Peers <span className="font-normal text-slate-400">{String(s.industry)}</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500 uppercase text-left">
                  <th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2 text-right">MCap ₹Cr</th><th className="px-3 py-2 text-right">P/E</th>
                  <th className="px-3 py-2 text-right">P/B</th><th className="px-3 py-2 text-right">ROE %</th>
                  <th className="px-3 py-2 text-right">Div Yld %</th>
                </tr>
              </thead>
              <tbody>
                {peers.map((p) => (
                  <tr key={String(p.symbol)} className="border-t border-slate-100 hover:bg-emerald-50/40">
                    <td className="px-3 py-2"><Link className="font-semibold text-emerald-700" href={`/company?s=${p.symbol}`}>{String(p.symbol)}</Link></td>
                    <td className="px-3 py-2 max-w-56 truncate">{String(p.name ?? "—")}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(p.mcap as number, 0)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(p.pe as number)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(p.pb as number)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(p.roe as number)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(p.div_yield as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h2 className="text-sm font-bold text-slate-800">Documents</h2>
        {(company.documents?.annual_reports?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs text-slate-400 mb-1.5">Annual reports (PDF, straight from NSE)</p>
            <div className="flex gap-2 flex-wrap">
              {company.documents!.annual_reports!.slice(0, 18).map((ar) => (
                <a key={ar.url} href={ar.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-semibold bg-slate-100 hover:bg-emerald-50 border border-slate-200 rounded-full px-3 py-1">
                  FY{ar.from}–{String(ar.to).slice(-2)}
                </a>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-4 flex-wrap text-sm">
          <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 font-semibold hover:underline">
            All NSE filings &amp; announcements ↗
          </a>
          <a href={`https://www.screener.in/company/${encodeURIComponent(symbol)}/`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 font-semibold hover:underline">
            Cross-check on Screener.in ↗
          </a>
        </div>
        <p className="text-xs text-slate-400">Use the cross-check link before trusting any number here — this app&apos;s data is unverified.</p>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
        <h2 className="text-sm font-bold text-slate-800">Your notes</h2>
        <textarea
          value={note}
          onChange={(e) => { setNote(e.target.value); saveNote(symbol, e.target.value); }}
          rows={4}
          placeholder="Private notes in your own words — stored only on this device, never uploaded."
          className="w-full text-sm border border-slate-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      </section>

      <footer className="text-xs text-slate-400 leading-relaxed pb-8">
        Data: Yahoo Finance via yfinance, as of {company.generated_at} — <strong>every number is unverified until checked against a company filing</strong>. This tool screens; it never recommends.
      </footer>
    </div>
  );
}

export default function CompanyPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="text-sm text-emerald-700 font-semibold hover:underline">← Screener</Link>
          <span className="text-2xl font-bold text-emerald-700">Rscreener</span>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Suspense fallback={<p className="text-slate-400">Loading…</p>}>
          <CompanyView />
        </Suspense>
      </main>
    </div>
  );
}
