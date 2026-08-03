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

/** localStorage keys that represent the person, not the machine. */
export const SYNCED_KEYS = [
  "rscreener_watchlist",
  "rscreener_notes",
  "rscreener_portfolio",
  "rscreener_screens",
  "rscreener_ratios",
  "rs_theme",
  "rs_accent",
] as const;

type Profile = Record<string, unknown>;

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

/** Union for lists, key-by-key for objects, remote for plain values. */
function merge(local: Profile, remote: Profile): Profile {
  const out: Profile = { ...local };
  for (const k of SYNCED_KEYS) {
    const l = local[k], r = remote[k];
    if (r === undefined) continue;
    if (l === undefined) { out[k] = r; continue; }
    if (Array.isArray(l) && Array.isArray(r)) {
      const seen = new Set<string>();
      out[k] = [...l, ...r].filter((x) => {
        const id = typeof x === "string" ? x : JSON.stringify(x);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    } else if (l && r && typeof l === "object" && typeof r === "object") {
      out[k] = { ...(r as object), ...(l as object) };   // this device wins a clash
    } else {
      out[k] = r;
    }
  }
  return out;
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
    const merged = merge(readLocal(), remote);
    writeLocal(merged);
    await setDoc(ref, { ...merged, updatedAt: Date.now() }, { merge: true });
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
