"use client";

import { ReactNode } from "react";
import Link from "next/link";
import InfoTip from "@/components/InfoTip";

/** Grouped lists, in the shape every phone's own Settings screen uses: a small
 *  capitalised heading, then a rounded card of rows, each row an icon tile, a
 *  title, one grey line under it, and whatever it controls on the right.
 *
 *  Shared by Settings and Others so the two screens are built from the same
 *  parts and cannot drift into looking like two different apps. */

export function Glyph({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function Chevron() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-[var(--ink3)]" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ExternalMark() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-[var(--ink3)]" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label="Opens in a new tab">
      <path d="M14 5h5v5M19 5l-8 8M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </svg>
  );
}

/** A page title in the large-title style of a settings screen. */
export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-[28px] leading-tight font-bold tracking-tight text-[var(--ink)] mb-6">{children}</h1>;
}

export function Group({ title, tip, note, children }: {
  title: string;
  /** Explanation behind an "i" beside the heading, rather than printed under it. */
  tip?: ReactNode;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-7">
      <h2 className="px-1 mb-2 flex items-center text-[11px] font-semibold uppercase tracking-wider text-[var(--ink3)]">
        {title}
        {tip && <InfoTip title={title} className="ml-1.5">{tip}</InfoTip>}
      </h2>
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] overflow-hidden divide-y divide-[var(--line)]">
        {children}
      </div>
      {note && <p className="px-1 mt-2 text-xs text-[var(--ink3)]">{note}</p>}
    </section>
  );
}

export function Row({ icon, title, sub, wrap, right, href, external, onClick, chevron }: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  /** Let the grey line run to two lines instead of cutting it off. */
  wrap?: boolean;
  right?: ReactNode;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  chevron?: boolean;
}) {
  const inner = (
    <div className="flex items-center gap-3 min-h-[58px] px-4 py-2.5">
      {icon && (
        <span className="w-8 h-8 rounded-[10px] bg-[var(--accent-soft)] text-[var(--accent-ink)] flex items-center justify-center shrink-0">
          {icon}
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium leading-snug text-[var(--ink)]">{title}</span>
        {sub && (
          <span className={`block text-xs text-[var(--ink3)] mt-0.5 ${wrap ? "line-clamp-2" : "truncate"}`}>{sub}</span>
        )}
      </span>
      {right}
      {external ? <ExternalMark /> : chevron ? <Chevron /> : null}
    </div>
  );
  const cls = "block w-full text-left hover:bg-[var(--card2)] active:bg-[var(--card2)]";
  if (href && external) return <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>{inner}</a>;
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{inner}</button>;
  return inner;
}

/** Two or three mutually exclusive choices, side by side. */
export function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label}
      className="inline-flex shrink-0 p-0.5 rounded-xl bg-[var(--card2)] border border-[var(--line)]">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`min-h-[34px] px-3 rounded-[10px] text-[13px] font-medium transition-all duration-200 ${
            value === v
              ? "bg-[var(--card)] text-[var(--ink)] shadow-sm ring-1 ring-[var(--line2)]"
              : "text-[var(--ink3)]"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
