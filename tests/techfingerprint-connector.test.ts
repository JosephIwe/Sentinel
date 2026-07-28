import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import net from "net";
import dns from "dns/promises";
import { TechnologyFingerprintConnector } from "../src/connectors/techfingerprint";

// safeFetch resolves the hostname before every request - replicate real
// dns.lookup behavior for literal IPs and let each test register the
// resolution for the domain under test via mockLookup().
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

/**
 * Builds a fetch mock returning the given headers/body. Header lookups are
 * case-insensitive, matching the real Headers interface the connector uses.
 */
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

describe("TechnologyFingerprintConnector", () => {
  const originalFetch = global.fetch;
  const originalTimeout = process.env.TECHFINGERPRINT_TIMEOUT_MS;
  const originalTtl = process.env.TECHFINGERPRINT_CACHE_TTL_MS;

  beforeEach(() => {
    // Disable the connector cache so each test exercises a real fetch.
    process.env.TECHFINGERPRINT_CACHE_TTL_MS = "0";
    mockLookup({
      "headers.example.com": "93.184.216.34",
      "html.example.com": "93.184.216.34",
      "cookies.example.com": "93.184.216.34",
      "vendor.example.com": "93.184.216.34",
      "corroborated.example.com": "93.184.216.34",
      "nodata.example.com": "93.184.216.34",
      "timeout.example.com": "93.184.216.34",
      "servererror.example.com": "93.184.216.34",
      "versionless.example.com": "93.184.216.34"
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalTimeout === undefined) delete process.env.TECHFINGERPRINT_TIMEOUT_MS;
    else process.env.TECHFINGERPRINT_TIMEOUT_MS = originalTimeout;
    if (originalTtl === undefined) delete process.env.TECHFINGERPRINT_CACHE_TTL_MS;
    else process.env.TECHFINGERPRINT_CACHE_TTL_MS = originalTtl;
    vi.clearAllMocks();
  });

  describe("status semantics", () => {
    it("reports SUCCESS and extracts versions from Server / X-Powered-By headers", async () => {
      mockFetchResponse({
        headers: { Server: "nginx/1.18.0", "X-Powered-By": "PHP/8.1.2" },
        body: "<html><body>hello</body></html>"
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "headers.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("SUCCESS");
      expect(result.rawData.urlChecked).toBe("https://headers.example.com/");

      const nginx = result.evidences.find(e => e.id === "ev_techfp_nginx");
      expect(nginx).toBeDefined();
      expect(nginx?.rawData.version).toBe("1.18.0");
      expect(nginx?.rawData.matchedOn).toBe("header:server");
      expect(nginx?.confidence).toBe(90);

      const php = result.evidences.find(e => e.id === "ev_techfp_php");
      expect(php?.rawData.version).toBe("8.1.2");
      expect(php?.rawData.matchedOn).toBe("header:x-powered-by");
    });

    it("reports NO_DATA when the page is fetched cleanly but matches no signature", async () => {
      mockFetchResponse({
        headers: { "Content-Type": "text/html" },
        body: "<html><body>A plain page with no fingerprints.</body></html>"
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "nodata.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("NO_DATA");
      expect(result.error).toBeUndefined();
      expect(result.evidences).toEqual([]);
      expect(result.entities).toEqual([]);
      expect(result.rawData.technologiesDetected).toBe(0);
      expect(result.rawData.info).toMatch(/no known technology signature/i);
    });

    it("reports ERROR (never NO_DATA) when the request times out", async () => {
      process.env.TECHFINGERPRINT_TIMEOUT_MS = "50";
      global.fetch = vi.fn().mockImplementation((_url: string, options: any) => {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }) as any;

      const result = await new TechnologyFingerprintConnector().run({
        term: "timeout.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("ERROR");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/timed out/i);
      expect(result.evidences).toEqual([]);
    });

    it("reports ERROR (never NO_DATA) on a non-2xx response", async () => {
      mockFetchResponse({ status: 503, headers: { Server: "nginx" } });

      const result = await new TechnologyFingerprintConnector().run({
        term: "servererror.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/503/);
      // An unreachable page must not yield technology claims.
      expect(result.evidences).toEqual([]);
    });

    it("skips non-domain targets without making any request", async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as any;

      const result = await new TechnologyFingerprintConnector().run({
        term: "Acme Corp",
        type: "Organization"
      });

      expect(result.status).toBe("NO_DATA");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("detection sources", () => {
    it("detects a CMS from the meta generator tag and HTML asset markers", async () => {
      mockFetchResponse({
        body: `<html><head><meta name="generator" content="WordPress 6.4.2" /></head>
               <body><link href="/wp-content/themes/x/style.css" /></body></html>`
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "html.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("SUCCESS");
      const wp = result.evidences.find(e => e.id === "ev_techfp_wordpress");
      expect(wp).toBeDefined();
      expect(wp?.rawData.version).toBe("6.4.2");
      // Two independent signals (meta generator + /wp-content/) corroborate.
      expect(wp?.rawData.corroboratingSources.length).toBeGreaterThan(1);
    });

    it("detects frameworks from Set-Cookie names at lower confidence than self-reported headers", async () => {
      mockFetchResponse({
        headers: { "Set-Cookie": "laravel_session=abc123; Path=/; HttpOnly" },
        body: "<html></html>"
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "cookies.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("SUCCESS");
      const laravel = result.evidences.find(e => e.id === "ev_techfp_laravel");
      expect(laravel?.confidence).toBe(70);
      expect(laravel?.rawData.matchSource).toBe("cookie");
      // The cookie VALUE must never be recorded - only its name.
      expect(JSON.stringify(laravel?.rawData)).not.toContain("abc123");
    });

    it("detects vendors from proprietary headers without recording their trace-ID values", async () => {
      mockFetchResponse({
        headers: { "cf-ray": "7d4f2a1b9c8e0000-LHR" },
        body: "<html></html>"
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "vendor.example.com",
        type: "Domain"
      });

      const cloudflare = result.evidences.find(e => e.id === "ev_techfp_cloudflare");
      expect(cloudflare?.confidence).toBe(85);
      expect(cloudflare?.rawData.matchedValue).toBe("cf-ray header present");
      expect(JSON.stringify(cloudflare?.rawData)).not.toContain("7d4f2a1b9c8e0000");
    });
  });

  describe("anti-fabrication guarantees", () => {
    it("records an auditable matchedOn/matchedValue for every single detection", async () => {
      mockFetchResponse({
        headers: { Server: "Apache/2.4.41", "cf-ray": "abc-LHR", "Set-Cookie": "PHPSESSID=x; Path=/" },
        body: `<html><head><meta name="generator" content="Drupal 10"></head>
               <body><script src="/_next/static/chunk.js"></script></body></html>`
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "corroborated.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("SUCCESS");
      expect(result.evidences.length).toBeGreaterThan(0);
      for (const evidence of result.evidences) {
        expect(evidence.rawData.matchedOn).toBeTruthy();
        expect(evidence.rawData.matchedValue).toBeTruthy();
        expect(evidence.verified).toBe(true);
        expect(evidence.connector).toBe("Technology Fingerprint Resolver");
        // Confidence must stay inside the documented tier range.
        expect(evidence.confidence).toBeGreaterThanOrEqual(70);
        expect(evidence.confidence).toBeLessThanOrEqual(95);
      }
    });

    it("omits the version field entirely when no version is observable", async () => {
      mockFetchResponse({
        headers: { Server: "nginx" }, // no version token
        body: "<html></html>"
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "versionless.example.com",
        type: "Domain"
      });

      const nginx = result.evidences.find(e => e.id === "ev_techfp_nginx");
      expect(nginx).toBeDefined();
      // Must be undefined - never a guessed or placeholder version.
      expect(nginx?.rawData.version).toBeUndefined();
      expect(nginx?.title).not.toMatch(/\d/);
    });

    it("emits Technology entities linked to the target Domain, and never a Generic type", async () => {
      mockFetchResponse({
        headers: { Server: "nginx/1.20.0" },
        body: "<html></html>"
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "headers.example.com",
        type: "Domain"
      });

      const domainEntity = result.entities.find(e => e.type === "Domain");
      const techEntity = result.entities.find(e => e.type === "Technology");
      expect(domainEntity?.name).toBe("headers.example.com");
      expect(techEntity?.name).toBe("nginx");

      // "Generic" is eligible for the entity resolver's cross-type wildcard
      // match, so this connector must never emit it.
      expect(result.entities.some(e => e.type === "Generic")).toBe(false);

      const relationship = result.relationships.find(r => r.type === "RUNS_TECHNOLOGY");
      expect(relationship?.source).toBe(domainEntity?.id);
      expect(relationship?.target).toBe(techEntity?.id);
      expect(relationship?.evidenceIds.length).toBeGreaterThan(0);
    });

    it("marks every result verified so it passes the pipeline's verified-data gate", async () => {
      mockFetchResponse({ headers: { Server: "nginx/1.20.0" }, body: "<html></html>" });

      const result = await new TechnologyFingerprintConnector().run({
        term: "headers.example.com",
        type: "Domain"
      });

      expect(result.verified).toBe(true);
      expect(result.sources).toEqual(["https://headers.example.com/"]);
    });
  });
});
