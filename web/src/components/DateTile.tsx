/** A day as a small tile - the date big and bold, the month under it in the
 *  accent - opening each day's group on the calendars (Midnight sapphire,
 *  owner's pick 20-Nov-2026: "style the remaining parts too, calendar rows").
 *  `day` is YYYY-MM-DD. */

export default function DateTile({ day }: { day: string }) {
  const d = new Date(`${day}T12:00:00Z`);
  return (
    <span className="w-10 shrink-0 flex flex-col items-center justify-center rounded-lg border border-[var(--line2)] bg-[var(--card2)] py-1 leading-none" aria-hidden="true">
      <span className="text-[16px] font-extrabold tabular-nums text-[var(--ink)]">{d.getUTCDate()}</span>
      <span className="mt-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[var(--accent-ink)]">
        {d.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" })}
      </span>
    </span>
  );
}
