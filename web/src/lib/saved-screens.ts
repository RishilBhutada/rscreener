/** Saved screens, and what changed in each since it was last opened.
 *
 *  A saved screen remembers the companies it matched when last looked at
 *  (`seen`). Every nightly refresh can move companies in and out, so the
 *  Saved tab runs each screen on today's data and shows who is new and who
 *  has left - the alert, without needing a server to know the screens.
 *  Opening a screen marks what it matches now as seen.
 *
 *  Stored under the same key as before, so screens saved on older builds
 *  and screens synced from another device keep working. */

import { Row, compile } from "./query";

const KEY = "rscreener_screens";

export type SavedScreen = {
  name: string;
  query: string;
  /** Only these sectors, when set. */
  sectors?: string[];
  /** Ready-made screen it came from, for its ranking. */
  lib?: string;
  /** Symbols it matched when last opened. */
  seen?: string[];
  /** The price date those were matched on. */
  seenAsof?: string;
};

export function loadSaved(): SavedScreen[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as SavedScreen[];
    // One per name. Sync unions two devices' arrays at sign-in, so a screen
    // opened on both arrives twice with different `seen`; the later wins.
    const by = new Map<string, SavedScreen>();
    for (const s of Array.isArray(raw) ? raw : []) {
      if (s && typeof s.name === "string" && typeof s.query === "string") by.set(s.name, s);
    }
    return Array.from(by.values());
  } catch {
    return [];
  }
}

export function storeSaved(list: SavedScreen[]): SavedScreen[] {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode or quota */ }
  return list;
}

/** The symbols a screen matches today. Null when the query no longer
 *  compiles (a custom ratio it used was deleted, say). */
export function matchesOf(s: Pick<SavedScreen, "query" | "sectors">, rows: Row[], ratios: Record<string, string>): string[] | null {
  try {
    const { run } = compile(s.query, ratios);
    const sec = s.sectors?.length ? new Set(s.sectors) : null;
    return rows
      .filter((r) => (!sec || sec.has(String(r.sector ?? ""))) && run(r) === true)
      .map((r) => String(r.symbol));
  } catch {
    return null;
  }
}

export function diff(now: string[], seen: string[] | undefined): { added: string[]; removed: string[] } {
  if (!seen) return { added: [], removed: [] };
  const a = new Set(now), b = new Set(seen);
  return { added: now.filter((x) => !b.has(x)), removed: seen.filter((x) => !a.has(x)) };
}
