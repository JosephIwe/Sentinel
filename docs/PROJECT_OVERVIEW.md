# Project Overview

_Living reference document. Update when architecture, stack, or structure actually changes — not every session._

## What Sentinel is

Sentinel is an API-first threat-intelligence/OSINT orchestration platform. Given a domain, email, company, username, or IP, it fans the query out across parallel connectors that each query a **real external source** (WHOIS, DNS, GitHub, security.txt/RFC 9116), merges and deduplicates the resulting entities into a canonical graph, synthesizes a report via Google Gemini (with a fully deterministic fallback if no AI key is configured), and assigns confidence/risk scores from an explicit, auditable rule set rather than model inference. Every AI-generated claim is passed through a hallucination detector before reaching the client.

## Core invariant

**Never present fabricated data as verified evidence.** This isn't aspirational — it's the reason three connectors (Google Search, legacy GitHub, News) were deleted from the live pipeline in July 2026 after being found to return invented results dressed up as high-confidence findings. A `verified` flag is carried structurally through connector results and evidence so this can't regress silently. (Ironically, the frontend currently violates this same principle in one place — see `docs/KNOWN_ISSUES.md` #4, the Dashboard's fake usage chart.)

## Goals

- A trustworthy investigation API: every report claim traces to real, cited evidence.
- Deterministic, explainable scoring — not an opaque AI-assigned risk number.
- Resilience by construction: one flaky upstream (WHOIS port 43 blocked, GitHub rate limits) degrades only its own evidence, never the whole investigation.
- Controlled extensibility: new connectors ship one at a time via `docs/CONNECTOR_RELEASE_CHECKLIST.md` specifically to prevent a repeat of the fabricated-data incident.

## Architecture

```
                       ┌──────────────────────────┐
   client / SDK  ───▶  │   Express API (server.ts)│
                       │  auth · rate limit · docs│
                       └────────────┬─────────────┘
                                    │
                       ┌────────────▼─────────────┐
                       │   InvestigationService    │  parallel connectors,
                       │  (src/services/           │  circuit breaker + retry
                       │   investigation.ts)        │  + timeout per connector
                       └────────────┬─────────────┘
                    ┌───────────────┼───────────────┬───────────────┐
              ┌─────▼─────┐  ┌──────▼──────┐  ┌──────▼──────┐ ┌─────▼──────┐
              │  WHOIS    │  │     DNS     │  │   GitHub    │ │ SecurityTxt│
              │ Connector │  │  Connector  │  │  Intel      │ │ (Beta)     │
              └───────────┘  └─────────────┘  └─────────────┘ └────────────┘
                                    │
                       ┌────────────▼─────────────┐
                       │   EntityResolutionService │  dedupe & canonicalize
                       └────────────┬─────────────┘
                                    │
                       ┌────────────▼─────────────┐
                       │    IntelligenceService    │  Gemini synthesis, or
                       │                            │  deterministic fallback
                       └────────────┬─────────────┘
                                    │
                       ┌────────────▼─────────────┐
                       │   ValidationService       │  HallucinationDetector,
                       │                            │  evidence-grounding audit
                       └────────────┬─────────────┘
                                    │
                       ┌────────────▼─────────────┐
                       │      ScoringService       │  deterministic confidence
                       │                            │  & risk rule engine
                       └────────────┬─────────────┘
                                    │
                            Structured Report
```

`InvestigationWorker` (`src/services/investigationWorker.ts`) runs the same pipeline asynchronously for queued jobs, with progress polling and (currently incomplete — see Known Issues) cancellation.

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Language | TypeScript, ES2022 target | `tsc --noEmit` clean |
| Backend | Express 4, Node.js, single process | bundled to CJS via esbuild |
| Frontend | React 19, Vite 6, Tailwind CSS 4 | served from the same process/port |
| AI | Google Gemini (`@google/genai`) | model hardcoded, not env-configurable (Known Issues #32) |
| Testing | Vitest 4, Supertest | 229 tests, backend-heavy, zero frontend component tests |
| Auth | HMAC-signed session cookies + API-key headers | no password/OTP — explicit demo-mode design |
| Persistence | None — in-memory only | disclosed limitation, not yet started |

Origin note: `vite.config.ts` still carries leftover comments referencing "AI Studio" and a `DISABLE_HMR` flag — the project was scaffolded from a Google AI Studio template and this residue was never fully cleaned up (Known Issues #34).

## Folder structure

```
Sentinel/
├── server.ts                      # Express gateway: routing, auth, rate limiting, docs
├── src/
│   ├── api/                       # OpenAPI spec (incomplete) & Swagger UI renderer
│   ├── components/                # React views: App shell, Dashboard, Playground,
│   │                               #   History, Docs, Auth, Landing, EntityGraph,
│   │                               #   InvestigationReport (2055 lines, needs splitting)
│   ├── config/scoringRules.json   # Rule metadata (id/points/explanation) — NOT the
│   │                               #   actual match logic, which is hardcoded in scoring.ts
│   ├── connectors/                 # whois.ts, dns.ts, github-intel.ts, securitytxt.ts (live)
│   │                               #   + google.ts, news.ts, github.ts (dead legacy code,
│   │                               #   explicitly excluded from the live pipeline)
│   ├── services/                   # investigation, investigationWorker, intelligence,
│   │                               #   validation, scoring, entityResolution
│   ├── types.ts                    # Shared domain types (some components redefine
│   │                               #   these locally instead of importing — Known Issues #8)
│   └── utils/                      # Frontend-facing validation, entityMatcher, reliability,
│                                    #   logger (all clean, well-tested)
├── utils/                          # Server-side: session.ts, rate-limiter.ts,
│                                    #   observability.ts, betaGate.ts, ssrfGuard duplicate*
├── sdks/                           # TypeScript & Python clients — cover core investigation
│                                    #   flows only, not auth/keys/jobs/playground/metrics
└── tests/                          # 20 Vitest files, backend/service-heavy
```

\* `src/utils/validation.ts` duplicates `utils/validation.ts`'s logic with a different signature and is unused dead code (Known Issues #24).

## Existing features

- Parallel multi-source investigation (WHOIS, DNS, GitHub, security.txt) with per-connector timeout/retry/circuit breaker.
- Deterministic confidence & risk scoring from `src/config/scoringRules.json` + `scoring.ts`.
- AI meta-analysis (Gemini) with hallucination detection and evidence grounding; deterministic fallback when no AI key is present.
- Entity resolution/dedup across connector results.
- Synchronous (`/investigate`) and asynchronous (`/investigations` + polling) investigation modes.
- API key management (create/list/revoke/rotate), each with its own rate limit.
- Sliding-window rate limiting by API key or IP.
- Structured JSON logging, request-ID correlation, `/health` `/ready` `/version` `/metrics`.
- Swagger UI at `/docs`, generated from a hand-maintained OpenAPI 3.1 spec (incomplete — 4 live routes undocumented).
- Web UI: Landing, Auth, Dashboard, Playground (interactive investigation runner), History, Docs, print/PDF report export.
- Entity relationship graph visualization with real force-directed layout, pan/zoom, keyboard navigation.
- Official TypeScript and Python SDKs.

## Unfinished / partially wired work

- Dashboard's extraction-log/metrics tab never reflects real Playground activity (`onAddJob` prop wired but never called).
- Dashboard's "Ingress Distribution (24h)" chart is hardcoded fake data, not connected to real metrics.
- Two separate, unreconciled "investigation history" data models (server-side `extractionJobs` vs. localStorage-backed history) with different shapes.
- Job cancellation flips a status flag but doesn't abort in-flight connector/Gemini work.
- No persistent backing store — everything resets on restart.
- No CI, no Dockerfile (despite `DEPLOYMENT.md` describing one), no mobile navigation below 768px.

Full detail, severity, and file:line citations: `docs/KNOWN_ISSUES.md`.

## API integrations

- **WHOIS** — raw TCP socket to port 43, with a resilience fallback if the port is blocked.
- **DNS** — Node's built-in `dns` module.
- **GitHub REST API** — optionally authenticated via `GITHUB_TOKEN` (60 req/hour unauthenticated); includes a homepage-scraping discovery step to find a target's GitHub link.
- **security.txt / RFC 9116** — checks `/.well-known/security.txt` and the legacy `/security.txt` path.
- **Google Gemini** (`@google/genai`) — optional; report synthesis only, never used for scoring.

## Authentication

Two independent paths, not fully unified (see Known Issues #1, the critical IDOR finding):
- **API key** (`X-API-Key` header or `Authorization: Bearer`) → resolves to one **shared** identity (`usr_api_client`) for every key holder.
- **Session cookie** — HMAC-SHA256 signed, HttpOnly, SameSite=Lax, `timingSafeEqual` verification (`utils/session.ts`), created by `/auth/login`, which accepts any self-asserted email/name with **no password or verification** — documented in-code as intentional demo behavior, not a regression.
- Falls back to a `GUEST_USER` identity if neither is present, for routes that allow it.

## Database

None. API keys, investigation history, and async job state are all in-memory (`server.ts` module-level arrays, `investigationWorker.ts`'s `jobs` map). This is a disclosed, deliberate limitation (`VERSION.md`) — the architecture is written to swap in a real store later without changing call sites, but that migration hasn't started.

## Build & deployment

- `npm run build` → `vite build` (client) + `esbuild server.ts --bundle --platform=node --format=cjs` (server) → `dist/`.
- `npm run start` runs `dist/server.cjs`.
- Verified working as of this audit: build succeeds (397kB JS gzip 101.5kB, 242kB server bundle), `tsc --noEmit` clean, 229/229 tests pass.
- No Dockerfile exists despite `DEPLOYMENT.md` including its own inline Dockerfile example. No CI workflow exists at all.
