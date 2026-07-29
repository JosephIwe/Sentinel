import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import net from "net";
import dns from "dns/promises";
import { InvestigationService } from "../src/services/investigation";
import { TechnologyFingerprintConnector } from "../src/connectors/technologyFingerprint";
import { Connector, ConnectorResult, InvestigationQuery } from "../src/types";

vi.mock("dns/promises", () => ({
  default: { lookup: vi.fn() }
}));

function mockLookup(hostMap: Record<string, string> = {}) {
  vi.mocked(dns.lookup).mockImplementation(async (hostname: any) => {
    if (net.isIP(hostname)) {
      return [{ address: hostname, family: net.isIPv4(hostname) ? 4 : 6 }] as any;
    }
    const resolved = hostMap[hostname];
    if (resolved) {
      return [{ address: resolved, family: net.isIPv4(resolved) ? 4 : 6 }] as any;
    }
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
  });
}

function mockFetchResponse(opts: { status?: number; headers?: Record<string, string>; body?: string }) {
  const { status = 200, headers = {}, body = "" } = opts;
  const lowerCased: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lowerCased[k.toLowerCase()] = v;

  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    headers: { get: (name: string) => lowerCased[name.toLowerCase()] ?? null }
  }) as any;
}

/**
 * A stand-in for the DNS connector: emits the same canonical Domain entity
 * shape (type + name) so entity-merge behavior can be asserted.
 */
const dnsLikeConnector: Connector = {
  name: "DNS-like Connector",
  run: async (query: InvestigationQuery): Promise<ConnectorResult> => ({
    connectorName: "DNS-like Connector",
    success: true,
    status: "SUCCESS",
    verified: true,
    timestamp: new Date().toISOString(),
    entities: [
      {
        id: "ent_dns_domain_merge_example_com",
        name: "merge.example.com",
        type: "Domain",
        metadata: { resolver: "DNS-like Connector" },
        evidenceIds: ["ev_dns_like"]
      }
    ],
    relationships: [],
    timeline: [],
    evidences: [
      {
        id: "ev_dns_like",
        connector: "DNS-like Connector",
        title: "A record resolved",
        description: "Resolved an A record.",
        confidence: 90,
        timestamp: new Date().toISOString(),
        rawData: {},
        verified: true
      }
    ],
    sources: ["dns"]
  })
};

describe("TechnologyFingerprintConnector - pipeline integration", () => {
  const originalFetch = global.fetch;
  const originalTtl = process.env.TECHFINGERPRINT_CACHE_TTL_MS;

  beforeEach(() => {
    process.env.TECHFINGERPRINT_CACHE_TTL_MS = "0";
    // NOTE: InvestigationService keeps *static* full-investigation and
    // per-connector caches that outlive individual service instances, so
    // every test below uses a distinct hostname. Reusing one host would
    // serve an earlier test's cached result - correct production behavior,
    // but it would silently invalidate these assertions.
    mockLookup({
      "merge.example.com": "93.184.216.34",
      "surfaced.example.com": "93.184.216.34",
      "failure.example.com": "93.184.216.34",
      "isolated.example.com": "93.184.216.34"
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalTtl === undefined) delete process.env.TECHFINGERPRINT_CACHE_TTL_MS;
    else process.env.TECHFINGERPRINT_CACHE_TTL_MS = originalTtl;
    vi.clearAllMocks();
  });

  it("merges its Domain entity with another connector's instead of duplicating the node", async () => {
    mockFetchResponse({
      headers: { Server: "nginx/1.24.0" },
      body: "<html></html>"
    });

    const service = new InvestigationService([dnsLikeConnector, new TechnologyFingerprintConnector()]);
    const result = await service.investigate({ term: "merge.example.com", type: "Domain" });

    const domainEntities = result.entities.filter(
      e => e.type === "Domain" && e.name === "merge.example.com"
    );
    expect(domainEntities.length).toBe(1);

    // The Technology entity survives merging as its own distinct node.
    const techEntities = result.entities.filter(e => e.type === "Technology");
    expect(techEntities.map(e => e.name)).toContain("nginx");

    // No entity may carry the resolver's cross-type wildcard "Generic" type.
    expect(result.entities.some(e => e.type === "Generic")).toBe(false);
  });

  it("surfaces its evidence and connector status through the aggregated result", async () => {
    mockFetchResponse({
      headers: { Server: "nginx/1.24.0", "cf-ray": "trace-LHR" },
      body: "<html></html>"
    });

    const service = new InvestigationService([new TechnologyFingerprintConnector()]);
    const result = await service.investigate({ term: "surfaced.example.com", type: "Domain" });

    const status = result.connectorStatuses?.find(s => s.name === "Technology Fingerprint Resolver");
    expect(status?.status).toBe("SUCCESS");
    expect(status?.evidenceCount).toBeGreaterThan(0);

    expect(result.evidences.some(e => e.id === "ev_techfp_nginx")).toBe(true);
    expect(result.evidences.some(e => e.id === "ev_techfp_cloudflare")).toBe(true);
  });

  it("does not break the investigation when it fails - other connectors still resolve", async () => {
    // Unreachable host: the connector must degrade to ERROR in isolation.
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;

    const service = new InvestigationService([dnsLikeConnector, new TechnologyFingerprintConnector()]);
    const result = await service.investigate({ term: "failure.example.com", type: "Domain" });

    const techStatus = result.connectorStatuses?.find(s => s.name === "Technology Fingerprint Resolver");
    expect(techStatus?.status).toBe("ERROR");

    // The healthy connector's data is unaffected.
    const dnsStatus = result.connectorStatuses?.find(s => s.name === "DNS-like Connector");
    expect(dnsStatus?.status).toBe("SUCCESS");
    expect(result.entities.some(e => e.name === "merge.example.com")).toBe(true);

    // A failed fingerprint must contribute no technology claims.
    expect(result.entities.some(e => e.type === "Technology")).toBe(false);
  });

  it("contributes no entities or evidence when it returns NO_DATA", async () => {
    mockFetchResponse({ body: "<html><body>nothing identifiable</body></html>" });

    const service = new InvestigationService([new TechnologyFingerprintConnector()]);
    const result = await service.investigate({ term: "isolated.example.com", type: "Domain" });

    const status = result.connectorStatuses?.find(s => s.name === "Technology Fingerprint Resolver");
    expect(status?.status).toBe("NO_DATA");
    expect(result.entities.some(e => e.type === "Technology")).toBe(false);
  });
});
