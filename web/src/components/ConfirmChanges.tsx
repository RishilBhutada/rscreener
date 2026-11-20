"use client";

/** The list of chart settings about to change, and a yes or no (owner,
 *  21-Nov-2026: "it should ask for confirmation and list the changes too
 *  before actually making it"). Used for a preset, for the other chart's
 *  set-up carried over, and for Advanced edits. Each line is "Setting: from →
 *  to" (lib/chartpresets.pickChanges); the setting is set in bold. Closing
 *  the sheet any other way is the no. */

import { InfoDialog } from "@/components/InfoTip";

export default function ConfirmChanges({ title, intro, lines, applyLabel = "Apply", cancelLabel = "Cancel", onApply, onCancel }: {
  title: string;
  intro?: string;
  lines: string[];
  applyLabel?: string;
  cancelLabel?: string;
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    <InfoDialog title={title} onClose={onCancel}>
      {intro && <p>{intro}</p>}
      <ul className="rounded-lg border border-[var(--edge)] divide-y divide-[var(--line)] overflow-hidden">
        {lines.map((l) => {
          const at = l.lastIndexOf(": ");
          const what = at > 0 ? l.slice(0, at) : l, change = at > 0 ? l.slice(at + 2) : "";
          return (
            <li key={l} className="px-3 py-2 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-semibold text-[var(--ink)]">{what}</span>
              <span className="text-right text-[var(--ink2)] tabular-nums">{change}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 rounded-lg px-3 py-2.5 text-sm font-medium border border-[var(--line2)] text-[var(--ink)]">{cancelLabel}</button>
        <button type="button" onClick={onApply}
          className="flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold bg-[var(--accent-fill)] text-[var(--accent-fill-ink)]">{applyLabel}</button>
      </div>
    </InfoDialog>
  );
}
