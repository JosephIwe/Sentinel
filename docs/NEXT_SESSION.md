# Next Session

_Written 2026-07-28, end of the Milestone 0 implementation session. Read this first, then `docs/CURRENT_STATUS.md` and `docs/KNOWN_ISSUES.md` for detail._

## Where things stand

Milestone 0 (security & trust emergency fixes) is **complete**:
- The critical cross-tenant IDOR is fixed — every API key now has its own `ownerId`, and `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId`, `/metrics` are all scoped to the caller.
- The 5th error-message leak site, the scoring engine's date-drift bug, the Dashboard's fabricated usage chart, and non-functional job cancellation are all fixed.
- `npm run test` (240/240), `npm run lint` (clean), `npm run build` (succeeds) all verified.
- Full detail in `docs/CHANGELOG_AI.md`'s Milestone 0 entry; issue tracking current in `docs/KNOWN_ISSUES.md`.

## Highest-priority task: Milestone 1 — Frontend Correctness & Functional Gaps

Per `docs/ROADMAP.md`, the next milestone fixes real, user-visible functional bugs:

1. **Wire `onAddJob`** so the Dashboard reflects real Playground activity, or deliberately remove the dead prop/handler pair if the two views should stay separate — right now it's silently disconnected, which is worse than either real choice (`PlaygroundView.tsx`, `App.tsx:158-168`).
2. **Fix the `RelationshipEdge` shape mismatch** — `PlaygroundView.tsx:20-21` uses `from`/`to`, `InvestigationReport.tsx:19-22` uses `source`/`target`, both locally redefined instead of imported from `src/types.ts`. Check the real API response shape (server.ts's relationship objects use `source`/`target` — see the seeded `investigationHistory` records in `server.ts` for confirmation) before picking which one to fix.
3. **Add a mobile navigation fallback** — `Layout.tsx`'s nav is `hidden md:flex` with nothing underneath it; below 768px there's no way to reach Playground/History/Docs/Dashboard except by whatever page state happens to already be loaded.
4. **Surface visible errors** for `App.tsx`'s login/key-management handlers and the localStorage `JSON.parse` failure sites in `HistoryView.tsx`/`PlaygroundView.tsx` (currently `console.error`-only).
5. **Fix the "BREIFING" typo** in `InvestigationReport.tsx:384`'s print output.
6. **Decide on and implement one path** for the two disconnected history data models (server `extractionJobs` vs. localStorage history) — at minimum share one type between them; a full unification is optional and should be scoped down if it starts growing (see `docs/ROADMAP.md`'s risk note on this item).

Full task list, dependencies, and risk notes are in `docs/ROADMAP.md`'s Milestone 1 section — use it directly.

## After Milestone 1

Milestone 2 (CI, Docker, OpenAPI completeness, npm audit fix, doc/contact cleanup) — do this after Milestone 1 so CI, once added, is gated on the frontend fixes too, not just the security ones.

## A note on the removed `(job.status as string)` cast

If you're touching `investigationWorker.ts` again: the cast that used to guard the `"cancelled"` checks was **not dead code** despite how the original audit characterized it — TypeScript's control-flow narrowing genuinely can't see `cancelJob()` mutating `job.status` asynchronously through the shared `jobs` map. It's now handled correctly via an `isCancelled(job)` helper (re-reads through a fresh parameter binding). Don't remove that helper and go back to a direct `job.status === "cancelled"` comparison inside `processJob` — it'll fail `tsc --noEmit` again for the same reason.

## Keeping this file useful

Per the user's standing instructions: update all of `docs/` at the end of every work session — `CURRENT_STATUS.md`, `ROADMAP.md` (mark milestone progress), `MILESTONES.md`, `KNOWN_ISSUES.md` (move fixed items, add new ones found), `CHANGELOG_AI.md` (new entry), and this file with exactly what should happen next. Also: files changed / features completed / outstanding work / recommended next task should be summarized back to the user directly in the session, not just written to disk.
