/** Every section in the app, drawn one way (owner, 20-Nov-2026: "Go with
 *  design 2 (Midnight sapphire) ... on entire app").
 *
 *  A section opens with a sapphire rail, its icon and a bold capital label, and
 *  sits in a card whose edge (--edge) is stronger than the dividers inside it
 *  (--line), so where one part ends and the next begins reads at a glance.
 *  Icons are drawn SVGs (@tabler/icons-react), never text glyphs - the owner's
 *  standing rule. Pages that had their own copy of this card (gold, commodity,
 *  ETF, index) use this one, so a section added anywhere looks the same. */

import type { ReactNode } from "react";
import type { TablerIcon } from "@tabler/icons-react";

export type SectionIcon = TablerIcon;

/** The heading alone: rail, icon, label, its "i", and an action at the right. */
export function SectionHead({ icon: Icon, title, tip, action, className = "", as: Tag = "h2" }: {
  icon?: SectionIcon;
  title: ReactNode;
  tip?: ReactNode;
  action?: ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className={`flex items-center gap-2 min-w-0 ${className}`}>
      <Tag className="flex items-center gap-1.5 min-w-0 pl-2.5 border-l-[3px] border-[var(--accent)] text-[12px] leading-[18px] font-extrabold uppercase tracking-[0.07em] text-[var(--ink)]">
        {Icon && <Icon size={15} stroke={2} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />}
        <span className="min-w-0 break-words">{title}</span>
        {tip}
      </Tag>
      {action && <div className="ml-auto shrink-0 flex items-center gap-1.5">{action}</div>}
    </div>
  );
}

/** The same heading as a drop-in for a section's own h2/h3, wrapping whatever
 *  it already held - the label and its "i" - so a card that lays out its own
 *  top row keeps it. */
export function SectionTitle({ icon: Icon, children, className = "", as: Tag = "h2" }: {
  icon?: SectionIcon;
  children: ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <Tag className={`flex items-center gap-1.5 min-w-0 pl-2.5 border-l-[3px] border-[var(--accent)] text-[12px] leading-[18px] font-extrabold uppercase tracking-[0.07em] text-[var(--ink)] ${className}`}>
      {Icon && <Icon size={15} stroke={2} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />}
      {children}
    </Tag>
  );
}

/** A section: the card with its heading on top. */
export default function SectionCard({ icon, title, tip, action, children, className = "" }: {
  icon?: SectionIcon;
  title: ReactNode;
  tip?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-[var(--edge)] bg-[var(--card)] overflow-hidden ${className}`}>
      <SectionHead icon={icon} title={title} tip={tip} action={action} className="px-3 pt-3 pb-2" />
      {children}
    </section>
  );
}
