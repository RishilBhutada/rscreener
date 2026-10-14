"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Back closes an open pop-up instead of leaving the page (owner, 14-Oct-2026).
 *
 *  Opening adds one entry to the history, marked with this pop-up's id; Back -
 *  the phone's key in the app (which asks the WebView to go back) or the
 *  browser's - takes that entry off, and the pop-up closes. Closed any other
 *  way (its X, the dimmed backdrop, Escape), the entry is taken off again, so
 *  the next Back leaves the page exactly as it did before.
 *
 *  A link followed from inside the pop-up - the More menu's destinations -
 *  takes the entry off FIRST and then goes. The first version took it off
 *  when the menu closed, which happened as the link was tapped, and that Back
 *  undid the navigation: Calendar, Journey and the rest of More did not open
 *  (owner, 14-Oct-2026).
 *
 *  The id, not just "a popstate happened", decides: Next.js's router fires
 *  popstate during ordinary navigation too, and with one pop-up open over
 *  another, Back must close only the top one - the one beneath sees its own
 *  id come back and stays open. */
export function useBackClose(open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  const router = useRouter();
  useEffect(() => { close.current = onClose; });

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    window.history.pushState({ ...(window.history.state ?? {}), rsPopup: id }, "");
    let gone = false;

    const onPop = () => {
      if (window.history.state?.rsPopup === id) return;   // a pop-up above this one closed
      gone = true;
      close.current();
    };

    // Capture phase, so this sees the tap before the link's own handler.
    const onClick = (e: MouseEvent) => {
      if (gone || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      let path = url.pathname;
      if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length) || "/";
      const to = `${path}${url.search}${url.hash}`;
      e.preventDefault();          // the link's own navigation would be undone below
      gone = true;
      const go = () => {
        window.removeEventListener("popstate", go);
        router.push(to);
      };
      window.addEventListener("popstate", go);
      window.history.back();       // off the pop-up's entry, then to the link
      close.current();
    };

    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick, true);
      // Still on this pop-up's entry: it was closed in the page, not by Back
      // or a link. Take the entry off.
      if (!gone && window.history.state?.rsPopup === id) window.history.back();
    };
  }, [open, router]);
}
