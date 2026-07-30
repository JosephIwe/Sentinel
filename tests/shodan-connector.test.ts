import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import dns from "dns/promises";
import { ShodanConnector } from "../src/connectors/shodan";

// The connector reaches Shodan only through safeFetch. Stubbing the guard
// keeps these tests offline while leaving the response handling real;
// isBlockedAddress is deliberately NOT stubbed, so private-address rejection
// is exercised against the genuine block list.
const safeFetchMock = vi.fn();
vi.mock("../src/utils/ssrfGuard", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/utils/ssrfGuard")>();
  return { ...actual, safeFetch: (...args: any[]) => safeFetchMock(...args) };
});

vi.mock("dns/promises", () => ({
  default: { resolve4: vi.fn(), resolve6: vi.fn() }
}));

const mockedDns = dns as unknown as {
  resolve4: ReturnType<typeof vi.fn>;
  resolve6: ReturnType<typeof vi.fn>;
};

function dnsError(code: string, message = "dns failure"): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

function apiResponse(body: unknown, status = 200): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body))
  };
}

/** A representative Shodan host record. */
function hostPayload(overrides: Record<string, any> = {}) {
  return {
    ip_str: "203.0.113.10",
    org: "Example Hosting Ltd",
    asn: "AS64500",
    isp: "Example ISP",
    hostnames: ["web01.example.net"],
    domains: ["example.net"],
    ports: [443, 80, 22],
    os: "Ubuntu",
    country_name: "Netherlands",
    country_code: "NL",
    city: "Amsterdam",
    last_update: "2026-07-01T12:00:00.000000",
    data: [
      {
        port: 443,
        transport: "tcp",
        product: "nginx",
        version: "1.24.0",
        data: "HTTP/1.1 200 OK\r\nServer: nginx/1.24.0\r\n",
        _shodan: { module: "https" },
        timestamp: "2026-07-01T12:00:00.000000"
      },
      {
        port: 22,
        transport: "tcp",
        product: "OpenSSH",
        version: "9.6p1",
        data: "SSH-2.0-OpenSSH_9.6p1",
        _shodan: { module: "ssh" }
      }
    ],
    ...overrides
  };
}

let counter = 0;
function uniqueDomain(): string {
  counter++;
  return `shodan-test-${counter}.example`;
}

describe("ShodanConnector", () => {
  let connector: ShodanConnector;

  beforeEach(() => {
    safeFetchMock.mockReset();
    mockedDns.resolve4 = vi.fn().mockRejectedValue(dnsError("ENODATA"));
    mockedDns.resolve6 = vi.fn().mockRejectedValue(dnsError("ENODATA"));
    (ShodanConnector as any).cache.clear();
    process.env.SHODAN_API_KEY = "test-key-abc123";
    connector = new ShodanConnector();
  });

  afterEach(() => {
    delete process.env.SHODAN_API_KEY;
    delete process.env.SHODAN_TIMEOUT_MS;
    delete process.env.SHODAN_CACHE_TTL_MS;
  });

  describe("configured successful lookup", () => {
    it("returns SUCCESS and transcribes the host record", async () => {
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload()));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("SUCCESS");
      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);

      const host = result.evidences.find(e => e.id === "ev_shodan_host")!.rawData.hosts[0];
      expect(host).toMatchObject({
        ip: "203.0.113.10",
        organization: "Example Hosting Ltd",
        asn: "AS64500",
        isp: "Example ISP",
        country: "Netherlands",
        countryCode: "NL"
      });
      expect(host.hostnames).toEqual(["web01.example.net"]);
      expect(host.domains).toEqual(["example.net"]);
    });

    it("sends the API key to the Shodan host endpoint", async () => {
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload()));

      await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      const url = safeFetchMock.mock.calls[0][0];
      expect(url).toContain("https://api.shodan.io/shodan/host/203.0.113.10");
      expect(url).toContain("key=test-key-abc123");
    });

    it("reports open ports sorted, with a note that they reflect Shodan's last scan", async () => {
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload()));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });
      const portsEv = result.evidences.find(e => e.id === "ev_shodan_ports")!;

      expect(portsEv.rawData.openPorts).toEqual([22, 80, 443]);
      expect(portsEv.description).toMatch(/not a live check/i);
    });

    it("reports the operating system only where Shodan states one", async () => {
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload()));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });
      const osEv = result.evidences.find(e => e.id === "ev_shodan_os")!;

      expect(osEv.rawData.operatingSystems[0]).toMatchObject({ ip: "203.0.113.10", os: "Ubuntu" });
    });

    it("resolves a domain target to its public addresses before querying", async () => {
      const domain = uniqueDomain();
      mockedDns.resolve4 = vi.fn(async (n: string) => (n === domain ? ["203.0.113.10"] : Promise.reject(dnsError("ENODATA"))));
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload()));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(safeFetchMock.mock.calls[0][0]).toContain("/shodan/host/203.0.113.10");
      expect(result.relationships.some(r => r.type === "RESOLVES_TO")).toBe(true);
    });

    it("emits IPAddress and Organization entities linked by HOSTED_BY", async () => {
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload()));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.entities.some(e => e.type === "IPAddress" && e.name === "203.0.113.10")).toBe(true);
      expect(result.entities.some(e => e.type === "Organization" && e.name === "Example Hosting Ltd")).toBe(true);
      expect(result.relationships.some(r => r.type === "HOSTED_BY")).toBe(true);
      // An IP target is emitted once, not duplicated as a separate node.
      expect(result.entities.filter(e => e.type === "IPAddress" && e.name === "203.0.113.10")).toHaveLength(1);
    });
  });

  describe("missing API key", () => {
    it("returns NO_DATA with a clear not-configured diagnostic", async () => {
      delete process.env.SHODAN_API_KEY;

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("NO_DATA");
      expect(result.success).toBe(true);
      expect(result.error).toMatch(/Shodan is not configured/i);
      expect(result.rawData.diagnostics.configured).toBe(false);
    });

    it("makes no API request when unconfigured", async () => {
      delete process.env.SHODAN_API_KEY;

      await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(safeFetchMock).not.toHaveBeenCalled();
    });

    it("fabricates no evidence when unconfigured", async () => {
      delete process.env.SHODAN_API_KEY;

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.evidences).toHaveLength(0);
      expect(result.entities).toHaveLength(0);
      // The wording must not let "unconfigured" read as "target is clean".
      expect(result.error).toMatch(/says nothing about the target's actual internet exposure/i);
    });

    it("treats a whitespace-only key as unconfigured", async () => {
      process.env.SHODAN_API_KEY = "   ";

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("NO_DATA");
      expect(safeFetchMock).not.toHaveBeenCalled();
    });
  });

  describe("authentication failures", () => {
    it("returns ERROR — not NO_DATA — on 401", async () => {
      safeFetchMock.mockResolvedValue(apiResponse({ error: "Invalid API key" }, 401));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("ERROR");
      expect(result.status).not.toBe("NO_DATA");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/rejected the API key \(HTTP 401\)/i);
      expect(result.error).toMatch(/SHODAN_API_KEY/);
    });

    it("returns ERROR on 403", async () => {
      safeFetchMock.mockResolvedValue(apiResponse({ error: "Access denied" }, 403));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/HTTP 403/);
    });
  });

  describe("rate limiting", () => {
    it("returns ERROR — not NO_DATA — on 429", async () => {
      safeFetchMock.mockResolvedValue(apiResponse({ error: "Rate limit exceeded" }, 429));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("ERROR");
      expect(result.status).not.toBe("NO_DATA");
      expect(result.error).toMatch(/rate limit exceeded/i);
      expect(result.evidences).toHaveLength(0);
    });
  });

  describe("server errors", () => {
    it("returns ERROR on 500", async () => {
      safeFetchMock.mockResolvedValue(apiResponse("Internal Server Error", 500));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/HTTP 500/);
    });

    it("returns ERROR on 503", async () => {
      safeFetchMock.mockResolvedValue(apiResponse("Service Unavailable", 503));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/HTTP 503/);
    });

    it("returns ERROR on a malformed (non-JSON) 200 response", async () => {
      safeFetchMock.mockResolvedValue(apiResponse("<html>gateway</html>"));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/malformed \(non-JSON\)/i);
    });

    it("returns ERROR when a 200 carries an unexpected error envelope", async () => {
      safeFetchMock.mockResolvedValue(apiResponse({ error: "Membership required to access this endpoint" }));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/Membership required/);
    });
  });

  describe("timeout and network failure", () => {
    it("returns ERROR when the connection fails", async () => {
      safeFetchMock.mockRejectedValue(new Error("ECONNREFUSED 1.2.3.4:443"));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/Could not reach the Shodan API/i);
      expect(result.error).toMatch(/ECONNREFUSED/);
    });

    it("returns ERROR when the request times out", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      safeFetchMock.mockRejectedValue(abortError);
      process.env.SHODAN_TIMEOUT_MS = "50";

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/timed out after 50ms/i);
    });

    it("returns ERROR when the target's DNS resolution fails outright", async () => {
      mockedDns.resolve4 = vi.fn().mockRejectedValue(dnsError("ESERVFAIL"));
      mockedDns.resolve6 = vi.fn().mockRejectedValue(dnsError("ESERVFAIL"));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/DNS resolver failed/i);
    });
  });

  describe("no Shodan data", () => {
    it("returns NO_DATA on an authoritative 404", async () => {
      safeFetchMock.mockResolvedValue(apiResponse({ error: "No information available for that IP." }, 404));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("NO_DATA");
      expect(result.success).toBe(true);
      expect(result.evidences).toHaveLength(0);
      expect(result.rawData.info).toMatch(/holds no record/i);
    });

    it("returns NO_DATA on a 200 'no information available' envelope", async () => {
      safeFetchMock.mockResolvedValue(apiResponse({ error: "No information available for that IP." }));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("NO_DATA");
    });
  });

  describe("address handling", () => {
    it("queries a public IPv4 target directly", async () => {
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload()));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("SUCCESS");
      expect(mockedDns.resolve4).not.toHaveBeenCalled();
      expect(safeFetchMock).toHaveBeenCalledTimes(1);
    });

    it("queries a public IPv6 target directly", async () => {
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload({ ip_str: "2001:db8::1" })));

      const result = await connector.run({ term: "2001:db8::1", type: "IPAddress" });

      expect(result.status).toBe("SUCCESS");
      expect(safeFetchMock.mock.calls[0][0]).toContain(encodeURIComponent("2001:db8::1"));
      expect(result.rawData.hosts[0].family).toBe("IPv6");
    });

    it("rejects a private IPv4 target without querying Shodan", async () => {
      const result = await connector.run({ term: "10.0.0.5", type: "IPAddress" });

      expect(result.status).toBe("NO_DATA");
      expect(result.rawData.info).toMatch(/non-public/i);
      expect(safeFetchMock).not.toHaveBeenCalled();
    });

    it("rejects loopback, link-local and reserved addresses", async () => {
      for (const ip of ["127.0.0.1", "169.254.169.254", "192.168.1.1", "224.0.0.1", "::1"]) {
        (ShodanConnector as any).cache.clear();
        const result = await connector.run({ term: ip, type: "IPAddress" });
        expect(result.status).toBe("NO_DATA");
        expect(safeFetchMock).not.toHaveBeenCalled();
      }
    });

    it("filters non-public addresses out of a domain's resolution set", async () => {
      const domain = uniqueDomain();
      mockedDns.resolve4 = vi.fn(async (n: string) =>
        n === domain ? ["10.0.0.5", "203.0.113.10", "127.0.0.1"] : Promise.reject(dnsError("ENODATA"))
      );
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload()));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(safeFetchMock).toHaveBeenCalledTimes(1);
      expect(safeFetchMock.mock.calls[0][0]).toContain("203.0.113.10");
      expect(result.rawData.diagnostics.ipsSkippedNonPublic).toBe(2);
    });

    it("returns NO_DATA when a domain resolves only to non-public addresses", async () => {
      const domain = uniqueDomain();
      mockedDns.resolve4 = vi.fn(async (n: string) => (n === domain ? ["10.0.0.5"] : Promise.reject(dnsError("ENODATA"))));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(safeFetchMock).not.toHaveBeenCalled();
    });

    it("skips Organization targets and malformed IPs without a request", async () => {
      for (const q of [
        { term: "Acme Corporation", type: "Organization" as const },
        { term: "999.999.999.999", type: "Generic" as const },
        { term: "   ", type: "Domain" as const }
      ]) {
        const result = await connector.run(q);
        expect(result.status).toBe("NO_DATA");
      }
      expect(safeFetchMock).not.toHaveBeenCalled();
    });
  });

  describe("multiple returned services", () => {
    it("reports every service with its port, transport, product and version", async () => {
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload()));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });
      const services = result.evidences.find(e => e.id === "ev_shodan_services")!.rawData.services[0].services;

      expect(services).toHaveLength(2);
      expect(services[0]).toMatchObject({ port: 443, transport: "tcp", product: "nginx", version: "1.24.0", module: "https" });
      expect(services[1]).toMatchObject({ port: 22, transport: "tcp", product: "OpenSSH", version: "9.6p1" });
    });

    it("reports a service with no product as an open port with its banner, inventing nothing", async () => {
      safeFetchMock.mockResolvedValue(
        apiResponse(
          hostPayload({
            data: [{ port: 8080, transport: "tcp", data: "Server: SomeUnknownDaemon/3.2", _shodan: { module: "http" } }]
          })
        )
      );

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });
      const service = result.evidences.find(e => e.id === "ev_shodan_services")!.rawData.services[0].services[0];

      expect(service.product).toBeUndefined();
      expect(service.version).toBeUndefined();
      expect(service.bannerExcerpt).toBe("Server: SomeUnknownDaemon/3.2");
      expect(service.module).toBe("http");
    });

    it("omits a version Shodan did not state, even when the banner contains one", async () => {
      safeFetchMock.mockResolvedValue(
        apiResponse(hostPayload({ data: [{ port: 80, transport: "tcp", product: "nginx", data: "Server: nginx/1.99.9" }] }))
      );

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });
      const service = result.evidences.find(e => e.id === "ev_shodan_services")!.rawData.services[0].services[0];

      expect(service.product).toBe("nginx");
      expect(service.version).toBeUndefined();
    });

    it("never reports vulnerabilities, even when Shodan returns them", async () => {
      safeFetchMock.mockResolvedValue(
        apiResponse(hostPayload({ vulns: { "CVE-2024-0001": { verified: false, cvss: 9.8 } } }))
      );

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(JSON.stringify(result)).not.toContain("CVE-2024-0001");
      expect(result.rawData.diagnostics.vulnerabilitiesReported).toBe(false);
    });

    it("truncates an over-long banner rather than carrying it whole", async () => {
      safeFetchMock.mockResolvedValue(
        apiResponse(hostPayload({ data: [{ port: 80, transport: "tcp", data: "A".repeat(2000) }] }))
      );

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });
      const service = result.evidences.find(e => e.id === "ev_shodan_services")!.rawData.services[0].services[0];

      expect(service.bannerExcerpt.length).toBeLessThanOrEqual(401);
      expect(service.bannerExcerpt.endsWith("…")).toBe(true);
    });
  });

  describe("evidence generation", () => {
    it("produces well-formed, verified, grounded evidence", async () => {
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload()));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.evidences.length).toBe(4);
      for (const evidence of result.evidences) {
        expect(evidence.id).toMatch(/^ev_shodan_/);
        expect(evidence.connector).toBe("Shodan Intelligence");
        expect(evidence.title.length).toBeGreaterThan(0);
        expect(evidence.description.length).toBeGreaterThan(0);
        expect(evidence.confidence).toBeGreaterThan(0);
        expect(evidence.confidence).toBeLessThanOrEqual(100);
        expect(evidence.verified).toBe(true);
        expect(evidence.timestamp).toBeTruthy();
        expect(evidence.rawData).toBeDefined();
      }
    });

    it("omits evidence for anything Shodan did not return", async () => {
      safeFetchMock.mockResolvedValue(
        apiResponse({ ip_str: "203.0.113.10", ports: [], data: [], hostnames: [], domains: [] })
      );

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      expect(result.status).toBe("SUCCESS");
      expect(result.evidences.find(e => e.id === "ev_shodan_host")).toBeDefined();
      expect(result.evidences.find(e => e.id === "ev_shodan_ports")).toBeUndefined();
      expect(result.evidences.find(e => e.id === "ev_shodan_services")).toBeUndefined();
      expect(result.evidences.find(e => e.id === "ev_shodan_os")).toBeUndefined();
      // No organization published, so none is invented.
      expect(result.entities.some(e => e.type === "Organization")).toBe(false);
    });
  });

  describe("diagnostics", () => {
    it("attaches diagnostics to every piece of evidence", async () => {
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload()));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

      for (const evidence of result.evidences) {
        expect(evidence.rawData.diagnostics).toBeDefined();
        expect(evidence.rawData.diagnostics.source).toBe("Shodan host API");
        expect(evidence.rawData.diagnostics.configured).toBe(true);
        expect(typeof evidence.rawData.diagnostics.detectionTimeMs).toBe("number");
      }
    });

    it("records address accounting in diagnostics", async () => {
      safeFetchMock.mockResolvedValue(apiResponse(hostPayload()));

      const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });
      const d = result.rawData.diagnostics;

      expect(d).toMatchObject({
        ipsQueried: 1,
        ipsWithData: 1,
        ipsWithoutData: 0,
        lookupFailures: 0,
        vulnerabilitiesReported: false
      });
      expect(d.openPortCount).toBe(3);
      expect(d.serviceCount).toBe(2);
      expect(d.productsIdentified).toBe(2);
    });
  });

  describe("status contract", () => {
    it("only ever returns SUCCESS, NO_DATA or ERROR", async () => {
      const setups: Array<() => void> = [
        () => safeFetchMock.mockResolvedValue(apiResponse(hostPayload())),
        () => safeFetchMock.mockResolvedValue(apiResponse({ error: "No information available for that IP." }, 404)),
        () => safeFetchMock.mockResolvedValue(apiResponse({}, 401)),
        () => safeFetchMock.mockResolvedValue(apiResponse({}, 429)),
        () => safeFetchMock.mockResolvedValue(apiResponse({}, 500)),
        () => safeFetchMock.mockRejectedValue(new Error("network down"))
      ];

      for (const setup of setups) {
        safeFetchMock.mockReset();
        (ShodanConnector as any).cache.clear();
        setup();
        const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });
        expect(["SUCCESS", "NO_DATA", "ERROR"]).toContain(result.status);
      }
    });

    it("never reports an authentication or rate-limit failure as an absence", async () => {
      for (const status of [401, 403, 429]) {
        safeFetchMock.mockReset();
        (ShodanConnector as any).cache.clear();
        safeFetchMock.mockResolvedValue(apiResponse({ error: "denied" }, status));

        const result = await connector.run({ term: "203.0.113.10", type: "IPAddress" });

        expect(result.status).toBe("ERROR");
        expect(result.success).toBe(false);
      }
    });
  });
});
