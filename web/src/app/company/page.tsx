"use client";

import { ExternalGlyph } from "@/components/Glyphs";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import OpeningPill from "@/components/OpeningPill";
import { listAround } from "@/lib/prefetch";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import StockChart from "@/components/StockChart";
import { loadNote, pushRecent, saveNote } from "@/lib/store";
import SeasonsCard from "@/components/Seasons";
import InstitutionsCard from "@/components/InstitutionsCard";
import InfoTip from "@/components/InfoTip";
import { Stmt } from "@/components/company/types";
import { num, withEbitda, ttmOf, trendToStmt, hasValuationHistory } from "@/components/company/format";
import { StatementTable, RatiosTable, SegmentsTable, ShareholdingTable } from "@/components/company/StatementTable";
import { PeerTable, InsiderTrades, CompoundedGrowth, HoldingTrend, FScore, ValuationHistory, RatioGrid } from "@/components/company/Sections";
import { DataChecks, CoverageNote, ProsCons, Announcements, PriceHistory, FilingLists, PriceAlerts, AboutCompany } from "@/components/company/Panels";
import { useCompanyData } from "@/components/company/useCompanyData";
import { useSwipePager } from "@/components/company/useSwipePager";
import { TabKey, useTabs, TabRow, SectionMenu } from "@/components/company/CompanyNav";
import { ListStrip, CompanyTitle, PriceLine } from "@/components/company/CompanyHeading";
import { exportCompanyXlsx } from "@/components/company/exportXlsx";

/** "26 L" holders, "4.2 K", or the plain count. */
function holdersShort(n: number): string {
  if (n >= 1e5) return `${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1)} L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)} K`;
  return String(n);
}

/** The shape of a company page, shimmering, while its data loads - instead of
 *  "Loading TCS..." on an empty screen that then jumps into a full page. */
function CompanySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="rs-skel h-8 w-3/4" />
      <div className="rs-skel h-4 w-1/2" />
      <div className="rs-skel h-10 w-2/5 !mt-6" />
      <div className="flex gap-2 !mt-6">{[0, 1, 2, 3].map((i) => <div key={i} className="rs-skel h-9 w-20" />)}</div>
      <div className="rs-skel h-80 w-full" />
    </div>
  );
}

function CompanyView() {
  const params = useSearchParams();
  const symbol = (params.get("s") ?? "").toUpperCase();
  const { company, shownSym, openName, peers, cohort, fullRow, error, nextResults } = useCompanyData(symbol);
  const [note, setNote] = useState("");

  const { mode, pager, page, panes, paneIds, sectionOrder, sectionNav, goTo } = useSwipePager(company);
  // Whether this company has an Institutions card (it loads on its own).
  const [hasInst, setHasInst] = useState(false);

  // Which tab is open; a link to a tab or to a section inside one opens it.
  const { tab, tabDir, pickTab, tabAnchor } = useTabs(company);

  useEffect(() => {
    if (!symbol) return;
    pushRecent(symbol);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from this browser's storage after mount; the prerendered page has none
    setNote(loadNote(symbol));
  }, [symbol]);

  const [alertsOpen, setAlertsOpen] = useState(false);
  // The choice belongs to the company it was made on: opening another one
  // starts on consolidated again instead of carrying "Standalone" over
  // (review 5-Nov-2026).
  const [basisPick, setBasisPick] = useState<{ sym: string; view: "consolidated" | "standalone" }>({ sym: "", view: "consolidated" });
  const basisView = basisPick.sym === symbol ? basisPick.view : "consolidated";
  const setBasisView = (view: "consolidated" | "standalone") => setBasisPick({ sym: symbol, view });

  // "Consolidated" is not a safe default: say which one this company files, and
  // say nothing rather than guess when the basis was never recorded.
  const figuresCaption =
    company?.basis === "standalone" ? "Standalone · ₹ Cr"
    : company?.basis === "consolidated" ? "Consolidated · ₹ Cr"
    : "₹ Cr";

  const exportXlsx = () => { if (company) exportCompanyXlsx(symbol, company); };

  if (!symbol) return <p className="text-[var(--ink3)] p-6">No company selected. <Link className="text-[var(--accent-ink)] underline" href="/">Back to screener</Link></p>;
  if (error) return <p className="text-[var(--neg)] p-6">{error} — <Link className="text-[var(--accent-ink)] underline" href="/">Back to screener</Link></p>;
  const opening = shownSym !== symbol;
  // Opened from a watchlist or screen results: step to the previous or next
  // company in it (M1).
  const around = typeof window === "undefined" ? null : listAround(symbol);
  const pill = opening ? <OpeningPill name={openName?.sym === symbol ? openName.name : symbol} /> : null;
  if (!company) return <>{pill}<CompanySkeleton /></>;

  const s = company.snapshot;
  const price = num(fullRow, "price") ?? num(s, "price");
  // Consolidated / Standalone (the switch shows only where both are filed).
  const hasSa = !!(company.statements.quarterly_results_sa || company.statements.annual_pnl_sa);
  const sa = hasSa && basisView === "standalone";
  const quarterly = withEbitda((sa && company.statements.quarterly_results_sa) || company.statements.quarterly_results || (company.trend?.quarterly ? trendToStmt(company.trend.quarterly) : null));
  const pnl = withEbitda((sa && company.statements.annual_pnl_sa) || company.statements.annual_pnl || (company.trend?.annual ? trendToStmt(company.trend.annual) : null));
  // The TTM column adds four quarters onto a year's table, so both must be the
  // same basis from the same source: standalone years with consolidated
  // quarters (a company filing standalone yearly only) would be a figure for
  // two different businesses in one row.
  const srcOf = (saStmt: Stmt | null | undefined, conStmt: Stmt | null | undefined, tr: unknown) =>
    sa && saStmt ? "sa" : conStmt ? "con" : tr ? "trend" : null;
  const sameBasis = srcOf(company.statements.quarterly_results_sa, company.statements.quarterly_results, company.trend?.quarterly)
    === srcOf(company.statements.annual_pnl_sa, company.statements.annual_pnl, company.trend?.annual);
  const tableCaption = sa ? "Standalone · ₹ Cr" : figuresCaption;
  const basisSwitch = hasSa ? (
    <div className="flex justify-end">
      <div className="inline-flex gap-0.5 rounded-lg bg-[var(--card2)] p-0.5 text-xs" role="radiogroup" aria-label="Figures basis">
        {([["consolidated", "Consolidated"], ["standalone", "Standalone"]] as const).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={basisView === k} onClick={() => setBasisView(k)}
            className={`rounded-md px-2.5 py-1 font-medium ${basisView === k ? "bg-[var(--card)] text-[var(--ink)] shadow-sm" : "text-[var(--ink3)]"}`}>{label}</button>
        ))}
      </div>
    </div>
  ) : null;
  const balance = company.statements.balance_sheet;
  const cashflow = company.statements.cash_flow;

  // Tabs show only when they have something in them; swipe mode keeps its
  // one-section-per-pane pager and the section menu.
  const hasHolding = Boolean(company.shareholding && company.shareholding.dates.length > 0);
  const tabHas: Record<TabKey, boolean> = {
    overview: true,
    results: Boolean(quarterly || pnl),
    accounts: Boolean(balance || cashflow || company.ratios),
    owners: hasHolding || hasInst,
    filings: true,
  };
  const activeTab: TabKey = tabHas[tab] ? tab : "overview";
  const tabbed = mode !== "swipe";
  const holders = company.shareholding?.holders_n?.filter((v): v is number => typeof v === "number").pop();
  const badge: Partial<Record<TabKey, string>> = {
    results: quarterly ? `${quarterly.periods.length}Q` : undefined,
    owners: holders ? holdersShort(holders) : undefined,
  };

  return (
    <div className={`rs-stagger space-y-6 transition-opacity duration-200 ${opening ? "opacity-35 pointer-events-none select-none" : ""}`} aria-busy={opening || undefined}>
      {pill}
      {around && (around.prev || around.next) && <ListStrip around={around} />}
      <CompanyTitle symbol={symbol} company={company} fullRow={fullRow} />
      {alertsOpen && <PriceAlerts symbol={symbol} price={price} onClose={() => setAlertsOpen(false)} />}
      <AboutCompany about={company.about} />

      <PriceLine symbol={symbol} price={price} fullRow={fullRow} s={s} onAlerts={() => setAlertsOpen(true)} onExport={exportXlsx} />

      {/* Built once: four tables share it, and they must not disagree. */}
      {tabbed ? (
        <TabRow tabHas={tabHas} activeTab={activeTab} badge={badge} onPick={pickTab} anchor={tabAnchor} />
      ) : (
        <SectionMenu navRef={sectionNav} company={company} quarterly={quarterly} pnl={pnl} balance={balance} cashflow={cashflow}
          hasInst={hasInst} sectionOrder={sectionOrder} mode={mode} goTo={goTo} panes={panes} paneIds={paneIds} page={page} />
      )}

      {/* Every section below is a child of this one div, which is the whole
          mechanism: in scroll mode it stacks them with a gap, in swipe mode CSS
          turns the same children into full-width scroll-snap panes. Nothing
          inside the sections knows which mode it is in, so a new section joins
          the pager by existing. */}
      {/* The reader's chosen sequence, applied as CSS `order` rather than by
          rearranging the elements. Reordering React's own children by hand is
          a fight it wins on the next render; `order` is a layout property it
          does not manage and cannot undo. Both modes are flex containers, so
          one rule sequences the scrolled page and the swipe panes alike. */}
      {sectionOrder.length > 0 && (
        <style>{sectionOrder.map((id, i) => `.rs-pager > #${id},.rs-stack > #${id}{order:${i}}`).join("")}</style>
      )}

      <div ref={pager} className={mode === "swipe" ? "rs-pager" : "rs-stack"} data-dir={mode === "swipe" || !tabDir ? undefined : tabDir}>

      {/* Notices sit INSIDE a section. A bare child of the pager has no id, so
          a saved section order gave it CSS order 0 and it jumped to the top,
          and in swipe mode it was a nameless pane of its own (17-Oct-2026). */}
      <div id="summary" className="scroll-mt-32 space-y-4">
        <RatioGrid snapshot={s} row={fullRow} cohort={cohort} next={nextResults} updates={company.updates} faceValue={company.face_value} />
        {Object.keys(company.statements).length === 0 && !company.trend?.annual && (
          <div className="bg-[var(--warn-soft)] border border-[var(--warn-line)] text-[var(--warn-ink)] rounded-xl p-4 text-sm">
            Financial statements haven&apos;t been fetched for this company yet — showing the snapshot only.
            Statements coverage grows as the pipeline runs.
          </div>
        )}
      </div>

      <div id="chart" className="scroll-mt-32 space-y-4">
        {company.prices && (company.prices.monthly?.length || company.prices.weekly?.length) ? (
          <>
            <StockChart prices={company.prices} peBand={company.pe_band} evBand={company.ev_band} pbBand={company.pb_band} psBand={company.ps_band} trendQ={company.trend?.quarterly} livePrice={price} quarters={company.quarters} actions={company.actions} symbol={symbol} peers={peers} coverage={company.coverage} exchange={company.exchange} balance={company.statements.balance_sheet} />
            {company.exchange !== "BSE" && (
              <CoverageNote cov={company.coverage} bandFrom={company.pe_band?.series?.[0]?.[0] ?? null} />
            )}
            <DataChecks symbol={symbol} />
          </>
        ) : null}
      {/* OUTSIDE the chart block, deliberately. This explanation used to sit
          inside `company.prices && ...`, so a BSE company with no price history
          would have shown a page of empty sections and no reason for any of
          them. Every published BSE company happens to have prices today, so
          this changes nothing on screen - it removes a coupling that would have
          hidden the explanation precisely when it was most needed. */}
      {company.exchange === "BSE" && (
        <p className="text-[13px] leading-relaxed text-[var(--ink3)] border border-[var(--line)] rounded-xl px-3 py-2 bg-[var(--card2)]">
          <span className="font-semibold text-[var(--ink2)]">Listed on BSE only{company.bse_code ? ` — scrip code ${company.bse_code}` : ""}.</span>
          <InfoTip title="Listed on BSE only" className="ml-1">
            <p>Price, market cap and the chart come from the exchange feed and are current.</p>
            <p>
              The as-filed quarterly table, the valuation bands and the shareholding pattern
              are built from NSE&rsquo;s filing archive, which does not carry companies that
              are not listed there — so those sections are absent rather than pending.
            </p>
          </InfoTip>
        </p>
      )}

      </div>

      {/* Three separate sections, not one. They were stacked inside a single
          "analysis" block, which in swipe mode made one pane three screens tall
          and in scroll mode gave the section menu one entry for three different
          questions. Each is now addressable by name. */}
      <div id="performance" className="scroll-mt-32">
        <PriceHistory row={fullRow} snapshot={s} />
      </div>

      <div id="analysis" className="scroll-mt-32 space-y-4">
        <ProsCons row={fullRow} />
        {/* 2,766 of 4,746 companies have no valuation chart and the page said
            nothing about any of them, so every one looked like a fault. None is:
            each is the app declining to publish a P/E that would not mean
            anything. An unexplained absence is indistinguishable from a bug. */}
        {company.no_pe_reason && (
          <p className="text-[13px] leading-relaxed text-[var(--ink3)] border border-[var(--line)] rounded-xl px-3 py-2 bg-[var(--card2)]">
            <span className="font-semibold text-[var(--ink2)]">No price-to-earnings chart for this company.</span>
            <InfoTip title="No price-to-earnings chart" className="ml-1">
              <p>{company.no_pe_reason}</p>
              <p>
                The chart is withheld rather than missing: a P/E built on these numbers would
                not mean anything, so none is published.
              </p>
            </InfoTip>
          </p>
        )}
      </div>

      {company.fscore && (
        <div id="checks" className="scroll-mt-32"><FScore f={company.fscore} /></div>
      )}

      {hasValuationHistory(company) && (
        <div id="valuation" className="scroll-mt-32">
          <ValuationHistory company={company} />
        </div>
      )}

      {peers.length > 0 && (
        <PeerTable symbol={symbol} self={{ ...(fullRow ?? {}), price }} peers={peers} industry={String(company.context?.peer_group ?? s.industry)} />
      )}
      {/* The caption says what the figures ACTUALLY are. It read "Consolidated"
          on every company, hardcoded, and 1,347 of the 3,198 with filed results
          file standalone - which excludes subsidiaries, so for a holding company
          the label named a different business from the one in the table. */}
      {quarterly && (
        <div id="quarters" className="scroll-mt-32 space-y-6">
          {basisSwitch}
          <StatementTable title="Quarterly results" stmt={quarterly} subtitle={tableCaption} boldRows={["Net Profit", "Net profit"]} next={nextResults} kind="quarterly" symbol={symbol}
            pdfs={sa ? undefined : quarterly.periods.map((p) => company.quarters?.find((q) => q.end === p)?.pdf ?? null)} />
          {company.segments && <SegmentsTable segs={company.segments} symbol={symbol} />}
          <SeasonsCard seasons={company.seasons} />
        </div>
      )}

      {pnl && (
        <div id="profit-loss" className="scroll-mt-32 space-y-6">
          {basisSwitch}
          <StatementTable title="Profit & loss" stmt={pnl} subtitle={tableCaption} boldRows={["Net Profit", "Net profit"]} kind="pnl" symbol={symbol} ttm={sameBasis ? ttmOf(pnl, quarterly) : null} />
          <CompoundedGrowth trend={company.trend} prices={company.prices} />
        </div>
      )}

      {balance && <div id="balance-sheet" className="scroll-mt-32"><StatementTable title="Balance sheet" stmt={balance} subtitle={figuresCaption} boldRows={["Total Assets", "Total Liabilities"]} kind="balance" symbol={symbol} /></div>}
      {cashflow && <div id="cash-flows" className="scroll-mt-32"><StatementTable title="Cash flows" stmt={cashflow} subtitle={figuresCaption} boldRows={["Free Cash Flow"]} kind="cash" symbol={symbol} /></div>}

      {company.ratios && <RatiosTable r={company.ratios} symbol={symbol} />}

      <InstitutionsCard symbol={symbol} onLoad={setHasInst} />

      {company.shareholding && company.shareholding.dates.length > 0 && (
        <div id="shareholding" className="scroll-mt-32"><ShareholdingTable sh={company.shareholding} symbol={symbol} />
          <div className="bg-[var(--card)] rounded-b-xl border border-t-0 border-[var(--line)] -mt-px">
            <HoldingTrend s={company.shareholding} />
          </div>
          {(company.insider?.length ?? 0) > 0 && <div className="mt-4"><InsiderTrades list={company.insider!} /></div>}
        </div>
      )}

      <section id="documents" className="scroll-mt-32 bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-3">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Filings
          <InfoTip title="Filings" className="ml-1.5">
            <p>
              Use the cross-check link before trusting any number here — this app&rsquo;s data
              is unverified.
            </p>
          </InfoTip>
        </h2>
        {(company.documents?.announcements?.length ?? 0) > 0 && <Announcements list={company.documents!.announcements!} />}
        <FilingLists docs={company.documents} quarters={company.quarters} />
        <div className="flex gap-4 flex-wrap text-sm">
          <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] font-semibold hover:underline">
            All NSE filings &amp; announcements <ExternalGlyph />
          </a>
          <a href={`https://www.screener.in/company/${encodeURIComponent(symbol)}/`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-ink)] font-semibold hover:underline">
            Cross-check on Screener.in <ExternalGlyph />
          </a>
        </div>
      </section>

      {/* Named, because in swipe mode an unnamed pane is only reachable by
          swiping past every other one. */}
      <section id="notes" className="scroll-mt-32 bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 space-y-2">
        <h2 className="text-sm font-bold text-[var(--ink)]">Your notes</h2>
        <textarea
          value={note}
          onChange={(e) => { setNote(e.target.value); saveNote(symbol, e.target.value); }}
          rows={4}
          placeholder="Private notes in your own words — stored only on this device, never uploaded."
          className="w-full text-sm border border-[var(--line2)] rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
      </section>

      </div>

      <footer className="text-xs text-[var(--ink3)] leading-relaxed pb-8">
        Data as of {company.generated_at}
        <InfoTip title="Where these numbers come from" className="ml-1">
          <p>Yahoo Finance via yfinance, as of {company.generated_at}.</p>
          <p>
            <strong>Every number is unverified until checked against a company filing.</strong>{" "}
            This tool screens; it never recommends.
          </p>
        </InfoTip>
      </footer>
    </div>
  );
}

export default function CompanyPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav />
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Suspense fallback={<CompanySkeleton />}>
          <CompanyView />
        </Suspense>
      </main>
    </div>
  );
}
