"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Row } from "@/lib/query";
import { Holding, loadPortfolio, parseHoldings, savePortfolio } from "@/lib/portfolio";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Data = { generated_at: string; rows: Row[] };

function fmt(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-IN", { maximumFractionDigits: dec });
}

export default function PortfolioPage() {
  const [data, setData] = useState<Data | null>(null);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [importing, setImporting] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importError, setImportError] = useState("");

  useEffect(() => {
    fetch(`${BASE}/data.json`).then((r) => r.json()).then(setData).catch(() => {});
    const loaded = loadPortfolio();
    setHoldings(loaded);
    if (loaded.length === 0) setImporting(true);
  }, []);

  const bySymbol = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of data?.rows ?? []) m.set(String(r.symbol), r);
    return m;
  }, [data]);

  const enriched = useMemo(() => {
    return holdings.map((h) => {
      const row = bySymbol.get(h.symbol);
      const price = (row?.price as number) ?? null;
      const invested = h.qty * h.avg;
      const current = price !== null ? h.qty * price : null;
      return {
        ...h,
        matched: !!row,
        name: (row?.name as string) ?? "—",
        price,
        invested,
        current,
        pnl: current !== null ? current - invested : null,
        pnlPct: current !== null && invested > 0 ? ((current - invested) / invested) * 100 : null,
        pe: (row?.pe as number) ?? null,
        roce: (row?.roce as number) ?? null,
      };
    }).sort((a, b) => (b.current ?? 0) - (a.current ?? 0));
  }, [holdings, bySymbol]);

  const totals = useMemo(() => {
    const invested = enriched.reduce((s, h) => s + h.invested, 0);
    const current = enriched.reduce((s, h) => s + (h.current ?? h.invested), 0);
    return { invested, current, pnl: current - invested, pnlPct: invested > 0 ? ((current - invested) / invested) * 100 : 0 };
  }, [enriched]);

  const doImport = (text: string) => {
    const res = parseHoldings(text);
    if (res.error) { setImportError(res.error); return; }
    if (res.holdings.length === 0) { setImportError("no valid holdings rows found"); return; }
    setHoldings(res.holdings);
    savePortfolio(res.holdings);
    setImportError("");
    setImporting(false);
    setPasteText("");
  };

  const onFile = (f: File | undefined) => {
    if (!f) return;
    f.text().then(doImport).catch((e) => setImportError(String(e)));
  };

  const clearAll = () => {
    savePortfolio([]);
    setHoldings([]);
    setImporting(true);
  };

  const unmatched = enriched.filter((h) => !h.matched);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <header className="bg-[var(--card)] border-b border-[var(--line)]">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="text-sm text-[var(--accent-ink)] font-semibold hover:underline">← Screener</Link>
          <span className="text-2xl font-bold text-[var(--accent-ink)]">Rscreener</span>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-lg font-bold text-[var(--ink)]">Portfolio</h1>
          <div className="flex gap-2">
            <button onClick={() => setImporting(!importing)} className="text-xs font-semibold bg-[var(--card2)] hover:bg-[var(--accent-soft)] border border-[var(--line)] rounded-lg px-3 py-1.5">
              {importing ? "Hide import" : "Import / update"}
            </button>
            {holdings.length > 0 && (
              <button onClick={clearAll} className="text-xs font-semibold bg-[var(--card2)] hover:bg-[var(--neg-soft)] border border-[var(--line)] rounded-lg px-3 py-1.5 text-[var(--ink2)]">
                Clear
              </button>
            )}
          </div>
        </div>

        {importing && (
          <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-3">
            <p className="text-sm text-[var(--ink2)]">
              Export your holdings from <strong>Zerodha Console</strong> (Portfolio → Holdings → Download CSV),
              <strong> Angel One</strong> (Portfolio → Holdings → export) or <strong>Groww</strong> (Holdings statement),
              then upload the file or paste its contents. Your holdings <strong>never leave this device</strong> —
              they are stored only in this browser.
            </p>
            <input
              type="file"
              accept=".csv,.txt"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="block text-sm text-[var(--ink3)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--accent)] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:opacity-90"
            />
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={5}
              placeholder={"…or paste CSV text here, e.g.\nSymbol,Quantity Available,Average Price\nRELIANCE,10,2450.50\nTCS,5,3300"}
              className="w-full font-mono text-xs border border-[var(--line2)] rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <div className="flex items-center gap-3">
              <button onClick={() => doImport(pasteText)} disabled={!pasteText.trim()} className="bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:opacity-40 text-white text-sm font-semibold px-5 py-2 rounded-lg">
                Parse &amp; save
              </button>
              {importError && <p className="text-sm text-[var(--neg)]">{importError}</p>}
            </div>
          </section>
        )}

        {holdings.length > 0 && (
          <>
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ["Invested", `₹${fmt(totals.invested, 0)}`],
                ["Current value", `₹${fmt(totals.current, 0)}`],
                ["P&L", `₹${fmt(totals.pnl, 0)}`],
                ["P&L %", `${fmt(totals.pnlPct)}%`],
              ].map(([label, value]) => (
                <div key={label} className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-3">
                  <p className="text-xs text-[var(--ink3)]">{label}</p>
                  <p className={`text-base font-semibold ${label.startsWith("P&L") ? (totals.pnl >= 0 ? "text-[var(--pos)]" : "text-[var(--neg)]") : "text-[var(--ink)]"}`}>{value}</p>
                </div>
              ))}
            </section>

            <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[var(--card2)] text-xs text-[var(--ink3)] uppercase text-left">
                      <th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Avg ₹</th>
                      <th className="px-3 py-2 text-right">Price ₹</th><th className="px-3 py-2 text-right">Invested ₹</th>
                      <th className="px-3 py-2 text-right">Current ₹</th><th className="px-3 py-2 text-right">P&amp;L ₹</th>
                      <th className="px-3 py-2 text-right">P&amp;L %</th><th className="px-3 py-2 text-right">Weight %</th>
                      <th className="px-3 py-2 text-right">P/E</th><th className="px-3 py-2 text-right">ROCE %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enriched.map((h) => (
                      <tr key={h.symbol} className="border-t border-[var(--line)] hover:bg-[var(--accent-soft)]">
                        <td className="px-3 py-2">
                          {h.matched ? (
                            <Link href={`/company?s=${h.symbol}`} className="font-semibold text-[var(--accent-ink)] hover:underline">{h.symbol}</Link>
                          ) : (
                            <span className="font-semibold text-[var(--ink3)]" title="not found in the NSE universe">{h.symbol}?</span>
                          )}
                        </td>
                        <td className="px-3 py-2 max-w-48 truncate">{h.name}</td>
                        <td className="px-3 py-2 text-right">{fmt(h.qty, 0)}</td>
                        <td className="px-3 py-2 text-right">{fmt(h.avg)}</td>
                        <td className="px-3 py-2 text-right">{fmt(h.price)}</td>
                        <td className="px-3 py-2 text-right">{fmt(h.invested, 0)}</td>
                        <td className="px-3 py-2 text-right">{fmt(h.current, 0)}</td>
                        <td className={`px-3 py-2 text-right ${h.pnl !== null && h.pnl < 0 ? "text-[var(--neg)]" : "text-[var(--accent-ink)]"}`}>{fmt(h.pnl, 0)}</td>
                        <td className={`px-3 py-2 text-right ${h.pnlPct !== null && h.pnlPct < 0 ? "text-[var(--neg)]" : "text-[var(--accent-ink)]"}`}>{fmt(h.pnlPct)}</td>
                        <td className="px-3 py-2 text-right">{totals.current > 0 && h.current !== null ? fmt((h.current / totals.current) * 100, 1) : "—"}</td>
                        <td className="px-3 py-2 text-right">{fmt(h.pe)}</td>
                        <td className="px-3 py-2 text-right">{fmt(h.roce)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {unmatched.length > 0 && (
              <p className="text-xs text-[var(--warn-ink)]">
                {unmatched.length} symbol(s) not found in the NSE universe (BSE-only, delisted, or renamed): {unmatched.map((h) => h.symbol).join(", ")}
              </p>
            )}
          </>
        )}

        <footer className="text-xs text-[var(--ink3)] leading-relaxed pb-8">
          Read-only mirror of what you already own — prices refresh with the site&apos;s nightly data, values are unverified,
          and nothing here is a recommendation to buy, sell or hold anything.
        </footer>
      </main>
    </div>
  );
}
