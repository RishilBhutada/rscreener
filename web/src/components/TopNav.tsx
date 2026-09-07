"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Settings from "@/components/Settings";
import { loadIndex } from "@/lib/index-data";
import { BUILD_COMMIT, BUILD_SUBJECT, BUILD_TIME } from "@/lib/buildinfo";
import { DESTINATIONS, BAR_SLOTS } from "@/lib/destinations";
import { applyOrder, loadOrder } from "@/lib/order";
import { previousPage, recordNavigation } from "@/lib/navdepth";
import { buildIndex, search, didYouMean, type SearchIndex, type SearchRow } from "@/lib/search";
import AccountButton from "@/components/AccountButton";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Lite = SearchRow;
let cache: Lite[] | null = null;
let indexCache: SearchIndex | null = null;

/** Drawn icons, not typed ones.
 *
 *  The header used text characters - an arrow, a gear, a circular arrow taken
 *  straight from the font. They look cheap because they ARE cheap: a glyph is
 *  drawn by whichever font the device falls back to, at whatever weight that
 *  font gives it, so the arrow came out hairline next to a heavier gear and
 *  neither matched the other. On some Android builds the gear renders in colour
 *  as an emoji.
 *
 *  These are paths instead: one stroke weight, one corner radius, one size, and
 *  they inherit the text colour so the theme still drives them. Stroke width is
 *  1.75 rather than a round 2 because at 18px a 2px stroke closes up the inside
 *  of the arrowhead.
 */
/** The shared treatment for a header control.
 *
 *  No border and no filled circle. Three outlined pills in a row was the thing
 *  that read as cheap: it is a lot of chrome around a small mark, and it makes
 *  each icon look timid inside a box far bigger than itself. The tap target is
 *  the same 40px it always was - it is just no longer drawn as furniture. The
 *  background appears on hover and press, so the control still answers when you
 *  touch it.
 */
const CONTROL = "shrink-0 rounded-full w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center " +
  "text-[var(--ink2)] hover:text-[var(--ink)] hover:bg-[var(--card2)] " +
  "active:bg-[var(--line)] active:scale-95 transition-all duration-150";

function Icon({ children, size = 20, className = "" }: {
  children: React.ReactNode; size?: number; className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

/** A shaft as well as a head. A bare chevron is the commonest way to draw this
 *  and it reads as "previous item in a carousel"; an arrow with a shaft reads as
 *  "go back", which is what the control does. */
const ArrowLeft = ({ size }: { size?: number }) => (
  <Icon size={size}><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></Icon>
);

/** An open circle with a head, not a closed loop: the gap is what says this
 *  turns once on demand rather than spinning forever.
 *
 *  The first version drew the arc from a single sweep and hung a right-angled
 *  corner off it, which at this size reads as a tick that missed rather than an
 *  arrow. This one ends the arc where the head begins and draws the head as two
 *  strokes meeting at the arc's own tangent, so it points along the direction of
 *  travel instead of across it. The gap sits at the top right, where the eye
 *  starts, so the direction is legible before the shape is.
 */
const Rotate = ({ size, className }: { size?: number; className?: string }) => (
  <Icon size={size} className={className}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4.5V10h-5.5" />
  </Icon>
);

const Check = ({ size }: { size?: number }) => (
  <Icon size={size}><path d="m4.5 12.5 5 5 10-11" /></Icon>
);

/** Six lobes and a hub. Eight is the usual choice and turns to mush below 20px;
 *  six keeps daylight between the teeth at the 18px this renders at. */
const Gear = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M10.3 3.4a1 1 0 0 1 1-.85h1.4a1 1 0 0 1 1 .85l.2 1.35c.55.19 1.06.48 1.5.85l1.3-.5a1 1 0 0 1 1.2.44l.7 1.2a1 1 0 0 1-.2 1.25l-1.05.87c.06.29.09.6.09.91s-.03.62-.09.91l1.05.87a1 1 0 0 1 .2 1.25l-.7 1.2a1 1 0 0 1-1.2.44l-1.3-.5c-.44.37-.95.66-1.5.85l-.2 1.35a1 1 0 0 1-1 .85h-1.4a1 1 0 0 1-1-.85l-.2-1.35a5.6 5.6 0 0 1-1.5-.85l-1.3.5a1 1 0 0 1-1.2-.44l-.7-1.2a1 1 0 0 1 .2-1.25l1.05-.87a5.5 5.5 0 0 1 0-1.82l-1.05-.87a1 1 0 0 1-.2-1.25l.7-1.2a1 1 0 0 1 1.2-.44l1.3.5c.44-.37.95-.66 1.5-.85z" />
    <circle cx="12" cy="12" r="2.5" />
  </Icon>
);

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

type Version = { commit?: string; built?: string; subject?: string };
type Check = "idle" | "checking" | "current";

/** When a build was made, written the way a person says it. */
function whenBuilt(iso?: string): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  const stamp = d.toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  if (mins < 1) return `just now — ${stamp}`;
  if (mins < 60) return `${mins} min ago — ${stamp}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago — ${stamp}`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago — ${stamp}`;
}

function RefreshButton() {
  const [state, setState] = useState<Check>("idle");
  // Long-press opens the record rather than acting: what change you are
  // running, when it was made, and whether anything newer has been published.
  // A tap asks the app to move; a hold asks it to explain itself.
  const [details, setDetails] = useState(false);
  const [live, setLive] = useState<Version | null>(null);
  const [liveError, setLiveError] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

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

  const fetchLive = async (): Promise<Version | null> => {
    try {
      const r = await fetch(`${BASE}/version.json`, { cache: "no-store" });
      if (!r.ok) throw new Error("no version file");
      const v: Version = await r.json();
      setLive(v);
      setLiveError(false);
      return v;
    } catch {
      setLiveError(true);
      return null;
    }
  };

  const check = async () => {
    if (state === "checking") return;
    setState("checking");
    const v = await fetchLive();
    if (!v) return reloadBypassingCache();   // cannot check; reloading is the safe error
    if (v.commit && BUILD_COMMIT && v.commit !== BUILD_COMMIT) return reloadBypassingCache();
    setState("current");                     // already on it - do not disturb the page
  };

  const startHold = () => {
    held.current = false;
    holdTimer.current = setTimeout(() => {
      held.current = true;
      setDetails(true);
      fetchLive();
    }, 450);
  };
  const endHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const behind = !!(live?.commit && BUILD_COMMIT && live.commit !== BUILD_COMMIT);

  return (
    <div className="relative shrink-0">
      <button
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerLeave={endHold}
        onPointerCancel={endHold}
        // A hold has already done its job; letting the click through as well
        // would check for updates behind the panel it just opened.
        onClick={() => { if (held.current) { held.current = false; return; } check(); }}
        onContextMenu={(e) => { e.preventDefault(); setDetails(true); fetchLive(); }}
        disabled={state === "checking"}
        aria-label="Check for a newer version. Press and hold to see what changed."
        title="Tap to check for a newer version · hold to see what changed"
        className={`select-none touch-none ${CONTROL} disabled:opacity-60`}
      >
        {state === "current"
          ? <Check />
          : <Rotate className={state === "checking" ? "animate-spin" : ""} />}
      </button>

      {state === "current" && !details && (
        <p role="status"
           className="absolute right-0 top-full mt-1.5 z-40 whitespace-nowrap rounded-lg border
                      border-[var(--line)] bg-[var(--card)] px-2.5 py-1.5 text-[11px]
                      text-[var(--ink2)] shadow-lg">
          You already have the latest version.
        </p>
      )}

      {details && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDetails(false)} />
          <div role="dialog" aria-label="What changed"
               className="absolute right-0 top-full mt-1.5 z-50 w-[min(20rem,calc(100vw-2rem))]
                          rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 shadow-xl">
            <p className="text-[11px] uppercase tracking-wide text-[var(--ink3)]">
              The change you are running
            </p>
            <p className="mt-0.5 text-[13px] leading-snug text-[var(--ink)]">
              {BUILD_SUBJECT || "unknown"}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-[var(--ink3)] tabular-nums">
              made {whenBuilt(BUILD_TIME)}
              {BUILD_COMMIT ? ` · ${BUILD_COMMIT}` : ""}
            </p>

            <div className="mt-2.5 pt-2.5 border-t border-[var(--line)]">
              {liveError ? (
                <p className="text-[11px] text-[var(--ink3)]">
                  Could not reach the site to ask what the newest change is.
                </p>
              ) : !live ? (
                <p className="text-[11px] text-[var(--ink3)]">Asking the site…</p>
              ) : behind ? (
                <>
                  <p className="text-[11px] uppercase tracking-wide text-[var(--ink3)]">
                    Newer change published
                  </p>
                  <p className="mt-0.5 text-[13px] leading-snug text-[var(--ink)]">{live.subject}</p>
                  <p className="mt-1 text-[11px] text-[var(--ink3)] tabular-nums">
                    made {whenBuilt(live.built)}{live.commit ? ` · ${live.commit}` : ""}
                  </p>
                  <button
                    onClick={reloadBypassingCache}
                    className="mt-2 w-full min-h-[40px] rounded-lg bg-[var(--accent-soft)]
                               border border-[var(--accent-line)] text-[var(--accent-ink)]
                               text-sm font-semibold"
                  >
                    Get it now
                  </button>
                </>
              ) : (
                <p className="text-[11px] text-[var(--ink3)]">
                  This is the newest change published. Nothing to update.
                </p>
              )}
            </div>

            <p className="mt-2 text-[11px] text-[var(--ink3)]">
              Company figures are refreshed separately —{" "}
              <a href={`${BASE}/status/`} className="text-[var(--accent-ink)] font-semibold">
                see the Data page
              </a>.
            </p>
          </div>
        </>
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
      className={CONTROL}
    >
      <ArrowLeft />
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
