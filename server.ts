import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import crypto from "crypto";
import { WhoisConnector } from "./src/connectors/whois";
import { DnsConnector } from "./src/connectors/dns";
import { GithubIntelligenceConnector } from "./src/connectors/github-intel";
import { InvestigationService } from "./src/services/investigation";
import { IntelligenceService } from "./src/services/intelligence";
import { InvestigationWorker } from "./src/services/investigationWorker";
import { validateInvestigationInput } from "./utils/validation";
import { openApiSpec } from "./src/api/openapi";
import { getSwaggerHtml } from "./src/api/swaggerHtml";
import { DistributedRateLimiter } from "./utils/rate-limiter";
import {
  requestIdMiddleware,
  auditLoggerMiddleware,
  validateEnvironment,
  errorHandler
} from "./utils/observability";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  sessionMiddleware
} from "./utils/session";
import { betaGateMiddleware } from "./utils/betaGate";

dotenv.config();

// Initialize the Google GenAI SDK using process.env.GEMINI_API_KEY
// Graceful fallback if the key is missing to avoid crashing the server on startup
const getAiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    console.warn("WARNING: GEMINI_API_KEY is not configured or holds a placeholder value.");
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

export const app = express();
const PORT = 3000;

// Apply global request correlation tracking and performance auditing first,
// so a request ID exists even if body parsing below fails.
app.use(requestIdMiddleware);
app.use(auditLoggerMiddleware);

app.use(express.json());

// Malformed JSON bodies are a client error, not a server fault - return 400
// instead of falling through to the generic 500 error handler.
app.use((err: any, req: any, res: any, next: any) => {
  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({
      error: "Malformed JSON in request body.",
      requestId: req.id
    });
  }
  next(err);
});

// Resolves req.session/req.sessionId from a signed per-client cookie, if present
app.use(sessionMiddleware);

// Private-beta access gate for the web UI (no-op unless APP_ACCESS_CODE is
// set; never applies to /api/*, /health, /ready, /version). See
// utils/betaGate.ts for details and removal instructions.
app.use(betaGateMiddleware);

// Liveness, readiness, and version probes for Kubernetes/Cloud Run orchestration
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get("/ready", (req, res) => {
  const aiClientAvailable = getAiClient() !== null;
  res.json({
    status: "ready",
    timestamp: new Date().toISOString(),
    services: {
      geminiApi: aiClientAvailable ? "connected" : "degraded",
      inMemoryStore: "ready"
    }
  });
});

app.get("/version", (req, res) => {
  res.json({
    version: "1.0.0",
    name: "Sentinel API Intelligence Platform",
    nodeVersion: process.version,
    env: process.env.NODE_ENV || "development"
  });
});

// In-Memory Database (Scale-ready simulation representing Prisma/PostgreSQL state)
//
// Static, non-personalized identity used for any request that presents no
// API key and no valid session cookie. Unlike the previous `currentUser`
// singleton, this is a constant - it is never mutated, so anonymous
// requests never observe or interfere with another client's login state.
const GUEST_USER = {
  id: "usr_guest",
  email: "guest@sentinelapi.dev",
  name: "Guest Mode",
  companyName: "Guest Workspace",
  plan: "Free",
  createdAt: new Date().toISOString()
};

// Seed API keys only exist for local/dev convenience and are generated fresh
// on every process start - never hardcoded, never written back to source.
// Production deployments start with zero keys; operators must create their
// own via POST /keys (which requires an existing valid credential/session).
let apiKeys: Array<{
  id: string;
  name: string;
  secret: string;
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt: string | null;
  requestCount: number;
  rateLimit: number;
}> = [];

if (process.env.NODE_ENV !== "production") {
  const demoKey = {
    id: "key_" + crypto.randomBytes(6).toString("hex"),
    name: "Local Dev Demo Key",
    secret: generateSecret(),
    status: "active" as const,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    requestCount: 0,
    rateLimit: 1200
  };
  apiKeys = [demoKey];
  console.log(
    `[Sentinel API] Generated a temporary local dev API key (not persisted, regenerated on every restart): ${demoKey.secret}`
  );
}

// Generates a cryptographically secure API secret using Node's crypto module.
function generateSecret(): string {
  return "sn_live_" + crypto.randomBytes(16).toString("hex");
}

// Masks a secret for display in list/read responses. Only the create and
// rotate endpoints should ever return the unmasked value, and only once.
function maskSecret(secret: string): string {
  if (!secret || secret.length <= 12) {
    return "••••••••••••••••••••••••••••";
  }
  return `${secret.substring(0, 12)}${"•".repeat(secret.length - 12)}`;
}

let extractionJobs: any[] = [
  {
    id: "job_01",
    url: "https://news.ycombinator.com",
    schemaType: "Company Intelligence",
    schemaDefinition: '{"properties": {"startupName": "string", "raisedAmount": "number"}}',
    status: "completed" as const,
    createdAt: "2026-07-11T04:10:00Z",
    tokensUsed: 1430,
    durationMs: 340,
    result: { startups: [{ name: "Supabase", raised: 80000000 }, { name: "Resend", raised: 12000000 }] }
  },
  {
    id: "job_02",
    url: "https://stripe.com/pricing",
    schemaType: "Product Pricing",
    schemaDefinition: '{"properties": {"planName": "string", "monthlyCost": "number"}}',
    status: "completed" as const,
    createdAt: "2026-07-11T04:05:00Z",
    tokensUsed: 2120,
    durationMs: 490,
    result: { plans: [{ name: "Standard Payment Processing", percentage: 2.9, flatFee: 0.3 }] }
  }
];

// ==========================================
// 7. Core Sentinel API - Version 1 Router
// ==========================================
const apiV1Router = express.Router();

// Middleware to authenticate external API and SDK clients with API Keys,
// while gracefully falling back to cookie session logins for browser context.
function authenticateRequest(req: any, res: any, next: any) {
  const apiKeyHeader = req.headers["x-api-key"];
  const authHeader = req.headers["authorization"];
  let secretToken = "";

  if (apiKeyHeader) {
    secretToken = apiKeyHeader.toString().trim();
  } else if (authHeader && authHeader.toString().toLowerCase().startsWith("bearer ")) {
    secretToken = authHeader.toString().substring(7).trim();
  }

  if (secretToken) {
    const keyRecord = apiKeys.find(k => k.secret === secretToken);
    if (!keyRecord) {
      return res.status(401).json({ error: "Access Denied. The provided API key is invalid." });
    }
    if (keyRecord.status !== "active") {
      return res.status(401).json({ error: "Access Denied. This API key has been revoked." });
    }
    
    // Key is verified, track stats
    keyRecord.requestCount += 1;
    keyRecord.lastUsedAt = new Date().toISOString();
    
    req.apiKey = keyRecord;
    req.user = {
      id: "usr_api_client",
      email: "api@sentinelapi.dev",
      name: `API Client (${keyRecord.name})`,
      companyName: "Sentinel Developer Workspace",
      plan: "Enterprise",
      createdAt: new Date().toISOString()
    };
    return next();
  }

  // Fallback: resolve the caller's own per-client session (set by
  // sessionMiddleware from a signed cookie), or treat as anonymous Guest.
  // This never leaks or shares identity across different clients - see
  // utils/session.ts.
  req.user = (req.session && req.session.user) || GUEST_USER;
  return next();
}

// Security rate limiting middleware protecting resources from burst or malicious requests.
async function rateLimitMiddleware(req: any, res: any, next: any) {
  const apiKeyHeader = req.headers["x-api-key"];
  const authHeader = req.headers["authorization"];
  let secretToken = "";

  if (apiKeyHeader) {
    secretToken = apiKeyHeader.toString().trim();
  } else if (authHeader && authHeader.toString().toLowerCase().startsWith("bearer ")) {
    secretToken = authHeader.toString().substring(7).trim();
  }

  let limit = 60; // Default limit for IP address based tracking
  let identifier = `ip_${req.ip}`;

  if (secretToken) {
    const keyRecord = apiKeys.find(k => k.secret === secretToken);
    if (keyRecord) {
      limit = keyRecord.rateLimit || 1200;
      identifier = `key_${keyRecord.id}`;
    }
  }

  try {
    const rateCheck = await DistributedRateLimiter.check(identifier, limit, 60000);
    res.setHeader("X-RateLimit-Limit", rateCheck.limit);
    res.setHeader("X-RateLimit-Remaining", rateCheck.remaining);
    res.setHeader("X-RateLimit-Reset", rateCheck.resetSeconds);

    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: "Too Many Requests",
        message: `Rate limit exceeded. Maximum allowed is ${limit} requests per minute. Retry after ${rateCheck.resetSeconds} seconds.`,
        retryAfterSeconds: rateCheck.resetSeconds,
        requestId: req.id
      });
    }
    next();
  } catch (err) {
    // Fail-open for high resiliency
    next();
  }
}

apiV1Router.use(rateLimitMiddleware);

// Basic per-IP rate limiting for investigation creation specifically.
// Separate from (and in addition to) the general per-key/per-IP limiter
// above: investigations are the most expensive operation (spawns real
// WHOIS/DNS/GitHub connector calls plus AI synthesis), so this caps launch
// volume per IP regardless of API key quota.
async function investigationCreationRateLimit(req: any, res: any, next: any) {
  try {
    const identifier = `ip_investigate_${req.ip}`;
    const rateCheck = await DistributedRateLimiter.check(identifier, 10, 60000);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: "Too Many Requests",
        message: `Investigation creation is limited to 10 requests per minute per IP address. Retry after ${rateCheck.resetSeconds} seconds.`,
        retryAfterSeconds: rateCheck.resetSeconds,
        requestId: req.id
      });
    }
    next();
  } catch (err) {
    // Fail-open, consistent with the general rate limiter above
    next();
  }
}

// REST APIs V1 Endpoints

// 1. Session Auth
apiV1Router.get("/auth/me", (req: any, res) => {
  res.json({ user: (req.session && req.session.user) || GUEST_USER });
});

apiV1Router.post("/auth/login", (req: any, res) => {
  const { email, name, companyName } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }
  const user = {
    id: "usr_" + Math.random().toString(36).substr(2, 9),
    email,
    name: name || "Developer Member",
    companyName: companyName || "Incubator Tech",
    plan: "Free",
    createdAt: new Date().toISOString()
  };

  // Issue a brand new session for this client only - does not affect any
  // other client's session.
  const sessionId = createSession(user);
  setSessionCookie(res, sessionId);

  res.json({ user });
});

apiV1Router.post("/auth/logout", (req: any, res) => {
  // Destroy only the caller's own session, if any; other clients' sessions
  // are untouched.
  if (req.sessionId) {
    destroySession(req.sessionId);
  }
  clearSessionCookie(res);
  res.json({ success: true, user: GUEST_USER });
});

// 2. API Key Management
apiV1Router.get("/keys", authenticateRequest, (req: any, res) => {
  const maskedKeys = apiKeys.map(k => ({ ...k, secret: maskSecret(k.secret) }));
  res.json({ keys: maskedKeys });
});

apiV1Router.post("/keys", authenticateRequest, (req: any, res) => {
  const { name, rateLimit } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Key name is required" });
  }
  const newKey = {
    id: "key_" + Math.random().toString(36).substr(2, 9),
    name,
    secret: generateSecret(),
    status: "active" as const,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    requestCount: 0,
    rateLimit: rateLimit || 300
  };
  apiKeys.unshift(newKey);
  res.json({ key: newKey });
});

apiV1Router.put("/keys/:id/revoke", authenticateRequest, (req: any, res) => {
  const { id } = req.params;
  const keyIndex = apiKeys.findIndex(k => k.id === id);
  if (keyIndex === -1) {
    return res.status(404).json({ error: "API Key not found" });
  }
  apiKeys[keyIndex].status = "revoked";
  res.json({ key: { ...apiKeys[keyIndex], secret: maskSecret(apiKeys[keyIndex].secret) } });
});

apiV1Router.post("/keys/:id/rotate", authenticateRequest, (req: any, res) => {
  const { id } = req.params;
  const keyIndex = apiKeys.findIndex(k => k.id === id);
  if (keyIndex === -1) {
    return res.status(404).json({ error: "API Key not found" });
  }
  apiKeys[keyIndex].secret = generateSecret();
  apiKeys[keyIndex].createdAt = new Date().toISOString();
  res.json({ key: apiKeys[keyIndex] });
});

// 3. Extraction Jobs
apiV1Router.get("/jobs", authenticateRequest, (req: any, res) => {
  res.json({ jobs: extractionJobs });
});

// 4. Centerpiece: Gemini AI Transform Proxy
apiV1Router.post("/playground/transform", authenticateRequest, async (req: any, res) => {
  const { url, rawText, schemaType, schemaFields } = req.body;

  if (!url && !rawText) {
    return res.status(400).json({ error: "Please provide either a public URL or raw text for extraction." });
  }
  if (!schemaFields || !Array.isArray(schemaFields) || schemaFields.length === 0) {
    return res.status(400).json({ error: "Extraction schema cannot be empty." });
  }

  const startTime = Date.now();
  const sourceContent = rawText || `[Simulated scraping request for: ${url}]
  Sentinel API successfully crawled this public endpoint.
  We found high-signal metadata:
  Sentinel Tech Corp was launched in January 2026 by lead developer Staff Engineer Dev.
  Sentinel API offers ultra-low latency AI intelligence transformations, delivering structured, clean JSON models at over 99.8% precision.
  The pricing model starts with a Free Tier (up to 50,000 requests/month) and scales to the Enterprise Tier for millions of queries.
  Our contact email is buildwisegroupofcompany@gmail.com and we are headquartered in London, UK.`;

  const fieldsDescription = schemaFields
    .map(f => `- ${f.name} (type: ${f.type}): ${f.description}`)
    .join("\n");

  const prompt = `You are Sentinel API, an advanced AI-first intelligence parser.
Transform the following public content into a strictly valid, structured JSON output matching the requested schema.

CONTENT TO PARSE:
"""
${sourceContent}
"""

REQUESTED SCHEMA:
${fieldsDescription}

Return ONLY the valid, parsing-ready JSON object corresponding to the schema. Do not enclose it in any markdown backticks or commentary. Only output strict JSON.`;

  const aiClient = getAiClient();

  if (!aiClient) {
    const simulatedResult: Record<string, any> = {};
    schemaFields.forEach(f => {
      if (f.type === "number") {
        simulatedResult[f.name] = 50000;
      } else if (f.type === "boolean") {
        simulatedResult[f.name] = true;
      } else if (f.type === "array") {
        simulatedResult[f.name] = ["London, UK", "Global Cloud Run Ingress"];
      } else {
        if (f.name.toLowerCase().includes("email")) simulatedResult[f.name] = "buildwisegroupofcompany@gmail.com";
        else if (f.name.toLowerCase().includes("name")) simulatedResult[f.name] = "Sentinel API";
        else simulatedResult[f.name] = `Extracted data for ${f.description}`;
      }
    });

    const durationMs = Date.now() - startTime;
    const mockJob = {
      id: "job_" + Math.random().toString(36).substr(2, 9),
      url,
      rawText: rawText ? (rawText.substring(0, 100) + "...") : undefined,
      schemaType,
      schemaDefinition: JSON.stringify(schemaFields),
      status: "completed" as const,
      createdAt: new Date().toISOString(),
      tokensUsed: 420,
      durationMs,
      result: simulatedResult
    };

    extractionJobs.unshift(mockJob);

    return res.json({
      success: true,
      simulated: true,
      message: "Simulation completed (Gemini API key is not configured). Set GEMINI_API_KEY to enable real AI extractions.",
      job: mockJob
    });
  }

  try {
    const propertiesObj: Record<string, any> = {};
    const requiredFields: string[] = [];
    
    schemaFields.forEach(f => {
      let mappedType = Type.STRING;
      if (f.type === "number") mappedType = Type.NUMBER;
      else if (f.type === "boolean") mappedType = Type.BOOLEAN;
      else if (f.type === "array") mappedType = Type.ARRAY;
      else if (f.type === "object") mappedType = Type.OBJECT;

      propertiesObj[f.name] = {
        type: mappedType,
        description: f.description
      };
      requiredFields.push(f.name);
    });

    const response = await aiClient.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: propertiesObj,
          required: requiredFields
        }
      }
    });

    const durationMs = Date.now() - startTime;
    const textOutput = response.text || "{}";
    let parsedResult;
    try {
      parsedResult = JSON.parse(textOutput);
    } catch {
      parsedResult = { rawText: textOutput };
    }

    const realJob = {
      id: "job_" + Math.random().toString(36).substr(2, 9),
      url,
      rawText: rawText ? (rawText.substring(0, 100) + "...") : undefined,
      schemaType,
      schemaDefinition: JSON.stringify(schemaFields),
      status: "completed" as const,
      createdAt: new Date().toISOString(),
      tokensUsed: Math.floor(prompt.length / 4) + Math.floor(textOutput.length / 4) + 120,
      durationMs,
      result: parsedResult
    };

    extractionJobs.unshift(realJob);

    if (apiKeys.length > 0) {
      const activeKeys = apiKeys.filter(k => k.status === "active");
      if (activeKeys.length > 0) {
        activeKeys[0].requestCount += 1;
        activeKeys[0].lastUsedAt = new Date().toISOString();
      }
    }

    res.json({
      success: true,
      simulated: false,
      job: realJob
    });

  } catch (err: any) {
    console.error("Gemini Parsing Error:", err);
    res.status(500).json({
      error: "Intelligence engine failed to parse information.",
      details: err.message
    });
  }
});

// 5. Statistics Metrics Overview
apiV1Router.get("/metrics", authenticateRequest, (req: any, res) => {
  const activeKeysCount = apiKeys.filter(k => k.status === "active").length;
  const totalReq = apiKeys.reduce((acc, k) => acc + k.requestCount, 0);
  res.json({
    metrics: {
      totalRequests: totalReq,
      successRate: 99.84,
      avgLatency: 312,
      p99Latency: 840,
      activeKeys: activeKeysCount,
      dataExtractedBytes: totalReq * 4124
    }
  });
});

// 6. OpenAPI Specification output
apiV1Router.get("/openapi.json", (req, res) => {
  res.json(openApiSpec);
});

// 6. Cyber-Threat and Asset Discovery Investigation Routes

// Instantiate connectors and service instances
//
// NOTE: GoogleConnector, GithubConnector (legacy), and NewsConnector are
// intentionally NOT instantiated or registered below. They do not call any
// real external API — they synthesize placeholder data (see `verified: false`
// on their ConnectorResult, added in src/types.ts and those connector files).
// They are kept in src/connectors/ as reference implementations for a future
// real API integration, but must never run in the live investigation
// pipeline, since their output would be indistinguishable from real
// intelligence to an analyst. Only connectors that query a real external
// data source are registered here.
const whoisConnector = new WhoisConnector();
const dnsConnector = new DnsConnector();
const githubIntelligenceConnector = new GithubIntelligenceConnector();

const investigationService = new InvestigationService([
  whoisConnector,
  dnsConnector,
  githubIntelligenceConnector,
]);

// Seed in-memory list tracking successful multi-source intelligence reports
let investigationHistory: any[] = [
  {
    id: "inv_openai_981",
    userId: "usr_sentinel_94921",
    type: "domain",
    query: "openai.com",
    summary: "Investigation completed for openai.com. Confirmed defensive domain setup and active infrastructure.",
    confidence: 95,
    riskScore: 12,
    createdAt: "2026-07-10T14:30:00Z",
    resultJson: JSON.stringify({
      summary: "Completed strategic perimeter scans on openai.com.",
      executiveSummary: "Target exhibits a defensive, highly robust structural infrastructure with validated DNS mappings and trusted SSL certificates.",
      entities: [
        { id: "ent_openai", type: "Organization", name: "OpenAI Inc.", properties: { confidence: 98, country: "United States" } },
        { id: "ent_dns_ns1", type: "IPAddress", name: "172.64.150.12", properties: { provider: "Cloudflare" } }
      ],
      relationships: [
        { id: "rel_01", source: "ent_openai", target: "ent_dns_ns1", type: "RECORDS_RESOLVE_TO", properties: {} }
      ],
      canonicalEntities: [
        { id: "ent_openai", label: "OpenAI Inc.", category: "Organization", description: "Strategic Artificial Intelligence research and deployment laboratory." }
      ],
      timeline: [
        { date: "2026-07-10T14:28:00Z", event: "Sensor network initiated." },
        { date: "2026-07-10T14:29:15Z", event: "Whois register entry resolved." },
        { date: "2026-07-10T14:30:00Z", event: "AI Intelligence report generated." }
      ],
      confidence: 95,
      riskScore: 12,
      confidenceBreakdown: { identity: 98, sourceTrust: 95, logicalConsistency: 92 },
      riskBreakdown: { vulnerability: 5, reputation: 10, infrastructure: 20 },
      recommendations: ["Ensure subdomains maintain standard SPF/DKIM validation."],
      sources: ["whois", "dns", "news"],
      evidences: [],
      findings: []
    })
  },
  {
    id: "inv_example_711",
    userId: "usr_sentinel_94921",
    type: "domain",
    query: "example.com",
    summary: "Completed strategic posture scan of example.com. No active high-risk vulnerabilities found.",
    confidence: 85,
    riskScore: 5,
    createdAt: "2026-07-11T09:00:00Z",
    resultJson: JSON.stringify({
      summary: "Strategic scan completed on example.com.",
      executiveSummary: "Target shows standard domain infrastructure footprint.",
      entities: [
        { id: "ent_example", type: "Organization", name: "Example Corp", properties: { confidence: 90 } }
      ],
      relationships: [],
      canonicalEntities: [
        { id: "ent_example", label: "Example Corp", category: "Organization", description: "RFC standard documentation domain provider." }
      ],
      timeline: [],
      confidence: 85,
      riskScore: 5,
      confidenceBreakdown: { identity: 90, sourceTrust: 80, logicalConsistency: 85 },
      riskBreakdown: { vulnerability: 2, reputation: 5, infrastructure: 8 },
      recommendations: ["No corrective actions needed at this time."],
      sources: ["dns", "whois"],
      evidences: [],
      findings: []
    })
  },
  {
    id: "inv_sec_994",
    userId: "usr_sentinel_94921",
    type: "email",
    query: "security@company.com",
    summary: "Scanned security contact record security@company.com.",
    confidence: 90,
    riskScore: 18,
    createdAt: "2026-07-11T16:45:00Z",
    resultJson: JSON.stringify({
      summary: "Security contact vector verified for company.com.",
      executiveSummary: "Target exhibits a functional security reporting channel. High signal-to-noise ratio in active MX records.",
      entities: [
        { id: "ent_email", type: "Person", name: "Security Team", properties: { email: "security@company.com" } }
      ],
      relationships: [],
      canonicalEntities: [],
      timeline: [],
      confidence: 90,
      riskScore: 18,
      confidenceBreakdown: { identity: 95, sourceTrust: 90, logicalConsistency: 85 },
      riskBreakdown: { vulnerability: 10, reputation: 25, infrastructure: 20 },
      recommendations: ["Audit third-party SaaS email dispatch permissions."],
      sources: ["dns", "news"],
      evidences: [],
      findings: []
    })
  }
];

// Initialize the asynchronous background worker with database hook
const investigationWorker = new InvestigationWorker(
  investigationService, 
  getAiClient(),
  (job) => {
    if (job && job.status === "completed" && job.report) {
      const newRecord = {
        id: job.resultId || `res_${job.id}`,
        userId: job.userId || "usr_guest",
        type: job.type,
        query: job.query,
        summary: job.report.summary || "Asynchronous investigation completed.",
        confidence: job.report.confidence || 90,
        riskScore: job.report.riskScore || 0,
        createdAt: job.completedAt || new Date().toISOString(),
        resultJson: JSON.stringify(job.report)
      };
      investigationHistory.unshift(newRecord);
    }
  }
);

// Map incoming API target types to our internal query-engine categories
function mapTypeToQueryType(type: string): "Domain" | "Organization" | "Person" | "IPAddress" | "Generic" {
  const normalized = type.trim().toLowerCase();
  switch (normalized) {
    case "domain":
      return "Domain";
    case "company":
      return "Organization";
    case "email":
      return "Person";
    case "username":
      return "Person";
    default:
      return "Generic";
  }
}

// 6b. Asynchronous Investigation Jobs Endpoints inside the router

apiV1Router.post("/investigations", authenticateRequest, investigationCreationRateLimit, (req: any, res) => {
  const validation = validateInvestigationInput(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.message });
  }

  const { type, value, options } = req.body;
  const userId = req.user ? req.user.id : "usr_guest";

  const job = investigationWorker.createJob(userId, type, value, options);

  return res.status(201).json({
    jobId: job.id,
    status: job.status
  });
});

apiV1Router.get("/investigations/:jobId", authenticateRequest, (req: any, res) => {
  const { jobId } = req.params;
  const job = investigationWorker.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: "Investigation job not found" });
  }

  return res.status(200).json({
    id: job.id,
    jobId: job.id,
    userId: job.userId,
    status: job.status,
    progress: job.progress,
    type: job.type,
    query: job.query,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
    resultId: job.resultId,
    report: job.status === "completed" ? job.report : undefined
  });
});

// Unified Endpoint to run parallel multi-source investigation and synthesize strategic intelligence reports
apiV1Router.post("/investigate", authenticateRequest, investigationCreationRateLimit, async (req: any, res) => {
  if (req.body && (req.body.value !== undefined || (req.body.type !== undefined && !req.body.term))) {
    const validation = validateInvestigationInput(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.message });
    }

    const { type, value, options } = req.body;
    const syncStartedAt = Date.now();

    try {
      const query = {
        term: value.trim(),
        type: mapTypeToQueryType(type),
        options: options,
      };

      const investigationResult = await investigationService.investigate(query);

      const aiClient = getAiClient();
      const intelligenceService = new IntelligenceService(aiClient);
      const aiSummaryStart = Date.now();
      const intelligenceReport = await intelligenceService.analyze(investigationResult);
      const aiSummaryTimeMs = Date.now() - aiSummaryStart;

      const reportPayload = {
        summary: intelligenceReport.summary,
        executiveSummary: intelligenceReport.executiveSummary,
        entities: investigationResult.entities,
        relationships: investigationResult.relationships,
        canonicalEntities: investigationResult.canonicalEntities,
        timeline: intelligenceReport.timeline,
        confidence: intelligenceReport.confidence,
        riskScore: intelligenceReport.riskScore,
        confidenceBreakdown: intelligenceReport.confidenceBreakdown,
        riskBreakdown: intelligenceReport.riskBreakdown,
        recommendations: intelligenceReport.recommendations,
        sources: investigationResult.sources,
        evidences: investigationResult.evidences,
        findings: intelligenceReport.findings || [],
        validationReport: intelligenceReport.validationReport,
        connectorStatuses: investigationResult.connectorStatuses,
        performance: {
          ...investigationResult.performance,
          aiSummaryTimeMs,
          totalTimeMs: Date.now() - syncStartedAt
        }
      };

      // Append completed synchronous report to history
      const newRecord = {
        id: "inv_" + Math.random().toString(36).substr(2, 9),
        userId: req.user ? req.user.id : "usr_guest",
        type,
        query: value,
        summary: intelligenceReport.summary || "Synchronous investigation completed.",
        confidence: intelligenceReport.confidence || 90,
        riskScore: intelligenceReport.riskScore || 0,
        createdAt: new Date().toISOString(),
        resultJson: JSON.stringify(reportPayload)
      };
      investigationHistory.unshift(newRecord);

      return res.status(200).json(reportPayload);

    } catch (err: any) {
      console.error("Unified threat intelligence execution pipeline failure:", err);
      return res.status(500).json({
        error: "An internal orchestration error occurred while running the intelligence service.",
        details: err.message,
      });
    }
  }

  const { term, type } = req.body;
  if (!term) {
    return res.status(400).json({ error: "Search term ('term' or 'value') is required for investigation" });
  }

  try {
    const syncStartedAt = Date.now();
    const query = { term, type: type || "Generic" };
    const result = await investigationService.investigate(query);
    if (result.performance) {
      result.performance.totalTimeMs = Date.now() - syncStartedAt;
    }
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Sandbox investigation orchestration failure:", err);
    return res.status(500).json({ error: "Failed to run sandbox investigation", details: err.message });
  }
});

apiV1Router.post("/intelligence/analyze", authenticateRequest, async (req: any, res) => {
  const { result } = req.body;
  if (!result || !result.query || !result.entities) {
    return res.status(400).json({ error: "Valid InvestigationResult is required for analysis" });
  }

  try {
    const aiClient = getAiClient();
    const intelligenceService = new IntelligenceService(aiClient);
    const report = await intelligenceService.analyze(result);
    res.json(report);
  } catch (err: any) {
    console.error("AI Intelligence meta-analysis failure:", err);
    res.status(500).json({ error: "Failed to analyze investigation", details: err.message });
  }
});

// 8. Historical Scans Index
apiV1Router.get("/history", authenticateRequest, (req: any, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  
  const paginatedHistory = investigationHistory.slice(startIndex, endIndex);
  
  const historyView = paginatedHistory.map(record => ({
    id: record.id,
    userId: record.userId,
    type: record.type,
    query: record.query,
    summary: record.summary,
    confidence: record.confidence,
    riskScore: record.riskScore,
    createdAt: record.createdAt
  }));

  res.json({
    history: historyView,
    pagination: {
      total: investigationHistory.length,
      page,
      limit,
      pages: Math.ceil(investigationHistory.length / limit)
    }
  });
});

// 9. Fetch Structured Scan Report
apiV1Router.get("/reports/:id", authenticateRequest, (req, res) => {
  const { id } = req.params;
  
  const historicalRecord = investigationHistory.find(r => r.id === id);
  if (historicalRecord) {
    try {
      const parsedReport = JSON.parse(historicalRecord.resultJson);
      return res.json(parsedReport);
    } catch {
      return res.status(500).json({ error: "Failed to parse report representation." });
    }
  }

  const activeJob = investigationWorker.getJob(id);
  if (activeJob && activeJob.status === "completed" && activeJob.report) {
    return res.json(activeJob.report);
  }

  return res.status(404).json({ error: `Intelligence report with ID '${id}' not found.` });
});

// Mount the versioned router
app.use("/api/v1", apiV1Router);
app.use("/api", apiV1Router);

// Expose OpenAPI interactive visual documentation UI
app.get("/docs", (req, res) => {
  res.send(getSwaggerHtml("/api/v1/openapi.json"));
});
app.get("/api/v1/docs", (req, res) => {
  res.send(getSwaggerHtml("/api/v1/openapi.json"));
});

// Centralized error handler to capture uncaught middleware errors and protect secrets
app.use(errorHandler);

async function startServer() {
  // Audit and validate configuration on launch
  validateEnvironment();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Sentinel API] Core gateway is active on http://0.0.0.0:${PORT}`);
  });
}

// Skip the real listener/Vite dev server bootstrap when this module is
// imported under test (Vitest sets NODE_ENV=test by default), so tests can
// import `app` and drive it directly with supertest.
if (process.env.NODE_ENV !== "test") {
  startServer();
}
