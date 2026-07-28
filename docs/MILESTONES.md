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
- Proposed a 7-milestone prioritized plan (`docs/ROADMAP.md`) starting with the IDOR fix. **No implementation performed yet — awaiting user approval.**

## Open (as of 2026-07-28)

- rc.1 is still the declared version; a real `v1.0.0` tag has not been cut.
- Milestone 0 (Critical/High security & correctness fixes, led by the IDOR issue) is the top-priority next task once the roadmap is approved.
