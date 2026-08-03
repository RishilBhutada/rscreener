"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { firebaseConfigured, signInWithGoogle, signOutOfGoogle, watchUser } from "@/lib/firebase";
import { syncNow, watchLocalChanges } from "@/lib/sync";

/** Sign in with Google so the watchlist, notes, portfolio and saved screens follow
 *  you between devices. Renders nothing at all until Firebase is configured, so an
 *  un-set-up build is exactly the app it was before. */
export default function AccountButton() {
  const [user, setUser] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!firebaseConfigured) return;
    let off: (() => void) | undefined;
    watchUser(async (u) => {
      setUser(u);
      stop.current?.();
      stop.current = null;
      if (u) {
        const r = await syncNow(u.uid);
        setMsg(r.ok ? "synced" : `sync failed: ${r.error}`);
        stop.current = watchLocalChanges(u.uid);
      }
    }).then((f) => { off = f; });
    return () => { off?.(); stop.current?.(); };
  }, []);

  if (!firebaseConfigured) return null;

  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      const m = String((e as Error).message ?? e);
      setMsg(m.includes("popup") ? "Sign-in window was closed." : m);
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    return (
      <button
        onClick={go}
        disabled={busy}
        title="Keep your watchlist, notes and portfolio on every device"
        className="text-xs font-medium rounded-lg border border-[var(--line)] px-2.5 py-1.5
                   text-[var(--ink2)] hover:bg-[var(--card2)] disabled:opacity-50 whitespace-nowrap"
      >
        {busy ? "…" : "Sign in"}
      </button>
    );
  }

  const initial = (user.displayName ?? user.email ?? "?").trim().charAt(0).toUpperCase();
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={user.email ?? undefined}
        className="w-8 h-8 rounded-full bg-[var(--accent-soft)] text-[var(--accent-ink)] text-sm font-semibold
                   border border-[var(--accent-line)] flex items-center justify-center"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 bg-[var(--card)] border border-[var(--line2)]
                        rounded-xl shadow-lg p-3 z-40 text-xs">
          <p className="text-[var(--ink)] font-semibold truncate">{user.displayName ?? "Signed in"}</p>
          <p className="text-[var(--ink3)] truncate">{user.email}</p>
          <p className="text-[var(--ink3)] mt-2 leading-relaxed">
            Watchlist, notes, portfolio, saved screens and your theme follow this account across devices.
            {msg && <span className="block mt-1 text-[var(--ink2)]">{msg}</span>}
          </p>
          <button
            onClick={async () => { setOpen(false); await signOutOfGoogle(); setMsg(null); }}
            className="mt-2.5 w-full rounded-lg border border-[var(--line)] px-2 py-1.5 text-[var(--ink2)] hover:bg-[var(--card2)]"
          >
            Sign out
          </button>
          <p className="text-[var(--ink3)] mt-2">
            Signing out leaves everything on this device untouched.
          </p>
        </div>
      )}
    </div>
  );
}
