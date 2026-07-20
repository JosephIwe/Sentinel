import { Connector, InvestigationResult, Entity, Relationship, TimelineEvent, Evidence, InvestigationQuery, ConnectorResult, ConnectorStatusInfo } from "../types";
import { EntityResolutionService } from "./entityResolution";
import { withRetry, withTimeout, CircuitBreakerRegistry } from "../utils/reliability";
import { logger } from "../utils/logger";
import { safeFetch } from "../utils/ssrfGuard";

/**
 * Enterprise Investigation Orchestrator Service
 * 
 * Implements Dependency Injection to easily register and manage connector providers.
 * Runs queries asynchronously in parallel, robustly isolates partial failures,
 * merges/normalizes overlapping entities, maps credentials, and synthesizes overall graph metadata.
 * Now optimized with parallel execution, configurable timeouts, cache warming, and performance telemetry.
 */
export class InvestigationService {
  private connectors: Connector[];

  // In-memory static cache for full investigation reports (duplicate detection)
  private static investigationCache = new Map<string, { result: InvestigationResult; timestamp: number }>();

  // In-memory static cache for individual connector results (reusing cached evidence)
  private static connectorCache = new Map<string, { result: ConnectorResult; timestamp: number }>();

  private static readonly MAX_CACHE_ENTRIES = 500;

  /**
   * Inserts into a bounded cache Map. If the map is at capacity, evicts the
   * oldest inserted entry first (simple FIFO bound, not true LRU) to keep
   * memory usage capped regardless of how many distinct queries are run.
   */
  private static setBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
    if (map.size >= InvestigationService.MAX_CACHE_ENTRIES && !map.has(key)) {
      const oldestKey = map.keys().next().value;
      if (oldestKey !== undefined) {
        map.delete(oldestKey);
      }
    }
    map.set(key, value);
  }

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
   * Retrieves the connectors count.
   */
  public getConnectorsCount(): number {
    return this.connectors.length;
  }

  /**
   * Helper to retrieve GITHUB_CACHE_TTL_MS, WHOIS_CACHE_TTL_MS, DNS_CACHE_TTL_MS etc.
   */
  private getCacheTtlForConnector(connectorName: string): number {
    if (connectorName.toLowerCase().includes("whois")) {
      const envTtl = process.env.WHOIS_CACHE_TTL_MS;
      if (envTtl) {
        const parsed = parseInt(envTtl, 10);
        if (!isNaN(parsed) && parsed >= 0) return parsed;
      }
      return 60 * 60 * 1000; // Default: 1 hour
    }
    if (connectorName.toLowerCase().includes("dns") || connectorName.toLowerCase().includes("system")) {
      const envTtl = process.env.DNS_CACHE_TTL_MS;
      if (envTtl) {
        const parsed = parseInt(envTtl, 10);
        if (!isNaN(parsed) && parsed >= 0) return parsed;
      }
      return 5 * 60 * 1000; // Default: 5 minutes
    }
    if (connectorName.toLowerCase().includes("github")) {
      const envTtl = process.env.GITHUB_CACHE_TTL_MS;
      if (envTtl) {
        const parsed = parseInt(envTtl, 10);
        if (!isNaN(parsed) && parsed >= 0) return parsed;
      }
      return 60 * 60 * 1000; // Default: 1 hour
    }
    // Google, News
    return 10 * 60 * 1000; // Default: 10 minutes
  }

  /**
   * Retrieves configurable timeout limit for each connector.
   */
  private getTimeoutForConnector(connectorName: string): number {
    let envVarName = "";
    const nameLower = connectorName.toLowerCase();
    if (nameLower.includes("whois")) envVarName = "WHOIS_TIMEOUT_MS";
    else if (nameLower.includes("dns") || nameLower.includes("system")) envVarName = "DNS_TIMEOUT_MS";
    else if (nameLower.includes("github intelligence")) envVarName = "GITHUB_INTEL_TIMEOUT_MS";
    else if (nameLower.includes("github")) envVarName = "GITHUB_TIMEOUT_MS";
    else if (nameLower.includes("google")) envVarName = "GOOGLE_TIMEOUT_MS";
    else if (nameLower.includes("news")) envVarName = "NEWS_TIMEOUT_MS";

    if (envVarName && process.env[envVarName]) {
      const parsed = parseInt(process.env[envVarName]!, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 5000; // Default: 5 seconds timeout
  }



  /**
   * Orchestrates high-throughput parallel checks across all registered providers,
   * aggregating, normalizing, and calculating final score dimensions.
   * Supports incremental completion callback for updating progressive job percentage.
   * 
   * @param query - Structured query object containing search term and options
   * @param onConnectorCompleted - Optional progressive update callback
   */
  public async investigate(
    query: InvestigationQuery,
    onConnectorCompleted?: (connectorName: string, result: ConnectorResult, elapsedMs: number) => void
  ): Promise<InvestigationResult> {
    const startTime = Date.now();
    const term = query.term.trim();
    const queryLower = term.toLowerCase();

    // Diagnostics trackers for GitHub Discovery
    let githubDiscoveryAttempted = false;
    let githubUrlDiscovered: string | null = null;
    let githubDiscoveryStatus = "Not applicable";

    // 0. Deduplicate: Return cached result for identical full investigations
    const connectorKey = this.connectors.map(c => c.name).sort().join(",");
    const fullCacheKey = `${query.type || "Generic"}:${queryLower}:${JSON.stringify(query.options || {})}:${connectorKey}`;
    const cachedFullResult = InvestigationService.investigationCache.get(fullCacheKey);
    const fullTtl = process.env.INVESTIGATION_CACHE_TTL_MS ? parseInt(process.env.INVESTIGATION_CACHE_TTL_MS, 10) : 5 * 60 * 1000; // 5 mins

    if (cachedFullResult && (Date.now() - cachedFullResult.timestamp < fullTtl)) {
      console.log(`[INTELLIGENT CACHE HIT] Reusing fully cached investigation for "${term}"`);
      // Update the totalTimeMs in the cached performance report to show actual retrieved speed (0ms of fresh querying)
      const freshResult = { ...cachedFullResult.result };
      if (freshResult.performance) {
        freshResult.performance = {
          ...freshResult.performance,
          totalTimeMs: Date.now() - startTime
        };
      }
      return freshResult;
    }

    let cacheHits = 0;
    let cacheMisses = 0;
    let timeoutCount = 0;
    const connectorTimesMs: Record<string, number> = {};

    // 1. Run all connectors in parallel using concurrent workers
    // We use Promise.allSettled to ensure that a complete failure in one connector
    // (e.g., WHOIS server downtime) does not crash the entire investigation.
    // Each connector is hardened with: configurable timeout, retries, circuit breaker, and caching.
    const runPromises = this.connectors.map(async (connector) => {
      const connectorStartTime = Date.now();
      let activeQuery = { ...query };

      const isGithubConnector = connector.name.toLowerCase().includes("github") || connector.name.toLowerCase().includes("git");
      const isDomainQuery = query.type === "Domain";

      if (isGithubConnector && isDomainQuery) {
        githubDiscoveryAttempted = true;
        githubDiscoveryStatus = "Initiating homepage fetch...";
        
        const termToScan = query.term.trim();
        let domainToScan = termToScan;
        if (domainToScan.startsWith("https://")) {
          domainToScan = domainToScan.substring(8);
        } else if (domainToScan.startsWith("http://")) {
          domainToScan = domainToScan.substring(7);
        }
        domainToScan = domainToScan.split("/")[0].trim();

        let homepageFetchFailed = false;

        try {
          const urlsToTry = [`https://${domainToScan}`, `http://${domainToScan}`];
          let html: string | null = null;
          let fetchError: string | null = null;

          for (const url of urlsToTry) {
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 3500); // 3.5s fetch limit
              const res = await safeFetch(url, {
                signal: controller.signal,
                headers: {
                  "User-Agent": "Sentinel-GitHub-Discovery/1.0",
                  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
                }
              });
              clearTimeout(timeoutId);
              if (res.ok) {
                html = await res.text();
                githubDiscoveryStatus = `Successfully fetched homepage via ${url.split("://")[0].toUpperCase()}`;
                break;
              } else {
                fetchError = `HTTP ${res.status}`;
              }
            } catch (err: any) {
              fetchError = err.message || "Network Error";
            }
          }

          if (!html) {
            homepageFetchFailed = true;
            githubDiscoveryStatus = `Unreachable: ${fetchError || "Could not retrieve homepage content"}`;
            githubUrlDiscovered = null;
          } else {
            const detectedUrls: string[] = [];
            const ignoredGithubPaths = new Set([
              "features", "enterprise", "pricing", "marketplace", "customer-stories",
              "security", "login", "signup", "join", "about", "contact", "site",
              "privacy", "terms", "explore", "topics", "trending", "collections",
              "events", "community", "sponsors", "readme", "orgs", "users", "search",
              "fluidicon.png", "opensearch.xml", "manifest.json", "images", "personal"
            ]);

            const regex = /https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)(?:\/([a-zA-Z0-9_.-]+))?/gi;
            let match;
            while ((match = regex.exec(html)) !== null) {
              const org = match[1];
              const repo = match[2];
              if (org && !ignoredGithubPaths.has(org.toLowerCase())) {
                let normUrl = `https://github.com/${org}`;
                if (repo && !ignoredGithubPaths.has(repo.toLowerCase())) {
                  normUrl += `/${repo}`;
                }
                detectedUrls.push(normUrl);
              }
            }

            const uniqueUrls = Array.from(new Set(detectedUrls));
            if (uniqueUrls.length > 0) {
              const repoUrls = uniqueUrls.filter(u => u.split("/").filter(Boolean).length >= 5);
              const selectedUrl = repoUrls.length > 0 ? repoUrls[0] : uniqueUrls[0];
              githubUrlDiscovered = selectedUrl;
              githubDiscoveryStatus = "Discovered verified link";
              activeQuery = {
                term: selectedUrl,
                type: "Generic"
              };
            } else {
              githubDiscoveryStatus = "No verified GitHub link found on the target website";
              githubUrlDiscovered = null;
            }
          }
        } catch (e: any) {
          homepageFetchFailed = true;
          githubDiscoveryStatus = `Error during discovery: ${e.message}`;
          githubUrlDiscovered = null;
        }

        if (!githubUrlDiscovered) {
          // Distinguish "we fetched the homepage and genuinely found no
          // GitHub link" (NO_DATA) from "we could not fetch the homepage at
          // all" - network error, timeout, WAF block, or the SSRF guard
          // rejecting the target (ERROR). Reporting the latter as NO_DATA
          // would misrepresent an inconclusive check as a confirmed absence.
          const status: ConnectorResult["status"] = homepageFetchFailed ? "ERROR" : "NO_DATA";
          const reason = homepageFetchFailed
            ? `Could not verify GitHub presence: homepage fetch failed (${githubDiscoveryStatus}).`
            : "No verified GitHub link found on the target website.";
          const noDataResult: ConnectorResult = {
            connectorName: connector.name,
            success: status !== "ERROR",
            status,
            verified: true,
            timestamp: new Date().toISOString(),
            entities: [],
            relationships: [],
            timeline: [],
            evidences: homepageFetchFailed ? [] : [
              {
                id: `ev_github_discovery_no_data`,
                connector: connector.name,
                title: "GitHub Discovery Run",
                description: "No verified GitHub link found on the target website.",
                confidence: 100,
                timestamp: new Date().toISOString(),
                rawData: {
                  attempted: true,
                  reason: "No verified GitHub link found on the target website.",
                  discoveryStatus: githubDiscoveryStatus
                },
                verified: true
              }
            ],
            sources: [],
            error: reason
          };
          const elapsed = Date.now() - connectorStartTime;
          connectorTimesMs[connector.name] = elapsed;
          if (onConnectorCompleted) {
            onConnectorCompleted(connector.name, noDataResult, elapsed);
          }
          return noDataResult;
        }
      }

      // Check connector cache (Intelligent Caching)
      const connCacheKey = `${connector.name}:${query.type || "Generic"}:${queryLower}`;
      const cachedConnector = InvestigationService.connectorCache.get(connCacheKey);
      const connTtl = this.getCacheTtlForConnector(connector.name);

      if (cachedConnector && (Date.now() - cachedConnector.timestamp < connTtl)) {
        cacheHits++;
        const elapsed = Date.now() - connectorStartTime;
        connectorTimesMs[connector.name] = elapsed;
        console.log(`[CONNECTOR CACHE HIT] "${connector.name}" retrieved from cache for "${term}"`);
        if (onConnectorCompleted) {
          onConnectorCompleted(connector.name, cachedConnector.result, elapsed);
        }
        return cachedConnector.result;
      }

      cacheMisses++;
      const timeoutMs = this.getTimeoutForConnector(connector.name);
      const breaker = CircuitBreakerRegistry.getBreaker(connector.name, 3, 15000);
      
      const executeWithResilience = async () => {
        return await breaker.execute(async () => {
          return await withTimeout(
            withRetry(
              async () => {
                return await connector.run(activeQuery);
              },
              { maxRetries: 2, delayMs: 400, name: connector.name }
            ),
            timeoutMs,
            connector.name
          );
        });
      };

      let resultValue: ConnectorResult;

      try {
        resultValue = await logger.profile(
          `Connector:${connector.name}`,
          executeWithResilience,
          3000,
          { query: activeQuery }
        );

        // Save to cache only if status is not ERROR (Never cache errors)
        if (resultValue.status === "SUCCESS" || resultValue.status === "NO_DATA") {
          InvestigationService.setBounded(InvestigationService.connectorCache, connCacheKey, {
            result: resultValue,
            timestamp: Date.now()
          });
        }
      } catch (err: any) {
        const isTimeout = err.message?.toLowerCase().includes("timeout") || err.message?.toLowerCase().includes("deadline");
        
        if (isTimeout) {
          timeoutCount++;
          resultValue = {
            connectorName: connector.name,
            success: false,
            status: "TIMEOUT",
            verified: true,
            timestamp: new Date().toISOString(),
            entities: [],
            relationships: [],
            timeline: [],
            evidences: [
              {
                id: `ev_${connector.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_timeout`,
                connector: connector.name,
                title: `${connector.name} Query Timeout`,
                description: `The ${connector.name} connector reached its configurable timeout limit (${timeoutMs}ms) and was halted to preserve overall responsiveness.`,
                confidence: 0,
                timestamp: new Date().toISOString(),
                rawData: { error: err.message }
              }
            ],
            sources: [],
            error: `Timeout of ${timeoutMs}ms exceeded.`
          };
          logger.warn(`Connector timed out [${connector.name}]: ${err.message}`);
        } else {
          logger.error(`Connector failed resiliently [${connector.name}]: ${err.message}`, {
            connector: connector.name,
            error: err.message,
            query
          });
          
          resultValue = {
            connectorName: connector.name,
            success: false,
            status: "ERROR",
            verified: true,
            timestamp: new Date().toISOString(),
            entities: [],
            relationships: [],
            timeline: [],
            evidences: [
              {
                id: `ev_${connector.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}_failure`,
                connector: connector.name,
                title: `${connector.name} Failure Fallback`,
                description: `The ${connector.name} connector failed resiliently: ${err.message}. Returning graceful fallback.`,
                confidence: 0,
                timestamp: new Date().toISOString(),
                rawData: { error: err.message }
              }
            ],
            sources: [],
            error: err.message || "Execution failed",
          };
        }
      }

      const elapsed = Date.now() - connectorStartTime;
      connectorTimesMs[connector.name] = elapsed;

      if (onConnectorCompleted) {
        onConnectorCompleted(connector.name, resultValue, elapsed);
      }

      return resultValue;
    });

    const settledResults = await Promise.allSettled(runPromises);

    // Collect all elements from successful runs
    const rawEntities: Entity[] = [];
    const rawRelationships: Relationship[] = [];
    const rawTimeline: TimelineEvent[] = [];
    const rawEvidences: Evidence[] = [];
    const rawSources: string[] = [];
    let successfulConnectorCount = 0;
    const connectorStatuses: ConnectorStatusInfo[] = [];

    settledResults.forEach((result) => {
      if (result.status === "fulfilled") {
        const value = result.value;
        const status = value.status || (value.success ? "SUCCESS" : "ERROR");
        
        connectorStatuses.push({
          name: value.connectorName,
          status,
          error: value.error,
          evidenceCount: status === "SUCCESS" ? (value.evidences?.length || 0) : 0,
          executionTimeMs: connectorTimesMs[value.connectorName] ?? 0
        });

        if (status === "SUCCESS") {
          successfulConnectorCount++;
          rawEntities.push(...value.entities);
          rawRelationships.push(...value.relationships);
          rawTimeline.push(...value.timeline);
          rawEvidences.push(...(value.evidences || []));
          rawSources.push(...value.sources);
        } else if (status === "ERROR" || status === "TIMEOUT" || status === "NO_DATA") {
          // Include error/timeout/no-data fallback/discovery evidence only, no entities/relations
          rawEvidences.push(...(value.evidences || []));
        }
      } else {
        connectorStatuses.push({
          name: "Unknown Connector",
          status: "ERROR",
          error: "Promise rejected",
          evidenceCount: 0
        });
      }
    });

    // 2. Normalize and merge duplicate entities
    const mergedEntitiesMap = new Map<string, Entity>();
    const idTranslationMap = new Map<string, string>(); // Original entity ID -> Merged canonical ID

    rawEntities.forEach((ent) => {
      const canonicalKey = `${ent.type.toLowerCase()}:${ent.name.trim().toLowerCase()}`;
      const evidenceIds = ent.evidenceIds || [];
      
      if (mergedEntitiesMap.has(canonicalKey)) {
        const existing = mergedEntitiesMap.get(canonicalKey)!;
        existing.metadata = {
          ...existing.metadata,
          ...ent.metadata,
          mergedFrom: Array.from(new Set([...(existing.metadata.mergedFrom || []), ent.id]))
        };
        existing.evidenceIds = Array.from(new Set([...(existing.evidenceIds || []), ...evidenceIds]));
        idTranslationMap.set(ent.id, existing.id);
      } else {
        mergedEntitiesMap.set(canonicalKey, { ...ent, evidenceIds: [...evidenceIds] });
        idTranslationMap.set(ent.id, ent.id);
      }
    });

    const entities = Array.from(mergedEntitiesMap.values());

    // 3. Normalize and link relationships
    const relationshipMap = new Map<string, Relationship>();

    rawRelationships.forEach((rel) => {
      const canonicalSource = idTranslationMap.get(rel.source) || rel.source;
      const canonicalTarget = idTranslationMap.get(rel.target) || rel.target;

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
      const key = ev.id || `${ev.source || ev.connector}:${ev.description.substring(0, 30)}`;
      if (!evidencesMap.has(key)) {
        evidencesMap.set(key, ev);
      }
    });
    const evidences = Array.from(evidencesMap.values());

    // 6. Deduplicate sources
    const sources = Array.from(new Set(rawSources));

    // 7. Calculate Confidence Score
    const baseConfidence = (successfulConnectorCount / Math.max(1, this.connectors.length)) * 60;
    const entityDensityBonus = Math.min(25, entities.length * 3);
    const connectionDensityBonus = Math.min(15, relationships.length * 2);
    const confidence = Math.min(100, Math.round(baseConfidence + entityDensityBonus + connectionDensityBonus));

    // 8. Synthesize Summary
    const totalTimeMs = Date.now() - startTime;
    const summary = `Investigation completed in ${totalTimeMs}ms across ${successfulConnectorCount}/${this.connectors.length} active sensor feeds. Detected ${entities.length} primary entities linked by ${relationships.length} validated context paths. Target footprint exhibits a confidence score of ${confidence}% centered around "${query.term}".`;

    // 9. Run Entity Resolution Engine
    const entityResolutionService = new EntityResolutionService();
    const canonicalEntities = entityResolutionService.resolve(entities, evidences, relationships);

    const finalResult: InvestigationResult = {
      query,
      summary,
      entities,
      relationships,
      timeline,
      evidences,
      confidence,
      sources,
      canonicalEntities,
      connectorStatuses,
      performance: {
        totalTimeMs,
        connectorTimesMs,
        cacheHits,
        cacheMisses,
        timeoutCount,
        githubDiscoveryAttempted,
        githubUrlDiscovered,
        githubDiscoveryStatus,
      }
    };

    // Store in cache for future duplicate investigations
    InvestigationService.setBounded(InvestigationService.investigationCache, fullCacheKey, {
      result: finalResult,
      timestamp: Date.now()
    });

    return finalResult;
  }
}
