"use client";

import { ReactNode } from "react";

/** Parts shared by the watchlist and the portfolio, which are laid out the
 *  way a broker app lays them out: a symbol on the left, the price and the
 *  day's move on the right, and everything else one tap away in a sheet. */

export function money(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** "+12.40" / "−3.10" - a real minus sign, so the columns line up. */
export function signed(v: number | null | undefined, dec = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export function tone(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return "text-[var(--ink2)]";
  return v > 0 ? "text-[var(--pos)]" : "text-[var(--neg)]";
}

/** The rupee move behind a percentage change, from today's price. */
export function dayMove(price: number | null | undefined, pct: number | null | undefined): number | null {
  if (!price || pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  return price - price / (1 + pct / 100);
}

/** "30 Sep" from "2026-09-30". */
export function shortDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** NCDEX roots carry a suffix that keeps them apart from MCX's; it is not
 *  part of the name anyone trades them by. */
export function shownSymbol(sym: string): string {
  return sym.replace(/_NCDEX$/, "");
}

const PATHS = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7",
  close: "M6 6l12 12M18 6L6 18",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  handle: "M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01",
  bag: "M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM9 8V6a3 3 0 0 1 6 0v2",
  chart: "M4 19h16M7 15l3-4 3 3 4-6",
  page: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
  trash: "M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  download: "M12 4v12M7 11l5 5 5-5M5 20h14",
} as const;

export function Icon({ name, size = 18, className = "" }: { name: keyof typeof PATHS; size?: number; className?: string }) {
  const dots = name === "more" || name === "handle";
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor"
      strokeWidth={dots ? 3 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** A round icon button with a 40px target. */
export function IconButton({ name, label, onClick, active = false }: {
  name: keyof typeof PATHS; label: string; onClick: () => void; active?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={`rs-press shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full ${
        active ? "text-[var(--accent-ink)] bg-[var(--accent-soft)]" : "text-[var(--ink2)] active:bg-[var(--card2)]"}`}>
      <Icon name={name} />
    </button>
  );
}

/** A full-width action inside a sheet. */
export function SheetAction({ icon, children, onClick, danger = false }: {
  icon: keyof typeof PATHS; children: ReactNode; onClick: () => void; danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`rs-press w-full flex items-center gap-3 min-h-[46px] px-3 rounded-xl text-left text-[14px] font-medium ${
        danger ? "text-[var(--neg)] active:bg-[var(--neg-soft)]" : "text-[var(--ink)] active:bg-[var(--card2)]"}`}>
      <Icon name={icon} className={danger ? "" : "text-[var(--ink3)]"} />
      {children}
    </button>
  );
}

/** Label over a figure, for the small grids inside a sheet. */
export function Stat({ label, value, className = "" }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-[var(--ink3)]">{label}</p>
      <p className={`text-[14px] font-medium tabular-nums truncate ${className || "text-[var(--ink)]"}`}>{value}</p>
    </div>
  );
}

/** Choice chips: one row, the chosen one filled. */
export function Chips<T extends string>({ value, options, onChange }: {
  value: T; options: [T, string][]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`rs-press min-h-[34px] px-3 rounded-full text-[13px] border ${
            value === k
              ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] border-[var(--accent-line)] font-semibold"
              : "text-[var(--ink2)] border-[var(--line)]"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
