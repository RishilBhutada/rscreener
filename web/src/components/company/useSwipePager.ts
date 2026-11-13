/** The company page's section mode (scroll or swipe) and, in swipe mode, the
 *  pager: one gesture, one section; the menu follows; arrow keys page on a
 *  desktop. `company` is passed only so the pager is measured once it exists. */

import { useCallback, useEffect, useRef, useState } from "react";
import { loadSectionMode, SectionMode } from "@/components/Settings";
import { applyOrder, loadOrder } from "@/lib/order";

export function useSwipePager(company: unknown) {
  /** Scroll down the page, or swipe between sections one at a time. Set in
   *  Settings; read here on mount and updated live when Settings changes it,
   *  so you do not have to reload the company you are already looking at.
   *  Starts at "scroll" on the server so the markup matches on hydration. */
  const [mode, setMode] = useState<SectionMode>("scroll");
  const pager = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const [panes, setPanes] = useState(0);
  // The id of each pane in order, so the section nav can highlight where you
  // are. Read off the DOM rather than kept as a parallel list, which would go
  // stale the first time a section is added or made conditional.
  const [paneIds, setPaneIds] = useState<string[]>([]);
  const [sectionOrder, setSectionOrder] = useState<string[]>([]);
  useEffect(() => {
    const read = () => setSectionOrder(loadOrder("sections"));
    read();
    window.addEventListener("rs-order", read);
    return () => window.removeEventListener("rs-order", read);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read from this browser's storage after mount; the prerendered page has none
    setMode(loadSectionMode());
    const onMode = (e: Event) => setMode((e as CustomEvent).detail as SectionMode);
    window.addEventListener("rs-sections", onMode);
    return () => window.removeEventListener("rs-sections", onMode);
  }, []);

  // Which pane is in view, and how many there are. Counted from the DOM rather
  // than from a list of section names, because half the sections are
  // conditional - a BSE-only company has no quarters, P&L or shareholding, and
  // a hardcoded count would tell you "section 3 of 12" on a page with 6.
  useEffect(() => {
    const el = pager.current;
    if (!el || mode !== "swipe") { setPanes(0); return; }
    const measure = () => {
      setPanes(el.children.length);
      // VISUAL order, not DOM order. With the sections sequenced by CSS `order`
      // the two differ, and every index derived from this list - which pane the
      // menu highlights, which one a jump scrolls to - is an index into what
      // the reader sees, never into the source.
      setPaneIds(applyOrder(Array.from(el.children).map((c) => c.id), (id) => id, sectionOrder));
      setPage(el.clientWidth ? Math.round(el.scrollLeft / el.clientWidth) : 0);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    // Re-measure when the pane list itself changes. A one-shot count read 13
    // where the DOM ended up with 14, because a conditional section can mount
    // a tick after the effect runs, and the count then stayed wrong for the
    // life of the page - "section 1 of 13" on a page with fourteen. Watching
    // childList means the number corrects itself rather than depending on this
    // effect happening to run last.
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true });
    return () => {
      mo.disconnect();
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
    // `company` is a dependency because the pager does not exist until the data
    // arrives - the page renders "Loading…" first. Keyed on `mode` alone it
    // measured an element that was still null and reported "section 1 of 0".
  }, [mode, company, sectionOrder]);

  const sectionNav = useRef<HTMLElement>(null);

  // Swipe to a section and its NAME comes with you.
  //
  // The menu already highlighted the section you were on, which is no use when
  // the highlighted item is off the end of the menu's own horizontal scroll:
  // swipe to Balance Sheet and the menu still reads Summary … Peers, with the
  // highlight somewhere past the right edge. You could see where you were only
  // by scrolling a second thing.
  //
  // Scrolled by hand rather than with scrollIntoView, which reveals an element
  // by scrolling EVERY ancestor that can scroll - here that is the pager and
  // the window, so asking for a menu item would have dragged the section
  // sideways underneath it. Measured off bounding rects rather than offsetLeft,
  // which is relative to whichever ancestor happens to be positioned.
  useEffect(() => {
    if (mode !== "swipe") return;
    const nav = sectionNav.current;
    const id = paneIds[page];
    if (!nav || !id) return;
    const link = nav.querySelector<HTMLElement>(`a[href="#${CSS.escape(id)}"]`);
    if (!link) return;
    const nr = nav.getBoundingClientRect();
    const lr = link.getBoundingClientRect();
    // Centre it where there is room; the clamp inside scrollBy handles the ends.
    const delta = (lr.left - nr.left) - (nav.clientWidth - lr.width) / 2;
    if (Math.abs(delta) <= 4) return;
    // Someone who has asked their device for less motion should not be given a
    // sliding menu on every swipe; they get the same result, immediately.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollBy({ left: delta, behavior: still ? "auto" : "smooth" });
  }, [mode, page, paneIds]);

  // ONE SWIPE, ONE SECTION - driven here rather than left to the browser.
  //
  // scroll-snap-stop: always is supported and still let a single swipe cross
  // several sections in the installed app: snap decides where a scroll comes to
  // REST, and the WebView's fling had already carried it three panes by then.
  // So the horizontal gesture is taken off the browser entirely - CSS
  // touch-action: pan-y - and moved here, where a gesture can only ever commit
  // to the neighbouring section.
  //
  // The finger is tracked 1:1 during the drag, which is what makes it feel
  // attached rather than approximate, and the axis is locked on the first few
  // pixels so a vertical read never drifts sideways and a sideways swipe never
  // scrolls the page.
  useEffect(() => {
    const el = pager.current;
    if (!el || mode !== "swipe") return;

    let startX = 0, startY = 0, startScroll = 0, startIndex = 0;
    let axis: "x" | "y" | null = null;
    let lastX = 0, lastT = 0, velocity = 0, current = 0;

    const width = () => el.clientWidth || 1;

    const settle = (index: number) => {
      const n = el.children.length;
      const target = Math.max(0, Math.min(n - 1, index));
      el.scrollTo({ left: target * width(), behavior: "smooth" });
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = lastX = current = t.clientX;
      startY = t.clientY;
      startScroll = el.scrollLeft;
      startIndex = Math.round(startScroll / width());
      axis = null;
      velocity = 0;
      lastT = e.timeStamp;
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      // Lock the axis once the gesture has committed to a direction. Below the
      // threshold neither is claimed, so a tap or a tiny wobble does nothing.
      if (axis === null) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (axis === "y") return;   // the page scrolls; touch-action: pan-y allows it

      // Velocity over a FRAME, not between consecutive events. Touch events can
      // arrive a fraction of a millisecond apart - coalesced, or on a 120Hz
      // panel - and dividing a few pixels by that gives a number that looks
      // like a violent flick. A 40px twitch was paging the section on exactly
      // that arithmetic. Sampling no faster than one frame keeps the figure
      // honest.
      const dt = e.timeStamp - lastT;
      if (dt >= 16) {
        velocity = (t.clientX - lastX) / dt;   // px per ms, signed
        lastX = t.clientX;
        lastT = e.timeStamp;
      }
      current = t.clientX;

      // 1:1 with the finger, with resistance at the two ends so the first and
      // last sections feel like edges rather than like a broken control.
      let next = startScroll - dx;
      const max = (el.children.length - 1) * width();
      if (next < 0) next = next / 3;
      else if (next > max) next = max + (next - max) / 3;
      el.scrollLeft = next;
    };

    const onEnd = () => {
      if (axis !== "x") { axis = null; return; }
      const moved = current - startX;
      const travelled = moved / width();
      // Either a decisive flick or a third of the way across commits to the
      // next section; anything less falls back to where it started. One
      // section per gesture whichever way it was earned.
      //
      // A flick also has to have GONE somewhere - 24px at minimum. Speed alone
      // is not intent: a fast twitch while reading is not a request to change
      // section, and it was being treated as one.
      const flicked = Math.abs(velocity) > 0.35 && Math.abs(moved) > 24;
      let index = startIndex;
      if (travelled <= -0.33 || (flicked && velocity < 0)) index = startIndex + 1;
      else if (travelled >= 0.33 || (flicked && velocity > 0)) index = startIndex - 1;
      settle(index);
      axis = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [mode, paneIds]);

  // The pager is exactly as tall as the section you are looking at.
  //
  // A flex row is as tall as its tallest child, so without this the page would
  // carry the height of the longest section under every short one - the empty
  // space below Analysis would be the height of the balance sheet. Re-measured
  // when the pane changes size, because Documents grows when a year is opened.
  useEffect(() => {
    const el = pager.current;
    if (!el || mode !== "swipe") { if (el) el.style.height = ""; return; }
    const id = paneIds[page];
    const pane = id ? (Array.from(el.children).find((c) => c.id === id) as HTMLElement | undefined) : undefined;
    if (!pane) return;
    const fit = () => { el.style.height = `${pane.scrollHeight}px`; };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [mode, page, paneIds]);

  const step = useCallback((d: number) => {
    const el = pager.current;
    if (!el) return;
    el.scrollBy({ left: d * el.clientWidth, behavior: "smooth" });
  }, []);

  /** Jump to a named section while in swipe mode.
   *
   *  A plain `#id` link cannot do this job here. The browser scrolls EVERY
   *  ancestor scroll container to reveal the target - the pager sideways, and
   *  the window downwards as well - and since the panes are height-capped the
   *  document is short, so the window scroll left the header stranded above a
   *  blank strip. Paging by index is exact: every pane is exactly one container
   *  wide, so pane n sits at n × clientWidth, and the window stays put.
   *
   *  Returns false if the section is not inside the pager, in which case the
   *  ordinary anchor is left to do its ordinary thing.
   */
  const goTo = useCallback((id: string) => {
    const el = pager.current;
    const target = document.getElementById(id);
    if (!el || !target) return false;
    const pane = Array.from(el.children).find((c) => c === target || c.contains(target));
    if (!pane) return false;
    const visual = applyOrder(Array.from(el.children).map((c) => c.id), (id) => id, sectionOrder);
    const i = visual.indexOf(pane.id);
    if (i < 0) return false;
    // Instant, not smooth. `scroll-snap-type: x mandatory` re-snaps to the
    // NEAREST pane whenever a smooth scroll is interrupted - and the window
    // scroll below interrupts it - so a tap on "Balance Sheet" would set off
    // towards pane 6, get 88px in, and snap straight back to pane 0. Measured:
    // scrollLeft settled at 0.079 of a pane every time. An instant jump has no
    // flight for the snapper to interrupt. It is also the better behaviour for
    // a menu tap: six panes of sideways animation is a long wait for a jump you
    // asked for by name.
    // Width can be zero when the page is laid out in a hidden container - a
    // background tab, a collapsed pane, a print view. Paging by index would
    // then compute 0 for every section and silently go nowhere, so fall back
    // to letting the browser reveal the element the ordinary way.
    if (el.clientWidth > 0) {
      el.scrollLeft = i * el.clientWidth;
    } else {
      target.scrollIntoView({ block: "nearest", inline: "start" });
    }
    (pane as HTMLElement).scrollTop = 0;
    const r = el.getBoundingClientRect();
    if (Math.abs(r.top - 116) > 24) window.scrollBy({ top: r.top - 116, behavior: "smooth" });
    return true;
  }, [sectionOrder]);

  // Arrow keys page through it on a desktop, where there is nothing to swipe.
  useEffect(() => {
    if (mode !== "swipe") return;
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [mode, step]);

  return { mode, pager, page, panes, paneIds, sectionOrder, sectionNav, goTo };
}
