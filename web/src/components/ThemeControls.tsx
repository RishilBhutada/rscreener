"use client";

import { useEffect, useState } from "react";

const THEMES = ["system", "light", "dark"] as const;
const ACCENTS = ["emerald", "indigo", "rose", "amber"] as const;
const ACCENT_DOT: Record<string, string> = {
  emerald: "#059669",
  indigo: "#4f46e5",
  rose: "#e11d48",
  amber: "#d97706",
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
  const [accent, setAccent] = useState<string>("emerald");

  useEffect(() => {
    setTheme(localStorage.getItem("rs_theme") || "system");
    setAccent(localStorage.getItem("rs_accent") || "emerald");
  }, []);

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
        className="text-sm rounded-full border border-[var(--line)] bg-[var(--card2)] px-3 py-1 text-[var(--ink2)] hover:border-[var(--line2)]"
      >
        {theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "🌗"}
      </button>
      <div className="flex items-center gap-1.5" role="group" aria-label="Accent colour">
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
              background: ACCENT_DOT[a],
              outline: accent === a ? "2px solid var(--ink2)" : "1px solid var(--line2)",
              outlineOffset: 2,
            }}
          />
        ))}
      </div>
    </div>
  );
}
