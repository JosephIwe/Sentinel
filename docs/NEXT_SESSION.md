# Next Session

_Written 2026-07-30, after implementing the Crawl4AI Web Footprint connector on branch `feature/crawl4ai-web-footprint` (unmerged; `main` at `71af270`). Read this first, then `docs/CURRENT_STATUS.md` for detail._

## Where things stand

Release engineering is complete (Milestones 0–2 plus a follow-up correction), and **v1.1 connector expansion is well advanced**. Twelve connectors are registered in the live pipeline; seven shipped on 2026-07-29/30 as PRs #11–#15, #17 and #19 (Certificate Transparency, ASN / IP Intelligence, RDAP Intelligence, Reverse DNS, HTTP Security Headers, DNSSEC, Shodan Intelligence). See `docs/ROADMAP.md` for what each one does and its known limitations.

Suite is at **547 tests across 31 files, all passing** (on the Web Footprint branch; 497/30 on `main`); `tsc --noEmit` clean; `npm run build` succeeds.

## Highest-priority task: review and merge `feature/crawl4ai-web-footprint`

The Web Footprint connector is written, tested (50 tests) and verified as far as this environment allows. It is **the last v1.1 connector** — merging it completes v1.1 connector expansion, after which attention returns to Milestone 3 (test coverage and quality hardening).

It is unmerged deliberately, pending review of two things a reviewer should look at directly:

1. **The assumed Crawl4AI response contract.** No Crawl4AI service is reachable in this environment, so the request/response shape is written to Crawl4AI's documented REST API and read defensively — every field optional, unrecognisable payloads treated as ERROR. The first run against a real service is the real test. If the shape differs, `Crawl4AiResult` and the `crawler_config` body in `crawl4aiWebFootprint.ts` are the only places to change.
2. **The service-endpoint trust decision.** `CRAWL4AI_URL` is reached with a plain `fetch`, not `safeFetch`, because a Crawl4AI sidecar normally lives on a private address that `safeFetch` would reject. The *target* is what goes through the guard — `assertPublicHostname` before handing it over, and again on the final URL the service reports, so a redirect into private space is discarded. This is the correct boundary, but it is a deliberate exception worth a reviewer's eyes.

Section 17 in the report; Recommendations moved to 18.

## After Web Footprint: v1.1 is complete

With it merged, all connectors on the v1.1 list are done. The natural next tracks, in order of launch value:

1. **Milestone 3 — test coverage and quality hardening.** Listed below.
2. **Delete the three dead legacy connectors** (`google.ts`, `news.ts`, `github.ts`), flagged across seven sessions now. Connector work being the active track makes this the moment.
3. **Cut the `v1.0.0` tag** once Milestone 3 lands.

## Connector-authoring reference

**Follow `docs/CONNECTOR_RELEASE_CHECKLIST.md` exactly.** `src/connectors/httpSecurityHeaders.ts` is the freshest reference implementation (single outbound HTTPS call through `safeFetch`, same status semantics, same caching/timeout pattern, diagnostics attached per-evidence).

**Non-negotiables, learned the hard way on this project:**
- Query a **real external source**; never synthesize evidence. `NO_DATA` and `ERROR` are correct outcomes.
- Record on every finding *what exactly was observed* and *where it came from*, so an analyst can independently re-verify it. Never report a value you cannot point at in the raw response.
- Any fetch of a user-supplied host must go through `src/utils/ssrfGuard.ts`'s `safeFetch`.
- A failure to reach the source is `ERROR` — never a false "nothing found".
- Set the connector's internal timeout *below* the orchestrator's 5000ms default so its own descriptive error surfaces rather than a generic outer TIMEOUT.
- Emit a specific entity `type`, never `Generic` (which is eligible for the entity resolver's cross-type wildcard match).
- Attach diagnostics to **each evidence's `rawData`**, not the connector result's — the pipeline aggregates evidence but drops connector-level `rawData`.

**Two testing gotchas that will bite you**: `InvestigationService` keeps *static* full-investigation and per-connector caches that outlive service instances, so integration tests need a **distinct hostname per test**. Connectors keep their own static result caches too — clear them in `beforeEach` rather than juggling unique inputs.

**Report section numbering**: every new connector branch cut from the same `main` will collide with any sibling branch on its section number. Merge one, then renumber the other — see the 2026-07-30 entry in `docs/CHANGELOG_AI.md` for the procedure that works.

## Known intentional overlap — do not "fix" without a task

Technology Fingerprinting and HTTP Security Headers both touch HSTS, CSP, Referrer-Policy and Permissions-Policy. This is **by design**: Technology Fingerprinting does technology/signature detection (presence as a signal), HTTP Security Headers does security-control analysis and header-value interpretation. Do not remove headers from Technology Fingerprinting unless a separate cleanup task is created for it.

## Alternative parallel track: Milestone 3 — Test Coverage & Quality Hardening

If hardening is the priority over new capability:
1. Route-layer tests for `/intelligence/analyze` (the service is unit-tested, the route isn't).
2. A dedicated test file for `entityResolution.ts` (none exists).
3. A dedicated test file for the `whois.ts` connector (none exists, despite being load-bearing for scoring).
4. The `tests/investigation-rate-limit.test.ts` teardown race (intermittent, not reliably reproduced).
5. First React component tests (`@testing-library/react` still isn't a dependency).

## Known gaps carried forward

- **Dead legacy connectors** (`src/connectors/google.ts`, `news.ts`, `github.ts`) are still in the tree — flagged across five sessions now. Since connector work is now the active track, this is the natural moment to finally delete them (retire/repoint `tests/legacy-connectors.test.ts` first).
- **Docker build not fully verified.** `docker build` can't run in these sandboxes (Docker Hub's CDN is denied by the egress policy, confirmed repeatedly). The image's exact install and start commands were verified standalone. One `docker build . && docker run -p 3000:3000 <image>` in an unrestricted environment would close this.
- **Technology fingerprint signature coverage is intentionally conservative.** The signature set covers common, unambiguous cases only. Expanding it is safe *provided* each new signature stays specific enough that a match isn't plausibly coincidental — resist the temptation to add fuzzy heuristics, which is precisely how fabricated data creeps back in.

## Keeping this file useful

Update project documentation at the end of every work session with what actually got done and what's next. When the session's doc scope isn't stated explicitly, update the full `docs/` set — a narrowed update is what created the reconciliation debt an earlier session had to clear.
