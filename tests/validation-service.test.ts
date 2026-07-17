import { describe, it, expect } from "vitest";
import { HallucinationDetector, ValidationService } from "../src/services/validation";
import { InvestigationResult, Evidence, Entity, IntelligenceReport, IntelligenceFinding } from "../src/types";

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev_generic_01",
    connector: "Generic Connector",
    title: "Generic Finding",
    description: "A generic piece of evidence.",
    confidence: 80,
    timestamp: new Date().toISOString(),
    rawData: {},
    verified: true,
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
    query: { term: "example-corp.com", type: "Domain" },
    summary: "",
    entities: [],
    relationships: [],
    timeline: [],
    evidences: [],
    confidence: 0,
    sources: [],
    ...overrides,
  };
}

function makeReport(overrides: Partial<IntelligenceReport> = {}): IntelligenceReport {
  return {
    summary: "",
    executiveSummary: "",
    keyFindings: [],
    findings: [],
    riskScore: 20,
    confidence: 90,
    recommendations: [],
    timeline: [],
    ...overrides,
  };
}

describe("HallucinationDetector.detectHallucination", () => {
  const detector = new HallucinationDetector();

  it("flags an email address that was never surfaced in evidence", () => {
    const result = makeResult();
    const check = detector.detectHallucination("Contact them at unknown@nowhere-real.io for details.", result);
    expect(check.isHallucinated).toBe(true);
    expect(check.reason).toContain("unverified email");
  });

  it("accepts an email address that matches verified evidence", () => {
    const result = makeResult({
      evidences: [makeEvidence({ description: "Registrant contact: admin@example-corp.com" })],
    });
    const check = detector.detectHallucination("The registrant email is admin@example-corp.com.", result);
    expect(check.isHallucinated).toBe(false);
  });

  it("flags a domain never referenced anywhere in the investigation", () => {
    const result = makeResult();
    const check = detector.detectHallucination("The target also operates totally-unrelated-site.net.", result);
    expect(check.isHallucinated).toBe(true);
    expect(check.reason).toContain("unverified domain");
  });

  it("does not flag the query's own domain or common placeholder domains", () => {
    const result = makeResult({ query: { term: "example-corp.com", type: "Domain" } });
    expect(detector.detectHallucination("The primary domain is example-corp.com.", result).isHallucinated).toBe(false);
    expect(detector.detectHallucination("The reference site is placeholder.com for now.", result).isHallucinated).toBe(false);
  });

  it("flags a GitHub repository slug that was never discovered", () => {
    const result = makeResult({
      evidences: [makeEvidence({ description: "Found repo github.com/acme/core-services" })],
    });
    const check = detector.detectHallucination("Also maintains totally/unrelated-repo on GitHub.", result);
    expect(check.isHallucinated).toBe(true);
    expect(check.reason).toContain("unverified GitHub repository");
  });

  it("does not treat date-like fractions as repository slugs", () => {
    const result = makeResult();
    const check = detector.detectHallucination("The record was last updated on 07/12.", result);
    expect(check.isHallucinated).toBe(false);
  });

  it("accepts a repository slug backed by evidence", () => {
    const result = makeResult({
      evidences: [makeEvidence({ description: "Found repo github.com/acme/core-services" })],
    });
    const check = detector.detectHallucination("The maintainer's acme/core-services repository is active.", result);
    expect(check.isHallucinated).toBe(false);
  });

  it("flags an unverified proper noun not present in evidence, entities, or stopwords", () => {
    const result = makeResult({ entities: [makeEntity({ name: "Acme Corp", type: "Organization" })] });
    const check = detector.detectHallucination("Acme Corp partnered with Globex Dynamics last year.", result);
    expect(check.isHallucinated).toBe(true);
    expect(check.reason).toContain("Globex");
  });

  it("accepts a proper noun that matches a resolved entity name", () => {
    const result = makeResult({ entities: [makeEntity({ name: "Acme Corp", type: "Organization" })] });
    const check = detector.detectHallucination("Acme Corp is the resolved organization.", result);
    expect(check.isHallucinated).toBe(false);
  });

  it("accepts a proper noun found directly in an evidence title or description", () => {
    const result = makeResult({
      evidences: [makeEvidence({ title: "Cloudflare Nameserver Resolution", description: "Routed through Cloudflare edge nodes." })],
    });
    const check = detector.detectHallucination("The routing infrastructure relies on Cloudflare edge nodes.", result);
    expect(check.isHallucinated).toBe(false);
  });

  it("ignores common stopwords even when capitalized", () => {
    const result = makeResult();
    const check = detector.detectHallucination("The Domain has an Active Security posture.", result);
    expect(check.isHallucinated).toBe(false);
  });
});

describe("ValidationService.preValidate", () => {
  const service = new ValidationService();

  it("removes evidence missing an id, title, or description", () => {
    const result = makeResult({
      evidences: [
        makeEvidence({ id: "" }),
        makeEvidence({ title: "" }),
        makeEvidence({ description: "" }),
        makeEvidence({ id: "ev_ok" }),
      ],
    });
    const cleaned = service.preValidate(result);
    expect(cleaned.evidences).toHaveLength(1);
    expect(cleaned.evidences[0].id).toBe("ev_ok");
  });

  it("deduplicates evidence with the same connector/title/description or id", () => {
    const result = makeResult({
      evidences: [
        makeEvidence({ id: "ev_a", title: "Same Title", description: "Same description" }),
        makeEvidence({ id: "ev_b", title: "Same Title", description: "Same description" }),
        makeEvidence({ id: "ev_a", title: "Different", description: "Different desc" }),
      ],
    });
    const cleaned = service.preValidate(result);
    expect(cleaned.evidences).toHaveLength(1);
    expect(cleaned.evidences[0].id).toBe("ev_a");
  });

  it("filters out placeholder evidence", () => {
    const result = makeResult({
      evidences: [
        makeEvidence({ id: "ev_ph1", title: "TBD registration status" }),
        makeEvidence({ id: "ev_ph2", description: "Value is lorem ipsum for now" }),
        makeEvidence({ id: "ev_real" }),
      ],
    });
    const cleaned = service.preValidate(result);
    expect(cleaned.evidences.map(e => e.id)).toEqual(["ev_real"]);
  });

  it("filters out mock/simulated/sandbox evidence", () => {
    const result = makeResult({
      evidences: [
        makeEvidence({ id: "ev_mock1", title: "Simulated WHOIS Response" }),
        makeEvidence({ id: "ev_mock2", description: "Generated for example.com sandbox testing" }),
        makeEvidence({ id: "ev_real" }),
      ],
    });
    const cleaned = service.preValidate(result);
    expect(cleaned.evidences.map(e => e.id)).toEqual(["ev_real"]);
  });

  it("filters out evidence explicitly marked unverified", () => {
    const result = makeResult({
      evidences: [
        makeEvidence({ id: "ev_unverified", verified: false }),
        makeEvidence({ id: "ev_real", verified: true }),
      ],
    });
    const cleaned = service.preValidate(result);
    expect(cleaned.evidences.map(e => e.id)).toEqual(["ev_real"]);
  });

  it("strips references to removed evidence ids from entities and relationships", () => {
    const result = makeResult({
      evidences: [makeEvidence({ id: "ev_kept" }), makeEvidence({ id: "ev_removed", verified: false })],
      entities: [makeEntity({ evidenceIds: ["ev_kept", "ev_removed"] })],
      relationships: [{ source: "a", target: "b", type: "OWNED_BY", evidenceIds: ["ev_kept", "ev_removed"] }],
    });
    const cleaned = service.preValidate(result);
    expect(cleaned.entities[0].evidenceIds).toEqual(["ev_kept"]);
    expect(cleaned.relationships[0].evidenceIds).toEqual(["ev_kept"]);
  });
});

describe("ValidationService.postValidate", () => {
  const service = new ValidationService();

  it("marks findings with no evidenceIds as unsupported claims", () => {
    const result = makeResult({ evidences: [makeEvidence({ id: "ev_a" })] });
    const finding: IntelligenceFinding = { statement: "Unsupported statement.", type: "AI Assessment", evidenceIds: [] };
    const report = makeReport({ findings: [finding] });

    const { report: updated, validationReport } = service.postValidate(result, report);
    expect(validationReport.unsupportedClaims).toEqual(["Unsupported statement."]);
    expect(updated.findings?.[0].statement).toBe("Insufficient verified evidence.");
  });

  it("marks findings referencing a nonexistent evidence id as unsupported claims", () => {
    const result = makeResult({ evidences: [makeEvidence({ id: "ev_a" })] });
    const finding: IntelligenceFinding = { statement: "Ghost evidence claim.", type: "AI Assessment", evidenceIds: ["ev_does_not_exist"] };
    const report = makeReport({ findings: [finding] });

    const { validationReport } = service.postValidate(result, report);
    expect(validationReport.unsupportedClaims).toContain("Ghost evidence claim.");
  });

  it("keeps well-supported, non-hallucinated findings and counts them as verified", () => {
    const result = makeResult({
      evidences: [makeEvidence({ id: "ev_a", description: "Domain example-corp.com is active." })],
    });
    const finding: IntelligenceFinding = { statement: "The domain example-corp.com is active.", type: "Verified Finding", evidenceIds: ["ev_a"] };
    const report = makeReport({ findings: [finding] });

    const { report: updated, validationReport } = service.postValidate(result, report);
    expect(validationReport.verifiedStatementsCount).toBe(1);
    expect(updated.findings?.[0].statement).toBe("The domain example-corp.com is active.");
  });

  it("removes a supported-but-hallucinated finding into removedHallucinations", () => {
    const result = makeResult({ evidences: [makeEvidence({ id: "ev_a" })] });
    const finding: IntelligenceFinding = {
      statement: "Partnered with Globex Dynamics on infrastructure.",
      type: "AI Assessment",
      evidenceIds: ["ev_a"],
    };
    const report = makeReport({ findings: [finding] });

    const { report: updated, validationReport } = service.postValidate(result, report);
    expect(validationReport.removedHallucinations.length).toBe(1);
    expect(updated.findings).toHaveLength(0);
  });

  it("removes hallucinated key findings", () => {
    const result = makeResult();
    const report = makeReport({ keyFindings: ["Globex Dynamics was formally acquired."] });

    const { report: updated, validationReport } = service.postValidate(result, report);
    expect(validationReport.removedHallucinations.length).toBe(1);
    expect(updated.keyFindings).toHaveLength(0);
  });

  it("strips hallucinated sentences out of the executive summary", () => {
    const result = makeResult({ query: { term: "example-corp.com", type: "Domain" } });
    const report = makeReport({
      executiveSummary: "The target example-corp.com is stable. It recently merged with Globex Dynamics.",
    });

    const { report: updated } = service.postValidate(result, report);
    expect(updated.executiveSummary).toContain("example-corp.com is stable");
    expect(updated.executiveSummary).not.toContain("Globex Dynamics");
  });

  it("in grounded mode, drops executive summary sentences that don't cite an evidence id", () => {
    const result = makeResult({
      query: { term: "example-corp.com", type: "Domain", options: { grounded: true } },
      evidences: [makeEvidence({ id: "ev_dns_01" })],
    });
    const report = makeReport({
      executiveSummary: "resolved via ev_dns_01 confirmation. general commentary follows without any citation.",
    });

    const { report: updated } = service.postValidate(result, report);
    expect(updated.executiveSummary).toContain("ev_dns_01");
    expect(updated.executiveSummary).not.toContain("general commentary");
  });

  it("replaces a hallucinated main summary with a generic fallback sentence", () => {
    const result = makeResult({ query: { term: "example-corp.com", type: "Domain" } });
    const report = makeReport({ summary: "Discovered a secret partnership with Globex Dynamics." });

    const { report: updated, validationReport } = service.postValidate(result, report);
    expect(updated.summary).toContain("dual-sensor validation");
    expect(validationReport.removedHallucinations.some(r => r.startsWith("[Summary]"))).toBe(true);
  });

  it("in grounded mode, keeps only main-summary sentences that cite an evidence id", () => {
    const result = makeResult({
      query: { term: "example-corp.com", type: "Domain", options: { grounded: true } },
      evidences: [makeEvidence({ id: "ev_dns_01" })],
    });
    const report = makeReport({ summary: "confirmed via ev_dns_01 citation. unrelated filler sentence with no citation." });

    const { report: updated } = service.postValidate(result, report);
    expect(updated.summary).toContain("ev_dns_01");
    expect(updated.summary).not.toContain("unrelated filler");
  });

  it("in grounded mode, falls back to a generic cited summary when every sentence lacks a citation", () => {
    const result = makeResult({
      query: { term: "example-corp.com", type: "Domain", options: { grounded: true } },
      evidences: [makeEvidence({ id: "ev_dns_01" })],
    });
    const report = makeReport({ summary: "This sentence cites nothing at all." });

    const { report: updated } = service.postValidate(result, report);
    expect(updated.summary).toContain("Threat intelligence mapping completed");
    expect(updated.summary).toContain("ev_dns_01");
  });

  it("scores validationScore as 100 when there are no findings to evaluate", () => {
    const result = makeResult();
    const report = makeReport({ findings: [] });
    const { validationReport } = service.postValidate(result, report);
    expect(validationReport.validationScore).toBe(100);
  });

  it("computes validationScore as the ratio of verified to total evaluated statements", () => {
    const result = makeResult({ evidences: [makeEvidence({ id: "ev_a" })] });
    const findings: IntelligenceFinding[] = [
      { statement: "Verified claim about example-corp.com.", type: "Verified Finding", evidenceIds: ["ev_a"] },
      { statement: "Unsupported claim.", type: "AI Assessment", evidenceIds: [] },
    ];
    const report = makeReport({ findings });

    const { validationReport } = service.postValidate(result, report);
    // 1 verified out of 2 total evaluated statements (1 verified + 1 unsupported) = 50%
    expect(validationReport.validationScore).toBe(50);
  });

  it("applies a confidence penalty of 8 per hallucination and 5 per unsupported claim, clamped to [12, 98]", () => {
    const result = makeResult({ evidences: [makeEvidence({ id: "ev_a" })] });
    const findings: IntelligenceFinding[] = [
      { statement: "Globex Dynamics deal disclosed.", type: "AI Assessment", evidenceIds: ["ev_a"] }, // hallucination: -8
      { statement: "Another unsupported claim.", type: "AI Assessment", evidenceIds: [] }, // unsupported: -5
    ];
    const report = makeReport({ findings, confidence: 90 });

    const { report: updated, validationReport } = service.postValidate(result, report);
    expect(validationReport.confidenceAdjustment).toBe(-13);
    expect(updated.confidence).toBe(77);
  });

  it("clamps the adjusted confidence to a minimum of 12", () => {
    const result = makeResult({ evidences: [makeEvidence({ id: "ev_a" })] });
    const manyHallucinations: IntelligenceFinding[] = Array.from({ length: 15 }, (_, i) => ({
      statement: `Globex Dynamics claim number ${i}.`,
      type: "AI Assessment" as const,
      evidenceIds: ["ev_a"],
    }));
    const report = makeReport({ findings: manyHallucinations, confidence: 90 });

    const { report: updated } = service.postValidate(result, report);
    expect(updated.confidence).toBe(12);
  });

  it("computes evidenceCoverage as the share of evidence ids actually used by surviving findings", () => {
    const result = makeResult({
      evidences: [makeEvidence({ id: "ev_a" }), makeEvidence({ id: "ev_b" })],
    });
    const findings: IntelligenceFinding[] = [
      { statement: "confirmed reference to example-corp.com in evidence.", type: "Verified Finding", evidenceIds: ["ev_a"] },
    ];
    const report = makeReport({ findings });

    const { validationReport } = service.postValidate(result, report);
    expect(validationReport.evidenceCoverage).toBe(50);
  });
});
