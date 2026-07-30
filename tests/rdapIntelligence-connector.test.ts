import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RdapIntelligenceConnector } from "../src/connectors/rdapIntelligence";

// The connector reaches the network only through safeFetch, so stubbing the
// guard keeps these tests offline while still exercising the real request
// sequencing (bootstrap first, then the authoritative RDAP service).
const safeFetchMock = vi.fn();
vi.mock("../src/utils/ssrfGuard", () => ({
  safeFetch: (...args: any[]) => safeFetchMock(...args)
}));

/** Minimal Response stand-in matching what the connector actually reads. */
function jsonResponse(body: unknown, status = 200): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body))
  };
}

/** The IANA RDAP bootstrap payload shape (RFC 7484). */
function bootstrapPayload(tld = "com", baseUrl = "https://rdap.verisign.com/com/v1") {
  return {
    version: "1.0",
    publication: "2026-01-01T00:00:00Z",
    services: [
      [["example-other"], ["https://rdap.example-other.test/"]],
      [[tld], [baseUrl]]
    ]
  };
}

/** A representative RDAP domain response (RFC 9083 §5.3). */
function domainPayload(overrides: Record<string, any> = {}) {
  return {
    objectClassName: "domain",
    handle: "2138514_DOMAIN_COM-VRSN",
    ldhName: "example.com",
    status: ["client transfer prohibited", "server delete prohibited"],
    events: [
      { eventAction: "registration", eventDate: "1997-09-15T04:00:00Z" },
      { eventAction: "last changed", eventDate: "2025-08-14T07:01:34Z" },
      { eventAction: "expiration", eventDate: "2028-09-14T04:00:00Z" }
    ],
    entities: [
      {
        handle: "292",
        roles: ["registrar"],
        publicIds: [{ type: "IANA Registrar ID", identifier: "292" }],
        vcardArray: [
          "vcard",
          [
            ["version", {}, "text", "4.0"],
            ["fn", {}, "text", "MarkMonitor Inc."],
            ["org", {}, "text", "MarkMonitor Inc."]
          ]
        ],
        entities: [
          {
            roles: ["abuse"],
            vcardArray: [
              "vcard",
              [
                ["version", {}, "text", "4.0"],
                ["fn", {}, "text", "Abuse Desk"],
                ["email", {}, "text", "abusecomplaints@markmonitor.com"],
                ["tel", {}, "uri", "tel:+1.2086851750"]
              ]
            ]
          }
        ]
      }
    ],
    nameservers: [
      { ldhName: "A.IANA-SERVERS.NET" },
      { ldhName: "B.IANA-SERVERS.NET", ipAddresses: { v4: ["199.43.133.53"] } }
    ],
    secureDNS: { delegationSigned: true, dsData: [{ keyTag: 370, algorithm: 13, digestType: 2, digest: "abc" }] },
    links: [{ rel: "self", href: "https://rdap.verisign.com/com/v1/domain/EXAMPLE.COM" }],
    port43: "whois.verisign-grs.com",
    ...overrides
  };
}

/**
 * Routes requests by URL so tests describe server behaviour rather than
 * call order: the bootstrap file first, then the RDAP service.
 */
function route(handlers: { bootstrap?: any; rdap?: any }) {
  safeFetchMock.mockImplementation(async (url: string) => {
    if (url.includes("dns.json")) {
      if (handlers.bootstrap instanceof Error) throw handlers.bootstrap;
      return handlers.bootstrap ?? jsonResponse(bootstrapPayload());
    }
    if (handlers.rdap instanceof Error) throw handlers.rdap;
    return handlers.rdap ?? jsonResponse(domainPayload());
  });
}

/**
 * The connector caches per domain, and the bootstrap cache is static and
 * outlives instances, so each test uses a distinct domain and clears the
 * bootstrap cache explicitly.
 */
let domainCounter = 0;
function uniqueDomain(tld = "com"): string {
  domainCounter++;
  return `rdap-test-${domainCounter}.${tld}`;
}

function clearBootstrapCache() {
  (RdapIntelligenceConnector as any).bootstrapCache = null;
}

describe("RdapIntelligenceConnector", () => {
  let connector: RdapIntelligenceConnector;

  beforeEach(() => {
    safeFetchMock.mockReset();
    clearBootstrapCache();
    connector = new RdapIntelligenceConnector();
  });

  afterEach(() => {
    delete process.env.RDAP_TIMEOUT_MS;
    delete process.env.RDAP_BOOTSTRAP_URL;
  });

  describe("successful lookup", () => {
    it("returns SUCCESS and transcribes the registrar, registry handle and statuses", async () => {
      route({});
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);

      const registrationEv = result.evidences.find(e => e.id === "ev_rdap_registration");
      expect(registrationEv).toBeDefined();
      expect(registrationEv!.rawData.registrar).toBe("MarkMonitor Inc.");
      expect(registrationEv!.rawData.registrarIanaId).toBe("292");
      expect(registrationEv!.rawData.registryHandle).toBe("2138514_DOMAIN_COM-VRSN");
      expect(registrationEv!.rawData.statuses).toEqual([
        "client transfer prohibited",
        "server delete prohibited"
      ]);
    });

    it("extracts creation, updated and expiration dates from RDAP events", async () => {
      route({});
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const eventsEv = result.evidences.find(e => e.id === "ev_rdap_events");

      expect(eventsEv).toBeDefined();
      expect(eventsEv!.rawData.createdOn).toBe("1997-09-15T04:00:00Z");
      expect(eventsEv!.rawData.updatedOn).toBe("2025-08-14T07:01:34Z");
      expect(eventsEv!.rawData.expiresOn).toBe("2028-09-14T04:00:00Z");
      expect(eventsEv!.rawData.events).toHaveLength(3);
    });

    it("flattens the abuse contact nested under the registrar entity", async () => {
      route({});
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const contactsEv = result.evidences.find(e => e.id === "ev_rdap_contacts");

      expect(contactsEv).toBeDefined();
      expect(contactsEv!.rawData.abuse[0]).toMatchObject({
        role: "abuse",
        email: "abusecomplaints@markmonitor.com",
        phone: "+1.2086851750"
      });
    });

    it("reports technical and administrative contacts when the registry publishes them", async () => {
      route({
        rdap: jsonResponse(
          domainPayload({
            entities: [
              {
                roles: ["technical"],
                vcardArray: ["vcard", [["fn", {}, "text", "Tech Desk"], ["email", {}, "text", "tech@example.com"]]]
              },
              {
                roles: ["administrative"],
                vcardArray: ["vcard", [["fn", {}, "text", "Admin Desk"], ["email", {}, "text", "admin@example.com"]]]
              }
            ]
          })
        )
      });

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const contactsEv = result.evidences.find(e => e.id === "ev_rdap_contacts")!;

      expect(contactsEv.rawData.technical[0].email).toBe("tech@example.com");
      expect(contactsEv.rawData.administrative[0].email).toBe("admin@example.com");
    });

    it("reports delegated nameservers and DNSSEC state", async () => {
      route({});
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      const nsEv = result.evidences.find(e => e.id === "ev_rdap_nameservers")!;
      expect(nsEv.rawData.nameservers.map((n: any) => n.host)).toEqual([
        "a.iana-servers.net",
        "b.iana-servers.net"
      ]);
      expect(nsEv.rawData.nameservers[1].ipv4).toEqual(["199.43.133.53"]);

      const dnssecEv = result.evidences.find(e => e.id === "ev_rdap_dnssec")!;
      expect(dnssecEv.rawData.delegationSigned).toBe(true);
      expect(dnssecEv.rawData.dsRecordCount).toBe(1);
    });

    it("records the RDAP source resolved through the IANA bootstrap registry", async () => {
      route({});
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const diagnostics = result.evidences[0].rawData.diagnostics;

      expect(diagnostics.rdapBaseUrl).toBe("https://rdap.verisign.com/com/v1");
      expect(diagnostics.rdapSource).toBe("https://rdap.verisign.com/com/v1/domain/EXAMPLE.COM");
      expect(diagnostics.port43).toBe("whois.verisign-grs.com");
      expect(diagnostics.source).toBe("RDAP (RFC 9083)");

      // The bootstrap file must be consulted before the RDAP service.
      expect(safeFetchMock.mock.calls[0][0]).toContain("dns.json");
      expect(safeFetchMock.mock.calls[1][0]).toContain("/domain/");
    });

    it("emits Domain, registrar Organization and nameserver entities with relationships", async () => {
      route({});
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.entities.some(e => e.type === "Domain")).toBe(true);
      expect(result.entities.some(e => e.type === "Organization" && e.name === "MarkMonitor Inc.")).toBe(true);
      expect(result.relationships.some(r => r.type === "REGISTERED_THROUGH")).toBe(true);
      expect(result.relationships.some(r => r.type === "DELEGATED_TO")).toBe(true);
    });

    it("attaches diagnostics to every piece of evidence", async () => {
      route({});
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.evidences.length).toBeGreaterThan(0);
      for (const evidence of result.evidences) {
        expect(evidence.id).toMatch(/^ev_rdap_/);
        expect(evidence.connector).toBe("RDAP Intelligence");
        expect(evidence.verified).toBe(true);
        expect(evidence.rawData.diagnostics).toBeDefined();
        expect(typeof evidence.rawData.diagnostics.detectionTimeMs).toBe("number");
      }
    });
  });

  describe("NO_DATA", () => {
    it("returns NO_DATA when the registry answers 404 for the domain", async () => {
      route({ rdap: jsonResponse({}, 404) });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.success).toBe(true);
      expect(result.evidences).toHaveLength(0);
      expect(result.rawData.info).toMatch(/no registration record/i);
    });

    it("returns NO_DATA when the TLD publishes no RDAP service", async () => {
      route({ bootstrap: jsonResponse(bootstrapPayload("com")) });
      const result = await connector.run({ term: uniqueDomain("nordapservice"), type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.rawData.info).toMatch(/no RDAP service/i);
      // The RDAP service is never queried when the TLD has none.
      expect(safeFetchMock.mock.calls).toHaveLength(1);
    });

    it("returns NO_DATA when the registry answers with no reportable detail", async () => {
      route({ rdap: jsonResponse({ objectClassName: "domain" }) });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.evidences).toHaveLength(0);
      expect(result.rawData.info).toMatch(/published no registration detail/i);
    });

    it("skips Organization targets without any network call", async () => {
      route({});
      const result = await connector.run({ term: "Acme Corporation", type: "Organization" });

      expect(result.status).toBe("NO_DATA");
      expect(result.rawData.info).toMatch(/not a domain/i);
      expect(safeFetchMock).not.toHaveBeenCalled();
    });
  });

  describe("ERROR", () => {
    it("returns ERROR when the bootstrap registry is unreachable", async () => {
      route({ bootstrap: new Error("getaddrinfo ENOTFOUND data.iana.org") });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/could not determine the authoritative RDAP service/i);
      expect(result.evidences).toHaveLength(0);
    });

    it("returns ERROR when the RDAP service returns a non-404 HTTP failure", async () => {
      route({ rdap: jsonResponse("Host not in allowlist", 403) });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/HTTP 403/);
    });

    it("returns ERROR — not NO_DATA — when the RDAP response is malformed JSON", async () => {
      route({ rdap: jsonResponse("<html>gateway error</html>") });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/malformed \(non-JSON\)/i);
    });

    it("returns ERROR when the RDAP response is an unexpected shape", async () => {
      route({ rdap: jsonResponse([1, 2, 3]) });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/unexpected payload shape/i);
    });

    it("returns ERROR when the bootstrap payload is the wrong shape", async () => {
      route({ bootstrap: jsonResponse({ nope: true }) });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/unexpected payload shape/i);
    });

    it("returns ERROR when the RDAP service returns an empty body", async () => {
      route({ rdap: jsonResponse("") });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/empty response/i);
    });
  });

  describe("network failures", () => {
    it("returns ERROR when the RDAP service connection fails", async () => {
      route({ rdap: new Error("ECONNREFUSED 199.43.133.53:443") });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/could not reach/i);
      expect(result.error).toMatch(/ECONNREFUSED/);
    });

    it("returns ERROR when the request times out", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      route({ rdap: abortError });

      process.env.RDAP_TIMEOUT_MS = "50";
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/timed out after 50ms/i);
    });

    it("is blocked by the SSRF guard rather than reporting a false absence", async () => {
      route({
        rdap: new Error(
          'SSRF Guard: Target "rdap.internal" resolves to a blocked address (127.0.0.1).'
        )
      });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.status).not.toBe("NO_DATA");
      expect(result.error).toMatch(/SSRF Guard/);
    });
  });

  describe("invalid domains", () => {
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

    it("returns NO_DATA for an IP address target", async () => {
      const result = await connector.run({ term: "8.8.8.8", type: "IPAddress" });

      expect(result.status).toBe("NO_DATA");
      expect(safeFetchMock).not.toHaveBeenCalled();
    });

    it("returns NO_DATA for a single-label term with no TLD", async () => {
      const result = await connector.run({ term: "localhost", type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(safeFetchMock).not.toHaveBeenCalled();
    });
  });

  describe("missing fields", () => {
    it("omits contacts entirely when the registry redacts them", async () => {
      route({ rdap: jsonResponse(domainPayload({ entities: [] })) });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.evidences.find(e => e.id === "ev_rdap_contacts")).toBeUndefined();
      // No registrar was published, so none is invented.
      expect(result.entities.some(e => e.type === "Organization")).toBe(false);
    });

    it("omits DNSSEC evidence when the registry publishes no secureDNS block", async () => {
      const payload = domainPayload();
      delete (payload as any).secureDNS;
      route({ rdap: jsonResponse(payload) });

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      // Absent secureDNS means "not published", which is not the same as
      // "unsigned" - so no DNSSEC claim is made at all.
      expect(result.evidences.find(e => e.id === "ev_rdap_dnssec")).toBeUndefined();
      expect(result.evidences[0].rawData.diagnostics.dnssecPublished).toBe(false);
    });

    it("omits event evidence when the registry publishes no events", async () => {
      route({ rdap: jsonResponse(domainPayload({ events: [] })) });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.evidences.find(e => e.id === "ev_rdap_events")).toBeUndefined();
    });

    it("omits nameserver evidence when the registry publishes none", async () => {
      route({ rdap: jsonResponse(domainPayload({ nameservers: [] })) });
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.evidences.find(e => e.id === "ev_rdap_nameservers")).toBeUndefined();
      expect(result.relationships.some(r => r.type === "DELEGATED_TO")).toBe(false);
    });

    it("drops events that carry an action but no date", async () => {
      route({
        rdap: jsonResponse(
          domainPayload({
            events: [
              { eventAction: "registration", eventDate: "2001-01-01T00:00:00Z" },
              { eventAction: "expiration" }
            ]
          })
        )
      });

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const eventsEv = result.evidences.find(e => e.id === "ev_rdap_events")!;

      expect(eventsEv.rawData.events).toHaveLength(1);
      expect(eventsEv.rawData.expiresOn).toBeUndefined();
    });

    it("ignores structured jCard values rather than stitching them into a guessed string", async () => {
      route({
        rdap: jsonResponse(
          domainPayload({
            entities: [
              {
                roles: ["registrar"],
                vcardArray: [
                  "vcard",
                  [
                    ["version", {}, "text", "4.0"],
                    // `adr` is a structured array value; it must not become a contact string.
                    ["adr", {}, "text", ["", "", "123 Main St", "Springfield", "IL", "62701", "US"]],
                    ["fn", {}, "text", "Registrar Inc."]
                  ]
                ]
              }
            ]
          })
        )
      });

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const registrationEv = result.evidences.find(e => e.id === "ev_rdap_registration")!;

      expect(registrationEv.rawData.registrar).toBe("Registrar Inc.");
      expect(JSON.stringify(registrationEv.rawData)).not.toContain("Springfield");
    });

    it("still reports registration facts when only statuses are published", async () => {
      route({
        rdap: jsonResponse({
          objectClassName: "domain",
          status: ["active"]
        })
      });

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      const registrationEv = result.evidences.find(e => e.id === "ev_rdap_registration")!;
      expect(registrationEv.rawData.statuses).toEqual(["active"]);
      expect(registrationEv.rawData.registrar).toBeUndefined();
    });
  });

  describe("connector contract", () => {
    it("only ever returns SUCCESS, NO_DATA or ERROR", async () => {
      const setups: Array<() => void> = [
        () => route({}),
        () => route({ rdap: jsonResponse({}, 404) }),
        () => route({ rdap: new Error("boom") }),
        () => route({ bootstrap: new Error("boom") }),
        () => route({ rdap: jsonResponse({ objectClassName: "domain" }) })
      ];

      for (const setup of setups) {
        safeFetchMock.mockReset();
        clearBootstrapCache();
        setup();
        const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
        expect(["SUCCESS", "NO_DATA", "ERROR"]).toContain(result.status);
      }
    });

    it("honours RDAP_BOOTSTRAP_URL for mirrored bootstrap registries", async () => {
      process.env.RDAP_BOOTSTRAP_URL = "https://mirror.example.test/rdap/dns.json";
      safeFetchMock.mockImplementation(async (url: string) => {
        if (url.includes("mirror.example.test")) return jsonResponse(bootstrapPayload());
        return jsonResponse(domainPayload());
      });

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(safeFetchMock.mock.calls[0][0]).toBe("https://mirror.example.test/rdap/dns.json");
    });
  });
});
