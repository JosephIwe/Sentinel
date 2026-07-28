# Next Session

_Written 2026-07-28. Read this first, then `docs/CURRENT_STATUS.md` for detail._

## Where things stand

- All 5 `RELEASE_CHECKLIST.md` **"Must Fix Before Launch"** items are done (verified in code, not just checked off): no hardcoded API keys, per-client session isolation, SSRF guard on the GitHub-discovery fetch, WHOIS scoring-fallback bug fixed, GitHub rate-limit vs. `NO_DATA` distinguished.
- Declared version is still `1.0.0-rc.1` everywhere (`package.json`, `VERSION.md`, README badge) — no `v1.0.0` tag exists yet.
- `SecurityTxtConnector` (Beta) shipped 2026-07-22 as the first v1.1 connector; roadmap and connector-release process docs were updated same day.

## Highest-priority task

**Close the remaining `RELEASE_CHECKLIST.md` "Recommended Before Launch" items to unblock the v1.0.0 GA tag.** These are the only things standing between rc.1 and GA, they're all `S`-effort (each under a day), and two of them (CI, error-detail leakage) are also flagged independently in the root `ROADMAP.md`. Suggested order:

1. **Add `.github/workflows/ci.yml`** (`npm ci && npm run lint && npm run test` on push/PR) — highest leverage, currently nothing blocks a regressing PR from merging, and every other fix in this list should land through a PR CI would now cover.
2. **Stop leaking `err.message` to clients** in `server.ts`'s `/investigate`, `/playground/transform`, `/intelligence/analyze` catch blocks (~lines 563, 865, 885, 902) when `NODE_ENV === "production"` — mirror `utils/observability.ts`'s existing `errorHandler` behavior. Quick, security-adjacent.
3. **Complete `src/api/openapi.ts`** — add `/jobs`, `POST /playground/transform`, `GET /metrics`, `POST /intelligence/analyze` so `/docs` reflects all live authenticated routes.
4. **Surface visible errors in `src/App.tsx`** for `handleLoginSuccess`, `handleAddKey`, `handleRevokeKey`, `handleRotateKey` (currently silent `console.error`-only).
5. **Doc/contact cleanup**: fix `SECURITY.md`'s unverified `security@sentinelapi.dev`, and `CONTRIBUTING.md`'s placeholder `your-org/sentinel-api` clone URL.

Each item's acceptance criteria (including which test file to extend) is spelled out in `RELEASE_CHECKLIST.md` under "Recommended Before Launch" — use it directly rather than re-deriving criteria.

## After that

Resume connector expansion per `docs/ROADMAP.md`: next connector is `TechnologyFingerprintConnector`, followed by `CertificateTransparencyConnector`, `ShodanConnector`, and a `Crawl4AI WebFootprintConnector`. Follow `docs/CONNECTOR_RELEASE_CHECKLIST.md` — one connector at a time, real-source data only (see `docs/TECH_DECISIONS.md` for why that rule exists).

Do **not** start on the "Post-Launch Improvements" section of `RELEASE_CHECKLIST.md` (Dockerfile, persistent backing store, Redis rate limiting, React component tests, connection pooling) before the GA-blocking list above — they're explicitly deferred and lower leverage right now.

## Keeping this file useful

Update this file (and `docs/CURRENT_STATUS.md`) at the end of each session with what actually got done and what's next — don't let it drift back out of sync with the code the way it apparently did before this review (these five `docs/` files didn't exist prior to 2026-07-28; this session reconstructed them from `RELEASE_CHECKLIST.md`, `VERSION.md`, `CHANGELOG.md`, and git history).
