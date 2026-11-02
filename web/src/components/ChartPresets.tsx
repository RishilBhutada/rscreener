"use client";

import { useRef, useState } from "react";
import { InfoDialog } from "@/components/InfoTip";
import type { ChartPick } from "@/lib/chartpick";
import { describe, loadPresets, samePick, savePresets, type ChartPreset } from "@/lib/chartpresets";

/** The row of chart presets above the company chart (owner's pick A,
 *  2-Nov-2026). Tap a chip: the chart takes that set-up. Hold it (or
 *  right-click): update it to the chart on screen, rename or delete it.
 *  "+ Save" names the chart on screen. The chip of the set-up on screen is
 *  lit; changing anything unlights it. */
export default function ChartPresets({ current, apply, sameRange, className = "-mx-1 px-1 pb-2 mb-1" }: {
  current: ChartPick;
  apply: (p: ChartPick) => void;
  sameRange: (a: string, b: string) => boolean;
  /** spacing around the row - the full chart sets its own */
  className?: string;
}) {
  const [list, setList] = useState<ChartPreset[]>(() => (typeof window === "undefined" ? [] : loadPresets()));
  const [dialog, setDialog] = useState<null | { mode: "save" } | { mode: "manage"; i: number; renaming: boolean }>(null);
  const [name, setName] = useState("");
  const store = (next: ChartPreset[]) => { setList(next); savePresets(next); };

  // Hold to manage, tap to apply - one set of listeners on the row.
  const timer = useRef<number | null>(null);
  const firedAt = useRef(0), downAt = useRef(0);
  const stop = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const idxOf = (e: React.SyntheticEvent) => {
    const v = (e.target as HTMLElement).closest<HTMLElement>("[data-preset]")?.dataset.preset;
    return v === undefined ? null : Number(v);
  };
  const manage = (i: number) => { firedAt.current = Date.now(); stop(); setName(list[i].name); setDialog({ mode: "manage", i, renaming: false }); };
  const down = (e: React.PointerEvent) => {
    const i = idxOf(e);
    stop(); downAt.current = Date.now();
    if (i !== null) timer.current = window.setTimeout(() => manage(i), 480);
  };
  const menu = (e: React.MouseEvent) => { const i = idxOf(e); if (i !== null) { e.preventDefault(); manage(i); } };
  const click = (e: React.MouseEvent) => {
    const i = idxOf(e);
    if (i === null || firedAt.current >= downAt.current) return;
    apply(list[i].pick);
  };

  const chip = "shrink-0 inline-flex items-center rounded-full px-3 py-1.5 sm:py-1 text-xs font-medium whitespace-nowrap border";
  const taken = (n: string) => list.findIndex((p) => p.name.trim().toLowerCase() === n.trim().toLowerCase());
  const lines = (p: ChartPick) => (
    <ul className="text-[13px] text-[var(--ink2)] space-y-1">
      {describe(p).map((t) => <li key={t} className="flex gap-2"><span className="text-[var(--accent)]">&bull;</span>{t}</li>)}
    </ul>
  );
  const input = (
    <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40}
      aria-label="Preset name" placeholder="Name this chart"
      className="w-full rounded-lg border border-[var(--line2)] bg-[var(--card2)] px-3 py-2 text-[15px] text-[var(--ink)] focus:outline-none focus:border-[var(--accent)]" />
  );
  const primary = "flex-1 rounded-lg px-3 py-2 text-sm font-semibold bg-[var(--accent-fill)] text-[var(--accent-fill-ink)] disabled:opacity-40";
  const secondary = "flex-1 rounded-lg px-3 py-2 text-sm font-medium border border-[var(--line2)] text-[var(--ink)]";

  return (
    <>
      <div className={`flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] select-none [-webkit-touch-callout:none] ${className}`}
        onPointerDown={down} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={menu} onClick={click}>
        {list.map((p, i) => {
          const lit = samePick(current, p.pick, sameRange);
          return (
            <button key={`${p.name}-${i}`} data-preset={i} aria-pressed={lit}
              className={`${chip} ${lit ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)] font-semibold" : "text-[var(--ink)] border-[var(--line2)]"}`}>
              {p.name}
            </button>
          );
        })}
        <button onClick={(e) => { e.stopPropagation(); setName(`My chart ${list.length + 1}`); setDialog({ mode: "save" }); }}
          className={`${chip} border-dashed border-[var(--line2)] text-[var(--ink2)]`}>+ Save as preset</button>
      </div>

      {dialog?.mode === "save" && (
        <InfoDialog title="Save this chart" onClose={() => setDialog(null)}>
          <div className="space-y-3">
            {input}
            {taken(name) >= 0 && <p className="text-xs text-[var(--ink3)]">Replaces the preset already called &ldquo;{list[taken(name)].name}&rdquo;.</p>}
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">What it sets</p>
            {lines(current)}
            <p className="text-xs text-[var(--ink3)]">Works on any company; one without this view shows Price. Hold a preset to update, rename or delete it.</p>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setDialog(null)} className={secondary}>Cancel</button>
              <button disabled={!name.trim()} className={primary} onClick={() => {
                const t = taken(name), item = { name: name.trim(), pick: current };
                store(t >= 0 ? list.map((p, i) => (i === t ? item : p)) : [...list, item]);
                setDialog(null);
              }}>Save</button>
            </div>
          </div>
        </InfoDialog>
      )}

      {dialog?.mode === "manage" && list[dialog.i] && (
        <InfoDialog title={list[dialog.i].name} onClose={() => setDialog(null)}>
          <div className="space-y-3">
            {lines(list[dialog.i].pick)}
            {dialog.renaming ? (
              <div className="space-y-2">
                {input}
                <div className="flex gap-2">
                  <button onClick={() => setDialog({ ...dialog, renaming: false })} className={secondary}>Cancel</button>
                  <button disabled={!name.trim() || (taken(name) >= 0 && taken(name) !== dialog.i)} className={primary}
                    onClick={() => { store(list.map((p, i) => (i === dialog.i ? { ...p, name: name.trim() } : p))); setDialog(null); }}>Rename</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button className={primary} onClick={() => { store(list.map((p, i) => (i === dialog.i ? { ...p, pick: current } : p))); setDialog(null); }}>
                  Update to the chart on screen
                </button>
                <div className="flex gap-2">
                  <button className={secondary} onClick={() => setDialog({ ...dialog, renaming: true })}>Rename</button>
                  <button className={`${secondary} text-[var(--neg)]`} onClick={() => { store(list.filter((_, i) => i !== dialog.i)); setDialog(null); }}>Delete</button>
                </div>
              </div>
            )}
          </div>
        </InfoDialog>
      )}
    </>
  );
}
