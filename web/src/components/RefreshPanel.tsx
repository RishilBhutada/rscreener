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

const WORKFLOW_ID = 311180536;
const DISPATCH_API = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`;
const TOKEN_KEY = "rscreener_gh_token";

/** Starting a workflow is a WRITE, and GitHub requires a token for it. Reading run
 *  status needs nothing because the repository is public, but this side cannot be
 *  done anonymously by anyone, which is the whole point.
 *
 *  The token is typed in by the owner, kept in this browser's localStorage, and
 *  sent only to api.github.com. It is never in the source, never committed, and
 *  never reaches any server of ours - there isn't one. That is the only safe
 *  shape for this on a static site: a token baked into the published JavaScript
 *  would hand write access to the repository to anyone who opened the page.
 *
 *  Scope it to Actions: Read and write on THIS repository alone. Then the worst a
 *  leak can do is start a data refresh. */
function loadToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}
function saveToken(v: string) {
  try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
}

const SCOPES: [string, string][] = [
  ["everything", "Every source, then rebuild and publish. What the nightly run does."],
  ["prices and snapshot only", "Prices, ratios, 52-week range. Quickest — use when a price looks wrong."],
  ["earnings and results only", "Quarterly and annual filings, declaration dates, shareholding."],
  ["corporate actions only", "Dividends, bonuses, splits, rights."],
  ["rebuild and publish only (no fetching)", "Re-exports and redeploys from data already held. Minutes, not hours."],
];

export default function RefreshPanel() {
  const { runs, err, reload } = useRuns();
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [scope, setScope] = useState("everything");
  const [syms, setSyms] = useState("");
  const [deep, setDeep] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => { setToken(loadToken()); }, []);

  const start = async () => {
    setSending(true); setSendMsg(null);
    try {
      const res = await fetch(DISPATCH_API, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: { scope, symbols: syms.trim(), deep: deep ? "true" : "false" },
        }),
      });
      if (res.status === 204) {
        setSendMsg("Started. It appears below within a few seconds.");
        setTimeout(reload, 4000);
        setTimeout(reload, 12000);
      } else if (res.status === 401 || res.status === 403) {
        setSendMsg("GitHub rejected the token. It needs Actions: Read and write on this repository.");
      } else {
        setSendMsg(`GitHub returned ${res.status}. Nothing was started.`);
      }
    } catch (e) {
      setSendMsg(`Could not reach GitHub (${String(e)}). Nothing was started.`);
    } finally {
      setSending(false);
    }
  };

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
        <p className="text-sm text-[var(--ink2)]">Start a run</p>

        {token ? (
          <>
            <div className="mt-2.5 space-y-2">
              <label className="block">
                <span className="text-xs text-[var(--ink3)]">What to refresh</span>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[var(--ink)] px-2.5 py-2 text-sm"
                >
                  {SCOPES.map(([name]) => <option key={name} value={name}>{name}</option>)}
                </select>
                <span className="block text-xs text-[var(--ink3)] mt-1">
                  {SCOPES.find(([n]) => n === scope)?.[1]}
                </span>
              </label>

              <label className="block">
                <span className="text-xs text-[var(--ink3)]">
                  Only these companies <span className="opacity-70">(comma separated, blank = all)</span>
                </span>
                <input
                  value={syms}
                  onChange={(e) => setSyms(e.target.value)}
                  placeholder="CEMPRO, DIXON"
                  className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--card2)] text-[var(--ink)]
                             px-2.5 py-2 text-sm placeholder:text-[var(--ink3)]"
                />
              </label>

              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={deep} onChange={() => setDeep(!deep)}
                  className="mt-0.5 accent-[var(--accent)] cursor-pointer" />
                <span className="text-xs text-[var(--ink2)]">
                  Full history depth
                  <span className="block text-[var(--ink3)]">
                    Fetches a company&rsquo;s entire filing history rather than its recent quarters. Slow across the
                    whole universe &mdash; pair it with a symbol list. This is the fix for a ratio chart that starts
                    years after the price does.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button
                onClick={start}
                disabled={sending}
                className="rounded-lg px-3.5 py-2 text-sm font-medium bg-[var(--accent-soft)] text-[var(--accent-ink)]
                           border border-[var(--accent-line)] hover:opacity-90 disabled:opacity-50"
              >
                {sending ? "Starting\u2026" : "Run now"}
              </button>
              <button
                onClick={() => { saveToken(""); setToken(""); setSendMsg(null); }}
                className="text-xs text-[var(--ink3)] hover:text-[var(--ink)]"
              >
                forget token
              </button>
              {sendMsg && <span className="text-xs text-[var(--ink2)]">{sendMsg}</span>}
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-[var(--ink3)] mt-1 leading-relaxed">
              Runs can be started from here rather than on GitHub, but starting one is a write and GitHub requires a
              token for it. Reading the status above needs none, because the repository is public.
            </p>
            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setShowSetup(!showSetup)}
                className="rounded-lg px-3 py-2 text-sm font-medium bg-[var(--accent-soft)] text-[var(--accent-ink)]
                           border border-[var(--accent-line)]"
              >
                Set up one-click refresh
              </button>
              <a href={DISPATCH_UI} target="_blank" rel="noopener noreferrer"
                className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--ink2)] border border-[var(--line)] hover:bg-[var(--card2)]">
                or run it on GitHub &rarr;
              </a>
            </div>

            {showSetup && (
              <div className="mt-3 rounded-xl border border-[var(--line2)] bg-[var(--card2)] p-3.5 text-xs leading-relaxed">
                <p className="text-[var(--ink2)] font-medium">One-time setup</p>
                <ol className="mt-1.5 space-y-1 text-[var(--ink3)] list-decimal pl-4">
                  <li>
                    Open{" "}
                    <a className="text-[var(--accent-ink)] hover:underline" target="_blank" rel="noopener noreferrer"
                      href="https://github.com/settings/personal-access-tokens/new">
                      GitHub &rarr; fine-grained tokens
                    </a>
                  </li>
                  <li>Repository access: <span className="text-[var(--ink2)]">Only select repositories &rarr; rscreener</span></li>
                  <li>Permissions: <span className="text-[var(--ink2)]">Actions &rarr; Read and write</span>. Nothing else.</li>
                  <li>Generate it, then paste it below.</li>
                </ol>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="github_pat_..."
                  autoComplete="off"
                  className="mt-2.5 w-full rounded-lg border border-[var(--line)] bg-[var(--card)] text-[var(--ink)]
                             px-2.5 py-2 placeholder:text-[var(--ink3)]"
                />
                <button
                  onClick={() => { saveToken(tokenInput.trim()); setToken(tokenInput.trim()); setTokenInput(""); setShowSetup(false); }}
                  disabled={!tokenInput.trim()}
                  className="mt-2 rounded-lg px-3 py-1.5 font-medium bg-[var(--accent-soft)] text-[var(--accent-ink)]
                             border border-[var(--accent-line)] disabled:opacity-40"
                >
                  Save in this browser
                </button>
                <p className="mt-2 text-[var(--ink3)]">
                  It stays in this browser and is sent only to github.com. It is never in the app&rsquo;s code and never
                  reaches any server of ours &mdash; there isn&rsquo;t one. Scoped as above, the worst a leak could do is
                  start a data refresh. Use <span className="text-[var(--ink2)]">forget token</span> to remove it, or
                  revoke it on GitHub at any time.
                </p>
              </div>
            )}
          </>
        )}
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
