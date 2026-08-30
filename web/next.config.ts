import { execSync } from "node:child_process";

/** Stamped from git at build time. A static export cannot ask a server when it
 *  was built, and "when did the app last change" is a question the Settings
 *  page should be able to answer without sending anyone to GitHub. */
function git(cmd: string): string {
  try { return execSync(cmd, { encoding: "utf8" }).trim(); } catch { return ""; }
}
const BUILD_TIME = new Date().toISOString();
const BUILD_COMMIT = git("git rev-parse --short HEAD");
const BUILD_SUBJECT = git("git log -1 --format=%s");

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
