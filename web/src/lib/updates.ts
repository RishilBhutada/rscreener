/** The app's update history: updates.json, written at build time from git
 *  (next.config.ts). One update = one change to the app's code, numbered
 *  across the whole history; the last year is listed. */

export type Update = { n: number; sha: string; at: string; text: string };
export type Updates = { latest: number; updates: Update[] };

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const SEEN_KEY = "rs_seen_update";

export async function loadUpdates(): Promise<Updates | null> {
  try {
    const r = await fetch(`${BASE}/updates.json`, { cache: "no-cache" });
    return r.ok ? ((await r.json()) as Updates) : null;
  } catch {
    return null;
  }
}

export function seenUpdate(): number | null {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    return v === null ? null : Number(v) || 0;
  } catch {
    return null;
  }
}

export function markSeen(n: number): void {
  try { localStorage.setItem(SEEN_KEY, String(n)); } catch { /* shown again next time - harmless */ }
}

/** "14 Nov 2026, 12:20 pm", in India time whatever the device's zone. */
export function updateWhen(at: string): string {
  return new Date(at).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}
