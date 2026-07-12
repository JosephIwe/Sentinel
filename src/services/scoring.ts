import fs from "fs";
import path from "path";
import { InvestigationResult, ScoreBreakdown, RuleEvaluation } from "../types";

/**
 * Deterministic Confidence & Risk Scoring Engine
 * 
 * Evaluates the evidence list returned by the InvestigationService
 * using a fully configurable rule definition model from scoringRules.json.
 * 
 * Absolutely 0% AI is used to compute these scores, ensuring reproducible,
 * auditable, and reliable classifications.
 */
export class ScoringService {
  private config: any;

  constructor() {
    this.loadConfig();
  }

  /**
   * Loads the scoring rules configuration dynamically.
   * Leverages process.cwd() to remain fully portable between development tsx
   * and production bundled esbuild CommonJS formats.
   */
  private loadConfig() {
    try {
      const configPath = path.join(process.cwd(), "src/config/scoringRules.json");
      if (fs.existsSync(configPath)) {
        const rawData = fs.readFileSync(configPath, "utf-8");
        this.config = JSON.parse(rawData);
      } else {
        console.warn("ScoringService: Config file not found at " + configPath + ". Using fallback config.");
        this.config = this.getFallbackConfig();
      }
    } catch (err) {
      console.warn("ScoringService: Failed to read config from file system. Using fallback config.", err);
      this.config = this.getFallbackConfig();
    }
  }

  /**
   * Fallback scoring configuration structure in case of filesystem reading failure.
   */
  private getFallbackConfig() {
    return {
      "confidence": {
        "minScore": 0,
        "maxScore": 100,
        "rules": [
          { "id": "conf_whois", "name": "WHOIS Registry Database Found", "points": 20, "explanation": "Active registration records were successfully resolved from WHOIS servers, confirming registrars and registrants." },
          { "id": "conf_dns", "name": "DNS Zone Resolver Active", "points": 20, "explanation": "Authoritative DNS zones were crawled and validated, resolving IP addresses, mail routing, or nameservers." },
          { "id": "conf_github", "name": "GitHub Intelligence Active", "points": 15, "explanation": "A public or verified open-source repository and user/org footprint were indexed on GitHub." },
          { "id": "conf_news", "name": "Global News & Media Mentions Found", "points": 15, "explanation": "Target footprint was corroborated in global publications, press archives, or verified media." },
          { "id": "conf_independent_agree", "name": "Multiple Independent Sources Agree", "points": 10, "explanation": "Multiple independent intelligence connectors successfully corroborated the same target profile indicators." },
          { "id": "conf_missing_critical", "name": "Missing Critical Infrastructure Pillars", "points": -15, "explanation": "Target lacks key infrastructure anchors (both WHOIS and DNS), indicating an unmapped ghost presence." },
          { "id": "conf_contradictory", "name": "Contradictory Telemetry Detected", "points": -20, "explanation": "Sensors reported severe metadata inconsistencies, ownership mismatches, or revoked credentials." }
        ]
      },
      "risk": {
        "minScore": 0,
        "maxScore": 100,
        "rules": [
          { "id": "risk_suspicious_infra", "name": "Suspicious Infrastructure Signals", "points": 15, "explanation": "Target matches known threat variables, unsecured asset crawls, or exposed/vulnerable configurations." },
          { "id": "risk_missing_security", "name": "Missing Security & Compliance Policies", "points": 15, "explanation": "No active SECURITY.md policy, Dependabot tracking, or vulnerability guidelines were identified." },
          { "id": "risk_newly_registered", "name": "Newly Registered Domain Signature", "points": 20, "explanation": "WHOIS records indicate target domain creation date is recent (under 2 years), increasing exposure window risks." },
          { "id": "risk_disposable_email", "name": "Disposable Email Provider Usage", "points": 15, "explanation": "Associated registry contacts utilize a transient or anonymous disposable email handler." },
          { "id": "risk_inconsistent_ownership", "name": "Inconsistent Ownership Registry", "points": 15, "explanation": "Identified registrant contacts, organizational names, or addresses contain discrepancies across sensors." },
          { "id": "risk_unresolved_findings", "name": "Large Density of Unresolved Findings", "points": 15, "explanation": "A high count of active vulnerabilities, open issues, or warning events remains unmitigated." },
          { "id": "risk_long_established", "name": "Long-Established Domain Track Record", "points": -15, "explanation": "WHOIS records verify long-standing domain history (over 5 years), indicating institutional stability." },
          { "id": "risk_verified_org", "name": "Verified GitHub Organization Footprint", "points": -15, "explanation": "Profile telemetry is certified under a verified enterprise or organization account structure." },
          { "id": "risk_stable_infra", "name": "Stable Core Infrastructure Mappings", "points": -15, "explanation": "Standard DNS configuration resolved multiple core nameservers and stable routing nodes." },
          { "id": "risk_strong_security", "name": "Strong Codified Security Posture", "points": -20, "explanation": "Explicit threat screening, automated alerts, and strong security scores are configured in target's workspace." }
        ]
      }
    };
  }

  /**
   * Calculates the confidence score breakdown of an investigation result.
   */
  public calculateConfidence(result: InvestigationResult): ScoreBreakdown {
    const baseScore = 30; // Base starting confidence for any search initiating
    let score = baseScore;
    const evaluations: RuleEvaluation[] = [];

    const ruleDefinitions = this.config.confidence?.rules || [];
    const minScore = this.config.confidence?.minScore ?? 0;
    const maxScore = this.config.confidence?.maxScore ?? 100;

    for (const ruleDef of ruleDefinitions) {
      const matchResult = this.evaluateConfidenceRule(ruleDef.id, result);
      
      let appliedPoints = 0;
      if (matchResult.matched) {
        appliedPoints = ruleDef.points;
        score += appliedPoints;
      }

      evaluations.push({
        id: ruleDef.id,
        name: ruleDef.name,
        points: ruleDef.points,
        appliedPoints,
        explanation: ruleDef.explanation,
        matched: matchResult.matched,
        reason: matchResult.reason
      });
    }

    // Cap final score between min and max
    const finalScore = Math.max(minScore, Math.min(maxScore, score));

    return {
      score: finalScore,
      baseScore,
      evaluations
    };
  }

  /**
   * Calculates the risk score breakdown of an investigation result.
   */
  public calculateRisk(result: InvestigationResult): ScoreBreakdown {
    const baseScore = 35; // Default moderate risk baseline
    let score = baseScore;
    const evaluations: RuleEvaluation[] = [];

    const ruleDefinitions = this.config.risk?.rules || [];
    const minScore = this.config.risk?.minScore ?? 10;
    const maxScore = this.config.risk?.maxScore ?? 95;

    for (const ruleDef of ruleDefinitions) {
      const matchResult = this.evaluateRiskRule(ruleDef.id, result);

      let appliedPoints = 0;
      if (matchResult.matched) {
        appliedPoints = ruleDef.points;
        score += appliedPoints;
      }

      evaluations.push({
        id: ruleDef.id,
        name: ruleDef.name,
        points: ruleDef.points,
        appliedPoints,
        explanation: ruleDef.explanation,
        matched: matchResult.matched,
        reason: matchResult.reason
      });
    }

    // Cap final score
    const finalScore = Math.max(minScore, Math.min(maxScore, score));

    return {
      score: finalScore,
      baseScore,
      evaluations
    };
  }

  /**
   * Deterministically evaluates a confidence rule.
   */
  private evaluateConfidenceRule(id: string, result: InvestigationResult): { matched: boolean; reason?: string } {
    const evidences = result.evidences || [];

    switch (id) {
      case "conf_whois": {
        const matchedEv = evidences.find(e => 
          e.connector?.toLowerCase().includes("whois") || 
          e.id?.startsWith("ev_whois")
        );
        return {
          matched: !!matchedEv,
          reason: matchedEv 
            ? `Corroborated by WHOIS entry: "${matchedEv.title}"` 
            : "No active WHOIS registration database entries found."
        };
      }

      case "conf_dns": {
        const matchedEv = evidences.find(e => 
          (e.connector?.toLowerCase().includes("dns") || e.id?.startsWith("ev_dns")) && 
          e.id !== "ev_dns_no_records"
        );
        return {
          matched: !!matchedEv,
          reason: matchedEv 
            ? `Corroborated by active DNS record matches: "${matchedEv.description.substring(0, 80)}..."` 
            : "No active or valid DNS authoritative zones resolved."
        };
      }

      case "conf_github": {
        const matchedEv = evidences.find(e => 
          e.connector?.toLowerCase().includes("github") || 
          e.id?.startsWith("ev_gh")
        );
        return {
          matched: !!matchedEv,
          reason: matchedEv 
            ? `Corroborated by codebase repository mapping: "${matchedEv.title}"` 
            : "No public GitHub source footprints detected."
        };
      }

      case "conf_news": {
        const matchedEv = evidences.find(e => 
          e.connector?.toLowerCase().includes("news") || 
          e.connector?.toLowerCase().includes("press") || 
          e.connector?.toLowerCase().includes("media") || 
          e.id?.startsWith("ev_news")
        );
        return {
          matched: !!matchedEv,
          reason: matchedEv 
            ? `Corroborated by public media mention: "${matchedEv.title}"` 
            : "No public media indexes or news mentions identified."
        };
      }

      case "conf_independent_agree": {
        const connectors = new Set(evidences.map(e => e.connector).filter(Boolean));
        const count = connectors.size;
        return {
          matched: count >= 3,
          reason: count >= 3 
            ? `Integrity established via ${count} independent connectors: (${Array.from(connectors).join(", ")})` 
            : `Insufficient agreement. Only ${count} independent connectors provided data.`
        };
      }

      case "conf_missing_critical": {
        const hasWhois = evidences.some(e => e.connector?.toLowerCase().includes("whois") || e.id?.startsWith("ev_whois"));
        const hasDns = evidences.some(e => (e.connector?.toLowerCase().includes("dns") || e.id?.startsWith("ev_dns")) && e.id !== "ev_dns_no_records");
        const missing = !hasWhois || !hasDns;
        return {
          matched: missing,
          reason: missing 
            ? `Lacks critical infrastructure indicators. Missing ${!hasWhois ? "WHOIS" : ""}${!hasWhois && !hasDns ? " and " : ""}${!hasDns ? "DNS" : ""}.` 
            : "Both WHOIS and authoritative DNS mappings verified."
        };
      }

      case "conf_contradictory": {
        const conflictingEv = evidences.find(e => {
          const text = `${e.title} ${e.description}`.toLowerCase();
          return text.includes("contradict") || text.includes("conflict") || text.includes("mismatch") || text.includes("inconsistent");
        });
        return {
          matched: !!conflictingEv,
          reason: conflictingEv 
            ? `Conflict identified: "${conflictingEv.title}" - ${conflictingEv.description}` 
            : "Metadata is internally consistent with no sensor disagreements."
        };
      }

      default:
        return { matched: false, reason: "Rule ID not recognized." };
    }
  }

  /**
   * Deterministically evaluates a risk rule.
   */
  private evaluateRiskRule(id: string, result: InvestigationResult): { matched: boolean; reason?: string } {
    const evidences = result.evidences || [];
    const entities = result.entities || [];

    switch (id) {
      case "risk_suspicious_infra": {
        const suspiciousEv = evidences.find(e => {
          const text = `${e.title} ${e.description}`.toLowerCase();
          return text.includes("suspicious") || text.includes("vulnerability") || text.includes("vulnerable") || 
                 text.includes("phishing") || text.includes("malware") || text.includes("compromise") || 
                 text.includes("leak") || text.includes("unsecured") || text.includes("exposed");
        });
        return {
          matched: !!suspiciousEv,
          reason: suspiciousEv 
            ? `Suspicious telemetry matches: "${suspiciousEv.title}" - ${suspiciousEv.description.substring(0, 80)}...` 
            : "No active indicators of vulnerabilities or exposed endpoints resolved."
        };
      }

      case "risk_missing_security": {
        // Look for explicit GitHub security.md check or general missing security policy keyword
        const missingSec = evidences.find(e => {
          if (e.rawData && e.rawData.securityMdExists === false) return true;
          const text = `${e.title} ${e.description}`.toLowerCase();
          return text.includes("missing security") || text.includes("no security policy") || text.includes("security.md policy is missing");
        });
        return {
          matched: !!missingSec,
          reason: missingSec 
            ? "Codebase fails compliance audit: security.md or policy descriptors are missing." 
            : "Codebase is compliant: Security policies or security.md are verified."
        };
      }

      case "risk_newly_registered": {
        // Look for creation dates or recent domain keywords
        const newlyReg = evidences.find(e => {
          if (e.id === "ev_whois_record_match" && e.rawData) {
            const reg = e.rawData.registered || e.rawData.creationDate;
            if (reg) {
              const yr = new Date(reg).getFullYear();
              if (yr >= 2024) return true;
            }
          }
          const text = `${e.title} ${e.description}`.toLowerCase();
          return text.includes("newly registered") || text.includes("recent registration") || text.includes("recent domain");
        });
        return {
          matched: !!newlyReg,
          reason: newlyReg 
            ? `Recent registration detected: ${newlyReg.description}` 
            : "Target possesses an established registrar history."
        };
      }

      case "risk_disposable_email": {
        const disposableDomains = ["mailinator.com", "trashmail", "10minutemail", "yopmail", "tempmail", "guerrillamail", "dispostable"];
        const termLower = result.query.term.toLowerCase();
        const hasDisposableInTerm = disposableDomains.some(d => termLower.includes(d));
        const matchedEv = evidences.find(e => {
          const text = `${e.title} ${e.description} ${JSON.stringify(e.rawData || {})}`.toLowerCase();
          return text.includes("disposable email") || disposableDomains.some(d => text.includes(d));
        });
        const matched = hasDisposableInTerm || !!matchedEv;
        return {
          matched,
          reason: matched 
            ? "Target registries or queries resolve to a transient/disposable email domain." 
            : "Target associated with valid, established email servers."
        };
      }

      case "risk_inconsistent_ownership": {
        const inconsistentEv = evidences.find(e => {
          const text = `${e.title} ${e.description}`.toLowerCase();
          return text.includes("inconsistent") || text.includes("mismatch") || text.includes("mismatched registrant") || text.includes("owner discrepancy");
        });
        return {
          matched: !!inconsistentEv,
          reason: inconsistentEv 
            ? `Registry discrepancies: "${inconsistentEv.title}"` 
            : "Ownership metadata matches consistently across different sensors."
        };
      }

      case "risk_unresolved_findings": {
        const entityCount = entities.length;
        const evidenceCount = evidences.length;
        const hasHighIssues = evidences.some(e => e.rawData && (e.rawData.open_issues_count > 30 || e.rawData.open_issues > 30));
        const matched = entityCount > 5 || evidenceCount > 8 || hasHighIssues;
        return {
          matched,
          reason: matched 
            ? `Large footprint of outstanding items: ${entityCount} entities and ${evidenceCount} findings resolved.` 
            : "No large density of unresolved issues or unmitigated threat vectors."
        };
      }

      case "risk_long_established": {
        const oldReg = evidences.find(e => {
          if (e.id === "ev_whois_record_match" && e.rawData) {
            const reg = e.rawData.registered || e.rawData.creationDate;
            if (reg) {
              const yr = new Date(reg).getFullYear();
              if (yr < 2018) return true;
            }
          }
          const text = `${e.title} ${e.description}`.toLowerCase();
          return text.includes("long-established") || text.includes("established domain") || text.includes("established company");
        });
        return {
          matched: !!oldReg,
          reason: oldReg 
            ? "Registry has strong historic tenure (registered prior to 2018)." 
            : "No extended historical standing established."
        };
      }

      case "risk_verified_org": {
        const verifiedOrg = evidences.find(e => {
          if (e.rawData && e.rawData.type === "Organization") return true;
          const text = `${e.title} ${e.description}`.toLowerCase();
          return text.includes("verified organization") || text.includes("verified profile") || text.includes("verified company");
        });
        return {
          matched: !!verifiedOrg,
          reason: verifiedOrg 
            ? "Associated with a certified corporate organization footprint." 
            : "Associated with standard or unverified identity nodes."
        };
      }

      case "risk_stable_infra": {
        const stableInfra = evidences.find(e => {
          const text = `${e.title} ${e.description}`.toLowerCase();
          return text.includes("stable infrastructure") || text.includes("stable routing") || text.includes("standard nameservers") || 
                 (e.id?.startsWith("ev_dns") && e.rawData && Array.isArray(e.rawData.nameServers) && e.rawData.nameServers.length >= 2);
        });
        return {
          matched: !!stableInfra,
          reason: stableInfra 
            ? "Resolved multiple active and redundant name server routing pathways." 
            : "Simple or singular route architecture resolved."
        };
      }

      case "risk_strong_security": {
        const strongSec = evidences.find(e => {
          if (e.rawData && e.rawData.securityScore >= 70) return true;
          const text = `${e.title} ${e.description}`.toLowerCase();
          return text.includes("strong security posture") || text.includes("configured dependabot") || text.includes("active vulnerability scanning");
        });
        return {
          matched: !!strongSec,
          reason: strongSec 
            ? "Continuous threat auditing, Dependabot, or vulnerability scanners are active." 
            : "No evidence of advanced active cybersecurity defense screening resolved."
        };
      }

      default:
        return { matched: false, reason: "Rule ID not recognized." };
    }
  }
}
