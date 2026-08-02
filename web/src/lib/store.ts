const WATCH_KEY = "rscreener_watchlist";
const RECENT_KEY = "rscreener_recent";
const NOTES_KEY = "rscreener_notes";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadWatchlist(): string[] {
  return read<string[]>(WATCH_KEY, []);
}

export function toggleWatch(symbol: string): string[] {
  const list = loadWatchlist();
  const next = list.includes(symbol) ? list.filter((s) => s !== symbol) : [...list, symbol];
  localStorage.setItem(WATCH_KEY, JSON.stringify(next));
  return next;
}

export function loadNote(symbol: string): string {
  return read<Record<string, string>>(NOTES_KEY, {})[symbol] ?? "";
}

export function saveNote(symbol: string, text: string): void {
  const all = read<Record<string, string>>(NOTES_KEY, {});
  if (text.trim()) all[symbol] = text;
  else delete all[symbol];
  localStorage.setItem(NOTES_KEY, JSON.stringify(all));
}

/** Companies looked at recently, newest first.
 *
 *  The home page is a search box, which is right when you know what you want and
 *  useless when you are picking up where you left off. A watchlist is a deliberate
 *  act; this is the passive record of what you were actually reading.
 */
export function loadRecent(): string[] {
  return read<string[]>(RECENT_KEY, []);
}

export function pushRecent(symbol: string, keep = 10): void {
  try {
    const next = [symbol, ...loadRecent().filter((s) => s !== symbol)].slice(0, keep);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private browsing or a full quota - not worth breaking the page over */
  }
}
