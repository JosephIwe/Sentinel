# Next Session

_Written 2026-07-28, end of the post-Milestone-2 release-readiness correction. Read this first, then `docs/CURRENT_STATUS.md` for detail._

## Where things stand

**Release engineering is complete.** Milestones 0, 1, and 2 are all done, plus a follow-up correction. The project now has: no cross-tenant IDOR, working mobile nav and correct relationship rendering, CI, a Dockerfile, a fully-documented OpenAPI spec, zero `npm audit` findings, `PORT` honored from the environment, and internally-consistent version numbers and documentation.

All memory docs (`KNOWN_ISSUES.md`, `MILESTONES.md`, `PROJECT_OVERVIEW.md`, `CURRENT_STATUS.md`, this file) were reconciled in this correction and now agree on current state — the Milestone 2 housekeeping debt is cleared. Note that `KNOWN_ISSUES.md` item numbers renumber on each reconciliation; reference issues by description, not number.

## Highest-priority task: the first v1.1 connector — `TechnologyFingerprintConnector`

The project is ready to begin implementing new connectors. Per `docs/ROADMAP.md`'s v1.1 connector expansion, the next connector is `TechnologyFingerprintConnector`, followed by `CertificateTransparencyConnector`, `ShodanConnector`, and `Crawl4AI WebFootprintConnector`.

**Follow `docs/CONNECTOR_RELEASE_CHECKLIST.md` exactly** — one connector at a time: implement → verify `SUCCESS`/`NO_DATA`/`ERROR` semantics → diagnostics → evidence validation → unit + integration tests → `npm test` + `npm run build` → real-domain smoke test → update README/CHANGELOG/`docs/CONNECTOR_SCORECARD.md` → PR → squash merge → alpha tag.

**Non-negotiable when writing it** (see `docs/TECH_DECISIONS.md`): the connector must query a real external source and must never synthesize evidence. `NO_DATA` and `ERROR` are correct outcomes; fabricated data is not. This rule exists because three connectors were deleted in July for violating it. Any code path that fetches a user-supplied host must go through `src/utils/ssrfGuard.ts`'s `safeFetch`.

## Alternative: Milestone 3 — Test Coverage & Quality Hardening

If the priority is hardening over new capability, `docs/ROADMAP.md`'s Milestone 3 is the other reasonable next step:
1. Route-layer tests for `/intelligence/analyze` (services are unit-tested, this route isn't).
2. A dedicated test file for `entityResolution.ts` (none exists).
3. A dedicated test file for the `whois.ts` connector (none exists, despite being load-bearing for scoring).
4. Investigate/fix the `tests/investigation-rate-limit.test.ts` teardown race (intermittent, not reliably reproduced).
5. First React component tests (`@testing-library/react` isn't a dependency yet).

## Known gaps carried forward

- **Dead legacy connectors** (`src/connectors/google.ts`, `news.ts`, `github.ts`) are still in the tree. Flagged across four sessions now, never removed, because sessions kept being explicitly scoped away from touching connectors. The upcoming connector work is the natural time to finally delete them (retire/repoint `tests/legacy-connectors.test.ts` first).
- **Docker build not fully verified.** `docker build` couldn't run in these sandboxes — Docker Hub's CDN is denied by the environment's egress policy (403, confirmed repeatedly, not transient). The `Dockerfile` was verified as far as possible short of that: the image's exact install (`npm ci --omit=dev`) and start (`node dist/server.cjs`) commands were run standalone and both work. Running `docker build . && docker run -p 3000:3000 <image>` once in an environment with normal registry access would close this for good.

## Keeping this file useful

Per the user's standing instructions: update project documentation at the end of every work session with what actually got done and what's next. Recent sessions have sometimes narrowed which docs to touch — when the scope isn't stated, update the full `docs/` set, since a narrowed update is what created the reconciliation debt this session had to clear.
