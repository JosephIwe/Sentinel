import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import net from "net";
import dns from "dns/promises";
import { CertificateTransparencyConnector } from "../src/connectors/certificateTransparency";

// safeFetch resolves the hostname before every request - replicate real
// dns.lookup behavior for literal IPs and register crt.sh for each test.
vi.mock("dns/promises", () => ({
  default: { lookup: vi.fn() }
}));

function mockLookup() {
  vi.mocked(dns.lookup).mockImplementation(async (hostname: any) => {
    if (net.isIP(hostname)) {
      return [{ address: hostname, family: net.isIPv4(hostname) ? 4 : 6 }] as any;
    }
    // crt.sh is the only host this connector contacts.
    if (hostname === "crt.sh") {
      return [{ address: "93.184.216.34", family: 4 }] as any;
    }
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
  });
}

function mockCrtShResponse(opts: { status?: number; body?: string }) {
  const { status = 200, body = "[]" } = opts;
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    headers: { get: () => null }
  }) as any;
}

/** Builds a crt.sh-shaped record. Mirrors the real API's field names. */
function crtRecord(over: Record<string, any> = {}) {
  return {
    issuer_ca_id: 16418,
    issuer_name: "C=US, O=Let's Encrypt, CN=R3",
    common_name: "example.com",
    name_value: "example.com\nwww.example.com",
    id: 6142815541,
    entry_timestamp: "2026-01-01T00:00:00.000",
    not_before: "2026-01-01T00:00:00",
    not_after: "2099-04-01T00:00:00",
    serial_number: "03a1b2c3d4e5",
    ...over
  };
}

describe("CertificateTransparencyConnector", () => {
  const originalFetch = global.fetch;
  const originalTtl = process.env.CT_CACHE_TTL_MS;
  const originalTimeout = process.env.CT_TIMEOUT_MS;

  beforeEach(() => {
    // Disable the connector cache so each test performs a real lookup.
    process.env.CT_CACHE_TTL_MS = "0";
    mockLookup();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalTtl === undefined) delete process.env.CT_CACHE_TTL_MS;
    else process.env.CT_CACHE_TTL_MS = originalTtl;
    if (originalTimeout === undefined) delete process.env.CT_TIMEOUT_MS;
    else process.env.CT_TIMEOUT_MS = originalTimeout;
    vi.clearAllMocks();
  });

  describe("SUCCESS", () => {
    it("extracts issuer, common name, SANs, validity dates and serial number", async () => {
      mockCrtShResponse({ body: JSON.stringify([crtRecord()]) });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      expect(result.status).toBe("SUCCESS");
      expect(result.verified).toBe(true);

      const certs = result.evidences.find(e => e.id === "ev_ct_certificates");
      expect(certs?.confidence).toBe(95);
      const first = certs?.rawData.certificates[0];
      expect(first.issuer).toContain("Let's Encrypt");
      expect(first.commonName).toBe("example.com");
      expect(first.serialNumber).toBe("03a1b2c3d4e5");
      expect(first.notBefore).toBe("2026-01-01T00:00:00");
      expect(first.notAfter).toBe("2099-04-01T00:00:00");
      expect(first.names).toEqual(["example.com", "www.example.com"]);
      expect(first.crtShId).toBe(6142815541);

      const issuers = result.evidences.find(e => e.id === "ev_ct_issuers");
      expect(issuers?.rawData.issuers[0].issuer).toContain("Let's Encrypt");

      const validity = result.evidences.find(e => e.id === "ev_ct_validity");
      expect(validity?.rawData.activeCertificates).toBe(1);
      expect(validity?.rawData.expiredCertificates).toBe(0);
    });

    it("discovers subdomains from SANs and emits them as linked Domain entities", async () => {
      mockCrtShResponse({
        body: JSON.stringify([
          crtRecord({ name_value: "example.com\napi.example.com\nmail.example.com" })
        ])
      });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      const subs = result.evidences.find(e => e.id === "ev_ct_subdomains");
      expect(subs?.rawData.subdomains).toEqual(["api.example.com", "mail.example.com"]);
      expect(subs?.confidence).toBe(88);

      // The apex is the parent node; subdomains hang off it.
      const apex = result.entities.find(e => e.name === "example.com");
      const api = result.entities.find(e => e.name === "api.example.com");
      expect(apex?.type).toBe("Domain");
      expect(api?.type).toBe("Domain");
      expect(result.entities.some(e => e.type === "Generic")).toBe(false);

      const rel = result.relationships.find(r => r.target === api?.id);
      expect(rel?.type).toBe("HAS_SUBDOMAIN");
      expect(rel?.source).toBe(apex?.id);
    });

    it("records a wildcard SAN without treating the wildcard itself as a subdomain", async () => {
      mockCrtShResponse({
        body: JSON.stringify([crtRecord({ name_value: "example.com\n*.example.com" })])
      });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      const subs = result.evidences.find(e => e.id === "ev_ct_subdomains");
      // "*.example.com" normalizes to the apex, which is not a subdomain.
      expect(subs).toBeUndefined();
      const certs = result.evidences.find(e => e.id === "ev_ct_certificates");
      expect(certs?.rawData.certificates[0].names).toContain("*.example.com");
    });

    it("flags expired certificates using the actual not_after date", async () => {
      mockCrtShResponse({
        body: JSON.stringify([
          crtRecord({ not_after: "2020-01-01T00:00:00", id: 1 }),
          crtRecord({ not_after: "2099-01-01T00:00:00", id: 2 })
        ])
      });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      const validity = result.evidences.find(e => e.id === "ev_ct_validity");
      expect(validity?.rawData.expiredCertificates).toBe(1);
      expect(validity?.rawData.activeCertificates).toBe(1);
    });

    it("never reports a certificate fingerprint, because crt.sh does not expose one", async () => {
      mockCrtShResponse({ body: JSON.stringify([crtRecord()]) });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      const certs = result.evidences.find(e => e.id === "ev_ct_certificates");
      expect(certs?.rawData.fingerprintsAvailable).toBe(false);
      // No fabricated fingerprint field anywhere in the payload.
      expect(JSON.stringify(result)).not.toMatch(/"(sha1|sha256|fingerprint)"\s*:/i);
    });
  });

  describe("NO_DATA", () => {
    it("returns NO_DATA when the CT log genuinely holds no records", async () => {
      mockCrtShResponse({ body: "[]" });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      expect(result.status).toBe("NO_DATA");
      expect(result.error).toBeUndefined();
      expect(result.evidences).toEqual([]);
      expect(result.entities).toEqual([]);
      expect(result.rawData.certificatesFound).toBe(0);
    });

    it("returns NO_DATA when records exist but none name the target domain", async () => {
      mockCrtShResponse({
        body: JSON.stringify([crtRecord({ name_value: "unrelated.org\nwww.unrelated.org" })])
      });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      expect(result.status).toBe("NO_DATA");
      expect(result.rawData.info).toMatch(/none contained a name belonging to example\.com/i);
      expect(result.evidences).toEqual([]);
    });
  });

  describe("ERROR", () => {
    it("returns ERROR (never NO_DATA) on a network failure", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      expect(result.status).toBe("ERROR");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/could not reach/i);
      expect(result.evidences).toEqual([]);
    });

    it("returns ERROR on a timeout", async () => {
      process.env.CT_TIMEOUT_MS = "50";
      global.fetch = vi.fn().mockImplementation((_url: string, options: any) => {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      }) as any;

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/timed out/i);
    });

    it("returns ERROR on a non-2xx response from crt.sh", async () => {
      mockCrtShResponse({ status: 502, body: "Bad Gateway" });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/502/);
    });

    it("returns ERROR (never NO_DATA) on a malformed non-JSON response", async () => {
      mockCrtShResponse({ body: "<html>gateway error</html>" });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/malformed/i);
      expect(result.evidences).toEqual([]);
    });

    it("returns ERROR on an empty response body rather than assuming zero certificates", async () => {
      mockCrtShResponse({ body: "   " });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/empty response/i);
    });

    it("returns ERROR when the payload is valid JSON but not an array", async () => {
      mockCrtShResponse({ body: JSON.stringify({ message: "rate limited" }) });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/unexpected payload shape/i);
    });
  });

  describe("invalid domains", () => {
    it("skips an IP address target without making a request", async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as any;

      const result = await new CertificateTransparencyConnector().run({
        term: "8.8.8.8",
        type: "Domain"
      });

      expect(result.status).toBe("NO_DATA");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("skips an Organization/Person target without making a request", async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as any;

      const result = await new CertificateTransparencyConnector().run({
        term: "Acme Corp",
        type: "Organization"
      });

      expect(result.status).toBe("NO_DATA");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("skips a malformed domain string without making a request", async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as any;

      const result = await new CertificateTransparencyConnector().run({
        term: "not a domain!!",
        type: "Domain"
      });

      expect(result.status).toBe("NO_DATA");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("false-positive prevention", () => {
    it("does not attribute unrelated domains sharing a certificate to the target", async () => {
      // One real certificate covering several unrelated tenants - a very
      // common shared-hosting/SaaS pattern.
      mockCrtShResponse({
        body: JSON.stringify([
          crtRecord({
            name_value: "example.com\napi.example.com\nvictim-corp.net\nwww.other-tenant.org"
          })
        ])
      });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      const subs = result.evidences.find(e => e.id === "ev_ct_subdomains");
      expect(subs?.rawData.subdomains).toEqual(["api.example.com"]);
      expect(JSON.stringify(result)).not.toContain("victim-corp.net");
      expect(JSON.stringify(result)).not.toContain("other-tenant.org");
      // The rejections are counted, so the omission is visible, not silent.
      expect(subs?.rawData.namesRejectedAsUnrelated).toBe(2);
    });

    it("rejects lookalike suffixes that merely end with the target string", async () => {
      mockCrtShResponse({
        body: JSON.stringify([
          crtRecord({ name_value: "example.com\nnotexample.com\nevil-example.com" })
        ])
      });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      expect(JSON.stringify(result)).not.toContain("notexample.com");
      expect(JSON.stringify(result)).not.toContain("evil-example.com");
    });

    it("rejects email (rfc822Name) SAN entries", async () => {
      mockCrtShResponse({
        body: JSON.stringify([
          crtRecord({ name_value: "example.com\nadmin@example.com" })
        ])
      });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      expect(JSON.stringify(result)).not.toContain("admin@example.com");
    });

    it("drops a record entirely when every one of its names is unrelated", async () => {
      mockCrtShResponse({
        body: JSON.stringify([
          crtRecord({ name_value: "example.com", id: 1 }),
          crtRecord({ name_value: "totally-unrelated.io", id: 2, issuer_name: "C=US, O=Other CA, CN=X" })
        ])
      });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      const certs = result.evidences.find(e => e.id === "ev_ct_certificates");
      expect(certs?.rawData.certificateCount).toBe(1);
      // The unrelated record's issuer must not appear in the issuer list.
      const issuers = result.evidences.find(e => e.id === "ev_ct_issuers");
      expect(JSON.stringify(issuers?.rawData)).not.toContain("Other CA");
    });
  });

  describe("evidence contract", () => {
    it("emits evidence matching the shared Evidence shape with diagnostics", async () => {
      mockCrtShResponse({
        body: JSON.stringify([crtRecord({ name_value: "example.com\napi.example.com" })])
      });

      const result = await new CertificateTransparencyConnector().run({
        term: "example.com",
        type: "Domain"
      });

      expect(result.evidences.length).toBeGreaterThan(0);
      for (const ev of result.evidences) {
        expect(ev.id).toMatch(/^ev_ct_/);
        expect(ev.connector).toBe("Certificate Transparency Resolver");
        expect(typeof ev.title).toBe("string");
        expect(typeof ev.description).toBe("string");
        expect(typeof ev.confidence).toBe("number");
        expect(typeof ev.timestamp).toBe("string");
        expect(ev.rawData).toBeDefined();
        expect(ev.verified).toBe(true);
        expect(ev.rawData.diagnostics.source).toBe("crt.sh");
        expect(typeof ev.rawData.diagnostics.detectionTimeMs).toBe("number");
      }
    });
  });
});
