# Known Issues

Canonical, severity-ordered issue list for Sentinel. This supersedes the scattered "Recommended Before Launch" list in `RELEASE_CHECKLIST.md` (kept for historical record) — treat this file as the current source of truth and keep it updated as items are fixed or new ones are found.

**Severity guide**: `Critical` = exploitable data exposure/integrity issue or a bug that breaks a core promise of the product. `High` = real user-facing bug or a significant correctness/security gap. `Medium` = real but bounded impact, or a process/hygiene gap. `Low` = cosmetic, maintainability, or minor debt.

_Last reconciled: 2026-07-28, after Milestones 0, 1, and 2 plus the follow-up release-readiness correction. See `docs/CHANGELOG_AI.md` for what changed and why._

**Note on numbering**: item numbers are not stable across reconciliations — they renumber whenever items are closed. Reference issues by their description, not their number.

## Critical

None open. The one Critical finding from the original audit (cross-tenant IDOR) was fixed in Milestone 0 — see "Already fixed" below.

## High

None open. All 3 High-severity findings from the original audit (mobile nav gap, Dashboard/Playground disconnect, `RelationshipEdge` shape mismatch) were fixed in Milestone 1 — see "Already fixed" below.

## Medium

1. **Hallucination detector's proper-noun grounding is loose substring matching** (`validation.ts:180,235`: `prop.includes(nounLower) || nounLower.includes(prop)`) — a short verified token can "verify" an unrelated longer fabricated word, letting partially-fabricated multi-word entities through. No numeric/statistical/date claim checking exists at all — only emails/domains/repos/proper nouns are checked. *(Milestone 6)*
2. **Entity resolution can false-merge unrelated entities.** `areEntitiesMatching` treats any `"generic"`-typed entity as matching any other type (`entityMatcher.ts:158-159`) before applying an 85%-similarity fuzzy threshold — a `Generic` entity from one connector can merge into an unrelated typed entity from another connector on name similarity alone. *(Milestone 6)*
3. **Scoring "configuration" isn't actually config-driven.** `scoringRules.json` only supplies `id`/`name`/`points`/`explanation`; the actual match logic is a hardcoded TS `switch` on rule `id` (`scoring.ts`). A typo'd or renamed `id` in the JSON silently falls through to `matched:false` with no validation error — a config edit can silently disable a rule. *(Milestone 6)*
4. **Accessibility gaps**: unlabeled form inputs (Dashboard's provision-key form, Playground's investigate-panel fields and toggle); no `aria-current="page"` on the active nav tab (`Layout.tsx`); no ARIA tab roles/`aria-selected`/`aria-pressed` across 4 tab-like UIs (Dashboard's metrics/keys/jobs tabs, Playground's result tabs, Docs' language tabs, HistoryView's type filters); 29 occurrences of `text-[7px]`/`text-[8px]` low-contrast text across InvestigationReport/Dashboard/Playground/EntityGraph. *(Milestone 5)*
5. **Zero React component tests exist** — `@testing-library/react` isn't even a dependency. Milestone 1's UI changes were verified with a manual Playwright smoke-test pass, not automated component tests. *(Milestone 3)*
6. `tests/investigation-rate-limit.test.ts` intermittently produces `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` unhandled-rejection warnings (observed in the original audit run, not reproduced since) — a real but apparently non-deterministic teardown race that will look like flakiness in CI. *(Milestone 3)*
7. **`SESSION_SECRET` silently falls back to a random per-process-start value if unset** (`utils/session.ts:24`) — breaks session validity across restarts or multi-instance deployments, with no caveat documented in `DEPLOYMENT.md`.
8. No `helmet` or explicit CORS configuration — no CSP/HSTS/X-Content-Type-Options hardening headers.
9. **Dead duplicate validation module**: `src/utils/validation.ts` reimplements the same logic as the actually-used `utils/validation.ts` with a different function signature — confusing but not currently harmful since `server.ts` imports the correct one.
10. **Dead legacy fabricated-data connectors still present in the tree**: `src/connectors/google.ts`, `news.ts`, `github.ts` still compile and still return `SUCCESS` with fabricated data (consistent with their original intent), explicitly excluded from the live pipeline (`server.ts`) but a residual attack surface if ever accidentally re-wired. Deferred twice now because sessions were explicitly scoped away from touching connectors; needs a session with latitude to do so (and to retire/repoint `tests/legacy-connectors.test.ts` first).
11. **`InvestigationReport.tsx` is a 2055-line single component**, ~1870 lines in one function body, doing report actions, risk scoring, entity list/graph toggle, connector-status grid, timeline, and print layout with zero `useMemo`/`useCallback` anywhere in the file — maintainability and (as data volume grows) performance risk. *(Milestone 4)*
12. SDKs (`sdks/typescript`, `sdks/python`) cover only the core investigation flows (`/investigate`, `/investigations`, `/history`, `/reports`) — not `/auth`, `/keys`, `/jobs`, `/playground/transform`, `/metrics`, `/intelligence/analyze`. Possibly intentional scoping, possibly drift; worth a product decision either way.

## Low

13. IDs for users/keys/jobs use `Math.random().toString(36)` (`server.ts`, `investigationWorker.ts`) rather than crypto-strength randomness — only API key *secrets* use `crypto.randomBytes`.
14. Confidence-tier color/label logic (`>=80`/`>=50` thresholds) is copy-pasted verbatim in `InvestigationReport.tsx`, `HistoryView.tsx`, `PlaygroundView.tsx` instead of a shared helper. *(Milestone 4)*
15. Cache boilerplate (static `Map` + TTL env-parsing) is duplicated near-identically across `whois.ts`, `dns.ts`, `github-intel.ts`, `securitytxt.ts` — a shared base/helper would remove ~4x duplication. *(Milestone 4)*
16. Gemini model is hardcoded `"gemini-3.5-flash"` (`intelligence.ts`) with no env override, unlike every connector's env-configurable TTLs/timeouts.
17. `vite.config.ts` still has leftover comments referencing "AI Studio" and a `DISABLE_HMR` flag — incomplete template cleanup from the project's origin.
18. No `"engines"` field in `package.json` despite `README.md`/`DEPLOYMENT.md` mandating Node ≥18 (the CI workflow does pin Node 18).
19. No test coverage for `entityResolution.ts` (no dedicated test file at all) or the `whois.ts` connector (despite WHOIS being load-bearing for `conf_whois`/`risk_newly_registered` scoring). Route-layer HTTP coverage for `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId`, `/metrics`, and `/playground/transform` was added in Milestone 0's `cross-tenant isolation` tests; `/intelligence/analyze` route-layer coverage is still missing. *(Milestone 3)*
20. No server-side "clear history" capability — `HistoryView.tsx`'s old client-side "Clear History" button was removed in Milestone 1 (it only ever cleared localStorage, which no longer holds history) rather than kept as a non-functional control. Adding a real `DELETE /history` (or per-record delete) endpoint is a legitimate future feature, not yet scoped to a milestone.

## Already fixed (historical record — do not re-open)

**Release-readiness correction (2026-07-28, post-Milestone 2)**:
- **`server.ts` hardcoded `const PORT = 3000` and never read `process.env.PORT`**, despite `DEPLOYMENT.md` and the `Dockerfile` both documenting `PORT` as configurable. It only "worked" because the documented default matched the hardcoded literal — any deployment setting a non-3000 `PORT` (Cloud Run, Heroku, most PaaS) would have had the container listen on the wrong port. Now resolved via `process.env.PORT` with a validated fallback to `3000`, matching the `parseInt`/`isNaN`-guard pattern already used for the connector TTL/timeout env vars. Verified at runtime across three cases: custom port honored, unset defaults to 3000, non-numeric value falls back to 3000 rather than crashing.

**Milestone 2 (2026-07-28)** — release engineering:
- No CI workflow existed. Added `.github/workflows/ci.yml` running `npm ci`, lint, test, and build on every push/PR (Node 18).
- No `Dockerfile` existed, despite `DEPLOYMENT.md` documenting a container deployment. Added a production multi-stage `Dockerfile` + `.dockerignore`.
- OpenAPI spec was missing 4 live authenticated routes (`/jobs`, `POST /playground/transform`, `GET /metrics`, `POST /intelligence/analyze`). All now documented against the real handler shapes; verified live — 15/15 registered routes present, Swagger UI renders.
- `npm audit`'s 1 high-severity postcss path-traversal advisory (GHSA-r28c-9q8g-f849) fixed via a patch-level bump; 0 vulnerabilities remain.
- `GET /version` and the OpenAPI spec's `info.version` both hardcoded `"1.0.0"` instead of the real `"1.0.0-rc.1"`. Version is now consistent across `package.json`, `VERSION.md`, `README.md`, `server.ts`, `src/api/openapi.ts`, `DEPLOYMENT.md`, and both SDKs.
- `SECURITY.md` pointed to an unverified `security@sentinelapi.dev` (now GitHub Security Advisories for this repo); `CONTRIBUTING.md` had the placeholder `your-org/sentinel-api` clone URL and `package.json`'s `repository`/`bugs`/`homepage` pointed at a different-but-also-wrong placeholder org (all now the real `JosephIwe/Sentinel`).
- `tsconfig.json`'s unused `"@/*"` path alias and the stale `npm run clean` script (referenced a `server.js` output the build no longer produces) both removed.
- `CHANGELOG.md` had an entry truncated mid-sentence since a much earlier commit; removed the fragment and backfilled `[Unreleased]` with the Milestone 0/1/2 changes that had never been recorded in the project's actual release notes.
- `DEPLOYMENT.md` now documents `SECURITYTXT_CACHE_TTL_MS` and `APP_ACCESS_CODE` (present in `.env.example`, previously undocumented) and references the real `Dockerfile`.

**Milestone 1 (2026-07-28)** — frontend correctness:
- **Mobile navigation was entirely unreachable below 768px.** Added a hamburger toggle + slide-down mobile nav panel to `Layout.tsx`, verified with a Playwright smoke test at a 375px viewport.
- **`RelationshipEdge` shape mismatch.** `PlaygroundView.tsx` used `from`/`to`, which don't exist on the real API response (`source`/`target`) — every relationship rendered blank in the Interactive Explorer tab. Fixed by importing the canonical `Relationship`/`Entity` types from `src/types.ts` in both `PlaygroundView.tsx` and `InvestigationReport.tsx` instead of local (and in one case wrong) redefinitions.
- **Found while fixing the above**: `PlaygroundView.tsx`'s local `EntityNode` type had the same problem — `entity.confidence`/`entity.details` don't exist on the real `Entity` shape either. The always-`100%` fabricated confidence badge was replaced with a real evidence-link count.
- **Dashboard was permanently disconnected from real Playground activity** (`onAddJob` dead code). Playground's UI never called the `/playground/transform` endpoint `onAddJob` assumed — it uses `/api/investigations`, a different feature. Removed the dead prop/handler and relabeled Dashboard's "Extraction History" tab to clarify the distinction.
- **Two disconnected "investigation history" data models** eliminated rather than reconciled: `HistoryView.tsx` now reads real server-persisted history (`GET /api/history`, per-tenant since Milestone 0) instead of an unscoped `localStorage` copy.
- Frontend silently swallowed errors in `App.tsx`'s login/key-management handlers — non-OK HTTP responses hit no branch at all. Now surfaced inline via each component's existing local-error-state pattern.
- Typo **"TACTICAL INTELLIGENCE BREIFING REPORT"** → "BRIEFING" in the print output.

**Milestone 0 (2026-07-28)** — security & trust:
- **Critical: cross-tenant IDOR across `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId`.** Every API key resolved to one shared identity (`usr_api_client`); fixed by giving each key its own `ownerId`, scoping all five routes (plus `/metrics`, found to have the same problem) to `req.user.id`. Regression-tested in `tests/server.test.ts`'s `cross-tenant isolation` describe block.
- `errorHandler` (`utils/observability.ts`) no longer leaks `err.message` in production; same fix applied to the 4 known `server.ts` leak sites via a shared `errorDetails()` helper. Regression-tested in `tests/observability.test.ts`.
- Scoring engine's `risk_newly_registered`/`risk_long_established` now compute domain age relative to `Date.now()` instead of hardcoded absolute years (2024/2018) that would have silently drifted wrong over time.
- Dashboard's fake 24h usage chart (hardcoded data never wired to `metrics`) replaced with an honest "not tracked yet" placeholder.
- Job cancellation now threads a real `AbortSignal` through `InvestigationService.investigate()` and `IntelligenceService.analyze()`, so cancelled jobs stop consuming connector/AI quota. Also fixed a job cancelled between `createJob()` and its deferred start being silently overwritten back to `"running"`.
- **Found while implementing the above**: `/playground/transform`'s real-Gemini branch bumped an arbitrary "first active key's" usage stats on every call, corrupting an unrelated tenant's counters — removed as redundant with `authenticateRequest`'s correct per-key tracking.

**Original v1.0.0 release audit** — from the prior `RELEASE_CHECKLIST.md` "Must Fix Before Launch" audit, all verified fixed in code before these sessions: hardcoded source-committed API keys; shared global `currentUser` session bug; missing SSRF protection on GitHub-discovery homepage fetch; WHOIS-fallback evidence wrongly counted as a confidence-boosting success; GitHub API rate-limit/network errors conflated with genuine `NO_DATA`.
