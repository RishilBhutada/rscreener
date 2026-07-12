"use client";

import { useMemo, useState } from "react";
import { FIELD_CATALOG, FIELD_GROUPS } from "@/lib/fields";

type Cond = { field: string; op: string; value: string };
const OPS = ["<", ">", "<=", ">=", "=", "!="];
const OP_LABELS: Record<string, string> = {
  "<": "less than", ">": "more than", "<=": "at most", ">=": "at least", "=": "equals", "!=": "is not",
};

const STARTERS: { label: string; conds: Cond[] }[] = [
  { label: "Quality compounders", conds: [{ field: "roce", op: ">", value: "20" }, { field: "sales_cagr_5y", op: ">", value: "12" }, { field: "de", op: "<", value: "0.5" }] },
  { label: "Cheap vs own history", conds: [{ field: "pe", op: "<", value: "20" }, { field: "median_pe_5y", op: ">", value: "25" }] },
  { label: "Dividend payers", conds: [{ field: "div_yield", op: ">", value: "3" }, { field: "div_payout", op: "<", value: "70" }] },
  { label: "Beaten-down quality", conds: [{ field: "off_52w_high", op: "<", value: "-30" }, { field: "roce", op: ">", value: "18" }] },
];

export default function QueryBuilder({ onRun }: { onRun: (query: string) => void }) {
  const [conds, setConds] = useState<Cond[]>([{ field: "roce", op: ">", value: "20" }]);
  const [joiner, setJoiner] = useState<"and" | "or">("and");

  const query = useMemo(
    () =>
      conds
        .filter((c) => c.field && c.op && c.value.trim() !== "" && !Number.isNaN(parseFloat(c.value)))
        .map((c) => `${c.field} ${c.op} ${parseFloat(c.value)}`)
        .join(` ${joiner} `),
    [conds, joiner]
  );

  const update = (i: number, patch: Partial<Cond>) =>
    setConds(conds.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const fieldDef = (key: string) => FIELD_CATALOG.find((f) => f.key === key);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {STARTERS.map((s) => (
          <button
            key={s.label}
            onClick={() => { setConds(s.conds.map((c) => ({ ...c }))); setJoiner("and"); }}
            className="text-xs bg-[var(--card2)] hover:bg-[var(--accent-soft)] border border-[var(--line)] rounded-full px-3 py-1 text-[var(--ink2)]"
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {conds.map((c, i) => {
          const def = fieldDef(c.field);
          return (
            <div key={i} className="flex items-center gap-2 flex-wrap">
              {i > 0 && (
                <button
                  onClick={() => setJoiner(joiner === "and" ? "or" : "and")}
                  className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-ink)] bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded-full px-2.5 py-0.5"
                  title="Tap to switch between AND / OR (applies between all rows)"
                >
                  {joiner}
                </button>
              )}
              <select
                value={c.field}
                onChange={(e) => update(i, { field: e.target.value })}
                className="text-sm border border-[var(--line2)] bg-[var(--card)] text-[var(--ink)] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              >
                {FIELD_GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {FIELD_CATALOG.filter((f) => f.group === g).map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <select
                value={c.op}
                onChange={(e) => update(i, { op: e.target.value })}
                className="text-sm border border-[var(--line2)] bg-[var(--card)] text-[var(--ink)] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                aria-label="comparison"
              >
                {OPS.map((o) => (
                  <option key={o} value={o}>{OP_LABELS[o]}</option>
                ))}
              </select>
              <input
                value={c.value}
                onChange={(e) => update(i, { value: e.target.value })}
                inputMode="decimal"
                placeholder="value"
                className="w-24 text-sm border border-[var(--line2)] bg-[var(--card)] text-[var(--ink)] rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                aria-label="value"
              />
              {def && <span className="text-xs text-[var(--ink3)]">{def.unit}</span>}
              <button
                onClick={() => setConds(conds.filter((_, j) => j !== i))}
                aria-label="remove condition"
                className="text-[var(--ink3)] hover:text-[var(--neg)] text-lg leading-none px-1"
              >
                ×
              </button>
              {def && <p className="w-full text-xs text-[var(--ink3)] -mt-1 mb-1 pl-1 sm:hidden">{def.desc}</p>}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setConds([...conds, { field: "pe", op: "<", value: "" }])}
          className="text-sm font-semibold text-[var(--accent-ink)] hover:underline"
        >
          + Add condition
        </button>
        {conds.length > 0 && fieldDef(conds[conds.length - 1].field) && (
          <span className="text-xs text-[var(--ink3)] hidden sm:inline">
            {fieldDef(conds[conds.length - 1].field)!.desc}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => query && onRun(query)}
          disabled={!query}
          className="bg-[var(--accent)] hover:bg-[var(--accent-strong)] disabled:opacity-40 text-white text-sm font-semibold px-5 py-2 rounded-lg"
        >
          Run screen
        </button>
        {query && <code className="text-xs font-mono text-[var(--ink3)] break-all">{query}</code>}
      </div>
    </div>
  );
}
