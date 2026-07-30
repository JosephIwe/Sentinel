import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DnssecConnector } from "../src/connectors/dnssec";

/**
 * The connector speaks DNS wire format over UDP, so these tests build real
 * response buffers and hand them back through a stubbed dgram socket. That
 * exercises the actual header/record/RDATA parsing rather than mocking it
 * away.
 */
vi.mock("dgram", () => {
  const createSocket = vi.fn(() => {
    const handlers: Record<string, (arg: any) => void> = {};
    const socket: any = {
      on: (event: string, fn: (arg: any) => void) => {
        handlers[event] = fn;
        return socket;
      },
      close: vi.fn(),
      send: vi.fn((buffer: Buffer, _port: number, _host: string, cb?: (e?: Error) => void) => {
        cb?.();
        // qtype sits immediately after the encoded QNAME in the query.
        const qtype = readQueryType(buffer);
        const responder = (globalThis as any).__dnsResponder;
        queueMicrotask(() => {
          try {
            const answer = responder(qtype, readQueryName(buffer));
            if (answer instanceof Error) handlers.error?.(answer);
            else if (answer === null) {
              /* no reply at all - lets the connector's timeout fire */
            } else handlers.message?.(answer);
          } catch (err) {
            handlers.error?.(err as Error);
          }
        });
      })
    };
    return socket;
  });
  return { default: { createSocket }, createSocket };
});

vi.mock("dns", () => ({
  default: { getServers: () => ["8.8.8.8"] },
  getServers: () => ["8.8.8.8"]
}));

const TYPE_DS = 43;
const TYPE_DNSKEY = 48;
const TYPE_NSEC = 47;
const TYPE_NSEC3 = 50;
const TYPE_NSEC3PARAM = 51;
const TYPE_A = 1;

function encodeName(name: string): Buffer {
  const labels = name.split(".").filter(Boolean);
  return Buffer.concat([
    ...labels.map(l => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, "ascii")])),
    Buffer.from([0])
  ]);
}

function skipName(buf: Buffer, offset: number): number {
  while (offset < buf.length) {
    const len = buf[offset];
    if (len === 0) return offset + 1;
    if ((len & 0xc0) === 0xc0) return offset + 2;
    offset += 1 + len;
  }
  return offset;
}

function readQueryType(query: Buffer): number {
  return query.readUInt16BE(skipName(query, 12));
}

function readQueryName(query: Buffer): string {
  const labels: string[] = [];
  let offset = 12;
  while (offset < query.length) {
    const len = query[offset];
    if (len === 0) break;
    labels.push(query.toString("ascii", offset + 1, offset + 1 + len));
    offset += 1 + len;
  }
  return labels.join(".");
}

/** Builds a DNS response message with the given answer/authority records. */
function buildResponse(opts: {
  name: string;
  rcode?: number;
  ad?: boolean;
  truncated?: boolean;
  answers?: { type: number; rdata: Buffer }[];
  authority?: { type: number; rdata: Buffer }[];
}): Buffer {
  const { name, rcode = 0, ad = false, truncated = false, answers = [], authority = [] } = opts;

  let flags = 0x8180 | rcode; // QR + RD + RA
  if (ad) flags |= 0x20;
  if (truncated) flags |= 0x0200;

  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x1234, 0);
  header.writeUInt16BE(flags, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(answers.length, 6);
  header.writeUInt16BE(authority.length, 8);

  const question = Buffer.concat([encodeName(name), Buffer.from([0, 0, 0, 1])]);
  question.writeUInt16BE(0, encodeName(name).length); // qtype placeholder

  const encodeRecord = (r: { type: number; rdata: Buffer }) => {
    const head = Buffer.alloc(10);
    head.writeUInt16BE(r.type, 0);
    head.writeUInt16BE(1, 2);
    head.writeUInt32BE(300, 4);
    head.writeUInt16BE(r.rdata.length, 8);
    return Buffer.concat([encodeName(name), head, r.rdata]);
  };

  return Buffer.concat([
    header,
    question,
    ...answers.map(encodeRecord),
    ...authority.map(encodeRecord)
  ]);
}

/** DS RDATA: key tag (2), algorithm (1), digest type (1), digest. */
function dsRdata(keyTag: number, algorithm: number, digestType: number, digestHex: string): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(keyTag, 0);
  head.writeUInt8(algorithm, 2);
  head.writeUInt8(digestType, 3);
  return Buffer.concat([head, Buffer.from(digestHex, "hex")]);
}

/** DNSKEY RDATA: flags (2), protocol (1), algorithm (1), public key. */
function dnskeyRdata(flags: number, algorithm: number, key: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(flags, 0);
  head.writeUInt8(3, 2); // protocol is always 3
  head.writeUInt8(algorithm, 3);
  return Buffer.concat([head, key]);
}

/** NSEC3PARAM RDATA: hash alg (1), flags (1), iterations (2), salt len (1). */
function nsec3ParamRdata(iterations: number, saltLength: number): Buffer {
  const buf = Buffer.alloc(5 + saltLength);
  buf.writeUInt8(1, 0);
  buf.writeUInt8(0, 1);
  buf.writeUInt16BE(iterations, 2);
  buf.writeUInt8(saltLength, 4);
  return buf;
}

/** Installs the per-test responder the mocked socket consults. */
function respondWith(fn: (qtype: number, name: string) => Buffer | Error | null) {
  (globalThis as any).__dnsResponder = fn;
}

/** A fully signed zone: DS + DNSKEY, resolver sets AD. */
function signedZone(name: string, opts: { ad?: boolean; denial?: "NSEC" | "NSEC3" | "none" } = {}) {
  const { ad = true, denial = "NSEC" } = opts;
  const ksk = dnskeyRdata(257, 13, Buffer.alloc(64, 1));
  const zsk = dnskeyRdata(256, 13, Buffer.alloc(64, 2));
  return (qtype: number): Buffer => {
    if (qtype === TYPE_DS) {
      return buildResponse({
        name,
        ad,
        answers: [{ type: TYPE_DS, rdata: dsRdata(2371, 13, 2, "aa".repeat(32)) }]
      });
    }
    if (qtype === TYPE_DNSKEY) {
      return buildResponse({
        name,
        ad,
        answers: [
          { type: TYPE_DNSKEY, rdata: ksk },
          { type: TYPE_DNSKEY, rdata: zsk }
        ]
      });
    }
    if (qtype === TYPE_NSEC3PARAM) {
      return denial === "NSEC3"
        ? buildResponse({ name, ad, answers: [{ type: TYPE_NSEC3PARAM, rdata: nsec3ParamRdata(10, 8) }] })
        : buildResponse({ name, ad });
    }
    if (qtype === TYPE_A) {
      if (denial === "NSEC") {
        return buildResponse({ name, ad, rcode: 3, authority: [{ type: TYPE_NSEC, rdata: Buffer.alloc(8) }] });
      }
      if (denial === "NSEC3") {
        return buildResponse({ name, ad, rcode: 3, authority: [{ type: TYPE_NSEC3, rdata: Buffer.alloc(12) }] });
      }
      return buildResponse({ name, ad, rcode: 3 });
    }
    return buildResponse({ name, ad });
  };
}

let domainCounter = 0;
function uniqueDomain(): string {
  domainCounter++;
  return `dnssec-test-${domainCounter}.example`;
}

describe("DnssecConnector", () => {
  let connector: DnssecConnector;

  beforeEach(() => {
    (DnssecConnector as any).cache.clear();
    connector = new DnssecConnector();
    respondWith(() => buildResponse({ name: "example", rcode: 0 }));
  });

  afterEach(() => {
    delete process.env.DNSSEC_TIMEOUT_MS;
    delete process.env.DNSSEC_RESOLVER;
  });

  describe("signed zone", () => {
    it("returns SUCCESS and reports DNSSEC as enabled and SECURE", async () => {
      const domain = uniqueDomain();
      respondWith(signedZone(domain));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);

      const statusEv = result.evidences.find(e => e.id === "ev_dnssec_status")!;
      expect(statusEv.rawData.dnssecEnabled).toBe(true);
      expect(statusEv.rawData.validationStatus).toBe("SECURE");
      expect(statusEv.rawData.authenticatedData).toBe(true);
    });

    it("decodes DS records including key tag, signing and digest algorithms", async () => {
      const domain = uniqueDomain();
      respondWith(signedZone(domain));

      const result = await connector.run({ term: domain, type: "Domain" });
      const ds = result.evidences.find(e => e.id === "ev_dnssec_ds")!.rawData.dsRecords[0];

      expect(ds).toMatchObject({
        keyTag: 2371,
        algorithm: 13,
        algorithmName: "ECDSA Curve P-256 with SHA-256",
        digestType: 2,
        digestTypeName: "SHA-256"
      });
      expect(ds.digest).toBe("AA".repeat(32));
    });

    it("decodes DNSKEY records and distinguishes KSK from ZSK", async () => {
      const domain = uniqueDomain();
      respondWith(signedZone(domain));

      const result = await connector.run({ term: domain, type: "Domain" });
      const dnskeyEv = result.evidences.find(e => e.id === "ev_dnssec_dnskey")!;

      expect(dnskeyEv.rawData.keySigningKeys).toBe(1);
      expect(dnskeyEv.rawData.zoneSigningKeys).toBe(1);
      expect(dnskeyEv.rawData.dnskeyRecords.map((k: any) => k.role).sort()).toEqual(["KSK", "ZSK"]);
      expect(dnskeyEv.rawData.dnskeyRecords[0].algorithmName).toBe("ECDSA Curve P-256 with SHA-256");
    });

    it("detects NSEC as the proof-of-non-existence scheme", async () => {
      const domain = uniqueDomain();
      respondWith(signedZone(domain, { denial: "NSEC" }));

      const result = await connector.run({ term: domain, type: "Domain" });
      const denialEv = result.evidences.find(e => e.id === "ev_dnssec_denial")!;

      expect(denialEv.rawData.denialScheme).toBe("NSEC");
      expect(denialEv.description).toMatch(/zone walking/i);
    });

    it("detects NSEC3 and its parameters from an NSEC3PARAM record", async () => {
      const domain = uniqueDomain();
      respondWith(signedZone(domain, { denial: "NSEC3" }));

      const result = await connector.run({ term: domain, type: "Domain" });
      const denialEv = result.evidences.find(e => e.id === "ev_dnssec_denial")!;

      expect(denialEv.rawData.denialScheme).toBe("NSEC3");
      expect(denialEv.rawData.nsec3Params).toMatchObject({ iterations: 10, saltLength: 8 });
    });

    it("reports INDETERMINATE when signing material exists but AD is not set", async () => {
      const domain = uniqueDomain();
      respondWith(signedZone(domain, { ad: false }));

      const result = await connector.run({ term: domain, type: "Domain" });
      const statusEv = result.evidences.find(e => e.id === "ev_dnssec_status")!;

      expect(result.status).toBe("SUCCESS");
      expect(statusEv.rawData.dnssecEnabled).toBe(true);
      expect(statusEv.rawData.validationStatus).toBe("INDETERMINATE");
    });

    it("attaches diagnostics to every piece of evidence", async () => {
      const domain = uniqueDomain();
      respondWith(signedZone(domain));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.evidences.length).toBeGreaterThan(0);
      for (const evidence of result.evidences) {
        expect(evidence.id).toMatch(/^ev_dnssec_/);
        expect(evidence.connector).toBe("DNSSEC Validator");
        expect(evidence.verified).toBe(true);
        expect(evidence.rawData.diagnostics).toBeDefined();
        expect(evidence.rawData.diagnostics.source).toBe("Direct DNS query (EDNS0 DO bit set)");
        expect(typeof evidence.rawData.diagnostics.detectionTimeMs).toBe("number");
      }
    });

    it("emits a Domain entity carrying the DNSSEC posture", async () => {
      const domain = uniqueDomain();
      respondWith(signedZone(domain));

      const result = await connector.run({ term: domain, type: "Domain" });
      const entity = result.entities.find(e => e.type === "Domain")!;

      expect(entity.name).toBe(domain);
      expect(entity.metadata.dnssecEnabled).toBe(true);
      expect(entity.metadata.validationStatus).toBe("SECURE");
    });
  });

  describe("unsigned zone", () => {
    it("returns SUCCESS with dnssecEnabled false — an unsigned zone is a finding, not an absence", async () => {
      const domain = uniqueDomain();
      respondWith(() => buildResponse({ name: domain, rcode: 0 }));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      const statusEv = result.evidences.find(e => e.id === "ev_dnssec_status")!;
      expect(statusEv.title).toBe("DNSSEC Not Enabled");
      expect(statusEv.rawData.dnssecEnabled).toBe(false);
      expect(statusEv.rawData.validationStatus).toBe("INSECURE");
    });

    it("emits no DS, DNSKEY or denial evidence for an unsigned zone", async () => {
      const domain = uniqueDomain();
      respondWith(() => buildResponse({ name: domain, rcode: 0 }));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.evidences.find(e => e.id === "ev_dnssec_ds")).toBeUndefined();
      expect(result.evidences.find(e => e.id === "ev_dnssec_dnskey")).toBeUndefined();
      expect(result.evidences.find(e => e.id === "ev_dnssec_denial")).toBeUndefined();
    });

    it("does not probe for a denial scheme on an unsigned zone", async () => {
      const domain = uniqueDomain();
      const seen: number[] = [];
      respondWith(qtype => {
        seen.push(qtype);
        return buildResponse({ name: domain, rcode: 0 });
      });

      await connector.run({ term: domain, type: "Domain" });

      expect(seen).toContain(TYPE_DS);
      expect(seen).toContain(TYPE_DNSKEY);
      expect(seen).not.toContain(TYPE_NSEC3PARAM);
    });
  });

  describe("NO_DATA", () => {
    it("returns NO_DATA when the resolver reports the domain does not exist", async () => {
      const domain = uniqueDomain();
      respondWith(() => buildResponse({ name: domain, rcode: 3 }));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.success).toBe(true);
      expect(result.evidences).toHaveLength(0);
      expect(result.rawData.info).toMatch(/does not exist/i);
    });

    it("skips IP address targets, which have no zone", async () => {
      const result = await connector.run({ term: "8.8.8.8", type: "IPAddress" });

      expect(result.status).toBe("NO_DATA");
      expect(result.rawData.info).toMatch(/not a domain/i);
    });

    it("skips Organization targets", async () => {
      const result = await connector.run({ term: "Acme Corporation", type: "Organization" });

      expect(result.status).toBe("NO_DATA");
      expect(result.rawData.info).toMatch(/not a domain/i);
    });
  });

  describe("ERROR", () => {
    it("returns ERROR — not 'unsigned' — when the resolver returns SERVFAIL", async () => {
      const domain = uniqueDomain();
      respondWith(() => buildResponse({ name: domain, rcode: 2 }));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/SERVFAIL/);
      // SERVFAIL is ambiguous and the wording must say so.
      expect(result.error).toMatch(/inconclusive/i);
      expect(result.evidences).toHaveLength(0);
    });

    it("returns ERROR for an unexpected DNS response code", async () => {
      const domain = uniqueDomain();
      respondWith(() => buildResponse({ name: domain, rcode: 5 })); // REFUSED

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/response code 5/i);
    });

    it("returns ERROR when the response is malformed", async () => {
      const domain = uniqueDomain();
      respondWith(() => Buffer.from([0x12, 0x34])); // shorter than a header

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/malformed/i);
    });

    it("only ever returns SUCCESS, NO_DATA or ERROR", async () => {
      const cases: Array<(d: string) => (qtype: number) => Buffer | Error | null> = [
        d => signedZone(d),
        d => () => buildResponse({ name: d, rcode: 0 }),
        d => () => buildResponse({ name: d, rcode: 3 }),
        d => () => buildResponse({ name: d, rcode: 2 }),
        () => () => new Error("socket exploded")
      ];

      for (const make of cases) {
        const domain = uniqueDomain();
        respondWith(make(domain));
        const result = await connector.run({ term: domain, type: "Domain" });
        expect(["SUCCESS", "NO_DATA", "ERROR"]).toContain(result.status);
      }
    });
  });

  describe("invalid domain", () => {
    it("returns NO_DATA for an empty term", async () => {
      const result = await connector.run({ term: "   ", type: "Domain" });
      expect(result.status).toBe("NO_DATA");
    });

    it("returns NO_DATA for a term that is not a hostname", async () => {
      const result = await connector.run({ term: "not a domain!!", type: "Generic" });
      expect(result.status).toBe("NO_DATA");
    });

    it("returns NO_DATA for a single-label term with no TLD", async () => {
      const result = await connector.run({ term: "localhost", type: "Domain" });
      expect(result.status).toBe("NO_DATA");
    });
  });

  describe("resolver failure", () => {
    it("returns ERROR when the socket fails", async () => {
      const domain = uniqueDomain();
      respondWith(() => new Error("ECONNREFUSED"));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/Could not query DNSSEC records/i);
      expect(result.error).toMatch(/ECONNREFUSED/);
    });

    it("returns ERROR when the resolver never answers", async () => {
      const domain = uniqueDomain();
      process.env.DNSSEC_TIMEOUT_MS = "60";
      respondWith(() => null); // no reply at all

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/timed out after 60ms/i);
    });

    it("honours DNSSEC_RESOLVER and records it in diagnostics", async () => {
      const domain = uniqueDomain();
      process.env.DNSSEC_RESOLVER = "9.9.9.9";
      respondWith(signedZone(domain));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.evidences[0].rawData.diagnostics.resolver).toBe("9.9.9.9");
    });

    it("ignores a DNSSEC_RESOLVER value that is not an IP address", async () => {
      const domain = uniqueDomain();
      process.env.DNSSEC_RESOLVER = "not-an-ip";
      respondWith(signedZone(domain));

      const result = await connector.run({ term: domain, type: "Domain" });

      // Falls back to the system resolver rather than using a bad value.
      expect(result.evidences[0].rawData.diagnostics.resolver).toBe("8.8.8.8");
    });
  });

  describe("missing records", () => {
    it("reports DS records with no DNSKEY as still signed", async () => {
      const domain = uniqueDomain();
      respondWith(qtype =>
        qtype === TYPE_DS
          ? buildResponse({ name: domain, answers: [{ type: TYPE_DS, rdata: dsRdata(1234, 8, 2, "bb".repeat(32)) }] })
          : buildResponse({ name: domain, rcode: 0 })
      );

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.evidences.find(e => e.id === "ev_dnssec_ds")).toBeDefined();
      expect(result.evidences.find(e => e.id === "ev_dnssec_dnskey")).toBeUndefined();
      expect(result.evidences.find(e => e.id === "ev_dnssec_status")!.rawData.dnssecEnabled).toBe(true);
    });

    it("reports DNSKEY records with no parent DS as signed but unlinked", async () => {
      const domain = uniqueDomain();
      respondWith(qtype =>
        qtype === TYPE_DNSKEY
          ? buildResponse({
              name: domain,
              answers: [{ type: TYPE_DNSKEY, rdata: dnskeyRdata(257, 13, Buffer.alloc(64, 3)) }]
            })
          : buildResponse({ name: domain, rcode: 0 })
      );

      const result = await connector.run({ term: domain, type: "Domain" });
      const dnskeyEv = result.evidences.find(e => e.id === "ev_dnssec_dnskey")!;

      expect(result.status).toBe("SUCCESS");
      expect(result.evidences.find(e => e.id === "ev_dnssec_ds")).toBeUndefined();
      // No DS to match against, so nothing is claimed as chained.
      expect(dnskeyEv.rawData.matchedToDs).toEqual([]);
    });

    it("omits denial evidence when no scheme could be detected", async () => {
      const domain = uniqueDomain();
      respondWith(signedZone(domain, { denial: "none" }));

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.evidences.find(e => e.id === "ev_dnssec_denial")).toBeUndefined();
      expect(result.rawData.denialScheme).toBe("NOT_DETECTED");
    });

    it("still reports the zone when the denial probe itself fails", async () => {
      const domain = uniqueDomain();
      const base = signedZone(domain);
      respondWith((qtype, name) => {
        if (qtype === TYPE_NSEC3PARAM || qtype === TYPE_A) return new Error("probe failed");
        return base(qtype, name);
      });

      const result = await connector.run({ term: domain, type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.evidences[0].rawData.diagnostics.denialProbeFailed).toBe(true);
      expect(result.evidences[0].rawData.diagnostics.denialScheme).toBe("NOT_DETECTED");
    });

    it("passes an unregistered algorithm number through verbatim", async () => {
      const domain = uniqueDomain();
      respondWith(qtype =>
        qtype === TYPE_DS
          ? buildResponse({ name: domain, answers: [{ type: TYPE_DS, rdata: dsRdata(99, 250, 99, "cc".repeat(32)) }] })
          : buildResponse({ name: domain, rcode: 0 })
      );

      const result = await connector.run({ term: domain, type: "Domain" });
      const ds = result.evidences.find(e => e.id === "ev_dnssec_ds")!.rawData.dsRecords[0];

      expect(ds.algorithmName).toBe("Algorithm 250");
      expect(ds.digestTypeName).toBe("Digest type 99");
    });

    it("discards a DS record whose RDATA is too short to decode", async () => {
      const domain = uniqueDomain();
      respondWith(qtype =>
        qtype === TYPE_DS
          ? buildResponse({ name: domain, answers: [{ type: TYPE_DS, rdata: Buffer.from([0x00, 0x01]) }] })
          : buildResponse({ name: domain, rcode: 0 })
      );

      const result = await connector.run({ term: domain, type: "Domain" });

      // The truncated record proves nothing, so the zone reads as unsigned.
      expect(result.status).toBe("SUCCESS");
      expect(result.evidences.find(e => e.id === "ev_dnssec_ds")).toBeUndefined();
      expect(result.evidences.find(e => e.id === "ev_dnssec_status")!.rawData.dnssecEnabled).toBe(false);
    });
  });

  describe("computeKeyTag (RFC 4034 Appendix B)", () => {
    it("computes the published root zone KSK-2017 key tag of 20326", () => {
      // The real root KSK-2017 DNSKEY RDATA: flags 257, protocol 3,
      // algorithm 8 (RSA/SHA-256), followed by the published public key.
      const publicKey = Buffer.from(
        "AwEAAaz/tAm8yTn4Mfeh5eyI96WSVexTBAvkMgJzkKTOiW1vkIbzxeF3+/4RgWOq7HrxRixHlFlExOLAJr5emLvN7SWXgnLh4+B5xQlNVz8Og8kvArMtNROxVQuCaSnIDdD5LKyWbRd2n9WGe2R8PzgCmr3EgVLrjyBxWezF0jLHwVN8efS3rCj/EWgvIWgb9tarpVUDK/b58Da+sqqls3eNbuv7pr+eoZG+SrDK6nWeL3c6H5Apxz7LjVc1uTIdsIXxuOLYA4/ilBmSVIzuDWfdRUfhHdY6+cn8HFRm+2hM8AnXGXws9555KrUB5qihylGa8subX2Nn6UwNR1AkUTV74bU=",
        "base64"
      );
      const rdata = Buffer.concat([Buffer.from([0x01, 0x01, 0x03, 0x08]), publicKey]);

      expect(connector.computeKeyTag(rdata)).toBe(20326);
    });

    it("returns 0 for the deprecated RSAMD5 rule rather than a wrong tag", () => {
      const rdata = Buffer.concat([Buffer.from([0x01, 0x01, 0x03, 0x01]), Buffer.alloc(64, 7)]);
      expect(connector.computeKeyTag(rdata)).toBe(0);
    });
  });
});
