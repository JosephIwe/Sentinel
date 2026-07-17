import { describe, it, expect, vi } from "vitest";
import { IntelligenceService } from "../src/services/intelligence";
import { ScoringService } from "../src/services/scoring";
import { InvestigationResult, Evidence, Entity } from "../src/types";

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  const connector = overrides.connector ?? "Generic Connector";
  return {
    id: "ev_generic_01",
    connector,
    title: "Generic Finding",
    description: "A generic piece of evidence.",
    confidence: 80,
    timestamp: new Date().toISOString(),
    rawData: {},
    verified: true,
    strength: 0.9,
    source: connector,
    ...overrides,
  };
}

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "ent_generic_01",
    name: "generic-entity",
    type: "Domain",
    metadata: {},
    evidenceIds: [],
    ...overrides,
  };
}

function makeResult(overrides: Partial<InvestigationResult> = {}): InvestigationResult {
  return {
    query: { term: "acme-target.io", type: "Domain" },
    summary: "",
    entities: [],
    relationships: [],
    timeline: [],
    evidences: [],
    confidence: 80,
    sources: [],
    ...overrides,
  };
}

function makeFakeAiClient(responseText: string | null) {
  return {
    models: {
      generateContent: vi.fn().mockResolvedValue({ text: responseText }),
    },
  } as any;
}

function validAiResponsePayload(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    summary: "AI-synthesized summary.",
    executiveSummary: "AI-synthesized executive summary.",
    keyFindings: ["AI key finding one."],
    findings: [{ statement: "AI-sourced finding.", type: "AI Assessment", evidenceIds: [] }],
    riskScore: 40,
    confidence: 60,
    recommendations: ["Do the thing."],
    timeline: [{ date: "2026-01-01", event: "AI Event", description: "desc", source: "AI" }],
    ...overrides,
  });
}

describe("IntelligenceService.analyze", () => {
  it("falls back to the deterministic report when no AI client is available", async () => {
    const service = new IntelligenceService(null);
    const result = makeResult({
      entities: [makeEntity()],
      evidences: [makeEvidence({ id: "ev_whois_record_match", connector: "WHOIS Registry" })],
    });

    const report = await service.analyze(result);

    expect(report.validationReport).toBeDefined();
    expect(report.confidenceBreakdown).toBeDefined();
    expect(report.riskBreakdown).toBeDefined();

    // riskScore and the confidenceBreakdown are the raw ScoringService output
    // and pass through postValidate untouched; the top-level `confidence` is
    // then further adjusted by postValidate's hallucination penalty, so we
    // only assert it stays within its documented [12, 98] clamp range.
    const scoringService = new ScoringService();
    expect(report.confidenceBreakdown?.score).toBe(scoringService.calculateConfidence(result).score);
    expect(report.riskScore).toBe(scoringService.calculateRisk(result).score);
    expect(report.confidence).toBeGreaterThanOrEqual(12);
    expect(report.confidence).toBeLessThanOrEqual(98);
  });

  it("uses the Gemini response when it parses and matches the required schema", async () => {
    const aiClient = makeFakeAiClient(validAiResponsePayload());
    const service = new IntelligenceService(aiClient);
    const result = makeResult({
      entities: [makeEntity()],
      evidences: [makeEvidence({ id: "ev_whois_record_match", connector: "WHOIS Registry" })],
    });

    const report = await service.analyze(result);

    expect(aiClient.models.generateContent).toHaveBeenCalledTimes(1);
    expect(report.summary).toBe("AI-synthesized summary.");

    // Confidence/risk are always overwritten by the deterministic ScoringService,
    // regardless of what the AI proposed. riskScore and the breakdowns pass
    // through postValidate unmodified; top-level confidence is further
    // adjusted by postValidate's hallucination penalty (here, one AI finding
    // with no evidenceIds counts as an unsupported claim).
    const scoringService = new ScoringService();
    const expectedConfidence = scoringService.calculateConfidence(result).score;
    const expectedRisk = scoringService.calculateRisk(result).score;
    expect(report.confidenceBreakdown?.score).toBe(expectedConfidence);
    expect(report.riskScore).toBe(expectedRisk);
    expect(report.riskBreakdown?.score).toBe(expectedRisk);
    expect(report.confidence).toBe(expectedConfidence - 5);
  });

  it("falls back to the deterministic report when the Gemini response is not valid JSON", async () => {
    const aiClient = makeFakeAiClient("this is not json");
    const service = new IntelligenceService(aiClient);
    const result = makeResult();

    const report = await service.analyze(result);
    expect(aiClient.models.generateContent).toHaveBeenCalledTimes(1);
    expect(report.validationReport).toBeDefined();
    expect(report.confidence).toEqual(expect.any(Number));
  });

  it("falls back to the deterministic report when the Gemini response is missing required fields", async () => {
    const incomplete = JSON.stringify({ summary: "Only a summary, nothing else." });
    const aiClient = makeFakeAiClient(incomplete);
    const service = new IntelligenceService(aiClient);
    const result = makeResult();

    const report = await service.analyze(result);
    expect(aiClient.models.generateContent).toHaveBeenCalledTimes(1);
    expect(report.validationReport).toBeDefined();
    expect(report.confidence).toEqual(expect.any(Number));
  });

  it("falls back to the deterministic report when the Gemini response text is empty", async () => {
    const aiClient = makeFakeAiClient("");
    const service = new IntelligenceService(aiClient);
    const result = makeResult();

    const report = await service.analyze(result);
    expect(aiClient.models.generateContent).toHaveBeenCalledTimes(1);
    expect(report.validationReport).toBeDefined();
    expect(report.confidence).toEqual(expect.any(Number));
  });

  it("falls back to the deterministic report when the Gemini call throws", async () => {
    const aiClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue(new Error("network exploded")),
      },
    } as any;
    const service = new IntelligenceService(aiClient);
    const result = makeResult();

    const report = await service.analyze(result);
    expect(aiClient.models.generateContent).toHaveBeenCalledTimes(1);
    expect(report.validationReport).toBeDefined();
    expect(report.confidence).toEqual(expect.any(Number));
  });

  it("preValidates evidence before analysis, stripping mock/placeholder evidence from the mutated result", async () => {
    const service = new IntelligenceService(null);
    const result = makeResult({
      evidences: [
        makeEvidence({ id: "ev_real", connector: "WHOIS Registry" }),
        makeEvidence({ id: "ev_mock", title: "Simulated Placeholder Evidence" }),
      ],
    });

    await service.analyze(result);

    // analyze() mutates the passed-in result's evidences via preValidate.
    expect(result.evidences.map(e => e.id)).toEqual(["ev_real"]);
  });
});

describe("IntelligenceService.getDeterministicFallback", () => {
  const service = new IntelligenceService(null);

  it("produces a cautious report when there is no meaningful evidence", () => {
    const result = makeResult({ entities: [], evidences: [], confidence: 80 });
    const report = service.getDeterministicFallback(result);

    expect(report.summary).toContain("CAUTIOUS POSTURE");
    expect(report.executiveSummary).toContain("CAUTIOUS RECORD WARNING");
    expect(report.keyFindings).toHaveLength(3);
    expect(report.findings).toHaveLength(3);
    expect(report.findings?.every(f => f.type === "AI Assessment" && f.evidenceIds.length === 0)).toBe(true);
    expect(report.recommendations).toEqual([
      "Initiate manual out-of-band domain verification.",
      "Establish passive sentinel monitors in case the signature registers active records.",
      "Refrain from sending confidential parameters to this unverified signature.",
    ]);
  });

  it("treats a low overall confidence as mock/empty even with entities and evidence present", () => {
    const result = makeResult({
      entities: [makeEntity()],
      evidences: [makeEvidence({ connector: "WHOIS Registry" })],
      confidence: 10,
    });
    const report = service.getDeterministicFallback(result);
    expect(report.summary).toContain("CAUTIOUS POSTURE");
  });

  it("treats low-strength evidence as mock/empty", () => {
    const result = makeResult({
      entities: [makeEntity()],
      evidences: [makeEvidence({ strength: 0.1 })],
      confidence: 80,
    });
    const report = service.getDeterministicFallback(result);
    expect(report.summary).toContain("CAUTIOUS POSTURE");
  });

  it("produces a standard report and lists missing sensors when only some connectors returned data", () => {
    const result = makeResult({
      entities: [makeEntity()],
      evidences: [makeEvidence({ id: "ev_whois_record_match", connector: "WHOIS Registry" })],
      confidence: 80,
    });
    const report = service.getDeterministicFallback(result);

    expect(report.summary).toContain("Consolidated intelligence scan");
    expect(report.keyFindings.some(k => k.startsWith("Insufficient Evidence: No information was returned"))).toBe(true);
    expect(report.keyFindings.some(k => k.includes("DNS Zone Resolver"))).toBe(true);
    expect(report.keyFindings.some(k => k.includes("GitHub Indexer"))).toBe(true);
  });

  it("switches to the sparse-records message when every sensor category is active", () => {
    const result = makeResult({
      entities: [makeEntity()],
      evidences: [
        makeEvidence({ id: "ev_whois_record_match", connector: "WHOIS Registry" }),
        makeEvidence({ id: "ev_dns_a_record", connector: "DNS Resolver" }),
        makeEvidence({ id: "ev_gh_repo", connector: "GitHub Indexer" }),
        makeEvidence({ id: "ev_google_01", connector: "Google Search Indexer" }),
        makeEvidence({ id: "ev_news_01", connector: "News & Media Indexer" }),
      ],
      confidence: 80,
    });
    const report = service.getDeterministicFallback(result);

    expect(report.keyFindings.some(k => k.includes("micro-records are sparse"))).toBe(true);
    expect(report.keyFindings.some(k => k.startsWith("Insufficient Evidence: No information was returned"))).toBe(false);
  });

  it("extracts real DNS evidence into dedicated verified findings, excluding the no-records sentinel", () => {
    const result = makeResult({
      entities: [makeEntity()],
      evidences: [
        makeEvidence({ id: "ev_whois_record_match", connector: "WHOIS Registry" }),
        makeEvidence({ id: "ev_dns_a_record", connector: "DNS Resolver", title: "A Record Resolved", description: "1.2.3.4" }),
        makeEvidence({ id: "ev_dns_no_records", connector: "DNS Resolver", title: "No DNS Records", description: "none found" }),
      ],
      confidence: 80,
    });
    const report = service.getDeterministicFallback(result);

    // The dedicated per-DNS-record finding must reference only the real
    // record, never the no-records sentinel evidence.
    const dnsFindings = report.findings?.filter(f => f.statement.startsWith("[DNS Resolver]"));
    expect(dnsFindings).toHaveLength(1);
    expect(dnsFindings?.[0].evidenceIds).toEqual(["ev_dns_a_record"]);
    expect(report.keyFindings.some(k => k.includes("Verified Findings [DNS]"))).toBe(true);
  });

  it("falls back to a synthetic baseline timeline event when the investigation has none", () => {
    const result = makeResult({ entities: [makeEntity()], evidences: [makeEvidence()], timeline: [] });
    const report = service.getDeterministicFallback(result);
    expect(report.timeline).toHaveLength(1);
    expect(report.timeline[0].event).toBe("Baseline Discovery");
  });

  it("preserves the investigation's own timeline when present", () => {
    const ownTimeline = [{ date: "2025-01-01", event: "Custom Event", description: "d", source: "s" }];
    const result = makeResult({ entities: [makeEntity()], evidences: [makeEvidence()], timeline: ownTimeline });
    const report = service.getDeterministicFallback(result);
    expect(report.timeline).toEqual(ownTimeline);
  });

  it("wires the confidence and risk scores through from ScoringService", () => {
    const result = makeResult({
      entities: [makeEntity()],
      evidences: [makeEvidence({ id: "ev_whois_record_match", connector: "WHOIS Registry" })],
      confidence: 80,
    });
    const report = service.getDeterministicFallback(result);

    const scoringService = new ScoringService();
    expect(report.confidence).toBe(scoringService.calculateConfidence(result).score);
    expect(report.riskScore).toBe(scoringService.calculateRisk(result).score);
  });
});
