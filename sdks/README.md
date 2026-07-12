# Sentinel SDK Developer Center 🚀

Welcome to the **Sentinel Platform SDK and Client Library Hub**. These official libraries let you run automated security scanning, query threat intelligence databases, resolve target identities, and build parallel perimeter investigations with high-availability server-side SDKs.

---

## 🔑 Authentication

All client requests must authenticate with a secure, developer-authorized API Key. Generate or rotate your tokens inside the **Sentinel Management Dashboard**.

Provide your keys using the `X-API-Key` or `Authorization: Bearer <key>` headers.

---

## 📦 SDK Installation & Setup

### 1. TypeScript / JavaScript SDK
Located at: `./sdks/typescript/index.ts`

```typescript
import { Sentinel } from "./sdks/typescript";

const client = new Sentinel({
  apiKey: "sn_live_your_secret_token_here",
  baseUrl: "http://localhost:3000" // or custom deployment domain
});
```

#### Synchronous Real-time Scan
```typescript
try {
  const report = await client.investigate({
    type: "domain",
    value: "openai.com"
  });
  console.log("Strategic threat level:", report.riskScore);
  console.log("Summary:", report.summary);
} catch (err) {
  console.error("Scanning pipeline failed:", err.message);
}
```

#### Asynchronous Scanning & Progress Polling
```typescript
try {
  // Create background scanning worker job
  const job = await client.createInvestigationJob({
    type: "domain",
    value: "example.com"
  });
  console.log(`Job spawned successfully with ID: ${job.jobId} (Status: ${job.status})`);

  // Block and poll with custom callback intervals
  const finalReport = await client.pollInvestigationJob(job.jobId, {
    intervalMs: 1500, // Poll every 1.5 seconds
    timeoutMs: 60000  // Timeout after 60 seconds
  });

  console.log("Synthesized Risk Score:", finalReport.riskScore);
  console.log("Identified Entities Count:", finalReport.entities.length);
} catch (err) {
  console.error("Job tracking failed:", err.message);
}
```

#### Query Historical Reports & Index
```typescript
// Fetch paginated scan histories
const historyResponse = await client.getHistory({ page: 1, limit: 10 });
console.log(`Found ${historyResponse.pagination.total} historical reports.`);

// Read full structured report payload
if (historyResponse.history.length > 0) {
  const detail = await client.getReport(historyResponse.history[0].id);
  console.log("Scanned domain entities:", detail.entities);
}
```

---

### 2. Python SDK (Zero-dependency)
Located at: `./sdks/python/sentinel.py`

The Python client has **zero dependencies** and runs seamlessly out of the box using built-in `urllib` and `json` libraries.

```python
from sentinel import Sentinel, SentinelError

client = Sentinel(
    api_key="sn_live_your_secret_token_here",
    base_url="http://localhost:3000"
)
```

#### Synchronous Target Investigation
```python
try:
    report = client.investigate(type="domain", value="openai.com")
    print(f"Risk Assessment: {report['riskScore']}/100")
    print(f"Executive Summary: {report['executiveSummary']}")
except SentinelError as err:
    print(f"Lookup failed: {err}")
```

#### Asynchronous Job Orchestration & Polling
```python
try:
    # Queue background task
    job = client.create_investigation_job(type="domain", value="example.com")
    print(f"Created Job {job['jobId']} (Status: {job['status']})")
    
    # Automatically polls until completion and raises if error is found
    report = client.poll_investigation_job(job['jobId'], interval_sec=1, timeout_sec=60)
    print(f"Completed! Resolved Entities: {len(report['entities'])}")
    print(f"Core Recommendations: {report['recommendations']}")
except SentinelError as err:
    print(f"Job failed: {err}")
```

#### Fetch Scan History List
```python
try:
    history_res = client.get_history(page=1, limit=5)
    print(f"Total reports found in dashboard: {history_res['pagination']['total']}")
    for item in history_res['history']:
        print(f"- Query: {item['query']} (Risk: {item['riskScore']})")
except SentinelError as err:
    print(f"Could not load scan metrics: {err}")
```

---

## 📜 OpenAPI 3.1 & Interactive Docs

The platform serves interactive Swagger documentation. Point your browser or API explorer to:
- **Interactive Swagger UI Dashboard:** `http://localhost:3000/docs`
- **Raw OpenAPI 3.1 Schema Document:** `http://localhost:3000/api/v1/openapi.json`
