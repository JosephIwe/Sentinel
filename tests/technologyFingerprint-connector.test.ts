import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import net from "net";
import dns from "dns/promises";
import { TechnologyFingerprintConnector } from "../src/connectors/technologyFingerprint";

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
      "versionless.example.com": "93.184.216.34",
      "assets.example.com": "93.184.216.34",
      "security.example.com": "93.184.216.34",
      "analytics.example.com": "93.184.216.34",
      "cloud.example.com": "93.184.216.34",
      "invalidhtml.example.com": "93.184.216.34",
      "empty.example.com": "93.184.216.34",
      "netfail.example.com": "93.184.216.34",
      "falsepositive.example.com": "93.184.216.34",
      "diagnostics.example.com": "93.184.216.34"
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

  describe("asset URL inspection (script / CSS)", () => {
    it("detects frameworks and analytics from <script src> URLs", async () => {
      mockFetchResponse({
        body: `<html><head>
          <script src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
          <script src="/_next/static/chunks/main.js"></script>
        </head><body></body></html>`
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "analytics.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("SUCCESS");
      const ga = result.evidences.find(e => e.id === "ev_techfp_google_analytics");
      expect(ga?.rawData.matchSource).toBe("script-url");
      expect(ga?.rawData.category).toBe("Analytics");
      expect(result.evidences.find(e => e.id === "ev_techfp_next_js")).toBeDefined();
    });

    it("detects technologies from stylesheet <link href> URLs", async () => {
      mockFetchResponse({
        body: `<html><head>
          <link rel="stylesheet" href="/wp-content/themes/twentytwenty/style.css">
        </head></html>`
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "assets.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("SUCCESS");
      const wp = result.evidences.find(e => e.id === "ev_techfp_wordpress");
      expect(wp).toBeDefined();
      expect(["css-url", "html-marker"]).toContain(wp?.rawData.matchSource);
    });

    it("ignores non-stylesheet <link> tags when collecting CSS URLs", async () => {
      mockFetchResponse({
        body: `<html><head>
          <link rel="preconnect" href="https://cdn.shopify.com">
        </head></html>`
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "assets.example.com",
        type: "Domain"
      });

      // The preconnect hint is not a stylesheet, so it must not be inspected
      // as a CSS asset. Any Shopify finding here could only come from the
      // whole-document marker pass, never from css-url.
      const shopify = result.evidences.find(e => e.id === "ev_techfp_shopify");
      expect(shopify?.rawData.matchSource).not.toBe("css-url");
    });
  });

  describe("security headers", () => {
    it("reports HSTS, CSP, Referrer-Policy and Permissions-Policy with their actual values", async () => {
      mockFetchResponse({
        headers: {
          "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
          "Content-Security-Policy": "default-src 'self'",
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "Permissions-Policy": "geolocation=()"
        },
        body: "<html></html>"
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "security.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("SUCCESS");
      const hsts = result.evidences.find(e => e.id === "ev_techfp_hsts");
      expect(hsts?.confidence).toBe(95);
      expect(hsts?.rawData.category).toBe("Security");
      // Unlike vendor trace IDs, the policy value IS the finding.
      expect(hsts?.rawData.matchedValue).toContain("max-age=63072000");

      expect(result.evidences.find(e => e.id === "ev_techfp_content_security_policy")).toBeDefined();
      expect(result.evidences.find(e => e.id === "ev_techfp_referrer_policy")).toBeDefined();
      expect(result.evidences.find(e => e.id === "ev_techfp_permissions_policy")).toBeDefined();
    });

    it("does not report a security header that is absent or empty", async () => {
      mockFetchResponse({
        headers: { "Strict-Transport-Security": "", Server: "nginx" },
        body: "<html></html>"
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "security.example.com",
        type: "Domain"
      });

      expect(result.evidences.find(e => e.id === "ev_techfp_hsts")).toBeUndefined();
    });
  });

  describe("cloud platform detection", () => {
    it("detects AWS, Azure and Google Cloud from their infrastructure headers", async () => {
      mockFetchResponse({
        headers: { "x-amz-request-id": "REQ123", "x-azure-ref": "AZ123", "x-goog-generation": "1" },
        body: "<html></html>"
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "cloud.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("SUCCESS");
      expect(result.evidences.find(e => e.id === "ev_techfp_aws")?.rawData.category).toBe("Cloud Platform");
      expect(result.evidences.find(e => e.id === "ev_techfp_azure")).toBeDefined();
      expect(result.evidences.find(e => e.id === "ev_techfp_google_cloud")).toBeDefined();
    });
  });

  describe("resilience and edge cases", () => {
    it("still reports header-derived findings when the HTML body is invalid/unparseable", async () => {
      mockFetchResponse({
        headers: { Server: "nginx/1.25.0" },
        body: "<<<>>> not really html at all &&& <script src= unterminated"
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "invalidhtml.example.com",
        type: "Domain"
      });

      // Malformed markup must not throw, and must not discard valid header signal.
      expect(result.status).toBe("SUCCESS");
      expect(result.evidences.find(e => e.id === "ev_techfp_nginx")).toBeDefined();
    });

    it("returns NO_DATA for a completely empty response body with no headers", async () => {
      mockFetchResponse({ headers: {}, body: "" });

      const result = await new TechnologyFingerprintConnector().run({
        term: "empty.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("NO_DATA");
      expect(result.evidences).toEqual([]);
      expect(result.rawData.diagnostics.technologiesFound).toBe(0);
    });

    it("returns ERROR on a network failure, never a false NO_DATA", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;

      const result = await new TechnologyFingerprintConnector().run({
        term: "netfail.example.com",
        type: "Domain"
      });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/could not reach/i);
      expect(result.evidences).toEqual([]);
    });

    it("handles a response with no headers at all without throwing", async () => {
      mockFetchResponse({ headers: {}, body: "<html><body>plain</body></html>" });

      const result = await new TechnologyFingerprintConnector().run({
        term: "empty.example.com",
        type: "Domain"
      });

      expect(["NO_DATA", "SUCCESS"]).toContain(result.status);
      expect(result.error).toBeUndefined();
    });
  });

  describe("false-positive prevention", () => {
    it("does not detect a technology merely named in page prose", async () => {
      mockFetchResponse({
        body: `<html><body>
          <article>
            We migrated from WordPress to Drupal last year, and we use
            Google Analytics and React on our other properties. Our CDN is Cloudflare.
          </article>
        </body></html>`
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "falsepositive.example.com",
        type: "Domain"
      });

      // None of these are backed by a header, asset URL, runtime global or
      // generator tag - only prose - so none may be reported.
      expect(result.status).toBe("NO_DATA");
      expect(result.evidences).toEqual([]);
    });

    it("does not treat a bare mention inside a script URL's query string as a framework bundle", async () => {
      mockFetchResponse({
        body: `<html><head>
          <script src="/analytics/collect.js?ref=we-love-react-and-vue"></script>
        </head></html>`
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "falsepositive.example.com",
        type: "Domain"
      });

      // The bundle-name patterns require a real react/vue filename, not the
      // words appearing in a query parameter.
      expect(result.evidences.find(e => e.id === "ev_techfp_react")).toBeUndefined();
      expect(result.evidences.find(e => e.id === "ev_techfp_vue")).toBeUndefined();
    });
  });

  describe("diagnostics", () => {
    it("reports detection time, methods applied and technology count", async () => {
      mockFetchResponse({
        headers: { Server: "nginx/1.25.0", "Strict-Transport-Security": "max-age=3600" },
        body: `<html><head>
          <meta name="generator" content="WordPress 6.5">
          <script src="/wp-content/themes/x/app.js"></script>
          <link rel="stylesheet" href="/wp-content/themes/x/style.css">
        </head></html>`
      });

      const result = await new TechnologyFingerprintConnector().run({
        term: "diagnostics.example.com",
        type: "Domain"
      });

      const d = result.rawData.diagnostics;
      expect(typeof d.detectionTimeMs).toBe("number");
      expect(d.detectionTimeMs).toBeGreaterThanOrEqual(0);
      expect(d.technologiesFound).toBe(result.evidences.length);
      expect(d.detectionMethods).toEqual(
        expect.arrayContaining(["header", "security-header", "meta-generator", "script-url", "css-url"])
      );
      expect(d.scriptUrlsInspected).toBe(1);
      expect(d.cssUrlsInspected).toBe(1);
    });
  });
});
