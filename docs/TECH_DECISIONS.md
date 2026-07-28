# Technical Decisions

Decisions and conventions established so far, and why. Update this file when a new one is made, rather than rediscovering it from code each session.

## Only ship connectors backed by a real external source

Three connectors (Google Search, legacy GitHub, News) were removed wholesale (2026-07-16) because they fabricated data — invented repositories, press coverage, and search results — and presented it as verified, high-confidence evidence. This is treated as the project's central trust invariant: a connector may return `NO_DATA` or `ERROR`, but it must never synthesize evidence. A `verified` flag is carried through connector results and evidence structurally, so unverified data is rejected before it can reach a report rather than relying on keyword filtering.

## Connectors ship one at a time

New connectors follow `docs/CONNECTOR_RELEASE_CHECKLIST.md`: implement → verify `SUCCESS`/`NO_DATA`/`ERROR` semantics → diagnostics → evidence validation → unit + integration tests → `npm test` + `npm run build` → real-domain smoke test → update README/CHANGELOG/`docs/CONNECTOR_SCORECARD.md` → PR → squash merge → alpha tag. This is deliberate: it's what caught the fabricated-data connectors and is meant to prevent a repeat.

## AI synthesis is optional; determinism is not

Gemini (`@google/genai`) synthesizes the executive summary and key findings, but every AI-generated statement passes through `ValidationService`'s `HallucinationDetector`, which cross-checks claims against verified entity/evidence IDs and strips or flags anything unsupported. If no `GEMINI_API_KEY` is configured, or the model call fails, the system falls back to a fully deterministic report generator rather than degrading report availability. Confidence and risk scores are never inferred by the model — they come from an explicit, auditable rule set in `src/config/scoringRules.json` (`ScoringService`), specifically so score derivation can be audited without re-running the model.

## Resilience is per-connector, not global

Each connector gets its own timeout, exponential-backoff retry policy, and circuit breaker, and runs concurrently with the others per investigation. The intent is that one flaky upstream (e.g. WHOIS port 43 blocked by a firewall, GitHub's 60 req/hour unauthenticated rate limit) degrades that one connector's evidence, not the whole investigation. Distinguishing a genuine "no data" from "upstream failed" is treated as a correctness requirement, not cosmetic — see the WHOIS-fallback scoring bug and GitHub rate-limit/`NO_DATA` conflation, both fixed as v1.0.0 launch blockers.

## SSRF protection is mandatory for any user-input-triggered outbound fetch

Any code path that constructs an outbound request from user-supplied input (the GitHub-discovery homepage fetch is the current example) must go through `src/utils/ssrfGuard.ts` (`safeFetch`), which resolves and checks the target IP against private/loopback/link-local/cloud-metadata ranges before connecting, and re-checks on redirect. This was a launch blocker (a "domain" investigation could otherwise be used to probe internal networks or cloud metadata endpoints) and is now a standing rule for new connectors that fetch user-controlled hosts.

## Single deployable, TypeScript throughout

Express (API) and React 19 + Vite (frontend) are served from the same process/port in dev (`npm run dev` via `tsx server.ts`) and bundled together for production: Vite builds the client, esbuild bundles `server.ts` to a single CJS file (`npm run build` → `dist/`). No separate frontend deployment or BFF layer. Chosen for deployment simplicity at the current stage (single Cloud Run–style container), not for scale — `DEPLOYMENT.md` and `VERSION.md` both anticipate this changing only once a persistent backing store is introduced.

## State is in-memory for now, by explicit, disclosed choice

API keys, investigation history, and async job state (`server.ts`, `src/services/investigationWorker.ts`) live in-memory. This is a known, documented limitation (`VERSION.md`), not an oversight — the architecture is written so it can be swapped for Postgres/Firestore without changing call sites, but that migration hasn't started. Don't "fix" this incidentally as part of unrelated work; it's tracked as a deliberate post-launch item in `RELEASE_CHECKLIST.md`.

## Rate limiting is store-agnostic by design

`utils/rate-limiter.ts` implements sliding-window rate limiting keyed by API key or client IP with an in-memory store today, but the interface is meant to accept a Redis-backed store later without changing the call site or `DistributedRateLimiter.check`'s public signature. Currently process-local, so horizontally-scaled deployments don't share limiter state across nodes — documented, not yet fixed.
