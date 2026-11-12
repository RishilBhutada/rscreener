"use client";

import { ExternalGlyph } from "@/components/Glyphs";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import OpeningPill from "@/components/OpeningPill";
import TabIndicator from "@/components/TabIndicator";
import { listAround, prefetchCompany } from "@/lib/prefetch";
import { loadIndex as loadSearchIndex, symbolHref } from "@/lib/index-data";
import Link from "next/link";
import { saveFile } from "@/lib/download";
import { buildXlsx, Cell, XLSX_MIME } from "@/lib/xlsx";
import TopNav from "@/components/TopNav";
import { titleCase } from "@/lib/names";
import StockChart from "@/components/StockChart";
import { Row } from "@/lib/query";
import { loadNote, pushRecent, saveNote } from "@/lib/store";
import WatchStar from "@/components/WatchStar";
import SeasonsCard from "@/components/Seasons";
import InstitutionsCard from "@/components/InstitutionsCard";
import { loadSectionMode, SectionMode } from "@/components/Settings";
import { isRefreshLoad } from "@/components/TopNav";
import { applyOrder, loadOrder } from "@/lib/order";
import InfoTip from "@/components/InfoTip";
import { IconButton, dayMove, signed as signedNum, tone } from "@/components/QuoteUI";
import { Stmt, ScreenData, Company, NextResults, Cohort } from "@/components/company/types";
import { BASE, fmtNum, num, withEbitda, ttmOf, trendToStmt, STMT_TITLES, hasValuationHistory } from "@/components/company/format";
import { StatementTable, RatiosTable, SegmentsTable, ShareholdingTable } from "@/components/company/StatementTable";
import { PeerTable, InsiderTrades, CompoundedGrowth, HoldingTrend, FScore, ValuationHistory, RatioGrid } from "@/components/company/Sections";
import { DataChecks, CoverageNote, IndexChips, PriceAsOf, ProsCons, Announcements, PriceHistory, FilingLists, CompanyMark, PriceAlerts, AboutCompany, RefetchButton } from "@/components/company/Panels";

/** The page's tabs, and the sections each one holds. Every section of the old
 *  single scroll lives in exactly one tab, so nothing is lost by the split; a
 *  link to a section (#quarters, #shareholding) opens the tab that holds it. */
type TabKey = "overview" | "results" | "accounts" | "owners" | "filings";
const TABS: { key: TabKey; label: string; sections: string[] }[] = [
  { key: "overview", label: "Overview", sections: ["summary", "chart", "performance", "analysis", "checks", "valuation", "peers"] },
  { key: "results", label: "Results", sections: ["quarters", "segments", "profit-loss"] },
  { key: "accounts", label: "Accounts", sections: ["balance-sheet", "cash-flows", "ratios"] },
  { key: "owners", label: "Owners", sections: ["institutions", "shareholding"] },
  { key: "filings", label: "Filings", sections: ["documents", "notes"] },
];
const TAB_OF: Record<string, TabKey> = Object.fromEntries(TABS.flatMap((t) => [[t.key, t.key], ...t.sections.map((id) => [id, t.key])]));

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
  const [company, setCompany] = useState<Company | null>(null);
  // The symbol whose file is in `company`. While it differs from the one asked
  // for, the new file is on its way: the old page fades behind "Opening ...".
  const [shownSym, setShownSym] = useState("");
  const [openName, setOpenName] = useState<{ sym: string; name: string } | null>(null);
  const [peers, setPeers] = useState<Row[]>([]);
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [fullRow, setFullRow] = useState<Row | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  /** Scroll down the page, or swipe between sections one at a time. Set in
   *  Settings; read here on mount and updated live when Settings changes it,
   *  so you do not have to reload the company you are already looking at.
   *  Starts at "scroll" on the server so the markup matches on hydration. */
  const [mode, setMode] = useState<SectionMode>("scroll");
  const pager = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [panes, setPanes] = useState(0);
  // The id of each pane in order, so the section nav can highlight where you
  // are. Read off the DOM rather than kept as a parallel list, which would go
  // stale the first time a section is added or made conditional.
  const [paneIds, setPaneIds] = useState<string[]>([]);
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  // Whether this company has an Institutions card (it loads on its own).
  const [hasInst, setHasInst] = useState(false);
  useEffect(() => {
    const read = () => setSectionOrder(loadOrder("sections"));
    read();
    window.addEventListener("rs-order", read);
    return () => window.removeEventListener("rs-order", read);
  }, []);

  // Which tab is open. A link to a tab (#results) or to a section inside one
  // (#quarters) opens that tab, then scrolls to the section once it is shown.
  const [tab, setTab] = useState<TabKey>("overview");
  // Which way the last tab change went, so its sections slide in from that side.
  const [tabDir, setTabDir] = useState<0 | 1 | -1>(0);
  const tabRowRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from this browser's storage after mount; the prerendered page has none
    setMode(loadSectionMode());
    const onMode = (e: Event) => setMode((e as CustomEvent).detail as SectionMode);
    window.addEventListener("rs-sections", onMode);
    return () => window.removeEventListener("rs-sections", onMode);
  }, []);

  // Which pane is in view, and how many there are. Counted from the DOM rather
  // than from a list of section names, because half the sections are
  // conditional - a BSE-only company has no quarters, P&L or shareholding, and
  // a hardcoded count would tell you "section 3 of 12" on a page with 6.
  useEffect(() => {
    const el = pager.current;
    if (!el || mode !== "swipe") { setPanes(0); return; }
    const measure = () => {
      setPanes(el.children.length);
      // VISUAL order, not DOM order. With the sections sequenced by CSS `order`
      // the two differ, and every index derived from this list - which pane the
      // menu highlights, which one a jump scrolls to - is an index into what
      // the reader sees, never into the source.
      setPaneIds(applyOrder(Array.from(el.children).map((c) => c.id), (id) => id, sectionOrder));
      setPage(el.clientWidth ? Math.round(el.scrollLeft / el.clientWidth) : 0);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    // Re-measure when the pane list itself changes. A one-shot count read 13
    // where the DOM ended up with 14, because a conditional section can mount
    // a tick after the effect runs, and the count then stayed wrong for the
    // life of the page - "section 1 of 13" on a page with fourteen. Watching
    // childList means the number corrects itself rather than depending on this
    // effect happening to run last.
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true });
    return () => {
      mo.disconnect();
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
    // `company` is a dependency because the pager does not exist until the data
    // arrives - the page renders "Loading…" first. Keyed on `mode` alone it
    // measured an element that was still null and reported "section 1 of 0".
  }, [mode, company, sectionOrder]);

  const sectionNav = useRef<HTMLElement>(null);

  // Swipe to a section and its NAME comes with you.
  //
  // The menu already highlighted the section you were on, which is no use when
  // the highlighted item is off the end of the menu's own horizontal scroll:
  // swipe to Balance Sheet and the menu still reads Summary … Peers, with the
  // highlight somewhere past the right edge. You could see where you were only
  // by scrolling a second thing.
  //
  // Scrolled by hand rather than with scrollIntoView, which reveals an element
  // by scrolling EVERY ancestor that can scroll - here that is the pager and
  // the window, so asking for a menu item would have dragged the section
  // sideways underneath it. Measured off bounding rects rather than offsetLeft,
  // which is relative to whichever ancestor happens to be positioned.
  useEffect(() => {
    if (mode !== "swipe") return;
    const nav = sectionNav.current;
    const id = paneIds[page];
    if (!nav || !id) return;
    const link = nav.querySelector<HTMLElement>(`a[href="#${CSS.escape(id)}"]`);
    if (!link) return;
    const nr = nav.getBoundingClientRect();
    const lr = link.getBoundingClientRect();
    // Centre it where there is room; the clamp inside scrollBy handles the ends.
    const delta = (lr.left - nr.left) - (nav.clientWidth - lr.width) / 2;
    if (Math.abs(delta) <= 4) return;
    // Someone who has asked their device for less motion should not be given a
    // sliding menu on every swipe; they get the same result, immediately.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollBy({ left: delta, behavior: still ? "auto" : "smooth" });
  }, [mode, page, paneIds]);

  // ONE SWIPE, ONE SECTION - driven here rather than left to the browser.
  //
  // scroll-snap-stop: always is supported and still let a single swipe cross
  // several sections in the installed app: snap decides where a scroll comes to
  // REST, and the WebView's fling had already carried it three panes by then.
  // So the horizontal gesture is taken off the browser entirely - CSS
  // touch-action: pan-y - and moved here, where a gesture can only ever commit
  // to the neighbouring section.
  //
  // The finger is tracked 1:1 during the drag, which is what makes it feel
  // attached rather than approximate, and the axis is locked on the first few
  // pixels so a vertical read never drifts sideways and a sideways swipe never
  // scrolls the page.
  useEffect(() => {
    const el = pager.current;
    if (!el || mode !== "swipe") return;

    let startX = 0, startY = 0, startScroll = 0, startIndex = 0;
    let axis: "x" | "y" | null = null;
    let lastX = 0, lastT = 0, velocity = 0, current = 0;

    const width = () => el.clientWidth || 1;

    const settle = (index: number) => {
      const n = el.children.length;
      const target = Math.max(0, Math.min(n - 1, index));
      el.scrollTo({ left: target * width(), behavior: "smooth" });
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = lastX = current = t.clientX;
      startY = t.clientY;
      startScroll = el.scrollLeft;
      startIndex = Math.round(startScroll / width());
      axis = null;
      velocity = 0;
      lastT = e.timeStamp;
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      // Lock the axis once the gesture has committed to a direction. Below the
      // threshold neither is claimed, so a tap or a tiny wobble does nothing.
      if (axis === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (axis === "y") return;   // the page scrolls; touch-action: pan-y allows it

      // Velocity over a FRAME, not between consecutive events. Touch events can
      // arrive a fraction of a millisecond apart - coalesced, or on a 120Hz
      // panel - and dividing a few pixels by that gives a number that looks
      // like a violent flick. A 40px twitch was paging the section on exactly
      // that arithmetic. Sampling no faster than one frame keeps the figure
      // honest.
      const dt = e.timeStamp - lastT;
      if (dt >= 16) {
        velocity = (t.clientX - lastX) / dt;   // px per ms, signed
        lastX = t.clientX;
        lastT = e.timeStamp;
      }
      current = t.clientX;

      // 1:1 with the finger, with resistance at the two ends so the first and
      // last sections feel like edges rather than like a broken control.
      let next = startScroll - dx;
      const max = (el.children.length - 1) * width();
      if (next < 0) next = next / 3;
      else if (next > max) next = max + (next - max) / 3;
      el.scrollLeft = next;
    };

    const onEnd = () => {
      if (axis !== "x") { axis = null; return; }
      const moved = current - startX;
      const travelled = moved / width();
      // Either a decisive flick or a third of the way across commits to the
      // next section; anything less falls back to where it started. One
      // section per gesture whichever way it was earned.
      //
      // A flick also has to have GONE somewhere - 24px at minimum. Speed alone
      // is not intent: a fast twitch while reading is not a request to change
      // section, and it was being treated as one.
      const flicked = Math.abs(velocity) > 0.35 && Math.abs(moved) > 24;
      let index = startIndex;
      if (travelled <= -0.33 || (flicked && velocity < 0)) index = startIndex + 1;
      else if (travelled >= 0.33 || (flicked && velocity > 0)) index = startIndex - 1;
      settle(index);
      axis = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [mode, paneIds]);

  // The pager is exactly as tall as the section you are looking at.
  //
  // A flex row is as tall as its tallest child, so without this the page would
  // carry the height of the longest section under every short one - the empty
  // space below Analysis would be the height of the balance sheet. Re-measured
  // when the pane changes size, because Documents grows when a year is opened.
  useEffect(() => {
    const el = pager.current;
    if (!el || mode !== "swipe") { if (el) el.style.height = ""; return; }
    const id = paneIds[page];
    const pane = id ? (Array.from(el.children).find((c) => c.id === id) as HTMLElement | undefined) : undefined;
    if (!pane) return;
    const fit = () => { el.style.height = `${pane.scrollHeight}px`; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [mode, page, paneIds]);

  const step = useCallback((d: number) => {
    const el = pager.current;
    if (!el) return;
    el.scrollBy({ left: d * el.clientWidth, behavior: "smooth" });
  }, []);

  /** Jump to a named section while in swipe mode.
   *
   *  A plain `#id` link cannot do this job here. The browser scrolls EVERY
   *  ancestor scroll container to reveal the target - the pager sideways, and
   *  the window downwards as well - and since the panes are height-capped the
   *  document is short, so the window scroll left the header stranded above a
   *  blank strip. Paging by index is exact: every pane is exactly one container
   *  wide, so pane n sits at n × clientWidth, and the window stays put.
   *
   *  Returns false if the section is not inside the pager, in which case the
   *  ordinary anchor is left to do its ordinary thing.
   */
  const goTo = useCallback((id: string) => {
    const el = pager.current;
    const target = document.getElementById(id);
    if (!el || !target) return false;
    const pane = Array.from(el.children).find((c) => c === target || c.contains(target));
    if (!pane) return false;
    const visual = applyOrder(Array.from(el.children).map((c) => c.id), (id) => id, sectionOrder);
    const i = visual.indexOf(pane.id);
    if (i < 0) return false;
    // Instant, not smooth. `scroll-snap-type: x mandatory` re-snaps to the
    // NEAREST pane whenever a smooth scroll is interrupted - and the window
    // scroll below interrupts it - so a tap on "Balance Sheet" would set off
    // towards pane 6, get 88px in, and snap straight back to pane 0. Measured:
    // scrollLeft settled at 0.079 of a pane every time. An instant jump has no
    // flight for the snapper to interrupt. It is also the better behaviour for
    // a menu tap: six panes of sideways animation is a long wait for a jump you
    // asked for by name.
    // Width can be zero when the page is laid out in a hidden container - a
    // background tab, a collapsed pane, a print view. Paging by index would
    // then compute 0 for every section and silently go nowhere, so fall back
    // to letting the browser reveal the element the ordinary way.
    if (el.clientWidth > 0) {
      el.scrollLeft = i * el.clientWidth;
    } else {
      target.scrollIntoView({ block: "nearest", inline: "start" });
    }
    (pane as HTMLElement).scrollTop = 0;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.top - 116) > 24) window.scrollBy({ top: r.top - 116, behavior: "smooth" });
    return true;
  }, [sectionOrder]);

  // Arrow keys page through it on a desktop, where there is nothing to swipe.
  useEffect(() => {
    if (mode !== "swipe") return;
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [mode, step]);

  useEffect(() => {
    if (!symbol) return;
    pushRecent(symbol);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from this browser's storage after mount; the prerendered page has none
    setNote(loadNote(symbol));
  }, [symbol]);

  // The next results meeting, from the calendar the Calendar page reads
  // (8 KB on the wire). Undefined while loading, null if NSE lists none.
  const [nextResults, setNextResults] = useState<NextResults>(undefined);
  const [alertsOpen, setAlertsOpen] = useState(false);
  // The choice belongs to the company it was made on: opening another one
  // starts on consolidated again instead of carrying "Standalone" over
  // (review 5-Nov-2026).
  const [basisPick, setBasisPick] = useState<{ sym: string; view: "consolidated" | "standalone" }>({ sym: "", view: "consolidated" });
  const basisView = basisPick.sym === symbol ? basisPick.view : "consolidated";
  const setBasisView = (view: "consolidated" | "standalone") => setBasisPick({ sym: symbol, view });
  useEffect(() => {
    if (!symbol) return;
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    fetch(`${BASE}/calendar.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cal: { events?: { symbol: string; date: string; purpose: string; kind: string; type?: string }[] } | null) => {
        if (!cal?.events) return setNextResults(undefined);
        const hit = cal.events
          .filter((e) => e.symbol === symbol && e.kind === "meeting" && e.date >= today
            && (e.type === "results" || /result/i.test(e.purpose)))
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        setNextResults(hit ? { date: hit.date, purpose: hit.purpose } : null);
      })
      .catch(() => setNextResults(undefined));
  }, [symbol]);

  useEffect(() => {
    if (!symbol) return;
    // Past the HTTP cache on the load a refresh produced - a fresh shell around
    // yesterday's company file is the staleness this button exists to end.
    // Two companies opened in quick succession: only the one asked for LAST may
    // land. Without this a slower first file could arrive second and replace it.
    let live = true;
    loadSearchIndex()
      .then((d) => { if (live) setOpenName({ sym: symbol, name: d.rows.find((r) => r.symbol === symbol)?.name || symbol }); })
      .catch(() => {});
    fetch(`${BASE}/companies/${symbol}.json`, isRefreshLoad() ? { cache: "reload" } : undefined)
      .then((r) => { if (!r.ok) throw new Error(`no data for ${symbol}`); return r.json(); })
      .then((d) => {
        if (!live) return;
        setError("");
        setCompany(d);
        setShownSym((prev) => {
          // Switched from one company to another: start the new one at its top.
          if (prev && prev !== symbol) window.scrollTo(0, 0);
          return symbol;
        });
      })
      .catch((e) => {
        if (!live) return;
        // An ETF's old company link - bookmarked, or shared before ETFs left the
        // company table on 27-Sep-2026. It has a page of its own now.
        const fail = () => setError(String(e.message ?? e));
        fetch(`${BASE}/etf/${encodeURIComponent(symbol)}.json`, { method: "HEAD" })
          .then((r) => (r.ok ? window.location.replace(`${BASE}/etf/?s=${encodeURIComponent(symbol)}`) : fail()))
          .catch(fail);
      });
    return () => { live = false; };
  }, [symbol]);

  useEffect(() => {
    if (!company) return;
    // The row, the peers and the industry context now travel INSIDE this
    // company's own file - about 3 KB of the 32 KB already downloaded. This
    // page used to fetch the whole 5.6 MB screener table and keep three things
    // from it: 99.4% of the transfer discarded, on the app's most-visited page.
    if (company.row || company.peers || company.context) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the row travels in the company file; the older-file fallback below sets the same state from a download
      setFullRow((company.row as Row) ?? null);
      setPeers((company.peers as Row[]) ?? []);
      const c = company.context;
      setCohort(c ? {
        rows: [],
        industry: c.industry ?? "",
        medians: c.medians ?? {},
        rank: c.rank ?? null,
        rankOf: c.rank_of ?? 0,
        indRank: c.ind_rank ?? null,
        indRankOf: c.ind_rank_of ?? 0,
      } : null);
      return;
    }
    // Older company files carry none of that. Rather than show a page with no
    // peers and no context, fall back to what this page used to do.
    // Guarded like the main fetch: a slow download for the company left behind
    // must not fill in the next one's row and peers (review company-page #5).
    let live = true;
    fetch(`${BASE}/data.json`)
      .then((r) => r.json())
      .then((d: ScreenData) => {
        if (!live) return;
        setFullRow(d.rows.find((r) => r.symbol === company.snapshot.symbol) ?? null);
        const ind = company.snapshot.industry;
        // No industry: no peers - not the last company's.
        if (!ind) { setPeers([]); setCohort(null); return; }
        const sameIndustry = d.rows.filter((r) => r.industry === ind);
        setPeers(
          sameIndustry
            .filter((r) => r.symbol !== company.snapshot.symbol)
            .sort((a, b) => ((b.mcap as number) ?? 0) - ((a.mcap as number) ?? 0))
            .slice(0, 8)
        );
        const withCap = d.rows.filter((r) => typeof r.mcap === "number");
        const byCap = [...withCap].sort((a, b) => (b.mcap as number) - (a.mcap as number));
        const rank = byCap.findIndex((r) => r.symbol === company.snapshot.symbol);
        const indByCap = byCap.filter((r) => r.industry === ind);
        const indRank = indByCap.findIndex((r) => r.symbol === company.snapshot.symbol);
        setCohort({
          rows: sameIndustry,
          industry: String(ind),
          medians: {},
          rank: rank >= 0 ? rank + 1 : null,
          rankOf: byCap.length,
          indRank: indRank >= 0 ? indRank + 1 : null,
          indRankOf: indByCap.length,
        });
      })
      .catch(() => { /* peers are optional */ });
    return () => { live = false; };
  }, [company]);

  // "Consolidated" is not a safe default: say which one this company files, and
  // say nothing rather than guess when the basis was never recorded.
  const figuresCaption =
    company?.basis === "standalone" ? "Standalone · ₹ Cr"
    : company?.basis === "consolidated" ? "Consolidated · ₹ Cr"
    : "₹ Cr";

  const exportCompanyXlsx = () => {
    if (!company) return;
    // One workbook, a sheet per table - screener.in's "Export to Excel".
    const sheets: { name: string; rows: Cell[][] }[] = [];
    const sheetOf = (name: string, stmt: Stmt) => sheets.push({
      name,
      rows: [["", ...stmt.periods], ...stmt.items.map((it) => [it.parent ? `  ${it.label}` : it.label, ...it.values] as Cell[])],
    });
    sheets.push({ name: "Summary", rows: [[`${symbol} - Rscreener export`, company.generated_at], [], ...Object.entries(company.snapshot).map(([k, v]) => [k, typeof v === "number" ? v : v === null || v === undefined ? "" : String(v)] as Cell[])] });
    for (const [key, title] of Object.entries(STMT_TITLES)) {
      if (company.statements[key]) sheetOf(title, company.statements[key]);
    }
    if (company.trend?.annual) sheetOf("Track record annual", trendToStmt(company.trend.annual));
    if (company.trend?.quarterly) sheetOf("Track record quarterly", trendToStmt(company.trend.quarterly));
    if (company.shareholding && company.shareholding.dates.length > 0) {
      sheetOf("Shareholding", {
        periods: company.shareholding.dates,
        items: [
          { label: "Promoters %", values: company.shareholding.promoter },
          ...(company.shareholding.fii ? [{ label: "FIIs %", values: company.shareholding.fii }] : []),
          ...(company.shareholding.dii ? [{ label: "DIIs %", values: company.shareholding.dii }] : []),
          ...(company.shareholding.mf ? [{ label: "Mutual funds %", values: company.shareholding.mf }] : []),
          { label: "Public %", values: company.shareholding.public },
          { label: "Employee trusts %", values: company.shareholding.employee },
        ],
      });
    }
    sheets.push({ name: "Notes", rows: [["Figures from free sources (NSE / BSE filings, Yahoo); unverified until checked against the company's filing."], ["Rscreener screens; it never recommends."]] });
    void saveFile(`${symbol}_rscreener.xlsx`, buildXlsx(sheets), XLSX_MIME);
  };

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
  const nseSector = (company.context?.nse_sector as string | undefined) ?? (fullRow?.["nse_sector"] as string | undefined);
  const nseBasic = (company.context?.nse_basic as string | undefined) ?? (fullRow?.["nse_basic"] as string | undefined);
  const off = num(fullRow, "off_52w_high");
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
      {around && (around.prev || around.next) && (
        <nav aria-label={`Companies in ${around.name}`} className="flex items-center gap-2 text-[12.5px]">
          {around.prev ? (
            <Link href={symbolHref(around.prev)} onPointerEnter={() => { if (symbolHref(around.prev!).startsWith("/company")) prefetchCompany(around.prev); }}
              className="rs-press inline-flex items-center gap-1 rounded-full border border-[var(--line2)] px-3 py-1.5 text-[var(--ink2)]">&lsaquo; {around.prev}</Link>
          ) : <span />}
          <span className="flex-1 text-center text-[var(--ink3)] truncate">{around.at} of {around.of} in {around.name}</span>
          {around.next ? (
            <Link href={symbolHref(around.next)} onPointerEnter={() => { if (symbolHref(around.next!).startsWith("/company")) prefetchCompany(around.next); }}
              className="rs-press inline-flex items-center gap-1 rounded-full border border-[var(--line2)] px-3 py-1.5 text-[var(--ink2)]">{around.next} &rsaquo;</Link>
          ) : <span />}
        </nav>
      )}
      {/* Name, then the ticker and where it sits on one quiet line; the
          export is an icon beside the star, not a button above the price. */}
      <div className="flex items-start gap-2">
        <CompanyMark name={String(s.name ?? symbol)} symbol={symbol} logo={company.logo} />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-[var(--ink)] leading-tight line-clamp-2">{titleCase(String(s.name ?? "")) || symbol}</h1>
          <p className="text-[13px] text-[var(--ink3)] mt-0.5">
            <span className="font-semibold text-[var(--ink2)]">{symbol}</span>
            {company.exchange ? ` · ${company.exchange}` : ""}
            {company.fno && <span className="ml-1.5 align-middle text-[10px] font-bold rounded px-1.5 py-0.5 bg-[var(--accent-soft)] text-[var(--accent-ink)]" title="Trades in NSE's futures & options segment">F&amp;O</span>}
            <IndexChips list={company.indices} />
          </p>
          {/* Sector on a line of its own, one line high: it wrapped the header
              onto four lines when it shared the ticker's line. */}
          <p className="text-[12px] text-[var(--ink3)] mt-0.5 truncate">
            {/* NSE's own sector (and basic industry) where NSE's index files
                carry it; the source's sector and industry otherwise. */}
            {nseSector ? (
              <span title="NSE's classification">{nseSector}{nseBasic ? ` · ${nseBasic}` : ""}</span>
            ) : (
              <>
                {s.sector ? (
                  <Link href={`/sectors?s=${encodeURIComponent(String(s.sector))}`} className="hover:text-[var(--accent-ink)] hover:underline">{String(s.sector)}</Link>
                ) : "—"}
                {s.industry ? ` · ${String(s.industry)}` : ""}
              </>
            )}
            {typeof s.website === "string" && /^https?:\/\//.test(s.website) && (
              <>
                {" · "}
                <a href={s.website} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--accent-ink)] hover:underline">
                  {s.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                </a>
              </>
            )}
          </p>
        </div>
      </div>
      {alertsOpen && <PriceAlerts symbol={symbol} price={price} onClose={() => setAlertsOpen(false)} />}
      <AboutCompany about={company.about} />

      {/* No price: the icons still need a home. */}
      {price === null && (
        <div className="flex justify-end">
        <div className="flex items-center gap-1 shrink-0 self-center">
          <IconButton name="bell" label="Price alerts" onClick={() => setAlertsOpen(true)} />
          <IconButton name="download" label="Export to Excel" onClick={exportCompanyXlsx} />
          <RefetchButton symbol={symbol} />
          <WatchStar symbol={symbol} />
        </div>
        </div>
      )}
      {price !== null && (() => {
        // The day's move first, as a broker shows it; the distance from the
        // year's high is the second line.
        const chg = num(fullRow, "ret_1d");
        return (
          <div>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex flex-wrap items-baseline gap-x-2.5">
                <span className="text-3xl font-bold text-[var(--ink)] tabular-nums">₹ {fmtNum(price)}</span>
                {chg !== null && (
                  <span className={`text-[15px] font-semibold tabular-nums ${tone(chg)}`}>
                    {signedNum(dayMove(price, chg))} ({signedNum(chg)}%)
                  </span>
                )}
              </div>
            <div className="ml-auto flex items-center gap-1 shrink-0 self-center">
              <IconButton name="bell" label="Price alerts" onClick={() => setAlertsOpen(true)} />
              <IconButton name="download" label="Export to Excel" onClick={exportCompanyXlsx} />
              <RefetchButton symbol={symbol} />
              <WatchStar symbol={symbol} />
            </div>
            </div>
            <p className="flex flex-wrap items-baseline gap-x-2 mt-0.5">
              {off !== null && (
                <span className={`text-xs font-medium ${off < 0 ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}>
                  {off < 0 ? "" : "+"}{off.toFixed(1)}% from 52-week high ·
                </span>
              )}
              <PriceAsOf row={fullRow} snapshot={s} />
            </p>
          </div>
        );
      })()}

      {/* Built once: four tables share it, and they must not disagree. */}
      {tabbed ? (
        <>
          <div ref={tabAnchor} aria-hidden="true" />
          <div ref={tabRowRef} role="tablist" aria-label="Company sections"
            className="sticky top-0 sm:top-14 land:!top-0 z-20 -mx-4 px-4 !mt-3 bg-[var(--card)] border-b border-[var(--line)] flex justify-between sm:justify-start gap-3 sm:gap-7 overflow-x-auto [scrollbar-width:none] text-[13px] sm:text-[14px]">
            {TABS.filter((t) => tabHas[t.key]).map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={activeTab === t.key} onClick={() => pickTab(t.key)}
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
      ) : (
      <nav ref={sectionNav} className="sticky top-0 sm:top-14 land:!top-0 z-20 -mx-4 px-4 bg-[var(--card)] border-y border-[var(--line)] flex gap-1 overflow-x-auto text-sm font-medium py-2 sm:py-1.5 [scrollbar-width:none]">
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
