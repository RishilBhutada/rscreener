"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useBackClose } from "@/lib/backclose";
import { clearCachedData } from "@/lib/reload";

/** The button left of refresh (owner, 17-Nov-2026): clears what the app has
 *  downloaded and loads everything fresh. It asks first, and says plainly
 *  that the owner's own lists and settings are kept. */
export default function ClearCacheButton() {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  useBackClose(ask, () => setAsk(false));
  return (
    <>
      <button type="button" onClick={() => setAsk(true)} aria-label="Clear cache data" title="Clear cache data"
        className="rs-press w-10 h-10 rounded-full flex items-center justify-center text-[var(--ink2)] active:bg-[var(--card2)] hover:bg-[var(--card2)]">
        <svg viewBox="0 0 24 24" className="w-[19px] h-[19px]" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5" />
        </svg>
      </button>
      {ask && createPortal(
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="rs-clear-title">
          <div className="rs-fade absolute inset-0 bg-black/50" onClick={() => setAsk(false)} />
          <div className="rs-sheet relative w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-xl">
            <h2 id="rs-clear-title" className="text-[16px] font-semibold text-[var(--ink)]">Clear cache data?</h2>
            <p className="mt-2 text-[14px] text-[var(--ink2)]">
              Deletes the prices, charts and company files saved on this device and loads the latest version of the app and its data.
            </p>
            <p className="mt-2 text-[13px] text-[var(--ink3)]">
              Kept: your watchlists, portfolio, notes, alerts and settings.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button onClick={() => setAsk(false)}
                className="rs-press min-h-[44px] rounded-xl border border-[var(--line)] text-[14px] font-semibold text-[var(--ink)]">Cancel</button>
              <button onClick={() => { setBusy(true); void clearCachedData(); }} disabled={busy}
                className="rs-press min-h-[44px] rounded-xl bg-[var(--accent)] text-[14px] font-semibold text-white">{busy ? "Clearing…" : "Clear and reload"}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
