"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** A circled "i" beside a heading, which opens its explanation as a popup.
 *
 *  Every section of this app used to print a paragraph of explanation under
 *  its heading — a dozen of them on one company page. Correct, and exhausting:
 *  the reader who already knows what a P/E is pays for the sentence on every
 *  visit, and the figures he came for start a screen further down. The words
 *  are unchanged; they moved behind a button, so the page shows numbers and
 *  the explanation arrives when it is asked for.
 *
 *  Rendered through a portal deliberately. In swipe mode the sections are
 *  panes of a scroll-snap pager, and an overlay inside one of them would be
 *  clipped by the pane and would sit under the pager's own touch handling. */
export default function InfoTip({
  title,
  children,
  label,
  className = "",
}: {
  /** Heading of the popup — normally the same words as the thing it explains. */
  title: string;
  children: ReactNode;
  /** Screen-reader wording, when "About <title>" would read badly. */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll under the popup; on a phone that is the
    // difference between a dialog and a paragraph that happens to float.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={label ?? `About ${title}`}
        title={label ?? `About ${title}`}
        // p-1 -m-1 buys a 28px touch target without moving anything around it.
        className={`inline-flex shrink-0 items-center justify-center align-middle p-1 -m-1 text-[var(--ink3)] hover:text-[var(--accent-ink)] ${className}`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-[15px] h-[15px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9.25" />
          <path d="M12 11.3v5" />
          <circle cx="12" cy="7.8" r="0.95" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[120] flex items-end justify-center p-3 sm:items-center sm:p-6">
            <div
              className="rs-fade absolute inset-0 bg-black/50"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className="rs-sheet relative w-full sm:max-w-md max-h-[78vh] overflow-y-auto rounded-2xl border border-[var(--line2)] bg-[var(--card)] p-4 pb-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="shrink-0 p-1 -m-1 text-[var(--ink3)] hover:text-[var(--ink)]"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-[var(--ink2)]">
                {children}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** A labelled block inside a popup: "How it is worked out", and so on. */
export function InfoPart({ head, children }: { head: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-[var(--ink3)]">{head}</p>
      <p className="mt-0.5 text-[var(--ink2)]">{children}</p>
    </div>
  );
}
