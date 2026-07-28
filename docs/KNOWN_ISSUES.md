# Known Issues

Canonical, severity-ordered issue list for Sentinel. This supersedes the scattered "Recommended Before Launch" list in `RELEASE_CHECKLIST.md` (kept for historical record) — treat this file as the current source of truth and keep it updated as items are fixed or new ones are found.

**Severity guide**: `Critical` = exploitable data exposure/integrity issue or a bug that breaks a core promise of the product. `High` = real user-facing bug or a significant correctness/security gap. `Medium` = real but bounded impact, or a process/hygiene gap. `Low` = cosmetic, maintainability, or minor debt.

_Last audited: 2026-07-28, against commit `f995437`._

## Critical

1. **Cross-tenant IDOR across `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId`.** API-key auth resolves every key holder to one shared identity `usr_api_client` (`server.ts:232-239`); no handler filters by the requester's identity. Concretely: `GET /keys` returns every tenant's keys (masked) regardless of caller (`server.ts:361-364`); `PUT /keys/:id/revoke` and `POST /keys/:id/rotate` let any authenticated or guest-fallback caller revoke/rotate any other tenant's key by id (`server.ts:385-404`); `GET /jobs` (407-409), `GET /history` (907-936 — records carry `userId` but it's never checked against `req.user`), `GET /reports/:id` (939-958), and `GET /investigations/:jobId` (`investigationWorker.ts:53`, no owner check) are all similarly unscoped. **Not on the prior release checklist; found in this audit.** Root-caused by the shared-identity design, not just missing filters — fixing the filters alone papers over the fact that all API-key traffic is indistinguishable from itself.

## High

2. **`errorHandler` leaks raw `err.message` unconditionally** (`utils/observability.ts:114-118`), regardless of `NODE_ENV`. A 5th leak site beyond the 4 already known in `server.ts` (~lines 563, 865, 885, 902).
3. **Scoring engine uses hardcoded absolute-year thresholds** — `risk_newly_registered` checks `yr >= 2024`, `risk_long_established` checks `yr < 2018` (`scoring.ts:310`, `:373`) instead of computing relative to `Date.now()`. These drift with time: a 2024-registered domain is flagged "newly registered" forever, and domains registered 2019–2023 permanently fall into a scoring gray zone that gets neither bonus nor penalty — contradicting the rules' own "under 2 years"/"over 5 years" language (`scoringRules.json:70,94`).
4. **Dashboard's "Ingress Distribution (24h)" chart is 100% hardcoded fake data** (`DashboardView.tsx:57-65`, a literal array never wired to `metrics`). This directly contradicts the project's own core invariant against presenting fabricated data as real — just in the UI instead of a connector.
5. **Job cancellation doesn't stop in-flight work.** `InvestigationWorker.cancelJob` (`investigationWorker.ts:60-68`) only flips `job.status`; `processJob` checks for `"cancelled"` at three checkpoints (85, 108, 118) but never aborts the in-flight `investigate()` or Gemini call — a "cancelled" job keeps consuming connector/AI quota in the background. (Also: those three checks use `(job.status as string)` casts against `"cancelled"` even though the type union already includes it — a dead type-safety workaround likely masking an earlier bug.)
6. **Mobile navigation is entirely unreachable below 768px.** `Layout.tsx`'s `<nav>` is `hidden md:flex` (line 49) with no hamburger or alternate mobile nav — Playground/History/Docs/Dashboard are unreachable from a phone-sized viewport except via direct app state, contradicting the README's own mobile screenshot claim.
7. **Dashboard is permanently disconnected from real Playground activity.** `PlaygroundView` accepts an `onAddJob` prop (`PlaygroundView.tsx:74,79`) but never calls it in `handleRunInvestigation`, making `App.handleAddJob` (`App.tsx:158-168`) dead code — Dashboard's extraction log and `metrics.totalRequests` never reflect real usage.
8. **Duplicated `RelationshipEdge` interface has two incompatible shapes**: `from`/`to` in `PlaygroundView.tsx:20-21` vs. `source`/`target` in `InvestigationReport.tsx:19-22`, for what's meant to be the same API response type. Only one of these two components can be correctly reading the real server payload — the other is likely rendering `undefined` for the edge endpoints. Root cause: both components redefine shared domain types locally instead of importing from `src/types.ts`.

## Medium

9. No CI workflow exists (`.github/workflows/` absent) — nothing blocks a regressing PR from merging.
10. No `Dockerfile` exists, despite `DEPLOYMENT.md` shipping its own inline Dockerfile example that has never been built/tested.
11. OpenAPI spec (`src/api/openapi.ts`) is missing `/jobs`, `POST /playground/transform`, `GET /metrics`, `POST /intelligence/analyze` — all live, authenticated routes absent from the `/docs` Swagger UI.
12. `npm audit` reports 1 high-severity advisory: **postcss ≤8.5.17 path traversal** (GHSA-r28c-9q8g-f849), pulled in transitively via Tailwind v4. Fixable via `npm audit fix`.
13. Frontend silently swallows errors via `console.error` only, no visible UI state: `App.tsx`'s `handleLoginSuccess`/`handleAddKey`/`handleRevokeKey`/`handleRotateKey`, and the same anti-pattern recurs in `HistoryView.tsx:39,51` and `PlaygroundView.tsx:101,129` for localStorage `JSON.parse` failures.
14. **Hallucination detector's proper-noun grounding is loose substring matching** (`validation.ts:180,235`: `prop.includes(nounLower) || nounLower.includes(prop)`) — a short verified token can "verify" an unrelated longer fabricated word, letting partially-fabricated multi-word entities through. No numeric/statistical/date claim checking exists at all — only emails/domains/repos/proper nouns are checked.
15. **Entity resolution can false-merge unrelated entities.** `areEntitiesMatching` treats any `"generic"`-typed entity as matching any other type (`entityMatcher.ts:158-159`) before applying an 85%-similarity fuzzy threshold — a `Generic` entity from one connector can merge into an unrelated typed entity from another connector on name similarity alone.
16. **Scoring "configuration" isn't actually config-driven.** `scoringRules.json` only supplies `id`/`name`/`points`/`explanation`; the actual match logic is a hardcoded TS `switch` on rule `id` (`scoring.ts:166-263,268-432`). A typo'd or renamed `id` in the JSON silently falls through to `matched:false` with no validation error — a config edit can silently disable a rule.
17. **Accessibility gaps**: unlabeled form inputs (Dashboard's provision-key form `DashboardView.tsx:254-274`, Playground's investigate-panel fields and toggle `PlaygroundView.tsx:296-323,360-368`); no `aria-current="page"` on the active nav tab (`Layout.tsx:49-113`); no ARIA tab roles/`aria-selected`/`aria-pressed` across 4 tab-like UIs (Dashboard's metrics/keys/jobs tabs, Playground's result tabs, Docs' language tabs, HistoryView's type filters); 29 occurrences of `text-[7px]`/`text-[8px]` low-contrast text across InvestigationReport/Dashboard/Playground/EntityGraph.
18. **Zero React component tests exist** — `@testing-library/react` isn't even a dependency. Already flagged as a post-launch item in `RELEASE_CHECKLIST.md`; still true.
19. `tests/investigation-rate-limit.test.ts` produces 2 non-fatal `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending` unhandled-rejection warnings on every test run — currently masked by an otherwise-green suite, but a real teardown race that will look like flakiness once CI exists.
20. **Two disconnected "investigation history" data models** — server-side `extractionJobs` (App.tsx state, `ExtractionJob` shape) vs. localStorage-backed history (`HistoryView.tsx`/`PlaygroundView.tsx`, `InvestigationHistoryRecord` shape) — never reconciled; Dashboard's history tab and the dedicated History page can show different, non-overlapping data for the same session.
21. `SECURITY.md` still points to an unverified `security@sentinelapi.dev`; `CONTRIBUTING.md` still has the placeholder clone URL `your-org/sentinel-api`.
22. **`SESSION_SECRET` silently falls back to a random per-process-start value if unset** (`utils/session.ts:24`) — breaks session validity across restarts or multi-instance deployments, with no caveat documented in `DEPLOYMENT.md`.
23. No `helmet` or explicit CORS configuration — no CSP/HSTS/X-Content-Type-Options hardening headers.
24. **Dead duplicate validation module**: `src/utils/validation.ts` reimplements the same logic as the actually-used `utils/validation.ts` with a different function signature — confusing but not currently harmful since `server.ts` imports the correct one.
25. **Dead legacy fabricated-data connectors still present in the tree**: `src/connectors/google.ts`, `news.ts`, `github.ts` still compile and still return `SUCCESS` with fabricated data (consistent with their original intent), explicitly excluded from the live pipeline (`server.ts:591-601`) but a residual attack surface if ever accidentally re-wired.
26. `GET /version` hardcodes `"1.0.0"` (`server.ts:107`) while `package.json` says `"1.0.0-rc.1"` — version drift between the two sources of truth.
27. **`InvestigationReport.tsx` is a 2055-line single component**, ~1870 lines in one function body, doing report actions, risk scoring, entity list/graph toggle, connector-status grid, timeline, and print layout with zero `useMemo`/`useCallback` anywhere in the file — maintainability and (as data volume grows) performance risk.
28. SDKs (`sdks/typescript`, `sdks/python`) cover only the core investigation flows (`/investigate`, `/investigations`, `/history`, `/reports`) — not `/auth`, `/keys`, `/jobs`, `/playground/transform`, `/metrics`, `/intelligence/analyze`. Possibly intentional scoping, possibly drift; worth a product decision either way.

## Low

29. IDs for users/keys/jobs use `Math.random().toString(36)` (`server.ts:334,372,468,531`, `investigationWorker.ts:28`) rather than crypto-strength randomness — only API key *secrets* use `crypto.randomBytes`.
30. Confidence-tier color/label logic (`>=80`/`>=50` thresholds) is copy-pasted verbatim in `InvestigationReport.tsx:555-557`, `HistoryView.tsx:274-275`, `PlaygroundView.tsx:666-673` instead of a shared helper.
31. Cache boilerplate (static `Map` + TTL env-parsing) is duplicated near-identically across `whois.ts:19-33`, `dns.ts:20-33`, `github-intel.ts:18-31`, `securitytxt.ts:36-49` — a shared base/helper would remove ~4x duplication.
32. Gemini model is hardcoded `"gemini-3.5-flash"` (`intelligence.ts:55`) with no env override, unlike every connector's env-configurable TTLs/timeouts.
33. `tsconfig.json`'s `"@/*"` path alias is never actually used anywhere in `server.ts` or `tests/` — dead config.
34. `vite.config.ts` still has leftover comments referencing "AI Studio" and a `DISABLE_HMR` flag — incomplete template cleanup from the project's origin.
35. `npm run clean` still references `rm -rf dist server.js`, but the build only ever produces `dist/server.cjs` — stale script leftover.
36. No `"engines"` field in `package.json` despite `DEPLOYMENT.md` mandating Node ≥18.
37. Typo **"TACTICAL INTELLIGENCE BREIFING REPORT"** in `InvestigationReport.tsx:384` — visible in the actual print/PDF export, user-facing.
38. No test coverage for `entityResolution.ts` (no dedicated test file at all), the `whois.ts` connector (despite WHOIS being load-bearing for `conf_whois`/`risk_newly_registered` scoring), or the HTTP route layer for `/keys`, `/playground/transform`, `/metrics`, `/intelligence/analyze` (the underlying services are unit-tested, the routes/auth wiring are not).

## Already fixed (historical record — do not re-open)

From the prior `RELEASE_CHECKLIST.md` "Must Fix Before Launch" audit, all verified fixed in code as of this session: hardcoded source-committed API keys; shared global `currentUser` session bug; missing SSRF protection on GitHub-discovery homepage fetch; WHOIS-fallback evidence wrongly counted as a confidence-boosting success; GitHub API rate-limit/network errors conflated with genuine `NO_DATA`.
