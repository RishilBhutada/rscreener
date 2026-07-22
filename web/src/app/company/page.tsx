"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import StockChart from "@/components/StockChart";
import { Row } from "@/lib/query";
import { loadNote, loadWatchlist, saveNote, toggleWatch } from "@/lib/store";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Stmt = { periods: string[]; items: { label: string; values: (number | null)[] }[] };
type AnnualReport = { from: string; to: string; url: string };
type AnnDoc = { date: string; title: string; url: string };
type Trend = {
  periods: string[];
  revenue: (number | null)[];
  pat: (number | null)[];
  eps: (number | null)[];
  expenses?: (number | null)[];
  ebitda?: (number | null)[];
  book_value?: (number | null)[];
  opm?: (number | null)[];
  gpm?: (number | null)[];
  npm?: (number | null)[];
  source: string[];
};
type Shareholding = {
  dates: string[];
  promoter: (number | null)[];
  public: (number | null)[];
  employee: (number | null)[];
};
type Pt = [string, number] | [string, number, number | null];
type Prices = { monthly?: Pt[]; weekly?: Pt[]; daily?: Pt[] };
type PeBand = { series: [string, number][]; median_5y: number };
type ScreenData = { rows: Row[] };


type Company = {
  generated_at: string;
  snapshot: Row;
  statements: Record<string, Stmt>;
  documents?: { annual_reports?: AnnualReport[]; concalls?: AnnDoc[]; ratings?: AnnDoc[] };
  trend?: { annual?: Trend; quarterly?: Trend };
  shareholding?: Shareholding;
  prices?: Prices | null;
  pe_band?: PeBand | null;
  ev_band?: PeBand | null;
  pb_band?: PeBand | null;
  ps_band?: PeBand | null;
};


function trendToStmt(t: Trend): Stmt {
  const margin = t.periods.map((_, i) => {
    const r = t.revenue[i], p = t.pat[i];
    return r && p !== null && p !== undefined ? Math.round((p / r) * 1000) / 10 : null;
  });
  return {
    periods: t.periods,
    items: [
      { label: "Revenue", values: t.revenue },
      { label: "Net Profit", values: t.pat },
      { label: "EPS (Rs)", values: t.eps },
      { label: "PAT margin %", values: margin },
    ],
  };
}

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

function StatementTable({ title, stmt, subtitle, boldRows }: { title: string; stmt: Stmt; subtitle?: string; boldRows?: string[] }) {
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
      <div className="px-4 pt-3.5 pb-2">
        <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
        <p className="text-xs text-[var(--ink3)] mt-0.5">{subtitle ?? "Figures in ₹ Crores"}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
              <th className="px-3 py-2 text-left font-medium sticky left-0 bg-[var(--card)]"> </th>
              {stmt.periods.map((p) => (
                <th key={p} className="px-3 py-2 text-right font-medium whitespace-nowrap">{periodLabel(p)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stmt.items.map((it) => {
              const bold = boldRows?.includes(it.label);
              return (
                <tr key={it.label} className="border-b border-[var(--line)] hover:bg-[var(--card2)]">
                  <td className={`px-3 py-1.5 whitespace-nowrap sticky left-0 bg-[var(--card)] ${bold ? "font-semibold text-[var(--ink)]" : "text-[var(--ink2)]"}`}>{it.label}</td>
                  {it.values.map((v, i) => (
                    <td key={i} className={`px-3 py-1.5 text-right whitespace-nowrap tabular-nums ${bold ? "font-semibold" : ""} ${typeof v === "number" && v < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]"}`}>
                      {fmtNum(v, it.label.includes("EPS") || it.label.includes("%") ? 2 : 0)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function cagr(values: (number | null)[], years: number): number | null {
  const clean = values.filter((v): v is number => v !== null && v !== undefined);
  if (clean.length < years + 1) return null;
  const last = clean[clean.length - 1], start = clean[clean.length - 1 - years];
  if (!last || !start || start <= 0 || last <= 0) return null;
  return Math.round((Math.pow(last / start, 1 / years) - 1) * 100);
}

function GrowthCard({ title, rows }: { title: string; rows: [string, number | null][] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-[var(--ink2)] mb-1.5">{title}</p>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([label, v]) => (
            <tr key={label} className="border-b border-[var(--line)] last:border-0">
              <td className="py-1 text-[var(--ink3)]">{label}</td>
              <td className={`py-1 text-right font-medium tabular-nums ${v !== null && v < 0 ? "text-[var(--neg)]" : "text-[var(--ink)]"}`}>
                {v === null ? "—" : `${v}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompoundedGrowth({ trend, prices }: { trend?: { annual?: Trend }; prices?: Prices | null }) {
  const a = trend?.annual;
  if (!a) return null;
  const monthly = prices?.monthly ?? [];
  const stockCagr = (months: number): number | null => {
    if (monthly.length <= months) return null;
    const last = monthly[monthly.length - 1][1], start = monthly[monthly.length - 1 - months][1];
    if (!last || !start || start <= 0) return null;
    return Math.round((Math.pow(last / start, 12 / months) - 1) * 100);
  };
  const cards: [string, [string, number | null][]][] = [
    ["Compounded sales growth", [["10 years", cagr(a.revenue, 10)], ["5 years", cagr(a.revenue, 5)], ["3 years", cagr(a.revenue, 3)], ["1 year", cagr(a.revenue, 1)]]],
    ["Compounded profit growth", [["10 years", cagr(a.pat, 10)], ["5 years", cagr(a.pat, 5)], ["3 years", cagr(a.pat, 3)], ["1 year", cagr(a.pat, 1)]]],
    ["Stock price CAGR", [["10 years", stockCagr(120)], ["5 years", stockCagr(60)], ["3 years", stockCagr(36)], ["1 year", stockCagr(12)]]],
  ];
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 grid sm:grid-cols-3 gap-6">
      {cards.map(([title, rows]) => (
        <GrowthCard key={title} title={title} rows={rows} />
      ))}
    </section>
  );
}

function num(r: Row | null, k: string): number | null {
  const v = r?.[k];
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function ProsCons({ row }: { row: Row | null }) {
  if (!row) return null;
  const pros: string[] = [];
  const cons: string[] = [];
  const roce = num(row, "roce"), roe = num(row, "roe"), dy = num(row, "div_yield");
  const de = num(row, "de"), sg = num(row, "sales_cagr_5y"), pg = num(row, "profit_cagr_5y");
  const payout = num(row, "div_payout"), prom = num(row, "promoter_holding");
  const pe = num(row, "pe"), medpe = num(row, "median_pe_5y"), offHigh = num(row, "off_52w_high");

  if (roce !== null && roce > 20) pros.push(`Efficient use of capital — ROCE of ${roce.toFixed(0)}%.`);
  if (roe !== null && roe > 15) pros.push(`Strong return on equity of ${roe.toFixed(0)}%.`);
  if (dy !== null && dy > 2) pros.push(`Healthy dividend yield of ${dy.toFixed(1)}%.`);
  if (de !== null && de < 0.1) pros.push(`Nearly debt-free (debt-to-equity ${de.toFixed(2)}).`);
  if (pg !== null && pg > 15) pros.push(`Profit compounded at ${pg.toFixed(0)}% a year over 5 years.`);
  if (payout !== null && payout >= 20 && payout <= 80) pros.push(`Sustainable dividend payout of ${payout.toFixed(0)}%.`);

  if (sg !== null && sg < 10) cons.push(`Modest sales growth of ${sg.toFixed(0)}% a year over 5 years.`);
  if (de !== null && de > 1) cons.push(`Carries meaningful debt (debt-to-equity ${de.toFixed(1)}).`);
  if (roe !== null && roe < 10) cons.push(`Low return on equity of ${roe.toFixed(0)}%.`);
  if (pe !== null && medpe !== null && pe > medpe * 1.3) cons.push(`Trading above its 5-year median P/E (${pe.toFixed(0)} vs ${medpe.toFixed(0)}).`);
  if (prom !== null && prom < 35) cons.push(`Low promoter holding of ${prom.toFixed(0)}%.`);
  if (offHigh !== null && offHigh < -40) cons.push(`Down ${Math.abs(offHigh).toFixed(0)}% from its 52-week high.`);

  if (pros.length === 0 && cons.length === 0) return null;
  return (
    <section className="grid sm:grid-cols-2 gap-4">
      <div className="rounded-xl border border-[var(--pos)] bg-[color-mix(in_oklab,var(--pos)_8%,var(--card))] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--pos)] mb-2">Pros</p>
        <ul className="space-y-1.5 text-sm text-[var(--ink2)] list-disc pl-4">
          {pros.length ? pros.map((p) => <li key={p}>{p}</li>) : <li className="list-none text-[var(--ink3)]">No standout positives from the current numbers.</li>}
        </ul>
      </div>
      <div className="rounded-xl border border-[var(--neg)] bg-[color-mix(in_oklab,var(--neg)_8%,var(--card))] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--neg)] mb-2">Cons</p>
        <ul className="space-y-1.5 text-sm text-[var(--ink2)] list-disc pl-4">
          {cons.length ? cons.map((c) => <li key={c}>{c}</li>) : <li className="list-none text-[var(--ink3)]">No obvious red flags from the current numbers.</li>}
        </ul>
      </div>
      <p className="sm:col-span-2 text-xs text-[var(--ink3)]">These are generated from the numbers by simple rules — not analysis, and never a recommendation. Verify against the filings before trusting anything.</p>
    </section>
  );
}

function RatioGrid({ snapshot, row }: { snapshot: Row; row: Row | null }) {
  const g = (k: string) => num(row, k) ?? num(snapshot, k);
  const cells: [string, string][] = [
    ["Market Cap", `₹ ${fmtNum(g("mcap"), 0)} Cr`],
    ["Current Price", `₹ ${fmtNum(g("price"))}`],
    ["High / Low", `₹ ${fmtNum(g("wk52_high"), 0)} / ${fmtNum(g("wk52_low"), 0)}`],
    ["Stock P/E", fmtNum(g("pe"))],
    ["Book Value", `₹ ${fmtNum(g("book_value"))}`],
    ["Dividend Yield", `${fmtNum(g("div_yield"))} %`],
    ["ROCE", `${fmtNum(g("roce"))} %`],
    ["ROE", `${fmtNum(g("roe"))} %`],
    ["Sales growth 5Y", `${fmtNum(g("sales_cagr_5y"))} %`],
    ["Profit growth 5Y", `${fmtNum(g("profit_cagr_5y"))} %`],
    ["Debt / Equity", fmtNum(g("de"))],
    ["Promoter holding", `${fmtNum(g("promoter_holding"))} %`],
  ];
  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3">
        {cells.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between border-b border-[var(--line)] pb-2">
            <span className="text-sm text-[var(--ink3)]">{label}</span>
            <span className="text-sm font-semibold text-[var(--ink)] tabular-nums">{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CompanyView() {
  const params = useSearchParams();
  const symbol = (params.get("s") ?? "").toUpperCase();
  const [company, setCompany] = useState<Company | null>(null);
  const [peers, setPeers] = useState<Row[]>([]);
  const [fullRow, setFullRow] = useState<Row | null>(null);
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
        setFullRow(d.rows.find((r) => r.symbol === company.snapshot.symbol) ?? null);
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

  const exportCompanyCsv = () => {
    if (!company) return;
    const esc = (v: unknown) => {
      const sv = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(sv) ? `"${sv.replace(/"/g, '""')}"` : sv;
    };
    const lines: string[] = [`${symbol} — Rscreener export,${company.generated_at}`, ""];
    lines.push("SNAPSHOT");
    for (const [k, v] of Object.entries(company.snapshot)) lines.push(`${k},${esc(v)}`);
    const pushStmt = (title: string, stmt: Stmt) => {
      lines.push("", title.toUpperCase());
      lines.push(`,${stmt.periods.join(",")}`);
      for (const it of stmt.items) lines.push(`${esc(it.label)},${it.values.map(esc).join(",")}`);
    };
    if (company.trend?.annual) pushStmt("Track record annual", trendToStmt(company.trend.annual));
    if (company.trend?.quarterly) pushStmt("Track record quarterly", trendToStmt(company.trend.quarterly));
    for (const [key, title] of Object.entries(STMT_TITLES)) {
      if (company.statements[key]) pushStmt(title, company.statements[key]);
    }
    if (company.shareholding && company.shareholding.dates.length > 0) {
      pushStmt("Shareholding pattern", {
        periods: company.shareholding.dates,
        items: [
          { label: "Promoters %", values: company.shareholding.promoter },
          { label: "Public %", values: company.shareholding.public },
          { label: "Employee trusts %", values: company.shareholding.employee },
        ],
      });
    }
    const bom = String.fromCharCode(0xfeff);
    const blob = new Blob([bom + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${symbol}_rscreener.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!symbol) return <p className="text-[var(--ink3)] p-6">No company selected. <Link className="text-[var(--accent-ink)] underline" href="/">Back to screener</Link></p>;
  if (error) return <p className="text-[var(--neg)] p-6">{error} — <Link className="text-[var(--accent-ink)] underline" href="/">back to screener</Link></p>;
  if (!company) return <p className="text-[var(--ink3)] p-6">Loading {symbol}…</p>;

  const s = company.snapshot;
  const price = num(fullRow, "price") ?? num(s, "price");
  const off = num(fullRow, "off_52w_high");
  const quarterly = company.statements.quarterly_results ?? (company.trend?.quarterly ? trendToStmt(company.trend.quarterly) : null);
  const pnl = company.statements.annual_pnl ?? (company.trend?.annual ? trendToStmt(company.trend.annual) : null);
  const balance = company.statements.balance_sheet;
  const cashflow = company.statements.cash_flow;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">{String(s.name ?? symbol)} <span className="text-[var(--accent-ink)]">({symbol})</span></h1>
          <p className="text-sm text-[var(--ink3)]">
            {s.sector ? (
              <Link href={`/sectors?s=${encodeURIComponent(String(s.sector))}`} className="hover:text-[var(--accent-ink)] hover:underline">{String(s.sector)}</Link>
            ) : "—"}
            {" · "}{String(s.industry ?? "—")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={exportCompanyCsv}
            className="text-xs font-semibold bg-[var(--card2)] hover:bg-[var(--accent-soft)] border border-[var(--line)] rounded-lg px-3 py-1.5"
          >
            Export CSV
          </button>
          <button
            onClick={() => { toggleWatch(symbol); setWatched(!watched); }}
            aria-label={watched ? "remove from watchlist" : "add to watchlist"}
            title={watched ? "On your watchlist — tap to remove" : "Add to watchlist"}
            className={`text-2xl leading-none ${watched ? "text-[var(--accent)]" : "text-[var(--line2)] hover:text-[var(--accent)]"}`}
          >
            ★
          </button>
        </div>
      </div>

      {price !== null && (
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold text-[var(--ink)] tabular-nums">₹ {fmtNum(price)}</span>
          {off !== null && (
            <span className={`text-sm font-semibold ${off < 0 ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}>
              {off < 0 ? "" : "+"}{off.toFixed(1)}% from 52w high
            </span>
          )}
        </div>
      )}

      <nav className="sticky top-14 z-20 -mx-4 px-4 bg-[var(--card)] border-y border-[var(--line)] flex gap-1 overflow-x-auto text-sm font-medium py-1.5">
        {([
          ["summary", "Summary"], ["chart", "Chart"], ["analysis", "Analysis"], ["peers", "Peers"],
          ["quarters", "Quarters"], ["profit-loss", "Profit & Loss"], ["balance-sheet", "Balance Sheet"],
          ["cash-flows", "Cash Flow"], ["shareholding", "Investors"], ["documents", "Documents"],
        ] as [string, string][]).map(([id, label]) => (
          <a key={id} href={`#${id}`} className="px-3 py-1 rounded-lg whitespace-nowrap text-[var(--ink2)] hover:bg-[var(--card2)] hover:text-[var(--accent-ink)]">
            {label}
          </a>
        ))}
      </nav>

      <div id="summary" className="scroll-mt-32">
        <RatioGrid snapshot={s} row={fullRow} />
      </div>

      <div id="chart" className="scroll-mt-32">
        {company.prices && (company.prices.monthly?.length || company.prices.weekly?.length) ? (
          <StockChart prices={company.prices} peBand={company.pe_band} evBand={company.ev_band} pbBand={company.pb_band} psBand={company.ps_band} trendQ={company.trend?.quarterly} livePrice={price} />
        ) : null}
      </div>

      <div id="analysis" className="scroll-mt-32">
        <ProsCons row={fullRow} />
      </div>

      {peers.length > 0 && (
        <section id="peers" className="scroll-mt-32 bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
          <div className="px-4 pt-3.5 pb-2">
            <h2 className="text-base font-semibold text-[var(--ink)]">Peer comparison</h2>
            <p className="text-xs text-[var(--ink3)] mt-0.5">{String(s.industry)}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-xs text-[var(--ink3)] border-y border-[var(--line)]">
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  <th className="px-3 py-2 text-right font-medium">CMP ₹</th>
                  <th className="px-3 py-2 text-right font-medium">P/E</th>
                  <th className="px-3 py-2 text-right font-medium">MCap ₹Cr</th>
                  <th className="px-3 py-2 text-right font-medium">Div Yld %</th>
                  <th className="px-3 py-2 text-right font-medium">ROCE %</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--line)] bg-[var(--card2)]">
                  <td className="px-3 py-1.5"><span className="font-semibold text-[var(--ink)]">{symbol}</span></td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(price)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(num(fullRow, "pe"))}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(num(fullRow, "mcap"), 0)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(num(fullRow, "div_yield"))}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{fmtNum(num(fullRow, "roce"))}</td>
                </tr>
                {peers.map((p) => (
                  <tr key={String(p.symbol)} className="border-b border-[var(--line)] hover:bg-[var(--card2)]">
                    <td className="px-3 py-1.5"><Link className="font-medium text-[var(--accent-ink)] hover:underline" href={`/company?s=${p.symbol}`}>{String(p.name ?? p.symbol)}</Link></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(p.price as number)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(p.pe as number)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(p.mcap as number, 0)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(p.div_yield as number)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(p.roce as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {quarterly && <div id="quarters" className="scroll-mt-32"><StatementTable title="Quarterly results" stmt={quarterly} subtitle="Consolidated figures in ₹ Crores" boldRows={["Net Profit", "Net profit"]} /></div>}

      {pnl && (
        <div id="profit-loss" className="scroll-mt-32 space-y-6">
          <StatementTable title="Profit & loss" stmt={pnl} subtitle="Consolidated figures in ₹ Crores" boldRows={["Net Profit", "Net profit"]} />
          <CompoundedGrowth trend={company.trend} prices={company.prices} />
        </div>
      )}

      {balance && <div id="balance-sheet" className="scroll-mt-32"><StatementTable title="Balance sheet" stmt={balance} subtitle="Consolidated figures in ₹ Crores" boldRows={["Total Assets", "Total Liabilities"]} /></div>}
      {cashflow && <div id="cash-flows" className="scroll-mt-32"><StatementTable title="Cash flows" stmt={cashflow} subtitle="Consolidated figures in ₹ Crores" boldRows={["Free Cash Flow"]} /></div>}

      {Object.keys(company.statements).length === 0 && !company.trend?.annual && (
        <div className="bg-[var(--warn-soft)] border border-[var(--warn-line)] text-[var(--warn-ink)] rounded-xl p-4 text-sm">
          Financial statements haven&apos;t been fetched for this company yet — showing the snapshot only.
          Statements coverage grows as the pipeline runs.
        </div>
      )}

      {company.shareholding && company.shareholding.dates.length > 0 && (
        <div id="shareholding" className="scroll-mt-32"><StatementTable
          title="Shareholding pattern"
          subtitle="Figures in %"
          stmt={{
            periods: company.shareholding.dates,
            items: [
              { label: "Promoters %", values: company.shareholding.promoter },
              { label: "Public %", values: company.shareholding.public },
              { label: "Employee trusts %", values: company.shareholding.employee },
            ],
          }}
        /></div>
      )}

      <section id="documents" className="scroll-mt-32 bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-3">
        <h2 className="text-sm font-bold text-[var(--ink)]">Documents</h2>
        {(company.documents?.annual_reports?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs text-[var(--ink3)] mb-1.5">Annual reports (PDF, straight from NSE)</p>
            <div className="flex gap-2 flex-wrap">
              {company.documents!.annual_reports!.slice(0, 18).map((ar) => (
                <a key={ar.url} href={ar.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-semibold bg-[var(--card2)] hover:bg-[var(--accent-soft)] border border-[var(--line)] rounded-full px-3 py-1">
                  FY{ar.from}–{String(ar.to).slice(-2)}
                </a>
              ))}
            </div>
          </div>
        )}
        {(company.documents?.concalls?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs text-[var(--ink3)] mb-1.5">Concalls, transcripts &amp; investor meets (newest first)</p>
            <ul className="space-y-1">
              {company.documents!.concalls!.slice(0, 8).map((d) => (
                <li key={d.url} className="text-sm truncate">
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] hover:underline">
                    <span className="text-[var(--ink3)] font-mono text-xs mr-2">{d.date}</span>{d.title || "document"}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(company.documents?.ratings?.length ?? 0) > 0 && (
          <div>
            <p className="text-xs text-[var(--ink3)] mb-1.5">Credit-rating updates</p>
            <ul className="space-y-1">
              {company.documents!.ratings!.slice(0, 5).map((d) => (
                <li key={d.url} className="text-sm truncate">
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] hover:underline">
                    <span className="text-[var(--ink3)] font-mono text-xs mr-2">{d.date}</span>{d.title || "rating document"}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-4 flex-wrap text-sm">
          <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] font-semibold hover:underline">
            All NSE filings &amp; announcements ↗
          </a>
          <a href={`https://www.screener.in/company/${encodeURIComponent(symbol)}/`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] font-semibold hover:underline">
            Cross-check on Screener.in ↗
          </a>
        </div>
        <p className="text-xs text-[var(--ink3)]">Use the cross-check link before trusting any number here — this app&apos;s data is unverified.</p>
      </section>

      <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-2">
        <h2 className="text-sm font-bold text-[var(--ink)]">Your notes</h2>
        <textarea
          value={note}
          onChange={(e) => { setNote(e.target.value); saveNote(symbol, e.target.value); }}
          rows={4}
          placeholder="Private notes in your own words — stored only on this device, never uploaded."
          className="w-full text-sm border border-[var(--line2)] rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </section>

      <footer className="text-xs text-[var(--ink3)] leading-relaxed pb-8">
        Data: Yahoo Finance via yfinance, as of {company.generated_at} — <strong>every number is unverified until checked against a company filing</strong>. This tool screens; it never recommends.
      </footer>
    </div>
  );
}

export default function CompanyPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Suspense fallback={<p className="text-[var(--ink3)]">Loading…</p>}>
          <CompanyView />
        </Suspense>
      </main>
    </div>
  );
}
