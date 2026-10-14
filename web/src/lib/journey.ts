/** The owner's learning journey, kept beside the market data (owner,
 *  14-Oct-2026): a time log and a decision journal in the format of his
 *  education plan's workshop (Stock market/Claude: timelog/timelog.csv and
 *  journal/YYYY-MM-DD_instrument_action.md), so an export drops straight in.
 *
 *  Both are his words and his minutes. The app stores, totals and exports;
 *  it never writes a thesis, a lesson or an outcome.
 *
 *  Entries carry an id and an edit time `u`, and a deleted one stays as a
 *  tombstone: syncing merges by id with the newest edit winning, so an entry
 *  closed on the phone is not doubled by the laptop's open copy, and a
 *  deletion is not undone by a device that still had it. */

export const TIME_KEY = "rscreener_timelog";
export const JOURNAL_KEY = "rscreener_journal";

export const CATEGORIES = [
  { id: "reading_anki", label: "Reading & Anki" },
  { id: "journal_review", label: "Journal & review" },
  { id: "building", label: "Building" },
  { id: "filings_observation", label: "Filings & watching" },
] as const;
export type Category = (typeof CATEGORIES)[number]["id"];

export type TimeEntry = { id: string; u: number; date: string; category: Category; minutes: number; notes?: string; del?: true };

export const ACTIONS = [
  { id: "buy", label: "Buy" },
  { id: "sell", label: "Sell" },
  { id: "no-act", label: "Decided not to act" },
  { id: "post-mortem", label: "Post-mortem" },
] as const;
export type Action = (typeof ACTIONS)[number]["id"];

export const ERROR_TAGS = ["analysis", "sizing", "execution", "patience", "discipline"] as const;
export type ErrorTag = (typeof ERROR_TAGS)[number];

export type JournalEntry = {
  id: string; u: number; del?: true;
  date: string; instrument: string; action: Action; size: string;
  thesis: string; wrong: string;
  exitPrice: string; exitTime: string; exitBreak: string;
  mood: number;
  outcome?: string; error?: ErrorTag; lesson?: string;
};

// ── storage ──────────────────────────────────────────────────────────────

function read<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, list: T[]) {
  localStorage.setItem(key, JSON.stringify(list));
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function loadTime(): TimeEntry[] {
  return read<TimeEntry>(TIME_KEY).filter((e) => !e.del).sort((a, b) => b.date.localeCompare(a.date) || b.u - a.u);
}

export function saveTime(e: TimeEntry) {
  const all = read<TimeEntry>(TIME_KEY).filter((x) => x.id !== e.id);
  write(TIME_KEY, [...all, { ...e, u: Date.now() }]);
}

export function deleteTime(id: string) {
  const all = read<TimeEntry>(TIME_KEY);
  write(TIME_KEY, all.map((x) => (x.id === id ? { id, u: Date.now(), del: true } as TimeEntry : x)));
}

export function loadJournal(): JournalEntry[] {
  return read<JournalEntry>(JOURNAL_KEY).filter((e) => !e.del).sort((a, b) => b.date.localeCompare(a.date) || b.u - a.u);
}

export function saveJournal(e: JournalEntry) {
  const all = read<JournalEntry>(JOURNAL_KEY).filter((x) => x.id !== e.id);
  write(JOURNAL_KEY, [...all, { ...e, u: Date.now() }]);
}

export function deleteJournal(id: string) {
  const all = read<JournalEntry>(JOURNAL_KEY);
  write(JOURNAL_KEY, all.map((x) => (x.id === id ? { id, u: Date.now(), del: true } as JournalEntry : x)));
}

/** Sync's merge for these two keys: by id, the newest edit (or deletion) wins. */
export function mergeById(local: unknown, remote: unknown): unknown[] {
  const by = new Map<string, { id: string; u?: number }>();
  for (const x of [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])]) {
    if (!x || typeof x !== "object" || typeof (x as { id?: unknown }).id !== "string") continue;
    const e = x as { id: string; u?: number };
    const had = by.get(e.id);
    if (!had || (e.u ?? 0) >= (had.u ?? 0)) by.set(e.id, e);
  }
  return [...by.values()];
}

// ── dates and weeks ──────────────────────────────────────────────────────

/** Today in India, as YYYY-MM-DD. */
export function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** ISO week, "2026-W42" - the weekly review's YYYY-WW. */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;                 // Monday 0
  d.setUTCDate(d.getUTCDate() - dow + 3);              // that week's Thursday
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export type Week = { week: string; minutes: number; by: Record<Category, number>; under9: boolean; overWatch: boolean; twelve: boolean };

/** Every week with time logged, newest first, with the review's two flags. */
export function weeks(entries: TimeEntry[]): Week[] {
  const map = new Map<string, Week>();
  for (const e of entries) {
    const w = isoWeek(e.date);
    const row = map.get(w) ?? { week: w, minutes: 0, by: { reading_anki: 0, journal_review: 0, building: 0, filings_observation: 0 }, under9: false, overWatch: false, twelve: false };
    row.minutes += e.minutes;
    row.by[e.category] = (row.by[e.category] ?? 0) + e.minutes;
    map.set(w, row);
  }
  return [...map.values()]
    .map((w) => ({ ...w, under9: w.minutes < 9 * 60, overWatch: w.by.filings_observation > 90, twelve: w.minutes >= 12 * 60 }))
    .sort((a, b) => b.week.localeCompare(a.week));
}

/** Consecutive weeks of 12 hours or more, counting back from last week (this
 *  week counts once it has reached 12). A week with nothing logged breaks it. */
export function streak(list: Week[], thisWeek: string): number {
  const by = new Map(list.map((w) => [w.week, w]));
  let n = by.get(thisWeek)?.twelve ? 1 : 0;
  let cursor = new Date();
  for (let i = 0; i < 520; i++) {
    cursor = new Date(cursor.getTime() - 7 * 864e5);
    const w = by.get(isoWeek(cursor.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })));
    if (!w?.twelve) break;
    n++;
  }
  return n;
}

// ── exports in the workshop's formats ────────────────────────────────────

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** timelog/timelog.csv: date,category,minutes,notes - oldest first. */
export function timeCsv(entries: TimeEntry[]): string {
  const rows = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.u - b.u)
    .map((e) => [e.date, e.category, String(e.minutes), csvCell(e.notes ?? "")].join(","));
  return ["date,category,minutes,notes", ...rows].join("\n") + "\n";
}

/** journal/YYYY-MM-DD_instrument_action.md */
export function journalFileName(e: JournalEntry): string {
  const inst = (e.instrument || "untitled").replace(/[^A-Za-z0-9&-]+/g, "-").replace(/^-|-$/g, "");
  return `${e.date}_${inst}_${e.action}.md`;
}

export function journalMarkdown(e: JournalEntry): string {
  const action = ACTIONS.find((a) => a.id === e.action)?.label ?? e.action;
  return [
    `# Journal entry — ${e.instrument} — ${e.date}`,
    "",
    `- **Date:** ${e.date}`,
    `- **Instrument:** ${e.instrument}`,
    `- **Direction & size:** ${[action, e.size].filter(Boolean).join(" — ")}`,
    "",
    "## Thesis (≤ 5 sentences, your own words)",
    "",
    e.thesis,
    "",
    "## What would prove me wrong",
    "",
    e.wrong,
    "",
    "## Exit plan",
    `- Price: ${e.exitPrice}`,
    `- Time: ${e.exitTime}`,
    `- Thesis-break: ${e.exitBreak}`,
    "",
    `## Emotional state (1–5): ${e.mood}`,
    "",
    "---",
    "*Fill the rest at close:*",
    "",
    "## Outcome (net of all costs)",
    "",
    e.outcome ?? "",
    "",
    "## Error tag",
    e.error ? `\`${e.error}\`` : "`analysis | sizing | execution | patience | discipline`",
    "",
    "## Lesson (one sentence)",
    "",
    e.lesson ?? "",
    "",
  ].join("\n");
}

/** Sentences in a thesis, for the plan's limit of five. */
export function sentences(text: string): number {
  return text.split(/[.!?]+(?:\s|$)/).map((s) => s.trim()).filter(Boolean).length;
}
