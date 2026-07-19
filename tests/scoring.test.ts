import { describe, it, expect } from "vitest";
import { ScoringService } from "../src/services/scoring";
import { InvestigationResult, Evidence, Entity } from "../src/types";

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "ev_generic_01",
    connector: "Generic Connector",
    title: "Generic Finding",
    description: "A generic piece of evidence.",
    confidence: 80,
    timestamp: new Date().toISOString(),
    rawData: {},
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
    query: { term: "example.com", type: "Domain" },
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

describe("ScoringService", () => {
  const service = new ScoringService();

  describe("calculateConfidence", () => {
    it("returns only the base score when there is no evidence", () => {
      const breakdown = service.calculateConfidence(makeResult());
      expect(breakdown.baseScore).toBe(30);
      // conf_missing_critical fires (no WHOIS, no DNS): 30 - 15 = 15
      expect(breakdown.score).toBe(15);
      expect(breakdown.evaluations.find(e => e.id === "conf_missing_critical")?.matched).toBe(true);
    });

    it("applies conf_whois when a WHOIS-sourced evidence entry is present", () => {
      const result = makeResult({
        evidences: [makeEvidence({ id: "ev_whois_record_match", connector: "WHOIS Registry" })],
      });
      const breakdown = service.calculateConfidence(result);
      const rule = breakdown.evaluations.find(e => e.id === "conf_whois");
      expect(rule?.matched).toBe(true);
      expect(rule?.appliedPoints).toBe(20);
    });

    it("applies conf_whois but ignores the ev_whois_fallback sentinel (failed lookup)", () => {
      const fallbackOnly = makeResult({
        evidences: [makeEvidence({ id: "ev_whois_fallback", connector: "WHOIS Registry Resolver" })],
      });
      const fallback = service.calculateConfidence(fallbackOnly);
      expect(fallback.evaluations.find(e => e.id === "conf_whois")?.matched).toBe(false);

      const realMatch = makeResult({
        evidences: [makeEvidence({ id: "ev_whois_record_match", connector: "WHOIS Registry Resolver" })],
      });
      const real = service.calculateConfidence(realMatch);
      expect(real.evaluations.find(e => e.id === "conf_whois")?.matched).toBe(true);
    });

    it("applies conf_dns but ignores the ev_dns_no_records sentinel", () => {
      const noRecordsResult = makeResult({
        evidences: [makeEvidence({ id: "ev_dns_no_records", connector: "DNS Resolver" })],
      });
      const noRecords = service.calculateConfidence(noRecordsResult);
      expect(noRecords.evaluations.find(e => e.id === "conf_dns")?.matched).toBe(false);

      const withRecordsResult = makeResult({
        evidences: [makeEvidence({ id: "ev_dns_a_record", connector: "DNS Resolver", description: "Resolved A record 1.2.3.4" })],
      });
      const withRecords = service.calculateConfidence(withRecordsResult);
      expect(withRecords.evaluations.find(e => e.id === "conf_dns")?.matched).toBe(true);
    });

    it("applies conf_github and conf_news independently based on connector name", () => {
      const result = makeResult({
        evidences: [
          makeEvidence({ id: "ev_gh_repo", connector: "GitHub Intel" }),
          makeEvidence({ id: "ev_news_01", connector: "Global News Wire" }),
        ],
      });
      const breakdown = service.calculateConfidence(result);
      expect(breakdown.evaluations.find(e => e.id === "conf_github")?.matched).toBe(true);
      expect(breakdown.evaluations.find(e => e.id === "conf_news")?.matched).toBe(true);
    });

    it("requires at least 3 distinct connectors for conf_independent_agree", () => {
      const twoConnectors = makeResult({
        evidences: [
          makeEvidence({ connector: "WHOIS Registry" }),
          makeEvidence({ connector: "DNS Resolver" }),
        ],
      });
      expect(service.calculateConfidence(twoConnectors).evaluations.find(e => e.id === "conf_independent_agree")?.matched).toBe(false);

      const threeConnectors = makeResult({
        evidences: [
          makeEvidence({ connector: "WHOIS Registry" }),
          makeEvidence({ connector: "DNS Resolver" }),
          makeEvidence({ connector: "GitHub Intel" }),
        ],
      });
      expect(service.calculateConfidence(threeConnectors).evaluations.find(e => e.id === "conf_independent_agree")?.matched).toBe(true);
    });

    it("applies conf_missing_critical only when WHOIS or DNS is absent", () => {
      const bothPresent = makeResult({
        evidences: [
          makeEvidence({ id: "ev_whois_record_match", connector: "WHOIS Registry" }),
          makeEvidence({ id: "ev_dns_a_record", connector: "DNS Resolver" }),
        ],
      });
      expect(service.calculateConfidence(bothPresent).evaluations.find(e => e.id === "conf_missing_critical")?.matched).toBe(false);
    });

    it("treats a failed WHOIS lookup (ev_whois_fallback) as missing, not present, for conf_missing_critical", () => {
      const failedWhoisOnly = makeResult({
        evidences: [
          makeEvidence({ id: "ev_whois_fallback", connector: "WHOIS Registry Resolver" }),
          makeEvidence({ id: "ev_dns_a_record", connector: "DNS Resolver" }),
        ],
      });
      expect(service.calculateConfidence(failedWhoisOnly).evaluations.find(e => e.id === "conf_missing_critical")?.matched).toBe(true);
    });

    it("applies conf_contradictory when evidence text signals conflict", () => {
      const result = makeResult({
        evidences: [makeEvidence({ title: "Registrant Mismatch", description: "Contradictory ownership records detected." })],
      });
      const breakdown = service.calculateConfidence(result);
      expect(breakdown.evaluations.find(e => e.id === "conf_contradictory")?.matched).toBe(true);
    });

    it("clamps the final score to the configured max", () => {
      const result = makeResult({
        evidences: [
          makeEvidence({ id: "ev_whois_record_match", connector: "WHOIS Registry" }),
          makeEvidence({ id: "ev_dns_a_record", connector: "DNS Resolver" }),
          makeEvidence({ id: "ev_gh_repo", connector: "GitHub Intel" }),
          makeEvidence({ id: "ev_news_01", connector: "Global News" }),
        ],
      });
      // 30 base + 20 + 20 + 15 + 15 + 10 (independent agree, 4 connectors) = 110, clamped to 100
      const breakdown = service.calculateConfidence(result);
      expect(breakdown.score).toBe(100);
    });

    it("clamps the final score to the configured min", () => {
      const result = makeResult({
        evidences: [makeEvidence({ title: "Mismatch", description: "Contradictory conflict inconsistent mismatch." })],
      });
      // 30 base - 15 (missing critical) - 20 (contradictory) = -5, clamped to 0
      const breakdown = service.calculateConfidence(result);
      expect(breakdown.score).toBe(0);
    });
  });

  describe("calculateRisk", () => {
    it("returns only the base score when there is no evidence or entities", () => {
      const breakdown = service.calculateRisk(makeResult());
      expect(breakdown.baseScore).toBe(35);
      expect(breakdown.score).toBe(35);
      breakdown.evaluations.forEach(e => expect(e.matched).toBe(false));
    });

    it("flags risk_suspicious_infra on keyword match", () => {
      const result = makeResult({
        evidences: [makeEvidence({ title: "Exposed Endpoint", description: "Vulnerable and unsecured configuration found." })],
      });
      expect(service.calculateRisk(result).evaluations.find(e => e.id === "risk_suspicious_infra")?.matched).toBe(true);
    });

    it("flags risk_missing_security from rawData flag or keyword text", () => {
      const viaRawData = makeResult({
        evidences: [makeEvidence({ rawData: { securityMdExists: false } })],
      });
      expect(service.calculateRisk(viaRawData).evaluations.find(e => e.id === "risk_missing_security")?.matched).toBe(true);

      const viaText = makeResult({
        evidences: [makeEvidence({ description: "No security policy configured for this repository." })],
      });
      expect(service.calculateRisk(viaText).evaluations.find(e => e.id === "risk_missing_security")?.matched).toBe(true);
    });

    it("flags risk_newly_registered for WHOIS creation dates in or after 2024", () => {
      const recent = makeResult({
        evidences: [makeEvidence({ id: "ev_whois_record_match", rawData: { registered: "2024-06-01" } })],
      });
      expect(service.calculateRisk(recent).evaluations.find(e => e.id === "risk_newly_registered")?.matched).toBe(true);

      const old = makeResult({
        evidences: [makeEvidence({ id: "ev_whois_record_match", rawData: { registered: "2010-06-01" } })],
      });
      expect(service.calculateRisk(old).evaluations.find(e => e.id === "risk_newly_registered")?.matched).toBe(false);
    });

    it("flags risk_disposable_email from the query term or evidence content", () => {
      const viaTerm = makeResult({ query: { term: "user@mailinator.com", type: "Generic" } });
      expect(service.calculateRisk(viaTerm).evaluations.find(e => e.id === "risk_disposable_email")?.matched).toBe(true);

      const viaEvidence = makeResult({
        evidences: [makeEvidence({ description: "Registry contact uses a disposable email provider." })],
      });
      expect(service.calculateRisk(viaEvidence).evaluations.find(e => e.id === "risk_disposable_email")?.matched).toBe(true);
    });

    it("flags risk_inconsistent_ownership on discrepancy keywords", () => {
      const result = makeResult({
        evidences: [makeEvidence({ description: "Owner discrepancy across registrant records." })],
      });
      expect(service.calculateRisk(result).evaluations.find(e => e.id === "risk_inconsistent_ownership")?.matched).toBe(true);
    });

    it("flags risk_unresolved_findings when entity/evidence density or open issue counts are high", () => {
      const manyEntities = makeResult({
        entities: Array.from({ length: 6 }, (_, i) => makeEntity({ id: `ent_${i}` })),
      });
      expect(service.calculateRisk(manyEntities).evaluations.find(e => e.id === "risk_unresolved_findings")?.matched).toBe(true);

      const manyEvidences = makeResult({
        evidences: Array.from({ length: 9 }, (_, i) => makeEvidence({ id: `ev_${i}` })),
      });
      expect(service.calculateRisk(manyEvidences).evaluations.find(e => e.id === "risk_unresolved_findings")?.matched).toBe(true);

      const highIssueCount = makeResult({
        evidences: [makeEvidence({ rawData: { open_issues_count: 31 } })],
      });
      expect(service.calculateRisk(highIssueCount).evaluations.find(e => e.id === "risk_unresolved_findings")?.matched).toBe(true);

      const lowDensity = makeResult({
        entities: [makeEntity()],
        evidences: [makeEvidence()],
      });
      expect(service.calculateRisk(lowDensity).evaluations.find(e => e.id === "risk_unresolved_findings")?.matched).toBe(false);
    });

    it("flags risk_long_established for WHOIS creation dates before 2018", () => {
      const result = makeResult({
        evidences: [makeEvidence({ id: "ev_whois_record_match", rawData: { registered: "2005-01-01" } })],
      });
      expect(service.calculateRisk(result).evaluations.find(e => e.id === "risk_long_established")?.matched).toBe(true);
    });

    it("flags risk_verified_org when rawData marks an Organization type", () => {
      const result = makeResult({
        evidences: [makeEvidence({ rawData: { type: "Organization" } })],
      });
      expect(service.calculateRisk(result).evaluations.find(e => e.id === "risk_verified_org")?.matched).toBe(true);
    });

    it("flags risk_stable_infra when DNS evidence resolves multiple nameservers", () => {
      const result = makeResult({
        evidences: [makeEvidence({ id: "ev_dns_ns", rawData: { nameServers: ["ns1.example.com", "ns2.example.com"] } })],
      });
      expect(service.calculateRisk(result).evaluations.find(e => e.id === "risk_stable_infra")?.matched).toBe(true);
    });

    it("flags risk_strong_security when rawData securityScore is at least 70", () => {
      const result = makeResult({
        evidences: [makeEvidence({ rawData: { securityScore: 85 } })],
      });
      expect(service.calculateRisk(result).evaluations.find(e => e.id === "risk_strong_security")?.matched).toBe(true);
    });

    it("clamps the final risk score to the configured min and max", () => {
      const allNegative = makeResult({
        evidences: [
          makeEvidence({ id: "ev_whois_record_match", rawData: { registered: "2005-01-01" } }),
          makeEvidence({ rawData: { type: "Organization" } }),
          makeEvidence({ id: "ev_dns_ns", rawData: { nameServers: ["ns1.example.com", "ns2.example.com"] } }),
          makeEvidence({ rawData: { securityScore: 90 } }),
        ],
      });
      // 35 base - 15 - 15 - 15 - 20 = -30, clamped to configured min (0)
      expect(service.calculateRisk(allNegative).score).toBe(0);
    });
  });
});
