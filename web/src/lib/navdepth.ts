"use client";

/** How many pages deep into THIS app the reader is, tracked as a trail.
 *
 *  A back button must never eject someone from the app; in the installed app
 *  that means closing it. Two earlier attempts to answer "is there anything of
 *  ours behind me" both failed on measurement, and both failures are the reason
 *  this is a trail rather than a counter:
 *
 *    history.length      counts entries from before the app opened and never
 *                        shrinks. Read 4 on a freshly opened home page.
 *    navigation type     supposed to report "back_forward". Measured here on a
 *                        real back navigation, it reports "navigate", because
 *                        the router moves in the page and the missing prefetch
 *                        payload then forces a fresh document.
 *    a counter + popstate  undercounted two hops as one, because the router
 *                        fires popstate during ordinary navigation too.
 *
 *  So nothing is inferred. The trail is the list of pages visited, kept in
 *  sessionStorage, and every page load compares itself to it:
 *
 *    the page before the top   this was a back  -> pop
 *    the top itself            a reload         -> unchanged
 *    anything else             a step forward   -> push
 *
 *  It is self-correcting: whatever the browser did and whatever it called it,
 *  the trail describes where the reader actually is. Depth zero is the page the
 *  session began on, and the arrow is not drawn there.
 */
const TRAIL = "rs_nav_trail";
const CAP = 50;   // a trail, not a biography

function readTrail(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(TRAIL) || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];   // private mode or corrupt value: the arrow stays hidden
  }
}

function writeTrail(t: string[]) {
  try {
    sessionStorage.setItem(TRAIL, JSON.stringify(t.slice(-CAP)));
  } catch { /* nothing to persist to */ }
}

/** Record arriving at `url` and return how deep it is. */
export function recordNavigation(url: string): number {
  if (typeof window === "undefined") return 0;
  const trail = readTrail();
  const top = trail[trail.length - 1];
  const previous = trail[trail.length - 2];

  if (url === top) {
    // A reload, or a re-render that changed nothing. Stay put.
  } else if (url === previous) {
    trail.pop();                       // went back one
  } else {
    trail.push(url);                   // went somewhere new
  }
  writeTrail(trail);
  return Math.max(0, trail.length - 1);
}

/** Where back should land, or null when there is nowhere of ours to land. */
export function previousPage(): string | null {
  const trail = readTrail();
  return trail.length >= 2 ? trail[trail.length - 2] : null;
}
