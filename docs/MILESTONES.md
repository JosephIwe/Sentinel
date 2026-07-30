# Milestones

Reconstructed from git history plus this session's audit. Dates are commit/session timestamps.

## Foundation (2026-07-11)

- Initial project scaffold; `InvestigationQuery` / `Evidence` domain types introduced.
- First multi-source cyber investigation pipeline implemented.
- Investigation history/persistence (in-memory), print-friendly report UI, entity/evidence model refactor with WHOIS caching.
- GitHub Intelligence connector and DNS enhancements added.

## Async pipeline & grounding (2026-07-12 – 2026-07-14)

- Asynchronous investigation pipeline (`InvestigationWorker`, job polling) implemented.
- Grounded-response mode and hallucination verification introduced (precursor to today's `ValidationService`).
- API key generation/masking upgraded.
- Entity graph visualization added to the frontend.

## Trust cleanup (2026-07-16)

- **Removed three connectors (Google Search, legacy GitHub, News) that returned fabricated data** presented as verified evidence — the project's defining correctness fix, and the origin of its core "never fabricate evidence" invariant.
- GitHub discovery diagnostics added to reports; investigation status handling/validation optimized.
- Project metadata, policies, and environment documentation formalized.

## Test coverage sprint (2026-07-17)

- Full backend/service unit test coverage added: scoring, rate limiter, frontend input validation, server.ts HTTP API, legacy connectors, hallucination detection/validation, intelligence service/worker.
- README rewritten as a standard project front page; screenshots added.

## v1.0.0 release audit (2026-07-19 – 2026-07-20)

- `RELEASE_CHECKLIST.md` produced from a full-repository release-readiness audit.
- **Final pre-launch bug-fix sprint**: 6 verified v1.0.0 blockers fixed (hardcoded API keys, shared `currentUser` session bug, SSRF exposure, WHOIS scoring bug, GitHub rate-limit/`NO_DATA` conflation, +1 more).
- Private-beta access gate added for the web UI.
- 4 additional bugs fixed during final beta-readiness validation.

## v1.1 connector expansion begins (2026-07-22)

- `SecurityTxtConnector` shipped (Beta): RFC 9116 parsing, new "Security Posture" report section.
- Roadmap updated; `docs/CONNECTOR_RELEASE_CHECKLIST.md` formalized the one-connector-at-a-time process.

## Full project audit & memory system (2026-07-28)

- Complete repository re-read: every service, connector, component, util, test file, and config directly inspected (not just docs).
- Actually ran the build/test/lint/audit pipeline: 229/229 tests pass, lint clean, build succeeds, 1 high-severity dependency advisory found.
- **Discovered a critical, previously-unreported cross-tenant IDOR** spanning `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId`, rooted in a shared API-key identity model.
- Found 7 additional High-severity bugs (fake dashboard chart, dead `onAddJob` wiring, mobile nav gap, non-cancellable jobs, duplicated-type shape mismatch, scoring date drift, a 5th error-leak site), plus 20 Medium and 10 Low findings — all catalogued in the new `docs/KNOWN_ISSUES.md`.
- Established the full `docs/` project-memory system (`PROJECT_OVERVIEW.md`, `KNOWN_ISSUES.md`, `CHANGELOG_AI.md` new; `CURRENT_STATUS.md`, `ROADMAP.md`, `TECH_DECISIONS.md`, `NEXT_SESSION.md` rewritten with code-verified findings).
- Proposed a 7-milestone prioritized plan (`docs/ROADMAP.md`) starting with the IDOR fix. Roadmap approved by the user the same day.

## Milestone 0: security & trust emergency fixes (2026-07-28)

- Fixed the critical cross-tenant IDOR: every API key now carries its own `ownerId`; `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId`, and `/metrics` are all scoped to the caller instead of a shared identity.
- Fixed the 5th `err.message` leak site (`utils/observability.ts`'s `errorHandler`), the scoring engine's hardcoded absolute-year date drift, the Dashboard's fabricated usage chart (replaced with an honest placeholder), and non-functional job cancellation (now threads a real `AbortSignal`).
- Found and fixed one bug not on the original list: a redundant, incorrect API-key stat-tracking block in `/playground/transform`.
- Added regression tests (`tests/observability.test.ts`, a new `cross-tenant isolation` describe block in `tests/server.test.ts`); 240/240 tests pass, lint clean, build succeeds.
- Full detail in `docs/CHANGELOG_AI.md`; issue tracking updated in `docs/KNOWN_ISSUES.md`.

## Milestone 1: frontend correctness & functional gaps (2026-07-28)

- Fixed the `RelationshipEdge` shape mismatch (`PlaygroundView.tsx` used `from`/`to`, which don't exist on the real API's `source`/`target` shape — relationships rendered blank) by importing canonical types from `src/types.ts`; found and fixed a second instance of the same bug class in the same file (`entity.confidence`/`entity.details`).
- Resolved the `onAddJob` dead code by removing it rather than forcing a fake wire-up: Playground's UI runs investigations via `/api/investigations`, an entirely different feature from the `/playground/transform` (`ExtractionJob`) flow the old code assumed. Relabeled Dashboard's "Extraction History" tab to clarify the distinction.
- Added a mobile navigation fallback (hamburger + slide-down panel) to `Layout.tsx` — Playground/History/Docs/Dashboard were previously unreachable below 768px.
- Surfaced real error states for `App.tsx`'s login/key-management handlers, which previously had no `else` branch at all for non-OK HTTP responses (worse than console-log-only) — routed through `AuthView.tsx`/`DashboardView.tsx`'s existing local-error-state patterns.
- Eliminated (not just reconciled) the two disconnected history data models: `HistoryView.tsx` now reads real per-tenant server history instead of an unscoped `localStorage` copy, made safe to do by Milestone 0's ownership fixes.
- Fixed the "BREIFING" print-output typo.
- Verified with `npm run test` (240/240), `npm run lint`, `npm run build`, plus a manual Playwright smoke-test pass against the running dev server with reviewed screenshots (mobile nav, login, key creation, a full investigation run, relationships rendering real data, and a history-restore round trip).
- Full detail in `docs/CHANGELOG_AI.md`; issue tracking updated in `docs/KNOWN_ISSUES.md` — 0 Critical, 0 High issues remain open.

## Milestone 2: release engineering & project readiness (2026-07-28)

- Added `.github/workflows/ci.yml` (`npm ci` → lint → test → build on push/PR, Node 18) — nothing previously gated a regressing PR.
- Added a production multi-stage `Dockerfile` and `.dockerignore`, matching the layout `DEPLOYMENT.md` had only ever documented inline.
- Completed the OpenAPI spec for the 4 previously-undocumented live routes (`/jobs`, `/playground/transform`, `/metrics`, `/intelligence/analyze`), documented against the real handler shapes and verified live — 15/15 registered routes present, Swagger UI renders.
- Fixed version drift: `GET /version` and the OpenAPI spec's `info.version` both hardcoded `"1.0.0"` instead of `"1.0.0-rc.1"`. Version now consistent across `package.json`, `VERSION.md`, `README.md`, `server.ts`, `src/api/openapi.ts`, `DEPLOYMENT.md`, and both SDKs.
- `npm audit fix` for the postcss path-traversal advisory (patch-level, non-breaking) — 0 vulnerabilities remain.
- Removed confirmed dead code within the session's constraints: the unused `"@/*"` tsconfig alias and the stale `npm run clean` target.
- Documentation cleanup: `SECURITY.md`'s unverified contact replaced with GitHub Security Advisories; placeholder repo URLs in `CONTRIBUTING.md`/`package.json` corrected; two undocumented env vars added to `DEPLOYMENT.md`; a `CHANGELOG.md` entry that had been truncated mid-sentence since a much earlier commit fixed, and `[Unreleased]` backfilled with the Milestone 0/1/2 changes.
- Verified: 240/240 tests, lint clean, build succeeds, 0 audit findings, CI YAML validated. `docker build` could not be run — this sandbox's egress policy denies Docker Hub's CDN — so the image's exact install and start commands were verified standalone instead.

## Release-readiness correction (2026-07-28, post-Milestone 2)

- Fixed `server.ts` hardcoding `const PORT = 3000` without reading `process.env.PORT`, despite `DEPLOYMENT.md` and the `Dockerfile` documenting `PORT` as configurable — any PaaS assigning a non-3000 port would have had the container listen on the wrong one. Now honors `process.env.PORT` with a validated fallback to `3000`. Verified across custom/unset/invalid-value cases.
- Reconciled `docs/KNOWN_ISSUES.md` and `docs/MILESTONES.md` (this file), which had been deliberately left untouched during Milestone 2 under that session's narrowed doc-update scope and had gone stale.

## Open (as of 2026-07-28, end of release engineering)

- rc.1 is still the declared version; a real `v1.0.0` tag has not been cut.
- Release engineering is complete. Milestone 3 in `docs/ROADMAP.md` is test coverage & quality hardening; the product-side next step is the first v1.1 connector (`TechnologyFingerprintConnector`) per the connector expansion plan.
