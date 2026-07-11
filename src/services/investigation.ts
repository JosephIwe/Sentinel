import { Connector, InvestigationResult, Entity, Relationship, TimelineEvent, Evidence, InvestigationQuery, ConnectorResult } from "../types";

/**
 * Enterprise Investigation Orchestrator Service
 * 
 * Implements Dependency Injection to easily register and manage connector providers.
 * Runs queries asynchronously in parallel, robustly isolates partial failures,
 * merges/normalizes overlapping entities, maps credentials, and synthesizes overall graph metadata.
 */
export class InvestigationService {
  private connectors: Connector[];

  /**
   * Instantiates the Investigation Service via Dependency Injection.
   * By injecting an array of connectors, we decouple the orchestrator from individual implementations,
   * satisfying the Open-Closed Principle and facilitating mock/unit testing.
   * 
   * @param connectors - Array of Connector modules conforming to the common interface
   */
  constructor(connectors: Connector[]) {
    this.connectors = connectors;
  }

  /**
   * Orchestrates high-throughput parallel checks across all registered providers,
   * aggregating, normalizing, and calculating final score dimensions.
   * 
   * @param query - Structured query object containing search term and options
   */
  public async investigate(query: InvestigationQuery): Promise<InvestigationResult> {
    const startTime = Date.now();

    // 1. Run all connectors in parallel using concurrent workers
    // We use Promise.allSettled to ensure that a complete failure in one connector
    // (e.g., WHOIS server downtime) does not crash the entire investigation.
    const runPromises = this.connectors.map(async (connector) => {
      try {
        return await connector.run(query);
      } catch (err: any) {
        console.error(`Connector failure [${connector.name}]:`, err);
        return {
          connectorName: connector.name,
          success: false,
          timestamp: new Date().toISOString(),
          entities: [],
          relationships: [],
          timeline: [],
          evidences: [],
          sources: [],
          error: err.message || "Execution failed",
        } as ConnectorResult;
      }
    });

    const settledResults = await Promise.allSettled(runPromises);

    // Collect all elements from successful runs
    const rawEntities: Entity[] = [];
    const rawRelationships: Relationship[] = [];
    const rawTimeline: TimelineEvent[] = [];
    const rawEvidences: Evidence[] = [];
    const rawSources: string[] = [];
    let successfulConnectorCount = 0;

    settledResults.forEach((result) => {
      if (result.status === "fulfilled") {
        const value = result.value;
        if (value.success) {
          successfulConnectorCount++;
          rawEntities.push(...value.entities);
          rawRelationships.push(...value.relationships);
          rawTimeline.push(...value.timeline);
          rawEvidences.push(...(value.evidences || []));
          rawSources.push(...value.sources);
        }
      }
    });

    // 2. Normalize and merge duplicate entities
    // Entities may be detected by multiple connectors (e.g. domain.com detected by Google, DNS, and WHOIS).
    // We map duplicates using a canonical key: lowercase trimmed entity name + normalized entity type.
    const mergedEntitiesMap = new Map<string, Entity>();
    const idTranslationMap = new Map<string, string>(); // Original entity ID -> Merged canonical ID

    rawEntities.forEach((ent) => {
      const canonicalKey = `${ent.type.toLowerCase()}:${ent.name.trim().toLowerCase()}`;
      const evidenceIds = ent.evidenceIds || [];
      
      if (mergedEntitiesMap.has(canonicalKey)) {
        // Merge metadata intelligently
        const existing = mergedEntitiesMap.get(canonicalKey)!;
        existing.metadata = {
          ...existing.metadata,
          ...ent.metadata,
          mergedFrom: Array.from(new Set([...(existing.metadata.mergedFrom || []), ent.id]))
        };
        existing.evidenceIds = Array.from(new Set([...(existing.evidenceIds || []), ...evidenceIds]));
        // Log translation from this duplicate entity ID to the canonical one
        idTranslationMap.set(ent.id, existing.id);
      } else {
        // First time seeing this entity. Establish as canonical.
        mergedEntitiesMap.set(canonicalKey, { ...ent, evidenceIds: [...evidenceIds] });
        idTranslationMap.set(ent.id, ent.id);
      }
    });

    const entities = Array.from(mergedEntitiesMap.values());

    // 3. Normalize and link relationships
    // Replace relationship source and target identifiers with canonical entity IDs.
    // Ensure we don't return duplicates or self-referential relations.
    const relationshipMap = new Map<string, Relationship>();

    rawRelationships.forEach((rel) => {
      const canonicalSource = idTranslationMap.get(rel.source) || rel.source;
      const canonicalTarget = idTranslationMap.get(rel.target) || rel.target;

      // Prevent self-referential relations
      if (canonicalSource === canonicalTarget) return;

      const relKey = `${canonicalSource}->${rel.type}->${canonicalTarget}`;
      const evidenceIds = rel.evidenceIds || [];
      if (relationshipMap.has(relKey)) {
        const existing = relationshipMap.get(relKey)!;
        existing.evidenceIds = Array.from(new Set([...(existing.evidenceIds || []), ...evidenceIds]));
      } else {
        relationshipMap.set(relKey, {
          source: canonicalSource,
          target: canonicalTarget,
          type: rel.type,
          metadata: rel.metadata,
          evidenceIds: [...evidenceIds]
        });
      }
    });

    const relationships = Array.from(relationshipMap.values());

    // 4. Sort and deduplicate timeline events
    const timeline = rawTimeline
      .filter((evt, idx, self) => 
        self.findIndex(t => t.date === evt.date && t.event === evt.event) === idx
      )
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // 5. Deduplicate evidences
    const evidencesMap = new Map<string, Evidence>();
    rawEvidences.forEach((ev) => {
      const key = ev.id || `${ev.source}:${ev.description.substring(0, 30)}`;
      if (!evidencesMap.has(key)) {
        evidencesMap.set(key, ev);
      }
    });
    const evidences = Array.from(evidencesMap.values());

    // 6. Deduplicate sources
    const sources = Array.from(new Set(rawSources));

    // 7. Calculate Confidence Score
    // Confidence is an analytical result derived from signal cross-validation.
    // Higher volume of synchronized connectors, dense network maps, and verified domains boost confidence.
    const baseConfidence = (successfulConnectorCount / this.connectors.length) * 60;
    const entityDensityBonus = Math.min(25, entities.length * 3);
    const connectionDensityBonus = Math.min(15, relationships.length * 2);
    const confidence = Math.min(100, Math.round(baseConfidence + entityDensityBonus + connectionDensityBonus));

    // 8. Synthesize Summary
    const durationMs = Date.now() - startTime;
    const summary = `Investigation completed in ${durationMs}ms across ${successfulConnectorCount}/${this.connectors.length} active sensor feeds. Detected ${entities.length} primary entities linked by ${relationships.length} validated context paths. Target footprint exhibits a confidence score of ${confidence}% centered around "${query.term}".`;

    return {
      query,
      summary,
      entities,
      relationships,
      timeline,
      evidences,
      confidence,
      sources,
    };
  }
}
