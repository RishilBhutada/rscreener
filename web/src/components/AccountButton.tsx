"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "firebase/auth";
import Link from "next/link";
import { firebaseConfigured, signOutOfGoogle, watchUser } from "@/lib/firebase";
import { syncNow, watchLocalChanges } from "@/lib/sync";

/** Sign in with Google so the watchlist, notes, portfolio and saved screens follow
 *  you between devices. Renders nothing at all until Firebase is configured, so an
 *  un-set-up build is exactly the app it was before. */
export default function AccountButton() {
  const [user, setUser] = useState<User | null>(null);
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

  // Signed out: an empty profile picture, opening the account screen (email
  // and password work in the Android app; Google in browsers).
  if (!user) {
    return (
      <Link
        href="/settings?p=account"
        aria-label="Sign in"
        title="Sign in - keep your watchlist, notes and portfolio on every device"
        className="shrink-0 w-8 h-8 rounded-full bg-[var(--card2)] border border-[var(--line2)] text-[var(--ink3)]
                   flex items-center justify-center overflow-hidden hover:border-[var(--accent-line)]"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor">
          <circle cx="12" cy="9" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0z" />
        </svg>
      </Link>
    );
  }

  // Signed in: the Google account's photo; an initial where there is none
  // (an email account).
  const initial = (user.displayName ?? user.email ?? "?").trim().charAt(0).toUpperCase();
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Account"
        title={user.email ?? undefined}
        className="w-8 h-8 rounded-full bg-[var(--accent-soft)] text-[var(--accent-ink)] text-sm font-semibold
                   border border-[var(--accent-line)] flex items-center justify-center overflow-hidden"
      >
        {user.photoURL
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          : initial}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-60 bg-[var(--card)] border border-[var(--line2)]
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
