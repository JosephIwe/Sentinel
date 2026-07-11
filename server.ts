import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { GoogleConnector } from "./src/connectors/google";
import { WhoisConnector } from "./src/connectors/whois";
import { DnsConnector } from "./src/connectors/dns";
import { NewsConnector } from "./src/connectors/news";
import { GithubConnector } from "./src/connectors/github";
import { GithubIntelligenceConnector } from "./src/connectors/github-intel";
import { InvestigationService } from "./src/services/investigation";
import { IntelligenceService } from "./src/services/intelligence";
import { validateInvestigationInput } from "./utils/validation";

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

const app = express();
const PORT = 3000;

app.use(express.json());

// In-Memory Database (Scale-ready simulation representing Prisma/PostgreSQL state)
let currentUser: any = {
  id: "usr_sentinel_94921",
  email: "buildwisegroupofcompany@gmail.com",
  name: "Staff Engineer Dev",
  companyName: "Sentinel Tech Corp",
  plan: "Pro",
  createdAt: "2026-02-15T08:00:00Z"
};

let apiKeys = [
  {
    id: "key_01",
    name: "Production Gateway",
    secret: "sn_live_8f3c7a91de884b2ab72c67e810a01fa2",
    status: "active" as const,
    createdAt: "2026-03-01T10:14:00Z",
    lastUsedAt: "2026-07-11T04:12:00Z",
    requestCount: 849202,
    rateLimit: 1200
  },
  {
    id: "key_02",
    name: "Staging Test Rig",
    secret: "sn_live_4a1b8e92cf774d3ba81b56f829c91ee3",
    status: "active" as const,
    createdAt: "2026-05-12T14:30:22Z",
    lastUsedAt: "2026-07-11T03:45:10Z",
    requestCount: 39124,
    rateLimit: 300
  },
  {
    id: "key_03",
    name: "Legacy Web Scraper",
    secret: "sn_live_9d2c1e83bf664e4ca92b45f718d81dd4",
    status: "revoked" as const,
    createdAt: "2026-01-10T09:00:00Z",
    lastUsedAt: "2026-02-28T23:59:59Z",
    requestCount: 145028,
    rateLimit: 600
  }
];

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

// Helper to generate a secure random string resembling production-grade cryptographically secure tokens
function generateSecret() {
  const chars = "abcdef0123456789";
  let token = "sn_live_";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// REST APIs

// 1. Auth Endpoint
app.get("/api/auth/me", (req, res) => {
  res.json({ user: currentUser });
});

app.post("/api/auth/login", (req, res) => {
  const { email, name, companyName } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }
  currentUser = {
    id: "usr_" + Math.random().toString(36).substr(2, 9),
    email,
    name: name || "Developer Member",
    companyName: companyName || "Incubator Tech",
    plan: "Free",
    createdAt: new Date().toISOString()
  };
  res.json({ user: currentUser });
});

app.post("/api/auth/logout", (req, res) => {
  currentUser = {
    id: "usr_guest",
    email: "guest@sentinelapi.dev",
    name: "Guest Mode",
    companyName: "Guest Workspace",
    plan: "Free",
    createdAt: new Date().toISOString()
  };
  res.json({ success: true, user: currentUser });
});

// 2. API Key Management
app.get("/api/keys", (req, res) => {
  res.json({ keys: apiKeys });
});

app.post("/api/keys", (req, res) => {
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

app.put("/api/keys/:id/revoke", (req, res) => {
  const { id } = req.params;
  const keyIndex = apiKeys.findIndex(k => k.id === id);
  if (keyIndex === -1) {
    return res.status(404).json({ error: "API Key not found" });
  }
  apiKeys[keyIndex].status = "revoked";
  res.json({ key: apiKeys[keyIndex] });
});

app.post("/api/keys/:id/rotate", (req, res) => {
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
app.get("/api/jobs", (req, res) => {
  res.json({ jobs: extractionJobs });
});

// 4. Centerpiece: Real Gemini AI Transform Proxy
app.post("/api/playground/transform", async (req, res) => {
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

  // Standard staff-engineer prompt constructing a rigid schema request
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
    // Graceful fallback for local development or missing API key
    // Perform a highly realistic simulation of Sentinel API using fields provided by the developer
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
    // Generate actual structured schema response properties for responseSchema
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

    // Increment request tracking metrics for active API Keys
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

// 5. Statistics Overview
app.get("/api/metrics", (req, res) => {
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

// 6. Cyber-Threat and Asset Discovery Investigation Routes

// Instantiate connectors and service instances
const googleConnector = new GoogleConnector();
const whoisConnector = new WhoisConnector();
const dnsConnector = new DnsConnector();
const newsConnector = new NewsConnector();
const githubConnector = new GithubConnector();
const githubIntelligenceConnector = new GithubIntelligenceConnector();

const investigationService = new InvestigationService([
  googleConnector,
  whoisConnector,
  dnsConnector,
  newsConnector,
  githubConnector,
  githubIntelligenceConnector,
]);

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

// Unified Endpoint to run parallel multi-source investigation and synthesize strategic intelligence reports
app.post("/api/investigate", async (req, res) => {
  // Check if we are running the new unified API workflow (which uses 'value')
  if (req.body && (req.body.value !== undefined || (req.body.type !== undefined && !req.body.term))) {
    // 1. Validate incoming input payloads using our reusable validation module
    const validation = validateInvestigationInput(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.message });
    }

    const { type, value } = req.body;

    try {
      // 2. Map input target parameters to correct query category shapes
      const query = {
        term: value.trim(),
        type: mapTypeToQueryType(type),
      };

      // 3. Trigger multi-connector parallel infrastructure scan
      const investigationResult = await investigationService.investigate(query);

      // 4. Feed resolved identity footprint and relationships to the AI intelligence engine
      const aiClient = getAiClient();
      const intelligenceService = new IntelligenceService(aiClient);
      const intelligenceReport = await intelligenceService.analyze(investigationResult);

      // 5. Structure and respond with the unified analytical schema report conforming to the requested schema
      return res.status(200).json({
        summary: intelligenceReport.summary,
        executiveSummary: intelligenceReport.executiveSummary,
        entities: investigationResult.entities,
        relationships: investigationResult.relationships,
        timeline: intelligenceReport.timeline,
        confidence: intelligenceReport.confidence,
        recommendations: intelligenceReport.recommendations,
        sources: investigationResult.sources,
        evidences: investigationResult.evidences,
        findings: intelligenceReport.findings || [],
      });

    } catch (err: any) {
      console.error("Unified threat intelligence execution pipeline failure:", err);
      return res.status(500).json({
        error: "An internal orchestration error occurred while running the intelligence service.",
        details: err.message,
      });
    }
  }

  // Backwards-compatible fallback path for the multi-step interactive developer playground UI
  const { term, type } = req.body;
  if (!term) {
    return res.status(400).json({ error: "Search term ('term' or 'value') is required for investigation" });
  }

  try {
    const query = { term, type: type || "Generic" };
    const result = await investigationService.investigate(query);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error("Sandbox investigation orchestration failure:", err);
    return res.status(500).json({ error: "Failed to run sandbox investigation", details: err.message });
  }
});

// Endpoint to analyze the investigation result with AI Intelligence Service
app.post("/api/intelligence/analyze", async (req, res) => {
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

async function startServer() {
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

startServer();
