# AI Session Changelog

Log of AI-agent-driven work sessions on this project: what was done, why, and what it touched. Distinct from `CHANGELOG.md` (user-facing release notes) — this is internal memory of the AI's own work, so a future session (or a human reviewing AI contributions) can see what happened and why without re-deriving it from git log.

Entries prior to 2026-07-28 are reconstructed from git history for continuity, since no `docs/` memory existed before this session.

---

## 2026-07-28 — Full project audit & memory system established

**Prompted by**: user request to act as lead engineer/product designer/reviewer, fully understand the project, and establish a persistent documentation system before any further implementation.

**Did**:
- Read the entire repository: `server.ts`, all of `src/services/`, `src/connectors/` (including dead legacy ones), `src/components/`, `src/utils/`, `utils/`, all `tests/*.ts`, build/deploy config, SDKs, all existing markdown docs.
- Ran `npm install`, `npm run test` (229/229 pass, 2 non-fatal teardown warnings in `tests/investigation-rate-limit.test.ts`), `npm run lint` (clean), `npm run build` (succeeds), `npm audit` (1 high-severity postcss advisory).
- Found and documented a **critical, previously-unreported cross-tenant IDOR**: all API-key traffic resolves to one shared identity (`usr_api_client`), and `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId` have no ownership checks — any caller can view/revoke/rotate any other tenant's data. Not on the prior `RELEASE_CHECKLIST.md`.
- Found 7 additional High-severity issues, 20 Medium, and 10 Low — full list in `docs/KNOWN_ISSUES.md`.
- Created `docs/PROJECT_OVERVIEW.md` and `docs/KNOWN_ISSUES.md` (new).
- Rewrote `docs/CURRENT_STATUS.md`, `docs/MILESTONES.md`, `docs/ROADMAP.md`, `docs/TECH_DECISIONS.md`, `docs/NEXT_SESSION.md` (all existed from a same-day earlier session that reconstructed them from `RELEASE_CHECKLIST.md`/`CHANGELOG.md`/git log; this pass supersedes that with direct-code-verified findings).
- Proposed a 7-milestone prioritized implementation plan (see `docs/ROADMAP.md`) starting with the IDOR/security fixes. **Did not implement anything** — waiting on explicit approval per the user's instructions before Phase 5.

**Files touched**: `docs/PROJECT_OVERVIEW.md` (new), `docs/KNOWN_ISSUES.md` (new), `docs/CHANGELOG_AI.md` (new, this file), `docs/CURRENT_STATUS.md`, `docs/MILESTONES.md`, `docs/ROADMAP.md`, `docs/TECH_DECISIONS.md`, `docs/NEXT_SESSION.md` — no application code changed.

**Next**: awaiting roadmap approval; first milestone on approval is the IDOR fix + other Critical/High security-adjacent bugs (Milestone 0 in `docs/ROADMAP.md`).

---

## 2026-07-28 (earlier same day) — Project memory reconstruction (v1)

**Prompted by**: user request to read `docs/NEXT_SESSION.md` etc. at session start; none of those files existed yet.

**Did**: Reconstructed `docs/CURRENT_STATUS.md`, `docs/MILESTONES.md`, `docs/ROADMAP.md`, `docs/TECH_DECISIONS.md`, `docs/NEXT_SESSION.md` from `RELEASE_CHECKLIST.md`, `VERSION.md`, `CHANGELOG.md`, connector docs, and git log, cross-checked against a first pass over the code (confirmed all 5 prior launch-blocker fixes were actually in place). Identified the "Recommended Before Launch" checklist items as the highest-priority task at the time. Committed and pushed to `claude/project-memory-review-cqx488`.

**Superseded by**: the full audit above, which went deeper (ran the test suite, found the IDOR issue, produced `docs/KNOWN_ISSUES.md` as the new canonical bug list).

---

## Reconstructed history (pre-docs), from git log

- **2026-07-11**: Initial scaffold, core investigation pipeline, WHOIS caching, GitHub Intelligence connector, DNS enhancements, print-friendly report UI.
- **2026-07-12 to 07-14**: Async investigation pipeline (`InvestigationWorker`), grounded-response/hallucination verification introduced, API key generation/masking upgraded, entity graph visualization added.
- **2026-07-16**: **Removed 3 fabricated-data connectors** (Google Search, legacy GitHub, News) — the project's defining trust fix. GitHub discovery diagnostics added; project policies/metadata formalized.
- **2026-07-17**: Full backend/service test coverage sprint (scoring, rate limiter, frontend validation, HTTP API, legacy connectors, hallucination detection, intelligence/worker). README rewritten; screenshots added.
- **2026-07-19 to 07-20**: `RELEASE_CHECKLIST.md` produced from a release-readiness audit; all 6 verified v1.0.0 blockers fixed (hardcoded keys, session bug, SSRF, WHOIS scoring, GitHub rate-limit conflation, +1 more); private-beta gate added; 4 more bugs fixed during beta-readiness validation.
- **2026-07-22**: `SecurityTxtConnector` shipped (Beta, RFC 9116); roadmap and connector-release checklist formalized.
