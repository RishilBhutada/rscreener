"use client";

import { useState } from "react";
import { InfoDialog } from "@/components/InfoTip";

/** Why a chart or figure is missing for this company, and whose side the gap
 *  is on. Owner, 18-Nov-2026: "a red star ... with an option to select which
 *  shows why the data is missing ... so that it can be identified whether
 *  it's a glitch or something missing from the NSE data."
 *
 *  Written by pipeline/data_status.py into companies/SYM.json from the records
 *  the pipeline keeps (fetch logs, quarters on record, the inputs each ratio
 *  line was built from). The star takes the colour of the worst item: red is
 *  a fault on Rscreener's side, amber is not read yet, grey is missing at the
 *  source or left out on purpose. Shared by the company chart and the
 *  full-screen chart, so the two cannot disagree. */
export type StatusSide = "ours" | "queued" | "source" | "rule";
export type StatusItem = { side: StatusSide; what: string; why: string; views: string[]; whole: boolean; next: string };
export type DataStatus = { worst: StatusSide; items: StatusItem[] };

export const SIDE: Record<StatusSide, { label: string; ink: string; soft: string; line: string }> = {
  ours: { label: "Rscreener glitch", ink: "var(--neg)", soft: "color-mix(in srgb, var(--neg) 10%, transparent)", line: "color-mix(in srgb, var(--neg) 45%, transparent)" },
  queued: { label: "Not read yet", ink: "var(--warn-ink)", soft: "var(--warn-soft)", line: "var(--warn-line)" },
  source: { label: "Missing at the source", ink: "var(--ink3)", soft: "var(--card2)", line: "var(--line2)" },
  rule: { label: "Left out on purpose", ink: "var(--ink3)", soft: "var(--card2)", line: "var(--line2)" },
};
const ORDER: StatusSide[] = ["ours", "queued", "source", "rule"];

/** Why a view the chart cannot draw is missing - the first item that removes it whole. */
export function whyMissing(status: DataStatus | null | undefined, view: string): StatusItem | null {
  return status?.items?.find((it) => it.whole && it.views.includes(view)) ?? null;
}

function Star({ colour, size = 16 }: { colour: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z" fill={colour} />
    </svg>
  );
}

function Row({ it }: { it: StatusItem }) {
  const s = SIDE[it.side] ?? SIDE.source;
  return (
    <li className="rounded-lg border px-3 py-2" style={{ borderColor: s.line, background: s.soft }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-[var(--ink)]">{it.what}</span>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider" style={{ color: s.ink }}>{s.label}</span>
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-[var(--ink2)]">{it.why}</p>
      <p className="mt-1 text-[11px] text-[var(--ink3)]">{it.next}</p>
    </li>
  );
}

/** The star, and the list it opens. Nothing is drawn when nothing is missing. */
export default function DataStatusButton({ status, view, className = "" }: {
  status?: DataStatus | null;
  /** the chart on screen - its items are listed first */
  view?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const items = status?.items ?? [];
  if (!items.length) return null;
  const worst = ORDER.find((k) => items.some((it) => it.side === k)) ?? "source";
  const here = view ? items.filter((it) => it.views.includes(view)) : [];
  const rest = items.filter((it) => !here.includes(it));
  return (
    <>
      <button onClick={() => setOpen(true)} title="Why some data is missing"
        aria-label={`Missing data: ${items.length} item${items.length === 1 ? "" : "s"}, worst: ${SIDE[worst].label}`}
        className={`shrink-0 inline-flex items-center justify-center gap-0.5 h-9 min-w-9 px-1.5 rounded-lg hover:bg-[var(--card2)] ${className}`}>
        <Star colour={SIDE[worst].ink} />
        <span className="text-[11px] font-bold tabular-nums" style={{ color: SIDE[worst].ink }}>{items.length}</span>
      </button>
      {open && (
        <InfoDialog title="Missing data" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--ink3)]">
              {ORDER.map((k) => (
                <span key={k} className="inline-flex items-center gap-1"><Star colour={SIDE[k].ink} size={11} />{SIDE[k].label}</span>
              ))}
            </div>
            {here.length > 0 && (
              <section className="space-y-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink2)]">This chart</p>
                <ul className="space-y-1.5">{here.map((it, i) => <Row key={`h${i}`} it={it} />)}</ul>
              </section>
            )}
            {rest.length > 0 && (
              <section className="space-y-1.5">
                {here.length > 0 && <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink2)]">Other charts</p>}
                <ul className="space-y-1.5">{rest.map((it, i) => <Row key={`r${i}`} it={it} />)}</ul>
              </section>
            )}
            <p className="text-[11px] text-[var(--ink3)]">
              Read from Rscreener&apos;s own records: what each exchange archive returned, when it was last read,
              and the inputs each chart line was built from.
            </p>
          </div>
        </InfoDialog>
      )}
    </>
  );
}
