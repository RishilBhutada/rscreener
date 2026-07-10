const WATCH_KEY = "rscreener_watchlist";
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
