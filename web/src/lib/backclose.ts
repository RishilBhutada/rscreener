"use client";

import { useEffect, useRef } from "react";

/** Back closes an open pop-up instead of leaving the page (owner, 14-Oct-2026).
 *
 *  Opening adds one entry to the history, marked with this pop-up's id; Back -
 *  the phone's key in the app (which asks the WebView to go back) or the
 *  browser's - takes that entry off, and the pop-up closes. Closed any other
 *  way (its X, the dimmed backdrop, Escape), the entry is taken off again, so
 *  the next Back leaves the page exactly as it did before.
 *
 *  The id, not just "a popstate happened", decides: Next.js's router fires
 *  popstate during ordinary navigation too, and with one pop-up open over
 *  another, Back must close only the top one - the one beneath sees its own
 *  id come back and stays open. */
export function useBackClose(open: boolean, onClose: () => void) {
  const close = useRef(onClose);
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
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Still on this pop-up's entry: it was closed in the page, not by Back.
      // (After a link inside it navigated, the entry is behind us - leave it.)
      if (!gone && window.history.state?.rsPopup === id) window.history.back();
    };
  }, [open]);
}
