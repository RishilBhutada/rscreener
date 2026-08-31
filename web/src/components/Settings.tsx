"use client";

import { useEffect, useState } from "react";
import { BUILD_TIME, BUILD_COMMIT, BUILD_SUBJECT } from "@/lib/buildinfo";
import { DESTINATIONS, BAR_SLOTS } from "@/lib/destinations";
import { applyOrder, clearOrder, loadOrder, move, saveOrder, OrderKind } from "@/lib/order";

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

/** A list you can put in your own order.
 *
 *  Up/down buttons rather than drag-and-drop. Dragging is nicer to use once it
 *  works and considerably worse when it does not: on a touch screen it fights
 *  the scroll of the panel it sits in, and it is unreachable by keyboard. Two
 *  buttons per row are boring, work everywhere, and announce themselves to a
 *  screen reader without any extra machinery.
 */
function Reorder({
  kind, items, labelOf,
}: {
  kind: OrderKind;
  items: { id: string; label: string }[];
  labelOf?: (id: string) => string;
}) {
  const [order, setOrder] = useState<string[]>([]);
  // Closed until asked for. Fifteen rows of up/down buttons is the right
  // control for the job and the wrong thing to meet on opening Settings -
  // unfolded, these two lists made the panel four screens long and pushed
  // everything after them, including the version, out of easy reach.
  const [open, setOpen] = useState(false);

  useEffect(() => { setOrder(loadOrder(kind)); }, [kind]);

  // The list as it currently reads, whether or not an order has been saved.
  const shown = applyOrder(items, (x) => x.id, order);

  const bump = (id: string, by: -1 | 1) => {
    const current = shown.map((x) => x.id);
    const next = move(current, id, by);
    setOrder(next);
    saveOrder(kind, next);
  };

  const reset = () => { setOrder([]); clearOrder(kind); };

  if (!open) {
    return (
      <div>
        <p className="text-[13px] text-[var(--ink2)] truncate">
          {shown.map((x) => x.label).join(" · ")}
        </p>
        <button
          onClick={() => setOpen(true)}
          className="mt-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--line)]
                     bg-[var(--card2)] text-[var(--ink2)] text-sm font-medium"
        >
          Change the order
        </button>
      </div>
    );
  }

  return (
    <div>
      <ul className="rounded-lg border border-[var(--line)] overflow-hidden">
        {shown.map((it, i) => (
          <li key={it.id}
              className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--card2)] border-b border-[var(--line)] last:border-b-0">
            <span className="text-[11px] text-[var(--ink3)] tabular-nums w-4 shrink-0">{i + 1}</span>
            <span className="flex-1 min-w-0 text-sm text-[var(--ink)] truncate">
              {labelOf ? labelOf(it.id) : it.label}
            </span>
            <button
              onClick={() => bump(it.id, -1)}
              disabled={i === 0}
              aria-label={`Move ${it.label} up`}
              className="min-h-[36px] min-w-[36px] rounded-md border border-[var(--line)] bg-[var(--card)]
                         text-[var(--ink2)] disabled:opacity-30 text-sm"
            >
              ↑
            </button>
            <button
              onClick={() => bump(it.id, 1)}
              disabled={i === shown.length - 1}
              aria-label={`Move ${it.label} down`}
              className="min-h-[36px] min-w-[36px] rounded-md border border-[var(--line)] bg-[var(--card)]
                         text-[var(--ink2)] disabled:opacity-30 text-sm"
            >
              ↓
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-4">
        <button onClick={() => setOpen(false)} className="text-xs font-semibold text-[var(--accent-ink)]">
          Done
        </button>
        {order.length > 0 && (
          <button onClick={reset} className="text-xs font-semibold text-[var(--ink3)]">
            Back to the original order
          </button>
        )}
      </div>
    </div>
  );
}


/** One place for every setting.
 *
 *  Theme and accent used to sit loose in the header - a sun icon and four
 *  coloured dots taking permanent space on every page, next to a refresh button
 *  and an account button, none of them labelled. Settings that are used once a
 *  month do not deserve room on a phone header that also has to hold a search
 *  box. They live behind one gear now.
 */

const THEMES: [string, string, string][] = [
  ["light", "Light", "☀"],
  ["dark", "Dark", "☽"],
  ["system", "Match device", "◑"],
];

const ACCENTS = ["emerald", "indigo", "rose", "amber"] as const;

/** Taken from globals.css, both themes - the swatch has to be the colour the
 *  app will actually paint, and the dark theme uses lighter accents. */
const ACCENT_DOT: Record<string, { light: string; dark: string }> = {
  emerald: { light: "#059669", dark: "#10b981" },
  indigo: { light: "#5a4fca", dark: "#818cf8" },
  rose: { light: "#e11d48", dark: "#fb7185" },
  amber: { light: "#d97706", dark: "#fbbf24" },
};

export type SectionMode = "scroll" | "swipe";

export function loadSectionMode(): SectionMode {
  if (typeof window === "undefined") return "scroll";
  return localStorage.getItem("rs_sections") === "swipe" ? "swipe" : "scroll";
}

function apply(theme: string, accent: string) {
  const d = document.documentElement;
  const dark = theme === "dark" || (theme === "system" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches);
  d.dataset.theme = dark ? "dark" : "light";
  d.dataset.accent = accent;
}

/** Both defined at MODULE scope, deliberately.
 *
 *  They used to be declared inside Settings, which meant a new component
 *  identity on every render - and React treats a new identity as a different
 *  component, so it unmounted the whole subtree and mounted a fresh one. The
 *  reorder lists lost their expanded state every time an item moved: you could
 *  move one thing, then the list folded shut and you had to open it again to
 *  move the next. Hoisting them keeps the identity stable across renders.
 */
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="py-3 border-b border-[var(--line)] last:border-b-0">
      <p className="text-sm font-semibold text-[var(--ink)]">{label}</p>
      {hint && <p className="text-xs text-[var(--ink3)] mt-0.5 mb-2">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`min-h-[44px] px-3 rounded-lg text-sm font-medium border ${
        on ? "bg-[var(--accent-soft)] border-[var(--accent-line)] text-[var(--accent-ink)]"
           : "bg-[var(--card2)] border-[var(--line)] text-[var(--ink2)]"}`}
    >
      {children}
    </button>
  );
}

export default function Settings() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState("system");
  const [accent, setAccent] = useState("indigo");
  const [sections, setSections] = useState<SectionMode>("scroll");
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setTheme(localStorage.getItem("rs_theme") || "system");
    setAccent(localStorage.getItem("rs_accent") || "indigo");
    setSections(loadSectionMode());
    const resolve = () => setIsDark(document.documentElement.dataset.theme === "dark");
    resolve();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", resolve);
    return () => mq.removeEventListener("change", resolve);
  }, []);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);

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

  const built = BUILD_TIME
    ? new Date(BUILD_TIME).toLocaleString("en-IN",
        { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Settings"
        title="Settings"
        className="rounded-full border border-[var(--line)] bg-[var(--card2)] w-10 h-10 sm:w-8 sm:h-8
                   flex items-center justify-center text-[var(--ink2)] hover:border-[var(--line2)]"
      >
        <span aria-hidden="true" className="text-base leading-none">⚙</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            role="dialog"
            aria-label="Settings"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 h-full w-full max-w-sm bg-[var(--card)] border-l border-[var(--line)]
                       overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]"
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-bold text-[var(--ink)]">Settings</h2>
              <button onClick={() => setOpen(false)} aria-label="Close settings"
                className="min-h-[44px] min-w-[44px] text-[var(--ink3)] text-lg">✕</button>
            </div>

            <Row label="Appearance" hint="Light, dark, or whatever your phone is set to.">
              <div className="flex gap-1.5 flex-wrap">
                {THEMES.map(([id, label, icon]) => (
                  <Choice key={id} on={theme === id} onClick={() => pickTheme(id)}>
                    <span aria-hidden="true" className="mr-1.5">{icon}</span>{label}
                  </Choice>
                ))}
              </div>
            </Row>

            <Row label="Accent colour" hint="Used for links, the active tab and the primary button.">
              <div className="flex gap-2">
                {ACCENTS.map((a) => (
                  <button
                    key={a}
                    onClick={() => pickAccent(a)}
                    aria-label={`Accent colour ${a}`}
                    aria-pressed={accent === a}
                    className="rounded-full"
                    style={{
                      width: 32, height: 32,
                      background: ACCENT_DOT[a][isDark ? "dark" : "light"],
                      outline: accent === a ? "2px solid var(--ink2)" : "1px solid var(--line2)",
                      outlineOffset: 2,
                    }}
                  />
                ))}
              </div>
            </Row>

            <Row
              label="Company page sections"
              hint="Summary, chart, quarters and the rest can sit in one long page, or become cards you swipe between one at a time."
            >
              <div className="flex gap-1.5">
                <Choice on={sections === "scroll"} onClick={() => pickSections("scroll")}>
                  ↕ Scroll down
                </Choice>
                <Choice on={sections === "swipe"} onClick={() => pickSections("swipe")}>
                  ↔ Swipe sideways
                </Choice>
              </div>
            </Row>

            <Row
              label="Bottom bar"
              hint={`The first ${BAR_SLOTS} sit in the bar on a phone; the rest move under More.`}
            >
              <Reorder kind="nav" items={DESTINATIONS.map((d) => ({ id: d.key, label: d.label }))} />
            </Row>

            <Row
              label="Company page order"
              hint="The sequence sections appear in, whether you scroll or swipe. The section menu follows it too."
            >
              <Reorder kind="sections" items={SECTIONS} />
            </Row>

            {/* Last, because it is the thing you check rather than change. */}
            <div className="pt-4 mt-2 border-t border-[var(--line)] text-xs text-[var(--ink3)] space-y-1">
              <p className="font-semibold text-[var(--ink2)]">This version of the app</p>
              {built ? (
                <>
                  <p>Last changed {built}</p>
                  {BUILD_SUBJECT && <p className="text-[var(--ink3)]">“{BUILD_SUBJECT}”</p>}
                  {BUILD_COMMIT && <p className="font-mono">{BUILD_COMMIT}</p>}
                </>
              ) : (
                <p>Build date unavailable in this build.</p>
              )}
              <p className="pt-1">
                Data freshness is separate and lives on the{" "}
                <a href="./status/" className="text-[var(--accent-ink)] font-semibold">Data page</a>.
              </p>
              {/* Was a bare arrow in the header. Installed to the home screen
                  there is no browser reload button, so it has to live
                  somewhere - just not somewhere permanent and unlabelled. */}
              <button
                onClick={() => window.location.reload()}
                className="mt-2 min-h-[44px] px-3 rounded-lg border border-[var(--line)]
                           bg-[var(--card2)] text-[var(--ink2)] text-sm font-medium w-full"
              >
                ↻ Reload the app
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
