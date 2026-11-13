// Lets the tests import app modules that use the "@/..." path (tsconfig
// "paths": "@/*" -> "./src/*"), which Node's own resolver does not know.
// Loaded before the tests by `node --import ./tests/alias.mjs` (package.json).
// Only .ts files: Node strips types but cannot run JSX, so a .tsx module is
// out of reach of these tests either way.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";

const SRC = new URL("../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      const file = new URL(specifier.slice(2) + ".ts", SRC);
      if (existsSync(file)) return next(file.href, context);
    }
    return next(specifier, context);
  },
});
