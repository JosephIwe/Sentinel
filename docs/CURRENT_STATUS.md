# Current Status

_Last reviewed: 2026-07-28, after Milestone 0 implementation, against the working tree on `claude/project-memory-review-cqx488`. Supersedes the earlier same-day version of this file (pre-Milestone-0)._

## Release state

- Declared version: `1.0.0-rc.1` (`package.json`, `VERSION.md`, README badge). `GET /version` still returns hardcoded `"1.0.0"` — drift between the two (Known Issues #21). Not yet fixed.
- No `v1.0.0` tag cut yet. Private-beta access gate is live in front of the web UI.

## Verified build health (ran directly, not inferred from docs)

- `npm run test`: **240/240 tests pass** across 21 files (was 229/20 before Milestone 0 — added `tests/observability.test.ts` and a `cross-tenant isolation` describe block to `tests/server.test.ts`).
- `npm run lint` (`tsc --noEmit`): clean, zero errors.
- `npm run build`: succeeds. Client ~395kB JS (gzip ~101kB) + ~81kB CSS (gzip ~13kB); server bundle ~247kB.
- The `tests/investigation-rate-limit.test.ts` teardown-race warning (Known Issues #14) seen in the original audit run did not reproduce in the Milestone 0 verification run — appears intermittent, not something Milestone 0 touched either way.
- `npm audit` still reports 1 high-severity postcss advisory (Known Issues #7) — not yet fixed, scoped to Milestone 2.

## Security — full picture

**Resolved, Milestone 0 (2026-07-28)**:
- **Critical: cross-tenant IDOR.** Every API key now carries its own `ownerId`; `authenticateRequest` resolves `req.user.id` from it instead of a shared static id. `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId`, and `/metrics` (found to have the same problem while fixing the rest) are all scoped to the caller. Regression-tested.
- The 5th `err.message` leak site (`utils/observability.ts`'s `errorHandler`) fixed alongside the 4 known `server.ts` sites.

**Resolved, prior `RELEASE_CHECKLIST.md` audit** (verified in code before this session): hardcoded API keys, shared global `currentUser` session bug, SSRF exposure in GitHub discovery, WHOIS-fallback scoring bug, GitHub rate-limit/`NO_DATA` conflation.

**Still open**: no `helmet`/CORS hardening; `SESSION_SECRET` silently regenerates per process restart if unset; IDs use `Math.random()` instead of crypto randomness (secrets themselves are fine). See `docs/KNOWN_ISSUES.md` Medium/Low sections.

Full severity-ordered list with file:line citations: `docs/KNOWN_ISSUES.md` — 0 Critical, 3 High, 20 Medium, 10 Low remain open after Milestone 0 (was 1/7/20/10 before).

## What's genuinely solid

- Investigation pipeline architecture matches its README description exactly — parallel connectors, real circuit breakers/retries/timeouts, two-tier caching, and now genuine cancellation via a threaded `AbortSignal`.
- Hallucination detection and evidence-grounding are real, tested, and structurally enforced — though the proper-noun check itself still has a bypassable gap (Known Issues #9).
- `EntityGraph.tsx` is well-engineered (real force-directed layout, pan/zoom, the only genuinely keyboard-accessible component).
- `src/utils/entityMatcher.ts`, `reliability.ts`, `logger.ts` are clean, dependency-free, well-tested utility modules.
- SDKs are field-accurate against the live API for core investigation flows.
- Backend test coverage is strong for session/auth, SSRF, scoring, rate limiting, hallucination detection, connector status semantics, and (as of Milestone 0) per-tenant ownership.
- The Dashboard no longer shows fabricated data as if it were real telemetry.

## What's still broken or missing (deferred to Milestone 1+)

- Dashboard is permanently disconnected from real Playground activity (`onAddJob` dead code, Known Issues #2).
- Mobile users below 768px cannot navigate the app at all (Known Issues #1).
- A duplicated `RelationshipEdge` type has two incompatible shapes between two components — one is likely rendering broken data (Known Issues #3).
- No CI, no Dockerfile, incomplete OpenAPI spec, npm audit finding unresolved (Known Issues #4-7).

## Zero React component tests

Confirmed: `@testing-library/react` isn't even a dependency. Still true, still scoped to Milestone 3 of `docs/ROADMAP.md`.

## Connectors (`docs/CONNECTOR_SCORECARD.md`)

WHOIS, DNS, GitHub Intelligence: Stable. SecurityTxt: Beta (shipped 2026-07-22). Three legacy fabricated-data connectors (Google, News, old GitHub) still exist as dead code in `src/connectors/`, explicitly excluded from the live pipeline but not deleted (Known Issues #20).

## Status of this documentation system

`docs/` contains the full set: `PROJECT_OVERVIEW.md`, `CURRENT_STATUS.md` (this file), `MILESTONES.md`, `ROADMAP.md`, `TECH_DECISIONS.md`, `KNOWN_ISSUES.md`, `CHANGELOG_AI.md`, `NEXT_SESSION.md`, plus the pre-existing `CONNECTOR_SCORECARD.md`/`CONNECTOR_RELEASE_CHECKLIST.md`. The 7-milestone roadmap was approved by the user on 2026-07-28; Milestone 0 is complete; Milestone 1 has not started.
