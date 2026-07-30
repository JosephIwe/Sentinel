import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import dns from "dns/promises";
import { AsnIpIntelligenceConnector } from "../src/connectors/asnIpIntelligence";

vi.mock("dns/promises", () => ({
  default: {
    resolve4: vi.fn(),
    resolve6: vi.fn(),
    resolveTxt: vi.fn()
  }
}));

const mockedDns = dns as unknown as {
  resolve4: ReturnType<typeof vi.fn>;
  resolve6: ReturnType<typeof vi.fn>;
  resolveTxt: ReturnType<typeof vi.fn>;
};

/** Builds a DNS error carrying the code Node's resolver would set. */
function dnsError(code: string, message = "dns failure"): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/** A Team Cymru origin answer: `ASN | BGP Prefix | CC | Registry | Allocated`. */
function originTxt(
  asn: string,
  cidr: string,
  cc = "US",
  registry = "arin",
  allocated = "2014-03-28"
): string[][] {
  return [[`${asn} | ${cidr} | ${cc} | ${registry} | ${allocated}`]];
}

/** A Team Cymru AS answer: `ASN | CC | Registry | Allocated | AS Name`. */
function asNameTxt(
  asn: string,
  org: string,
  cc = "US",
  registry = "arin",
  allocated = "2010-07-14"
): string[][] {
  return [[`${asn} | ${cc} | ${registry} | ${allocated} | ${org}`]];
}

/**
 * Routes a resolveTxt call to the right canned answer based on the query
 * name, so tests describe the source's behaviour rather than call order.
 */
function routeTxt(routes: Record<string, string[][] | Error>) {
  return vi.fn(async (name: string) => {
    for (const [fragment, answer] of Object.entries(routes)) {
      if (name.includes(fragment)) {
        if (answer instanceof Error) throw answer;
        return answer;
      }
    }
    throw dnsError("ENOTFOUND", `no record for ${name}`);
  });
}

/**
 * The connector caches per `${type}:${host}` in a static map that outlives
 * instances, so every test uses a distinct hostname.
 */
let hostCounter = 0;
function uniqueHost(): string {
  hostCounter++;
  return `asn-test-${hostCounter}.example`;
}

describe("AsnIpIntelligenceConnector", () => {
  let connector: AsnIpIntelligenceConnector;

  beforeEach(() => {
    // mockReset (not clearAllMocks) so a resolution stubbed by one test does
    // not leak into the next and silently satisfy it.
    mockedDns.resolve4.mockReset();
    mockedDns.resolve6.mockReset();
    mockedDns.resolveTxt = vi.fn(async (name: string) => {
      throw dnsError("ENOTFOUND", `no record for ${name}`);
    });
    connector = new AsnIpIntelligenceConnector();
    mockedDns.resolve4.mockRejectedValue(dnsError("ENODATA"));
    mockedDns.resolve6.mockRejectedValue(dnsError("ENODATA"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("SUCCESS", () => {
    it("reports ASN, CIDR, registry, country and allocation date for a resolved domain", async () => {
      mockedDns.resolve4.mockResolvedValue(["104.16.132.229"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": originTxt("13335", "104.16.128.0/20", "US", "arin", "2014-03-28"),
        "AS13335.asn.cymru.com": asNameTxt("13335", "CLOUDFLARENET - Cloudflare, Inc., US")
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);

      const networksEv = result.evidences.find(e => e.id === "ev_asn_networks");
      expect(networksEv).toBeDefined();

      const network = networksEv!.rawData.networks[0];
      expect(network.asn).toBe("13335");
      expect(network.cidr).toBe("104.16.128.0/20");
      expect(network.countryCode).toBe("US");
      expect(network.registry).toBe("ARIN");
      expect(network.allocatedOn).toBe("2014-03-28");
    });

    it("computes the exact address range from the announced CIDR", async () => {
      mockedDns.resolve4.mockResolvedValue(["104.16.132.229"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": originTxt("13335", "104.16.128.0/20"),
        "AS13335.asn.cymru.com": asNameTxt("13335", "CLOUDFLARENET")
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });
      const network = result.evidences.find(e => e.id === "ev_asn_networks")!.rawData.networks[0];

      expect(network.rangeStart).toBe("104.16.128.0");
      expect(network.rangeEnd).toBe("104.16.143.255");
      expect(network.addressCount).toBe("4096");
    });

    it("reports the AS organization as the network operator", async () => {
      mockedDns.resolve4.mockResolvedValue(["8.8.8.8"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": originTxt("15169", "8.8.8.0/24"),
        "AS15169.asn.cymru.com": asNameTxt("15169", "GOOGLE - Google LLC, US", "US", "arin", "2000-03-30")
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });
      const orgEv = result.evidences.find(e => e.id === "ev_asn_organization");

      expect(orgEv).toBeDefined();
      expect(orgEv!.rawData.organizations[0]).toMatchObject({
        asn: "15169",
        organization: "GOOGLE - Google LLC, US",
        registry: "ARIN",
        registeredOn: "2000-03-30"
      });
    });

    it("expands each registry token to its full RIR name", async () => {
      mockedDns.resolve4.mockResolvedValue(["1.1.1.1"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": originTxt("13335", "1.1.1.0/24", "AU", "apnic", "2011-08-11"),
        "AS13335.asn.cymru.com": asNameTxt("13335", "CLOUDFLARENET", "AU", "apnic")
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });
      const registryEv = result.evidences.find(e => e.id === "ev_asn_registry");

      expect(registryEv).toBeDefined();
      expect(registryEv!.rawData.registries).toContain("APNIC");
      expect(registryEv!.rawData.countryCodes).toContain("AU");
    });

    it("emits IPAddress, ASN and Organization entities linked by relationships", async () => {
      mockedDns.resolve4.mockResolvedValue(["8.8.8.8"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": originTxt("15169", "8.8.8.0/24"),
        "AS15169.asn.cymru.com": asNameTxt("15169", "GOOGLE - Google LLC, US")
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      expect(result.entities.some(e => e.type === "IPAddress" && e.name === "8.8.8.8")).toBe(true);
      expect(result.entities.some(e => e.type === "ASN" && e.name === "AS15169")).toBe(true);
      expect(result.entities.some(e => e.type === "Organization")).toBe(true);

      expect(result.relationships.some(r => r.type === "RESOLVES_TO")).toBe(true);
      expect(result.relationships.some(r => r.type === "ANNOUNCED_BY")).toBe(true);
      expect(result.relationships.some(r => r.type === "OPERATED_BY")).toBe(true);
    });

    it("handles an IPv6 address via the origin6 zone", async () => {
      mockedDns.resolve4.mockRejectedValue(dnsError("ENODATA"));
      mockedDns.resolve6.mockResolvedValue(["2606:4700::6810:84e5"]);
      mockedDns.resolveTxt = routeTxt({
        "origin6.asn.cymru.com": originTxt("13335", "2606:4700::/44", "US", "arin", "2011-11-01"),
        "AS13335.asn.cymru.com": asNameTxt("13335", "CLOUDFLARENET")
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      const network = result.evidences.find(e => e.id === "ev_asn_networks")!.rawData.networks[0];
      expect(network.cidr).toBe("2606:4700::/44");
      // /44 fixes the first 44 bits: two full groups plus the top 12 bits of
      // the third, leaving 4 host bits in that group (0x0000-0x000f).
      expect(network.rangeStart).toBe("2606:4700:0000:0000:0000:0000:0000:0000");
      expect(network.rangeEnd).toBe("2606:4700:000f:ffff:ffff:ffff:ffff:ffff");
    });

    it("accepts a raw IP address as the target without DNS resolution", async () => {
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": originTxt("15169", "8.8.8.0/24"),
        "AS15169.asn.cymru.com": asNameTxt("15169", "GOOGLE - Google LLC, US")
      });

      const result = await connector.run({ term: "8.8.8.8", type: "IPAddress" });

      expect(result.status).toBe("SUCCESS");
      expect(mockedDns.resolve4).not.toHaveBeenCalled();
      // With an IP target there is no domain to hang a RESOLVES_TO edge on.
      expect(result.relationships.some(r => r.type === "RESOLVES_TO")).toBe(false);
      expect(result.relationships.some(r => r.type === "ANNOUNCED_BY")).toBe(true);
    });

    it("emits an IP target exactly once rather than as a duplicate node", async () => {
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": originTxt("15169", "8.8.8.0/24"),
        "AS15169.asn.cymru.com": asNameTxt("15169", "GOOGLE - Google LLC, US")
      });

      const result = await connector.run({ term: "8.8.8.8", type: "IPAddress" });
      const ipEntities = result.entities.filter(e => e.type === "IPAddress" && e.name === "8.8.8.8");

      expect(ipEntities).toHaveLength(1);
      // The single node carries the full evidence set, not just the network evidence.
      expect(ipEntities[0].evidenceIds).toContain("ev_asn_networks");
      expect(ipEntities[0].evidenceIds).toContain("ev_asn_organization");
    });

    it("records a multi-origin prefix as multiple ASNs", async () => {
      mockedDns.resolve4.mockResolvedValue(["203.0.113.5"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": [["64500 64501 | 203.0.113.0/24 | NL | ripencc | 2012-01-01"]],
        "AS64500.asn.cymru.com": asNameTxt("64500", "EXAMPLE-A", "NL", "ripencc"),
        "AS64501.asn.cymru.com": asNameTxt("64501", "EXAMPLE-B", "NL", "ripencc")
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });
      const networksEv = result.evidences.find(e => e.id === "ev_asn_networks")!;

      expect(networksEv.rawData.asnCount).toBe(2);
      expect(networksEv.rawData.networks[0].allAsns).toEqual(["64500", "64501"]);
      expect(networksEv.rawData.networks[0].registry).toBe("RIPE NCC");
    });

    it("attaches diagnostics to every piece of evidence", async () => {
      mockedDns.resolve4.mockResolvedValue(["8.8.8.8"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": originTxt("15169", "8.8.8.0/24"),
        "AS15169.asn.cymru.com": asNameTxt("15169", "GOOGLE - Google LLC, US")
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      expect(result.evidences.length).toBeGreaterThan(0);
      for (const evidence of result.evidences) {
        expect(evidence.rawData.diagnostics).toBeDefined();
        expect(evidence.rawData.diagnostics.source).toBe("Team Cymru IP-to-ASN (DNS)");
        expect(typeof evidence.rawData.diagnostics.detectionTimeMs).toBe("number");
        expect(evidence.rawData.diagnostics.registrantContactsAvailable).toBe(false);
      }
    });
  });

  describe("NO_DATA", () => {
    it("returns NO_DATA when no address has a BGP origin record", async () => {
      mockedDns.resolve4.mockResolvedValue(["192.0.2.1"]);
      // Every Cymru lookup NXDOMAINs - an authoritative "not announced".
      mockedDns.resolveTxt = routeTxt({});

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.success).toBe(true);
      expect(result.evidences).toHaveLength(0);
      expect(result.rawData.asnCount).toBe(0);
    });

    it("returns NO_DATA when the target resolves only to non-public addresses", async () => {
      mockedDns.resolve4.mockResolvedValue(["10.0.0.5", "127.0.0.1"]);
      mockedDns.resolveTxt = routeTxt({});

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.rawData.info).toMatch(/non-public/i);
      // Private addresses must never be sent to the external lookup service.
      expect(mockedDns.resolveTxt).not.toHaveBeenCalled();
    });

    it("skips Organization targets without performing any lookup", async () => {
      const result = await connector.run({ term: "Acme Corporation", type: "Organization" });

      expect(result.status).toBe("NO_DATA");
      expect(result.rawData.info).toMatch(/not a domain or IP address/i);
      expect(mockedDns.resolve4).not.toHaveBeenCalled();
    });
  });

  describe("ERROR", () => {
    it("returns ERROR when the target's DNS resolution fails outright", async () => {
      mockedDns.resolve4.mockRejectedValue(dnsError("ESERVFAIL", "server failure"));
      mockedDns.resolve6.mockRejectedValue(dnsError("ESERVFAIL", "server failure"));

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/DNS resolver failed/i);
      expect(result.evidences).toHaveLength(0);
    });

    it("returns ERROR — not NO_DATA — when the ASN lookup itself fails", async () => {
      mockedDns.resolve4.mockResolvedValue(["8.8.8.8"]);
      mockedDns.resolveTxt = vi.fn().mockRejectedValue(dnsError("ETIMEOUT", "query timed out"));

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/Could not complete the IP-to-ASN lookup/i);
    });

    it("returns ERROR when the lookup times out", async () => {
      mockedDns.resolve4.mockResolvedValue(["8.8.8.8"]);
      mockedDns.resolveTxt = vi.fn(() => new Promise(() => {}));

      process.env.ASN_TIMEOUT_MS = "50";
      try {
        const result = await connector.run({ term: uniqueHost(), type: "Domain" });
        expect(result.status).toBe("ERROR");
        expect(result.error).toMatch(/Timeout reached|could not complete/i);
      } finally {
        delete process.env.ASN_TIMEOUT_MS;
      }
    });

    it("does not report an absence of ASNs when the source was merely unreachable", async () => {
      mockedDns.resolve4.mockResolvedValue(["8.8.8.8"]);
      mockedDns.resolveTxt = vi.fn().mockRejectedValue(dnsError("ECONNREFUSED", "refused"));

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      expect(result.status).not.toBe("NO_DATA");
      expect(result.status).toBe("ERROR");
    });
  });

  describe("invalid targets", () => {
    it("returns NO_DATA for an empty term", async () => {
      const result = await connector.run({ term: "   ", type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(mockedDns.resolve4).not.toHaveBeenCalled();
    });

    it("returns NO_DATA for a term that is neither a hostname nor an IP", async () => {
      const result = await connector.run({ term: "not a host!!", type: "Generic" });

      expect(result.status).toBe("NO_DATA");
      expect(mockedDns.resolve4).not.toHaveBeenCalled();
    });

    it("returns NO_DATA for a malformed IP-like term", async () => {
      const result = await connector.run({ term: "999.999.999.999", type: "Generic" });

      expect(result.status).toBe("NO_DATA");
      expect(mockedDns.resolve4).not.toHaveBeenCalled();
    });
  });

  describe("grounding and false-positive prevention", () => {
    it("reports no organization when the source names none", async () => {
      mockedDns.resolve4.mockResolvedValue(["203.0.113.9"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": originTxt("64500", "203.0.113.0/24"),
        // The AS registration record exists but carries no operator name.
        "AS64500.asn.cymru.com": [["64500 | US | arin | 2012-01-01 |"]]
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      // No operator was published, so none is invented.
      expect(result.evidences.find(e => e.id === "ev_asn_organization")).toBeUndefined();
      expect(result.entities.some(e => e.type === "Organization")).toBe(false);
    });

    it("omits the address range when the source publishes no CIDR", async () => {
      mockedDns.resolve4.mockResolvedValue(["203.0.113.9"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": [["64500 |  | US | arin | 2012-01-01"]],
        "AS64500.asn.cymru.com": asNameTxt("64500", "EXAMPLE-NET")
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });
      const network = result.evidences.find(e => e.id === "ev_asn_networks")!.rawData.networks[0];

      expect(network.cidr).toBeUndefined();
      expect(network.rangeStart).toBeUndefined();
      expect(network.rangeEnd).toBeUndefined();
    });

    it("passes an unrecognised registry token through verbatim rather than guessing", async () => {
      mockedDns.resolve4.mockResolvedValue(["203.0.113.9"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": originTxt("64500", "203.0.113.0/24", "ZZ", "somenewrir", "2012-01-01"),
        "AS64500.asn.cymru.com": asNameTxt("64500", "EXAMPLE-NET", "ZZ", "somenewrir")
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });
      const network = result.evidences.find(e => e.id === "ev_asn_networks")!.rawData.networks[0];

      expect(network.registry).toBe("somenewrir");
    });

    it("discards an origin answer that carries no ASN field", async () => {
      mockedDns.resolve4.mockResolvedValue(["203.0.113.9"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": [["| 203.0.113.0/24 | US | arin | 2012-01-01"]]
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      // A prefix with no ASN proves nothing about the announcing network.
      expect(result.status).toBe("NO_DATA");
      expect(result.evidences).toHaveLength(0);
    });

    it("states that the country code is a registry fact, not a geolocation", async () => {
      mockedDns.resolve4.mockResolvedValue(["8.8.8.8"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": originTxt("15169", "8.8.8.0/24"),
        "AS15169.asn.cymru.com": asNameTxt("15169", "GOOGLE - Google LLC, US")
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });
      const registryEv = result.evidences.find(e => e.id === "ev_asn_registry")!;

      expect(registryEv.description).toMatch(/not the physical location/i);
    });
  });

  describe("evidence contract", () => {
    it("produces well-formed, verified evidence for every finding", async () => {
      mockedDns.resolve4.mockResolvedValue(["8.8.8.8"]);
      mockedDns.resolveTxt = routeTxt({
        "origin.asn.cymru.com": originTxt("15169", "8.8.8.0/24"),
        "AS15169.asn.cymru.com": asNameTxt("15169", "GOOGLE - Google LLC, US")
      });

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      expect(result.evidences.length).toBeGreaterThan(0);
      for (const evidence of result.evidences) {
        expect(evidence.id).toMatch(/^ev_asn_/);
        expect(evidence.connector).toBe("ASN / IP Intelligence");
        expect(evidence.title.length).toBeGreaterThan(0);
        expect(evidence.description.length).toBeGreaterThan(0);
        expect(evidence.confidence).toBeGreaterThan(0);
        expect(evidence.confidence).toBeLessThanOrEqual(100);
        expect(evidence.verified).toBe(true);
        expect(evidence.timestamp).toBeTruthy();
      }
    });

    it("only ever returns SUCCESS, NO_DATA or ERROR", async () => {
      const cases: Array<() => void> = [
        () => {
          mockedDns.resolve4.mockResolvedValue(["8.8.8.8"]);
          mockedDns.resolveTxt = routeTxt({
            "origin.asn.cymru.com": originTxt("15169", "8.8.8.0/24"),
            "AS15169.asn.cymru.com": asNameTxt("15169", "GOOGLE")
          });
        },
        () => {
          mockedDns.resolve4.mockResolvedValue(["192.0.2.1"]);
          mockedDns.resolveTxt = routeTxt({});
        },
        () => {
          mockedDns.resolve4.mockRejectedValue(dnsError("ESERVFAIL"));
          mockedDns.resolve6.mockRejectedValue(dnsError("ESERVFAIL"));
        }
      ];

      for (const setup of cases) {
        vi.clearAllMocks();
        mockedDns.resolve6.mockRejectedValue(dnsError("ENODATA"));
        setup();
        const result = await connector.run({ term: uniqueHost(), type: "Domain" });
        expect(["SUCCESS", "NO_DATA", "ERROR"]).toContain(result.status);
      }
    });
  });

  describe("cidrToRange", () => {
    it("computes IPv4 ranges exactly", () => {
      expect(connector.cidrToRange("104.16.128.0/20")).toEqual({
        start: "104.16.128.0",
        end: "104.16.143.255",
        addressCount: "4096"
      });
      expect(connector.cidrToRange("8.8.8.0/24")).toEqual({
        start: "8.8.8.0",
        end: "8.8.8.255",
        addressCount: "256"
      });
      expect(connector.cidrToRange("192.0.2.1/32")).toEqual({
        start: "192.0.2.1",
        end: "192.0.2.1",
        addressCount: "1"
      });
    });

    it("normalises a prefix whose base address carries host bits", () => {
      expect(connector.cidrToRange("104.16.132.229/20")).toEqual({
        start: "104.16.128.0",
        end: "104.16.143.255",
        addressCount: "4096"
      });
    });

    it("returns null for a malformed CIDR", () => {
      expect(connector.cidrToRange("not-a-cidr")).toBeNull();
      expect(connector.cidrToRange("104.16.128.0/33")).toBeNull();
      expect(connector.cidrToRange("999.1.1.1/24")).toBeNull();
    });
  });
});
