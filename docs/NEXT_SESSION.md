# Next Session

_Written 2026-07-30, after merging the Shodan Intelligence connector (PR #19) into `main` at `0045c55`. Read this first, then `docs/CURRENT_STATUS.md` for detail._

## Where things stand

Release engineering is complete (Milestones 0–2 plus a follow-up correction), and **v1.1 connector expansion is well advanced**. Twelve connectors are registered in the live pipeline; seven shipped on 2026-07-29/30 as PRs #11–#15, #17 and #19 (Certificate Transparency, ASN / IP Intelligence, RDAP Intelligence, Reverse DNS, HTTP Security Headers, DNSSEC, Shodan Intelligence). See `docs/ROADMAP.md` for what each one does and its known limitations.

Suite is at **497 tests across 30 files, all passing**; `tsc --noEmit` clean; `npm run build` succeeds.

## Highest-priority task: `Crawl4AI WebFootprintConnector`

Shodan merged 2026-07-30 (PR #19). It is **the last remaining item on the v1.1 connector list** — after it, v1.1 connector expansion is complete and attention returns to Milestone 3 (test coverage and quality hardening).

Decisions to settle before writing code, because they shape the whole connector:

- **What it actually collects.** "Web footprint" is broad. Scope it to what can be observed and pointed at in a fetched page — discovered links, referenced third-party origins, forms and their action targets, social/contact handles present in markup, and so on. Anything requiring judgement about *significance* is out.
- **Crawl depth.** A crawler is the first connector that can issue many requests per target. Decide the page cap and depth up front, enforce it hard, and record both in diagnostics. Single-page (homepage only) is a defensible v1.
- **Whether Crawl4AI is a dependency or an HTTP service.** If it is a service, it needs configuration and the same not-configured handling as Shodan. If it is a library, check its transitive dependency weight before adding it.
- **robots.txt.** Decide and document the policy explicitly rather than leaving it implicit.

Every fetch must go through `src/utils/ssrfGuard.ts`'s `safeFetch`, which already re-validates each redirect hop.

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
