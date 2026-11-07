/** How two devices' copies of the synced data are merged (lib/sync.ts).
 *
 *  Kept free of imports so it can be tested on its own (web/tests).
 *
 *  Two kinds of list:
 *  - WHOLE (chart presets, price alerts, pinned ratios, peer columns): the
 *    copy saved last wins, always.
 *  - LAST_SAVED (portfolio, saved screens, named watchlists): the copy saved
 *    last wins too - but not on a device's FIRST merge, nor when either copy
 *    has no save time (written by an older build). Then the two are joined,
 *    as before, so a device that added something before signing in for the
 *    first time cannot wipe what the account already holds.
 *
 *  Joining is what used to happen every time, and it is why an edited
 *  holding's old quantity, a sold holding, an edited screen's old filters and
 *  a removed watchlist entry all came back after a sync (review 4-Nov-2026).
 */

export type Profile = Record<string, unknown>;

export const WHOLE = new Set<string>(["rs_chart_presets", "rs_price_alerts", "rs_grid_pins", "rs_peer_cols"]);
export const LAST_SAVED = new Set<string>(["rscreener_portfolio", "rscreener_screens", "rscreener_watchlists"]);

const stamped = (k: string) => WHOLE.has(k) || LAST_SAVED.has(k);

export function mergeProfile(
  local: Profile,
  remote: Profile,
  keys: readonly string[],
  opts: { first: boolean; mergeWatch: (a: unknown, b: unknown) => unknown },
): Profile {
  const out: Profile = { ...local };
  for (const k of keys) {
    const l = local[k], r = remote[k];
    if (r === undefined) continue;
    if (l === undefined) { out[k] = r; continue; }
    if (k.endsWith("_at") && stamped(k.slice(0, -3))) {
      out[k] = String(Math.max(Number(l ?? 0), Number(r ?? 0)));
      continue;
    }
    const la = Number(local[`${k}_at`] ?? 0), ra = Number(remote[`${k}_at`] ?? 0);
    if (WHOLE.has(k) || (LAST_SAVED.has(k) && !opts.first && la > 0 && ra > 0)) {
      out[k] = ra > la ? r : l;
      continue;
    }
    // Named watchlists are an object of lists: matched by id, symbols joined.
    if (k === "rscreener_watchlists") {
      out[k] = opts.mergeWatch(l, r);
      continue;
    }
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
