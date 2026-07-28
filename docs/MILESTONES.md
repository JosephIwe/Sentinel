# Milestones

Reconstructed from git history (`git log --reverse`). Dates are commit timestamps.

## Foundation (2026-07-11)

- Initial project scaffold; `InvestigationQuery` / `Evidence` domain types introduced.
- First multi-source cyber investigation pipeline implemented.
- Investigation history/persistence (in-memory), print-friendly report UI, entity/evidence model refactor with WHOIS caching.
- GitHub Intelligence connector and DNS enhancements added.

## Async pipeline & grounding (2026-07-12 – 2026-07-14)

- Asynchronous investigation pipeline (`InvestigationWorker`, job polling) implemented.
- Grounded-response mode and hallucination verification introduced (the precursor to today's `ValidationService`).
- API key generation/masking upgraded.
- Entity graph visualization added to the frontend.

## Trust cleanup (2026-07-16)

- **Removed three connectors (Google Search, legacy GitHub, News) that returned fabricated data** (invented repos, press coverage, search results) presented as verified evidence — the project's defining correctness fix. Only connectors backed by a real external source (WHOIS, DNS, GitHub REST) remained.
- GitHub discovery diagnostics added to reports; investigation status handling/validation optimized.
- Project metadata, policies, and environment documentation formalized (`CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `.env.example`, etc.).

## Test coverage sprint (2026-07-17)

- Full backend/service unit test coverage added in one sprint: scoring, rate limiter, frontend input validation, server.ts HTTP API (via Supertest), legacy connectors, `HallucinationDetector`/`ValidationService`, `IntelligenceService`/`InvestigationWorker`.
- README rewritten as a standard project front page; product screenshots added.
- PRs #1 and #2 merged.

## v1.0.0 release audit (2026-07-19 – 2026-07-20)

- `RELEASE_CHECKLIST.md` produced from a full-repository release-readiness audit (architecture, API, pipeline, security, docs, deployment).
- **Final pre-launch bug-fix sprint**: all 6 verified v1.0.0 blockers fixed (hardcoded API keys, shared `currentUser` session bug, SSRF exposure in GitHub discovery, WHOIS scoring bug, GitHub rate-limit/NO_DATA conflation, plus one more from the audit) — PR #3 / `release/v1.0.0-rc.2` merged as PR #4.
- Private-beta access gate added for the web UI.
- 4 additional bugs fixed during final beta-readiness validation (`/ready` credential validation without outbound calls; GitHub self-discovery misattribution of github.com's own trending repos).

## v1.1 connector expansion begins (2026-07-22)

- `SecurityTxtConnector` shipped (Beta): RFC 9116 `/.well-known/security.txt` parsing, new "Security Posture" report section.
- Roadmap updated; `docs/CONNECTOR_RELEASE_CHECKLIST.md` added to formalize the one-connector-at-a-time process for everything that follows.

## Open (as of 2026-07-28)

- rc.1 is still the declared version; a real `v1.0.0` tag has not been cut. The "Recommended Before Launch" items from `RELEASE_CHECKLIST.md` (CI workflow, OpenAPI completeness, error-detail leakage, frontend error surfacing, doc contact cleanup) are the remaining gate — see `docs/CURRENT_STATUS.md`.
- Next connector: `TechnologyFingerprintConnector`.
