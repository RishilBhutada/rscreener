"use client";

import { createPortal } from "react-dom";

/** "Opening Infosys..." at the foot of the screen while a company's file is on
 *  its way (owner's pick C, 2-Nov-2026). The page behind fades and stops taking
 *  taps, so pressing Enter always visibly does something. Drawn into <body>,
 *  outside the faded page, so the pill itself stays at full strength. */
export default function OpeningPill({ name }: { name: string }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div role="status" aria-live="polite"
      className="rs-sheet fixed inset-x-0 mx-auto w-fit max-w-[calc(100vw-2rem)] z-50
                 bottom-6 touch:bottom-[calc(76px+env(safe-area-inset-bottom))] land:!bottom-4
                 flex items-center gap-2.5 rounded-full border border-[var(--line2)] bg-[var(--card)]
                 shadow-[0_10px_30px_rgba(0,0,0,0.35)] px-4 py-2 text-[13px] text-[var(--ink)]">
      <span aria-hidden="true" className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-[var(--line2)] border-t-[var(--accent)] animate-spin" />
      <span className="truncate">Opening <b className="font-semibold">{name}</b>&hellip;</span>
    </div>,
    document.body,
  );
}
