"use client";

import { useEffect, useState } from "react";
import TopNav from "@/components/TopNav";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type Source = {
  key: string;
  name: string;
  what: string;
  cadence: string;
  covered: number;
  current: number;
  behind: number;
  pct: number;
  missing: number;
  universe: number;
  per_night: number | null;
  nights_left: number | null;
  eta: string | null;
  newest: string | null;
  oldest: string | null;
};
type Status = { generated_at: string; universe: number; sources: Source[] };

/** Days since a date, ignoring weekends — a Monday reading of Friday's data is 0. */
function tradingDaysOld(d: string | null): number | null {
  if (!d) return null;
  const then = new Date(d + "T00:00:00");
  let n = 0;
  const cur = new Date(then);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  while (cur < today) {
    cur.setDate(cur.getDate() + 1);
    if (cur.getDay() !== 0 && cur.getDay() !== 6) n++;
  }
  return n;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Green at 95%+, amber from 70, red below — the same thresholds the build guards use. */
function tone(pct: number): { bar: string; text: string; label: string } {
  if (pct >= 95) return { bar: "var(--pos)", text: "text-[var(--pos)]", label: "up to date" };
  if (pct >= 70) return { bar: "var(--warn, #d97706)", text: "text-[var(--ink2)]", label: "catching up" };
  return { bar: "var(--neg)", text: "text-[var(--neg)]", label: "behind" };
}

export default function StatusPage() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BASE}/status.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setS)
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <TopNav active="status" />
      <main className="max-w-4xl mx-auto px-4 py-5 sm:py-6 space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Data status</h1>
          <p className="text-sm text-[var(--ink3)] mt-1">
            What Rscreener holds, how fresh each part is, and where it is still catching up.
            Everything refreshes automatically each night at 22:00 IST — nothing here needs you to press anything.
          </p>
        </div>

        {err && (
          <div className="bg-[var(--neg-soft)] border border-[var(--neg-line)] text-[var(--neg)] rounded-lg p-4 text-sm">
            Could not load the status file ({err}).
          </div>
        )}
        {!s && !err && <p className="text-sm text-[var(--ink3)]">Loading…</p>}

        {s && (
          <>
            <div className="grid sm:grid-cols-3 gap-3">
              {[
                ["Companies tracked", s.universe.toLocaleString("en-IN")],
                ["Data built", s.generated_at],
                ["Refresh schedule", "Nightly, 22:00 IST"],
              ].map(([k, v]) => (
                <div key={k} className="bg-[var(--card)] border border-[var(--line)] rounded-xl px-4 py-3">
                  <p className="text-xs text-[var(--ink3)]">{k}</p>
                  <p className="text-sm font-semibold mt-0.5 text-[var(--ink)]">{v}</p>
                </div>
              ))}
            </div>

            <div className="bg-[var(--card)] border border-[var(--line)] rounded-xl px-4 py-3 flex items-start justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-[var(--ink)]">Refresh now</p>
                <p className="text-xs text-[var(--ink3)] mt-0.5 max-w-xl leading-relaxed">
                  You don&rsquo;t need to — the refresh runs by itself every night and each source below
                  shows when it reaches 100%. Use this only to pull data in sooner. It opens GitHub,
                  where you press <span className="font-medium text-[var(--ink2)]">Run workflow</span>;
                  a refresh takes roughly 30&ndash;60 minutes and the site updates itself when it finishes.
                </p>
              </div>
              <a
                href="https://github.com/RishilBhutada/rscreener/actions/workflows/nightly.yml"
                target="_blank" rel="noopener noreferrer"
                className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium bg-[var(--accent-soft)] text-[var(--accent-ink)] border border-[var(--accent-line)] hover:opacity-90"
              >
                Run refresh →
              </a>
            </div>

            <section className="bg-[var(--card)] rounded-xl border border-[var(--line)] overflow-hidden">
              {s.sources.map((src, i) => {
                const t = tone(src.pct);
                const age = tradingDaysOld(src.newest);
                return (
                  <div key={src.key} className={`px-4 py-3.5 ${i ? "border-t border-[var(--line)]" : ""}`}>
                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <h2 className="text-base font-semibold text-[var(--ink)]">{src.name}</h2>
                      <span className={`text-xs font-medium ${t.text}`}>
                        {src.pct}% {t.label}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--ink3)] mt-0.5">{src.what}</p>

                    <div className="h-1.5 bg-[var(--card2)] rounded-full mt-2.5 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${src.pct}%`, background: t.bar }} />
                    </div>

                    <div className="flex gap-x-5 gap-y-1 flex-wrap mt-2 text-xs text-[var(--ink3)] tabular-nums">
                      <span>
                        <span className="text-[var(--ink2)] font-medium">{src.current.toLocaleString("en-IN")}</span>
                        {" of "}{src.universe.toLocaleString("en-IN")} companies current
                      </span>
                      <span>newest: <span className="text-[var(--ink2)]">{fmtDate(src.newest)}</span>
                        {age !== null && age > 0 && ` (${age} trading day${age === 1 ? "" : "s"} ago)`}</span>
                      {src.behind > 0 && (
                        <span className="text-[var(--neg)]">{src.behind.toLocaleString("en-IN")} out of date</span>
                      )}
                      {src.missing > 0 && (
                        <span className="text-[var(--neg)]">{src.missing.toLocaleString("en-IN")} not fetched yet</span>
                      )}
                      <span>refreshes {src.cadence}</span>
                      {src.nights_left === 0 ? (
                        <span className="text-[var(--pos)]">complete</span>
                      ) : src.nights_left ? (
                        <span className="text-[var(--ink2)]">
                          100% in {src.nights_left} night{src.nights_left === 1 ? "" : "s"} — by {fmtDate(src.eta)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </section>

            <p className="text-xs text-[var(--ink3)] leading-relaxed">
              &ldquo;Current&rdquo; means a company is no more than one reporting period behind the newest data we hold.
              A company reporting on its own schedule is not counted as stale; one that has genuinely stopped
              updating is. If a source sits below 95% for more than a few days, something has broken — the build
              also refuses to publish stale prices or a chart that lost history, so a failure stops the release
              rather than quietly shipping.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
