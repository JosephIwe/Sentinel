# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- New `SecurityTxtConnector` (Beta): checks a target's `/.well-known/security.txt`
  and legacy `/security.txt` locations, parses the RFC 9116 fields (Contact,
  Expires, Encryption, Preferred-Languages, Canonical, Policy, Hiring), and
  surfaces the published security contact, disclosure policy, and expiry
  status as evidence. Reports are shown in a new "Security Posture" report
  section. See `docs/CONNECTOR_SCORECARD.md`.
- CI workflow (`.github/workflows/ci.yml`) running `npm ci`, lint, tests, and
  build on every push/PR.
- Production `Dockerfile` and `.dockerignore` for containerized deployment.
- OpenAPI spec now documents every live route: `/jobs`, `/playground/transform`,
  `/metrics`, and `/intelligence/analyze` were previously missing.

### Security
- Fixed a cross-tenant IDOR: every API key previously resolved to one shared
  identity, so any key could view, revoke, or rotate any other tenant's keys,
  jobs, investigation history, and reports. Each key now has its own owner,
  and `/keys`, `/jobs`, `/history`, `/reports/:id`, `/investigations/:jobId`,
  and `/metrics` are all scoped to the authenticated caller.
- API key secrets are now generated with a cryptographically secure random
  source (`crypto.randomBytes`) instead of `Math.random()`.
- Authentication is now required on the key management, job status, metrics,
  playground transform, and intelligence analysis endpoints, which were
  previously reachable without any credentials.
- API secrets are now masked everywhere except immediately after creation or
  rotation, where the full secret is shown exactly once. Listing or revoking
  a key never returns a usable secret value again.
- Server error responses no longer leak internal exception messages
  (`err.message`) to clients outside development.
- Fixed a dependency advisory (postcss path traversal, GHSA-r28c-9q8g-f849)
  via `npm audit fix`.

### Fixed
- Removed three connectors (Google Search, legacy GitHub, News) that returned
  entirely fabricated data — invented repositories, press coverage, and
  search results — presented as verified, high-confidence evidence.
  Investigations now only surface data from connectors that query a real
  external source (WHOIS, DNS, GitHub REST API).
- Added a `verified` flag carried through connector results and evidence, so
  unverified data is structurally rejected before it can reach a report,
  rather than relying on keyword-based filtering alone.
- Fixed relationship and entity data rendering as `undefined`/fabricated in
  the Playground's Interactive Explorer, caused by a local type definition
  using the wrong field names for the real API response shape.
- Added mobile navigation — the app was previously unreachable below 768px.
- Fixed silent failures in login and API key management: non-OK responses
  previously showed no feedback at all; failures are now shown in the UI.
- Fixed `GET /version` and the OpenAPI spec's declared version both reading
  `1.0.0` instead of the actual `1.0.0-rc.1`.
