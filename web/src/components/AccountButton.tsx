"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { firebaseConfigured, signOutOfGoogle, startAuth, useAuth } from "@/lib/firebase";
import { syncNow, watchLocalChanges } from "@/lib/sync";
import { useBackClose } from "@/lib/backclose";

// Start Firebase as soon as this page's code runs, not after the first render.
if (typeof window !== "undefined") startAuth();

/** The account picture in the top bar, left of the name. Signing in keeps the
 *  watchlist, notes, portfolio and saved screens on every device. While
 *  Firebase is still loading it shows the account last signed in on this
 *  device, never an empty silhouette (owner, 13-Oct-2026: the app looked
 *  signed out on every start). Renders nothing until Firebase is configured. */
export default function AccountButton() {
  const { ready, user, hint } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  const uid = user?.uid ?? null;

  // Sync each time a page shows, as before; the setItem wrapper comes off on
  // leaving the page even if the first sync has not finished.
  useEffect(() => {
    if (!uid) return;
    let live = true;
    let stop: (() => void) | null = null;
    syncNow(uid).then((r) => {
      if (!live) return;
      setMsg(r.ok ? "synced" : `sync failed: ${r.error}`);
      stop = watchLocalChanges(uid);
    });
    return () => { live = false; stop?.(); };
  }, [uid]);

  if (!firebaseConfigured) return null;

  const shown = user
    ? { email: user.email, name: user.displayName, photo: user.photoURL }
    : !ready && hint ? hint : null;

  // Signed out (or a device that has never signed in): an empty profile
  // picture, opening the account screen (email and password work in the
  // Android app; Google in browsers).
  if (!shown) {
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
  const initial = (shown.name ?? shown.email ?? "?").trim().charAt(0).toUpperCase();
  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Account"
        title={shown.email ?? undefined}
        className="w-8 h-8 rounded-full bg-[var(--accent-soft)] text-[var(--accent-ink)] text-sm font-semibold
                   border border-[var(--accent-line)] flex items-center justify-center overflow-hidden"
      >
        {shown.photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={shown.photo} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          : initial}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-60 bg-[var(--card)] border border-[var(--line2)]
                        rounded-xl shadow-lg p-3 z-40 text-xs">
          <p className="text-[var(--ink)] font-semibold truncate">{shown.name ?? "Signed in"}</p>
          <p className="text-[var(--ink3)] truncate">{shown.email}</p>
          <p className="text-[var(--ink3)] mt-2 leading-relaxed">
            Watchlist, notes, portfolio, saved screens and your theme follow this account across devices.
            {(user ? msg : "Checking your account...") && (
              <span className="block mt-1 text-[var(--ink2)]">{user ? msg : "Checking your account..."}</span>
            )}
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
