# Deployment Guide

This guide provides comprehensive instructions for deploying and running the Sentinel API Intelligence Platform in both local development environments and production-grade architectures.

---

## 📋 Prerequisites

Before deploying the platform, ensure your environment meets the following specifications:

- **Node.js**: v18.0.0 or higher (LTS recommended)
- **npm**: v9.0.0 or higher
- **Network Access**: Outbound HTTPS connectivity to Google Gemini API endpoints, GitHub API, DNS root servers, and WHOIS registries.
- **Operating System**: Linux, macOS, or Windows (via WSL2)

---

## ⚙️ Environment Variables

The application is configured dynamically using environment variables. Below is the full catalog of supported parameters:

### Required Parameters
- `GEMINI_API_KEY`: The API key used to access Gemini models for report summaries and deep threat intelligence meta-analysis. Without this, AI features will gracefully operate in fallback mode.

### Optional Parameters
- `PORT`: The port on which the Express server listens. Defaults to `3000`.
- `NODE_ENV`: The runtime mode (`development` or `production`). Defaults to `development`.
- `GITHUB_TOKEN`: A GitHub Personal Access Token (PAT) used to execute high-rate-limit scans against the GitHub REST API. Highly recommended for production deployment to prevent IP-rate throttling.
- `WHOIS_CACHE_TTL_MS`: Cache duration (in milliseconds) for domain registry WHOIS lookups. Defaults to `3600000` (1 hour).
- `DNS_CACHE_TTL_MS`: Cache duration (in milliseconds) for active authoritative DNS query loops. Defaults to `300000` (5 minutes).
- `GITHUB_CACHE_TTL_MS`: Cache duration (in milliseconds) for GitHub intelligence scans. Defaults to `3600000` (1 hour).
- `INVESTIGATION_CACHE_TTL_MS`: Cache duration (in milliseconds) for aggregated intelligence jobs. Defaults to `300000` (5 minutes).

---

## 💻 Running Locally

### 1. Installation
Install all dependencies cleanly from the package manifest:
```bash
npm install
```

### 2. Configuration
Create a `.env` file in the root directory. You can use our provided template:
```bash
cp .env.example .env
```
Populate the variables inside `.env` with your credentials (e.g., your `GEMINI_API_KEY`).

### 3. Spin up the Development Server
Launch the Express gateway with hot-reloading:
```bash
npm run dev
```
The application will boot at `http://localhost:3000`.

### 4. Running the Tests
Execute the unit and integration test suite to verify code integrity:
```bash
npm run test
```

### 5. Running the Linter
Verify code style and type safety constraints:
```bash
npm run lint
```

---

## 🚀 Production Deployment

Sentinel is designed for highly scalable, serverless container hosting (such as Google Cloud Run) or dedicated Node.js processes.

### Standalone Production Build
The build pipeline compiles all backend TypeScript files into a single, optimized, self-contained CommonJS file (`dist/server.cjs`) using `esbuild`. This bypasses module import speed limits and maximizes container cold-start performance.

1. **Build the Application**:
   ```bash
   npm run build
   ```
   This generates:
   - Statically optimized client assets inside `dist/`.
   - The compiled production-ready server bundle at `dist/server.cjs`.

2. **Start the Production Process**:
   ```bash
   npm run start
   ```

### Docker Deployment
Below is a standard production-ready `Dockerfile` layout for container environments:

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/server.cjs"]
```

---

## 🏥 Health Check Endpoints

Sentinel features active liveness, readiness, and version diagnostics designed for automated orchestrators (such as Kubernetes, AWS ECS, or Cloud Run):

### 1. Liveness Probe
- **Endpoint**: `GET /health`
- **Description**: Verifies that the Express process is active and running.
- **Response Format**: `application/json`
- **Example Response**:
  ```json
  {
    "status": "healthy",
    "timestamp": "2026-07-16T12:00:00.000Z",
    "uptime": 245.18
  }
  ```

### 2. Readiness Probe
- **Endpoint**: `GET /ready`
- **Description**: Determines if the application is fully prepared to receive live traffic, validating external upstream connections (such as the Gemini API).
- **Response Format**: `application/json`
- **Example Response**:
  ```json
  {
    "status": "ready",
    "timestamp": "2026-07-16T12:00:00.000Z",
    "services": {
      "geminiApi": "connected",
      "inMemoryStore": "ready"
    }
  }
  ```

### 3. Version Info
- **Endpoint**: `GET /version`
- **Description**: Returns version specifications and active environment parameters.
- **Response Format**: `application/json`
- **Example Response**:
  ```json
  {
    "version": "1.0.0-rc.1",
    "name": "Sentinel API Intelligence Platform",
    "nodeVersion": "v18.16.0",
    "env": "production"
  }
  ```

---

## 🔍 Troubleshooting

### Missing Environment Variables on Startup
- **Symptom**: Warn log `[Environment Audit] Missing or default environment variables` at boot time.
- **Resolution**: Check your runtime environment and verify `GEMINI_API_KEY` is set correctly. If deploying to Cloud Run, ensure the environment variable is configured in the Cloud Console or mapped to a Secret Manager secret.

### Upstream Network Failures (GitHub, WHOIS, DNS)
- **Symptom**: Investigations succeed but contain certain `Failure Fallback` entries.
- **Resolution**: This is the built-in circuit breaker and resilient fallback mechanism in action. If a source is down or throttled, it does not crash the server. Check logs with corresponding `X-Request-ID` correlations to identify the failing resource.

### 429 Rate Limit Errors
- **Symptom**: API calls return a `429 Too Many Requests` status.
- **Resolution**: Public endpoints restrict IP-based connections to 60 requests/minute. For high-volume automated services, provision an API Gateway key to unlock customizable higher-tier quotas (up to 1200 requests/minute).
