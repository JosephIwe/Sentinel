# Sentinel v1.0.0 — Release Checklist

Generated from a full-repository release readiness audit (architecture, API, investigation pipeline, security, docs, and deployment). Tasks are grouped by urgency; each item names the affected file(s), why it matters, an effort estimate, and acceptance criteria so it can be picked up and verified independently.

**Effort scale:** `S` = under a day · `M` = 1–3 days · `L` = more than 3 days / requires design work.

---

## Must Fix Before Launch

These are release blockers or high-priority correctness/security bugs. Sentinel should not go to a public v1.0.0 with any of these open.

- [ ] **Remove hardcoded, source-committed API keys from the default deployment**
  - **Files:** `server.ts` (`apiKeys` array, ~lines 93–124; `authenticateRequest`, ~lines 172–217)
  - **Why it matters:** Three fully-functional API keys — including one active key with a 1200 req/min quota — are checked directly into source. Every default deployment of the open-sourced code is authenticated by the same public, unrotatable secrets.
  - **Effort:** S
  - **Acceptance criteria:**
    - No literal `sn_live_...` secret strings remain in `server.ts` or anywhere in version control.
    - Seed keys (if any are needed for local dev) are either generated at process start via `crypto.randomBytes` (matching the existing `generateSecret()` pattern) or only exist when `NODE_ENV !== "production"`.
    - A fresh `npm run dev` / `npm run start` boot with no manual setup does not expose a working API key that's identical across installs.
    - `tests/server.test.ts` still passes (update its hardcoded `ACTIVE_KEY_SECRET`/`REVOKED_KEY_SECRET` fixtures to match the new seeding strategy).

- [ ] **Replace the shared global `currentUser` with real per-client session isolation**
  - **Files:** `server.ts` (`currentUser`, ~lines 84–91; `authenticateRequest` session fallback, ~lines 208–212; `/auth/login`, `/auth/logout`, ~lines 268–298); `src/App.tsx`, `src/components/PlaygroundView.tsx` (fetch calls with no auth headers)
  - **Why it matters:** `currentUser` is one module-level variable shared by every concurrent browser client. One user's login/logout changes identity for all other visitors on the same server instance, and `/auth/login` accepts any email with no verification — this is not a session system.
  - **Effort:** L
  - **Acceptance criteria:**
    - Two separate browser sessions (e.g. two incognito windows) hitting the same running server can be logged in as two different identities simultaneously.
    - Logging out in one session does not affect the other.
    - `GET /api/v1/auth/me` returns state scoped to the requesting client (via cookie/session token/JWT — implementation is open), not a single process-wide variable.
    - A new test in `tests/server.test.ts` (or a new `tests/session.test.ts`) simulates two concurrent "users" and asserts they don't observe each other's identity.

- [ ] **Add SSRF protection to the GitHub-discovery homepage fetch**
  - **Files:** `src/services/investigation.ts` (GitHub discovery block, ~lines 181–208)
  - **Why it matters:** `fetch(https://${domainToScan})` / `fetch(http://${domainToScan})` targets a raw, user-supplied domain with no restriction on private/loopback/link-local/cloud-metadata IP ranges. A "domain" investigation can be used to make the server issue requests into internal networks or cloud metadata endpoints.
  - **Effort:** S
  - **Acceptance criteria:**
    - Before fetching, the resolved IP address(es) of `domainToScan` are checked against a denylist covering RFC1918 ranges, loopback, link-local (including `169.254.169.254`), and `::1`/ULA IPv6; matches are rejected without making the request.
    - The same check is re-applied after following any redirect (or redirects are disabled entirely via `redirect: "manual"` and rejected).
    - A new test (e.g. in `tests/investigation.test.ts` or a dedicated `tests/ssrf.test.ts`) asserts that a query term resolving to a private/loopback IP does not result in an outbound fetch (mock `fetch`/DNS and assert it was never called, or assert the connector returns a rejected/`NO_DATA` result for such targets).

- [ ] **Fix confidence scoring treating a failed WHOIS lookup as a success signal**
  - **Files:** `src/services/scoring.ts` (`conf_whois` and `conf_missing_critical` rules, ~lines 170–181, 235–245); `src/connectors/whois.ts` (fallback evidence, `id: "ev_whois_fallback"`, ~line 354)
  - **Why it matters:** The `ev_whois_fallback` evidence ID (emitted when the live WHOIS socket query fails) starts with `ev_whois`, so `evaluateConfidenceRule` matches it as if WHOIS succeeded — awarding +20 confidence and suppressing the "missing critical infrastructure" penalty during an actual WHOIS outage. The DNS connector already excludes its equivalent `ev_dns_no_records` sentinel from the same class of match; WHOIS never got the same exclusion.
  - **Effort:** S
  - **Acceptance criteria:**
    - `conf_whois` and `conf_missing_critical` in `scoring.ts` explicitly exclude `ev_whois_fallback` (mirroring the existing `e.id !== "ev_dns_no_records"` pattern).
    - A new test in `tests/scoring.test.ts` asserts that a result containing only an `ev_whois_fallback` evidence entry does **not** match `conf_whois` and **does** match `conf_missing_critical`.

- [ ] **Stop conflating GitHub API rate-limit/network errors with "no GitHub footprint"**
  - **Files:** `src/connectors/github-intel.ts` (`fetchGithub`, ~lines 36–63; final status assignment, ~line 525)
  - **Why it matters:** `fetchGithub` returns `data: null` for HTTP 403/429, other non-2xx statuses, and network exceptions alike. The connector then reports `status: "NO_DATA"` whenever `data` is null, so a rate-limited call (a realistic scenario given the 60 req/hour unauthenticated GitHub limit noted in `VALIDATION_REPORT.md`) is indistinguishable from a genuine "this target has no GitHub presence."
  - **Effort:** S
  - **Acceptance criteria:**
    - `fetchGithub`'s return type carries enough information (e.g. the HTTP status or an explicit `errorKind: "rate_limited" | "not_found" | "network_error"`) for the caller to distinguish failure classes.
    - 403/429 responses and thrown network errors result in `status: "ERROR"` (with a clear "GitHub API rate-limited or unreachable" evidence card), not `"NO_DATA"`.
    - `status: "NO_DATA"` is reserved for genuine 404-style "no such org/user/repo" outcomes.
    - A new test in `tests/legacy-connectors.test.ts` or a new `tests/github-intel.test.ts` mocks a 403 response and asserts the connector returns `status: "ERROR"`, not `"NO_DATA"`.

---

## Recommended Before Launch

Not launch-blocking on their own, but each represents a real correctness, trust, or process gap worth closing before (or immediately after) going public.

- [ ] **Stop DNS connector from silently substituting the platform's own domain for non-domain-shaped queries**
  - **Files:** `src/connectors/dns.ts` (fallback default, ~lines 122–124)
  - **Why it matters:** When domain extraction fails (true for most `company`/`username` queries, e.g. "Acme Corp"), the connector queries the hardcoded `sentinel-gateway.net` and returns real DNS records for it, transparently labeled but unrelated to the user's actual query — making most Company-type reports include an off-topic DNS section.
  - **Effort:** S
  - **Acceptance criteria:**
    - When no plausible domain can be extracted from the query term, the connector returns `status: "NO_DATA"` instead of substituting `sentinel-gateway.net`.
    - A test in `tests/legacy-connectors.test.ts` or `tests/investigation.test.ts` asserts that a query term like `"Acme Corp"` produces `NO_DATA` from `DnsConnector`, not an entity named `sentinel-gateway.net`.

- [ ] **Complete the OpenAPI spec for all live endpoints**
  - **Files:** `src/api/openapi.ts`
  - **Why it matters:** `GET /jobs`, `POST /playground/transform`, `GET /metrics`, and `POST /intelligence/analyze` are live, authenticated routes in `server.ts` but are missing from the `paths` object, so they don't appear in the Swagger UI at `/docs`.
  - **Effort:** S
  - **Acceptance criteria:**
    - `openApiSpec.paths` includes entries for all four missing routes with request/response schemas consistent with their actual handlers in `server.ts`.
    - Every route registered on `apiV1Router` in `server.ts` has a corresponding entry in `openApiSpec.paths` (spot-check via a short script or manual diff).

- [ ] **Stop returning raw internal exception messages to API clients**
  - **Files:** `server.ts` (`/investigate`, `/playground/transform`, `/intelligence/analyze` catch blocks)
  - **Why it matters:** These handlers return `details: err.message` unconditionally. `utils/observability.ts`'s central `errorHandler` already hides stack traces outside development — these ad hoc catch blocks don't follow the same rule, leaving an open channel for future dependency errors to leak internal detail.
  - **Effort:** S
  - **Acceptance criteria:**
    - `err.message` is logged server-side (via `logger`) but the client-facing `details` field is either omitted or generic when `NODE_ENV === "production"`.
    - Existing behavior in non-production environments is unchanged (full detail still returned for local debugging).
    - `tests/server.test.ts` covers at least one of these error paths and asserts the response shape.

- [ ] **Add a CI workflow that runs lint and tests on every PR**
  - **Files:** new `.github/workflows/ci.yml`
  - **Why it matters:** No CI exists today; nothing prevents a PR that breaks `npm run test` or `npm run lint` (`tsc --noEmit`) from being merged, which matters more once the project accepts outside OSS contributions.
  - **Effort:** S
  - **Acceptance criteria:**
    - A workflow runs on `push` and `pull_request` that executes `npm ci`, `npm run lint`, and `npm run test`.
    - The workflow fails (non-zero exit) if either step fails, visible as a required/at-least-informational check on PRs.

- [ ] **Surface errors to the user on silently-failing frontend actions**
  - **Files:** `src/App.tsx` (`handleLoginSuccess`, `handleAddKey`, `handleRevokeKey`, `handleRotateKey`)
  - **Why it matters:** These handlers `console.error` on a failed `fetch` and otherwise leave the UI unchanged — a user whose login or key action fails sees no feedback at all.
  - **Effort:** S
  - **Acceptance criteria:**
    - Each of the four handlers sets a visible error state (toast, inline message, etc.) when the corresponding `fetch` does not return `res.ok`.
    - Manually verified in the browser: triggering a failure (e.g. temporarily returning a 500 from the relevant endpoint) shows a visible error rather than a silent no-op.

- [ ] **Fix stale/unverifiable contact and repo references in project docs**
  - **Files:** `SECURITY.md` (vulnerability-reporting email), `CONTRIBUTING.md` (line 15, `git clone` URL)
  - **Why it matters:** `SECURITY.md` points to `security@sentinelapi.dev`, a domain with no other footprint in the repo and no way to confirm it's monitored. `CONTRIBUTING.md` still has the placeholder `your-org/sentinel-api` clone URL (already fixed in `README.md` this session).
  - **Effort:** S
  - **Acceptance criteria:**
    - `SECURITY.md` directs reports to a verified channel (e.g. GitHub Security Advisories for this repo, or a mailbox the maintainer actually controls).
    - `CONTRIBUTING.md`'s clone instructions match the real repository URL used in `README.md`.

- [ ] **Replace the seeded demo user's real-looking personal email**
  - **Files:** `server.ts` (`currentUser` seed, ~lines 84–91)
  - **Why it matters:** The default logged-in fixture user uses a real-looking personal Gmail address, shown by default via `/auth/me` to any visitor of a fresh deployment — reads as unpolished/unfinished for a public v1.0.0.
  - **Effort:** S
  - **Acceptance criteria:**
    - Seed user email is an obviously-fake placeholder (e.g. `demo@sentinel.local`).
    - No real-looking personal email addresses remain in seed/fixture data in `server.ts`.

---

## Post-Launch Improvements

Already-acknowledged roadmap items (see `VERSION.md`) or genuine nice-to-haves that don't block v1.0.0.

- [ ] **Add a `Dockerfile` matching the documented container deployment story**
  - **Files:** new `Dockerfile`, `.dockerignore`
  - **Why it matters:** `DEPLOYMENT.md` and the project's architecture materials imply containerized/Cloud Run deployment, but no `Dockerfile` exists; `npm run build && npm run start` works standalone today, so this is a documentation/convenience gap, not a functional blocker.
  - **Effort:** S
  - **Acceptance criteria:**
    - A multi-stage `Dockerfile` builds the client and server (`npm run build`) and runs `node dist/server.cjs` in the final stage.
    - `docker build . && docker run -p 3000:3000 <image>` serves the app and responds on `GET /health`.

- [ ] **Introduce a persistent backing store (replace in-memory API keys/history/jobs)**
  - **Files:** `server.ts` (in-memory `apiKeys`, `investigationHistory`, `extractionJobs`), `src/services/investigationWorker.ts` (in-memory `jobs` map)
  - **Why it matters:** Already disclosed in `VERSION.md` as a known limitation — a server restart currently discards all API keys, scan history, and job state. Deferring this is reasonable for v1.0.0 given it's explicitly called out.
  - **Effort:** L
  - **Acceptance criteria:**
    - API keys, investigation history, and job records survive a server restart.
    - Existing `tests/server.test.ts` and `tests/investigation-worker.test.ts` pass against the new storage layer (via an in-memory/test adapter).

- [ ] **Move rate limiting to a shared backing store (Redis) for multi-node deployments**
  - **Files:** `utils/rate-limiter.ts`
  - **Why it matters:** Already disclosed in `VERSION.md` — the sliding-window limiter is process-local, so horizontally-scaled deployments don't share rate-limit state across nodes, allowing effective quotas to multiply by node count.
  - **Effort:** M
  - **Acceptance criteria:**
    - `DistributedRateLimiter.check` supports a pluggable backing store, with Redis as one implementation, without changing its public signature/return shape.
    - Existing tests in `tests/rate-limiter.test.ts` continue to pass against the in-memory implementation; new tests cover the Redis-backed path (can be mocked).

- [ ] **Add test coverage for React components**
  - **Files:** `src/components/*.tsx` (notably `InvestigationReport.tsx`, `PlaygroundView.tsx`, `DashboardView.tsx`)
  - **Why it matters:** Correctly deprioritized during this session's backend/service test-coverage work; the frontend has zero automated test coverage today but is not release-blocking given the UI is otherwise functional and manually verified via screenshots.
  - **Effort:** M
  - **Acceptance criteria:**
    - `@testing-library/react` (or equivalent) and a jsdom test environment are added to the Vitest config.
    - At minimum, `InvestigationReport.tsx` and the Playground submit flow have smoke tests covering the golden path and one error path.

- [ ] **Add connection pooling / keep-alive reuse for outbound connector HTTP calls**
  - **Files:** `src/connectors/github-intel.ts`, `src/connectors/dns.ts`, `src/connectors/whois.ts`
  - **Why it matters:** Listed as a v1.0 goal in `VERSION.md`; reduces HTTPS handshake latency on repeated scans but is a performance polish item, not a correctness issue.
  - **Effort:** S
  - **Acceptance criteria:**
    - Outbound `fetch`/socket calls reuse connections where the runtime supports it (e.g. a shared `undici` `Agent` with keep-alive).
    - No regression in existing connector tests; a basic before/after latency comparison for repeated calls to the same host is documented in the PR description.
