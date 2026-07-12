import { Entity, Evidence, Relationship, CanonicalEntity } from "../types";
import { areEntitiesMatching } from "../utils/entityMatcher";

/**
 * Entity Resolution Service (Deterministic)
 * 
 * Aggregates and resolves disparate entities from multiple connector sources.
 * Deduplicates overlapping indicators, tracks aliases, merges evidence references,
 * and normalizes relationship graphs using pure rule-based algorithms.
 */
export class EntityResolutionService {
  private similarityThreshold: number;

  /**
   * Initializes the Entity Resolution Engine.
   * @param similarityThreshold - The configurable matching confidence threshold (default: 0.85)
   */
  constructor(similarityThreshold: number = 0.85) {
    this.similarityThreshold = similarityThreshold;
  }

  /**
   * Resolves a collection of raw entities, linking corresponding evidence and relationships.
   * 
   * @param rawEntities - List of entities from various connectors
   * @param rawEvidence - List of all gathered evidence pieces
   * @param rawRelationships - List of relationships from the connectors
   * @returns Array of resolved Canonical Entities
   */
  public resolve(
    rawEntities: Entity[],
    rawEvidence: Evidence[],
    rawRelationships: Relationship[]
  ): CanonicalEntity[] {
    const canonicalEntities: CanonicalEntity[] = [];
    
    // Translation map: Original Entity ID -> Canonical Entity ID
    const translationMap = new Map<string, string>();
    
    // Tracks which original entities have been mapped to which canonical entity
    const canonicalMapping = new Map<string, Entity[]>(); // canonical ID -> array of original entities

    // 1. Group entities into canonical containers using deterministic rules
    rawEntities.forEach((ent) => {
      let matchedCanonical: CanonicalEntity | undefined;

      for (const canonical of canonicalEntities) {
        // Compare with the main canonical name or any known aliases
        const matchResult = areEntitiesMatching(
          ent.name,
          ent.type,
          canonical.canonicalName,
          canonical.entityType,
          this.similarityThreshold
        );

        if (matchResult.matched) {
          matchedCanonical = canonical;
          break;
        }

        // Also check against aliases to handle transitive matches
        for (const alias of canonical.aliases) {
          const aliasMatch = areEntitiesMatching(
            ent.name,
            ent.type,
            alias,
            canonical.entityType,
            this.similarityThreshold
          );
          if (aliasMatch.matched) {
            matchedCanonical = canonical;
            break;
          }
        }

        if (matchedCanonical) break;
      }

      if (matchedCanonical) {
        // Translate this entity's ID to the matched canonical's ID
        translationMap.set(ent.id, matchedCanonical.id);
        
        // Track original entities for evidence and relationship resolution
        const list = canonicalMapping.get(matchedCanonical.id) || [];
        list.push(ent);
        canonicalMapping.set(matchedCanonical.id, list);

        // Add to aliases if it's a new unique name/handle
        const nameLower = ent.name.trim().toLowerCase();
        const mainNameLower = matchedCanonical.canonicalName.toLowerCase();
        const hasAlias = matchedCanonical.aliases.some(a => a.toLowerCase() === nameLower);
        
        if (nameLower !== mainNameLower && !hasAlias) {
          matchedCanonical.aliases.push(ent.name.trim());
        }

        // Dynamically boost confidence since multiple sources corroborating increases certainty
        matchedCanonical.confidence = Math.min(100, matchedCanonical.confidence + 10);
      } else {
        // Create new canonical entity
        const canonicalId = `resolved_${ent.id}`;
        translationMap.set(ent.id, canonicalId);

        // Base confidence calculation
        let baseConfidence = 70;
        if (ent.metadata && typeof ent.metadata.confidence === "number") {
          baseConfidence = ent.metadata.confidence;
        } else if (ent.metadata && typeof ent.metadata.strength === "number") {
          baseConfidence = Math.round(ent.metadata.strength * 100);
        }

        const newCanonical: CanonicalEntity = {
          id: canonicalId,
          canonicalName: ent.name.trim(),
          aliases: [],
          entityType: ent.type,
          confidence: baseConfidence,
          evidence: [],
          relationships: []
        };

        canonicalEntities.push(newCanonical);
        canonicalMapping.set(canonicalId, [ent]);
      }
    });

    // 2. Attach and deduplicate Evidence for each Canonical Entity
    const evidenceLookup = new Map<string, Evidence>();
    rawEvidence.forEach((ev) => {
      evidenceLookup.set(ev.id, ev);
    });

    canonicalEntities.forEach((canonical) => {
      const originalEntities = canonicalMapping.get(canonical.id) || [];
      const seenEvidenceIds = new Set<string>();
      const attachedEvidence: Evidence[] = [];

      originalEntities.forEach((orig) => {
        const evIds = orig.evidenceIds || [];
        evIds.forEach((evId) => {
          if (!seenEvidenceIds.has(evId)) {
            seenEvidenceIds.add(evId);
            const evObj = evidenceLookup.get(evId);
            if (evObj) {
              attachedEvidence.push(evObj);
            }
          }
        });
      });

      canonical.evidence = attachedEvidence;
    });

    // 3. Resolve and deduplicate relationships across all Canonical Entities
    // First, translate all raw relationships to refer to canonical entity IDs
    const resolvedRelationships: Relationship[] = [];
    const relationshipKeysSeen = new Set<string>();

    rawRelationships.forEach((rel) => {
      const canonicalSourceId = translationMap.get(rel.source) || rel.source;
      const canonicalTargetId = translationMap.get(rel.target) || rel.target;

      // Prevent self-referential relations
      if (canonicalSourceId === canonicalTargetId) return;

      const relKey = `${canonicalSourceId}:${rel.type}:${canonicalTargetId}`;
      if (!relationshipKeysSeen.has(relKey)) {
        relationshipKeysSeen.add(relKey);
        resolvedRelationships.push({
          source: canonicalSourceId,
          target: canonicalTargetId,
          type: rel.type,
          metadata: rel.metadata,
          evidenceIds: rel.evidenceIds || []
        });
      } else {
        // Merge evidenceIds if relationship key is seen
        const existingRel = resolvedRelationships.find(
          r => r.source === canonicalSourceId && r.type === rel.type && r.target === canonicalTargetId
        );
        if (existingRel) {
          existingRel.evidenceIds = Array.from(new Set([...(existingRel.evidenceIds || []), ...(rel.evidenceIds || [])]));
        }
      }
    });

    // Now, associate each relationship to the participating canonical entities
    canonicalEntities.forEach((canonical) => {
      // Find all relationships where this entity is either source or target
      const participatingRels = resolvedRelationships.filter(
        rel => rel.source === canonical.id || rel.target === canonical.id
      );

      // Map those relationships but replace the source and target IDs with human-readable canonical names
      // so the UI can display them elegantly.
      canonical.relationships = participatingRels.map((rel) => {
        const sourceEntity = canonicalEntities.find(c => c.id === rel.source);
        const targetEntity = canonicalEntities.find(c => c.id === rel.target);

        return {
          source: sourceEntity ? sourceEntity.canonicalName : rel.source,
          target: targetEntity ? targetEntity.canonicalName : rel.target,
          type: rel.type,
          metadata: rel.metadata,
          evidenceIds: rel.evidenceIds
        };
      });
    });

    return canonicalEntities;
  }
}
