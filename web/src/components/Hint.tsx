"use client";

import { useState } from "react";

/** A tip shown once, for a gesture nobody would guess - hold a tab, hold a
 *  preset (E1, 2-Nov-2026). Gone for good on "Got it", remembered on the
 *  device. */
export default function Hint({ id, children }: { id: string; children: React.ReactNode }) {
  const key = `rs_hint_${id}`;
  const [show, setShow] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return localStorage.getItem(key) === null; } catch { return false; }
  });
  if (!show) return null;
  return (
    <div role="note" className="rs-fade mb-2 flex items-start gap-2 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-2 text-[12.5px] text-[var(--accent-ink)]">
      <span aria-hidden="true" className="mt-px">&#9432;</span>
      <span className="flex-1">{children}</span>
      <button onClick={() => { try { localStorage.setItem(key, "1"); } catch { /* private mode */ } setShow(false); }}
        className="shrink-0 font-semibold underline-offset-2 hover:underline">Got it</button>
    </div>
  );
}
