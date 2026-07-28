# Current Status

_Last reviewed: 2026-07-28, from repo state at commit `7cf18b2` (branch `main` / `claude/project-memory-review-cqx488`, working tree clean)._

## Release state

- **Declared version**: `1.0.0-rc.1` (`package.json`, `VERSION.md`, `README.md` badge all agree — none have been bumped to rc.2 despite a `release/v1.0.0-rc.2` branch having been merged for the private-beta gate work).
- Private-beta access gate is live in front of the web UI (merged 2026-07-20).
- No `v1.0.0` tag has been cut yet.

## Security — RELEASE_CHECKLIST.md "Must Fix Before Launch" (verified against code, all 5 resolved)

- Hardcoded `sn_live_...` API keys removed; `generateSecret()` now uses `crypto.randomBytes` (`server.ts:163`).
- Shared global `currentUser` replaced with per-client session isolation (`tests/session.test.ts` exists and covers concurrent sessions).
- SSRF protection added: `src/utils/ssrfGuard.ts` (`safeFetch`) is wired into `src/services/investigation.ts`'s GitHub-discovery homepage fetch, with its own test suite (`tests/ssrf-guard.test.ts`).
- WHOIS scoring bug fixed: `conf_whois` / `conf_missing_critical` in `src/services/scoring.ts` now explicitly exclude `ev_whois_fallback` (mirrors the existing `ev_dns_no_records` exclusion).
- GitHub connector now distinguishes rate-limit/network errors (`status: "ERROR"`) from genuine absence (`status: "NO_DATA"`) — `src/connectors/github-intel.ts:194`.

**All launch-blocking items from the release audit are closed.** The remaining gap between rc.1 and a real v1.0.0 tag is the "Recommended Before Launch" list below, which is still open.

## Open — RELEASE_CHECKLIST.md "Recommended Before Launch"

- [ ] OpenAPI spec (`src/api/openapi.ts`) still only documents `/auth/*`, `/keys*`, `/investigate`, `/investigations*`, `/history`, `/reports/{id}`. Missing: `/jobs`, `POST /playground/transform`, `GET /metrics`, `POST /intelligence/analyze` — all live, authenticated routes not visible in the `/docs` Swagger UI.
- [ ] `server.ts` still returns raw `err.message` to clients unconditionally in 4 places (lines ~563, ~865, ~885, ~902) instead of gating detail behind `NODE_ENV !== "production"` the way `utils/observability.ts`'s central error handler does.
- [ ] No CI workflow exists (`.github/workflows/` is absent) — nothing blocks a PR that breaks `npm run test` or `npm run lint`.
- [ ] Frontend (`src/App.tsx`) still only `console.error`s on failed login/logout/key-management fetches (`handleLoginSuccess`, `handleAddKey`, `handleRevokeKey`, `handleRotateKey`) — no visible UI error state.
- [ ] `SECURITY.md` still points to unverified `security@sentinelapi.dev`.
- [ ] `CONTRIBUTING.md` still has the placeholder `git clone https://github.com/your-org/sentinel-api.git` (README's clone URL was already fixed).

Already resolved from that same list: DNS `sentinel-gateway.net` fallback substitution is gone (`src/connectors/dns.ts` has no such reference); seeded demo user email is a placeholder domain (`guest@sentinelapi.dev`, `api@sentinelapi.dev`), not a real personal address.

## Post-launch / acknowledged limitations (not blocking, tracked in `VERSION.md` + checklist)

- No `Dockerfile` yet, despite `DEPLOYMENT.md` describing containerized/Cloud Run deployment.
- API keys, investigation history, and job state are in-memory only — lost on restart (Postgres/Firestore migration is a stated v1.0 goal, not started).
- Rate limiter (`utils/rate-limiter.ts`) is process-local; no Redis-backed shared store yet for multi-node deployments.
- No React component tests (`src/components/*.tsx` has zero automated coverage; backend/service coverage is otherwise strong — see `tests/`).
- No HTTP keep-alive/connection pooling on outbound connector calls (WHOIS/DNS/GitHub/security.txt).

## Connectors (`docs/CONNECTOR_SCORECARD.md`)

| Connector | Status | Notes |
|---|---|---|
| WHOIS | Stable | |
| DNS | Stable | |
| GitHub Intelligence | Stable | |
| SecurityTxt | Beta | Shipped 2026-07-22, RFC 9116 parsing |

Google Search, legacy GitHub, and News connectors were **removed** (2026-07-16) for returning fabricated data presented as verified evidence. Only connectors that query a real external source ship now — see `docs/TECH_DECISIONS.md`.

## Next connector in the pipeline

Per root `ROADMAP.md` / `docs/ROADMAP.md`: `TechnologyFingerprintConnector` is next, followed by `CertificateTransparencyConnector`, `ShodanConnector`, and a `Crawl4AI WebFootprintConnector`. Each follows the one-at-a-time process in `docs/CONNECTOR_RELEASE_CHECKLIST.md`.
