# Current Status

_Last reviewed: 2026-07-28, after the post-Milestone-2 release-readiness correction, against the working tree on `claude/project-memory-review-cqx488`. `docs/KNOWN_ISSUES.md` and `docs/MILESTONES.md` have now been reconciled against this file — all three agree._

## Release state

- Declared version: `1.0.0-rc.1` — now genuinely consistent everywhere: `package.json`, `VERSION.md`, `README.md` badge, `server.ts`'s `GET /version` (was hardcoded `"1.0.0"`, fixed), `src/api/openapi.ts`'s `info.version` (same fix), `DEPLOYMENT.md`'s example response, and both SDKs' version comments.
- No `v1.0.0` tag cut yet. Private-beta access gate is live in front of the web UI.
- CI now exists (`.github/workflows/ci.yml`) and gates lint/test/build on every push/PR — previously nothing did.

## Verified build health (ran directly, not inferred from docs)

- `npm run test`: **269/269 tests pass** across 23 files (240 → 256 with the Technology Fingerprint connector, → 269 after expanding it to cover security headers, asset-URL inspection, cloud platforms, and false-positive prevention).
- `npm run lint` (`tsc --noEmit`): clean, zero errors.
- `npm run build`: succeeds. Client ~399kB JS (gzip ~102kB) + ~81kB CSS (gzip ~13kB); server bundle ~257kB.
- `npm audit`: **0 vulnerabilities** (was 1 high-severity postcss advisory, fixed via `npm audit fix` — a patch-level bump, 8.5.17 → 8.5.24, `package-lock.json`-only diff).
- OpenAPI spec now documents all 15 live routes (was 11) — verified live against the built server (`/api/v1/openapi.json` and Swagger UI at `/docs` both checked).
- Docker: a production `Dockerfile` + `.dockerignore` now exist, matching `DEPLOYMENT.md`'s documented layout. `docker build` itself could not be completed in this sandbox — its egress policy explicitly denies Docker Hub's CDN backend (403, policy-level, reproduced twice, not transient) — so the exact commands the image runs were verified standalone instead: `npm ci --omit=dev` installs cleanly, and `node dist/server.cjs` boots and correctly serves `/health`, `/version`, and the frontend with only production dependencies present. High confidence the image builds correctly in a normal CI environment; not independently confirmed in-session.
- **Fixed in the follow-up release-readiness correction**: `server.ts` previously hardcoded `PORT = 3000` and never read `process.env.PORT`, despite `DEPLOYMENT.md` and the Dockerfile documenting it as configurable. Now honors `process.env.PORT` with a validated fallback to `3000`; verified at runtime for custom, unset, and invalid values.

## Security — full picture

**Resolved, Milestone 0 (2026-07-28)**: Critical cross-tenant IDOR (every API key now has its own `ownerId`, `/keys`/`/jobs`/`/history`/`/reports/:id`/`/investigations/:jobId`/`/metrics` all scoped to caller); the 5th `err.message` leak site.

**Resolved, Milestone 2 (2026-07-28)**: the 1 high-severity dependency advisory (postcss); an unverified contact email in `SECURITY.md` replaced with GitHub Security Advisories (a real, functional channel tied to this repo).

**Resolved, prior `RELEASE_CHECKLIST.md` audit** (verified in code before this session): hardcoded API keys, shared global `currentUser` session bug, SSRF exposure in GitHub discovery, WHOIS-fallback scoring bug, GitHub rate-limit/`NO_DATA` conflation.

**Still open**: no `helmet`/CORS hardening; `SESSION_SECRET` silently regenerates per process restart if unset; IDs use `Math.random()` instead of crypto randomness (secrets themselves are fine); the three dead legacy fabricated-data connectors are still present in `src/connectors/` (explicitly out of scope this session — "do not modify connectors").

## What's genuinely solid

- Investigation pipeline architecture matches its README description exactly — parallel connectors, real circuit breakers/retries/timeouts, two-tier caching, genuine cancellation via a threaded `AbortSignal`.
- Hallucination detection and evidence-grounding are real, tested, and structurally enforced.
- Backend test coverage is strong for session/auth, SSRF, scoring, rate limiting, hallucination detection, connector status semantics, and per-tenant ownership.
- The full API surface is now documented (OpenAPI), CI-gated, containerizable, and internally consistent on version numbers — the project is in a genuinely better state to accept outside contributions or cut a real tag than it was this morning.
- Project documentation (`SECURITY.md`, `CONTRIBUTING.md`, `DEPLOYMENT.md`, `package.json` metadata, `CHANGELOG.md`) no longer contains placeholder URLs, an unverifiable contact, an undocumented env var, or (previously) a `CHANGELOG.md` entry that was corrupted/truncated mid-sentence since a much earlier commit.

## What's still open (scoped to Milestone 3+)

- Zero automated React component tests; a few backend route/service coverage gaps remain — Milestone 3.
- `InvestigationReport.tsx` is still a 2055-line single component with no memoization; duplicated cache/color-logic boilerplate across connectors and components — Milestone 4.
- Accessibility gaps (unlabeled inputs, missing ARIA tab roles, tiny low-contrast text) — Milestone 5.
- Hallucination detector's proper-noun check is bypassable; entity resolution can false-merge on the `Generic` type wildcard; `scoringRules.json` isn't actually config-driven — Milestone 6.
- The dead legacy connectors and the `"engines"` field/`vite.config.ts` cleanup, deferred from Milestone 2 under that session's explicit constraints — worth folding into whichever future session is allowed to touch connectors, or a small standalone hygiene pass.

## Connectors (`docs/CONNECTOR_SCORECARD.md`)

WHOIS, DNS, GitHub Intelligence: Stable. SecurityTxt: Beta (shipped 2026-07-22). Technology Fingerprint: Beta (shipped 2026-07-28, expanded same day with security-header, asset-URL and cloud-platform detection plus a dedicated report section). Three legacy fabricated-data connectors (Google, News, old GitHub) still exist as dead code in `src/connectors/`, explicitly excluded from the live pipeline, not deleted (recent sessions were explicitly scoped away from touching connectors).

## Status of this documentation system

`docs/` contains the full set: `PROJECT_OVERVIEW.md`, `CURRENT_STATUS.md` (this file), `MILESTONES.md`, `ROADMAP.md`, `TECH_DECISIONS.md`, `KNOWN_ISSUES.md`, `CHANGELOG_AI.md`, `NEXT_SESSION.md`, plus the pre-existing `CONNECTOR_SCORECARD.md`/`CONNECTOR_RELEASE_CHECKLIST.md`. The 7-milestone roadmap was approved by the user on 2026-07-28; **Milestones 0, 1, and 2 are complete**, and release engineering is finished. All memory docs were reconciled in the post-Milestone-2 correction, so `KNOWN_ISSUES.md`, `MILESTONES.md`, `PROJECT_OVERVIEW.md`, and this file now agree on current state. Note that `KNOWN_ISSUES.md` item numbers renumber on each reconciliation — reference issues by description, not number.
