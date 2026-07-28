# AI Session Changelog

Log of AI-agent-driven work sessions on this project: what was done, why, and what it touched. Distinct from `CHANGELOG.md` (user-facing release notes) — this is internal memory of the AI's own work, so a future session (or a human reviewing AI contributions) can see what happened and why without re-deriving it from git log.

Entries prior to 2026-07-28 are reconstructed from git history for continuity, since no `docs/` memory existed before this session.

---

## 2026-07-28 — Milestone 1: frontend correctness & functional gaps (implementation)

**Prompted by**: user instruction to continue straight into Milestone 1 after Milestone 0 landed.

**Did** (see `docs/ROADMAP.md`'s Milestone 1 section and `docs/KNOWN_ISSUES.md`'s "Already fixed" section for the full task list):
- Investigated the `RelationshipEdge` shape mismatch by checking every consumer of the real API response: `server.ts`'s seeded/generated relationship objects, `src/services/investigation.ts`'s merge logic, and `EntityGraph.tsx`'s already-correct usage all agree the real shape is `source`/`target`. Confirmed `PlaygroundView.tsx`'s local `from`/`to` type was the broken one — its Interactive Explorer relationships tab was rendering `undefined` for every edge. Fixed by importing `Entity`/`Relationship` from `src/types.ts` in both `PlaygroundView.tsx` and `InvestigationReport.tsx` (which already imported them but then redundantly redefined local copies — removed the redundant ones too, since the task was specifically to stop local redefinitions).
- While fixing the above, found and fixed a second instance of the same bug class in the same file: `PlaygroundView.tsx`'s local `EntityNode` type had `details`/`confidence` fields that don't exist on the real `Entity` type either — every entity card was showing a fabricated, always-`100%` confidence badge. Replaced it with a real evidence-link count (`entity.evidenceIds?.length`); fixed `entity.details` to read the correct `entity.metadata?.details` path.
- Investigated the `onAddJob` dead-code question by tracing what Playground's UI actually calls (`/api/investigations`) versus what `onAddJob`/`ExtractionJob`/`ArgvhandleAddJob` assumed (`/playground/transform`, a schema-based extraction feature only ever documented for API/SDK clients in `DocsView.tsx`, never wired into any UI fetch call). Concluded the two features are legitimately separate, not a broken wire-up to fix — removed the dead `onAddJob` prop/handler pair and relabeled Dashboard's "Extraction History" tab copy to explain what it actually shows and why it doesn't reflect Playground activity, rather than leaving the disconnect unexplained.
- Added a mobile navigation fallback to `Layout.tsx`: a hamburger toggle (`Menu`/`X` icons) and a slide-down `<nav>` panel covering the same destinations as the desktop nav, both gated to `md:hidden` so desktop is unaffected.
- Fixed `App.tsx`'s login/key-management error handling — worse than the audit's original "console.error only" framing, non-OK HTTP responses had no `else` branch at all, so failures were completely silent, not even logged. Changed `handleLoginSuccess`/`handleAddKey`/`handleRevokeKey`/`handleRotateKey` to return `Promise<boolean | string>` and wired `AuthView.tsx`/`DashboardView.tsx` to await and display the result using each component's existing local-error-state pattern (reused, not a new toast system). Also fixed `AuthView.tsx`'s `onLoginSuccess` being fire-and-forget (the submit button previously re-enabled after a fixed timeout regardless of whether login actually succeeded) and removed a since-unnecessary fake `setTimeout` delay now that the UI awaits the real request.
- Reconciled the two disconnected history data models by eliminating the duplication rather than just sharing a type: `HistoryView.tsx` now fetches `GET /api/history` (real, per-tenant since Milestone 0) instead of reading an unscoped `localStorage` copy; clicking a record now fetches `GET /api/reports/:id` before handing the result to Playground. `PlaygroundView.tsx`'s `saveToHistory()` was removed since the server already persists completed investigations via `InvestigationWorker`'s `onJobCompleted` callback. Removed the "Clear History" button (no server-side delete endpoint exists — kept it out rather than leave it silently non-functional; noted as a legitimate future feature in `docs/KNOWN_ISSUES.md`, not silently dropped).
- Fixed the "BREIFING" → "BRIEFING" print-output typo.
- Ran `npx tsc --noEmit` after each logical change (not just at the end) to catch cross-file breakage early, given how many files this milestone touched.
- Verified end-to-end in a real browser: started the dev server, installed `playwright-core` in the scratchpad directory (not a project dependency) pointed at the environment's pre-installed Chromium, and drove: (1) a 375px mobile viewport confirming the desktop nav is hidden, the hamburger opens the panel, and it navigates correctly; (2) demo login → dashboard → key creation with no error banner on success; (3) a full investigation run → Interactive Explorer → Relationships tab showing real entity IDs joined by `RESOLVES_TO`, confirmed no literal `"undefined"` in the rendered text; (4) History page showing the just-completed investigation server-side, clicking "Restore" navigating back to Playground with the report re-rendered. Reviewed all screenshots directly. The only console error observed was a Google Fonts CDN request blocked by the sandbox's lack of internet access — confirmed unrelated to any change by isolating it with a dedicated network-logging pass.
- `npm run test` (240/240, unchanged from Milestone 0 — this was a frontend-only milestone with no new automated tests; the browser pass above was the verification), `npm run lint` (clean), `npm run build` (succeeds).
- Updated `docs/KNOWN_ISSUES.md` (moved all 3 fixed High items to "Already fixed", renumbered remaining Medium/Low, added the new "no server-side clear history" Low item), `docs/ROADMAP.md` (Milestone 1 marked complete), `docs/MILESTONES.md`, `docs/CURRENT_STATUS.md`, this file.

**Files touched**: `src/components/PlaygroundView.tsx`, `src/components/InvestigationReport.tsx`, `src/components/HistoryView.tsx`, `src/components/DashboardView.tsx`, `src/components/Layout.tsx`, `src/components/AuthView.tsx`, `src/App.tsx`, plus the `docs/` files listed above. No backend files changed this milestone.

**Next**: Milestone 2 (CI, Dockerfile, OpenAPI completeness, `npm audit fix`, `SECURITY.md`/`CONTRIBUTING.md` contact/URL cleanup, `package.json` `engines` field, `/version` drift fix, `vite.config.ts` cleanup, dead legacy connector deletion) per `docs/ROADMAP.md`.

---

## 2026-07-28 — Milestone 0: security & trust emergency fixes (implementation)

**Prompted by**: user approval of the 7-milestone roadmap from the same-day audit, with instructions to work through milestones one at a time, keep the project buildable, and update all docs at the end of the session.

**Did** (see `docs/ROADMAP.md`'s Milestone 0 section and `docs/KNOWN_ISSUES.md`'s "Already fixed" section for the full task list):
- Redesigned API-key identity: added `ownerId` to every `apiKeys` record (minted from `req.user.id` at creation time), and `authenticateRequest` now resolves `req.user.id` from `keyRecord.ownerId` instead of the shared static `usr_api_client`. Documented as the resolution to the "Open architectural gap" noted in `docs/TECH_DECISIONS.md` from the audit session.
- Scoped `GET /keys`, `PUT /keys/:id/revoke`, `POST /keys/:id/rotate`, `GET /jobs`, `GET /history`, `GET /reports/:id`, `GET /investigations/:jobId` to the caller's `ownerId`/`userId`. Also scoped `GET /metrics`, found mid-fix to have the identical cross-tenant aggregation problem (not on the original audit list).
- Reattributed seeded demo data (`extractionJobs`, `investigationHistory`) from a fake, unreachable `usr_sentinel_94921` id to the guest tenant, so it stays visible when browsing anonymously (the normal way to explore the demo) without leaking across real tenants.
- Removed a redundant, incorrect stat-tracking block in `/playground/transform`'s real-Gemini branch that bumped an arbitrary "first active key's" `requestCount` regardless of caller — found while auditing the `apiKeys` array for the ownership work, not on the original list.
- Fixed the 5th `err.message` leak site: `utils/observability.ts`'s `errorHandler` now gates the message behind `NODE_ENV !== "production"`, matching a new shared `errorDetails()` helper applied to the 4 known leak sites in `server.ts`.
- Fixed `scoring.ts`'s `risk_newly_registered`/`risk_long_established` to compute domain age relative to `Date.now()` via a new `ageInYears()` helper, instead of hardcoded absolute-year comparisons (`>= 2024`, `< 2018`) that would have silently gone stale. Updated `tests/scoring.test.ts`'s fixed-year assertions to use relative dates, and added a regression test specifically for the drift bug.
- Replaced the Dashboard's hardcoded fake usage chart with an honest "not tracked yet" placeholder, since no real per-request timestamped telemetry exists yet to back a genuine chart — fabricating one would repeat the exact anti-pattern being fixed.
- Implemented real job cancellation: threaded an `AbortSignal` (one `AbortController` per job, tracked in `InvestigationWorker`) through `InvestigationService.investigate()` (skips not-yet-started connectors, aborts an in-flight GitHub-discovery fetch) and `IntelligenceService.analyze()` (skips the Gemini call in favor of the free deterministic fallback if already cancelled). Also fixed a related bug where a job cancelled between `createJob()` and its deferred `processJob()` start got silently overwritten back to `"running"`.
- Hit a real TypeScript control-flow narrowing issue removing the `(job.status as string)` casts (the audit had called these "dead code"; they weren't — see `docs/TECH_DECISIONS.md` isn't updated with this, but `investigationWorker.ts`'s `isCancelled()` docstring explains it in full). Fixed properly with an `isCancelled(job)` helper rather than reintroducing an unsafe cast.
- Added regression tests: `tests/observability.test.ts` (new, unit-tests `errorHandler`'s production-gating), and a new `cross-tenant isolation` describe block in `tests/server.test.ts` covering all the newly-scoped routes with two distinct tenants. Had to restructure the isolation tests to share tenants via `beforeAll` after the first version tripped the per-IP rate limiter from too many login+key-creation round trips within one test file run.
- Verified: `npm run test` (240/240 passing, was 229/229), `npm run lint` (clean), `npm run build` (succeeds).
- Updated `docs/KNOWN_ISSUES.md` (moved fixed items to the "Already fixed" section, renumbered remaining), `docs/ROADMAP.md` (Milestone 0 marked complete), `docs/MILESTONES.md`, `docs/CURRENT_STATUS.md`, this file.

**Files touched**: `server.ts`, `utils/observability.ts`, `src/services/scoring.ts`, `src/services/investigation.ts`, `src/services/intelligence.ts`, `src/services/investigationWorker.ts`, `src/components/DashboardView.tsx`, `tests/scoring.test.ts`, `tests/server.test.ts`, `tests/observability.test.ts` (new), plus the `docs/` files listed above.

**Also**: PR #8 (the audit/docs-only PR from earlier the same day) was merged mid-session. Restarted the branch from the merged `main` (fast-forward only, since the branch was a clean ancestor) before starting Milestone 0's implementation, per the standing instruction to never stack new work on already-merged history.

**Next**: Milestone 1 (frontend correctness) per `docs/ROADMAP.md` — mobile nav gap, Dashboard/Playground disconnect (`onAddJob` dead code), `RelationshipEdge` shape mismatch, silent frontend error handling, the "BREIFING" typo, and a decision on reconciling the two history data models.

---

## 2026-07-28 — Full project audit & memory system established

**Prompted by**: user request to act as lead engineer/product designer/reviewer, fully understand the project, and establish a persistent documentation system before any further implementation.

**Did**:
- Read the entire repository: `server.ts`, all of `src/services/`, `src/connectors/` (including dead legacy ones), `src/components/`, `src/utils/`, `utils/`, all `tests/*.ts`, build/deploy config, SDKs, all existing markdown docs.
- Ran `npm install`, `npm run test` (229/229 pass, 2 non-fatal teardown warnings in `tests/investigation-rate-limit.test.ts`), `npm run lint` (clean), `npm run build` (succeeds), `npm audit` (1 high-severity postcss advisory).
- Found and documented a **critical, previously-unreported cross-tenant IDOR**: all API-key traffic resolves to one shared identity (`usr_api_client`), and `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId` have no ownership checks — any caller can view/revoke/rotate any other tenant's data. Not on the prior `RELEASE_CHECKLIST.md`.
- Found 7 additional High-severity issues, 20 Medium, and 10 Low — full list in `docs/KNOWN_ISSUES.md`.
- Created `docs/PROJECT_OVERVIEW.md` and `docs/KNOWN_ISSUES.md` (new).
- Rewrote `docs/CURRENT_STATUS.md`, `docs/MILESTONES.md`, `docs/ROADMAP.md`, `docs/TECH_DECISIONS.md`, `docs/NEXT_SESSION.md` (all existed from a same-day earlier session that reconstructed them from `RELEASE_CHECKLIST.md`/`CHANGELOG.md`/git log; this pass supersedes that with direct-code-verified findings).
- Proposed a 7-milestone prioritized implementation plan (see `docs/ROADMAP.md`) starting with the IDOR/security fixes. **Did not implement anything** — waiting on explicit approval per the user's instructions before Phase 5.

**Files touched**: `docs/PROJECT_OVERVIEW.md` (new), `docs/KNOWN_ISSUES.md` (new), `docs/CHANGELOG_AI.md` (new, this file), `docs/CURRENT_STATUS.md`, `docs/MILESTONES.md`, `docs/ROADMAP.md`, `docs/TECH_DECISIONS.md`, `docs/NEXT_SESSION.md` — no application code changed.

**Next**: awaiting roadmap approval; first milestone on approval is the IDOR fix + other Critical/High security-adjacent bugs (Milestone 0 in `docs/ROADMAP.md`).

---

## 2026-07-28 (earlier same day) — Project memory reconstruction (v1)

**Prompted by**: user request to read `docs/NEXT_SESSION.md` etc. at session start; none of those files existed yet.

**Did**: Reconstructed `docs/CURRENT_STATUS.md`, `docs/MILESTONES.md`, `docs/ROADMAP.md`, `docs/TECH_DECISIONS.md`, `docs/NEXT_SESSION.md` from `RELEASE_CHECKLIST.md`, `VERSION.md`, `CHANGELOG.md`, connector docs, and git log, cross-checked against a first pass over the code (confirmed all 5 prior launch-blocker fixes were actually in place). Identified the "Recommended Before Launch" checklist items as the highest-priority task at the time. Committed and pushed to `claude/project-memory-review-cqx488`.

**Superseded by**: the full audit above, which went deeper (ran the test suite, found the IDOR issue, produced `docs/KNOWN_ISSUES.md` as the new canonical bug list).

---

## Reconstructed history (pre-docs), from git log

- **2026-07-11**: Initial scaffold, core investigation pipeline, WHOIS caching, GitHub Intelligence connector, DNS enhancements, print-friendly report UI.
- **2026-07-12 to 07-14**: Async investigation pipeline (`InvestigationWorker`), grounded-response/hallucination verification introduced, API key generation/masking upgraded, entity graph visualization added.
- **2026-07-16**: **Removed 3 fabricated-data connectors** (Google Search, legacy GitHub, News) — the project's defining trust fix. GitHub discovery diagnostics added; project policies/metadata formalized.
- **2026-07-17**: Full backend/service test coverage sprint (scoring, rate limiter, frontend validation, HTTP API, legacy connectors, hallucination detection, intelligence/worker). README rewritten; screenshots added.
- **2026-07-19 to 07-20**: `RELEASE_CHECKLIST.md` produced from a release-readiness audit; all 6 verified v1.0.0 blockers fixed (hardcoded keys, session bug, SSRF, WHOIS scoring, GitHub rate-limit conflation, +1 more); private-beta gate added; 4 more bugs fixed during beta-readiness validation.
- **2026-07-22**: `SecurityTxtConnector` shipped (Beta, RFC 9116); roadmap and connector-release checklist formalized.
