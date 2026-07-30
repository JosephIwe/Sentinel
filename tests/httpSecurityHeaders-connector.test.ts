import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpSecurityHeadersConnector } from "../src/connectors/httpSecurityHeaders";

// The connector reaches the network only through safeFetch, so stubbing the
// guard keeps these tests offline while leaving the header inspection itself
// entirely real.
const safeFetchMock = vi.fn();
vi.mock("../src/utils/ssrfGuard", () => ({
  safeFetch: (...args: any[]) => safeFetchMock(...args)
}));

/**
 * Minimal Response stand-in. Uses a real Headers object so lookups are
 * case-insensitive exactly as they are against a live response.
 */
function httpResponse(headers: Record<string, string>, status = 200, url = "https://example.test/"): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Headers(headers)
  };
}

/** A response carrying a strong, complete set of security headers. */
const STRONG_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'; script-src 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "geolocation=(), camera=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
  "cross-origin-resource-policy": "same-origin"
};

let domainCounter = 0;
function uniqueDomain(): string {
  domainCounter++;
  return `headers-test-${domainCounter}.example`;
}

describe("HttpSecurityHeadersConnector", () => {
  let connector: HttpSecurityHeadersConnector;

  beforeEach(() => {
    safeFetchMock.mockReset();
    (HttpSecurityHeadersConnector as any).cache.clear();
    connector = new HttpSecurityHeadersConnector();
  });

  afterEach(() => {
    delete process.env.HTTPHEADERS_TIMEOUT_MS;
  });

  describe("strong security headers", () => {
    it("returns SUCCESS and reports every present header with its value", async () => {
      safeFetchMock.mockResolvedValue(httpResponse(STRONG_HEADERS));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);

      const presentEv = result.evidences.find(e => e.id === "ev_headers_present")!;
      const names = presentEv.rawData.present.map((h: any) => h.name);
      expect(names).toContain("strict-transport-security");
      expect(names).toContain("content-security-policy");
      expect(names).toContain("cross-origin-resource-policy");

      const hsts = presentEv.rawData.present.find((h: any) => h.name === "strict-transport-security");
      expect(hsts.value).toBe("max-age=63072000; includeSubDomains; preload");
    });

    it("reports no missing security headers when all are present", async () => {
      safeFetchMock.mockResolvedValue(httpResponse(STRONG_HEADERS));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.evidences.find(e => e.id === "ev_headers_missing")).toBeUndefined();
      expect(result.rawData.missing).toEqual([]);
    });

    it("raises no observations against a well-formed header set", async () => {
      safeFetchMock.mockResolvedValue(httpResponse(STRONG_HEADERS));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const observations = result.rawData.observations.filter(
        (o: any) => o.header !== "cross-origin-opener-policy"
      );

      expect(observations).toEqual([]);
    });

    it("reports cross-origin isolation from the COOP and COEP pair", async () => {
      safeFetchMock.mockResolvedValue(httpResponse(STRONG_HEADERS));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const isolation = result.rawData.observations.find((o: any) => /cross-origin isolated/i.test(o.observation));

      expect(isolation).toBeDefined();
      expect(isolation.evidenceValue).toContain("same-origin");
      expect(isolation.evidenceValue).toContain("require-corp");
    });

    it("attaches diagnostics to every piece of evidence", async () => {
      safeFetchMock.mockResolvedValue(httpResponse(STRONG_HEADERS));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.evidences.length).toBeGreaterThan(0);
      for (const evidence of result.evidences) {
        expect(evidence.id).toMatch(/^ev_headers_/);
        expect(evidence.connector).toBe("HTTP Security Headers");
        expect(evidence.verified).toBe(true);
        expect(evidence.rawData.diagnostics).toBeDefined();
        expect(evidence.rawData.diagnostics.source).toBe("HTTPS response headers");
        expect(evidence.rawData.diagnostics.bodyRead).toBe(false);
        expect(typeof evidence.rawData.diagnostics.detectionTimeMs).toBe("number");
      }
    });

    it("requests HTTPS and never reads the response body", async () => {
      const response = httpResponse(STRONG_HEADERS);
      response.text = vi.fn();
      response.json = vi.fn();
      safeFetchMock.mockResolvedValue(response);

      const domain = uniqueDomain();
      await connector.run({ term: domain, type: "Domain" });

      expect(safeFetchMock.mock.calls[0][0]).toBe(`https://${domain}/`);
      expect(response.text).not.toHaveBeenCalled();
      expect(response.json).not.toHaveBeenCalled();
    });
  });

  describe("partial headers", () => {
    it("reports present and missing headers side by side", async () => {
      safeFetchMock.mockResolvedValue(
        httpResponse({
          "strict-transport-security": "max-age=63072000; includeSubDomains",
          "x-content-type-options": "nosniff"
        })
      );

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      const present = result.evidences.find(e => e.id === "ev_headers_present")!.rawData.present;
      const missing = result.evidences.find(e => e.id === "ev_headers_missing")!.rawData.missing;

      expect(present.map((h: any) => h.name).sort()).toEqual([
        "strict-transport-security",
        "x-content-type-options"
      ]);
      expect(missing.map((h: any) => h.name)).toContain("content-security-policy");
      expect(missing.map((h: any) => h.name)).toContain("x-frame-options");
    });

    it("observes a short HSTS max-age and quotes the directive it read", async () => {
      safeFetchMock.mockResolvedValue(
        httpResponse({ "strict-transport-security": "max-age=600; includeSubDomains" })
      );

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const observation = result.rawData.observations.find((o: any) => /180-day/.test(o.observation));

      expect(observation).toBeDefined();
      expect(observation.evidenceValue).toBe("max-age=600");
    });

    it("observes HSTS preload requested below the required max-age", async () => {
      safeFetchMock.mockResolvedValue(
        httpResponse({ "strict-transport-security": "max-age=86400; includeSubDomains; preload" })
      );

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const observation = result.rawData.observations.find((o: any) => /preload list requires/.test(o.observation));

      expect(observation).toBeDefined();
    });

    it("observes a missing includeSubDomains directive", async () => {
      safeFetchMock.mockResolvedValue(httpResponse({ "strict-transport-security": "max-age=63072000" }));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.rawData.observations.some((o: any) => /omits includeSubDomains/.test(o.observation))).toBe(true);
    });

    it("observes unsafe-inline and unsafe-eval in a CSP", async () => {
      safeFetchMock.mockResolvedValue(
        httpResponse({
          "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'none'"
        })
      );

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const tokens = result.rawData.observations.map((o: any) => o.evidenceValue);

      expect(tokens).toContain("'unsafe-inline'");
      expect(tokens).toContain("'unsafe-eval'");
    });

    it("observes a wildcard default-src", async () => {
      safeFetchMock.mockResolvedValue(
        httpResponse({ "content-security-policy": "default-src *; frame-ancestors 'none'" })
      );

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.rawData.observations.some((o: any) => /bare wildcard/.test(o.observation))).toBe(true);
    });

    it("observes an invalid X-Content-Type-Options value", async () => {
      safeFetchMock.mockResolvedValue(httpResponse({ "x-content-type-options": "nosnif" }));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const observation = result.rawData.observations.find((o: any) => o.header === "x-content-type-options");

      expect(observation).toBeDefined();
      expect(observation.evidenceValue).toBe("nosnif");
    });

    it("observes the obsolete X-Frame-Options ALLOW-FROM form", async () => {
      safeFetchMock.mockResolvedValue(httpResponse({ "x-frame-options": "ALLOW-FROM https://example.com" }));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.rawData.observations.some((o: any) => /obsolete/i.test(o.observation))).toBe(true);
    });

    it("observes a permissive Referrer-Policy value", async () => {
      safeFetchMock.mockResolvedValue(httpResponse({ "referrer-policy": "unsafe-url" }));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.rawData.observations.some((o: any) => /full URL/.test(o.observation))).toBe(true);
    });

    it("reports Server and X-Powered-By verbatim without inferring a product", async () => {
      safeFetchMock.mockResolvedValue(
        httpResponse({ server: "nginx/1.24.0", "x-powered-by": "Express" })
      );

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const disclosureEv = result.evidences.find(e => e.id === "ev_headers_disclosure")!;

      expect(disclosureEv.rawData.disclosures.map((h: any) => h.value).sort()).toEqual(["Express", "nginx/1.24.0"]);
      expect(disclosureEv.description).toMatch(/no version or product is inferred/i);
    });

    it("does not list an absent Server header as a missing security header", async () => {
      safeFetchMock.mockResolvedValue(httpResponse(STRONG_HEADERS));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.rawData.missing.map((h: any) => h.name)).not.toContain("server");
      expect(result.rawData.missing.map((h: any) => h.name)).not.toContain("x-powered-by");
      expect(result.rawData.missing.map((h: any) => h.name)).not.toContain("cache-control");
    });
  });

  describe("missing headers", () => {
    it("returns SUCCESS and lists every absent security header", async () => {
      safeFetchMock.mockResolvedValue(httpResponse({ "content-type": "text/html" }));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      const missing = result.evidences.find(e => e.id === "ev_headers_missing")!.rawData.missing;

      expect(missing).toHaveLength(9);
      expect(result.evidences.find(e => e.id === "ev_headers_present")).toBeUndefined();
    });

    it("states each absent header's purpose without judging the site", async () => {
      safeFetchMock.mockResolvedValue(httpResponse({}));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const missingEv = result.evidences.find(e => e.id === "ev_headers_missing")!;

      expect(missingEv.rawData.missing[0].purpose).toBeTruthy();
      expect(missingEv.description).toMatch(/returned none of the following/i);
    });
  });

  describe("redirects", () => {
    it("records the final URL when safeFetch followed a redirect", async () => {
      const domain = uniqueDomain();
      safeFetchMock.mockResolvedValue(
        httpResponse(STRONG_HEADERS, 200, `https://www.${domain}/home`)
      );

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.rawData.redirected).toBe(true);
      expect(result.rawData.finalUrl).toBe(`https://www.${domain}/home`);
      expect(result.evidences[0].rawData.diagnostics.redirected).toBe(true);
      expect(result.evidences[0].description).toMatch(/was redirected to/);
    });

    it("does not treat a trailing-slash-only difference as a redirect", async () => {
      const domain = uniqueDomain();
      safeFetchMock.mockResolvedValue(httpResponse(STRONG_HEADERS, 200, `https://${domain}`));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.rawData.redirected).toBe(false);
    });

    it("attributes headers to the final URL after a redirect", async () => {
      const domain = uniqueDomain();
      safeFetchMock.mockResolvedValue(
        httpResponse({ "x-content-type-options": "nosniff" }, 200, `https://cdn.${domain}/`)
      );

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.sources).toEqual([`https://cdn.${domain}/`]);
      expect(result.evidences[0].url).toBe(`https://cdn.${domain}/`);
    });
  });

  describe("HTTP errors", () => {
    it("still inspects headers on a 403 response and records the status", async () => {
      safeFetchMock.mockResolvedValue(httpResponse({ "x-frame-options": "DENY" }, 403));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      // The headers on an error response are still the headers the server sent.
      expect(result.status).toBe("SUCCESS");
      expect(result.rawData.httpStatus).toBe(403);
      expect(result.evidences[0].rawData.diagnostics.errorResponse).toBe(true);
    });

    it("says in the evidence which response the headers came from", async () => {
      safeFetchMock.mockResolvedValue(httpResponse({ "x-frame-options": "DENY" }, 500));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.evidences[0].description).toMatch(/read from an HTTP 500 response/);
    });

    it("does not mark a 2xx response as an error response", async () => {
      safeFetchMock.mockResolvedValue(httpResponse(STRONG_HEADERS, 204));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.evidences[0].rawData.diagnostics.errorResponse).toBe(false);
    });
  });

  describe("network failures", () => {
    it("returns ERROR when the connection fails", async () => {
      safeFetchMock.mockRejectedValue(new Error("ECONNREFUSED 203.0.113.1:443"));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Could not reach/i);
      expect(result.error).toMatch(/ECONNREFUSED/);
      expect(result.evidences).toHaveLength(0);
    });

    it("returns ERROR when the request times out", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      safeFetchMock.mockRejectedValue(abortError);
      process.env.HTTPHEADERS_TIMEOUT_MS = "50";

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/timed out after 50ms/i);
    });

    it("returns ERROR — not a false 'no headers' — when the SSRF guard blocks the target", async () => {
      safeFetchMock.mockRejectedValue(
        new Error('SSRF Guard: Target "internal.test" resolves to a blocked address (127.0.0.1).')
      );

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.status).not.toBe("NO_DATA");
      expect(result.error).toMatch(/SSRF Guard/);
    });

    it("returns ERROR when TLS negotiation fails", async () => {
      safeFetchMock.mockRejectedValue(new Error("unable to verify the first certificate"));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/certificate/i);
    });
  });

  describe("NO_DATA", () => {
    it("does not fall back to NO_DATA when a response simply has no security headers", async () => {
      // NO_DATA would understate this: the server answered, and every
      // security header being absent is itself the finding.
      safeFetchMock.mockResolvedValue(httpResponse({}));
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.rawData.missing.length).toBeGreaterThan(0);
    });

    it("skips IP address targets without a request", async () => {
      const result = await connector.run({ term: "8.8.8.8", type: "IPAddress" });

      expect(result.status).toBe("NO_DATA");
      expect(result.rawData.info).toMatch(/not a domain/i);
      expect(safeFetchMock).not.toHaveBeenCalled();
    });

    it("skips Organization targets without a request", async () => {
      const result = await connector.run({ term: "Acme Corporation", type: "Organization" });

      expect(result.status).toBe("NO_DATA");
      expect(safeFetchMock).not.toHaveBeenCalled();
    });

    it("returns NO_DATA for an empty term", async () => {
      const result = await connector.run({ term: "   ", type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(safeFetchMock).not.toHaveBeenCalled();
    });

    it("returns NO_DATA for a term that is not a hostname", async () => {
      const result = await connector.run({ term: "not a domain!!", type: "Generic" });

      expect(result.status).toBe("NO_DATA");
      expect(safeFetchMock).not.toHaveBeenCalled();
    });
  });

  describe("connector contract", () => {
    it("only ever returns SUCCESS, NO_DATA or ERROR", async () => {
      const setups: Array<() => void> = [
        () => safeFetchMock.mockResolvedValue(httpResponse(STRONG_HEADERS)),
        () => safeFetchMock.mockResolvedValue(httpResponse({}, 404)),
        () => safeFetchMock.mockRejectedValue(new Error("boom"))
      ];

      for (const setup of setups) {
        safeFetchMock.mockReset();
        (HttpSecurityHeadersConnector as any).cache.clear();
        setup();
        const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
        expect(["SUCCESS", "NO_DATA", "ERROR"]).toContain(result.status);
      }
    });

    it("emits a Domain entity carrying the header posture", async () => {
      const domain = uniqueDomain();
      safeFetchMock.mockResolvedValue(httpResponse(STRONG_HEADERS));

      const result = await connector.run({ term: domain, type: "Domain" });
      const entity = result.entities.find(e => e.type === "Domain")!;

      expect(entity.name).toBe(domain);
      expect(entity.metadata.securityHeadersPresent).toContain("strict-transport-security");
      expect(entity.metadata.securityHeadersMissing).toEqual([]);
    });

    it("matches headers case-insensitively as HTTP requires", async () => {
      safeFetchMock.mockResolvedValue(
        httpResponse({ "Strict-Transport-Security": "max-age=63072000; includeSubDomains", "X-Frame-Options": "DENY" })
      );

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const names = result.rawData.present.map((h: any) => h.name);

      expect(names).toContain("strict-transport-security");
      expect(names).toContain("x-frame-options");
    });

    it("truncates an unreasonably long header value rather than carrying it whole", async () => {
      safeFetchMock.mockResolvedValue(
        httpResponse({ "content-security-policy": `default-src 'self'; frame-ancestors 'none'; img-src ${"https://cdn.example.com ".repeat(60)}` })
      );

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const csp = result.rawData.present.find((h: any) => h.name === "content-security-policy");

      expect(csp.value.length).toBeLessThanOrEqual(401);
      expect(csp.value.endsWith("…")).toBe(true);
    });
  });
});
