"use client";

import { useCallback, useEffect, useState } from "react";

const REPO = "RishilBhutada/rscreener";
const WORKFLOW = "nightly.yml";
const RUNS_API = `https://api.github.com/repos/${REPO}/actions/workflows/311180536/runs?per_page=5`;
const DISPATCH_UI = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;

type Run = {
  id: number;
  status: string;               // queued | in_progress | completed
  conclusion: string | null;    // success | failure | cancelled | null
  created_at: string;
  run_started_at?: string;
  updated_at: string;
  html_url: string;
  event: string;
  display_title: string;
};

/** The refresh is a GitHub Actions workflow, and the repository is public, so its
 *  state can be read straight from the API with no token and nothing to leak.
 *  Before this, a failed or cancelled run was invisible unless you went looking -
 *  last night's was cancelled and nothing on the site said so. */
function useRuns() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(RUNS_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GitHub returned ${r.status}`))))
      .then((d) => { setRuns(d.workflow_runs ?? []); setErr(null); })
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    load();
    // poll only while something is actually running, so an idle page is quiet
    const id = setInterval(() => {
      setRuns((cur) => {
        if (cur && cur[0] && cur[0].status === "completed") return cur;
        load();
        return cur;
      });
    }, 20000);
    return () => clearInterval(id);
  }, [load]);

  return { runs, err, reload: load };
}

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function nextRun(): string {
  // 22:00 IST = 16:30 UTC
  const now = new Date();
  const n = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 16, 30));
  if (n.getTime() <= now.getTime()) n.setUTCDate(n.getUTCDate() + 1);
  const mins = Math.round((n.getTime() - now.getTime()) / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

const TONE: Record<string, { text: string; dot: string; label: string }> = {
  in_progress: { text: "text-[var(--accent-ink)]", dot: "var(--accent)", label: "running now" },
  queued: { text: "text-[var(--accent-ink)]", dot: "var(--accent)", label: "queued" },
  success: { text: "text-[var(--pos)]", dot: "var(--pos)", label: "succeeded" },
  failure: { text: "text-[var(--neg)]", dot: "var(--neg)", label: "FAILED" },
  cancelled: { text: "text-[var(--ink2)]", dot: "var(--ink3)", label: "cancelled" },
};

const SCOPES: [string, string][] = [
  ["everything", "Every source, then rebuild and publish. What the nightly run does."],
  ["prices and snapshot only", "Prices, ratios, 52-week range. Quickest — use when a price looks wrong."],
  ["earnings and results only", "Quarterly and annual filings, declaration dates, shareholding."],
  ["corporate actions only", "Dividends, bonuses, splits, rights."],
  ["rebuild and publish only (no fetching)", "Re-exports and redeploys from data already held. Minutes, not hours."],
];

export default function RefreshPanel() {
  const { runs, err, reload } = useRuns();
  const latest = runs?.[0];
  const live = latest && latest.status !== "completed";
  const key = live ? latest.status : (latest?.conclusion ?? "");
  const tone = TONE[key];

  return (
    <section className="bg-[var(--card)] border border-[var(--line)] rounded-xl overflow-hidden">
      <div className="px-4 py-3.5 border-b border-[var(--line)]">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-base font-semibold text-[var(--ink)]">Refresh</h2>
          <span className="text-xs text-[var(--ink3)]">next automatic run {nextRun()} · 22:00 IST daily</span>
        </div>

        {err && (
          <p className="text-xs text-[var(--ink3)] mt-2">
            Could not reach GitHub to read the run status ({err}). The schedule is unaffected.
          </p>
        )}

        {latest && tone && (
          <div className="mt-2.5 flex items-center gap-2 flex-wrap text-sm">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: tone.dot }} />
            <span className={`font-semibold ${tone.text}`}>Last run {tone.label}</span>
            <span className="text-[var(--ink3)] text-xs">
              {ago(latest.created_at)} · started {latest.event === "schedule" ? "on schedule" : "by hand"}
            </span>
            <a href={latest.html_url} target="_blank" rel="noopener noreferrer"
              className="text-xs text-[var(--accent-ink)] hover:underline">open in GitHub →</a>
            {live && (
              <button onClick={reload} className="text-xs text-[var(--ink3)] hover:text-[var(--ink)]">refresh status</button>
            )}
          </div>
        )}

        {latest?.conclusion === "failure" && (
          <p className="text-xs text-[var(--neg)] mt-1.5 leading-relaxed">
            The data did not update. The site is still showing the last good data rather than wrong data —
            the guards stop a bad release instead of publishing it.
          </p>
        )}
      </div>

      <div className="px-4 py-3.5">
        <p className="text-sm text-[var(--ink2)]">Start a run yourself</p>
        <p className="text-xs text-[var(--ink3)] mt-0.5 leading-relaxed">
          You don&rsquo;t need to — the schedule covers it. Use this to pull something in sooner, or to chase one
          company. Each opens GitHub, where you press <span className="text-[var(--ink2)] font-medium">Run workflow</span>,
          pick the scope, and optionally name symbols.
        </p>

        <div className="mt-3 space-y-1.5">
          {SCOPES.map(([name, what]) => (
            <a
              key={name}
              href={DISPATCH_UI}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-[var(--line)] px-3 py-2 hover:border-[var(--line2)] hover:bg-[var(--card2)]"
            >
              <span className="text-sm text-[var(--ink)] font-medium">{name}</span>
              <span className="block text-xs text-[var(--ink3)] mt-0.5">{what}</span>
            </a>
          ))}
        </div>

        <p className="text-xs text-[var(--ink3)] mt-3 leading-relaxed">
          Two options worth knowing. <span className="text-[var(--ink2)]">Symbols</span> limits the run to the
          companies you name, so chasing one stock takes a minute instead of an hour.{" "}
          <span className="text-[var(--ink2)]">Full history depth</span> fetches a company&rsquo;s entire filing history
          rather than its recent quarters — the fix for a ratio chart that starts years after the price does.
        </p>
      </div>

      {runs && runs.length > 1 && (
        <div className="px-4 pb-3.5">
          <p className="text-xs text-[var(--ink3)] mb-1.5">Recent runs</p>
          <div className="space-y-1">
            {runs.slice(0, 5).map((r) => {
              const k = r.status !== "completed" ? r.status : (r.conclusion ?? "");
              const tn = TONE[k];
              return (
                <a key={r.id} href={r.html_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs hover:underline">
                  <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: tn?.dot ?? "var(--ink3)" }} />
                  <span className={tn?.text ?? "text-[var(--ink3)]"}>{tn?.label ?? k}</span>
                  <span className="text-[var(--ink3)]">{ago(r.created_at)}</span>
                  <span className="text-[var(--ink3)] truncate">· {r.event === "schedule" ? "scheduled" : "manual"}</span>
                </a>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
