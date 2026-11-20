"use client";

/** Settings in sections you swipe between, left and right, with a tab row on
 *  top (owner, 20-Nov-2026: "I want the advanced changes to be in sections
 *  with right and left swipe rather than a very long scrolling page").
 *  Used by the Advanced part of both charts' options.
 *
 *  One section per swipe, driven here rather than by scroll-snap: in the
 *  installed app the WebView's fling carried a snap-scroller several panes
 *  at once (see company/useSwipePager.ts). The area takes the height of the
 *  section on screen, not the tallest one, so a short section leaves no gap.
 *  The section last open is remembered on this device. */

import { useEffect, useRef, useState, type ReactNode } from "react";

export type Section = { key: string; title: string; body: ReactNode };

export default function SwipeSections({ sections, storeKey }: { sections: Section[]; storeKey?: string }) {
  const n = sections.length;
  // The sheet only ever opens in the browser, so storage is read on mount.
  const [idx, setIdx] = useState(() => {
    if (!storeKey || typeof window === "undefined") return 0;
    try {
      const k = localStorage.getItem(storeKey);
      return Math.max(0, sections.findIndex((s) => s.key === k));
    } catch { return 0; }
  });
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [h, setH] = useState<number | undefined>(undefined);
  const view = useRef<HTMLDivElement>(null);
  const pages = useRef<(HTMLDivElement | null)[]>([]);
  const g = useRef({ x: 0, y: 0, t: 0, axis: null as "x" | "y" | null });

  const i = Math.min(idx, Math.max(0, n - 1));
  const keyNow = sections[i]?.key;

  const go = (to: number) => {
    const t = Math.max(0, Math.min(n - 1, to));
    setIdx(t);
    try { if (storeKey && sections[t]) localStorage.setItem(storeKey, sections[t].key); } catch { /* private mode */ }
  };

  // Height follows the section on screen, and its content as it changes.
  useEffect(() => {
    const el = pages.current[i];
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    setH(el.offsetHeight);
    return () => ro.disconnect();
  }, [i, n, keyNow]);

  // Sections off screen can't be tabbed into or read out.
  useEffect(() => {
    pages.current.forEach((el, k) => {
      if (!el) return;
      if (k === i) el.removeAttribute("inert"); else el.setAttribute("inert", "");
    });
  }, [i, n]);

  const onStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    g.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: e.timeStamp, axis: null };
  };
  const onMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const mx = e.touches[0].clientX - g.current.x, my = e.touches[0].clientY - g.current.y;
    if (g.current.axis === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      g.current.axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
      if (g.current.axis === "x") setDragging(true);
    }
    if (g.current.axis !== "x") return;
    // resistance past the first and last section
    const edge = (i === 0 && mx > 0) || (i === n - 1 && mx < 0);
    setDx(edge ? mx / 3 : mx);
  };
  const onEnd = (e: React.TouchEvent) => {
    if (g.current.axis === "x") {
      const w = view.current?.clientWidth || 1;
      const fast = Math.abs(dx) > 30 && Math.abs(dx) / Math.max(1, e.timeStamp - g.current.t) > 0.4;
      if (dx <= -w * 0.25 || (fast && dx < 0)) go(i + 1);
      else if (dx >= w * 0.25 || (fast && dx > 0)) go(i - 1);
    }
    g.current.axis = null;
    setDragging(false);
    setDx(0);
  };

  if (!n) return null;
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5" style={{ scrollbarWidth: "none" }}>
        {sections.map((s, k) => (
          <button key={s.key} type="button" role="tab" aria-selected={k === i} onClick={() => go(k)}
            className={`shrink-0 h-8 px-3 rounded-full text-[12px] font-medium border transition-colors ${
              k === i ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-transparent"
                : "border-[var(--line2)] text-[var(--ink2)] active:bg-[var(--card2)]"}`}>
            {s.title}
          </button>
        ))}
      </div>
      <div ref={view} className="overflow-hidden" style={{ height: h, transition: dragging ? "none" : "height 200ms ease", touchAction: "pan-y" }}
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}>
        <div className="flex items-start" style={{
          transform: `translateX(calc(${-i * 100}% + ${dx}px))`,
          transition: dragging ? "none" : "transform 250ms ease",
        }}>
          {sections.map((s, k) => (
            <div key={s.key} ref={(el) => { pages.current[k] = el; }} className="w-full shrink-0 flex flex-col gap-4 px-0.5"
              role="tabpanel" aria-label={s.title}>
              {s.body}
            </div>
          ))}
        </div>
      </div>
      {n > 1 && (
        <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
          {sections.map((s, k) => (
            <span key={s.key} className={`h-1.5 rounded-full transition-all ${k === i ? "w-4 bg-[var(--accent)]" : "w-1.5 bg-[var(--line2)]"}`} />
          ))}
        </div>
      )}
    </div>
  );
}
