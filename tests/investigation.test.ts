import { describe, it, expect, vi } from "vitest";
import { InvestigationService } from "../src/services/investigation";
import { Connector, InvestigationQuery, ConnectorResult } from "../src/types";

describe("Investigation Pipeline Integration & Graceful Fallback", () => {
  it("should successfully aggregate entries from active functional connectors", async () => {
    const successConnector: Connector = {
      name: "Functional Connector",
      run: async (query: InvestigationQuery): Promise<ConnectorResult> => {
        return {
          connectorName: "Functional Connector",
          success: true,
          timestamp: new Date().toISOString(),
          entities: [
            {
              id: "ent_success_01",
              name: "target-host.com",
              type: "Domain",
              metadata: { verified: true },
              evidenceIds: ["ev_success_01"]
            }
          ],
          relationships: [],
          timeline: [],
          evidences: [
            {
              id: "ev_success_01",
              connector: "Functional Connector",
              title: "Verified Active Host",
              description: "Target verified as active.",
              confidence: 90,
              timestamp: new Date().toISOString(),
              rawData: {}
            }
          ],
          sources: ["https://functional-intel.com"]
        };
      }
    };

    const service = new InvestigationService([successConnector]);
    const result = await service.investigate({ term: "target-host.com", type: "Domain" });

    expect(result.entities.length).toBe(1);
    expect(result.entities[0].name).toBe("target-host.com");
    expect(result.evidences.length).toBe(1);
    expect(result.sources).toContain("https://functional-intel.com");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should gracefully degrade when a subset of connectors fail, isolating partial failures", async () => {
    const successConnector: Connector = {
      name: "Stable Connector",
      run: async (query: InvestigationQuery): Promise<ConnectorResult> => {
        return {
          connectorName: "Stable Connector",
          success: true,
          timestamp: new Date().toISOString(),
          entities: [
            {
              id: "ent_stable_01",
              name: "stable-res",
              type: "Keyword",
              metadata: {},
              evidenceIds: []
            }
          ],
          relationships: [],
          timeline: [],
          evidences: [],
          sources: []
        };
      }
    };

    const failingConnector: Connector = {
      name: "Unstable Connector",
      run: async (query: InvestigationQuery): Promise<ConnectorResult> => {
        throw new Error("Remote API Connection Refused (TCP 502)");
      }
    };

    const service = new InvestigationService([successConnector, failingConnector]);
    const result = await service.investigate({ term: "target-host.com", type: "Domain" });

    // Ensure the whole pipeline did not crash
    expect(result.entities.length).toBe(1);
    expect(result.entities[0].name).toBe("stable-res");
    
    // Check that we have a failure fallback evidence card from the degraded connector
    const fallbackEvidence = result.evidences.find(e => e.connector === "Unstable Connector");
    expect(fallbackEvidence).toBeDefined();
    expect(fallbackEvidence?.title).toBe("Unstable Connector Failure Fallback");
    expect(fallbackEvidence?.description).toContain("failed resiliently");
  });
});
