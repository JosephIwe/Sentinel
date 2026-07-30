# Sentinel Roadmap

_Canonical roadmap. The root `ROADMAP.md` mirrors a summary of this file for discoverability — update both together when this changes materially._

## Status

A full-repository audit (2026-07-28, see `docs/KNOWN_ISSUES.md`) produced the 7-milestone plan below, replacing the earlier "close the RELEASE_CHECKLIST recommendations" framing with a severity-ordered plan that leads with a critical security finding. **The roadmap was approved by the user on 2026-07-28. Milestones 0, 1, and 2 are complete** (see below); Milestone 3 is next and has not started.

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

## Milestone 1 — Frontend Correctness & Functional Gaps ✅ COMPLETE (2026-07-28)

**Objective**: fix real, user-visible functional bugs.

**Tasks** (all complete — see `docs/CHANGELOG_AI.md` for full detail and `docs/KNOWN_ISSUES.md`'s "Already fixed" section):
- [x] Resolved the `onAddJob` dead code: rather than force a fake mapping, removed it. Playground's UI runs investigations via `/api/investigations`, not the `/playground/transform` (`ExtractionJob`) flow `onAddJob` assumed — the two were never actually the same feature. Relabeled the Dashboard's "Extraction History" tab to clarify what it shows (API/SDK-driven schema extraction) versus "Investigation History" (Playground-run investigations).
- [x] Resolved the `RelationshipEdge` shape mismatch by importing `Relationship`/`Entity` from `src/types.ts` in both `PlaygroundView.tsx` and `InvestigationReport.tsx`. The real API shape is `source`/`target` (confirmed against `server.ts`'s responses and `EntityGraph.tsx`'s existing correct usage) — `PlaygroundView.tsx`'s `from`/`to` was the broken one. Also fixed a second instance of the same bug class found in the process: `entity.confidence`/`entity.details` don't exist on the real `Entity` type either.
- [x] Added a mobile navigation fallback: hamburger toggle + slide-down panel in `Layout.tsx`, covering all the same destinations as the desktop nav.
- [x] Surfaced visible error states for `App.tsx`'s login/key-management handlers (worse than console-log-only — non-OK responses previously hit no branch at all) via `AuthView.tsx` and `DashboardView.tsx`'s existing local-error-state patterns.
- [x] Fixed the "BREIFING" typo in the print report.
- [x] Reconciled the two disconnected history data models — not by sharing a type, but by eliminating the duplication entirely: `HistoryView.tsx` now reads real per-tenant server history (`GET /api/history`, correctly scoped since Milestone 0) instead of an unscoped `localStorage` copy, and `PlaygroundView.tsx`'s redundant `saveToHistory()` was removed since the server already persists completions.

**Verification**: `npm run test` (240/240 passing — no new automated tests added this milestone, see Risks below), `npm run lint` (clean), `npm run build` (succeeds), plus a manual Playwright smoke-test pass against the running dev server (mobile hamburger nav, login → dashboard → key creation, investigation → relationships tab rendering real `source`/`target` values not `undefined`, and a full history-restore round trip) with screenshots reviewed.

**Risks encountered**: none blocking. The history-model fix ended up being a full elimination rather than the "share one type" fallback the original task description allowed for, since Milestone 0's ownership fixes had already made the server-side data safe to use directly — worth noting for future milestones that some Milestone 1-era workarounds may already be obsolete once earlier milestones land.

**Deferred**: automated frontend test coverage for these changes is still Milestone 3's job (no `@testing-library/react` yet); this milestone's UI verification was manual/visual only.

---

## Milestone 2 — Release Engineering & Project Readiness ✅ COMPLETE (2026-07-28)

**Objective**: everything needed to responsibly cut a real `v1.0.0` tag and accept outside contributions.

This milestone was executed under a tighter, explicitly-scoped instruction set than originally planned above: no architecture/auth/investigation/scoring/evidence/validation/connector changes, minimal focused commits only. Two originally-planned items were consequently deferred rather than done (see "Deferred" below), and one item (dead-code removal) was narrowed in scope for the same reason.

**Tasks** (all complete):
- [x] Added `.github/workflows/ci.yml` running `npm ci`, `npm run lint`, `npm test`, `npm run build` on push/PR (Node 18, matching the documented minimum).
- [x] Added a production `Dockerfile` (matching `DEPLOYMENT.md`'s documented layout, with `--only=production` modernized to `--omit=dev`) and `.dockerignore`.
- [x] Completed `src/api/openapi.ts` for `/jobs`, `/playground/transform`, `/metrics`, `/intelligence/analyze` — all four now documented with real request/response shapes verified against `server.ts`, plus new `ExtractionJob`/`IntelligenceReport` schemas. Verified live: the built server serves all 15 paths at `/api/v1/openapi.json` and Swagger UI renders at `/docs`.
- [x] Ran `npm audit fix` for the postcss advisory (patch-level bump, 8.5.17 → 8.5.24, zero breaking changes, `package-lock.json`-only diff) — `npm audit` now reports 0 vulnerabilities.
- [x] Fixed `SECURITY.md`'s unverified email (replaced with GitHub Security Advisories, a real channel tied to this repo, rather than guessing a replacement address), `CONTRIBUTING.md`'s placeholder clone URL, and `package.json`'s stale `repository`/`bugs`/`homepage` URLs (all previously pointed at a placeholder org that isn't this repo).
- [x] Fixed version drift: `GET /version` and the OpenAPI spec's `info.version` both hardcoded `"1.0.0"` instead of the real `"1.0.0-rc.1"` — now consistent across `package.json`, `VERSION.md`, `README.md`, `server.ts`, `src/api/openapi.ts`, `DEPLOYMENT.md`'s example response, and both SDKs' version comments.
- [x] Removed confirmed dead code within the session's constraints: the unused `"@/*"` tsconfig path alias (zero usages repo-wide) and the stale `npm run clean` script (referenced a `server.js` output the build hasn't produced since it was reorganized to `dist/server.cjs`).
- [x] Cleaned documentation: fixed the placeholders above, fixed a genuinely broken `CHANGELOG.md` entry that had been truncated mid-sentence since a much earlier commit (removed rather than guessed at a completion, since inventing the missing text wasn't defensible), added `SECURITYTXT_CACHE_TTL_MS`/`APP_ACCESS_CODE` to `DEPLOYMENT.md`'s environment variable list (present in `.env.example`, undocumented), and backfilled `CHANGELOG.md`'s `[Unreleased]` section with the security/frontend fixes from Milestones 0-1 and this milestone's release-engineering additions, none of which had been recorded there yet.

**Deferred, not done this session** (both explicitly out of scope under this session's "do not modify connectors/validation" and "keep minimal" constraints, not overlooked):
- Deleting the dead legacy connectors (`src/connectors/google.ts`, `news.ts`, `github.ts`) — this session's instructions explicitly excluded touching `connectors`. Still real dead code; still a legitimate future cleanup, just not this session's to do.
- Adding `"engines": {"node": ">=18"}` to `package.json` and cleaning up `vite.config.ts`'s AI-Studio-era comments — not part of this session's 7 explicit objectives; skipped to honor "do not introduce unrelated improvements."

**Verification**: `npm test` (240/240), `npm run lint` (clean), `npm run build` (succeeds), `npm audit` (0 vulnerabilities), CI workflow YAML validated (parses correctly, structurally sound, mirrors the exact locally-passing npm scripts). **`docker build` itself could not be completed** — this sandbox's egress policy explicitly denies `production.cloudfront.docker.com` (Docker Hub's CDN backend) with a 403, and this session's proxy policy is to report that rather than route around it. Verified everything short of the actual `docker build` instead: `npm ci --omit=dev` (the image's exact runtime-stage install command) succeeds cleanly, and `node dist/server.cjs` (the image's exact `CMD`) boots and correctly serves `/health`, `/version`, and the frontend when run standalone with only production dependencies installed. The Dockerfile itself is a standard, widely-used pattern (`node:18-alpine`, multi-stage build) with no reason to expect it would fail in an environment with normal registry access (e.g. real CI). **Also discovered, out of scope to fix**: `server.ts` hardcodes `PORT = 3000` and does not actually read `process.env.PORT`, despite `DEPLOYMENT.md` and the Dockerfile both documenting `PORT` as configurable — it happens to work today only because the documented default matches the hardcoded value.

**Expected outcome achieved**: CI now gates every PR on lint/test/build; deployment has a real, mostly-verified container path; the API surface is fully documented; the dependency tree has no known vulnerabilities; version numbers agree everywhere; and the project's own documentation no longer contains placeholder URLs, an unverifiable contact, or a corrupted changelog entry.

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

## v1.1 Connector Expansion — IN PROGRESS

Originally held behind Milestones 0–3 (shipping connectors on top of an unfixed IDOR would just expose more data to the same bug). Unblocked once Milestones 0–2 closed the IDOR, added ownership regression tests, and completed release engineering.

- [x] `TechnologyFingerprintConnector` — **Beta, shipped 2026-07-28.** Lives at `src/connectors/technologyFingerprint.ts`. Detects hosting/CDN, cloud platform, web server, framework, CMS, analytics, and security-header posture from six observable surfaces (response headers, security headers, `Set-Cookie` names, `<meta generator>`, framework runtime globals, and parsed `<script src>`/`<link rel=stylesheet>` URLs). Emits `Technology` entities linked to the target `Domain` via `RUNS_TECHNOLOGY`, plus per-run diagnostics (detection time, methods applied, technology count). Surfaced in the report as section 9, "Technology Fingerprinting", with expandable evidence. 29 tests.
- [x] `CertificateTransparencyConnector` — **shipped 2026-07-29** (PR #11). `src/connectors/certificateTransparency.ts`. Queries crt.sh for certificates issued to the target: issuers, common names, SANs, validity windows, serial numbers, and discovered subdomains. SANs are attributed to the target only on an exact or true-subdomain match, so lookalike names are rejected. Report section 10. 21 tests. *Known limitation: crt.sh does not expose certificate fingerprints, so none are reported.*
- [x] `AsnIpIntelligenceConnector` — **shipped 2026-07-30** (PR #12). `src/connectors/asnIpIntelligence.ts`. Resolves the target to its public addresses and reports the announcing network via Team Cymru's IP-to-ASN DNS interface: ASN, announced CIDR, computed address range, RIR, registry country, allocation date, and AS organization. Report section 11. 30 tests.
- [x] `RdapIntelligenceConnector` — **shipped 2026-07-30** (PR #13). `src/connectors/rdapIntelligence.ts`. Discovers the authoritative RDAP service via the IANA bootstrap registry (RFC 7484) and reads the response per RFC 9083: registrar, registry handle, status codes, lifecycle events, published contacts, nameservers, DNSSEC state. Report section 12. 34 tests. *Known limitation: SUCCESS/NO_DATA paths are unit-tested only — every RDAP host is egress-blocked in the dev sandbox; the ERROR path was verified live.*
- [x] `ReverseDnsConnector` — **shipped 2026-07-30** (PR #14). `src/connectors/reverseDns.ts`. Reports PTR records for the addresses a target resolves to, with address family, per-address lookup status, and resolution timestamp. Each PTR hostname is resolved forward and marked forward-confirmed (FCrDNS) or not. Report section 13. 31 tests.
- [x] `HttpSecurityHeadersConnector` — **shipped 2026-07-30** (PR #15). `src/connectors/httpSecurityHeaders.ts`. Inspects twelve security-relevant response headers over HTTPS, classifying each as a security control, informational, or software disclosure — which decides whether its absence is reportable. Reports present headers with values, absent security headers with their purpose, observations read from literal header values, and disclosure headers verbatim. No scoring changes. Report section 14. 38 tests.
- [x] `DnssecConnector` — **shipped 2026-07-30** (PR #17). `src/connectors/dnssec.ts`. Builds and parses DNS messages directly (RFC 1035 wire format, RFC 4034 records, EDNS0 DO bit) because Node's `dns` module cannot request DS/DNSKEY/NSEC3PARAM. Reports DS and DNSKEY records, key tags computed per RFC 4034 Appendix B, validation status from the resolver's AD flag, and the NSEC/NSEC3 denial scheme. A definitively unsigned zone is `SUCCESS` with `dnssecEnabled: false`, not an absence; SERVFAIL is reported as explicitly inconclusive. Report section 15. 33 tests. *Note: `DNSSEC_RESOLVER` sends UDP to an operator-specified address and deliberately bypasses the SSRF guard, since operators legitimately run internal validating resolvers on private addresses.*
- [x] `ShodanConnector` — **shipped 2026-07-30** (PR #19). `src/connectors/shodan.ts`. Enriches a target with internet-exposure data from Shodan's host API: organization, ASN, ISP, hostnames, domains, open ports, detected services with product/version/banner, OS, and location. Products and versions are reported only where Shodan states them explicitly; a service with no `product` is an open port with its banner, never guessed at. Only public addresses are submitted — private/loopback/link-local/multicast/reserved space is filtered through the shared SSRF guard first. Requires `SHODAN_API_KEY`; unconfigured it returns `NO_DATA` with a "not configured" diagnostic and makes no request. Report section 16. 41 tests. *Deliberate omission: Shodan's `vulns` field is version-matched CVE inference rather than observation, so it is not reported at all; a test asserts no CVE identifier reaches the result.* *Known limitation: `api.shodan.io` is egress-blocked in the dev sandbox, so the SUCCESS path is unit-tested only.*
- [x] `Crawl4AI WebFootprintConnector` — **implemented 2026-07-30**, branch `feature/crawl4ai-web-footprint` (not yet merged). `src/connectors/crawl4aiWebFootprint.ts`. Reads a **single page** — the target's own URL, depth 0, one page — through a configured Crawl4AI **HTTP service** (`CRAWL4AI_URL`), and reports page metadata, resource and link counts, form structure, and technology indicators present verbatim in the markup. Deliberately not a crawler: discovered links are counted and never followed, external links are never fetched, subdomains are never expanded, nothing recurses. robots.txt is honoured — an explicit `Disallow` is `NO_DATA`, an absent robots.txt is unrestricted per RFC 9309, and an unretrievable one is `ERROR` rather than invented permission. The target is proven public via `assertPublicHostname` **before** being handed to the service, and the final URL is re-checked afterwards in case the service followed a redirect into private space. Report section 17. 50 tests. *No vulnerability or CVE claim is ever made.* **Contract verified** against upstream Crawl4AI source (`deploy/docker/{schemas,server,api}.py`, `crawl4ai/{async_configs,models}.py`): the request/response shapes match, every `crawler_config` key sent is on Crawl4AI's untrusted allowlist, and `deep_crawl_strategy` — the only field that enables multi-page crawling — is forbidden for untrusted request bodies, so single-page scope is guaranteed server-side as well as locally. *Known limitation: no Crawl4AI service is reachable in the dev sandbox, so SUCCESS/NO_DATA use deterministic mocked service responses; the unconfigured, invalid-URL, unreachable-service, credential-redaction and SSRF-refusal paths were verified live.*

**Intentional overlap**: Technology Fingerprinting and HTTP Security Headers both touch HSTS, CSP, Referrer-Policy and Permissions-Policy. This is by design and not a duplication defect — Technology Fingerprinting does technology/signature *detection* (presence as a signal), HTTP Security Headers does security-control *analysis* and header-value interpretation. Trimming the security-header entries from Technology Fingerprinting is a possible future cleanup task, not a requirement.

Each ships one at a time via `docs/CONNECTOR_RELEASE_CHECKLIST.md`.

With Web Footprint implemented, **the v1.1 connector list is complete** — twelve connectors are merged and the thirteenth awaits review.

## Further out

- Persistent backing store (Postgres/Firestore) for API keys, investigation history, job state.
- Centralized API key rotation / secret signing (e.g. Google Secret Manager).
- Redis-backed distributed rate limiting.
- HTTP keep-alive / connection pooling on outbound connector calls.
- A product decision on SDK scope: expand `sdks/` to cover `/auth`, `/keys`, `/jobs`, `/playground/transform`, `/metrics`, `/intelligence/analyze`, or confirm the current "core investigation only" scope is intentional.
