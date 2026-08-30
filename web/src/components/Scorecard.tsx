"use client";

import { useEffect, useState } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Check = { measured: number; agree: number; pct: number | null; what: string };
type Part = {
  score: number | null;
  fields?: Record<string, number | null>;
  checks?: Record<string, Check>;
  companies_with_a_valuation_history?: number;
  median_years_of_history?: number | null;
  reaching_before_2012?: number;
  as_of?: string | null;
  days_old?: number;
  regularly_traded?: number;
  on_the_newest_close?: number;
};
type Card = {
  generated_at: string;
  overall: number | null;
  parts: Record<string, Part>;
  history: { at: string; overall: number | null; complete?: number | null;
             correct?: number | null; fresh?: number | null; deep?: number | null }[];
};

const DIMS: [string, string, string][] = [
  ["complete", "Complete", "Is the figure there at all"],
  ["correct", "Correct", "Does an independent source or an arithmetic identity agree"],
  ["fresh", "Fresh", "Does it describe today rather than last month"],
  ["deep", "Deep", "How far back the history reaches"],
];

/** Red below 50, amber below 80, green above. A score you have to interpret is
 *  a score nobody reads. */
function tone(v: number | null | undefined) {
  if (v === null || v === undefined) return { fg: "var(--ink3)", bg: "var(--line)" };
  if (v < 50) return { fg: "var(--neg)", bg: "var(--neg)" };
  if (v < 80) return { fg: "var(--warn)", bg: "var(--warn)" };
  return { fg: "var(--pos)", bg: "var(--pos)" };
}

export default function Scorecard() {
  const [c, setC] = useState<Card | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/scorecard.json`).then((r) => r.json()).then(setC).catch(() => {});
  }, []);

  if (!c) return null;
  const prev = c.history.length > 1 ? c.history[c.history.length - 2] : null;
  const delta = (k: string) => {
    const now = k === "overall" ? c.overall : c.parts[k]?.score;
    const was = prev ? (prev as unknown as Record<string, number | null | undefined>)[k] : null;
    if (now === null || now === undefined || was === null || was === undefined) return null;
    const d = Math.round((now - was) * 10) / 10;
    return Math.abs(d) < 0.05 ? null : d;
  };

  const Delta = ({ k }: { k: string }) => {
    const d = delta(k);
    if (d === null) return null;
    return (
      <span className="text-xs font-semibold ml-1.5" style={{ color: d > 0 ? "var(--pos)" : "var(--neg)" }}>
        {d > 0 ? "▲" : "▼"} {Math.abs(d).toFixed(1)}
      </span>
    );
  };

  const hist = c.history.slice(-30).filter((h) => h.overall !== null);

  return (
    <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-[var(--ink)]">Data quality</h2>
          <p className="text-xs text-[var(--ink3)] mt-0.5">
            Measured after every refresh, not asserted. Every &ldquo;correct&rdquo; check compares two
            figures produced independently of each other.
          </p>
        </div>
        <div className="text-right">
          <div className="flex items-baseline gap-0.5">
            <span className="text-3xl font-bold tabular-nums" style={{ color: tone(c.overall).fg }}>
              {c.overall ?? "—"}
            </span>
            <span className="text-sm text-[var(--ink3)]">/100</span>
            <Delta k="overall" />
          </div>
          <p className="text-[11px] text-[var(--ink3)]">{c.generated_at}</p>
        </div>
      </div>

      {/* the four dimensions, because "is the data good" is four questions */}
      <div className="mt-4 space-y-2.5">
        {DIMS.map(([key, label, note]) => {
          const v = c.parts[key]?.score;
          const t = tone(v);
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-[var(--ink)]">{label}</span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: t.fg }}>
                  {v ?? "—"}<Delta k={key} />
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--card2)] mt-1 overflow-hidden">
                <div className="h-full rounded-full transition-all"
                     style={{ width: `${v ?? 0}%`, background: t.bg, opacity: 0.85 }} />
              </div>
              <p className="text-[11px] text-[var(--ink3)] mt-0.5">{note}</p>
            </div>
          );
        })}
      </div>

      {hist.length > 1 && (
        <div className="mt-4">
          <p className="text-[11px] text-[var(--ink3)] mb-1">Last {hist.length} refreshes</p>
          <svg viewBox={`0 0 ${Math.max(hist.length - 1, 1) * 10} 40`} className="w-full h-10" preserveAspectRatio="none">
            <polyline
              fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke"
              points={hist.map((h, i) => `${i * 10},${40 - ((h.overall ?? 0) / 100) * 38}`).join(" ")}
            />
          </svg>
        </div>
      )}

      <button onClick={() => setOpen(!open)}
        className="mt-3 text-xs font-semibold text-[var(--accent-ink)]">
        {open ? "Hide the workings" : "Show the workings"}
      </button>

      {open && (
        <div className="mt-3 space-y-4 text-xs">
          <div>
            <p className="font-semibold text-[var(--ink2)] mb-1">
              Correct — each line compares two independent figures
            </p>
            {Object.entries(c.parts.correct?.checks ?? {}).map(([name, ck]) => (
              <div key={name} className="py-1 border-t border-[var(--line)]">
                <div className="flex justify-between gap-2">
                  <span className="text-[var(--ink2)]">{name}</span>
                  <span className="font-semibold tabular-nums" style={{ color: tone(ck.pct).fg }}>{ck.pct}%</span>
                </div>
                <p className="text-[var(--ink3)]">
                  {ck.agree.toLocaleString("en-IN")} of {ck.measured.toLocaleString("en-IN")} — {ck.what}
                </p>
              </div>
            ))}
          </div>
          <div>
            <p className="font-semibold text-[var(--ink2)] mb-1">Complete — by field</p>
            <div className="grid grid-cols-2 gap-x-4">
              {Object.entries(c.parts.complete?.fields ?? {}).map(([label, v]) => (
                <div key={label} className="flex justify-between gap-2 py-0.5 border-t border-[var(--line)]">
                  <span className="text-[var(--ink3)]">{label}</span>
                  <span className="tabular-nums font-semibold" style={{ color: tone(v).fg }}>{v}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
