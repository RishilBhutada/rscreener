/** Cross-device sync of the things that belong to the user rather than to a browser.
 *
 *  Everything Rscreener remembers has lived in one browser's localStorage: open it
 *  on a phone and the watchlist, notes, portfolio and saved screens are all empty.
 *  Signed in, they follow you.
 *
 *  MERGE ON ARRIVAL, then last-write-wins. The first time a device signs in it
 *  UNIONS rather than overwrites - a watchlist built on the laptop and one built
 *  on the phone end up containing both, and notes are merged key by key. Plain
 *  last-write-wins would have silently destroyed whichever device signed in
 *  second, which is the sort of loss you only notice weeks later.
 */
import { getFirebase } from "./firebase";
import { WatchState, mergeStates } from "./watchlists";
import { mergeProfile, type Profile } from "./merge-profile";
import { markSaved } from "./saved-at";

export { markSaved };

/** localStorage keys that represent the person, not the machine. */
export const SYNCED_KEYS = [
  "rscreener_watchlists",
  "rscreener_watchlist",
  "rscreener_notes",
  "rscreener_portfolio",
  "rscreener_portfolio_at",
  "rscreener_screens",
  "rscreener_screens_at",
  "rscreener_watchlists_at",
  "rscreener_ratios",
  "rs_theme",
  "rs_accent",
  "rs_pct_tables",
  "rs_row_order",
  "rs_table_view",
  "rs_others_custom",
  "rs_chart_ui",
  "rs_peer_cols",
  "rs_peer_cols_at",
  "rs_grid_pins",
  "rs_grid_pins_at",
  "rs_price_alerts",
  "rs_price_alerts_at",
  "rs_chart_presets",
  "rs_chart_presets_at",
] as const;


function readLocal(): Profile {
  const out: Profile = {};
  for (const k of SYNCED_KEYS) {
    try {
      const raw = localStorage.getItem(k);
      if (raw === null) continue;
      out[k] = raw.startsWith("{") || raw.startsWith("[") ? JSON.parse(raw) : raw;
    } catch { /* a corrupt key should not stop the rest syncing */ }
  }
  return out;
}

function writeLocal(p: Profile) {
  for (const k of SYNCED_KEYS) {
    const v = p[k];
    if (v === undefined || v === null) continue;
    try {
      localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    } catch { /* private mode or quota */ }
  }
}

/** This device's data as text, for moving it without signing in: copied here,
 *  pasted on the new phone - or into a reinstalled app, whose storage the
 *  uninstall wiped (Settings > Move my data). */
export function backupText(): string {
  return JSON.stringify({ rscreener_backup: 1, at: new Date().toISOString(), data: readLocal() });
}

/** Merges a backup into this device the way signing in merges a profile:
 *  lists are joined, nothing already here is deleted. Returns how many kinds
 *  of data it carried; throws on text that is not a backup. */
export function restoreText(text: string): number {
  const doc = JSON.parse(text.trim());
  if (!doc || doc.rscreener_backup !== 1 || !doc.data || typeof doc.data !== "object") throw new Error("not a backup");
  writeLocal(merge(readLocal(), doc.data as Profile, true));   // a backup adds, never replaces
  return Object.keys(doc.data).filter((k) => (SYNCED_KEYS as readonly string[]).includes(k)).length;
}

/** This device has merged with this account at least once. Not synced: it
 *  is a fact about this device. Until then lists are joined, not replaced. */
const mergedKey = (uid: string) => `rs_sync_merged_${uid}`;

function merge(local: Profile, remote: Profile, first: boolean): Profile {
  return mergeProfile(local, remote, SYNCED_KEYS, {
    first,
    mergeWatch: (a, b) => mergeStates(a as WatchState, b as WatchState),
  });
}

/** Pull the stored profile, merge this device into it, push the result back. */
export async function syncNow(uid: string): Promise<{ ok: boolean; error?: string }> {
  const fb = await getFirebase();
  if (!fb) return { ok: false, error: "not configured" };
  try {
    const { doc, getDoc, setDoc } = await import("firebase/firestore");
    const ref = doc(fb.db, "profiles", uid);
    const snap = await getDoc(ref);
    const remote = (snap.exists() ? snap.data() : {}) as Profile;
    let first = true;
    try { first = localStorage.getItem(mergedKey(uid)) !== "1"; } catch { /* private mode: join, the safe way */ }
    const merged = merge(readLocal(), remote, first);
    writeLocal(merged);
    await setDoc(ref, { ...merged, updatedAt: Date.now() }, { merge: true });
    try { localStorage.setItem(mergedKey(uid), "1"); } catch { /* private mode */ }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) };
  }
}

/** Push local state up. Debounced by the caller; safe to call often. */
export async function pushNow(uid: string): Promise<void> {
  const fb = await getFirebase();
  if (!fb) return;
  try {
    const { doc, setDoc } = await import("firebase/firestore");
    await setDoc(doc(fb.db, "profiles", uid), { ...readLocal(), updatedAt: Date.now() }, { merge: true });
  } catch { /* offline is not an error worth interrupting the page for */ }
}

/** Mirror local changes upward. localStorage fires no event in the tab that wrote
 *  it, so setItem is wrapped rather than listened for. */
export function watchLocalChanges(uid: string): () => void {
  const orig = localStorage.setItem.bind(localStorage);
  let timer: ReturnType<typeof setTimeout> | null = null;
  localStorage.setItem = (k: string, v: string) => {
    orig(k, v);
    if (!(SYNCED_KEYS as readonly string[]).includes(k)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => pushNow(uid), 1500);   // one write per burst of edits
  };
  return () => { localStorage.setItem = orig; if (timer) clearTimeout(timer); };
}
