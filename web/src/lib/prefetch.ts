/** Fetch a company's file in the background before it is tapped (S2,
 *  2-Nov-2026): the top search match as you type, and the companies in the
 *  list on screen. The browser keeps it, so the tap opens without waiting.
 *  Each file is asked for once per page load. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const asked = new Set<string>();

export function prefetchCompany(sym: string | null | undefined) {
  if (!sym || asked.has(sym) || sym.startsWith("^")) return;
  asked.add(sym);
  try {
    // Built exactly as the company page builds it (app/company/page.tsx) - a
    // differently encoded address is a different cache entry.
    void fetch(`${BASE}/companies/${sym}.json`, { priority: "low" } as RequestInit).catch(() => asked.delete(sym));
  } catch { asked.delete(sym); }
}

/** Several, spread out so they never compete with what is on screen. */
export function prefetchMany(syms: string[], max = 12) {
  syms.slice(0, max).forEach((s, i) => window.setTimeout(() => prefetchCompany(s), 1500 + i * 250));
}

/* ── the list a company was opened from, for previous / next (M1) ────────── */

const LIST_KEY = "rs_nav_list";

/** Remember the order of the list on screen, so the company page can step
 *  to the previous or next one in it. */
export function rememberList(name: string, syms: string[]) {
  try { sessionStorage.setItem(LIST_KEY, JSON.stringify({ name, syms: syms.slice(0, 500) })); } catch { /* private mode */ }
}

export function listAround(sym: string): { name: string; prev: string | null; next: string | null; at: number; of: number } | null {
  try {
    const raw = sessionStorage.getItem(LIST_KEY);
    if (!raw) return null;
    const { name, syms } = JSON.parse(raw) as { name: string; syms: string[] };
    const i = syms.indexOf(sym);
    if (i < 0) return null;
    return { name, prev: syms[i - 1] ?? null, next: syms[i + 1] ?? null, at: i + 1, of: syms.length };
  } catch { return null; }
}
