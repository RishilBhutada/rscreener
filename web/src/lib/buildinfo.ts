/** When this build was made, and from which commit.
 *
 *  Settings shows it so "is my app up to date" is answerable without opening
 *  GitHub. Injected at build time by next.config.ts from git, because a static
 *  export has no server to ask at runtime.
 */
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";
export const BUILD_COMMIT = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "";
export const BUILD_SUBJECT = process.env.NEXT_PUBLIC_BUILD_SUBJECT ?? "";
