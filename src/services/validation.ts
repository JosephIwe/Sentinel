import { InvestigationResult, IntelligenceReport, Evidence, Entity, Relationship, TimelineEvent, IntelligenceFinding } from "../types";

export interface ValidationReport {
  validationScore: number;
  verifiedStatementsCount: number;
  removedStatementsCount: number;
  evidenceCoverage: number;
  verifiedStatements: string[];
  removedHallucinations: string[];
  unsupportedClaims: string[];
  confidenceAdjustment: number;
}

/**
 * Hallucination Detector
 * 
 * Compares AI generated output against canonical entities and verified evidence IDs to identify and prevent hallucinations.
 */
export class HallucinationDetector {
  private stopWords = new Set([
    "the", "this", "that", "these", "those", "their", "our", "its", "your", "his", "her",
    "and", "but", "for", "with", "from", "into", "onto", "upon", "about", "above", "below",
    "has", "had", "have", "was", "were", "been", "are", "not", "yes", "can", "may", "will",
    "would", "should", "could", "shall", "must", "than", "then", "thus", "therefore",
    "sentinel", "intelligence", "verified", "finding", "findings", "ai", "assessment",
    "report", "target", "analyst", "review", "confidential", "active", "completed"
  ]);

  /**
   * Helper to extract all emails, domains, and repositories explicitly verified in the Evidence model
   */
  private extractVerifiedEntities(result: InvestigationResult) {
    const verifiedDomains = new Set<string>();
    const verifiedEmails = new Set<string>();
    const verifiedRepos = new Set<string>();
    const verifiedProperNouns = new Set<string>();

    // Add query term
    const queryTerm = result.query.term.toLowerCase();
    if (result.query.type === "Domain") verifiedDomains.add(queryTerm);
    else if (result.query.type === "Person" && queryTerm.includes("@")) verifiedEmails.add(queryTerm);
    else verifiedProperNouns.add(queryTerm);

    // 1. Gather from evidences
    const evidences = result.evidences || [];
    evidences.forEach(ev => {
      const textToSearch = `${ev.title} ${ev.description} ${JSON.stringify(ev.rawData || {})}`.toLowerCase();
      
      // Extract domains from evidence text
      const domainRegex = /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,6}/g;
      let match;
      while ((match = domainRegex.exec(textToSearch)) !== null) {
        verifiedDomains.add(match[0]);
      }

      // Extract emails
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
      while ((match = emailRegex.exec(textToSearch)) !== null) {
        verifiedEmails.add(match[0]);
      }

      // Extract github repos
      const repoRegex = /github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)/g;
      while ((match = repoRegex.exec(textToSearch)) !== null) {
        verifiedRepos.add(`${match[1]}/${match[2]}`.toLowerCase());
      }
    });

    // 2. Gather from resolved Entities and Canonical Entities
    const entities = result.entities || [];
    entities.forEach(ent => {
      verifiedProperNouns.add(ent.name.toLowerCase());
      if (ent.type === "Domain") verifiedDomains.add(ent.name.toLowerCase());
      if (ent.type === "Repository") verifiedRepos.add(ent.name.toLowerCase());
      if (ent.type === "Person" && ent.name.includes("@")) verifiedEmails.add(ent.name.toLowerCase());
      
      if (ent.metadata) {
        Object.values(ent.metadata).forEach(val => {
          if (typeof val === "string") {
            verifiedProperNouns.add(val.toLowerCase());
            if (val.includes("@")) verifiedEmails.add(val.toLowerCase());
          }
        });
      }
    });

    const canonicalEntities = result.canonicalEntities || [];
    canonicalEntities.forEach(can => {
      verifiedProperNouns.add(can.canonicalName.toLowerCase());
      if (can.aliases) {
        can.aliases.forEach(alias => verifiedProperNouns.add(alias.toLowerCase()));
      }
    });

    // 3. Extract proper nouns from sources
    const sources = result.sources || [];
    sources.forEach(src => verifiedProperNouns.add(src.toLowerCase()));

    // 4. Extract proper nouns from timeline events
    const timeline = result.timeline || [];
    timeline.forEach(evt => {
      verifiedProperNouns.add(evt.event.toLowerCase());
      verifiedProperNouns.add(evt.source.toLowerCase());
      const propRegex = /\b[A-Z][a-zA-Z0-9]{2,}\b/g;
      let match;
      while ((match = propRegex.exec(evt.description)) !== null) {
        verifiedProperNouns.add(match[0].toLowerCase());
      }
    });

    // 5. Extract proper nouns from relationships
    const relationships = result.relationships || [];
    relationships.forEach(rel => {
      verifiedProperNouns.add(rel.source.toLowerCase());
      verifiedProperNouns.add(rel.target.toLowerCase());
      verifiedProperNouns.add(rel.type.toLowerCase());
    });

    return {
      domains: verifiedDomains,
      emails: verifiedEmails,
      repos: verifiedRepos,
      properNouns: verifiedProperNouns
    };
  }

  /**
   * Checks a statement text for any companies, repos, domains, emails, tech, or relationships absent from the Evidence model.
   * Returns true if a hallucination is detected.
   */
  public detectHallucination(statement: string, result: InvestigationResult): { isHallucinated: boolean; reason?: string } {
    const verified = this.extractVerifiedEntities(result);
    const textLower = statement.toLowerCase();

    // 1. Validate emails mentioned in the statement
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
    let match;
    while ((match = emailRegex.exec(textLower)) !== null) {
      const email = match[0];
      let matched = false;
      for (const verEmail of verified.emails) {
        if (email === verEmail || email.includes(verEmail) || verEmail.includes(email)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        return { isHallucinated: true, reason: `Mentioned unverified email: ${email}` };
      }
    }

    // 2. Validate domains mentioned in the statement
    const domainRegex = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,6}\b/g;
    while ((match = domainRegex.exec(textLower)) !== null) {
      const domain = match[0];
      // Skip common domains/subdomains that are part of standard text or uninteresting
      if (["example.com", "placeholder.com", "tbd.com", "test.com"].includes(domain)) {
        continue;
      }
      let matched = false;
      for (const verDomain of verified.domains) {
        if (domain === verDomain || domain.endsWith("." + verDomain) || verDomain.endsWith("." + domain)) {
          matched = true;
          break;
        }
      }
      // Check proper nouns too as a fallback (some domains are part of org names)
      for (const prop of verified.properNouns) {
        if (domain.includes(prop) || prop.includes(domain)) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        return { isHallucinated: true, reason: `Mentioned unverified domain: ${domain}` };
      }
    }

    // 3. Validate GitHub repositories
    const repoRegex = /\b([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\b/g;
    while ((match = repoRegex.exec(statement)) !== null) {
      const repo = match[0].toLowerCase();
      // Skip strings that look like dates (e.g. "07/12" or "2026/07") or common fractions
      if (/^\d+\/\d+$/.test(repo)) {
        continue;
      }
      let matched = false;
      for (const verRepo of verified.repos) {
        if (repo === verRepo || repo.includes(verRepo) || verRepo.includes(repo)) {
          matched = true;
          break;
        }
      }
      // Check evidences directly
      const foundInEvidence = result.evidences.some(ev => 
        ev.title.toLowerCase().includes(repo) || 
        ev.description.toLowerCase().includes(repo) ||
        JSON.stringify(ev.rawData || {}).toLowerCase().includes(repo)
      );
      if (!matched && !foundInEvidence) {
        return { isHallucinated: true, reason: `Mentioned unverified GitHub repository: ${repo}` };
      }
    }

    // 4. Validate proper nouns (Companies, Organizations, Technologies)
    // Extract capitalized words or sequences of capitalized words
    const properNounRegex = /\b[A-Z][a-zA-Z0-9]{2,}\b/g;
    const properNounsInStatement: string[] = [];
    while ((match = properNounRegex.exec(statement)) !== null) {
      const noun = match[0];
      const nounLower = noun.toLowerCase();
      if (this.stopWords.has(nounLower)) {
        continue;
      }
      properNounsInStatement.push(noun);
    }

    for (const noun of properNounsInStatement) {
      const nounLower = noun.toLowerCase();
      let matched = false;

      // Check direct proper nouns set
      for (const prop of verified.properNouns) {
        if (nounLower === prop || prop.includes(nounLower) || nounLower.includes(prop)) {
          matched = true;
          break;
        }
      }

      // Check if it appears in any verified evidence description/title
      if (!matched) {
        matched = result.evidences.some(ev => 
          ev.title.toLowerCase().includes(nounLower) || 
          ev.description.toLowerCase().includes(nounLower)
        );
      }

      if (!matched) {
        return { isHallucinated: true, reason: `Mentioned unverified entity or technology: "${noun}"` };
      }
    }

    return { isHallucinated: false };
  }
}

/**
 * Validation Service
 * 
 * Orchestrates pre-execution cleansing and post-execution hallucination checks and metrics computation.
 */
export class ValidationService {
  private detector = new HallucinationDetector();

  /**
   * Pre-validation: Cleanses evidences before sending to AI synthesis.
   * - Removes duplicates
   * - Removes empty evidence
   * - Removes placeholder evidence
   * - Removes mock evidence
   */
  public preValidate(result: InvestigationResult): InvestigationResult {
    const originalEvidences = result.evidences || [];
    const verifiedEvidences: Evidence[] = [];
    const seenKeys = new Set<string>();

    for (const ev of originalEvidences) {
      // 1. Remove empty evidence
      if (!ev.id || !ev.title || !ev.description) {
        continue;
      }
      if (ev.title.trim() === "" || ev.description.trim() === "") {
        continue;
      }

      // 2. Remove duplicate evidence
      const dedupKey = `${ev.connector.toLowerCase()}:${ev.title.trim().toLowerCase()}:${ev.description.trim().toLowerCase()}`;
      if (seenKeys.has(dedupKey) || seenKeys.has(ev.id)) {
        continue;
      }

      // 3. Remove placeholder evidence
      const isPlaceholder = [
        "placeholder",
        "to be defined",
        "tbd",
        "dummy",
        "lorem ipsum",
        "temp value"
      ].some(term => 
        ev.title.toLowerCase().includes(term) || 
        ev.description.toLowerCase().includes(term) ||
        ev.id.toLowerCase().includes(term)
      );

      if (isPlaceholder) {
        continue;
      }

      // 4. Remove mock evidence
      const isMock = [
        "mock",
        "fake",
        "simulated",
        "test evidence",
        "fallback evidence",
        "example.com",
        "sandbox"
      ].some(term => 
        ev.title.toLowerCase().includes(term) || 
        ev.description.toLowerCase().includes(term) ||
        ev.id.toLowerCase().includes(term)
      );

      if (isMock) {
        continue;
      }

      // 5. Reject evidence that is not from a verified data source
      if (ev.verified === false) {
        continue;
      }

      // If it passes all checks, keep it
      verifiedEvidences.push(ev);
      seenKeys.add(dedupKey);
      seenKeys.add(ev.id);
    }

    // Now clean up entity and relationship evidence reference arrays
    const validEvidenceIds = new Set(verifiedEvidences.map(e => e.id));

    const cleanedEntities = (result.entities || []).map(ent => ({
      ...ent,
      evidenceIds: (ent.evidenceIds || []).filter(id => validEvidenceIds.has(id))
    }));

    const cleanedRelationships = (result.relationships || []).map(rel => ({
      ...rel,
      evidenceIds: (rel.evidenceIds || []).filter(id => validEvidenceIds.has(id))
    }));

    return {
      ...result,
      evidences: verifiedEvidences,
      entities: cleanedEntities,
      relationships: cleanedRelationships
    };
  }

  /**
   * Post-validation: Audits the synthesized report against verified evidence.
   */
  public postValidate(result: InvestigationResult, report: IntelligenceReport): { report: IntelligenceReport; validationReport: ValidationReport } {
    const validEvidenceIds = new Set(result.evidences.map(e => e.id));
    const verifiedStatements: string[] = [];
    const removedHallucinations: string[] = [];
    const unsupportedClaims: string[] = [];

    const originalFindingsCount = report.findings?.length || 0;
    const originalKeyFindingsCount = report.keyFindings?.length || 0;

    // Process findings
    const cleanedFindings: IntelligenceFinding[] = [];
    if (report.findings && Array.isArray(report.findings)) {
      for (const finding of report.findings) {
        const hasEvidence = finding.evidenceIds && finding.evidenceIds.length > 0;
        const allEvidenceExists = hasEvidence && finding.evidenceIds.every(id => validEvidenceIds.has(id));

        if (!allEvidenceExists) {
          // Reject statement
          unsupportedClaims.push(finding.statement);
          cleanedFindings.push({
            statement: "Insufficient verified evidence.",
            type: finding.type,
            evidenceIds: []
          });
        } else {
          // Verify with Hallucination Detector
          const check = this.detector.detectHallucination(finding.statement, result);
          if (check.isHallucinated) {
            removedHallucinations.push(`${finding.statement} (${check.reason})`);
          } else {
            verifiedStatements.push(finding.statement);
            cleanedFindings.push(finding);
          }
        }
      }
    }

    // Process key findings
    const cleanedKeyFindings: string[] = [];
    if (report.keyFindings && Array.isArray(report.keyFindings)) {
      for (const keyFinding of report.keyFindings) {
        const check = this.detector.detectHallucination(keyFinding, result);
        if (check.isHallucinated) {
          removedHallucinations.push(`${keyFinding} (${check.reason})`);
        } else {
          cleanedKeyFindings.push(keyFinding);
        }
      }
    }

    const isGroundedMode = !!result.query.options?.grounded;

    // Process executive summary sentence-by-sentence
    let cleanedExecSummary = report.executiveSummary || "";
    if (cleanedExecSummary) {
      const sentences = cleanedExecSummary.split(/(?<=[.!?])\s+/);
      const survivingSentences: string[] = [];
      for (const sentence of sentences) {
        const check = this.detector.detectHallucination(sentence, result);
        if (check.isHallucinated) {
          removedHallucinations.push(`[ExecSummary Sentence] ${sentence} (${check.reason})`);
          continue;
        }

        if (isGroundedMode) {
          const mentionsEvidence = Array.from(validEvidenceIds).some(id => sentence.includes(id));
          if (!mentionsEvidence) {
            removedHallucinations.push(`[ExecSummary Grounding Filter] Removed unreferenced sentence: "${sentence}"`);
            continue;
          }
        }

        survivingSentences.push(sentence);
      }
      cleanedExecSummary = survivingSentences.join(" ");
    }

    // Process main summary
    let cleanedSummary = report.summary || "";
    if (cleanedSummary) {
      const check = this.detector.detectHallucination(cleanedSummary, result);
      if (check.isHallucinated) {
        removedHallucinations.push(`[Summary] ${cleanedSummary} (${check.reason})`);
        cleanedSummary = `Intelligence briefing completed with dual-sensor validation on "${result.query.term}".`;
      } else if (isGroundedMode) {
        const sentences = cleanedSummary.split(/(?<=[.!?])\s+/);
        const survivingSummarySentences = sentences.filter(sentence => {
          const mentionsEvidence = Array.from(validEvidenceIds).some(id => sentence.includes(id));
          if (!mentionsEvidence) {
            removedHallucinations.push(`[Summary Grounding Filter] Removed unreferenced sentence: "${sentence}"`);
          }
          return mentionsEvidence;
        });
        if (survivingSummarySentences.length > 0) {
          cleanedSummary = survivingSummarySentences.join(" ");
        } else {
          const firstEvId = Array.from(validEvidenceIds)[0] || "ev_unverified";
          cleanedSummary = `Threat intelligence mapping completed for target "${result.query.term}" [${firstEvId}].`;
        }
      }
    }

    // Compile validation metrics
    const verifiedStatementsCount = verifiedStatements.length;
    const removedStatementsCount = removedHallucinations.length;
    const unsupportedClaimsCount = unsupportedClaims.length;

    const totalOriginalStatements = verifiedStatementsCount + removedStatementsCount + unsupportedClaimsCount;
    const validationScore = totalOriginalStatements > 0 
      ? Math.round((verifiedStatementsCount / totalOriginalStatements) * 100) 
      : 100;

    // Compile used evidence coverage
    const usedEvidenceIds = new Set<string>();
    cleanedFindings.forEach(finding => {
      if (finding.statement !== "Insufficient verified evidence.") {
        finding.evidenceIds?.forEach(id => usedEvidenceIds.add(id));
      }
    });

    const evidenceCoverage = result.evidences.length > 0
      ? Math.round((usedEvidenceIds.size / result.evidences.length) * 100)
      : 0;

    // Calculate confidence adjustment (-10 points per hallucination/unsupported claim)
    const confidenceAdjustment = -(removedStatementsCount * 8 + unsupportedClaimsCount * 5);
    const updatedConfidence = Math.max(12, Math.min(98, (report.confidence || 90) + confidenceAdjustment));

    const validationReport: ValidationReport = {
      validationScore,
      verifiedStatementsCount,
      removedStatementsCount,
      evidenceCoverage,
      verifiedStatements,
      removedHallucinations,
      unsupportedClaims,
      confidenceAdjustment
    };

    const updatedReport: IntelligenceReport = {
      ...report,
      summary: cleanedSummary,
      executiveSummary: cleanedExecSummary,
      keyFindings: cleanedKeyFindings,
      findings: cleanedFindings,
      confidence: updatedConfidence,
      validationReport
    };

    return {
      report: updatedReport,
      validationReport
    };
  }
}
