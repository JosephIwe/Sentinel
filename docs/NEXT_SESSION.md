# Next Session

_Written 2026-07-28, end of the full-project-audit session. Read this first, then `docs/CURRENT_STATUS.md` and `docs/KNOWN_ISSUES.md` for detail._

## Where things stand

A complete repository audit (code, tests, build, deploy config — not just docs) has been done and is fully written up:
- `docs/PROJECT_OVERVIEW.md` — what the project is, architecture, stack, structure.
- `docs/CURRENT_STATUS.md` — verified build/test health and the current security picture.
- `docs/KNOWN_ISSUES.md` — 38 findings, severity-ordered, file:line cited. **This is the canonical bug list going forward.**
- `docs/ROADMAP.md` — a 7-milestone prioritized implementation plan.
- `docs/TECH_DECISIONS.md` — updated with an open architectural gap (API-key identity model) that the top-priority fix depends on.
- `docs/MILESTONES.md`, `docs/CHANGELOG_AI.md` — history, including this session.

**No application code was changed this session** — Phase 1–4 only (discovery, assessment, documentation, planning), per explicit instruction to wait for approval before implementation.

## Blocking item for next session

**The 7-milestone roadmap in `docs/ROADMAP.md` has not been approved by the user yet.** Do not start Milestone 0 (or anything else) until that approval is explicit. If this session opens and approval was given in the interim (check the conversation), start Milestone 0 immediately — it fixes a critical, previously-undocumented cross-tenant IDOR (`docs/KNOWN_ISSUES.md` #1) that lets any API caller see/mutate any other tenant's keys, jobs, history, and reports. This is a genuinely severe finding and shouldn't sit any longer than necessary once approved.

## If approved: how to start Milestone 0

1. Read `docs/TECH_DECISIONS.md`'s "Open architectural gap" section first — the IDOR fix requires a real per-tenant identity design decision, not a quick `.filter()` patch. Decide between the two options laid out there (per-key owner id vs. session-linked keys) before touching route handlers.
2. Fix ownership checks on `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId` per the design chosen in step 1.
3. Fix the `errorHandler` leak in `utils/observability.ts` alongside the 4 already-known leak sites in `server.ts` — do both together since they're the same class of fix.
4. Fix `scoring.ts`'s hardcoded absolute-year thresholds.
5. Decide and implement: wire the Dashboard chart to real data, or remove it.
6. Implement real job cancellation (abort in-flight work, not just a status flag).

Full task/dependency/risk breakdown for this milestone (and all 7) is in `docs/ROADMAP.md`.

## After Milestone 0

Follow the roadmap in order — Milestone 1 (frontend correctness), Milestone 2 (CI/Docker/OpenAPI/release hygiene), Milestone 3 (test coverage, written against Milestone 0/1's final shape), Milestone 4 (code quality debt), Milestone 5 (accessibility), Milestone 6 (detection/scoring quality). Connector expansion (`TechnologyFingerprintConnector` etc.) is deliberately deferred until after Milestone 3 — see `docs/ROADMAP.md`'s reasoning.

## Keeping this file useful

Per the user's standing instructions: update all of `docs/` at the end of every work session — `CURRENT_STATUS.md`, `ROADMAP.md` (mark milestone progress), `MILESTONES.md`, `CHANGELOG_AI.md` (new entry), and this file with exactly what should happen next. When a milestone is fully complete, say so explicitly in `docs/ROADMAP.md` rather than leaving its task list looking open.
