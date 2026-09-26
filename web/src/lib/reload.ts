/** Reloading the app past every cache, and recognising the load that did it.
 *
 *  Moved out of the header so Settings can offer "Check for updates" without
 *  importing the header component into itself. The header re-exports
 *  `isRefreshLoad`, which the data loaders already import from there.
 */

export const REFRESH_MARK = "rsr";

/** True on the load that a refresh produced, so the data files are re-fetched
 *  rather than read back out of the cache the reload just went around. A fresh
 *  app shell showing yesterday's numbers is the same bug wearing a new coat. */
export function isRefreshLoad(): boolean {
  if (typeof window === "undefined") return false;
  return new URL(window.location.href).searchParams.has(REFRESH_MARK);
}

export function reloadBypassingCache() {
  const go = () => {
    const u = new URL(window.location.href);
    u.searchParams.set(REFRESH_MARK, Date.now().toString(36));
    window.location.replace(u.toString());
  };
  if (typeof caches === "undefined") return go();
  caches.keys()
    .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    .catch(() => {})      // no cache storage, or blocked: reload anyway
    .then(go, go);
}
