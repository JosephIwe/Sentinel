# Sentinel Roadmap

_Canonical roadmap. The root `ROADMAP.md` mirrors this file for discoverability — update both together._

## Before v1.0.0 GA (gates the version bump off rc.1)

These are the still-open "Recommended Before Launch" items from `RELEASE_CHECKLIST.md` — every "Must Fix" blocker is already resolved (see `docs/CURRENT_STATUS.md`). None require design work; all are `S`-effort.

- Add a CI workflow (`.github/workflows/ci.yml`): `npm ci`, `npm run lint`, `npm run test` on push/PR.
- Complete the OpenAPI spec (`src/api/openapi.ts`) for `/jobs`, `POST /playground/transform`, `GET /metrics`, `POST /intelligence/analyze`.
- Stop returning raw `err.message` to clients in `server.ts`'s `/investigate`, `/playground/transform`, `/intelligence/analyze` catch blocks when `NODE_ENV === "production"`.
- Surface visible errors in `src/App.tsx` for failed login/logout/key-management actions (currently `console.error`-only).
- Point `SECURITY.md` at a verified disclosure channel (e.g. GitHub Security Advisories) instead of unverified `security@sentinelapi.dev`.
- Fix the placeholder clone URL in `CONTRIBUTING.md` (`your-org/sentinel-api`).

## v1.1 Connector Expansion

- `TechnologyFingerprintConnector`
- `CertificateTransparencyConnector`
- `ShodanConnector`
- `Crawl4AI WebFootprintConnector`

Each ships one at a time via `docs/CONNECTOR_RELEASE_CHECKLIST.md`.

## Near-term infra priorities

- Persist investigation history to the API (replace in-memory store).
- Improve deterministic summary quality.
- Add a `Dockerfile` matching the documented container/Cloud Run deployment story.
- Move rate limiting to a shared backing store (Redis) for multi-node deployments.

## Further out

- Persistent backing store for API keys, investigation history, and job state (Postgres/Firestore) — replaces all in-memory `server.ts` / `investigationWorker.ts` state.
- Centralized API key rotation / secret signing (e.g. Google Secret Manager).
- HTTP keep-alive / connection pooling on outbound connector calls.
- React component test coverage (`src/components/*.tsx` currently has none).
