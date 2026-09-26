/** Reloading the app past every cache, and recognising the load that did it.
 *
 *  Moved out of the header so Settings can offer "Check for updates" without
 *  importing the header component into itself. The header re-exports
 *  `isRefreshLoad`, which the data loaders already import from there.
 */

export const REFRESH_MARK = "rsr";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export type Version = { commit?: string; built?: string; subject?: string };

/** The version the SITE is serving right now.
 *
 *  The query string is the fix. GitHub Pages' CDN keeps version.json for ten
 *  minutes (Cache-Control: max-age=600 - measured, a cache HIT), and
 *  `cache: "no-store"` only reaches the browser's own cache, not the CDN's. So
 *  for up to ten minutes after a deploy this asked the CDN, got the old answer,
 *  and reported "you have the latest version" about a version that was not. A
 *  URL nobody has asked for before is a miss at every cache in the path. */
export async function fetchLiveVersion(): Promise<Version | null> {
  try {
    const r = await fetch(`${BASE}/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Version;
  } catch {
    return null;
  }
}

export function isNewer(v: Version | null, running: string): boolean {
  return !!(v?.commit && running && v.commit !== running);
}

/** Minutes an app-update publish usually takes, start to live, once the
 *  company export stopped rescanning the statements table. */
export const PUBLISH_MINUTES = 7;

export type Pending = { kind: "publish" | "refresh"; startedMin: number } | null;

const RUNS = "https://api.github.com/repos/RishilBhutada/rscreener/actions/workflows/311180536/runs?per_page=5";

/** Is something on its way? The repository is public, so its run list can be
 *  read without a token. A run named "Publish..." is an app update (minutes);
 *  anything else is a data refresh (hours), which publishes when it ends. */
export async function pendingRelease(): Promise<Pending> {
  try {
    const r = await fetch(RUNS, { cache: "no-store", headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const d: { workflow_runs?: { status: string; created_at: string; display_title?: string }[] } = await r.json();
    const run = (d.workflow_runs ?? []).find((x) => x.status !== "completed");
    if (!run) return null;
    const startedMin = Math.max(0, Math.round((Date.now() - new Date(run.created_at).getTime()) / 60000));
    return { kind: (run.display_title ?? "").startsWith("Publish") ? "publish" : "refresh", startedMin };
  } catch {
    return null;
  }
}

/** What to tell somebody who asked for an update that is not live yet. */
export function pendingText(p: NonNullable<Pending>): string {
  if (p.kind === "publish") {
    const left = PUBLISH_MINUTES - p.startedMin;
    return left <= 0
      ? "An update is being published — any minute now."
      : `An update is being published — ready in about ${left} min.`;
  }
  const ago = p.startedMin >= 90 ? `${Math.round(p.startedMin / 60)} h` : `${p.startedMin} min`;
  return `You have the latest version. A data refresh is running (started ${ago} ago).`;
}

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
