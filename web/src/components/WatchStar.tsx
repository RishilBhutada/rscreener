"use client";

import { useEffect, useRef, useState } from "react";
import {
  WatchState, createList, inAnyList, listsWith, loadLists, toggleIn,
} from "@/lib/watchlists";

/** The star, once there is more than one list to star into.
 *
 *  With a single list a star is a switch and a click says everything. With
 *  several, the same click has to answer "which one", and a plain toggle would
 *  silently pick for you. So: filled when the company is on ANY list, and one
 *  click opens the lists with tick boxes. A new list can be made without
 *  leaving the page, because the moment you most want a new list is the moment
 *  you are looking at something that does not belong on any of the old ones.
 */
export default function WatchStar({ symbol, size = "lg" }: { symbol: string; size?: "sm" | "lg" }) {
  const [state, setState] = useState<WatchState>({ lists: [], activeId: "" });
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setState(loadLists()); }, [symbol]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const on = inAnyList(symbol, state);
  const mine = new Set(listsWith(symbol, state));

  // One list is still one list: keep the plain toggle rather than making people
  // open a menu to tick the only box in it.
  const single = state.lists.length <= 1;

  const click = () => {
    if (single) {
      const id = state.lists[0]?.id ?? createList("My watchlist").activeId;
      setState(toggleIn(id, symbol));
      return;
    }
    setOpen(!open);
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={click}
        aria-label={on ? `${symbol} is on a watchlist` : `Add ${symbol} to a watchlist`}
        aria-expanded={single ? undefined : open}
        title={single ? (on ? "On your watchlist — click to remove" : "Add to your watchlist") : "Choose which lists this belongs on"}
        className={`${size === "lg" ? "text-2xl" : "text-lg"} leading-none ${
          on ? "text-[var(--accent)]" : "text-[var(--line2)] hover:text-[var(--accent)]"
        }`}
      >
        ★
      </button>

      {open && !single && (
        <div role="menu" aria-label={`Watchlists for ${symbol}`} className="absolute right-0 z-40 mt-2 w-60 bg-[var(--card)] border border-[var(--line)] rounded-xl shadow-xl overflow-hidden text-sm">
          <div className="px-3 py-2 text-xs font-semibold text-[var(--ink3)] border-b border-[var(--line)]">
            Lists for {symbol}
          </div>
          <div className="max-h-64 overflow-y-auto">
            {state.lists.map((l) => (
              <button
                key={l.id}
                onClick={() => setState(toggleIn(l.id, symbol))}
                role="menuitemcheckbox"
                aria-checked={mine.has(l.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--card2)]"
              >
                {/* The tick is rendered only when it is ticked. Drawing it always
                    and colouring it transparent looked identical and read as
                    "✓ Passed on" to a screen reader on a list the company is
                    not on. */}
                <span aria-hidden className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                  mine.has(l.id)
                    ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                    : "border-[var(--line2)]"
                }`}>{mine.has(l.id) ? "✓" : ""}</span>
                <span className="flex-1 text-[var(--ink)]">{l.name}</span>
                <span className="text-xs text-[var(--ink3)]">{l.symbols.length}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-[var(--line)] p-2">
            {adding ? (
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newName.trim()) {
                    const s = createList(newName.trim(), [symbol]);
                    setState(s); setNewName(""); setAdding(false);
                  }
                  if (e.key === "Escape") { setAdding(false); setNewName(""); }
                }}
                onBlur={() => { setAdding(false); setNewName(""); }}
                placeholder="New list name, then Enter"
                className="w-full text-sm bg-[var(--card2)] border border-[var(--line)] rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="w-full text-left px-1 py-1 text-[var(--accent-ink)] hover:underline"
              >
                + New list with {symbol}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
