/** A price's move as a pill: a drawn up or down triangle and the figure, on
 *  a soft tint of its own colour (Midnight sapphire, owner's pick 20-Nov-2026).
 *  Used beside every big price - company, gold, index, commodity - so a day's
 *  move reads the same everywhere. `value` sets the colour and the arrow; the
 *  text is the caller's, already signed and formatted. Flat is neither green
 *  nor red, and has no arrow. */

import type { ReactNode } from "react";

export default function ChangePill({ value, children, className = "" }: {
  value: number | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  const v = value ?? 0;
  const col = v > 0 ? "var(--pos)" : v < 0 ? "var(--neg)" : "var(--ink2)";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-bold tabular-nums whitespace-nowrap ${className}`}
      style={{ color: col, background: `color-mix(in oklab, ${col} 14%, transparent)` }}>
      {v !== 0 && (
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
          <path d={v > 0 ? "M5 1 9.5 9H.5z" : "M5 9 .5 1h9z"} fill="currentColor" />
        </svg>
      )}
      {children}
    </span>
  );
}
