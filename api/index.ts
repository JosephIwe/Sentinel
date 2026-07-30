/**
 * Vercel serverless entry point for the Sentinel API.
 *
 * Vercel does not run `npm start`, so the Express server in `server.ts` is
 * never executed by a plain Vite deployment - the build output is served as
 * static files and every `/api/*` request falls through to Vercel's own
 * platform handler. That is what produced the "[object Object]" pipeline
 * error in the UI: Vercel answers with `{ error: { code, message } }`, and
 * the frontend stringified that nested object.
 *
 * This module hands Vercel the very same Express app the local server and the
 * test suite use. `server.ts` already exports it, and skips its own
 * `app.listen()` bootstrap when `VERCEL` is set, because the serverless
 * runtime provides the listener.
 *
 * Routing is declared in `vercel.json`; nothing here duplicates it.
 */
import { app } from "../server";

export default app;
