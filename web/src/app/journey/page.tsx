"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TopNav from "@/components/TopNav";
import InfoTip, { InfoDialog } from "@/components/InfoTip";
import { Group, PageTitle, Segmented } from "@/components/ListUI";
import { Chips, Stat } from "@/components/QuoteUI";
import { saveFile } from "@/lib/download";
import {
  ACTIONS, Action, CATEGORIES, Category, ERROR_TAGS, ErrorTag, JournalEntry, TimeEntry, deleteJournal, deleteTime,
  isoWeek, journalFileName, journalMarkdown, loadJournal, loadTime, newId, saveJournal, saveTime, sentences, streak,
  timeCsv, today, weeks,
} from "@/lib/journey";

/** The owner's journey beside the data (owner, 14-Oct-2026): the time log
 *  and the decision journal of his education plan, in its own formats. */

type Tab = "time" | "journal";
const field = "w-full rounded-2xl border border-[var(--line2)] bg-[var(--card)] px-4 py-3 text-base text-[var(--ink)] placeholder:text-[var(--ink3)] focus:outline-none focus:border-[var(--accent)]";
const button = "w-full min-h-[50px] rounded-2xl text-[15px] font-semibold";
const hours = (m: number) => `${(m / 60).toFixed(m % 60 ? 1 : 0)}h`;

export default function JourneyPage() {
  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav />
      <main className="max-w-xl mx-auto px-4 pt-6 sm:pt-10 pb-12">
        <Suspense fallback={<div className="rs-skel h-96" aria-busy="true" aria-label="Loading" />}>
          <Journey />
        </Suspense>
      </main>
    </div>
  );
}

function Journey() {
  const params = useSearchParams();
  const router = useRouter();
  const tab: Tab = params.get("tab") === "journal" ? "journal" : "time";
  return (
    <div>
      <PageTitle>
        Journey
        <InfoTip title="Journey" className="ml-2">
          <p>Your education plan&apos;s time log and decision journal, kept with your account and in its formats: the time log exports as timelog.csv, each journal entry as journal/YYYY-MM-DD_instrument_action.md.</p>
          <p>Everything here is yours to write. The app adds up and exports; it never writes a thesis, an outcome or a lesson.</p>
        </InfoTip>
      </PageTitle>
      <div className="-mt-3 mb-5">
        <Segmented label="Section" value={tab} options={[["time", "Time log"], ["journal", "Journal"]] as const}
          onChange={(v) => router.replace(v === "journal" ? "/journey?tab=journal" : "/journey")} />
      </div>
      {tab === "time" ? <TimeLog /> : <Journal fresh={params.get("new") ?? ""} />}
    </div>
  );
}

// ── time log ─────────────────────────────────────────────────────────────

function TimeLog() {
  const [list, setList] = useState<TimeEntry[]>([]);
  const [cat, setCat] = useState<Category>("reading_anki");
  const [mins, setMins] = useState("30");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setList(loadTime()); setDate(today()); }, []);

  const ws = useMemo(() => weeks(list), [list]);
  const thisWeek = isoWeek(date || today());
  const week = ws.find((w) => w.week === thisWeek);
  const run = streak(ws, isoWeek(today()));

  const add = () => {
    const m = Math.round(Number(mins));
    if (!Number.isFinite(m) || m <= 0 || m > 24 * 60) { setMsg({ ok: false, text: "Minutes: a number from 1 to 1440." }); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setMsg({ ok: false, text: "Pick a date." }); return; }
    saveTime({ id: newId(), u: Date.now(), date, category: cat, minutes: m, notes: notes.trim() || undefined });
    setList(loadTime());
    setNotes("");
    setMsg({ ok: true, text: `Logged ${m} min of ${CATEGORIES.find((c) => c.id === cat)?.label}.` });
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">This week · {thisWeek}</h2>
          <InfoTip title="The week's checks">
            <p>From the plan&apos;s weekly review: a week under 9 hours is flagged, and so is more than 1.5 hours of filings and watching - the watching cap.</p>
            <p>Six weeks in a row of 12 hours or more unlocks the compressed clock (Phase 1 in six months instead of nine). A week under 12 hours, or with nothing logged, starts the count again; the week in progress counts once it reaches 12.</p>
          </InfoTip>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2">
          <Stat label="Logged" value={hours(week?.minutes ?? 0)} />
          <Stat label="Target" value="12h" />
          <Stat label="12h streak" value={`${run} / 6`} />
        </div>
        <div className="mt-3 h-2 rounded-full bg-[var(--card2)] overflow-hidden" aria-hidden="true">
          <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.min(100, ((week?.minutes ?? 0) / 720) * 100)}%` }} />
        </div>
        {week && (
          <ul className="mt-3 space-y-1 text-[13px]">
            {CATEGORIES.map((c) => (
              <li key={c.id} className="flex justify-between">
                <span className="text-[var(--ink2)]">{c.label}</span>
                <span className={`tabular-nums ${c.id === "filings_observation" && week.overWatch ? "text-[var(--neg)] font-semibold" : ""}`}>{hours(week.by[c.id])}</span>
              </li>
            ))}
          </ul>
        )}
        {week?.overWatch && <p className="mt-2 text-[12px] text-[var(--neg)]">Over the 1.5h watching cap this week.</p>}
        {(!week || week.under9) && <p className="mt-2 text-[12px] text-[var(--ink3)]">Under 9 hours so far this week.</p>}
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">Log time</h2>
        <Chips value={cat} options={CATEGORIES.map((c) => [c.id, c.label]) as [Category, string][]} onChange={setCat} />
        <Chips value={mins} options={[["15", "15m"], ["30", "30m"], ["45", "45m"], ["60", "1h"], ["90", "1.5h"], ["120", "2h"]] as [string, string][]} onChange={setMins} />
        <div className="grid grid-cols-2 gap-3">
          <input type="number" inputMode="numeric" min={1} max={1440} value={mins} onChange={(e) => setMins(e.target.value)}
            aria-label="Minutes" placeholder="Minutes" className={field} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className={field} />
        </div>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" aria-label="Notes" className={field} />
        <button type="button" onClick={add} className={`${button} bg-[var(--accent-fill)] text-[var(--accent-fill-ink)]`}>Log it</button>
        {msg && <p role="status" className={`px-1 text-sm ${msg.ok ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>{msg.text}</p>}
      </section>

      {ws.length > 0 && (
        <Group title="Weeks">
          {ws.slice(0, 12).map((w) => (
            <div key={w.week} className="flex items-center gap-3 px-4 py-3 text-[14px]">
              <span className="flex-1">{w.week}</span>
              {w.overWatch && <span className="text-[11px] text-[var(--neg)]">watching cap</span>}
              <span className={`tabular-nums font-semibold ${w.twelve ? "text-[var(--pos)]" : w.under9 ? "text-[var(--neg)]" : ""}`}>{hours(w.minutes)}</span>
            </div>
          ))}
        </Group>
      )}

      {list.length > 0 && (
        <Group title="Entries">
          {list.slice(0, 40).map((e) => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-[14px]">{CATEGORIES.find((c) => c.id === e.category)?.label} · <span className="tabular-nums">{e.minutes} min</span></p>
                <p className="text-[12px] text-[var(--ink3)] truncate">{e.date}{e.notes ? ` · ${e.notes}` : ""}</p>
              </div>
              <button type="button" onClick={() => { deleteTime(e.id); setList(loadTime()); }} aria-label="Delete entry"
                className="shrink-0 text-[12px] text-[var(--ink3)] px-2 py-1">Delete</button>
            </div>
          ))}
        </Group>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button type="button" className={`${button} border border-[var(--line)] bg-[var(--card)] text-[var(--accent-ink)]`}
          onClick={() => (list.length ? saveFile("timelog.csv", timeCsv(list)) : setMsg({ ok: false, text: "Nothing logged yet." }))}>Save timelog.csv</button>
        <button type="button" className={`${button} border border-[var(--line)] bg-[var(--card)] text-[var(--accent-ink)]`}
          onClick={() => (list.length
            ? navigator.clipboard.writeText(timeCsv(list)).then(() => setMsg({ ok: true, text: "Copied in timelog.csv's format." }), () => setMsg({ ok: false, text: "Copying was blocked here - use Save instead." }))
            : setMsg({ ok: false, text: "Nothing logged yet." }))}>Copy as CSV</button>
      </div>
    </div>
  );
}

// ── journal ──────────────────────────────────────────────────────────────

const blank = (instrument = ""): JournalEntry => ({
  id: newId(), u: Date.now(), date: today(), instrument, action: "buy", size: "", thesis: "", wrong: "",
  exitPrice: "", exitTime: "", exitBreak: "", mood: 0,
});

function Journal({ fresh }: { fresh: string }) {
  const router = useRouter();
  const [list, setList] = useState<JournalEntry[]>([]);
  const [draft, setDraft] = useState<JournalEntry | null>(null);
  const [view, setView] = useState<JournalEntry | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setList(loadJournal());
    if (fresh) setDraft(blank(fresh.toUpperCase()));
  }, [fresh]);

  const save = (e: JournalEntry) => {
    const n = sentences(e.thesis);
    const problem =
      !e.instrument.trim() ? "Name the instrument." :
      !e.thesis.trim() ? "Write the thesis - in your own words." :
      n > 5 ? `Keep the thesis to five sentences (it has ${n}).` :
      !e.wrong.trim() ? "Say what would prove you wrong - the plan treats it as the most important line." :
      e.mood < 1 ? "Rate your emotional state, 1 to 5." : "";
    if (problem) { setMsg({ ok: false, text: problem }); return; }
    saveJournal({ ...e, instrument: e.instrument.trim().toUpperCase() });
    setList(loadJournal());
    setDraft(null);
    // Started from a company page: drop ?new= so a reload does not open a blank form again.
    if (fresh) router.replace("/journey?tab=journal");
    setMsg({ ok: true, text: "Saved. Close it with the outcome, error tag and lesson when it ends." });
  };

  const tags = list.filter((e) => e.error).reduce<Record<string, number>>((m, e) => ({ ...m, [e.error!]: (m[e.error!] ?? 0) + 1 }), {});
  const modal = Object.entries(tags).sort((a, b) => b[1] - a[1])[0];

  if (draft) return <EntryForm entry={draft} onSave={save} msg={msg}
    onCancel={() => { setDraft(null); setMsg(null); if (fresh) router.replace("/journey?tab=journal"); }} />;

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => { setDraft(blank()); setMsg(null); }}
        className={`${button} bg-[var(--accent-fill)] text-[var(--accent-fill-ink)]`}>New entry</button>
      {msg && <p role="status" className={`px-1 text-sm ${msg.ok ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>{msg.text}</p>}

      {list.length > 0 && (
        <div className="grid grid-cols-3 gap-2 px-1">
          <Stat label="Entries" value={String(list.length)} />
          <Stat label="Open" value={String(list.filter((e) => !e.outcome).length)} />
          <Stat label="Most common error" value={modal ? `${modal[0]} (${modal[1]})` : "-"} />
        </div>
      )}

      {list.length === 0 ? (
        <p className="px-1 text-sm text-[var(--ink3)]">No entries yet. Every position, and every deliberate decision not to act, gets one. On a company page, the pencil beside the star starts one for that company.</p>
      ) : (
        <Group title="Entries">
          {list.map((e) => (
            <button key={e.id} type="button" onClick={() => setView(e)} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-[var(--card2)]">
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium truncate">{e.instrument} · {ACTIONS.find((a) => a.id === e.action)?.label}</p>
                <p className="text-[12px] text-[var(--ink3)]">{e.date}{e.error ? ` · ${e.error}` : ""}</p>
              </div>
              <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 ${e.outcome ? "bg-[var(--card2)] text-[var(--ink3)]" : "bg-[var(--accent-soft)] text-[var(--accent-ink)]"}`}>{e.outcome ? "Closed" : "Open"}</span>
            </button>
          ))}
        </Group>
      )}

      {list.length > 0 && (
        <button type="button" className={`${button} border border-[var(--line)] bg-[var(--card)] text-[var(--accent-ink)]`}
          onClick={() => navigator.clipboard.writeText(list.map(journalMarkdown).join("\n\n---\n\n")).then(
            () => setMsg({ ok: true, text: `Copied ${list.length} entries as Markdown.` }),
            () => setMsg({ ok: false, text: "Copying was blocked here - save entries one by one instead." }))}>Copy all as Markdown</button>
      )}

      {view && (
        <EntryView entry={view} onClose={() => setView(null)}
          onEdit={() => { setDraft(view); setView(null); setMsg(null); }}
          onClosed={(e) => { saveJournal(e); setList(loadJournal()); setView(null); setMsg({ ok: true, text: "Entry closed." }); }}
          onDelete={() => { deleteJournal(view.id); setList(loadJournal()); setView(null); setMsg({ ok: true, text: "Entry deleted." }); }} />
      )}
    </div>
  );
}

function EntryForm({ entry, onSave, onCancel, msg }: {
  entry: JournalEntry; onSave: (e: JournalEntry) => void; onCancel: () => void; msg: { ok: boolean; text: string } | null;
}) {
  const [e, setE] = useState(entry);
  const set = <K extends keyof JournalEntry>(k: K, v: JournalEntry[K]) => setE((x) => ({ ...x, [k]: v }));
  const n = sentences(e.thesis);
  const area = `${field} min-h-[96px]`;
  return (
    <div className="space-y-4">
      <p className="px-1 text-[13px] text-[var(--ink2)] rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3">
        <b>Your words only.</b> A thesis someone else wrote for you - a person or an AI - measures nothing about your judgement (your plan, rule 6).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <input value={e.instrument} onChange={(x) => set("instrument", x.target.value)} placeholder="Instrument" aria-label="Instrument" className={field} />
        <input type="date" value={e.date} onChange={(x) => set("date", x.target.value)} aria-label="Date" className={field} />
      </div>
      <Chips value={e.action} options={ACTIONS.map((a) => [a.id, a.label]) as [Action, string][]} onChange={(v) => set("action", v)} />
      <input value={e.size} onChange={(x) => set("size", x.target.value)} placeholder={e.action === "no-act" ? "What you did not do (optional)" : "Size - quantity, amount or % of the portfolio"} aria-label="Size" className={field} />
      <div>
        <textarea value={e.thesis} onChange={(x) => set("thesis", x.target.value)} placeholder="Thesis - five sentences at most" aria-label="Thesis" className={area} />
        <p className={`px-1 mt-1 text-[12px] ${n > 5 ? "text-[var(--neg)]" : "text-[var(--ink3)]"}`}>{n} of 5 sentences</p>
      </div>
      <textarea value={e.wrong} onChange={(x) => set("wrong", x.target.value)} placeholder="What would prove me wrong" aria-label="What would prove me wrong" className={area} />
      <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">Exit plan</h3>
      <input value={e.exitPrice} onChange={(x) => set("exitPrice", x.target.value)} placeholder="Price" aria-label="Exit price" className={field} />
      <input value={e.exitTime} onChange={(x) => set("exitTime", x.target.value)} placeholder="Time" aria-label="Exit time" className={field} />
      <input value={e.exitBreak} onChange={(x) => set("exitBreak", x.target.value)} placeholder="Thesis-break" aria-label="Thesis-break" className={field} />
      <div>
        <h3 className="px-1 mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">Emotional state</h3>
        <Chips value={String(e.mood)} options={[["1", "1 calm"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5 agitated"]] as [string, string][]} onChange={(v) => set("mood", Number(v))} />
      </div>
      <button type="button" onClick={() => onSave(e)} className={`${button} bg-[var(--accent-fill)] text-[var(--accent-fill-ink)]`}>Save entry</button>
      <button type="button" onClick={onCancel} className={`${button} border border-[var(--line)] bg-[var(--card)] text-[var(--ink2)]`}>Cancel</button>
      {msg && <p role="status" className={`px-1 text-sm ${msg.ok ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}>{msg.text}</p>}
    </div>
  );
}

function EntryView({ entry, onClose, onEdit, onClosed, onDelete }: {
  entry: JournalEntry; onClose: () => void; onEdit: () => void; onClosed: (e: JournalEntry) => void; onDelete: () => void;
}) {
  const [outcome, setOutcome] = useState(entry.outcome ?? "");
  const [error, setError] = useState<ErrorTag | "">(entry.error ?? "");
  const [lesson, setLesson] = useState(entry.lesson ?? "");
  const [sure, setSure] = useState(false);
  const row = (k: string, v: string) => v ? <div><p className="text-[11px] uppercase tracking-wide text-[var(--ink3)]">{k}</p><p className="whitespace-pre-wrap text-[var(--ink)]">{v}</p></div> : null;
  return (
    <InfoDialog title={`${entry.instrument} · ${entry.date}`} onClose={onClose}>
      {row("Decision", [ACTIONS.find((a) => a.id === entry.action)?.label, entry.size].filter(Boolean).join(" - "))}
      {row("Thesis", entry.thesis)}
      {row("What would prove me wrong", entry.wrong)}
      {row("Exit plan", [entry.exitPrice && `Price: ${entry.exitPrice}`, entry.exitTime && `Time: ${entry.exitTime}`, entry.exitBreak && `Thesis-break: ${entry.exitBreak}`].filter(Boolean).join("\n"))}
      {row("Emotional state", `${entry.mood} of 5`)}
      <div className="pt-2 space-y-2 border-t border-[var(--line)]">
        <p className="text-[11px] uppercase tracking-wide text-[var(--ink3)]">At close</p>
        <textarea value={outcome} onChange={(x) => setOutcome(x.target.value)} placeholder="Outcome, net of all costs" aria-label="Outcome" className={`${field} min-h-[64px] text-[14px]`} />
        <Chips<ErrorTag | ""> value={error} options={ERROR_TAGS.map((t) => [t, t]) as [ErrorTag, string][]} onChange={setError} />
        <input value={lesson} onChange={(x) => setLesson(x.target.value)} placeholder="Lesson, one sentence" aria-label="Lesson" className={`${field} text-[14px]`} />
        <button type="button" onClick={() => onClosed({ ...entry, outcome: outcome.trim() || undefined, error: error || undefined, lesson: lesson.trim() || undefined })}
          className="w-full min-h-[44px] rounded-xl bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] text-[14px] font-semibold">Save the close</button>
      </div>
      <div className="grid grid-cols-3 gap-2 pt-1">
        <button type="button" onClick={() => saveFile(journalFileName(entry), journalMarkdown(entry), "text/markdown;charset=utf-8")}
          className="min-h-[40px] rounded-xl border border-[var(--line)] text-[13px] text-[var(--accent-ink)]">Save .md</button>
        <button type="button" onClick={onEdit} className="min-h-[40px] rounded-xl border border-[var(--line)] text-[13px] text-[var(--ink2)]">Edit</button>
        <button type="button" onClick={() => (sure ? onDelete() : setSure(true))}
          className="min-h-[40px] rounded-xl border border-[var(--line)] text-[13px] text-[var(--neg)]">{sure ? "Tap to delete" : "Delete"}</button>
      </div>
    </InfoDialog>
  );
}
