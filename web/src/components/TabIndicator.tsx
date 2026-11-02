"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** The line under the open tab, sliding from tab to tab instead of jumping
 *  (transitions pass, 2-Nov-2026). The row marks its open tab with
 *  data-active="true"; this measures it and moves one bar there. The row must
 *  be positioned (relative or sticky) so the measurement is taken against it.
 *  Positioned straight on the DOM - no state - so it never re-renders the row. */
export default function TabIndicator({ rowRef, className = "" }: { rowRef: RefObject<HTMLElement | null>; className?: string }) {
  const bar = useRef<HTMLSpanElement>(null);
  const place = () => {
    const row = rowRef.current, b = bar.current;
    if (!row || !b) return;
    const el = row.querySelector<HTMLElement>("[data-active='true']");
    if (!el) { b.style.opacity = "0"; return; }
    const first = !b.dataset.ready;
    if (first) b.style.transition = "none";
    b.style.opacity = "1";
    b.style.width = `${el.offsetWidth}px`;
    b.style.transform = `translateX(${el.offsetLeft}px)`;
    if (first) { void b.offsetWidth; b.style.transition = ""; b.dataset.ready = "1"; }
  };
  // After every render: the open tab may have changed, or its label width.
  useLayoutEffect(place);
  useEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place());
    ro.observe(row);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span ref={bar} aria-hidden="true"
      className={`rs-tab-bar pointer-events-none absolute bottom-0 left-0 h-[2px] rounded-full bg-[var(--accent)] ${className}`}
      style={{ width: 0, opacity: 0 }} />
  );
}
