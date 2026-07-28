# Sentinel Roadmap

_Canonical roadmap. The root `ROADMAP.md` mirrors a summary of this file for discoverability — update both together when this changes materially._

## Status

A full-repository audit (2026-07-28, see `docs/KNOWN_ISSUES.md`) produced the 7-milestone plan below, replacing the earlier "close the RELEASE_CHECKLIST recommendations" framing with a severity-ordered plan that leads with a critical security finding. **The roadmap was approved by the user on 2026-07-28. Milestone 0 is complete** (see below); Milestone 1 is next and has not started.

---

## Milestone 0 — Security & Trust Emergency Fixes ✅ COMPLETE (2026-07-28)

**Objective**: close every Critical/High-severity issue from `docs/KNOWN_ISSUES.md`, led by the cross-tenant IDOR — this is the one thing that should not wait behind anything else.

**Tasks** (all complete — see `docs/CHANGELOG_AI.md` for full detail and `docs/KNOWN_ISSUES.md`'s "Already fixed" section):
- [x] Designed and implemented real per-tenant identity for API-key auth: each key now carries its own `ownerId`, resolved into `req.user.id` in `authenticateRequest` instead of the old shared `usr_api_client`.
- [x] Added ownership checks to `GET/PUT/POST /keys*`, `GET /jobs`, `GET /history`, `GET /reports/:id`, `GET /investigations/:jobId`, and `GET /metrics` (found to have the same cross-tenant aggregation problem while fixing the rest).
- [x] Fixed `utils/observability.ts`'s `errorHandler` to gate `err.message` behind `NODE_ENV !== "production"`, matching the same fix applied to `server.ts`'s 4 inline catch blocks via a shared `errorDetails()` helper.
- [x] Fixed `scoring.ts`'s hardcoded absolute-year thresholds (`risk_newly_registered`/`risk_long_established`) to compute domain age relative to `Date.now()`.
- [x] Replaced the Dashboard's fake usage chart with an honest "not tracked yet" placeholder (no real per-hour telemetry exists to wire it to; fabricating one would repeat the exact problem being fixed).
- [x] Implemented real job cancellation: an `AbortSignal` is now threaded through `InvestigationService.investigate()` and `IntelligenceService.analyze()`, so not-yet-started connectors are skipped, an in-flight GitHub-discovery fetch is genuinely aborted, and the billed Gemini call is skipped in favor of the free deterministic fallback when cancellation lands first. Also fixed a related bug where a job cancelled before its deferred start got silently overwritten back to `"running"`.
- [x] Bonus fix found while implementing the above (not on the original list): removed a redundant, incorrect stat-tracking block in `/playground/transform` that bumped an arbitrary "first active key's" usage counters regardless of who actually called it.

**Verification**: `npm run test` (240/240 passing, including a new `cross-tenant isolation` describe block in `tests/server.test.ts` and a new `tests/observability.test.ts`), `npm run lint` (clean), `npm run build` (succeeds).

**Risks encountered**: TypeScript's control-flow narrowing initially broke on removing the `(job.status as string)` cast in `investigationWorker.ts` — the cast wasn't dead code as originally assessed in the audit, it was working around a real narrowing limitation (TS can't see `cancelJob` mutating the job object asynchronously via the shared map). Fixed properly with an `isCancelled()` helper that re-reads through a fresh parameter binding, rather than reintroducing an unsafe cast.

**Deferred to Milestone 1** (still open, downgraded from the original "High" bucket now that the Critical item and 4 of the original 7 High items are fixed): mobile nav gap, Dashboard/Playground disconnect (`onAddJob` dead code), `RelationshipEdge` shape mismatch.

---

## Milestone 1 — Frontend Correctness & Functional Gaps

**Objective**: fix real, user-visible functional bugs.

**Tasks**:
- Wire `onAddJob` so Dashboard reflects real Playground activity (or remove the dead prop/handler pair if the two views are meant to stay separate — make it a deliberate choice either way).
- Resolve the `RelationshipEdge` shape mismatch by importing the type from `src/types.ts` in both `PlaygroundView.tsx` and `InvestigationReport.tsx` instead of local redefinitions; verify against the real API response which shape (`from/to` vs `source/target`) is actually correct.
- Add a mobile navigation fallback (hamburger or equivalent) for viewports below `md:`.
- Surface visible error states for `App.tsx`'s login/key-management handlers and the localStorage `JSON.parse` failure sites in `HistoryView.tsx`/`PlaygroundView.tsx`.
- Fix the "BREIFING" typo in the print report.
- Decide on and implement one path for reconciling the two disconnected history data models (server `extractionJobs` vs. localStorage history) — at minimum, share one shape between them even if they stay conceptually separate.

**Dependencies**: independent of Milestone 0, can run in parallel.

**Risks**: the history-model reconciliation could balloon into a bigger redesign if scoped loosely — recommend scoping to "share one type, not necessarily one store" unless product wants a bigger unification.

**Estimated complexity**: Medium.

**Expected outcome**: UI behaves consistently with what it visually promises; no silently-dead data paths.

---

## Milestone 2 — Release Hygiene (CI, Docker, OpenAPI, docs)

**Objective**: everything needed to responsibly cut a real `v1.0.0` tag and accept outside contributions.

**Tasks**:
- Add `.github/workflows/ci.yml` (`npm ci && npm run lint && npm run test` on push/PR).
- Add a `Dockerfile` matching (and validating) `DEPLOYMENT.md`'s existing inline example.
- Complete `src/api/openapi.ts` for `/jobs`, `/playground/transform`, `/metrics`, `/intelligence/analyze`.
- Run `npm audit fix` for the postcss advisory (verify it doesn't break the Tailwind v4 build).
- Fix `SECURITY.md`'s contact email and `CONTRIBUTING.md`'s placeholder clone URL.
- Add `"engines": {"node": ">=18"}` to `package.json`; fix the `/version` vs `package.json` version drift.
- Clean up `vite.config.ts`'s leftover AI-Studio-era comments, the unused `@/*` tsconfig alias, and the stale `npm run clean` target.
- Delete (not just exclude) the dead legacy connectors (`src/connectors/google.ts`, `news.ts`, `github.ts`) once `tests/legacy-connectors.test.ts` is retired or repointed — removes residual attack surface entirely rather than relying on `server.ts` never wiring them in.

**Dependencies**: do this *after* Milestone 0 so CI enforces the security fixes going forward, not before.

**Risks**: low, mostly additive; deleting legacy connectors requires updating/removing their test file first.

**Estimated complexity**: Small–Medium.

**Expected outcome**: a real, CI-gated `v1.0.0` tag; deployment docs that are actually validated; no known dependency vulnerabilities.

---

## Milestone 3 — Test Coverage & Quality Hardening

**Objective**: build a regression safety net, especially around what Milestones 0–1 change.

**Tasks**:
- Tests for the new ownership checks on `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId` (must assert a second "tenant" cannot see/mutate the first's data — this is the actual regression test for the Critical fix).
- Tests for `/playground/transform`, `/metrics`, `/intelligence/analyze` at the HTTP route layer (not just the underlying services).
- A dedicated test file for `entityResolution.ts` (currently has none).
- A dedicated test file for the `whois.ts` connector (currently has none, despite being load-bearing for scoring).
- Fix the teardown race in `tests/investigation-rate-limit.test.ts` causing the 2 unhandled-rejection warnings.
- First React component tests (`@testing-library/react` + jsdom config), starting with `InvestigationReport.tsx` and the Playground submit flow's golden + one error path — this was already a post-launch item in `RELEASE_CHECKLIST.md`.

**Dependencies**: after Milestone 0 (auth/ownership tests need the final shape) and ideally after Milestone 1 (frontend tests need the fixed component structure, not the buggy one).

**Risks**: none major; mostly additive effort.

**Estimated complexity**: Medium.

**Expected outcome**: the security fix is actually regression-tested, not just fixed once; frontend has a first real safety net.

---

## Milestone 4 — Code Quality & Maintainability Debt

**Objective**: pay down duplication/architecture debt so future work is cheaper, with no functional change.

**Tasks**:
- Extract a shared confidence-tier color/label helper (currently copy-pasted in 3 components).
- Extract a shared connector cache base/helper (currently duplicated across 4 connectors).
- Break `InvestigationReport.tsx` (2055 lines) into sub-components with appropriate memoization.
- Remove the dead duplicate `src/utils/validation.ts` module.
- Add validation for `scoringRules.json` against `scoring.ts`'s known rule ids, so a typo fails loudly instead of silently no-opping a rule.

**Dependencies**: best done after Milestone 1 (frontend refactor) so it doesn't fight in-flight bug fixes, and after Milestone 3 provides a safety net for the `InvestigationReport.tsx` split specifically.

**Risks**: refactor risk of introducing regressions in a large component — mitigated by having Milestone 3's tests in place first.

**Estimated complexity**: Large (the `InvestigationReport.tsx` split is the bulk of it).

**Expected outcome**: lower future maintenance cost; no behavior change.

---

## Milestone 5 — Accessibility & Product Polish

**Objective**: close the accessibility gaps found in the audit.

**Tasks**:
- Add ARIA tab semantics (`role="tablist"`, `aria-selected`) to the 4 tab-like UIs (Dashboard, Playground results, Docs language tabs, HistoryView filters).
- Associate form labels properly (Dashboard provision-key form, Playground fields/toggle) via `htmlFor`/`id`, matching the pattern `AuthView.tsx` already gets right.
- Add `aria-current="page"` to the active nav tab.
- Fix the 29 occurrences of `text-[7px]`/`text-[8px]` low-contrast text to a readable size/contrast.
- Add a loading state to `DashboardView` for its first-paint fetch.

**Dependencies**: none — can run in parallel with anything else.

**Risks**: low.

**Estimated complexity**: Small–Medium.

**Expected outcome**: meaningfully closer to WCAG compliance; more polished UI.

---

## Milestone 6 — Detection & Scoring Quality Improvements

**Objective**: strengthen the hallucination detector and entity resolution against known bypass patterns.

**Tasks**:
- Tighten the hallucination detector's proper-noun grounding from substring matching to exact-token matching.
- Add numeric/statistical/date claim checking to the hallucination detector (currently absent entirely).
- Fix entity resolution's "Generic" type wildcard so it can't false-merge unrelated typed entities from different connectors.
- Add the config-schema validation from Milestone 4 as a prerequisite here too (a stricter detector needs its own rules to be trustworthy).

**Dependencies**: none blocking, but pairs naturally with Milestone 3's testing work.

**Risks**: could change existing report output/scores for real investigations — validate before/after against representative targets (in the spirit of `VALIDATION_REPORT.md`'s scenario table) before merging.

**Estimated complexity**: Medium–Large (research-heavy — false positive/negative tuning takes iteration).

**Expected outcome**: reports are more resistant to subtle hallucination and false entity merges — directly strengthens the project's core trust invariant.

---

## Deferred: v1.1 Connector Expansion

Recommendation: hold this behind Milestones 0–3. Shipping new connectors on top of an unfixed IDOR and untested ownership model just means more data exposed to the same bug.

- `TechnologyFingerprintConnector`
- `CertificateTransparencyConnector`
- `ShodanConnector`
- `Crawl4AI WebFootprintConnector`

Each ships one at a time via `docs/CONNECTOR_RELEASE_CHECKLIST.md` once resumed.

## Further out

- Persistent backing store (Postgres/Firestore) for API keys, investigation history, job state.
- Centralized API key rotation / secret signing (e.g. Google Secret Manager).
- Redis-backed distributed rate limiting.
- HTTP keep-alive / connection pooling on outbound connector calls.
- A product decision on SDK scope: expand `sdks/` to cover `/auth`, `/keys`, `/jobs`, `/playground/transform`, `/metrics`, `/intelligence/analyze`, or confirm the current "core investigation only" scope is intentional.
