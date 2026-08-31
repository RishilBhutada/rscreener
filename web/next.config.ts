import { execSync } from "node:child_process";

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
