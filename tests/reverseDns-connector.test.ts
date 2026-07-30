import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import dns from "dns/promises";
import { ReverseDnsConnector } from "../src/connectors/reverseDns";

vi.mock("dns/promises", () => ({
  default: {
    resolve4: vi.fn(),
    resolve6: vi.fn(),
    reverse: vi.fn()
  }
}));

const mockedDns = dns as unknown as {
  resolve4: ReturnType<typeof vi.fn>;
  resolve6: ReturnType<typeof vi.fn>;
  reverse: ReturnType<typeof vi.fn>;
};

/** Builds a DNS error carrying the code Node's resolver would set. */
function dnsError(code: string, message = "dns failure"): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/** Routes dns.reverse by IP so tests describe resolver behaviour, not order. */
function routeReverse(routes: Record<string, string[] | Error>) {
  mockedDns.reverse = vi.fn(async (ip: string) => {
    const answer = routes[ip];
    if (answer === undefined) throw dnsError("ENOTFOUND", `no PTR for ${ip}`);
    if (answer instanceof Error) throw answer;
    return answer;
  });
}

/** Routes forward confirmation lookups by hostname. */
function routeForward(v4: Record<string, string[]> = {}, v6: Record<string, string[]> = {}) {
  mockedDns.resolve4 = vi.fn(async (name: string) => {
    if (v4[name]) return v4[name];
    throw dnsError("ENODATA", `no A for ${name}`);
  });
  mockedDns.resolve6 = vi.fn(async (name: string) => {
    if (v6[name]) return v6[name];
    throw dnsError("ENODATA", `no AAAA for ${name}`);
  });
}

/**
 * The connector caches per `${type}:${host}` in a static map that outlives
 * instances, so every test uses a distinct hostname.
 */
let hostCounter = 0;
function uniqueHost(): string {
  hostCounter++;
  return `rdns-test-${hostCounter}.example`;
}

describe("ReverseDnsConnector", () => {
  let connector: ReverseDnsConnector;

  beforeEach(() => {
    mockedDns.resolve4 = vi.fn().mockRejectedValue(dnsError("ENODATA"));
    mockedDns.resolve6 = vi.fn().mockRejectedValue(dnsError("ENODATA"));
    mockedDns.reverse = vi.fn().mockRejectedValue(dnsError("ENOTFOUND"));
    // The result cache is static and outlives instances, so two tests using
    // the same address would otherwise share a result.
    (ReverseDnsConnector as any).cache.clear();
    connector = new ReverseDnsConnector();
  });

  afterEach(() => {
    delete process.env.REVERSE_DNS_TIMEOUT_MS;
  });

  describe("successful reverse lookup", () => {
    it("resolves a domain to its addresses and reports their PTR records", async () => {
      const host = uniqueHost();
      routeForward({ [host]: ["8.8.8.8"], "dns.google": ["8.8.8.8"] });
      routeReverse({ "8.8.8.8": ["dns.google"] });

      const result = await connector.run({ term: host, type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);

      const ptrEv = result.evidences.find(e => e.id === "ev_rdns_ptr_records")!;
      expect(ptrEv.rawData.records[0]).toMatchObject({
        ip: "8.8.8.8",
        family: "IPv4",
        status: "RESOLVED",
        hostnames: ["dns.google"]
      });
    });

    it("performs a direct reverse lookup for an IP target without forward resolution", async () => {
      routeForward({ "dns.google": ["8.8.8.8"] });
      routeReverse({ "8.8.8.8": ["dns.google"] });

      const result = await connector.run({ term: "8.8.8.8", type: "IPAddress" });

      expect(result.status).toBe("SUCCESS");
      expect(mockedDns.reverse).toHaveBeenCalledWith("8.8.8.8");
      // The target address is emitted once, not duplicated as a separate node.
      expect(result.entities.filter(e => e.type === "IPAddress" && e.name === "8.8.8.8")).toHaveLength(1);
    });

    it("records a resolution timestamp for every address", async () => {
      const host = uniqueHost();
      routeForward({ [host]: ["8.8.8.8"], "dns.google": ["8.8.8.8"] });
      routeReverse({ "8.8.8.8": ["dns.google"] });

      const result = await connector.run({ term: host, type: "Domain" });
      const record = result.evidences.find(e => e.id === "ev_rdns_ptr_records")!.rawData.records[0];

      expect(record.resolvedAt).toBeTruthy();
      expect(new Date(record.resolvedAt).toString()).not.toBe("Invalid Date");
    });

    it("marks a PTR hostname that resolves back to the same address as forward-confirmed", async () => {
      const host = uniqueHost();
      routeForward({ [host]: ["8.8.8.8"], "dns.google": ["8.8.8.8"] });
      routeReverse({ "8.8.8.8": ["dns.google"] });

      const result = await connector.run({ term: host, type: "Domain" });
      const confirmedEv = result.evidences.find(e => e.id === "ev_rdns_forward_confirmed")!;

      expect(confirmedEv.rawData.forwardConfirmedHostnames).toEqual(["dns.google"]);
      expect(confirmedEv.rawData.unconfirmedHostnames).toEqual([]);
    });

    it("does not mark a PTR hostname as confirmed when it resolves elsewhere", async () => {
      const host = uniqueHost();
      routeForward({ [host]: ["203.0.113.10"], "spoofed.example": ["198.51.100.7"] });
      routeReverse({ "203.0.113.10": ["spoofed.example"] });

      const result = await connector.run({ term: host, type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      // The PTR is still reported - it was genuinely observed - but not confirmed.
      const ptrEv = result.evidences.find(e => e.id === "ev_rdns_ptr_records")!;
      expect(ptrEv.rawData.records[0].hostnames).toEqual(["spoofed.example"]);
      expect(ptrEv.rawData.records[0].forwardConfirmed).toEqual([]);
      expect(result.evidences.find(e => e.id === "ev_rdns_forward_confirmed")).toBeUndefined();
    });

    it("emits IPAddress and PTR hostname entities linked by HAS_PTR_RECORD", async () => {
      const host = uniqueHost();
      routeForward({ [host]: ["8.8.8.8"], "dns.google": ["8.8.8.8"] });
      routeReverse({ "8.8.8.8": ["dns.google"] });

      const result = await connector.run({ term: host, type: "Domain" });

      expect(result.entities.some(e => e.type === "IPAddress" && e.name === "8.8.8.8")).toBe(true);
      expect(result.entities.some(e => e.type === "Domain" && e.name === "dns.google")).toBe(true);
      expect(result.relationships.some(r => r.type === "RESOLVES_TO")).toBe(true);
      expect(result.relationships.some(r => r.type === "HAS_PTR_RECORD")).toBe(true);
    });

    it("attaches diagnostics to every piece of evidence", async () => {
      const host = uniqueHost();
      routeForward({ [host]: ["8.8.8.8"], "dns.google": ["8.8.8.8"] });
      routeReverse({ "8.8.8.8": ["dns.google"] });

      const result = await connector.run({ term: host, type: "Domain" });

      expect(result.evidences.length).toBeGreaterThan(0);
      for (const evidence of result.evidences) {
        expect(evidence.id).toMatch(/^ev_rdns_/);
        expect(evidence.connector).toBe("Reverse DNS Resolver");
        expect(evidence.verified).toBe(true);
        expect(evidence.rawData.diagnostics).toBeDefined();
        expect(evidence.rawData.diagnostics.source).toBe("System DNS resolver (PTR)");
        expect(typeof evidence.rawData.diagnostics.detectionTimeMs).toBe("number");
      }
    });
  });

  describe("multiple PTR records", () => {
    it("reports every hostname returned for a single address", async () => {
      routeForward({ "a.example.net": ["203.0.113.5"], "b.example.net": ["203.0.113.5"] });
      routeReverse({ "203.0.113.5": ["a.example.net", "b.example.net", "c.example.net"] });

      const result = await connector.run({ term: "203.0.113.5", type: "IPAddress" });
      const ptrEv = result.evidences.find(e => e.id === "ev_rdns_ptr_records")!;

      expect(ptrEv.rawData.records[0].hostnames).toEqual([
        "a.example.net",
        "b.example.net",
        "c.example.net"
      ]);
      // Only the two that resolve back are confirmed.
      expect(ptrEv.rawData.records[0].forwardConfirmed).toEqual(["a.example.net", "b.example.net"]);
    });

    it("de-duplicates hostnames across multiple addresses", async () => {
      const host = uniqueHost();
      routeForward({ [host]: ["203.0.113.5", "203.0.113.6"] });
      routeReverse({
        "203.0.113.5": ["shared.example.net"],
        "203.0.113.6": ["shared.example.net"]
      });

      const result = await connector.run({ term: host, type: "Domain" });
      const hostnamesEv = result.evidences.find(e => e.id === "ev_rdns_hostnames")!;

      expect(hostnamesEv.rawData.hostnames).toEqual(["shared.example.net"]);
      // Both addresses are still reported individually.
      expect(result.evidences.find(e => e.id === "ev_rdns_ptr_records")!.rawData.records).toHaveLength(2);
    });

    it("normalises trailing dots and casing on PTR hostnames", async () => {
      routeForward({});
      routeReverse({ "203.0.113.5": ["Host.Example.NET."] });

      const result = await connector.run({ term: "203.0.113.5", type: "IPAddress" });
      const ptrEv = result.evidences.find(e => e.id === "ev_rdns_ptr_records")!;

      expect(ptrEv.rawData.records[0].hostnames).toEqual(["host.example.net"]);
    });
  });

  describe("IPv4", () => {
    it("labels an IPv4 address family correctly and confirms via an A lookup", async () => {
      routeForward({ "v4.example.net": ["203.0.113.20"] });
      routeReverse({ "203.0.113.20": ["v4.example.net"] });

      const result = await connector.run({ term: "203.0.113.20", type: "IPAddress" });
      const record = result.evidences.find(e => e.id === "ev_rdns_ptr_records")!.rawData.records[0];

      expect(record.family).toBe("IPv4");
      expect(record.forwardConfirmed).toEqual(["v4.example.net"]);
      expect(mockedDns.resolve4).toHaveBeenCalledWith("v4.example.net");
      expect(mockedDns.resolve6).not.toHaveBeenCalledWith("v4.example.net");
    });
  });

  describe("IPv6", () => {
    it("labels an IPv6 address family correctly and confirms via an AAAA lookup", async () => {
      routeForward({}, { "v6.example.net": ["2001:db8::1"] });
      routeReverse({ "2001:db8::1": ["v6.example.net"] });

      const result = await connector.run({ term: "2001:db8::1", type: "IPAddress" });
      const record = result.evidences.find(e => e.id === "ev_rdns_ptr_records")!.rawData.records[0];

      expect(record.family).toBe("IPv6");
      expect(record.forwardConfirmed).toEqual(["v6.example.net"]);
      expect(mockedDns.resolve6).toHaveBeenCalledWith("v6.example.net");
    });

    it("reverse-looks-up both A and AAAA addresses of a dual-stack domain", async () => {
      const host = uniqueHost();
      mockedDns.resolve4 = vi.fn(async (name: string) => {
        if (name === host) return ["203.0.113.30"];
        throw dnsError("ENODATA");
      });
      mockedDns.resolve6 = vi.fn(async (name: string) => {
        if (name === host) return ["2001:db8::30"];
        throw dnsError("ENODATA");
      });
      routeReverse({
        "203.0.113.30": ["dual-v4.example.net"],
        "2001:db8::30": ["dual-v6.example.net"]
      });

      const result = await connector.run({ term: host, type: "Domain" });
      const records = result.evidences.find(e => e.id === "ev_rdns_ptr_records")!.rawData.records;

      expect(records.map((r: any) => r.family).sort()).toEqual(["IPv4", "IPv6"]);
      expect(mockedDns.reverse).toHaveBeenCalledWith("203.0.113.30");
      expect(mockedDns.reverse).toHaveBeenCalledWith("2001:db8::30");
    });
  });

  describe("NO_DATA", () => {
    it("returns NO_DATA when no address publishes a PTR record", async () => {
      const host = uniqueHost();
      routeForward({ [host]: ["203.0.113.40"] });
      routeReverse({}); // every reverse lookup NXDOMAINs

      const result = await connector.run({ term: host, type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.success).toBe(true);
      expect(result.evidences).toHaveLength(0);
      expect(result.rawData.ptrRecordCount).toBe(0);
    });

    it("returns NO_DATA for an IP target with no PTR record", async () => {
      routeReverse({});
      const result = await connector.run({ term: "203.0.113.41", type: "IPAddress" });

      expect(result.status).toBe("NO_DATA");
      expect(result.rawData.info).toMatch(/No PTR record is published for "203\.0\.113\.41"/);
    });

    it("treats an empty resolver answer as no PTR rather than an error", async () => {
      routeReverse({ "203.0.113.42": [] });
      const result = await connector.run({ term: "203.0.113.42", type: "IPAddress" });

      expect(result.status).toBe("NO_DATA");
    });

    it("returns NO_DATA when the target resolves only to non-public addresses", async () => {
      const host = uniqueHost();
      routeForward({ [host]: ["10.0.0.5", "127.0.0.1"] });

      const result = await connector.run({ term: host, type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.rawData.info).toMatch(/non-public/i);
      // Private space must never be looked up in reverse.
      expect(mockedDns.reverse).not.toHaveBeenCalled();
    });

    it("skips Organization targets without any lookup", async () => {
      const result = await connector.run({ term: "Acme Corporation", type: "Organization" });

      expect(result.status).toBe("NO_DATA");
      expect(result.rawData.info).toMatch(/not a domain or IP address/i);
      expect(mockedDns.reverse).not.toHaveBeenCalled();
    });

    it("reports coverage when some addresses have PTR records and others do not", async () => {
      const host = uniqueHost();
      routeForward({ [host]: ["203.0.113.50", "203.0.113.51"] });
      routeReverse({ "203.0.113.50": ["has-ptr.example.net"] });

      const result = await connector.run({ term: host, type: "Domain" });
      const coverageEv = result.evidences.find(e => e.id === "ev_rdns_coverage")!;

      expect(result.status).toBe("SUCCESS");
      expect(coverageEv.rawData.withPtr).toEqual(["203.0.113.50"]);
      expect(coverageEv.rawData.withoutPtr).toEqual(["203.0.113.51"]);
    });
  });

  describe("ERROR", () => {
    it("returns ERROR when the target's forward resolution fails outright", async () => {
      mockedDns.resolve4 = vi.fn().mockRejectedValue(dnsError("ESERVFAIL", "server failure"));
      mockedDns.resolve6 = vi.fn().mockRejectedValue(dnsError("ESERVFAIL", "server failure"));

      const result = await connector.run({ term: uniqueHost(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/DNS resolver failed/i);
      expect(result.evidences).toHaveLength(0);
    });

    it("returns ERROR — not NO_DATA — when every reverse lookup fails inconclusively", async () => {
      routeReverse({ "203.0.113.60": dnsError("ESERVFAIL", "server failure") });

      const result = await connector.run({ term: "203.0.113.60", type: "IPAddress" });

      expect(result.status).toBe("ERROR");
      expect(result.status).not.toBe("NO_DATA");
      expect(result.error).toMatch(/Could not complete the reverse DNS lookup/i);
    });

    it("returns ERROR when the reverse lookup times out", async () => {
      mockedDns.reverse = vi.fn(() => new Promise(() => {}));
      process.env.REVERSE_DNS_TIMEOUT_MS = "50";

      const result = await connector.run({ term: "203.0.113.61", type: "IPAddress" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/Timeout reached|could not complete/i);
    });

    it("only ever returns SUCCESS, NO_DATA or ERROR", async () => {
      const setups: Array<() => void> = [
        () => {
          routeForward({ "ok.example.net": ["203.0.113.70"] });
          routeReverse({ "203.0.113.70": ["ok.example.net"] });
        },
        () => routeReverse({}),
        () => routeReverse({ "203.0.113.70": dnsError("ECONNREFUSED") })
      ];

      for (const setup of setups) {
        setup();
        const result = await connector.run({ term: "203.0.113.70", type: "IPAddress" });
        expect(["SUCCESS", "NO_DATA", "ERROR"]).toContain(result.status);
        // Bust the per-host cache between iterations of this loop too.
        (ReverseDnsConnector as any).cache.clear();
      }
    });
  });

  describe("invalid IP", () => {
    it("returns NO_DATA for a malformed dotted-quad", async () => {
      const result = await connector.run({ term: "999.999.999.999", type: "Generic" });

      expect(result.status).toBe("NO_DATA");
      expect(mockedDns.reverse).not.toHaveBeenCalled();
      expect(mockedDns.resolve4).not.toHaveBeenCalled();
    });

    it("returns NO_DATA for a truncated IPv4 address", async () => {
      const result = await connector.run({ term: "10.0.0", type: "Generic" });

      expect(result.status).toBe("NO_DATA");
      expect(mockedDns.reverse).not.toHaveBeenCalled();
    });
  });

  describe("invalid domain", () => {
    it("returns NO_DATA for an empty term", async () => {
      const result = await connector.run({ term: "   ", type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(mockedDns.resolve4).not.toHaveBeenCalled();
    });

    it("returns NO_DATA for a term that is not a hostname", async () => {
      const result = await connector.run({ term: "not a domain!!", type: "Generic" });

      expect(result.status).toBe("NO_DATA");
      expect(mockedDns.resolve4).not.toHaveBeenCalled();
    });

    it("returns NO_DATA for a single-label term with no TLD", async () => {
      const result = await connector.run({ term: "localhost", type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(mockedDns.resolve4).not.toHaveBeenCalled();
    });
  });

  describe("network failures", () => {
    it("keeps partial results when one address fails and another succeeds", async () => {
      const host = uniqueHost();
      routeForward({ [host]: ["203.0.113.80", "203.0.113.81"] });
      routeReverse({
        "203.0.113.80": ["good.example.net"],
        "203.0.113.81": dnsError("ETIMEOUT", "query timed out")
      });

      const result = await connector.run({ term: host, type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      const coverageEv = result.evidences.find(e => e.id === "ev_rdns_coverage")!;
      expect(coverageEv.rawData.withPtr).toEqual(["203.0.113.80"]);
      expect(coverageEv.rawData.lookupFailed[0].ip).toBe("203.0.113.81");
      expect(coverageEv.rawData.lookupFailed[0].error).toMatch(/timed out/i);
    });

    it("treats a failed forward-confirmation lookup as unconfirmed, not confirmed", async () => {
      mockedDns.resolve4 = vi.fn().mockRejectedValue(dnsError("ESERVFAIL", "server failure"));
      routeReverse({ "203.0.113.90": ["unverifiable.example.net"] });

      const result = await connector.run({ term: "203.0.113.90", type: "IPAddress" });
      const ptrEv = result.evidences.find(e => e.id === "ev_rdns_ptr_records")!;

      expect(result.status).toBe("SUCCESS");
      expect(ptrEv.rawData.records[0].hostnames).toEqual(["unverifiable.example.net"]);
      expect(ptrEv.rawData.records[0].forwardConfirmed).toEqual([]);
    });

    it("does not report an absence of PTR records when the resolver was merely unreachable", async () => {
      routeReverse({ "203.0.113.91": dnsError("ECONNREFUSED", "connection refused") });

      const result = await connector.run({ term: "203.0.113.91", type: "IPAddress" });

      expect(result.status).toBe("ERROR");
      expect(result.rawData.ptrRecordCount).toBe(0);
    });
  });
});
