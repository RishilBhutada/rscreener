"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BUILD_TIME, BUILD_COMMIT, BUILD_SUBJECT } from "@/lib/buildinfo";
import { DESTINATIONS, BAR_SLOTS } from "@/lib/destinations";
import { applyOrder, clearOrder, loadOrder, move, saveOrder, OrderKind } from "@/lib/order";
import { reloadBypassingCache } from "@/lib/reload";
import { Glyph, Group, PageTitle, Row, Segmented } from "@/components/ListUI";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Settings is a page, not a panel.
 *
 *  It used to slide in from the side over whatever you were reading: one long
 *  column of headings, hints and two fold-out lists, the version at the very
 *  bottom. It is now a full screen laid out the way a phone's own settings
 *  are - grouped by what each setting is about, one row per setting, the
 *  control on the row itself, and the two long reordering lists on screens of
 *  their own a tap away. The gear in the header is a link to it.
 */

/** The company page's sections, in the order they are written. Every one that
 *  can appear is listed, so a saved order always names them all and none can
 *  fall to the end because the list forgot it existed. A company missing a
 *  section simply does not render it; the order still knows where it would go. */
const SECTIONS: { id: string; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "chart", label: "Chart" },
  { id: "performance", label: "Price history" },
  { id: "analysis", label: "Analysis" },
  { id: "checks", label: "Nine checks" },
  { id: "valuation", label: "Own history" },
  { id: "peers", label: "Peers" },
  { id: "quarters", label: "Quarters" },
  { id: "profit-loss", label: "Profit & Loss" },
  { id: "balance-sheet", label: "Balance sheet" },
  { id: "cash-flows", label: "Cash flow" },
  { id: "ratios", label: "Ratios" },
  { id: "shareholding", label: "Investors" },
  { id: "documents", label: "Documents" },
  { id: "notes", label: "Your notes" },
];

const THEMES = [["light", "Light"], ["dark", "Dark"], ["black", "Black"], ["system", "Auto"]] as const;
const LAYOUTS = [["scroll", "Scroll"], ["swipe", "Swipe"]] as const;

const ACCENTS = ["mono", "indigo", "emerald", "rose", "amber"] as const;

/** Taken from globals.css, both themes - the swatch has to be the colour the
 *  app will actually paint, and the dark theme uses lighter accents. */
const ACCENT_DOT: Record<string, { light: string; dark: string }> = {
  mono: { light: "#27272a", dark: "#e4e4e7" },
  emerald: { light: "#059669", dark: "#10b981" },
  indigo: { light: "#5a4fca", dark: "#818cf8" },
  rose: { light: "#e11d48", dark: "#fb7185" },
  amber: { light: "#d97706", dark: "#fbbf24" },
};

const ICON = {
  theme: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  accent: "M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.7 12 3.5 12 3.5z",
  layout: "M4 5.5h16v13H4zM12 5.5v13",
  order: "M9 6.5h11M9 12h11M9 17.5h11M4 6.5h1.5M4 12h1.5M4 17.5h1.5",
  bar: "M7.5 3h9A1.5 1.5 0 0 1 18 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3zM6 16.5h12",
  status: "M3 12.5h4l2.5-6 5 11 2.5-5H21",
  update: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5V9H15",
  version: "M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 0 0 0-17zM12 11v5.5M12 7.8v.01",
  change: "M3.5 12h5M15.5 12h5M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 0 0 0-7z",
};

export type SectionMode = "scroll" | "swipe";

export function loadSectionMode(): SectionMode {
  if (typeof window === "undefined") return "scroll";
  return localStorage.getItem("rs_sections") === "swipe" ? "swipe" : "scroll";
}

function apply(theme: string, accent: string) {
  const d = document.documentElement;
  const dark = theme === "dark" || theme === "black" || (theme === "system" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches);
  d.dataset.theme = dark ? "dark" : "light";
  // Black is the dark theme with its surfaces replaced, so it keeps every dark
  // rule and adds one attribute - see globals.css.
  if (theme === "black") d.dataset.shade = "black";
  else delete d.dataset.shade;
  d.dataset.accent = accent;
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "black" ? "#000000" : dark ? "#0b1017" : "#f5f6f8");
}

/** The surfaces of each theme, for the preview tiles. Copied from globals.css
 *  so each tile shows the theme it selects rather than a picture of one. */
const PREVIEW: Record<string, { bg: string; card: string; line: string; ink: string }> = {
  light: { bg: "#f5f6f8", card: "#ffffff", line: "#e5e8ee", ink: "#0f1729" },
  dark: { bg: "#0b1017", card: "#121924", line: "#223048", ink: "#e8edf5" },
  black: { bg: "#000000", card: "#0b0b0b", line: "#262626", ink: "#f5f5f5" },
};

function Mini({ p, accent }: { p: { bg: string; card: string; line: string; ink: string }; accent: string }) {
  return (
    <span className="absolute inset-0 p-1.5 flex flex-col gap-1" style={{ background: p.bg }}>
      <span className="block h-1 w-1/2 rounded-full" style={{ background: p.ink, opacity: 0.8 }} />
      <span className="flex-1 rounded-[5px] border p-1 flex flex-col gap-1" style={{ background: p.card, borderColor: p.line }}>
        <span className="block h-1 w-2/3 rounded-full" style={{ background: accent }} />
        <span className="block h-1 w-full rounded-full" style={{ background: p.line }} />
        <span className="block h-1 w-3/4 rounded-full" style={{ background: p.line }} />
      </span>
    </span>
  );
}

/** Theme as four small pictures of the app rather than four words - the way a
 *  phone's own display settings offer it, and the only way to show the
 *  difference between Dark and Black before choosing. */
function ThemePicker({ value, accent, onChange }: { value: string; accent: string; onChange: (t: string) => void }) {
  const dot = (dark: boolean) => (ACCENT_DOT[accent] ?? ACCENT_DOT.indigo)[dark ? "dark" : "light"];
  return (
    <div className="px-4 pt-3.5 pb-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-8 h-8 rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent-ink)] flex items-center justify-center shrink-0">
          <Glyph d={ICON.theme} />
        </span>
        <span className="text-[15px] font-medium text-[var(--ink)]">Theme</span>
      </div>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-4 gap-2.5">
        {THEMES.map(([id, label]) => {
          const on = value === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={on} onClick={() => onChange(id)}
              className="rs-press flex flex-col items-center gap-1.5">
              <span className={`relative block w-full aspect-[3/4] rounded-xl overflow-hidden border transition-shadow duration-200 ${
                on ? "border-transparent ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--card)]" : "border-[var(--line2)]"}`}>
                {id === "system" ? (
                  <>
                    <Mini p={PREVIEW.light} accent={dot(false)} />
                    <span className="absolute inset-0" style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}>
                      <Mini p={PREVIEW.dark} accent={dot(true)} />
                    </span>
                  </>
                ) : (
                  <Mini p={PREVIEW[id]} accent={dot(id !== "light")} />
                )}
              </span>
              <span className={`text-xs ${on ? "text-[var(--ink)] font-semibold" : "text-[var(--ink3)] font-medium"}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The gear in the header. A link to the Settings page, lit while you are on it. */
export default function SettingsButton() {
  const pathname = usePathname();
  const on = !!pathname?.startsWith("/settings");
  return (
    <Link
      href="/settings"
      aria-label="Settings"
      title="Settings"
      aria-current={on ? "page" : undefined}
      className={`shrink-0 rounded-full w-10 h-10 sm:w-9 sm:h-9 flex items-center justify-center
                  hover:text-[var(--ink)] hover:bg-[var(--card2)] active:bg-[var(--line)] active:scale-95
                  transition-all duration-150 ${on ? "text-[var(--accent-ink)] bg-[var(--accent-soft)]" : "text-[var(--ink2)]"}`}
    >
      {/* Drawn, to match the arrow and the refresh beside it. As a text
          glyph this rendered as a colour emoji on some Android builds. */}
      <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor"
           strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.3 3.4a1 1 0 0 1 1-.85h1.4a1 1 0 0 1 1 .85l.2 1.35c.55.19 1.06.48 1.5.85l1.3-.5a1 1 0 0 1 1.2.44l.7 1.2a1 1 0 0 1-.2 1.25l-1.05.87c.06.29.09.6.09.91s-.03.62-.09.91l1.05.87a1 1 0 0 1 .2 1.25l-.7 1.2a1 1 0 0 1-1.2.44l-1.3-.5c-.44.37-.95.66-1.5.85l-.2 1.35a1 1 0 0 1-1 .85h-1.4a1 1 0 0 1-1-.85l-.2-1.35a5.6 5.6 0 0 1-1.5-.85l-1.3.5a1 1 0 0 1-1.2-.44l-.7-1.2a1 1 0 0 1 .2-1.25l1.05-.87a5.5 5.5 0 0 1 0-1.82l-1.05-.87a1 1 0 0 1-.2-1.25l.7-1.2a1 1 0 0 1 1.2-.44l1.3.5c.44-.37.95-.66 1.5-.85z" />
        <circle cx="12" cy="12" r="2.5" />
      </svg>
    </Link>
  );
}

/** The whole Settings screen. `?p=nav` and `?p=sections` are its two
 *  sub-screens - query strings rather than routes, because the site is a
 *  static export, and they still give the back arrow a page to return to. */
export function SettingsScreen() {
  const p = useSearchParams().get("p");
  if (p === "nav") {
    return (
      <ReorderScreen
        kind="nav"
        title="Bottom bar"
        caption={`The first ${BAR_SLOTS} sit in the bar at the bottom of the screen. The rest are under More.`}
        items={DESTINATIONS.map((d) => ({ id: d.key, label: d.label, icon: d.icon }))}
        split={BAR_SLOTS}
      />
    );
  }
  if (p === "sections") {
    return (
      <ReorderScreen
        kind="sections"
        title="Section order"
        caption="The order of a company page, whether you scroll or swipe. The section menu follows it."
        items={SECTIONS}
      />
    );
  }
  return <MainScreen />;
}

function MainScreen() {
  const [theme, setTheme] = useState("system");
  const [accent, setAccent] = useState("indigo");
  const [sections, setSections] = useState<SectionMode>("scroll");
  const [isDark, setIsDark] = useState(false);
  const [navOrder, setNavOrder] = useState<string[]>([]);
  const [secOrder, setSecOrder] = useState<string[]>([]);
  const [upd, setUpd] = useState<"idle" | "checking" | "current" | "error">("idle");

  useEffect(() => {
    setTheme(localStorage.getItem("rs_theme") || "system");
    setAccent(localStorage.getItem("rs_accent") || "indigo");
    setSections(loadSectionMode());
    setNavOrder(loadOrder("nav"));
    setSecOrder(loadOrder("sections"));
    const resolve = () => setIsDark(document.documentElement.dataset.theme === "dark");
    resolve();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", resolve);
    return () => mq.removeEventListener("change", resolve);
  }, []);

  const pickTheme = (t: string) => {
    setTheme(t); localStorage.setItem("rs_theme", t); apply(t, accent);
    setIsDark(document.documentElement.dataset.theme === "dark");
  };
  const pickAccent = (a: string) => {
    setAccent(a); localStorage.setItem("rs_accent", a); apply(theme, a);
  };
  const pickSections = (m: SectionMode) => {
    setSections(m); localStorage.setItem("rs_sections", m);
    // The company page reads this on mount; tell any open one immediately.
    window.dispatchEvent(new CustomEvent("rs-sections", { detail: m }));
  };

  // Asks before it reloads, the same as the ↻ in the header: a new version is
  // fetched past every cache; the current one is left alone and says so.
  const checkUpdates = async () => {
    if (upd === "checking") return;
    setUpd("checking");
    try {
      const r = await fetch(`${BASE}/version.json`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const v: { commit?: string } = await r.json();
      if (v.commit && BUILD_COMMIT && v.commit !== BUILD_COMMIT) return reloadBypassingCache();
      setUpd("current");
    } catch {
      setUpd("error");
    }
  };

  const built = BUILD_TIME
    ? new Date(BUILD_TIME).toLocaleString("en-IN",
        { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  const bar = applyOrder(DESTINATIONS, (d) => d.key, navOrder).slice(0, BAR_SLOTS).map((d) => d.label).join(", ");
  const secs = applyOrder(SECTIONS, (s) => s.id, secOrder).slice(0, 4).map((s) => s.label).join(", ");

  return (
    <div>
      <PageTitle>Settings</PageTitle>

      <Group title="Appearance">
        <ThemePicker value={theme} accent={accent} onChange={pickTheme} />
        <Row
          icon={<Glyph d={ICON.accent} />}
          title="Accent"
          right={
            <div className="flex gap-2 shrink-0" role="radiogroup" aria-label="Accent colour">
              {ACCENTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  onClick={() => pickAccent(a)}
                  aria-label={a.charAt(0).toUpperCase() + a.slice(1)}
                  aria-checked={accent === a}
                  className="rs-press w-[26px] h-[26px] rounded-full flex items-center justify-center"
                  style={{
                    background: ACCENT_DOT[a][isDark ? "dark" : "light"],
                    boxShadow: accent === a ? "0 0 0 2px var(--card), 0 0 0 4px var(--ink2)" : "none",
                  }}
                >
                  {accent === a && (
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none"
                      stroke={a === "mono" && isDark ? "#000" : "white"} strokeWidth="3"
                      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  )}
                </button>
              ))}
            </div>
          }
        />
      </Group>

      <Group title="Company page">
        <Row
          icon={<Glyph d={ICON.layout} />}
          title="Layout"
          sub={sections === "swipe" ? "One section at a time" : "One long page"}
          right={<Segmented label="Company page layout" value={sections} options={LAYOUTS} onChange={pickSections} />}
        />
        <Row icon={<Glyph d={ICON.order} />} title="Section order" sub={`${secs}…`} href="/settings?p=sections" chevron />
      </Group>

      <Group title="Navigation">
        <Row icon={<Glyph d={ICON.bar} />} title="Bottom bar" sub={bar} href="/settings?p=nav" chevron />
      </Group>

      <Group title="Data">
        <Row icon={<Glyph d={ICON.status} />} title="Data status" sub="How fresh each source is" href="/status" chevron />
        <Row
          icon={<Glyph d={ICON.update} />}
          title="Check for updates"
          onClick={checkUpdates}
          right={
            <span className={`text-[13px] shrink-0 ${
              upd === "current" ? "text-[var(--pos)]" : upd === "error" ? "text-[var(--neg)]" : "text-[var(--ink3)]"}`}>
              {upd === "checking" ? "Checking…" : upd === "current" ? "Up to date" : upd === "error" ? "Couldn't check" : ""}
            </span>
          }
        />
      </Group>

      <Group title="About">
        <Row
          icon={<Glyph d={ICON.version} />}
          title="Version"
          sub={built ?? "Build date unavailable"}
          right={BUILD_COMMIT ? <span className="font-mono text-xs text-[var(--ink3)] shrink-0">{BUILD_COMMIT.slice(0, 7)}</span> : null}
        />
        {BUILD_SUBJECT && <Row icon={<Glyph d={ICON.change} />} title="Latest change" sub={BUILD_SUBJECT} wrap />}
      </Group>
    </div>
  );
}

/** A list you put in your own order, on a screen of its own.
 *
 *  Up/down buttons rather than drag-and-drop. Dragging is nicer once it works
 *  and considerably worse when it does not: on a touch screen it fights the
 *  scroll of the page it sits in, and it is unreachable by keyboard. The row
 *  that just moved flashes once, so the eye can follow it. */
function ReorderScreen({ kind, title, caption, items, split }: {
  kind: OrderKind;
  title: string;
  caption: string;
  items: { id: string; label: string; icon?: string }[];
  /** Draw a divider after this many rows - where the bar ends and More begins. */
  split?: number;
}) {
  const [order, setOrder] = useState<string[]>([]);
  const [moved, setMoved] = useState<{ id: string; n: number }>({ id: "", n: 0 });

  useEffect(() => { setOrder(loadOrder(kind)); }, [kind]);

  const shown = applyOrder(items, (x) => x.id, order);

  const bump = (id: string, by: -1 | 1) => {
    const next = move(shown.map((x) => x.id), id, by);
    setOrder(next);
    saveOrder(kind, next);
    setMoved((m) => ({ id, n: m.n + 1 }));
  };
  const reset = () => { setOrder([]); clearOrder(kind); };

  const divider = (text: string) => (
    <div className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)] bg-[var(--card2)]">
      {text}
    </div>
  );

  const arrow = (d: string, label: string, disabled: boolean, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rs-press w-9 h-9 rounded-full flex items-center justify-center text-[var(--ink2)]
                 bg-[var(--card2)] border border-[var(--line)] disabled:opacity-25 shrink-0"
    >
      <Glyph d={d} size={16} />
    </button>
  );

  return (
    <div>
      <PageTitle>{title}</PageTitle>
      <p className="-mt-4 mb-5 px-1 text-sm text-[var(--ink3)]">{caption}</p>

      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] overflow-hidden">
        {shown.map((it, i) => (
          <Fragment key={`${it.id}-${moved.id === it.id ? moved.n : 0}`}>
            {split !== undefined && i === 0 && divider("In the bar")}
            {split !== undefined && i === split && divider("Under More")}
            <div className={`flex items-center gap-3 px-4 min-h-[56px] border-t border-[var(--line)] first:border-t-0 ${
              moved.id === it.id && moved.n > 0 ? "rs-moved" : ""}`}>
              <span className="w-5 text-xs text-[var(--ink3)] tabular-nums shrink-0">{i + 1}</span>
              {it.icon && <span className="text-[var(--ink2)] shrink-0"><Glyph d={it.icon} size={20} /></span>}
              <span className="flex-1 min-w-0 truncate text-[15px] text-[var(--ink)]">{it.label}</span>
              {arrow("M6 15l6-6 6 6", `Move ${it.label} up`, i === 0, () => bump(it.id, -1))}
              {arrow("M6 9l6 6 6-6", `Move ${it.label} down`, i === shown.length - 1, () => bump(it.id, 1))}
            </div>
          </Fragment>
        ))}
      </div>

      {order.length > 0 && (
        <button
          type="button"
          onClick={reset}
          className="mt-4 w-full min-h-[50px] rounded-2xl border border-[var(--line)] bg-[var(--card)]
                     text-[15px] font-medium text-[var(--neg)] active:bg-[var(--card2)]"
        >
          Reset to default order
        </button>
      )}
    </div>
  );
}
