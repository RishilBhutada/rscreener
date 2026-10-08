/** Whether the company page's tables show each figure's change against the
 *  period before it, in brackets. One setting for every company - and, signed
 *  in, every device: the key is in SYNCED_KEYS (lib/sync.ts). On unless the
 *  owner turns it off. */
import { useEffect, useState } from "react";

export const PCT_KEY = "rs_pct_change";
const EVENT = "rs-pct-change";

export function loadPctChange(): boolean {
  try { return localStorage.getItem(PCT_KEY) !== "off"; } catch { return true; }
}

export function savePctChange(on: boolean) {
  try { localStorage.setItem(PCT_KEY, on ? "on" : "off"); } catch { /* not remembered, still applied */ }
  // Every table on the open page follows at once, not just the one tapped.
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

export function usePctChange(): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(loadPctChange());
    const follow = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    const other = (e: StorageEvent) => { if (e.key === PCT_KEY) setOn(e.newValue !== "off"); };
    window.addEventListener(EVENT, follow);
    window.addEventListener("storage", other);
    return () => { window.removeEventListener(EVENT, follow); window.removeEventListener("storage", other); };
  }, []);
  return on;
}

/** The change from `prev` to `cur`: percent, or percentage points for a row
 *  that is itself a percentage (a margin going 20% -> 22% is +2 pts; "+10%"
 *  would read as if it had grown by a tenth). Null when there is no base. */
export function change(cur: number | null | undefined, prev: number | null | undefined, points: boolean): number | null {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (points) return cur - prev;
  if (prev === 0) return null;
  // Against the size of the base, so a loss that narrows reads as a rise.
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export function changeText(v: number, points: boolean, cur?: number | null, prev?: number | null): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (points) return `${sign}${a.toLocaleString("en-IN", { maximumFractionDigits: 1 })} pts`;
  // Both positive and more than ten times the base: say how many times.
  if (a >= 1000 && cur && prev && cur > 0 && prev > 0) return `${Math.round(cur / prev)}×`;
  if (a >= 1000) return `${sign}999%+`;
  return `${sign}${a.toLocaleString("en-IN", { maximumFractionDigits: a >= 100 ? 0 : 1 })}%`;
}
