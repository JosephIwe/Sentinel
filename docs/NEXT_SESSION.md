# Next Session

_Written 2026-07-28, end of the Milestone 1 implementation session. Read this first, then `docs/CURRENT_STATUS.md` and `docs/KNOWN_ISSUES.md` for detail._

## Where things stand

Milestones 0 and 1 are both **complete**. `docs/KNOWN_ISSUES.md` now has 0 Critical and 0 High issues open — everything remaining is Medium or Low severity. Highlights:
- Milestone 0: fixed a critical cross-tenant IDOR (every API key now has its own owner), a 5th error-leak site, a scoring date-drift bug, a fabricated Dashboard chart, and non-functional job cancellation.
- Milestone 1: fixed a real rendering bug (`RelationshipEdge`/`Entity` shape mismatches causing `undefined` values and a fake confidence badge), added mobile navigation (previously totally unreachable below 768px), fixed silent frontend error handling, eliminated a duplicated/unscoped history data model, and a print-output typo.
- Both milestones verified: `npm run test` (240/240), `npm run lint` (clean), `npm run build` (succeeds). Milestone 1 additionally verified with a manual Playwright smoke-test pass against the running dev server (screenshots reviewed) since it had no new automated coverage of its own.

## Highest-priority task: Milestone 2 — Release Hygiene

Per `docs/ROADMAP.md`, next up is CI/Docker/OpenAPI/release-hygiene work — chosen to run after Milestones 0-1 so CI, once added, is gated on both the security and frontend fixes, not just the security ones:

1. **Add `.github/workflows/ci.yml`** (`npm ci && npm run lint && npm run test` on push/PR). Highest leverage item — nothing currently blocks a regressing PR.
2. **Add a `Dockerfile`** matching (and actually validating) `DEPLOYMENT.md`'s existing inline example.
3. **Complete `src/api/openapi.ts`** for `/jobs`, `/playground/transform`, `/metrics`, `/intelligence/analyze`.
4. **Run `npm audit fix`** for the postcss advisory (verify the Tailwind v4 build still works after).
5. **Fix `SECURITY.md`'s contact email and `CONTRIBUTING.md`'s placeholder clone URL.**
6. **Add `"engines": {"node": ">=18"}`** to `package.json`; fix the `/version` vs `package.json` version drift (`server.ts` hardcodes `"1.0.0"`).
7. **Clean up `vite.config.ts`'s leftover AI-Studio-era comments**, the unused `@/*` tsconfig alias, and the stale `npm run clean` target.
8. **Delete the dead legacy connectors** (`src/connectors/google.ts`, `news.ts`, `github.ts`) — requires retiring/repointing `tests/legacy-connectors.test.ts` first.

Full task/dependency/risk breakdown is in `docs/ROADMAP.md`'s Milestone 2 section.

## A note on scope decisions made in Milestone 1 (don't relitigate without reason)

- `onAddJob` was **removed, not wired up**. Playground's UI runs investigations via `/api/investigations`; the `ExtractionJob`/ `/playground/transform` flow it was originally meant to feed is a separate, API/SDK-only feature. If a future session wants Dashboard to show real Playground activity, that's a new feature (surface investigation stats on the Dashboard), not "finishing" `onAddJob`.
- The history-model fix went further than the roadmap's minimum bar ("share one type") — it eliminated `localStorage`-based history entirely in favor of the real per-tenant server history. `HistoryView.tsx`'s old "Clear History" button was removed as part of this (no server-side delete endpoint exists); adding one is an open, unscoped future feature (`docs/KNOWN_ISSUES.md`'s last Low item).

## Keeping this file useful

Per the user's standing instructions: update all of `docs/` at the end of every work session — `CURRENT_STATUS.md`, `ROADMAP.md` (mark milestone progress), `MILESTONES.md`, `KNOWN_ISSUES.md` (move fixed items, add new ones found), `CHANGELOG_AI.md` (new entry), and this file with exactly what should happen next. Also: files changed / features completed / outstanding work / recommended next task should be summarized back to the user directly in the session, not just written to disk.
