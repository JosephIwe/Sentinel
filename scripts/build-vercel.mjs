/**
 * Vercel production build - Build Output API v3.
 *
 * WHY THIS EXISTS
 * ---------------
 * Vercel's zero-config Node runtime compiles `api/index.ts` with
 * `ts.transpileModule`, which is transpile-only: it neither bundles nor
 * rewrites module specifiers. Combined with `"type": "module"` in package.json,
 * the emitted `/var/task/api/index.js` is native ESM containing the source's
 * extensionless import verbatim:
 *
 *     import { app } from "../server";
 *
 * Node's ESM resolver - unlike CommonJS, tsx, Vite and esbuild's bundler - does
 * not append `.js`, so every request died during module loading with:
 *
 *     Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/var/task/server'
 *     imported from /var/task/api/index.js
 *
 * `server.ts` and its dependency tree contain ~83 further extensionless
 * relative imports, so fixing individual specifiers would only move the error
 * one level down.
 *
 * This script instead emits the Build Output API v3 directory itself. Vercel
 * consumes `.vercel/output/` directly, so the zero-config detector, the
 * TypeScript transpile step and the file tracer are all bypassed: the deployed
 * function is a single self-contained ESM bundle with no relative imports left
 * to resolve and no `node_modules` requirement.
 *
 * Application source is deliberately untouched - `api/index.ts` is used as-is
 * as the bundle entry point, and it still exports the same Express app.
 *
 * OUTPUT
 * ------
 *   .vercel/output/config.json
 *   .vercel/output/static/**                         <- `vite build` output
 *   .vercel/output/functions/api/index.func/index.mjs
 *   .vercel/output/functions/api/index.func/.vc-config.json
 */
import { build as esbuild } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const outputDir = path.join(rootDir, ".vercel", "output");
const staticDir = path.join(outputDir, "static");
const functionDir = path.join(outputDir, "functions", "api", "index.func");

// Vercel's Node runtime for this project. Kept in sync with the `engines`-free
// package.json by pinning explicitly rather than inheriting a moving default.
const NODE_RUNTIME = "nodejs22.x";

function log(message) {
  console.log(`[build-vercel] ${message}`);
}

// 1. Start from a clean output tree so stale artifacts can never be deployed.
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(functionDir, { recursive: true });

// 2. Frontend. Identical to the previous `vite build`, only redirected into the
//    Build Output static directory instead of `dist/`. `npm run build` still
//    writes to `dist/` and is unaffected.
log("building frontend with vite");
execFileSync(
  process.execPath,
  [
    path.join(rootDir, "node_modules", "vite", "bin", "vite.js"),
    "build",
    "--outDir",
    path.relative(rootDir, staticDir),
    "--emptyOutDir"
  ],
  { cwd: rootDir, stdio: "inherit" }
);

// 3. Serverless function. `api/index.ts` is bundled - not transpiled - so every
//    relative specifier in the `server.ts` dependency tree is resolved at build
//    time and nothing is left for Node's ESM resolver to look up.
log("bundling serverless function from api/index.ts");
await esbuild({
  entryPoints: [path.join(rootDir, "api", "index.ts")],
  outfile: path.join(functionDir, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // The dev-only Vite import in server.ts is unreachable under
  // NODE_ENV=production; stubbing it keeps Vite, Rollup and their native
  // binaries out of the function. See scripts/vite-stub.mjs.
  alias: { vite: path.join(scriptDir, "vite-stub.mjs") },
  // esbuild inlines CommonJS dependencies (Express, dotenv, @google/genai) into
  // an ESM output, which needs a `require` shim that ESM does not provide.
  banner: {
    js: "import{createRequire as __nodeCreateRequire}from'node:module';const require=__nodeCreateRequire(import.meta.url);"
  },
  logLevel: "info"
});

// 4. Function configuration. `shouldAddHelpers` stays off so Vercel does not
//    pre-parse request bodies - Express does its own parsing, and enabling the
//    helpers would change request handling.
writeFileSync(
  path.join(functionDir, ".vc-config.json"),
  `${JSON.stringify(
    {
      runtime: NODE_RUNTIME,
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false
    },
    null,
    2
  )}\n`
);

// 5. Routing. Mirrors the rewrites previously declared in vercel.json.
//    `handle: filesystem` comes first so static assets and the function itself
//    win before any rewrite, matching how Vercel orders `rewrites` today. The
//    SPA fallback stays last so it only catches genuine misses.
writeFileSync(
  path.join(outputDir, "config.json"),
  `${JSON.stringify(
    {
      version: 3,
      routes: [
        { handle: "filesystem" },
        { src: "/api/(.*)", dest: "/api/index" },
        { src: "/health", dest: "/api/index" },
        { src: "/ready", dest: "/api/index" },
        { src: "/version", dest: "/api/index" },
        { src: "/docs", dest: "/api/index" },
        { src: "/(.*)", dest: "/index.html" }
      ]
    },
    null,
    2
  )}\n`
);

log(`done -> ${path.relative(rootDir, outputDir)}`);
