# Known Issues

Canonical, severity-ordered issue list for Sentinel. This supersedes the scattered "Recommended Before Launch" list in `RELEASE_CHECKLIST.md` (kept for historical record) — treat this file as the current source of truth and keep it updated as items are fixed or new ones are found.

**Severity guide**: `Critical` = exploitable data exposure/integrity issue or a bug that breaks a core promise of the product. `High` = real user-facing bug or a significant correctness/security gap. `Medium` = real but bounded impact, or a process/hygiene gap. `Low` = cosmetic, maintainability, or minor debt.

_Last audited: 2026-07-28 (full audit). Updated same day after Milestone 0 implementation — see `docs/CHANGELOG_AI.md` for what changed and why._

## Critical

None open. The one Critical finding from this audit (cross-tenant IDOR) was fixed in Milestone 0 — see "Already fixed" below.

## High

1. **Mobile navigation is entirely unreachable below 768px.** `Layout.tsx`'s `<nav>` is `hidden md:flex` (line 49) with no hamburger or alternate mobile nav — Playground/History/Docs/Dashboard are unreachable from a phone-sized viewport except via direct app state, contradicting the README's own mobile screenshot claim. **Scoped to Milestone 1.**
2. **Dashboard is permanently disconnected from real Playground activity.** `PlaygroundView` accepts an `onAddJob` prop (`PlaygroundView.tsx:74,79`) but never calls it in `handleRunInvestigation`, making `App.handleAddJob` (`App.tsx:158-168`) dead code — Dashboard's extraction log and `metrics.totalRequests` never reflect real usage. **Scoped to Milestone 1.**
3. **Duplicated `RelationshipEdge` interface has two incompatible shapes**: `from`/`to` in `PlaygroundView.tsx:20-21` vs. `source`/`target` in `InvestigationReport.tsx:19-22`, for what's meant to be the same API response type. Only one of these two components can be correctly reading the real server payload — the other is likely rendering `undefined` for the edge endpoints. Root cause: both components redefine shared domain types locally instead of importing from `src/types.ts`. **Scoped to Milestone 1.**

## Medium

4. No CI workflow exists (`.github/workflows/` absent) — nothing blocks a regressing PR from merging.
5. No `Dockerfile` exists, despite `DEPLOYMENT.md` shipping its own inline Dockerfile example that has never been built/tested.
6. OpenAPI spec (`src/api/openapi.ts`) is missing `/jobs`, `POST /playground/transform`, `GET /metrics`, `POST /intelligence/analyze` — all live, authenticated routes absent from the `/docs` Swagger UI.
7. `npm audit` reports 1 high-severity advisory: **postcss ≤8.5.17 path traversal** (GHSA-r28c-9q8g-f849), pulled in transitively via Tailwind v4. Fixable via `npm audit fix`.
8. Frontend silently swallows errors via `console.error` only, no visible UI state: `App.tsx`'s `handleLoginSuccess`/`handleAddKey`/`handleRevokeKey`/`handleRotateKey`, and the same anti-pattern recurs in `HistoryView.tsx:39,51` and `PlaygroundView.tsx:101,129` for localStorage `JSON.parse` failures.
9. **Hallucination detector's proper-noun grounding is loose substring matching** (`validation.ts:180,235`: `prop.includes(nounLower) || nounLower.includes(prop)`) — a short verified token can "verify" an unrelated longer fabricated word, letting partially-fabricated multi-word entities through. No numeric/statistical/date claim checking exists at all — only emails/domains/repos/proper nouns are checked.
10. **Entity resolution can false-merge unrelated entities.** `areEntitiesMatching` treats any `"generic"`-typed entity as matching any other type (`entityMatcher.ts:158-159`) before applying an 85%-similarity fuzzy threshold — a `Generic` entity from one connector can merge into an unrelated typed entity from another connector on name similarity alone.
11. **Scoring "configuration" isn't actually config-driven.** `scoringRules.json` only supplies `id`/`name`/`points`/`explanation`; the actual match logic is a hardcoded TS `switch` on rule `id` (`scoring.ts:166-263,268-432`). A typo'd or renamed `id` in the JSON silently falls through to `matched:false` with no validation error — a config edit can silently disable a rule.
12. **Accessibility gaps**: unlabeled form inputs (Dashboard's provision-key form `DashboardView.tsx:254-274`, Playground's investigate-panel fields and toggle `PlaygroundView.tsx:296-323,360-368`); no `aria-current="page"` on the active nav tab (`Layout.tsx:49-113`); no ARIA tab roles/`aria-selected`/`aria-pressed` across 4 tab-like UIs (Dashboard's metrics/keys/jobs tabs, Playground's result tabs, Docs' language tabs, HistoryView's type filters); 29 occurrences of `text-[7px]`/`text-[8px]` low-contrast text across InvestigationReport/Dashboard/Playground/EntityGraph.
13. **Zero React component tests exist** — `@testing-library/react` isn't even a dependency. Already flagged as a post-launch item in `RELEASE_CHECKLIST.md`; still true.
14. `tests/investigation-rate-limit.test.ts` intermittently produces `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` unhandled-rejection warnings (observed in the original audit run, not reproduced in the Milestone 0 verification run) — a real but apparently non-deterministic teardown race that will look like flakiness once CI exists.
15. **Two disconnected "investigation history" data models** — server-side `extractionJobs` (App.tsx state, `ExtractionJob` shape) vs. localStorage-backed history (`HistoryView.tsx`/`PlaygroundView.tsx`, `InvestigationHistoryRecord` shape) — never reconciled; Dashboard's history tab and the dedicated History page can show different, non-overlapping data for the same session.
16. `SECURITY.md` still points to an unverified `security@sentinelapi.dev`; `CONTRIBUTING.md` still has the placeholder clone URL `your-org/sentinel-api`.
17. **`SESSION_SECRET` silently falls back to a random per-process-start value if unset** (`utils/session.ts:24`) — breaks session validity across restarts or multi-instance deployments, with no caveat documented in `DEPLOYMENT.md`.
18. No `helmet` or explicit CORS configuration — no CSP/HSTS/X-Content-Type-Options hardening headers.
19. **Dead duplicate validation module**: `src/utils/validation.ts` reimplements the same logic as the actually-used `utils/validation.ts` with a different function signature — confusing but not currently harmful since `server.ts` imports the correct one.
20. **Dead legacy fabricated-data connectors still present in the tree**: `src/connectors/google.ts`, `news.ts`, `github.ts` still compile and still return `SUCCESS` with fabricated data (consistent with their original intent), explicitly excluded from the live pipeline (`server.ts:591-601`) but a residual attack surface if ever accidentally re-wired.
21. `GET /version` hardcodes `"1.0.0"` (`server.ts:107`) while `package.json` says `"1.0.0-rc.1"` — version drift between the two sources of truth.
22. **`InvestigationReport.tsx` is a 2055-line single component**, ~1870 lines in one function body, doing report actions, risk scoring, entity list/graph toggle, connector-status grid, timeline, and print layout with zero `useMemo`/`useCallback` anywhere in the file — maintainability and (as data volume grows) performance risk.
23. SDKs (`sdks/typescript`, `sdks/python`) cover only the core investigation flows (`/investigate`, `/investigations`, `/history`, `/reports`) — not `/auth`, `/keys`, `/jobs`, `/playground/transform`, `/metrics`, `/intelligence/analyze`. Possibly intentional scoping, possibly drift; worth a product decision either way.

## Low

24. IDs for users/keys/jobs use `Math.random().toString(36)` (`server.ts`, `investigationWorker.ts:28`) rather than crypto-strength randomness — only API key *secrets* use `crypto.randomBytes`.
25. Confidence-tier color/label logic (`>=80`/`>=50` thresholds) is copy-pasted verbatim in `InvestigationReport.tsx:555-557`, `HistoryView.tsx:274-275`, `PlaygroundView.tsx:666-673` instead of a shared helper.
26. Cache boilerplate (static `Map` + TTL env-parsing) is duplicated near-identically across `whois.ts:19-33`, `dns.ts:20-33`, `github-intel.ts:18-31`, `securitytxt.ts:36-49` — a shared base/helper would remove ~4x duplication.
27. Gemini model is hardcoded `"gemini-3.5-flash"` (`intelligence.ts`) with no env override, unlike every connector's env-configurable TTLs/timeouts.
28. `tsconfig.json`'s `"@/*"` path alias is never actually used anywhere in `server.ts` or `tests/` — dead config.
29. `vite.config.ts` still has leftover comments referencing "AI Studio" and a `DISABLE_HMR` flag — incomplete template cleanup from the project's origin.
30. `npm run clean` still references `rm -rf dist server.js`, but the build only ever produces `dist/server.cjs` — stale script leftover.
31. No `"engines"` field in `package.json` despite `DEPLOYMENT.md` mandating Node ≥18.
32. Typo **"TACTICAL INTELLIGENCE BREIFING REPORT"** in `InvestigationReport.tsx:384` — visible in the actual print/PDF export, user-facing.
33. No test coverage for `entityResolution.ts` (no dedicated test file at all) or the `whois.ts` connector (despite WHOIS being load-bearing for `conf_whois`/`risk_newly_registered` scoring). (`/keys`, `/playground/transform`, `/metrics`, `/intelligence/analyze` route-layer coverage gap from the original audit was partially closed in Milestone 0 — the new `cross-tenant isolation` describe block in `tests/server.test.ts` now exercises `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId`, `/metrics`, and `/playground/transform` at the HTTP layer; `/intelligence/analyze` route-layer coverage is still missing.)

## Already fixed (historical record — do not re-open)

**Milestone 0 (2026-07-28)** — see `docs/CHANGELOG_AI.md` for full detail:
- **Critical: cross-tenant IDOR across `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId`.** Every API key resolved to one shared identity (`usr_api_client`); fixed by giving each key its own `ownerId`, scoping all five routes (plus `/metrics`, found to have the same aggregation problem while fixing this) to `req.user.id`. Regression-tested in `tests/server.test.ts`'s `cross-tenant isolation` describe block.
- `errorHandler` (`utils/observability.ts`) no longer leaks `err.message` in production; the same fix applied to the 4 known `server.ts` leak sites via a shared `errorDetails()` helper. Regression-tested in `tests/observability.test.ts`.
- Scoring engine's `risk_newly_registered`/`risk_long_established` now compute domain age relative to `Date.now()` instead of hardcoded absolute years (2024/2018) that would have silently drifted wrong over time.
- Dashboard's fake 24h usage chart (hardcoded data never wired to `metrics`) replaced with an honest "not tracked yet" placeholder rather than continuing to fabricate hourly numbers.
- Job cancellation now threads a real `AbortSignal` through `InvestigationService.investigate()` and `IntelligenceService.analyze()`: not-yet-started connectors are skipped, an in-flight GitHub-discovery fetch is actually aborted, and the (billed) Gemini call is skipped in favor of the free deterministic fallback if cancellation lands before AI synthesis starts. Also fixed a related bug where a job cancelled between `createJob()` and its deferred start would get silently overwritten back to `"running"`.
- **Found and fixed while implementing the above** (not on the original audit list): `/playground/transform`'s real-Gemini branch bumped an arbitrary "first active key's" `requestCount`/`lastUsedAt` on every call, corrupting an unrelated tenant's usage stats — this was already fully redundant with `authenticateRequest`'s correct per-key tracking, so it was removed rather than fixed.

**Original v1.0.0 release audit** — from the prior `RELEASE_CHECKLIST.md` "Must Fix Before Launch" audit, all verified fixed in code prior to this session: hardcoded source-committed API keys; shared global `currentUser` session bug; missing SSRF protection on GitHub-discovery homepage fetch; WHOIS-fallback evidence wrongly counted as a confidence-boosting success; GitHub API rate-limit/network errors conflated with genuine `NO_DATA`.
