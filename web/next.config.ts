import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

/** Stamped from git at build time. A static export cannot ask a server when it
 *  was built, and "when did the app last change" is a question the Settings
 *  page should be able to answer without sending anyone to GitHub. */
function git(cmd: string): string {
  try { return execSync(cmd, { encoding: "utf8" }).trim(); } catch { return ""; }
}
// CI overrides these. The nightly checks out main, fetches for hours, and then
// moves ONLY web/src and the build files forward to the newest commit - HEAD
// stays at whatever main was when the run started. So `git rev-parse HEAD` on
// the runner names a commit whose code is not the code being built, and
// Settings would answer "when did the app last change" with the wrong change.
// The workflow passes the commit it actually built from instead.
// When the CODE last changed, not when the site was last built. This site
// rebuilds every night whether or not anything changed, so a build timestamp
// made "Last changed" advance daily on its own - it read today's date every
// day, which is the least useful answer to the question it claims to answer.
// The workflow supplies the commit date of the last non-housekeeping commit;
// a local build has no such notion and falls back to now.
const BUILD_TIME = process.env.RS_BUILD_TIME || new Date().toISOString();
const BUILD_COMMIT = process.env.RS_BUILD_COMMIT || git("git rev-parse --short HEAD");
const BUILD_SUBJECT = process.env.RS_BUILD_SUBJECT || git("git log -1 --format=%s");

// A file saying which build is live, written where the values are already
// known. The refresh button fetches it with the cache bypassed and compares it
// against the commit baked into the running bundle, so it can say "you already
// have the latest" instead of reloading and leaving you none the wiser. Tiny on
// purpose: it is fetched to answer one question.
try {
  mkdirSync("public", { recursive: true });
  writeFileSync(
    "public/version.json",
    JSON.stringify({ commit: BUILD_COMMIT, built: BUILD_TIME, subject: BUILD_SUBJECT }),
  );
} catch {
  // No version file means the button falls back to reloading unconditionally,
  // which is what it did before this existed.
}

// The app's update history (owner, 14-Nov-2026): after each update the app
// says what changed, and Settings keeps a numbered list for the last year.
// One update = one change to the app's code: housekeeping commits ([skip ci]),
// data snapshots ("data: ..."), review notes and merges are left out. Numbered
// across the WHOLE history, oldest first, so a number never changes as the
// one-year window moves on. A commit may carry a plain-language line,
// "What's new: ...", in its message; the subject line stands in otherwise.
// CI passes RS_UPDATES_REF (the commit being built; the checkout's HEAD can be
// older) and fetches the full history, without file contents, for numbering.
function writeUpdates() {
  const ref = process.env.RS_UPDATES_REF || "HEAD";
  let raw = "";
  try {
    raw = execSync(`git log ${ref} --no-merges --reverse --format=%h%x1f%cI%x1f%s%x1f%b%x1e`,
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch { return; }
  const skip = /\[skip ci\]|^(Nightly:|Merge |data:|Review status)/i;
  const all: { n: number; sha: string; at: string; text: string }[] = [];
  for (const rec of raw.split("\x1e")) {
    const [sha, at, subject, body] = rec.replace(/^\n+/, "").split("\x1f");
    if (!sha || !subject || skip.test(subject)) continue;
    const note = (body ?? "").split("\n").map((l) => l.trim()).find((l) => /^what's new:/i.test(l));
    const text = (note ? note.replace(/^what's new:\s*/i, "") : subject).slice(0, 240);
    all.push({ n: all.length + 1, sha, at, text });
  }
  const since = Date.now() - 366 * 86400000;
  const year = all.filter((u) => Date.parse(u.at) >= since).reverse();
  try {
    writeFileSync("public/updates.json", JSON.stringify({ latest: all.length, updates: year }));
  } catch { /* no list: the What's new card and the Settings list simply stay hidden */ }
}
writeUpdates();

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_TIME: BUILD_TIME,
    NEXT_PUBLIC_BUILD_COMMIT: BUILD_COMMIT,
    NEXT_PUBLIC_BUILD_SUBJECT: BUILD_SUBJECT,
  },
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
