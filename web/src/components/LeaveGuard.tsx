"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export type Change = { label: string; from: string; to: string };

/** Leaving a screen with changes made on it asks first, in a floating window
 *  that names each change (owner, 17-Nov-2026: "When I make some change in
 *  the settings and I press back, it should ask for confirmation").
 *
 *  While there are changes, one extra history entry is kept on top - the way
 *  a pop-up keeps one (lib/backclose). Back - the top bar's arrow, the
 *  phone's key or the browser's - takes that entry off, and the window opens
 *  instead of the page going. A link tapped inside the screen is held the
 *  same way. Keep leaves as asked; Undo puts every change back first, then
 *  leaves; Stay closes the window and puts the entry back. */
export default function LeaveGuard({ changes, undo }: { changes: Change[]; undo: () => void }) {
  const router = useRouter();
  const [ask, setAsk] = useState<null | { to: string | null }>(null);
  const id = useRef<string | null>(null);
  const leaving = useRef(false);
  const dirty = changes.length > 0;
  const live = useRef(changes);
  useEffect(() => { live.current = changes; });

  useEffect(() => {
    if (!dirty || id.current || typeof window === "undefined") return;
    const me = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    id.current = me;
    window.history.pushState({ ...(window.history.state ?? {}), rsLeave: me }, "");
  }, [dirty]);

  useEffect(() => {
    const onPop = () => {
      if (!id.current || leaving.current) return;
      if (window.history.state?.rsLeave === id.current) return;
      id.current = null;               // the guard entry is gone
      if (live.current.length === 0) { leaving.current = true; window.history.back(); return; }
      setAsk({ to: null });
    };
    const onClick = (e: MouseEvent) => {
      if (!id.current || leaving.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (live.current.length === 0) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      let path = url.pathname;
      if (BASE && path.startsWith(BASE)) path = path.slice(BASE.length) || "/";
      e.preventDefault();
      setAsk({ to: `${path}${url.search}${url.hash}` });
    };
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  const go = (to: string | null) => {
    leaving.current = true;
    setAsk(null);
    if (to === null) { window.history.back(); return; }
    if (id.current) {
      // Off the guard entry first, then to the link - or Back would undo it.
      id.current = null;
      const after = () => { window.removeEventListener("popstate", after); router.push(to); };
      window.addEventListener("popstate", after);
      window.history.back();
    } else router.push(to);
  };
  const stay = () => {
    setAsk(null);
    if (!id.current) {
      const me = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      id.current = me;
      window.history.pushState({ ...(window.history.state ?? {}), rsLeave: me }, "");
    }
  };

  if (!ask) return null;
  // Into <body>: the page's sliding entrance gives its main a transform,
  // which would pin a "fixed" window to the page instead of the screen.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="rs-leave-title">
      <div className="rs-fade absolute inset-0 bg-black/50" onClick={stay} />
      <div className="rs-sheet relative w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-xl">
        <h2 id="rs-leave-title" className="text-[16px] font-semibold text-[var(--ink)]">Keep these changes?</h2>
        <ul className="mt-3 space-y-1.5 text-[14px]">
          {changes.map((c) => (
            <li key={c.label} className="flex items-baseline justify-between gap-3">
              <span className="text-[var(--ink2)]">{c.label}</span>
              <span className="text-right text-[var(--ink)]">
                <span className="text-[var(--ink3)] line-through decoration-1">{c.from}</span>
                <span className="mx-1.5 text-[var(--ink3)]">&rarr;</span>
                <b className="font-semibold">{c.to}</b>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={() => { undo(); go(ask.to); }}
            className="rs-press min-h-[44px] rounded-xl border border-[var(--line)] text-[14px] font-semibold text-[var(--ink)]">Undo changes</button>
          <button onClick={() => go(ask.to)}
            className="rs-press min-h-[44px] rounded-xl bg-[var(--accent)] text-[14px] font-semibold text-white">Keep changes</button>
        </div>
        <button onClick={stay} className="mt-2 w-full min-h-[40px] text-[13px] font-medium text-[var(--ink3)]">Stay in Settings</button>
      </div>
    </div>,
    document.body,
  );
}
