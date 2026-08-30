"use client";

import { useEffect, useState } from "react";

const THEMES = ["system", "light", "dark"] as const;
const ACCENTS = ["emerald", "indigo", "rose", "amber"] as const;
/** The swatch has to be the colour the app will actually use.
 *
 *  Indigo's dot was #4f46e5 while the theme's indigo is #5a4fca - the picker
 *  advertised a colour the app never renders. And the dots were always the
 *  light-theme values, so in dark mode all four showed the wrong shade of
 *  themselves. Taken straight from globals.css, both themes.
 */
const ACCENT_DOT: Record<string, { light: string; dark: string }> = {
  emerald: { light: "#059669", dark: "#10b981" },
  indigo: { light: "#5a4fca", dark: "#818cf8" },
  rose: { light: "#e11d48", dark: "#fb7185" },
  amber: { light: "#d97706", dark: "#fbbf24" },
};
function apply(theme: string, accent: string) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.accent = accent;
}

export default function ThemeControls() {
  const [theme, setTheme] = useState<string>("system");
  // layout.tsx sets data-accent="indigo" and the init script falls back to
  // indigo, so starting at emerald meant a fresh browser highlighted one
  // colour while rendering another.
  const [accent, setAccent] = useState<string>("indigo");

  // "system" is not a colour - the swatches have to follow what is actually on
  // screen, which for system means the OS preference.
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const th = localStorage.getItem("rs_theme") || "system";
    setTheme(th);
    setAccent(localStorage.getItem("rs_accent") || "indigo");
    const resolve = () =>
      setIsDark(document.documentElement.dataset.theme === "dark");
    resolve();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", resolve);
    return () => mq.removeEventListener("change", resolve);
  }, []);

  // ...and follow a manual switch too, not just the OS one.
  useEffect(() => {
    setIsDark(document.documentElement.dataset.theme === "dark");
  }, [theme]);

  const cycleTheme = () => {
    const next = THEMES[(THEMES.indexOf(theme as (typeof THEMES)[number]) + 1) % THEMES.length];
    setTheme(next);
    localStorage.setItem("rs_theme", next);
    apply(next, accent);
  };

  const pickAccent = (a: string) => {
    setAccent(a);
    localStorage.setItem("rs_accent", a);
    apply(theme, a);
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={cycleTheme}
        title={`Theme: ${theme} (tap to change)`}
        aria-label={`Theme: ${theme}, tap to change`}
        className="text-sm rounded-full border border-[var(--line)] bg-[var(--card2)] px-3 py-2 sm:py-1 text-[var(--ink2)] hover:border-[var(--line2)]"
      >
        {theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "🌗"}
      </button>
      <div className="hidden sm:flex items-center gap-1.5" role="group" aria-label="Accent colour">
        {ACCENTS.map((a) => (
          <button
            key={a}
            onClick={() => pickAccent(a)}
            title={`Accent: ${a}`}
            aria-label={`Accent colour ${a}`}
            className="rounded-full"
            style={{
              width: 16,
              height: 16,
              background: ACCENT_DOT[a][isDark ? "dark" : "light"],
              outline: accent === a ? "2px solid var(--ink2)" : "1px solid var(--line2)",
              outlineOffset: 2,
            }}
          />
        ))}
      </div>
    </div>
  );
}
