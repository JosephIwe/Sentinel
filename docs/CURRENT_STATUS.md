# Current Status

_Last reviewed: 2026-07-28, after Milestone 1 implementation, against the working tree on `claude/project-memory-review-cqx488`. Supersedes the earlier same-day version of this file (pre-Milestone-1)._

## Release state

- Declared version: `1.0.0-rc.1` (`package.json`, `VERSION.md`, README badge). `GET /version` still returns hardcoded `"1.0.0"` — drift between the two (Known Issues #16). Not yet fixed, scoped to Milestone 2.
- No `v1.0.0` tag cut yet. Private-beta access gate is live in front of the web UI.

## Verified build health (ran directly, not inferred from docs)

- `npm run test`: **240/240 tests pass** across 21 files (unchanged test count from Milestone 0 — Milestone 1 was a frontend-only pass, verified manually rather than with new automated tests; see "What's still broken or missing" below).
- `npm run lint` (`tsc --noEmit`): clean, zero errors.
- `npm run build`: succeeds. Client ~399kB JS (gzip ~102kB) + ~81kB CSS (gzip ~13kB); server bundle ~247kB.
- Manually verified in a real browser (headless Chromium via Playwright against the dev server): mobile hamburger nav, login → dashboard → key creation with error-banner infrastructure in place, an end-to-end investigation run, the Relationships tab rendering real `source`/`target` entity IDs (not `undefined`), and a full history-restore round trip (investigate → appears in server-side History → restore renders the report again). Screenshots reviewed directly.
- `npm audit` still reports 1 high-severity postcss advisory (Known Issues #4) — not yet fixed, scoped to Milestone 2.

## Security — full picture

**Resolved, Milestone 0 (2026-07-28)**: Critical cross-tenant IDOR (every API key now has its own `ownerId`, `/keys`/`/jobs`/`/history`/`/reports/:id`/`/investigations/:jobId`/`/metrics` all scoped to caller); the 5th `err.message` leak site.

**Resolved, prior `RELEASE_CHECKLIST.md` audit** (verified in code before this session): hardcoded API keys, shared global `currentUser` session bug, SSRF exposure in GitHub discovery, WHOIS-fallback scoring bug, GitHub rate-limit/`NO_DATA` conflation.

**Still open**: no `helmet`/CORS hardening; `SESSION_SECRET` silently regenerates per process restart if unset; IDs use `Math.random()` instead of crypto randomness (secrets themselves are fine). See `docs/KNOWN_ISSUES.md` Medium/Low sections.

Full severity-ordered list with file:line citations: `docs/KNOWN_ISSUES.md` — **0 Critical, 0 High, 18 Medium, 10 Low remain open** after Milestones 0 and 1 (was 1 Critical / 7 High / 20 Medium / 10 Low at the start of the audit).

## What's genuinely solid

- Investigation pipeline architecture matches its README description exactly — parallel connectors, real circuit breakers/retries/timeouts, two-tier caching, and now genuine cancellation via a threaded `AbortSignal`.
- Hallucination detection and evidence-grounding are real, tested, and structurally enforced — though the proper-noun check itself still has a bypassable gap (Known Issues #5).
- `EntityGraph.tsx` is well-engineered (real force-directed layout, pan/zoom, the only genuinely keyboard-accessible component) — and its correct `source`/`target` usage turned out to be the tell that confirmed `PlaygroundView.tsx`'s `from`/`to` was the broken one during Milestone 1.
- `src/utils/entityMatcher.ts`, `reliability.ts`, `logger.ts` are clean, dependency-free, well-tested utility modules.
- SDKs are field-accurate against the live API for core investigation flows.
- Backend test coverage is strong for session/auth, SSRF, scoring, rate limiting, hallucination detection, connector status semantics, and (as of Milestone 0) per-tenant ownership.
- The Dashboard no longer shows fabricated data as if it were real telemetry (Milestone 0), and the frontend no longer maintains a second, unscoped copy of investigation history (Milestone 1).
- Mobile users can now navigate the full app; relationship/entity data renders correctly instead of showing `undefined`; login/key-management failures are now visible instead of silent.

## What's still broken or missing (scoped to Milestone 2+)

- No CI workflow, no Dockerfile, incomplete OpenAPI spec, npm audit finding unresolved (Known Issues #1-4) — Milestone 2.
- Hallucination detector's proper-noun check is bypassable; entity resolution can false-merge on the `Generic` type wildcard; `scoringRules.json` isn't actually config-driven (Known Issues #5-7) — Milestone 6.
- Accessibility gaps (unlabeled inputs, missing ARIA tab roles, tiny low-contrast text) — Milestone 5.
- Zero automated React component tests; a handful of backend route/service coverage gaps remain — Milestone 3.
- `InvestigationReport.tsx` is still a 2055-line single component with no memoization — Milestone 4.

## Connectors (`docs/CONNECTOR_SCORECARD.md`)

WHOIS, DNS, GitHub Intelligence: Stable. SecurityTxt: Beta (shipped 2026-07-22). Three legacy fabricated-data connectors (Google, News, old GitHub) still exist as dead code in `src/connectors/`, explicitly excluded from the live pipeline but not deleted (Known Issues #15).

## Status of this documentation system

`docs/` contains the full set: `PROJECT_OVERVIEW.md`, `CURRENT_STATUS.md` (this file), `MILESTONES.md`, `ROADMAP.md`, `TECH_DECISIONS.md`, `KNOWN_ISSUES.md`, `CHANGELOG_AI.md`, `NEXT_SESSION.md`, plus the pre-existing `CONNECTOR_SCORECARD.md`/`CONNECTOR_RELEASE_CHECKLIST.md`. The 7-milestone roadmap was approved by the user on 2026-07-28; Milestones 0 and 1 are complete; Milestone 2 has not started.
