"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Settings from "@/components/Settings";
import { loadIndex } from "@/lib/index-data";
import { BUILD_COMMIT } from "@/lib/buildinfo";
import { DESTINATIONS, BAR_SLOTS } from "@/lib/destinations";
import { applyOrder, loadOrder } from "@/lib/order";
import { previousPage, recordNavigation } from "@/lib/navdepth";
import { buildIndex, search, didYouMean, type SearchIndex, type SearchRow } from "@/lib/search";
import AccountButton from "@/components/AccountButton";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Lite = SearchRow;
let cache: Lite[] | null = null;
let indexCache: SearchIndex | null = null;

/** Fetch the app again - but only when there is something to fetch.
 *
 *  The APK is a thin shell around the live site, so an update needs no
 *  reinstall; the Android WebView simply keeps its own HTTP cache and will
 *  serve yesterday's page for a good while. location.reload() does not help,
 *  because a soft reload may come straight back out of that same cache. So this
 *  empties any cache storage and asks for the document under a URL the cache
 *  has never seen, which it cannot answer from a stored copy.
 *
 *  What it did NOT do was tell you anything. It reloaded whatever the state of
 *  things, and you were left exactly as unsure as before - which was the whole
 *  complaint that led to this button existing. It now asks first: version.json
 *  is written at build time and fetched here with the cache bypassed, so the
 *  live commit can be compared against the one baked into the running bundle.
 *
 *    they differ   there is a new version - clear the caches and load it
 *    they match    say so and stay put. A full reload to end up on the page you
 *                  were already on costs you your scroll position and every
 *                  open section, in exchange for nothing.
 *    cannot tell   reload anyway. Being unable to check is not evidence of
 *                  being current, and reloading is the safe way to be wrong.
 */
const REFRESH_MARK = "rsr";

/** True on the load that a refresh produced, so the data files are re-fetched
 *  rather than read back out of the cache the reload just went around. A fresh
 *  app shell showing yesterday's numbers is the same bug wearing a new coat. */
export function isRefreshLoad(): boolean {
  if (typeof window === "undefined") return false;
  return new URL(window.location.href).searchParams.has(REFRESH_MARK);
}

function reloadBypassingCache() {
  const go = () => {
    const u = new URL(window.location.href);
    u.searchParams.set(REFRESH_MARK, Date.now().toString(36));
    window.location.replace(u.toString());
  };
  if (typeof caches === "undefined") return go();
  caches.keys()
    .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    .catch(() => {})      // no cache storage, or blocked: reload anyway
    .then(go, go);
}

type Check = "idle" | "checking" | "current";

function RefreshButton() {
  const [state, setState] = useState<Check>("idle");

  // Take the marker out of the URL once the fresh page is running, so it is
  // never carried into a bookmark or a shared link.
  useEffect(() => {
    const u = new URL(window.location.href);
    if (!u.searchParams.has(REFRESH_MARK)) return;
    u.searchParams.delete(REFRESH_MARK);
    window.history.replaceState(null, "", u.pathname + u.search + u.hash);
  }, []);

  useEffect(() => {
    if (state !== "current") return;
    const t = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(t);
  }, [state]);

  const check = async () => {
    if (state === "checking") return;
    setState("checking");
    try {
      const r = await fetch(`${BASE}/version.json`, { cache: "no-store" });
      if (!r.ok) throw new Error("no version file");
      const live = await r.json();
      if (live?.commit && BUILD_COMMIT && live.commit !== BUILD_COMMIT) {
        reloadBypassingCache();       // a new build exists; go and get it
        return;
      }
      setState("current");            // already on it - do not disturb the page
    } catch {
      reloadBypassingCache();         // could not check; reloading is the safe error
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        onClick={check}
        disabled={state === "checking"}
        aria-label="Check for a newer version of the app"
        title="Check for a newer version"
        className="rounded-full border border-[var(--line)] bg-[var(--card2)] w-10 h-10 sm:w-8 sm:h-8
                   flex items-center justify-center text-[var(--ink2)] hover:border-[var(--line2)]
                   disabled:opacity-60"
      >
        <span aria-hidden="true"
              className={`text-base leading-none ${state === "checking" ? "animate-spin" : ""}`}>
          {state === "current" ? "✓" : "↻"}
        </span>
      </button>
      {/* The answer, where the question was asked. The old button spun for a
          moment and then navigated away, so the spinner never actually rendered
          - it was feedback in name only. */}
      {state === "current" && (
        <p role="status"
           className="absolute right-0 top-full mt-1.5 z-40 whitespace-nowrap rounded-lg border
                      border-[var(--line)] bg-[var(--card)] px-2.5 py-1.5 text-[11px]
                      text-[var(--ink2)] shadow-lg">
          You already have the latest version.
        </p>
      )}
    </div>
  );
}

/** Back, in the top left. On EVERY screen, with no exceptions.
 *
 *  It used to hide itself wherever the trail was empty, on the reasoning that an
 *  arrow with nothing behind it does nothing when tapped. That reasoning was
 *  fine and the result was not: opening the app lands you on a page that IS the
 *  start of the trail, so the arrow was missing exactly when someone first went
 *  looking for it, and deep-linking straight to a company gave a page with no
 *  way back to anything.
 *
 *  So it is always drawn, and instead every tap is given something real to do:
 *
 *    somewhere behind you   go back to it
 *    nothing behind, not home   go to the home page - which is what you want
 *                           from a page you arrived at by link
 *    nothing behind, on home    scroll to the top
 *
 *  No state where the arrow is present and inert.
 */
function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [depth, setDepth] = useState(0);
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    // Only when the URL actually changed. This effect also runs again on first
    // paint, when the Suspense boundary resolves and useSearchParams delivers -
    // which is not a navigation, and counting it as one put the trail one step
    // deep on a freshly opened page.
    const q = params.toString();
    const url = pathname + (q ? `?${q}` : "");
    if (lastUrl.current === url) return;
    lastUrl.current = url;
    setDepth(recordNavigation(url));
  }, [pathname, params]);

  const atHome = pathname === "/" || pathname === "";

  return (
    <button
      onClick={() => {
        if (depth > 0 && previousPage()) router.back();
        else if (!atHome) router.push("/");
        else window.scrollTo({ top: 0, behavior: "smooth" });
      }}
      aria-label={depth > 0 ? "Go back" : atHome ? "Back to the top" : "Go to the home page"}
      title={depth > 0 ? "Back" : atHome ? "Back to top" : "Home"}
      className="shrink-0 rounded-full border border-[var(--line)] bg-[var(--card2)]
                 w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center
                 text-[var(--ink2)] hover:border-[var(--line2)] active:scale-95 transition-transform"
    >
      <span aria-hidden="true" className="text-base leading-none">←</span>
    </button>
  );
}

export default function TopNav({ active }: { active?: "home" | "screens" | "sectors" | "calendar" | "portfolio" | "watchlists" | "ipo" | "status" }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Lite[]>([]);
  const [hi, setHi] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  // Read on mount and refreshed when Settings changes it, so the bar reorders
  // under the panel rather than after the next page load.
  const [navOrder, setNavOrder] = useState<string[]>([]);
  useEffect(() => {
    const read = () => setNavOrder(loadOrder("nav"));
    read();
    window.addEventListener("rs-order", read);
    return () => window.removeEventListener("rs-order", read);
  }, []);
  const boxRef = useRef<HTMLDivElement>(null);

  const ensureData = async () => {
    if (cache) { if (!indexCache) indexCache = buildIndex(cache); if (rows.length === 0) setRows(cache); return; }
    try {
      // index.json, not data.json: this box reads three fields and the full
      // table costs 5.6 MB.
      const d = await loadIndex();
      cache = d.rows.map((r) => ({
        symbol: r.symbol,
        name: r.name,
        mcap: r.mcap,
        exchange: r.exchange,
      }));
      indexCache = buildIndex(cache);
      setRows(cache);
    } catch { /* search silently unavailable */ }
  };

  // One shared matcher, so this box and the home page agree. The old inline
  // scorer compared the whole query against the symbol and the name as single
  // strings, so anything with a space in it could only match when the name
  // began with exactly those words: "bank baroda", "larsen toubro", "mahindra
  // mahindra" and "oil natural gas" all returned nothing at all.
  const ql = q.trim();
  const idx = rows.length && indexCache ? indexCache : null;
  const { hits: matches, total } = idx
    ? search(idx, ql, 12)
    : { hits: [] as SearchRow[], total: 0 };
  const suggestion = idx && ql.length >= 2 && matches.length === 0 ? didYouMean(idx, ql) : null;

  const go = (sym: string) => {
    setQ("");
    (document.activeElement as HTMLElement | null)?.blur();
    router.push(`/company?s=${encodeURIComponent(sym)}`);
  };

  // Which four sit in the bar is the reader's choice now, not a guess. The old
  // split - Home, Lists, Screener, Portfolio in the bar; Sectors, Calendar, IPO
  // and Data behind More - was a reasonable guess about what somebody reaches
  // for mid-task, and a wrong one for anybody who never opens a portfolio and
  // checks the results calendar every morning. Settings reorders one list; the
  // first four land in the bar and the rest fall into More.
  const ordered = applyOrder(DESTINATIONS, (d) => d.key, navOrder);
  const PRIMARY = ordered.slice(0, BAR_SLOTS);
  const SECONDARY = ordered.slice(BAR_SLOTS);

  const links: [string, string, string][] = [
    ["home", "Home", "/"],
    ["watchlists", "Watchlists", "/watchlists"],
    ["sectors", "Sectors", "/sectors"],
    ["ipo", "IPO", "/ipo"],
    ["calendar", "Calendar", "/calendar"],
    ["portfolio", "Portfolio", "/portfolio"],
    ["screens", "Screener", "/screens"],
    ["status", "Data", "/status"],
  ];

  return (
    <header className="bg-[var(--card)] border-b border-[var(--line)] sm:sticky sm:top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 h-auto sm:h-14 py-2.5 sm:py-0 flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-4">
        {/* Suspense around this one control, not the whole header. Reading the
            query string opts a component out of static prerendering, and the
            header is on every page - without this boundary the whole site would
            have had to render in the browser to draw an arrow. */}
        <Suspense fallback={null}><BackButton /></Suspense>
        <Link href="/" className="flex items-baseline gap-0.5 shrink-0">
          <span className="text-lg sm:text-xl font-bold tracking-tight text-[var(--ink)]">Rscreener</span>
          <span className="text-lg sm:text-xl font-bold text-[var(--accent)] hidden sm:inline">▮▮▮</span>
        </Link>

        <div ref={boxRef} className="relative order-last w-full sm:order-none sm:flex-1 sm:max-w-md group">
          <input
            value={q}
            onFocus={ensureData}
            onChange={(e) => { setQ(e.target.value); setHi(0); ensureData(); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHi(Math.min(hi + 1, matches.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHi(Math.max(hi - 1, 0)); }
              else if (e.key === "Enter" && matches[hi]) go(matches[hi].symbol);
              else if (e.key === "Escape") (e.target as HTMLElement).blur();
            }}
            placeholder="Search for a company"
            aria-label="Search for a company"
            className="w-full text-sm bg-[var(--card2)] border border-[var(--line)] rounded-full px-4 py-2.5 sm:py-1.5 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:bg-[var(--card)]"
          />
          {(matches.length > 0 || suggestion || (ql.trim().length >= 2 && idx)) && (
            <div className="absolute z-40 mt-1.5 w-full bg-[var(--card)] border border-[var(--line)] rounded-xl shadow-xl overflow-hidden hidden group-focus-within:block">
              {matches.map((m, i) => (
                <button
                  key={m.symbol}
                  onMouseDown={(e) => { e.preventDefault(); go(m.symbol); }}
                  onMouseEnter={() => setHi(i)}
                  className={`block w-full text-left px-4 py-2 text-sm ${i === hi ? "bg-[var(--accent-soft)]" : ""}`}
                >
                  <span className="font-semibold text-[var(--ink)]">{m.name || m.symbol}</span>
                  <span className="text-[var(--ink3)] ml-2 text-xs">{m.symbol}</span>
                  {/* Half the companies here are BSE-only now. Saying which is
                      the difference between "this page has no filings yet" and
                      "this company files nowhere this app can read". */}
                  {m.exchange === "BSE" && (
                    <span className="ml-1.5 text-[11px] rounded px-1 py-0.5 bg-[var(--card2)] text-[var(--ink3)]">BSE</span>
                  )}
                </button>
              ))}
              {/* A blank panel reads as a broken app. When nothing matches, say
                  so and offer the company he probably meant - "relaince"
                  resolves to Reliance Industries. */}
              {matches.length === 0 && (
                <div className="px-4 py-2.5 text-sm">
                  <p className="text-[var(--ink3)]">No company matches &ldquo;{ql.trim()}&rdquo;</p>
                  {suggestion && (
                    <button
                      onMouseDown={(e) => { e.preventDefault(); go(suggestion.symbol); }}
                      className="mt-1 text-left font-semibold text-[var(--accent-ink)]"
                    >
                      Did you mean {suggestion.name || suggestion.symbol}?
                    </button>
                  )}
                </div>
              )}
              {/* The old box cut silently at eight. The sectors page already
                  discloses its cap; the search box was the one place that did
                  not. */}
              {total > matches.length && (
                <p className="px-4 py-1.5 text-[11px] text-[var(--ink3)] border-t border-[var(--line)]">
                  {matches.length} of {total} companies match &mdash; keep typing to narrow it
                </p>
              )}
            </div>
          )}
        </div>

        <nav className="hidden sm:flex items-center gap-1 text-sm font-medium">
          {links.map(([key, label, href]) => (
            <Link
              key={key}
              href={href}
              className={`px-3 py-1.5 rounded-lg ${active === key ? "text-[var(--accent-ink)] bg-[var(--accent-soft)] font-semibold" : "text-[var(--ink2)] hover:bg-[var(--card2)]"}`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {/* Top right. Theme, accent and reload used to sit out here as three
            unlabelled glyphs competing with the search box for room on a
            phone. They are settings and an action you use rarely; they belong
            behind one gear, not in the permanent furniture of every page. */}
        {/* ml-auto, or the gear does not end up in the top RIGHT corner on a
            phone. The search box is `order-last w-full` there, so it drops to
            its own row and this group lands beside the wordmark on the first -
            hard against the logo on the left, which is where it sat. */}
        {/* Refresh sits back out here, beside the gear. It went into Settings on
            the argument that it is used rarely - which was wrong for an app
            whose whole delivery mechanism is "the site updated, reload it".
            Two taps behind a panel is too far for the one control that answers
            "am I looking at the current version". */}
        <div className="shrink-0 ml-auto flex items-center gap-2">
          <AccountButton />
          <RefreshButton />
          <Settings />
        </div>
      </div>

      {/* Content-sized and wrapping, NOT a fixed column count. `grid-cols-5` gave
          every link a 67px cell, which is narrower than "Other screens" — the
          label then overflowed its cell and printed straight over "Data" sitting
          beside it. Any fixed grid breaks the moment a label or the link count
          changes; letting each item take its own width cannot. */}
      {/* On a phone this was eight links wrapping into two rows at the top of
          every page - roughly 80px of chrome above the content, scrolled away
          the moment you started reading, and unreachable again without scrolling
          all the way back up. Pages here run to eight screens.

          It is now a fixed bar at the BOTTOM: five destinations, thumb-height,
          always reachable. Five and not eight because a row of eight on a 375px
          screen gives each one 47px including its label, which is a target you
          miss. The three that did not make the cut - Calendar, IPO and Data -
          are reachable from the More sheet, and none of them is somewhere you
          go mid-task. */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 border-t border-[var(--line)] bg-[var(--card)] pb-[env(safe-area-inset-bottom)]">
        {PRIMARY.map(({ key, label, href, icon }) => (
          <Link
            key={key}
            href={href}
            aria-current={active === key ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-medium ${
              active === key ? "text-[var(--accent-ink)]" : "text-[var(--ink3)]"}`}
          >
            <span aria-hidden="true" className="text-base leading-none">{icon}</span>
            {label}
          </Link>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-medium text-[var(--ink3)]"
        >
          <span aria-hidden="true" className="text-base leading-none">···</span>
          More
        </button>
      </nav>

      {moreOpen && (
        <div className="sm:hidden fixed inset-0 z-50" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute bottom-0 inset-x-0 bg-[var(--card)] rounded-t-2xl border-t border-[var(--line)] p-2 pb-[calc(env(safe-area-inset-bottom)+8px)]"
            onClick={(e) => e.stopPropagation()}
          >
            {SECONDARY.map(({ key, label, href }) => (
              <Link
                key={key}
                href={href}
                onClick={() => setMoreOpen(false)}
                className={`block px-4 min-h-[48px] flex items-center rounded-lg text-sm font-medium ${
                  active === key ? "text-[var(--accent-ink)] bg-[var(--accent-soft)]" : "text-[var(--ink2)]"}`}
              >
                {label}
              </Link>
            ))}
            <button
              onClick={() => setMoreOpen(false)}
              className="w-full px-4 min-h-[48px] text-sm font-semibold text-[var(--ink3)]"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
