import { describe, it, expect, vi, beforeEach } from "vitest";
import { DnsConnector } from "../src/connectors/dns";
import dns from "dns/promises";

vi.mock("dns/promises", () => ({
  default: {
    resolve4: vi.fn(),
    resolve6: vi.fn(),
    resolveMx: vi.fn(),
    resolveNs: vi.fn(),
    resolveTxt: vi.fn(),
    resolveCname: vi.fn(),
    reverse: vi.fn()
  }
}));

function mockAllRejected() {
  const notFound = { code: "ENOTFOUND" };
  vi.mocked(dns.resolve4).mockRejectedValue(notFound);
  vi.mocked(dns.resolve6).mockRejectedValue(notFound);
  vi.mocked(dns.resolveMx).mockRejectedValue(notFound);
  vi.mocked(dns.resolveNs).mockRejectedValue(notFound);
  vi.mocked(dns.resolveTxt).mockRejectedValue(notFound);
  vi.mocked(dns.resolveCname).mockRejectedValue(notFound);
}

describe("DnsConnector - non-domain-shaped queries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAllRejected();
  });

  it("returns NO_DATA instead of resolving an unrelated fallback domain for a company-name query", async () => {
    const connector = new DnsConnector();
    const result = await connector.run({ term: "Acme Corp", type: "Organization" });

    expect(result.status).toBe("NO_DATA");
    expect(result.error).toBe("No valid domain could be derived from the investigation target.");
    expect(result.entities).toHaveLength(0);
    // Must never fabricate an entity for the platform's own infrastructure domain.
    expect(JSON.stringify(result)).not.toContain("sentinel-gateway.net");
    expect(dns.resolve4).not.toHaveBeenCalled();
  });

  it("still resolves normally for an actual domain query", async () => {
    vi.mocked(dns.resolve4).mockResolvedValue(["93.184.216.34"]);

    const connector = new DnsConnector();
    const result = await connector.run({ term: "example-target.io", type: "Domain" });

    expect(result.status).toBe("SUCCESS");
    expect(result.entities.some(e => e.name === "example-target.io")).toBe(true);
  });
});
