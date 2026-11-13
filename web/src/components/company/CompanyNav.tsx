"use client";

/** How the company page is navigated: its tabs (and the hook that keeps the
 *  open tab in step with the URL's #hash), and the section menu of swipe mode. */

import { useEffect, useRef, useState, type RefObject } from "react";
import TabIndicator from "@/components/TabIndicator";
import { SectionMode } from "@/components/Settings";
import { Stmt, Company } from "@/components/company/types";
import { hasValuationHistory } from "@/components/company/format";

/** The page's tabs, and the sections each one holds. Every section of the old
 *  single scroll lives in exactly one tab, so nothing is lost by the split; a
 *  link to a section (#quarters, #shareholding) opens the tab that holds it. */
export type TabKey = "overview" | "results" | "accounts" | "owners" | "filings";
export const TABS: { key: TabKey; label: string; sections: string[] }[] = [
  { key: "overview", label: "Overview", sections: ["summary", "chart", "performance", "analysis", "checks", "valuation", "peers"] },
  { key: "results", label: "Results", sections: ["quarters", "segments", "profit-loss"] },
  { key: "accounts", label: "Accounts", sections: ["balance-sheet", "cash-flows", "ratios"] },
  { key: "owners", label: "Owners", sections: ["institutions", "shareholding"] },
  { key: "filings", label: "Filings", sections: ["documents", "notes"] },
];
export const TAB_OF: Record<string, TabKey> = Object.fromEntries(TABS.flatMap((t) => [[t.key, t.key], ...t.sections.map((id) => [id, t.key])]));

export function useTabs(company: unknown) {
  // Which tab is open. A link to a tab (#results) or to a section inside one
  // (#quarters) opens that tab, then scrolls to the section once it is shown.
  const [tab, setTab] = useState<TabKey>("overview");
  // Which way the last tab change went, so its sections slide in from that side.
  const [tabDir, setTabDir] = useState<0 | 1 | -1>(0);
  const tabAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const t = TAB_OF[id];
      if (!t) return;
      setTab(t);
      if (id !== t) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [company]);
  const pickTab = (k: TabKey) => {
    const from = TABS.findIndex((t) => t.key === tab), to = TABS.findIndex((t) => t.key === k);
    if (to !== from) setTabDir(to > from ? 1 : -1);
    setTab(k);
    try { window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${k}`); } catch { /* the tab still opens */ }
    // Opening a tab while scrolled down shows it from its top, under the bar.
    const a = tabAnchor.current;
    if (a) {
      const top = a.getBoundingClientRect().top + window.scrollY - (window.matchMedia("(min-width: 640px)").matches ? 56 : 0);
      if (window.scrollY > top) window.scrollTo({ top });
    }
  };

  return { tab, tabDir, pickTab, tabAnchor };
}

/** The tab row, sticky under the top bar, and the rule that hides the other tabs' sections. */
export function TabRow({ tabHas, activeTab, badge, onPick, anchor }: {
  tabHas: Record<TabKey, boolean>; activeTab: TabKey; badge: Partial<Record<TabKey, string>>;
  onPick: (k: TabKey) => void; anchor: RefObject<HTMLDivElement | null>;
}) {
  const tabRowRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={anchor} aria-hidden="true" />
      <div ref={tabRowRef} role="tablist" aria-label="Company sections"
        className="sticky top-0 sm:top-14 land:!top-0 z-20 -mx-4 px-4 !mt-3 bg-[var(--card)] border-b border-[var(--line)] flex justify-between sm:justify-start gap-3 sm:gap-7 overflow-x-auto [scrollbar-width:none] text-[13px] sm:text-[14px]">
        {TABS.filter((t) => tabHas[t.key]).map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={activeTab === t.key} onClick={() => onPick(t.key)}
            data-active={activeTab === t.key ? "true" : undefined}
            className={`shrink-0 whitespace-nowrap pt-2.5 pb-2 border-b-2 border-transparent transition-colors ${activeTab === t.key
              ? "text-[var(--ink)] font-semibold"
              : "text-[var(--ink3)] hover:text-[var(--ink2)]"}`}>
            {t.label}
            {badge[t.key] && <span className="ml-0.5 text-[10px] font-normal text-[var(--ink3)]">{badge[t.key]}</span>}
          </button>
        ))}
        <TabIndicator rowRef={tabRowRef} />
      </div>
      {/* Sections outside the open tab are hidden, not unmounted, so each
          keeps its state (a table's switches, an open row) across tabs. */}
      <style>{`${TABS.filter((t) => t.key !== activeTab).flatMap((t) => t.sections).map((id) => `.rs-stack > #${id}`).join(",")}{display:none}`}</style>
    </>
  );
}

/** Swipe mode's section menu. */
export function SectionMenu({ navRef, company, quarterly, pnl, balance, cashflow, hasInst, sectionOrder, mode, goTo, panes, paneIds, page }: {
  navRef: RefObject<HTMLElement | null>; company: Company;
  quarterly: Stmt | null; pnl: Stmt | null; balance: Stmt | null | undefined; cashflow: Stmt | null | undefined;
  hasInst: boolean; sectionOrder: string[]; mode: SectionMode; goTo: (id: string) => boolean;
  panes: number; paneIds: string[]; page: number;
}) {
  return (
    <nav ref={navRef} className="sticky top-0 sm:top-14 land:!top-0 z-20 -mx-4 px-4 bg-[var(--card)] border-y border-[var(--line)] flex gap-1 overflow-x-auto text-sm font-medium py-2 sm:py-1.5 [scrollbar-width:none]">
      {/* Built from what this company ACTUALLY has. Five of these sections are
          conditionally rendered - quarters, P&L, balance sheet, cash flow and
          shareholding all depend on data that may not exist - while the nav
          listed all ten regardless. On any of the 2,372 BSE-only companies,
          which have no NSE filings at all, half these links pointed at
          nothing: you tapped "Quarters" and the page did not move. Same on an
          NSE company missing one statement type. A menu item that goes nowhere
          is worse than an absent one, because it reads as a broken page. */}
      {([
        ["summary", "Summary", true], ["chart", "Chart", true],
        ["performance", "Price history", true],
        ["analysis", "Analysis", true],
        ["checks", "Nine checks", Boolean(company.fscore)],
        ["valuation", "Own history", hasValuationHistory(company)],
        ["peers", "Peers", true],
        ["quarters", "Quarters", Boolean(quarterly)],
        ["profit-loss", "Profit & Loss", Boolean(pnl)],
        ["balance-sheet", "Balance sheet", Boolean(balance)],
        ["cash-flows", "Cash flow", Boolean(cashflow)],
        ["ratios", "Ratios", Boolean(company.ratios)],
        ["institutions", "Institutions", hasInst],
        ["shareholding", "Investors", Boolean(company.shareholding)],
        ["documents", "Documents", true],
        ["notes", "Notes", true],
      ] as [string, string, boolean][]).filter(([, , show]) => show)
        // The menu reads in the same sequence as the page. A reader who moves
        // Quarters above Chart and then finds the menu still listing Chart
        // first has been given two different answers to the same question.
        .sort((a, b) => {
          const r = (id: string) => {
            const i = sectionOrder.indexOf(id);
            return i < 0 ? Number.MAX_SAFE_INTEGER : i;
          };
          return r(a[0]) - r(b[0]);
        })
        .map(([id, label]) => (
        <a
          key={id}
          href={`#${id}`}
          onClick={(e) => { if (mode === "swipe" && goTo(id)) e.preventDefault(); }}
          className={`px-3 py-2.5 sm:py-1 rounded-lg whitespace-nowrap hover:bg-[var(--card2)] hover:text-[var(--accent-ink)] ${
            mode === "swipe" && panes > 0 && paneIds[page] === id
              ? "text-[var(--accent-ink)] bg-[var(--accent-soft)] font-semibold"
              : "text-[var(--ink2)]"}`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
