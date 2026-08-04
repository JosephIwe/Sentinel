/**
 * Build-only stub that replaces the `vite` package inside the Vercel
 * serverless bundle.
 *
 * `server.ts` imports Vite's `createServer` so that `npm run dev` can mount the
 * dev middleware, but that branch is guarded by `NODE_ENV !== "production"` and
 * is therefore unreachable in the deployed function. Without this stub esbuild
 * would still have to follow the import and pull Vite, Rollup and esbuild -
 * including Rollup's platform-specific native binaries - into the production
 * artifact.
 *
 * Aliasing `vite` to this module keeps the serverless bundle self-contained.
 * Nothing here ever runs in production; the throw exists so that a future
 * change which *does* reach this path fails loudly instead of silently.
 *
 * This file is consumed only by scripts/build-vercel.mjs. It is not imported by
 * the application, the dev server, or the test suite.
 */
export function createServer() {
  throw new Error(
    "The Vite dev server is not available in the Vercel serverless build. " +
      "This code path is development-only and should never execute in production."
  );
}
