export interface ApiKey {
  id: string;
  name: string;
  secret: string; // e.g. "sn_live_..."
  status: "active" | "revoked";
  createdAt: string;
  lastUsedAt: string | null;
  requestCount: number;
  rateLimit: number; // requests/min
}

export interface User {
  id: string;
  email: string;
  name: string;
  companyName?: string;
  plan: "Free" | "Pro" | "Enterprise";
  createdAt: string;
}

export interface ExtractionJob {
  id: string;
  url?: string;
  rawText?: string;
  schemaType: string; // e.g. "Company Intelligence", "Product Pricing", "Press Release Extraction"
  schemaDefinition: string; // JSON string representing schema
  status: "completed" | "processing" | "failed";
  createdAt: string;
  tokensUsed: number;
  durationMs: number;
  result: any; // Raw JSON or custom structured data
}

export interface PlaygroundRequest {
  url?: string;
  rawText?: string;
  schemaType: string;
  schemaFields: Array<{ name: string; type: "string" | "number" | "boolean" | "array" | "object"; description: string }>;
}

export interface ApiMetrics {
  totalRequests: number;
  successRate: number; // percentage
  avgLatency: number; // ms
  p99Latency: number; // ms
  activeKeys: number;
  dataExtractedBytes: number;
}

// --- Investigation Engine Types ---

export interface InvestigationQuery {
  term: string;
  type?: "Domain" | "Organization" | "Person" | "IPAddress" | "Generic";
  options?: Record<string, any>;
}

export interface Evidence {
  id: string;
  source: string; // e.g. "WHOIS Database", "Google Search indexer"
  strength: number; // 0.0 to 1.0 (relevance/certainty multiplier)
  description: string;
  url?: string;
}

export interface Entity {
  id: string;
  name: string;
  type: string; // e.g. "Domain", "Organization", "Person", "IPAddress", "Repository", "Keyword"
  metadata: Record<string, any>;
}

export interface Relationship {
  source: string; // Entity name or ID
  target: string; // Entity name or ID
  type: string;   // e.g. "RESOLVES_TO", "OWNED_BY", "CONTRIBUTED_TO", "MENTIONED_IN"
  metadata?: Record<string, any>;
}

export interface TimelineEvent {
  date: string;
  event: string;
  description: string;
  source: string;
}

export interface ConnectorResult {
  connectorName: string;
  success: boolean;
  timestamp: string;
  entities: Entity[];
  relationships: Relationship[];
  timeline: TimelineEvent[];
  evidences: Evidence[];
  sources: string[];
  error?: string;
  rawData?: any;
}

export interface Connector {
  name: string;
  run(query: InvestigationQuery): Promise<ConnectorResult>;
}

export interface InvestigationResult {
  query: InvestigationQuery;
  summary: string;
  entities: Entity[];
  relationships: Relationship[];
  timeline: TimelineEvent[];
  evidences: Evidence[];
  confidence: number; // 0.0 to 1.0 (or percentage)
  sources: string[];
}

export interface IntelligenceReport {
  summary: string;
  executiveSummary: string;
  keyFindings: string[];
  riskScore: number;
  confidence: number;
  recommendations: string[];
  timeline: TimelineEvent[];
}
