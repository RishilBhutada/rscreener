/** Named watchlists.
 *
 *  One list is a filing cabinet with a single drawer. Real use separates things:
 *  what you own, what you are researching, what you decided against and want to
 *  check you were right about, what a screen threw up last Tuesday. Those are
 *  different questions and mixing them into one starred pile loses the reason
 *  each name was put there.
 *
 *  The old single list is not discarded - it becomes the first list, keeps its
 *  contents, and continues to be mirrored to the old storage key so anything
 *  still reading it (and any device on an older build) keeps working.
 */

const KEY = "rscreener_watchlists";
const LEGACY_KEY = "rscreener_watchlist";

export type Watchlist = {
  id: string;
  name: string;
  symbols: string[];
  /** ms epoch; ordering and "created" text only */
  created: number;
  /** free text - why this list exists, shown under its name */
  note?: string;
};

export type WatchState = { lists: Watchlist[]; activeId: string };

const DEFAULT_NAME = "My watchlist";

function newId(): string {
  // Not a UUID: these ids are merged across devices, so they must not collide,
  // but they are never secret and never guessed at.
  return `wl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readRaw<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function blank(symbols: string[] = []): WatchState {
  const l: Watchlist = { id: newId(), name: DEFAULT_NAME, symbols, created: Date.now() };
  return { lists: [l], activeId: l.id };
}

/** Read the lists, creating them from the old single watchlist on first run. */
export function loadLists(): WatchState {
  if (typeof localStorage === "undefined") return { lists: [], activeId: "" };
  const s = readRaw<WatchState | null>(KEY, null);
  if (!s || !Array.isArray(s.lists) || s.lists.length === 0) {
    const legacy = readRaw<string[]>(LEGACY_KEY, []);
    const fresh = blank(Array.isArray(legacy) ? legacy : []);
    save(fresh);
    return fresh;
  }
  // Defend against a half-written or merged-in state: a missing activeId, a
  // list without an id, duplicate symbols. Sync merges two devices' objects,
  // so this state can legitimately arrive in a shape neither device wrote.
  const lists = s.lists
    .filter((l) => l && typeof l.id === "string" && typeof l.name === "string")
    .map((l) => ({
      ...l,
      symbols: Array.from(new Set((l.symbols ?? []).filter((x) => typeof x === "string"))),
      created: l.created ?? Date.now(),
    }));
  if (!lists.length) return blank();
  const activeId = lists.some((l) => l.id === s.activeId) ? s.activeId : lists[0].id;
  return { lists, activeId };
}

export function save(s: WatchState): WatchState {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
    // Mirror the active list to the old key. Everything written before named
    // lists existed reads that key, including older builds still open on
    // another device, and a silent divergence between the two would be far
    // more confusing than the small duplication.
    const active = s.lists.find((l) => l.id === s.activeId);
    localStorage.setItem(LEGACY_KEY, JSON.stringify(active?.symbols ?? []));
  } catch { /* private mode or quota - the page must not break over it */ }
  return s;
}

export function createList(name: string, symbols: string[] = []): WatchState {
  const s = loadLists();
  const l: Watchlist = { id: newId(), name: name.trim() || "Untitled", symbols, created: Date.now() };
  return save({ lists: [...s.lists, l], activeId: l.id });
}

export function renameList(id: string, name: string): WatchState {
  const s = loadLists();
  return save({ ...s, lists: s.lists.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name } : l)) });
}

export function setListNote(id: string, note: string): WatchState {
  const s = loadLists();
  return save({ ...s, lists: s.lists.map((l) => (l.id === id ? { ...l, note: note.trim() || undefined } : l)) });
}

export function deleteList(id: string): WatchState {
  const s = loadLists();
  const lists = s.lists.filter((l) => l.id !== id);
  if (!lists.length) return save(blank());   // never leave the user with nowhere to star into
  return save({ lists, activeId: lists.some((l) => l.id === s.activeId) ? s.activeId : lists[0].id });
}

export function setActive(id: string): WatchState {
  const s = loadLists();
  return save({ ...s, activeId: s.lists.some((l) => l.id === id) ? id : s.activeId });
}

export function reorderList(id: string, dir: -1 | 1): WatchState {
  const s = loadLists();
  const i = s.lists.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= s.lists.length) return s;
  const lists = [...s.lists];
  [lists[i], lists[j]] = [lists[j], lists[i]];
  return save({ ...s, lists });
}

/** Which lists a symbol currently sits on. */
export function listsWith(symbol: string, s: WatchState = loadLists()): string[] {
  return s.lists.filter((l) => l.symbols.includes(symbol)).map((l) => l.id);
}

export function inAnyList(symbol: string, s: WatchState = loadLists()): boolean {
  return s.lists.some((l) => l.symbols.includes(symbol));
}

export function toggleIn(listId: string, symbol: string): WatchState {
  const s = loadLists();
  return save({
    ...s,
    lists: s.lists.map((l) =>
      l.id !== listId
        ? l
        : { ...l, symbols: l.symbols.includes(symbol) ? l.symbols.filter((x) => x !== symbol) : [...l.symbols, symbol] },
    ),
  });
}

export function addTo(listId: string, symbols: string[]): WatchState {
  const s = loadLists();
  return save({
    ...s,
    lists: s.lists.map((l) =>
      l.id !== listId ? l : { ...l, symbols: Array.from(new Set([...l.symbols, ...symbols])) },
    ),
  });
}

export function removeFrom(listId: string, symbol: string): WatchState {
  const s = loadLists();
  return save({
    ...s,
    lists: s.lists.map((l) => (l.id !== listId ? l : { ...l, symbols: l.symbols.filter((x) => x !== symbol) })),
  });
}

export function moveSymbol(fromId: string, toId: string, symbol: string): WatchState {
  const s = loadLists();
  if (fromId === toId) return s;
  return save({
    ...s,
    lists: s.lists.map((l) => {
      if (l.id === fromId) return { ...l, symbols: l.symbols.filter((x) => x !== symbol) };
      if (l.id === toId) return { ...l, symbols: Array.from(new Set([...l.symbols, symbol])) };
      return l;
    }),
  });
}

/** Star behaviour from a table: toggle on the ACTIVE list. */
export function toggleActive(symbol: string): WatchState {
  const s = loadLists();
  return toggleIn(s.activeId, symbol);
}

/** Union across every list - what the calendar and "anything I follow" want. */
export function allWatched(s: WatchState = loadLists()): string[] {
  return Array.from(new Set(s.lists.flatMap((l) => l.symbols)));
}

/** Merge two states from different devices without losing either side.
 *
 *  Called by the sync layer. Lists are matched by id; a list only one device
 *  knows about is kept, and symbols are unioned. Nothing is deleted here - a
 *  removal on one device that has not yet reached the other would otherwise
 *  masquerade as a deletion of the whole list.
 */
export function mergeStates(a: WatchState | null, b: WatchState | null): WatchState | null {
  if (!a) return b;
  if (!b) return a;
  const byId = new Map<string, Watchlist>();
  for (const l of [...a.lists, ...b.lists]) {
    const prev = byId.get(l.id);
    byId.set(l.id, prev
      ? { ...prev, name: prev.name || l.name, note: prev.note ?? l.note,
          symbols: Array.from(new Set([...prev.symbols, ...l.symbols])) }
      : { ...l, symbols: Array.from(new Set(l.symbols ?? [])) });
  }
  const lists = Array.from(byId.values());
  return { lists, activeId: lists.some((l) => l.id === a.activeId) ? a.activeId : lists[0]?.id ?? "" };
}
