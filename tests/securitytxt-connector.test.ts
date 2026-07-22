import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import net from "net";
import dns from "dns/promises";
import { SecurityTxtConnector } from "../src/connectors/securitytxt";

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

describe("SecurityTxtConnector", () => {
  const originalFetch = global.fetch;
  const originalTimeout = process.env.SECURITYTXT_TIMEOUT_MS;

  beforeEach(() => {
    mockLookup({
      "example.com": "93.184.216.34",
      "nodata.example.com": "93.184.216.34",
      "timeout.example.com": "93.184.216.34",
      "malformed.example.com": "93.184.216.34",
      "expired.example.com": "93.184.216.34",
      "fallback.example.com": "93.184.216.34"
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalTimeout === undefined) delete process.env.SECURITYTXT_TIMEOUT_MS;
    else process.env.SECURITYTXT_TIMEOUT_MS = originalTimeout;
    vi.clearAllMocks();
  });

  function mockFetchByPath(handler: (path: string) => { status: number; body?: string; contentType?: string }) {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const path = new URL(url).pathname;
      const { status, body, contentType } = handler(path);
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        text: () => Promise.resolve(body ?? ""),
        headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? (contentType ?? "text/plain") : null) }
      });
    }) as any;
  }

  it("reports SUCCESS and extracts Contact/Policy/Preferred-Languages when a valid file is found", async () => {
    mockFetchByPath((path) => {
      if (path === "/.well-known/security.txt") {
        return {
          status: 200,
          body: [
            "Contact: mailto:security@example.com",
            "Expires: 2099-01-01T00:00:00.000Z",
            "Preferred-Languages: en, fr",
            "Policy: https://example.com/disclosure-policy",
            "Canonical: https://example.com/.well-known/security.txt"
          ].join("\n")
        };
      }
      return { status: 404 };
    });

    const connector = new SecurityTxtConnector();
    const result = await connector.run({ term: "example.com", type: "Domain" });

    expect(result.status).toBe("SUCCESS");
    expect(result.rawData.urlChecked).toBe("https://example.com/.well-known/security.txt");
    expect(result.rawData.contact).toEqual(["mailto:security@example.com"]);
    expect(result.rawData.preferredLanguages).toBe("en, fr");
    expect(result.entities).toEqual([]);

    const detected = result.evidences.find(e => e.id === "ev_securitytxt_detected");
    expect(detected?.confidence).toBe(85);

    const contactEv = result.evidences.find(e => e.id === "ev_securitytxt_contact");
    expect(contactEv?.confidence).toBe(90);
    expect(contactEv?.description).toContain("security@example.com");

    const policyEv = result.evidences.find(e => e.id === "ev_securitytxt_policy");
    expect(policyEv?.confidence).toBe(80);

    const langEv = result.evidences.find(e => e.id === "ev_securitytxt_languages");
    expect(langEv?.confidence).toBe(70);

    expect(result.evidences.find(e => e.id === "ev_securitytxt_expired")).toBeUndefined();
  });

  it("reports NO_DATA when both candidate paths return a clean 404", async () => {
    mockFetchByPath(() => ({ status: 404 }));

    const connector = new SecurityTxtConnector();
    const result = await connector.run({ term: "nodata.example.com", type: "Domain" });

    expect(result.status).toBe("NO_DATA");
    expect(result.error).toBeUndefined();
    expect(result.rawData.info).toMatch(/no security\.txt file/i);
  });

  it("reports ERROR (not NO_DATA or TIMEOUT) when a request exceeds the configured timeout", async () => {
    process.env.SECURITYTXT_TIMEOUT_MS = "50";
    global.fetch = vi.fn().mockImplementation((_url: string, options: any) => {
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as any;

    const connector = new SecurityTxtConnector();
    const result = await connector.run({ term: "timeout.example.com", type: "Domain" });

    expect(result.status).toBe("ERROR");
    expect(result.error).toMatch(/timed out/i);
  });

  it("reports SUCCESS with parseWarnings for a malformed but partially usable file", async () => {
    mockFetchByPath((path) => {
      if (path === "/.well-known/security.txt") {
        return {
          status: 200,
          body: [
            "Contact: mailto:security@example.com",
            "This line has no colon and should be ignored",
            "NotARealField: some-value"
          ].join("\n")
        };
      }
      return { status: 404 };
    });

    const connector = new SecurityTxtConnector();
    const result = await connector.run({ term: "malformed.example.com", type: "Domain" });

    expect(result.status).toBe("SUCCESS");
    expect(result.rawData.parseWarnings.length).toBeGreaterThan(0);
    expect(result.rawData.parseWarnings.some((w: string) => /unparseable/i.test(w))).toBe(true);
    expect(result.rawData.parseWarnings.some((w: string) => /unrecognized field/i.test(w))).toBe(true);
  });

  it("reports the file as expired when Expires is in the past", async () => {
    mockFetchByPath((path) => {
      if (path === "/.well-known/security.txt") {
        return {
          status: 200,
          body: ["Contact: mailto:security@example.com", "Expires: 2020-01-01T00:00:00.000Z"].join("\n")
        };
      }
      return { status: 404 };
    });

    const connector = new SecurityTxtConnector();
    const result = await connector.run({ term: "expired.example.com", type: "Domain" });

    expect(result.status).toBe("SUCCESS");
    const expiredEv = result.evidences.find(e => e.id === "ev_securitytxt_expired");
    expect(expiredEv).toBeDefined();
    expect(expiredEv?.confidence).toBe(40);
    expect(expiredEv?.description).toMatch(/expired/i);
  });

  it("falls back to /security.txt when the well-known path is a clean 404", async () => {
    mockFetchByPath((path) => {
      if (path === "/security.txt") {
        return { status: 200, body: "Contact: mailto:security@example.com" };
      }
      return { status: 404 };
    });

    const connector = new SecurityTxtConnector();
    const result = await connector.run({ term: "fallback.example.com", type: "Domain" });

    expect(result.status).toBe("SUCCESS");
    expect(result.rawData.urlChecked).toBe("https://fallback.example.com/security.txt");
  });

  it("skips non-domain targets (e.g. Organization/Person type) without making any request", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    const connector = new SecurityTxtConnector();
    const result = await connector.run({ term: "Acme Corp", type: "Organization" });

    expect(result.status).toBe("NO_DATA");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
