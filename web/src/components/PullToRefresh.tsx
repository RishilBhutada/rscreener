"use client";

import { useEffect, useRef, useState } from "react";
import { reloadBypassingCache } from "@/lib/reload";

/** Pull down from the top of any page to load it fresh (P12, 1-Nov-2026), the
 *  gesture phone apps use. It does what the refresh button's reload does -
 *  a load the WebView cannot answer from its cache - so the figures are new.
 *
 *  Only a pull that starts at the very top of the page, on a touch screen, and
 *  goes mostly downward counts. A pull that starts on a chart (which scrubs
 *  with the finger), inside an open sheet, or in something that scrolls
 *  sideways is left alone. */

const TRIGGER = 80;   // px of pull, after resistance, that reloads on release
const MAX = 120;

export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const active = useRef(false);
  const dist = useRef(0);

  useEffect(() => {
    const skip = (t: EventTarget | null) => {
      const el = t as Element | null;
      return !!el?.closest?.("svg.touch-none, [role='dialog'], input, textarea, select, [data-no-pull]");
    };
    const down = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.scrollY > 0 || skip(e.target)) { start.current = null; return; }
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      active.current = false;
    };
    const move = (e: TouchEvent) => {
      if (!start.current) return;
      const dy = e.touches[0].clientY - start.current.y;
      const dx = Math.abs(e.touches[0].clientX - start.current.x);
      if (!active.current) {
        if (dy > 8 && dy > dx * 1.5 && window.scrollY <= 0) active.current = true;
        else if (dy < 0 || dx > 12) { start.current = null; return; }
        else return;
      }
      dist.current = Math.min(MAX, Math.max(0, dy * 0.5));
      setPull(dist.current);
    };
    const up = (e: TouchEvent) => {
      // A cancelled touch (the system took the gesture) never reloads.
      if (e.type === "touchend" && active.current && dist.current >= TRIGGER) {
        setBusy(true);
        reloadBypassingCache();
      } else {
        setPull(0);
      }
      start.current = null;
      active.current = false;
      dist.current = 0;
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", up);
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, []);

  if (!pull && !busy) return null;
  const ready = pull >= TRIGGER || busy;
  return (
    <div aria-live="polite" className="fixed left-0 right-0 z-50 flex justify-center pointer-events-none"
      style={{ top: busy ? 64 : Math.max(8, pull - 24) }}>
      <div className="flex items-center gap-2 rounded-full bg-[var(--card)] border border-[var(--line2)] shadow-lg px-3 py-1.5 text-[12px] text-[var(--ink2)]">
        <svg viewBox="0 0 24 24" className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"
          style={busy ? undefined : { transform: `rotate(${(pull / TRIGGER) * 270}deg)` }} aria-hidden="true">
          <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" />
        </svg>
        {busy ? "Loading fresh" : ready ? "Release to refresh" : "Pull to refresh"}
      </div>
    </div>
  );
}
