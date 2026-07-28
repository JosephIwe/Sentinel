# Known Issues

Canonical, severity-ordered issue list for Sentinel. This supersedes the scattered "Recommended Before Launch" list in `RELEASE_CHECKLIST.md` (kept for historical record) — treat this file as the current source of truth and keep it updated as items are fixed or new ones are found.

**Severity guide**: `Critical` = exploitable data exposure/integrity issue or a bug that breaks a core promise of the product. `High` = real user-facing bug or a significant correctness/security gap. `Medium` = real but bounded impact, or a process/hygiene gap. `Low` = cosmetic, maintainability, or minor debt.

_Last audited: 2026-07-28 (full audit). Updated same day after Milestone 0 and Milestone 1 implementation — see `docs/CHANGELOG_AI.md` for what changed and why._

## Critical

None open. The one Critical finding from this audit (cross-tenant IDOR) was fixed in Milestone 0 — see "Already fixed" below.

## High

None open. All 3 High-severity findings from the original audit (mobile nav gap, Dashboard/Playground disconnect, `RelationshipEdge` shape mismatch) were fixed in Milestone 1 — see "Already fixed" below.

## Medium

1. No CI workflow exists (`.github/workflows/` absent) — nothing blocks a regressing PR from merging.
2. No `Dockerfile` exists, despite `DEPLOYMENT.md` shipping its own inline Dockerfile example that has never been built/tested.
3. OpenAPI spec (`src/api/openapi.ts`) is missing `/jobs`, `POST /playground/transform`, `GET /metrics`, `POST /intelligence/analyze` — all live, authenticated routes absent from the `/docs` Swagger UI.
4. `npm audit` reports 1 high-severity advisory: **postcss ≤8.5.17 path traversal** (GHSA-r28c-9q8g-f849), pulled in transitively via Tailwind v4. Fixable via `npm audit fix`.
5. **Hallucination detector's proper-noun grounding is loose substring matching** (`validation.ts:180,235`: `prop.includes(nounLower) || nounLower.includes(prop)`) — a short verified token can "verify" an unrelated longer fabricated word, letting partially-fabricated multi-word entities through. No numeric/statistical/date claim checking exists at all — only emails/domains/repos/proper nouns are checked.
6. **Entity resolution can false-merge unrelated entities.** `areEntitiesMatching` treats any `"generic"`-typed entity as matching any other type (`entityMatcher.ts:158-159`) before applying an 85%-similarity fuzzy threshold — a `Generic` entity from one connector can merge into an unrelated typed entity from another connector on name similarity alone.
7. **Scoring "configuration" isn't actually config-driven.** `scoringRules.json` only supplies `id`/`name`/`points`/`explanation`; the actual match logic is a hardcoded TS `switch` on rule `id` (`scoring.ts:166-263,268-432`). A typo'd or renamed `id` in the JSON silently falls through to `matched:false` with no validation error — a config edit can silently disable a rule.
8. **Accessibility gaps**: unlabeled form inputs (Dashboard's provision-key form, Playground's investigate-panel fields and toggle); no `aria-current="page"` on the active nav tab (`Layout.tsx`); no ARIA tab roles/`aria-selected`/`aria-pressed` across 4 tab-like UIs (Dashboard's metrics/keys/jobs tabs, Playground's result tabs, Docs' language tabs, HistoryView's type filters); 29 occurrences of `text-[7px]`/`text-[8px]` low-contrast text across InvestigationReport/Dashboard/Playground/EntityGraph.
9. **Zero React component tests exist** — `@testing-library/react` isn't even a dependency. Already flagged as a post-launch item in `RELEASE_CHECKLIST.md`; still true. (Milestone 1's UI changes were verified with a manual Playwright smoke-test pass, not automated component tests — see `docs/CHANGELOG_AI.md`. Automated coverage is still Milestone 3's job.)
10. `tests/investigation-rate-limit.test.ts` intermittently produces `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` unhandled-rejection warnings (observed in the original audit run, not reproduced since) — a real but apparently non-deterministic teardown race that will look like flakiness once CI exists.
11. `SECURITY.md` still points to an unverified `security@sentinelapi.dev`; `CONTRIBUTING.md` still has the placeholder clone URL `your-org/sentinel-api`.
12. **`SESSION_SECRET` silently falls back to a random per-process-start value if unset** (`utils/session.ts:24`) — breaks session validity across restarts or multi-instance deployments, with no caveat documented in `DEPLOYMENT.md`.
13. No `helmet` or explicit CORS configuration — no CSP/HSTS/X-Content-Type-Options hardening headers.
14. **Dead duplicate validation module**: `src/utils/validation.ts` reimplements the same logic as the actually-used `utils/validation.ts` with a different function signature — confusing but not currently harmful since `server.ts` imports the correct one.
15. **Dead legacy fabricated-data connectors still present in the tree**: `src/connectors/google.ts`, `news.ts`, `github.ts` still compile and still return `SUCCESS` with fabricated data (consistent with their original intent), explicitly excluded from the live pipeline (`server.ts`) but a residual attack surface if ever accidentally re-wired.
16. `GET /version` hardcodes `"1.0.0"` (`server.ts`) while `package.json` says `"1.0.0-rc.1"` — version drift between the two sources of truth.
17. **`InvestigationReport.tsx` is a 2055-line single component**, ~1870 lines in one function body, doing report actions, risk scoring, entity list/graph toggle, connector-status grid, timeline, and print layout with zero `useMemo`/`useCallback` anywhere in the file — maintainability and (as data volume grows) performance risk.
18. SDKs (`sdks/typescript`, `sdks/python`) cover only the core investigation flows (`/investigate`, `/investigations`, `/history`, `/reports`) — not `/auth`, `/keys`, `/jobs`, `/playground/transform`, `/metrics`, `/intelligence/analyze`. Possibly intentional scoping, possibly drift; worth a product decision either way.

## Low

19. IDs for users/keys/jobs use `Math.random().toString(36)` (`server.ts`, `investigationWorker.ts`) rather than crypto-strength randomness — only API key *secrets* use `crypto.randomBytes`.
20. Confidence-tier color/label logic (`>=80`/`>=50` thresholds) is copy-pasted verbatim in `InvestigationReport.tsx`, `HistoryView.tsx`, `PlaygroundView.tsx` instead of a shared helper.
21. Cache boilerplate (static `Map` + TTL env-parsing) is duplicated near-identically across `whois.ts`, `dns.ts`, `github-intel.ts`, `securitytxt.ts` — a shared base/helper would remove ~4x duplication.
22. Gemini model is hardcoded `"gemini-3.5-flash"` (`intelligence.ts`) with no env override, unlike every connector's env-configurable TTLs/timeouts.
23. `tsconfig.json`'s `"@/*"` path alias is never actually used anywhere in `server.ts` or `tests/` — dead config.
24. `vite.config.ts` still has leftover comments referencing "AI Studio" and a `DISABLE_HMR` flag — incomplete template cleanup from the project's origin.
25. `npm run clean` still references `rm -rf dist server.js`, but the build only ever produces `dist/server.cjs` — stale script leftover.
26. No `"engines"` field in `package.json` despite `DEPLOYMENT.md` mandating Node ≥18.
27. No test coverage for `entityResolution.ts` (no dedicated test file at all) or the `whois.ts` connector (despite WHOIS being load-bearing for `conf_whois`/`risk_newly_registered` scoring). Route-layer HTTP coverage for `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId`, `/metrics`, and `/playground/transform` was added in Milestone 0's `cross-tenant isolation` tests; `/intelligence/analyze` route-layer coverage is still missing.
28. No server-side "clear history" capability — `HistoryView.tsx`'s old client-side "Clear History" button was removed in Milestone 1 (it only ever cleared localStorage, which no longer holds history — see "Already fixed" below) rather than kept as a non-functional control. Adding a real `DELETE /history` (or per-record delete) endpoint is a legitimate future feature, not yet scoped to a milestone.

## Already fixed (historical record — do not re-open)

**Milestone 1 (2026-07-28)** — see `docs/CHANGELOG_AI.md` for full detail:
- **Mobile navigation was entirely unreachable below 768px.** Added a hamburger toggle + slide-down mobile nav panel to `Layout.tsx`, verified with a Playwright smoke test at a 375px viewport.
- **`RelationshipEdge` shape mismatch.** `PlaygroundView.tsx` used `from`/`to`, which don't exist on the real API response (`source`/`target`) — every relationship rendered blank in the Interactive Explorer tab. Fixed by importing the canonical `Relationship`/`Entity` types from `src/types.ts` in both `PlaygroundView.tsx` and `InvestigationReport.tsx` instead of local (and in one case wrong) redefinitions. Verified live: relationships now render real entity IDs, not `undefined`.
- **Found while fixing the above** (not on the original list): `PlaygroundView.tsx`'s local `EntityNode` type had the same problem — `entity.confidence`/`entity.details` don't exist on the real `Entity` shape either. The always-`100%` fabricated confidence badge was replaced with a real evidence-link count; `entity.details` now correctly reads `entity.metadata?.details`.
- **Dashboard was permanently disconnected from real Playground activity** (`onAddJob` dead code). Root cause was deeper than a missing wire-up: Playground's UI never called the `/playground/transform` endpoint `onAddJob`/`ExtractionJob` assumed — it uses `/api/investigations` instead, a different feature entirely. Rather than fabricate a fake mapping between the two, removed the dead prop/handler and relabeled the Dashboard's "Extraction History" tab to clarify it shows `POST /playground/transform` jobs (typically from API/SDK clients), distinct from Playground-run investigations (which show under "Investigation History").
- **Two disconnected "investigation history" data models.** Eliminated rather than reconciled: `HistoryView.tsx` now reads real server-persisted history (`GET /api/history`, already correctly per-tenant after Milestone 0) instead of an unscoped `localStorage` copy; `PlaygroundView.tsx`'s redundant `saveToHistory()` localStorage writer was removed since the server already persists completed investigations. Also fixes the same-bucket "silent `JSON.parse` failure" anti-pattern in both files, since there's no longer any localStorage JSON to parse.
- Frontend silently swallowed errors in `App.tsx`'s `handleLoginSuccess`/`handleAddKey`/`handleRevokeKey`/`handleRotateKey` — worse than console-log-only, non-OK HTTP responses hit no branch at all. Fixed by having these return a success/error result that `AuthView.tsx` and `DashboardView.tsx` now await and display inline (reusing each component's existing local-error-state pattern rather than adding a generic toast system). Also fixed a related bug in `AuthView.tsx`: `onLoginSuccess` was fire-and-forget, so a failed login re-enabled the submit button with zero feedback.
- Typo **"TACTICAL INTELLIGENCE BREIFING REPORT"** → "BRIEFING" in `InvestigationReport.tsx`'s print output.

**Milestone 0 (2026-07-28)**:
- **Critical: cross-tenant IDOR across `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId`.** Every API key resolved to one shared identity (`usr_api_client`); fixed by giving each key its own `ownerId`, scoping all five routes (plus `/metrics`, found to have the same aggregation problem while fixing this) to `req.user.id`. Regression-tested in `tests/server.test.ts`'s `cross-tenant isolation` describe block.
- `errorHandler` (`utils/observability.ts`) no longer leaks `err.message` in production; the same fix applied to the 4 known `server.ts` leak sites via a shared `errorDetails()` helper. Regression-tested in `tests/observability.test.ts`.
- Scoring engine's `risk_newly_registered`/`risk_long_established` now compute domain age relative to `Date.now()` instead of hardcoded absolute years (2024/2018) that would have silently drifted wrong over time.
- Dashboard's fake 24h usage chart (hardcoded data never wired to `metrics`) replaced with an honest "not tracked yet" placeholder rather than continuing to fabricate hourly numbers.
- Job cancellation now threads a real `AbortSignal` through `InvestigationService.investigate()` and `IntelligenceService.analyze()`: not-yet-started connectors are skipped, an in-flight GitHub-discovery fetch is actually aborted, and the (billed) Gemini call is skipped in favor of the free deterministic fallback if cancellation lands before AI synthesis starts. Also fixed a related bug where a job cancelled between `createJob()` and its deferred start would get silently overwritten back to `"running"`.
- **Found and fixed while implementing the above** (not on the original audit list): `/playground/transform`'s real-Gemini branch bumped an arbitrary "first active key's" `requestCount`/`lastUsedAt` on every call, corrupting an unrelated tenant's usage stats — this was already fully redundant with `authenticateRequest`'s correct per-key tracking, so it was removed rather than fixed.

**Original v1.0.0 release audit** — from the prior `RELEASE_CHECKLIST.md` "Must Fix Before Launch" audit, all verified fixed in code prior to this session: hardcoded source-committed API keys; shared global `currentUser` session bug; missing SSRF protection on GitHub-discovery homepage fetch; WHOIS-fallback evidence wrongly counted as a confidence-boosting success; GitHub API rate-limit/network errors conflated with genuine `NO_DATA`.
