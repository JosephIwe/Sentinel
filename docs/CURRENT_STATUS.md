# Current Status

_Last reviewed: 2026-07-28 (full-repository audit), against commit `f995437` on `main` / `claude/project-memory-review-cqx488`, working tree clean before this session's doc updates. Supersedes the same-day earlier version of this file, which was based on document review only, not a direct code/test audit._

## Release state

- Declared version: `1.0.0-rc.1` (`package.json`, `VERSION.md`, README badge). `GET /version` actually returns hardcoded `"1.0.0"` — drift between the two (Known Issues #26).
- No `v1.0.0` tag cut yet. Private-beta access gate is live in front of the web UI.

## Verified build health (ran directly, not inferred from docs)

- `npm install`: clean, 265 packages, 1 high-severity `npm audit` finding (postcss ≤8.5.17 path traversal, transitive via Tailwind v4 — Known Issues #12).
- `npm run test`: **229/229 tests pass** across 20 files. 2 non-fatal `EnvironmentTeardownError` unhandled-rejection warnings logged from `tests/investigation-rate-limit.test.ts` on every run (Known Issues #19) — currently cosmetic, but will look like flakiness once CI exists.
- `npm run lint` (`tsc --noEmit`): clean, zero errors.
- `npm run build`: succeeds. Client 397kB JS (gzip 101.5kB) + 81.6kB CSS (gzip 12.9kB); server bundle 242.3kB.

## Security — full picture

**Resolved** (verified in code, from the prior `RELEASE_CHECKLIST.md` audit): hardcoded API keys, shared global `currentUser` session bug, SSRF exposure in GitHub discovery, WHOIS-fallback scoring bug, GitHub rate-limit/`NO_DATA` conflation.

**Newly found in this audit, not previously documented**:
- **Critical**: cross-tenant IDOR — every API-key holder shares one identity (`usr_api_client`), and `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId` have no ownership checks. Any authenticated or guest-fallback caller can view/revoke/rotate any other tenant's keys, jobs, history, or reports. **This is the single most severe issue in the codebase** and should be fixed before anything else. See `docs/KNOWN_ISSUES.md` #1.
- High: a 5th `err.message`-leak site in `utils/observability.ts`'s central `errorHandler` (the other 4, in `server.ts`, were already known).
- Medium: no `helmet`/CORS hardening; `SESSION_SECRET` silently regenerates per process restart if unset (breaks sessions across restarts/multi-instance, undocumented); IDs use `Math.random()` instead of crypto randomness (secrets themselves are fine).

Full severity-ordered list with file:line citations: `docs/KNOWN_ISSUES.md` (38 items total: 1 Critical, 7 High, 20 Medium, 10 Low).

## What's genuinely solid

- Investigation pipeline architecture matches its README description exactly — parallel connectors, real circuit breakers/retries/timeouts, two-tier caching.
- Hallucination detection and evidence-grounding are real, tested, and structurally enforced — though the proper-noun check itself has a bypassable gap (Known Issues #14).
- `EntityGraph.tsx` is well-engineered (real force-directed layout, pan/zoom, the only genuinely keyboard-accessible component).
- `src/utils/entityMatcher.ts`, `reliability.ts`, `logger.ts` are clean, dependency-free, well-tested utility modules.
- SDKs are field-accurate against the live API for core investigation flows.
- Backend test coverage is strong for session/auth, SSRF, scoring, rate limiting, hallucination detection, and connector status semantics.

## What's broken or misleading right now

- Dashboard's usage chart is 100% hardcoded fake data presented as live telemetry (Known Issues #4) — directly contradicts the project's own core anti-fabrication principle.
- Dashboard is permanently disconnected from real Playground activity (`onAddJob` dead code, Known Issues #7).
- Mobile users below 768px cannot navigate the app at all (Known Issues #6).
- A duplicated `RelationshipEdge` type has two incompatible shapes between two components — one is likely rendering broken data (Known Issues #8).
- Job cancellation doesn't actually stop work; cancelled jobs keep burning connector/AI quota (Known Issues #5).
- Scoring's "newly registered"/"established" domain checks use hardcoded absolute years that silently go stale with time (Known Issues #3).

## Zero React component tests

Confirmed: `@testing-library/react` isn't even a dependency. All 229 passing tests are backend/service-level. This was already flagged as a post-launch item in `RELEASE_CHECKLIST.md`; still true, and now scoped into Milestone 3 of `docs/ROADMAP.md`.

## Connectors (`docs/CONNECTOR_SCORECARD.md`)

WHOIS, DNS, GitHub Intelligence: Stable. SecurityTxt: Beta (shipped 2026-07-22). Three legacy fabricated-data connectors (Google, News, old GitHub) still exist as dead code in `src/connectors/`, explicitly excluded from the live pipeline but not deleted (Known Issues #25).

## Status of this documentation system

As of this session, `docs/` now contains the full set requested: `PROJECT_OVERVIEW.md`, `CURRENT_STATUS.md` (this file), `MILESTONES.md`, `ROADMAP.md`, `TECH_DECISIONS.md`, `KNOWN_ISSUES.md`, `CHANGELOG_AI.md`, `NEXT_SESSION.md`, plus the pre-existing `CONNECTOR_SCORECARD.md`/`CONNECTOR_RELEASE_CHECKLIST.md`. A 7-milestone prioritized implementation plan has been proposed in `docs/ROADMAP.md` and is **awaiting explicit user approval** before any implementation begins.
