/** Record when a synced list was saved on this device, so the copy saved last
 *  can win when two devices disagree (lib/merge-profile.ts). In a file of its
 *  own so the stores can import it without pulling in the sync layer. */
export function markSaved(key: string): void {
  try { localStorage.setItem(`${key}_at`, String(Date.now())); } catch { /* private mode */ }
}
