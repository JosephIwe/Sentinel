import dgram from "dgram";
import dns from "dns";
import net from "net";
import { Connector, ConnectorResult, Entity, Evidence, InvestigationQuery, Relationship } from "../types";

interface CacheEntry {
  result: ConnectorResult;
  timestamp: number;
}

/** DNS record type codes this connector reads (RFC 1035, RFC 4034, RFC 5155). */
const TYPE_DS = 43;
const TYPE_DNSKEY = 48;
const TYPE_NSEC = 47;
const TYPE_NSEC3 = 50;
const TYPE_NSEC3PARAM = 51;
const TYPE_A = 1;

/** DNS RCODEs (RFC 1035 §4.1.1). */
const RCODE_NOERROR = 0;
const RCODE_SERVFAIL = 2;
const RCODE_NXDOMAIN = 3;

/** One parsed resource record, with RDATA left as raw bytes. */
interface ResourceRecord {
  name: string;
  type: number;
  ttl: number;
  rdata: Buffer;
}

/** A parsed DNS response message. */
interface DnsMessage {
  rcode: number;
  /** Authenticated Data - the validating resolver verified the DNSSEC chain. */
  authenticData: boolean;
  truncated: boolean;
  answers: ResourceRecord[];
  authority: ResourceRecord[];
}

/** A DS record (RFC 4034 §5.1). */
interface DsRecord {
  keyTag: number;
  algorithm: number;
  algorithmName: string;
  digestType: number;
  digestTypeName: string;
  digest: string;
}

/** A DNSKEY record (RFC 4034 §2.1). */
interface DnskeyRecord {
  flags: number;
  /** 257 = Key Signing Key, 256 = Zone Signing Key (bit 7 of flags). */
  role: "KSK" | "ZSK" | "OTHER";
  protocol: number;
  algorithm: number;
  algorithmName: string;
  /** Computed per RFC 4034 Appendix B from the record's own bytes. */
  keyTag: number;
  publicKeyBytes: number;
}

/**
 * How the zone proves non-existence, when observable. "NSEC3" is confirmed
 * by an NSEC3PARAM record or an NSEC3 record in a negative answer; "NSEC"
 * by an NSEC record in a negative answer.
 */
type DenialScheme = "NSEC" | "NSEC3" | "NOT_DETECTED";

/**
 * The DNSSEC posture this connector is willing to assert, each tied to a
 * specific observation rather than an assumption.
 */
type ValidationStatus =
  /** Resolver set AD: it validated the chain of trust. */
  | "SECURE"
  /** No DS and no DNSKEY, and the resolver answered NOERROR: unsigned zone. */
  | "INSECURE"
  /** Signing material present, but the resolver did not set AD. */
  | "INDETERMINATE";

// IANA DNSSEC algorithm numbers (RFC 8624 and the DNSSEC Algorithm Numbers
// registry). An unregistered code is passed through verbatim rather than
// guessed at.
const ALGORITHM_NAMES: Record<number, string> = {
  1: "RSAMD5",
  3: "DSA/SHA-1",
  5: "RSA/SHA-1",
  6: "DSA-NSEC3-SHA1",
  7: "RSASHA1-NSEC3-SHA1",
  8: "RSA/SHA-256",
  10: "RSA/SHA-512",
  12: "GOST R 34.10-2001",
  13: "ECDSA Curve P-256 with SHA-256",
  14: "ECDSA Curve P-384 with SHA-384",
  15: "Ed25519",
  16: "Ed448"
};

/** IANA DS digest types (Delegation Signer Digest Algorithm registry). */
const DIGEST_TYPE_NAMES: Record<number, string> = {
  1: "SHA-1",
  2: "SHA-256",
  3: "GOST R 34.11-94",
  4: "SHA-384"
};

const MAX_RECORDS_REPORTED = 20;
const EDNS_UDP_PAYLOAD_SIZE = 4096;

// Confidence tiers. DS and DNSKEY records are read straight off the wire, so
// they are direct observations. The validation status depends on the
// resolver's own AD flag, which is trustworthy only insofar as the resolver
// is, so it ranks slightly lower.
const CONFIDENCE_RECORDS = 96;
const CONFIDENCE_STATUS = 93;
const CONFIDENCE_DENIAL = 90;

/**
 * DNSSEC Connector
 *
 * Queries the configured recursive resolver directly over UDP for the
 * target zone's DNSSEC material and reports only what the wire format
 * literally contains:
 *
 *   - DS records at the parent (key tag, algorithm, digest type, digest)
 *   - DNSKEY records at the zone (flags/role, protocol, algorithm)
 *   - The resolver's Authenticated Data flag, as the validation status
 *   - NSEC or NSEC3 as the zone's proof-of-non-existence scheme, when
 *     observable
 *
 * Node's `dns` module cannot request DS, DNSKEY, or NSEC3PARAM record
 * types, so this connector builds and parses DNS messages itself (RFC 1035
 * wire format, RFC 4034 record formats) and sets the EDNS0 DO bit (RFC
 * 6891) so the resolver returns DNSSEC data.
 *
 * Key tags for DNSKEY records are computed per RFC 4034 Appendix B - exact
 * arithmetic over the record's own bytes, the same class of derivation as
 * expanding a CIDR, not an inference. Algorithm and digest-type numbers are
 * expanded through the published IANA registries; an unregistered code is
 * passed through verbatim.
 *
 * Status semantics: a zone that is definitively unsigned is a real finding,
 * not an absence, so it is SUCCESS carrying `dnssecEnabled: false`. NO_DATA
 * is reserved for targets with no zone to inspect - a non-domain target, or
 * a name the resolver says does not exist. A resolver that times out or
 * fails is ERROR, never a false "this zone is unsigned".
 */
export class DnssecConnector implements Connector {
  public name = "DNSSEC Validator";

  private static cache = new Map<string, CacheEntry>();

  /**
   * Configurable cache duration (TTL) in milliseconds. Defaults to 3600000
   * (1 hour) - DNSSEC keys and delegations change infrequently.
   */
  private getCacheTtl(): number {
    const envTtl = process.env.DNSSEC_CACHE_TTL_MS;
    if (envTtl) {
      const parsed = parseInt(envTtl, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 60 * 60 * 1000;
  }

  /**
   * Configurable per-query timeout in milliseconds. Defaults to 4000 -
   * deliberately below the orchestrator's 5000ms per-connector default so
   * this connector's own descriptive ERROR wins the race rather than being
   * surfaced as a generic outer TIMEOUT.
   */
  private getQueryTimeoutMs(): number {
    const envTimeout = process.env.DNSSEC_TIMEOUT_MS;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 4000;
  }

  /**
   * The recursive resolver to query. Defaults to the system's first
   * configured nameserver. DNSSEC_RESOLVER overrides it, which matters
   * because the validation status is only as trustworthy as the resolver
   * reporting it - an operator may want to pin a known validating one.
   */
  private getResolver(): string | null {
    const override = process.env.DNSSEC_RESOLVER;
    if (override && net.isIP(override.trim())) return override.trim();

    const configured = dns.getServers();
    for (const server of configured) {
      // Node reports IPv6 scope ids as "fe80::1%eth0"; strip before use.
      const bare = server.replace(/%.*$/, "").replace(/^\[|\]$/g, "");
      if (net.isIP(bare)) return bare;
    }
    return null;
  }

  private looksLikeDomain(term: string): boolean {
    return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(term);
  }

  private extractDomain(term: string): string {
    let cleaned = term.trim().toLowerCase();
    if (cleaned.includes("@")) cleaned = cleaned.split("@")[1] || cleaned;
    cleaned = cleaned.replace(/^\w+:\/\//, "");
    cleaned = cleaned.split("/")[0].split(":")[0].split("?")[0];
    cleaned = cleaned.replace(/^www\./, "");
    return cleaned.replace(/\.$/, "").trim();
  }

  // ---- DNS wire format ------------------------------------------------

  /** Encodes a domain name as a sequence of length-prefixed labels. */
  private encodeName(name: string): Buffer {
    const labels = name.split(".").filter(Boolean);
    const parts: Buffer[] = [];
    for (const label of labels) {
      const bytes = Buffer.from(label, "ascii");
      if (bytes.length > 63) throw new Error(`DNS label too long: "${label}"`);
      parts.push(Buffer.from([bytes.length]), bytes);
    }
    parts.push(Buffer.from([0]));
    return Buffer.concat(parts);
  }

  /**
   * Builds a standard recursive query with an EDNS0 OPT record carrying the
   * DO bit, which is what makes the resolver return DNSSEC records.
   */
  private buildQuery(name: string, qtype: number, id: number): Buffer {
    const header = Buffer.alloc(12);
    header.writeUInt16BE(id, 0);
    header.writeUInt16BE(0x0100, 2); // RD
    header.writeUInt16BE(1, 4); // QDCOUNT
    header.writeUInt16BE(1, 10); // ARCOUNT - the OPT record below

    const question = Buffer.alloc(4);
    question.writeUInt16BE(qtype, 0);
    question.writeUInt16BE(1, 2); // IN

    // OPT pseudo-RR: root name, type 41, UDP payload size, DO bit set.
    const opt = Buffer.alloc(11);
    opt.writeUInt8(0, 0); // root name
    opt.writeUInt16BE(41, 1); // OPT
    opt.writeUInt16BE(EDNS_UDP_PAYLOAD_SIZE, 3);
    opt.writeUInt8(0, 5); // extended rcode
    opt.writeUInt8(0, 6); // version
    opt.writeUInt16BE(0x8000, 7); // DO bit
    opt.writeUInt16BE(0, 9); // RDLENGTH

    return Buffer.concat([header, this.encodeName(name), question, opt]);
  }

  /**
   * Reads a (possibly compression-pointed) name, returning the decoded name
   * and the offset just past the name in the *current* record.
   */
  private readName(msg: Buffer, offset: number): { name: string; offset: number } {
    const labels: string[] = [];
    let position = offset;
    let jumped = false;
    let end = offset;
    let hops = 0;

    while (position < msg.length) {
      const length = msg[position];

      if (length === 0) {
        position += 1;
        if (!jumped) end = position;
        break;
      }

      // Compression pointer (top two bits set).
      if ((length & 0xc0) === 0xc0) {
        if (position + 1 >= msg.length) throw new Error("Malformed DNS name pointer");
        const pointer = ((length & 0x3f) << 8) | msg[position + 1];
        if (!jumped) end = position + 2;
        position = pointer;
        jumped = true;
        if (++hops > 32) throw new Error("DNS name compression loop");
        continue;
      }

      position += 1;
      if (position + length > msg.length) throw new Error("Malformed DNS name label");
      labels.push(msg.toString("ascii", position, position + length));
      position += length;
      if (!jumped) end = position;
    }

    return { name: labels.join("."), offset: end };
  }

  /** Parses one resource record starting at `offset`. */
  private readRecord(msg: Buffer, offset: number): { record: ResourceRecord; offset: number } {
    const { name, offset: afterName } = this.readName(msg, offset);
    if (afterName + 10 > msg.length) throw new Error("Truncated DNS record header");

    const type = msg.readUInt16BE(afterName);
    const ttl = msg.readUInt32BE(afterName + 4);
    const rdLength = msg.readUInt16BE(afterName + 8);
    const rdStart = afterName + 10;
    if (rdStart + rdLength > msg.length) throw new Error("Truncated DNS record data");

    return {
      record: { name, type, ttl, rdata: msg.subarray(rdStart, rdStart + rdLength) },
      offset: rdStart + rdLength
    };
  }

  /** Parses a complete DNS response message. */
  private parseMessage(msg: Buffer): DnsMessage {
    if (msg.length < 12) throw new Error("DNS response shorter than a header");

    const flags = msg.readUInt16BE(2);
    const qdCount = msg.readUInt16BE(4);
    const anCount = msg.readUInt16BE(6);
    const nsCount = msg.readUInt16BE(8);

    let offset = 12;
    for (let i = 0; i < qdCount; i++) {
      const { offset: afterName } = this.readName(msg, offset);
      offset = afterName + 4; // QTYPE + QCLASS
    }

    const answers: ResourceRecord[] = [];
    for (let i = 0; i < anCount; i++) {
      const { record, offset: next } = this.readRecord(msg, offset);
      answers.push(record);
      offset = next;
    }

    const authority: ResourceRecord[] = [];
    for (let i = 0; i < nsCount; i++) {
      const { record, offset: next } = this.readRecord(msg, offset);
      authority.push(record);
      offset = next;
    }

    return {
      rcode: flags & 0x0f,
      authenticData: (flags & 0x20) !== 0,
      truncated: (flags & 0x0200) !== 0,
      answers,
      authority
    };
  }

  /** Sends one query and resolves with the parsed response. */
  private query(resolver: string, name: string, qtype: number, timeoutMs: number): Promise<DnsMessage> {
    return new Promise((resolve, reject) => {
      let socket: dgram.Socket;
      try {
        socket = dgram.createSocket(net.isIPv6(resolver) ? "udp6" : "udp4");
      } catch (err: any) {
        reject(new Error(`Could not open a DNS socket: ${err?.message || "unknown error"}`));
        return;
      }

      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          /* already closed */
        }
        fn();
      };

      const timer = setTimeout(
        () => finish(() => reject(new Error(`DNS query for ${name} timed out after ${timeoutMs}ms`))),
        timeoutMs
      );

      socket.on("message", buffer => {
        finish(() => {
          try {
            resolve(this.parseMessage(buffer));
          } catch (err: any) {
            reject(new Error(`Malformed DNS response for ${name}: ${err?.message || "unparseable"}`));
          }
        });
      });

      socket.on("error", err => finish(() => reject(err)));

      const id = Math.floor(Math.random() * 0xffff);
      try {
        socket.send(this.buildQuery(name, qtype, id), 53, resolver, err => {
          if (err) finish(() => reject(err));
        });
      } catch (err: any) {
        finish(() => reject(err));
      }
    });
  }

  // ---- RDATA decoding --------------------------------------------------

  /** Decodes DS RDATA: key tag (2), algorithm (1), digest type (1), digest. */
  private parseDs(rdata: Buffer): DsRecord | null {
    if (rdata.length < 5) return null;
    const algorithm = rdata.readUInt8(2);
    const digestType = rdata.readUInt8(3);
    return {
      keyTag: rdata.readUInt16BE(0),
      algorithm,
      algorithmName: ALGORITHM_NAMES[algorithm] || `Algorithm ${algorithm}`,
      digestType,
      digestTypeName: DIGEST_TYPE_NAMES[digestType] || `Digest type ${digestType}`,
      digest: rdata.subarray(4).toString("hex").toUpperCase()
    };
  }

  /** Decodes DNSKEY RDATA: flags (2), protocol (1), algorithm (1), key. */
  private parseDnskey(rdata: Buffer): DnskeyRecord | null {
    if (rdata.length < 5) return null;
    const flags = rdata.readUInt16BE(0);
    const algorithm = rdata.readUInt8(3);
    // Bit 7 (0x0001) is the Secure Entry Point flag: set on a KSK.
    const role: "KSK" | "ZSK" | "OTHER" =
      (flags & 0x0100) === 0 ? "OTHER" : (flags & 0x0001) === 1 ? "KSK" : "ZSK";

    return {
      flags,
      role,
      protocol: rdata.readUInt8(2),
      algorithm,
      algorithmName: ALGORITHM_NAMES[algorithm] || `Algorithm ${algorithm}`,
      keyTag: this.computeKeyTag(rdata),
      publicKeyBytes: Math.max(0, rdata.length - 4)
    };
  }

  /**
   * Computes a DNSKEY's key tag per RFC 4034 Appendix B: a one's-complement
   * checksum over the record's own RDATA. Exact arithmetic on observed
   * bytes, which is what lets a DNSKEY be matched against a parent DS.
   */
  public computeKeyTag(rdata: Buffer): number {
    // Algorithm 1 (RSAMD5) uses a different, long-deprecated rule; it is not
    // implemented, and 0 signals "not computed" rather than a wrong tag.
    if (rdata.length >= 4 && rdata.readUInt8(3) === 1) return 0;

    let accumulator = 0;
    for (let i = 0; i < rdata.length; i++) {
      accumulator += i & 1 ? rdata[i] : rdata[i] << 8;
    }
    accumulator += (accumulator >> 16) & 0xffff;
    return accumulator & 0xffff;
  }

  /** Decodes NSEC3PARAM RDATA far enough to report the zone's parameters. */
  private parseNsec3Param(rdata: Buffer): { hashAlgorithm: number; flags: number; iterations: number; saltLength: number } | null {
    if (rdata.length < 5) return null;
    return {
      hashAlgorithm: rdata.readUInt8(0),
      flags: rdata.readUInt8(1),
      iterations: rdata.readUInt16BE(2),
      saltLength: rdata.readUInt8(4)
    };
  }

  public async run(query: InvestigationQuery): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const domain = this.extractDomain(query.term || "");
    const startedAt = Date.now();
    const timeoutMs = this.getQueryTimeoutMs();

    // DNSSEC applies to zones. An IP, organization, or person has none.
    if (
      !domain ||
      net.isIP(domain) ||
      query.type === "Organization" ||
      query.type === "Person" ||
      query.type === "IPAddress" ||
      !this.looksLikeDomain(domain)
    ) {
      return this.buildNoDataResult(timestamp, 0, "DNSSEC lookup skipped: target is not a domain.");
    }

    const cacheKey = domain;
    const ttl = this.getCacheTtl();
    const cached = DnssecConnector.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttl) {
      console.log(`[DNSSEC Cache] Serving cached result for ${domain}`);
      return { ...cached.result, timestamp };
    }

    const resolver = this.getResolver();
    if (!resolver) {
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        "No DNS resolver is configured, so DNSSEC status could not be determined."
      );
    }

    // ---- Step 1: DS and DNSKEY ----------------------------------------
    let dsMessage: DnsMessage;
    let dnskeyMessage: DnsMessage;
    try {
      [dsMessage, dnskeyMessage] = await Promise.all([
        this.query(resolver, domain, TYPE_DS, timeoutMs),
        this.query(resolver, domain, TYPE_DNSKEY, timeoutMs)
      ]);
    } catch (err: any) {
      const message = `Could not query DNSSEC records for "${domain}" via ${resolver}: ${err?.message || "resolver failure"}.`;
      console.warn(`[DNSSEC] ${message}`);
      return this.buildErrorResult(timestamp, Date.now() - startedAt, message);
    }

    // A SERVFAIL from a validating resolver is the classic signature of a
    // broken chain of trust, but it is also what a plain outage looks like.
    // Reporting it as "DNSSEC is broken" would overstate what was observed,
    // so it is an inconclusive error that says exactly that.
    if (dsMessage.rcode === RCODE_SERVFAIL || dnskeyMessage.rcode === RCODE_SERVFAIL) {
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        `The resolver returned SERVFAIL for "${domain}". This is inconclusive: it can indicate a failed ` +
          `DNSSEC validation, but also an ordinary resolver or upstream failure.`
      );
    }

    if (dsMessage.rcode === RCODE_NXDOMAIN && dnskeyMessage.rcode === RCODE_NXDOMAIN) {
      const result = this.buildNoDataResult(
        timestamp,
        Date.now() - startedAt,
        `The resolver reports that "${domain}" does not exist, so it has no zone to inspect.`
      );
      DnssecConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    if (dsMessage.rcode !== RCODE_NOERROR && dsMessage.rcode !== RCODE_NXDOMAIN) {
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        `The resolver returned DNS response code ${dsMessage.rcode} for "${domain}", so DNSSEC status could not be determined.`
      );
    }

    const dsRecords = dsMessage.answers
      .filter(r => r.type === TYPE_DS)
      .map(r => this.parseDs(r.rdata))
      .filter((d): d is DsRecord => d !== null)
      .slice(0, MAX_RECORDS_REPORTED);

    const dnskeyRecords = dnskeyMessage.answers
      .filter(r => r.type === TYPE_DNSKEY)
      .map(r => this.parseDnskey(r.rdata))
      .filter((d): d is DnskeyRecord => d !== null)
      .slice(0, MAX_RECORDS_REPORTED);

    const signed = dsRecords.length > 0 || dnskeyRecords.length > 0;
    const authenticData = dsMessage.authenticData || dnskeyMessage.authenticData;

    const validationStatus: ValidationStatus = authenticData
      ? "SECURE"
      : signed
      ? "INDETERMINATE"
      : "INSECURE";

    // ---- Step 2: denial-of-existence scheme, only for signed zones -----
    let denialScheme: DenialScheme = "NOT_DETECTED";
    let nsec3Params: ReturnType<DnssecConnector["parseNsec3Param"]> = null;
    let denialProbeFailed = false;

    if (signed) {
      try {
        const nsec3ParamMessage = await this.query(resolver, domain, TYPE_NSEC3PARAM, timeoutMs);
        const nsec3ParamRecord = nsec3ParamMessage.answers.find(r => r.type === TYPE_NSEC3PARAM);
        if (nsec3ParamRecord) {
          nsec3Params = this.parseNsec3Param(nsec3ParamRecord.rdata);
          denialScheme = "NSEC3";
        }
      } catch {
        denialProbeFailed = true;
      }

      // No NSEC3PARAM does not mean NSEC - it only means NSEC3 was not
      // advertised there. Ask for a name that cannot exist and read which
      // record type the zone actually uses to deny it.
      if (denialScheme === "NOT_DETECTED") {
        const probeLabel = `sentinel-dnssec-probe-${Date.now().toString(36)}`;
        try {
          const negative = await this.query(resolver, `${probeLabel}.${domain}`, TYPE_A, timeoutMs);
          if (negative.authority.some(r => r.type === TYPE_NSEC3)) denialScheme = "NSEC3";
          else if (negative.authority.some(r => r.type === TYPE_NSEC)) denialScheme = "NSEC";
        } catch {
          denialProbeFailed = true;
        }
      }
    }

    const detectionTimeMs = Date.now() - startedAt;

    const diagnostics = {
      detectionTimeMs,
      source: "Direct DNS query (EDNS0 DO bit set)",
      resolver,
      target: domain,
      dnssecEnabled: signed,
      validationStatus,
      authenticatedData: authenticData,
      dsRecordCount: dsRecords.length,
      dnskeyRecordCount: dnskeyRecords.length,
      kskCount: dnskeyRecords.filter(k => k.role === "KSK").length,
      zskCount: dnskeyRecords.filter(k => k.role === "ZSK").length,
      denialScheme,
      denialProbeFailed,
      responseTruncated: dsMessage.truncated || dnskeyMessage.truncated
    };

    // ---- Step 3: evidence ----------------------------------------------
    const evidences: Evidence[] = [];
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    evidences.push({
      id: "ev_dnssec_status",
      connector: this.name,
      title: signed ? "DNSSEC Enabled" : "DNSSEC Not Enabled",
      description: signed
        ? `"${domain}" is DNSSEC-signed: the resolver returned ${dsRecords.length} DS record` +
          `${dsRecords.length === 1 ? "" : "s"} and ${dnskeyRecords.length} DNSKEY record` +
          `${dnskeyRecords.length === 1 ? "" : "s"}. Validation status is ${validationStatus}` +
          `${
            authenticData
              ? ", meaning the resolver verified the chain of trust and set the Authenticated Data flag."
              : ", meaning signing material is published but the resolver did not set the Authenticated Data flag."
          }`
        : `"${domain}" is not DNSSEC-signed: the resolver answered without error and published neither ` +
          `DS nor DNSKEY records for the zone. Responses for this domain are therefore unauthenticated.`,
      confidence: CONFIDENCE_STATUS,
      timestamp,
      rawData: {
        domain,
        dnssecEnabled: signed,
        validationStatus,
        authenticatedData: authenticData,
        dsRecordCount: dsRecords.length,
        dnskeyRecordCount: dnskeyRecords.length,
        resolver,
        diagnostics
      },
      verified: true,
      source: `Direct DNS query via ${resolver}`,
      strength: CONFIDENCE_STATUS / 100,
      url: `https://dnsviz.net/d/${encodeURIComponent(domain)}/dnssec/`
    });

    if (dsRecords.length > 0) {
      evidences.push({
        id: "ev_dnssec_ds",
        connector: this.name,
        title: "DS Records (Parent Delegation)",
        description:
          `The parent zone publishes ${dsRecords.length} DS record${dsRecords.length === 1 ? "" : "s"} for "${domain}": ` +
          dsRecords
            .map(d => `key tag ${d.keyTag}, ${d.algorithmName}, ${d.digestTypeName} digest`)
            .join("; ") + ".",
        confidence: CONFIDENCE_RECORDS,
        timestamp,
        rawData: { dsRecords, diagnostics },
        verified: true,
        source: `Direct DNS query via ${resolver}`,
        strength: CONFIDENCE_RECORDS / 100
      });
    }

    if (dnskeyRecords.length > 0) {
      const ksks = dnskeyRecords.filter(k => k.role === "KSK");
      const zsks = dnskeyRecords.filter(k => k.role === "ZSK");
      evidences.push({
        id: "ev_dnssec_dnskey",
        connector: this.name,
        title: "DNSKEY Records (Zone Signing Keys)",
        description:
          `The zone publishes ${dnskeyRecords.length} DNSKEY record${dnskeyRecords.length === 1 ? "" : "s"}` +
          `${ksks.length > 0 || zsks.length > 0 ? ` (${ksks.length} key-signing, ${zsks.length} zone-signing)` : ""}: ` +
          dnskeyRecords.map(k => `key tag ${k.keyTag}, ${k.algorithmName}, ${k.role}`).join("; ") + ".",
        confidence: CONFIDENCE_RECORDS,
        timestamp,
        rawData: {
          dnskeyRecords,
          keySigningKeys: ksks.length,
          zoneSigningKeys: zsks.length,
          // A DNSKEY whose computed tag matches a parent DS is the link in
          // the chain of trust; both sides are observed, not assumed.
          matchedToDs: dnskeyRecords
            .filter(k => dsRecords.some(d => d.keyTag === k.keyTag))
            .map(k => k.keyTag),
          diagnostics
        },
        verified: true,
        source: `Direct DNS query via ${resolver}`,
        strength: CONFIDENCE_RECORDS / 100
      });
    }

    if (denialScheme !== "NOT_DETECTED") {
      evidences.push({
        id: "ev_dnssec_denial",
        connector: this.name,
        title: "Proof-of-Non-Existence Scheme",
        description:
          `"${domain}" uses ${denialScheme} to prove that a name does not exist` +
          `${
            nsec3Params
              ? `, with ${nsec3Params.iterations} hash iteration${nsec3Params.iterations === 1 ? "" : "s"} ` +
                `and a ${nsec3Params.saltLength}-byte salt`
              : ""
          }. ` +
          `${
            denialScheme === "NSEC"
              ? "NSEC responses disclose the next name in the zone, which permits zone walking."
              : "NSEC3 hashes zone names, which resists straightforward zone walking."
          }`,
        confidence: CONFIDENCE_DENIAL,
        timestamp,
        rawData: { denialScheme, nsec3Params, diagnostics },
        verified: true,
        source: `Direct DNS query via ${resolver}`,
        strength: CONFIDENCE_DENIAL / 100
      });
    }

    const evidenceIds = evidences.map(e => e.id);

    // ---- Step 4: entities ----------------------------------------------
    // Uses the same `type` + `name` canonical key the DNS connector uses so
    // the two merge into a single graph node.
    const domainEntityId = `ent_dnssec_domain_${domain.replace(/[^a-zA-Z0-9]/g, "_")}`;
    entities.push({
      id: domainEntityId,
      name: domain,
      type: "Domain",
      metadata: {
        resolver: this.name,
        dnssecEnabled: signed,
        validationStatus,
        dsRecordCount: dsRecords.length,
        dnskeyRecordCount: dnskeyRecords.length,
        denialScheme: denialScheme === "NOT_DETECTED" ? undefined : denialScheme
      },
      evidenceIds
    });

    const result: ConnectorResult = {
      connectorName: this.name,
      success: true,
      status: "SUCCESS",
      verified: true,
      timestamp,
      entities,
      relationships,
      timeline: [],
      evidences,
      sources: [`dns:${domain}?type=DS`, `dns:${domain}?type=DNSKEY`],
      rawData: {
        domain,
        detectionTimeMs,
        dnssecEnabled: signed,
        validationStatus,
        dsRecords,
        dnskeyRecords,
        denialScheme,
        diagnostics
      }
    };

    DnssecConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }

  private buildNoDataResult(timestamp: string, detectionTimeMs: number, info: string): ConnectorResult {
    return {
      connectorName: this.name,
      success: true,
      status: "NO_DATA",
      verified: true,
      timestamp,
      entities: [],
      relationships: [],
      timeline: [],
      evidences: [],
      sources: [],
      rawData: { detectionTimeMs, dnssecEnabled: false, info }
    };
  }

  private buildErrorResult(timestamp: string, detectionTimeMs: number, message: string): ConnectorResult {
    return {
      connectorName: this.name,
      success: false,
      status: "ERROR",
      verified: true,
      timestamp,
      entities: [],
      relationships: [],
      timeline: [],
      evidences: [],
      sources: [],
      error: message,
      rawData: { detectionTimeMs }
    };
  }
}
