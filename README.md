# Sentinel API Intelligence Platform - Production Hardening

Sentinel is an enterprise-grade AI threat intelligence platform orchestrating parallel, multi-source investigation connectors alongside deep AI-assisted meta-analysis. 

This document details the production-hardening subsystem added to secure, stabilize, and monitor the Sentinel orchestrator under high-throughput workloads.

---

## 🛠️ Key Improvements & Architecture

### 1. Observability Subsystem
- **Structured JSON Logging (`/src/utils/logger.ts`)**: Custom logger outputting standardized, machine-readable JSON fields (`timestamp`, `level`, `category`, `message`).
- **Secret Masking & Sanitization**: Automask credentials and critical keys (`secret`, `authorization`, `x-api-key`) recursively in any context to prevent raw token leakages into metrics storage.
- **Request ID Tracking**: Correlation UUIDs (`X-Request-ID`) attached to every API context and response header to trace complex asynchronous executions.
- **Latency Profiling**: Custom timing wrappers that automatically log any request or connector taking longer than `1500ms` as `WARN` events.
- **Health & Ready Probes**: 
  - `GET /health`: Core container liveness probe reporting server uptime.
  - `GET /ready`: System readiness check validating Gemini API connectivity.
  - `GET /version`: Reports active application package meta-parameters.

### 2. Reliability & Resilience
- **Circuit Breaker state-machine (`/src/utils/reliability.ts`)**: Stateful breakers guarding each external connector. If failure thresholds are crossed, the breaker trips to `OPEN` to prevent network cascading, cool-down triggers, and then tests healing in `HALF_OPEN`.
- **Exponential Backoff Retries**: Transient failures automatically trigger configurable retries with backoff delays, avoiding resource starvation.
- **Promise Execution Timeout**: Active time-guards protecting the thread pool from unresponsive upstream server queries.
- **Graceful Fallbacks**: If any connector experiences persistent failures, the engine generates an inline `Failure Fallback` evidence card and aggregates remaining successful connectors safely.

### 3. Security Hardening
- **Distributed Rate Limiting**: sliding-window tracking (by client IP or resolved API Key ID) to prevent Denial of Service (DoS) and API abuse.
- **Robust Input Validation**: Strict validation schemas protecting database execution from cross-site scripting (XSS), script tags, and brackets.
- **Environment Safety Checks**: Automated diagnostic audits on launch to warn of missing or misplaced secret declarations.

---

## 🔑 Environment Variables

The application is configured through environment variables. Create a `.env` file in the root folder:

```env
# Server Configuration
NODE_ENV=production
PORT=3000

# AI Meta-Analysis Core API (Required)
GEMINI_API_KEY=your-gemini-api-key-here
```

---

## 💻 Local Development

### Prerequisites
- Node.js (v18 or higher)
- npm (v9 or higher)

### Installation
1. Install base dependencies:
   ```bash
   npm install
   ```

2. Spin up the development gateway:
   ```bash
   npm run dev
   ```
   The development gateway will serve the hot-rebuilding frontend applet alongside versioned API servers at `http://localhost:3000`.

### Executing Hardened Test Suites
To run our unit, integration, and resiliency testing suites:
```bash
npm run test
```

---

## 🚀 Deployment

The Sentinel platform builds into a highly optimized, fully bundle-compiled standalone package suitable for serverless platforms like Google Cloud Run.

1. **Compile Application Package**:
   ```bash
   npm run build
   ```
   This generates a statically optimized client package in `dist/` and compiles the backend server into a single, bundled CJS executable `dist/server.cjs` via `esbuild`.

2. **Boot Production Gateway**:
   ```bash
   npm run start
   ```

---

## 🔍 Troubleshooting

### 1. Connector Failing Fallbacks
- **Symptom**: `Failure Fallback` cards appear inside the active scan evidences.
- **Resolution**: This is the expected graceful degradation behavior when upstream sources fail. Check `/src/utils/logger.ts` for detailed structured logs containing specific error context and request ID references.

### 2. Rate Limit Exceeded
- **Symptom**: Requests return `429 Too Many Requests` responses.
- **Resolution**: Verify user authentication headers. Public endpoints apply strict IP limits (60/min) whereas authenticated client keys support customizable quotas up to 1200/min.

### 3. AI Service Unavailable
- **Symptom**: `/ready` probe returns `degraded` and logs warn of missing configurations.
- **Resolution**: Confirm that your `GEMINI_API_KEY` is loaded correctly in your runtime environment.
