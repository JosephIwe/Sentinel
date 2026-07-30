import dns from "dns/promises";
import net from "net";
import { Connector, ConnectorResult, Entity, Evidence, InvestigationQuery, Relationship } from "../types";
import { isBlockedAddress } from "../utils/ssrfGuard";

interface CacheEntry {
  result: ConnectorResult;
  timestamp: number;
}

/**
 * A single BGP origin record for one IP address, transcribed verbatim from
 * Team Cymru's `origin.asn.cymru.com` / `origin6.asn.cymru.com` TXT answer.
 *
 * Response shape: `ASN | BGP Prefix | CC | Registry | Allocated`
 *   e.g. `13335 | 104.16.128.0/20 | US | arin | 2014-03-28`
 */
interface OriginRecord {
  ip: string;
  asns: string[];
  cidr?: string;
  countryCode?: string;
  registry?: string;
  allocatedOn?: string;
}

/**
 * The AS-level registration record, transcribed from `AS<n>.asn.cymru.com`.
 *
 * Response shape: `ASN | CC | Registry | Allocated | AS Name`
 *   e.g. `13335 | US | arin | 2010-07-14 | CLOUDFLARENET - Cloudflare, Inc., US`
 */
interface AsRecord {
  asn: string;
  countryCode?: string;
  registry?: string;
  allocatedOn?: string;
  organization?: string;
}

interface AddressRange {
  start: string;
  end: string;
  addressCount: string;
}

const MAX_VALUE_LENGTH = 200;

// A domain can resolve to many addresses (large CDN fronts routinely return
// a dozen). These caps bound the number of outbound DNS lookups and the
// graph size; the true totals always appear in the diagnostics, so a capped
// view is never mistaken for the full picture.
const MAX_IPS_QUERIED = 8;
const MAX_ASNS_QUERIED = 8;

// Confidence tiers. BGP origin data is observed routing state transcribed
// directly from the source, so it ranks high; the AS organization name is a
// registration string that operators update irregularly, so it ranks lower.
const CONFIDENCE_ASN = 96;      // ASN + announced prefix for a resolved IP
const CONFIDENCE_REGISTRY = 94; // RIR, registry country, allocation date
const CONFIDENCE_ORG = 90;      // AS organization / network operator name

/**
 * The five Regional Internet Registries, keyed by the lowercase token Team
 * Cymru returns. Used only to expand a known token into its full name - an
 * unrecognised token is passed through verbatim rather than guessed at.
 */
const REGISTRY_NAMES: Record<string, string> = {
  arin: "ARIN",
  ripencc: "RIPE NCC",
  ripe: "RIPE NCC",
  apnic: "APNIC",
  afrinic: "AFRINIC",
  lacnic: "LACNIC"
};

/**
 * ASN / IP Intelligence Connector
 *
 * Resolves the investigation target to its public IP addresses and reports
 * the network each address is announced from, using Team Cymru's public
 * IP-to-ASN DNS interface as the sole source.
 *
 * Every reported field is transcribed from a source answer:
 *   - ASN, announced CIDR, registry country, RIR, allocation date come from
 *     the `origin`/`origin6` TXT record for the address.
 *   - The AS organization (the network operator - equivalently the ISP or
 *     hosting provider for that address) comes from the `AS<n>` TXT record.
 *
 * The only computed value is the address range, which is exact arithmetic on
 * the announced CIDR, not an estimate. Nothing else is derived, and no
 * hardcoded provider list is consulted: if the source does not name an
 * operator, none is reported.
 *
 * Note on country: the source returns the country recorded against the
 * *allocation*, which is a registration fact and not the physical location
 * of the host. Evidence wording says so explicitly, because presenting a
 * registry country as a geolocation would be a fabricated finding.
 *
 * An address that is genuinely not announced in BGP resolves NXDOMAIN and
 * contributes NO_DATA. Any other lookup failure (timeout, SERVFAIL, refused)
 * is inconclusive and yields ERROR - never a false "this host has no ASN".
 */
export class AsnIpIntelligenceConnector implements Connector {
  public name = "ASN / IP Intelligence";

  private static cache = new Map<string, CacheEntry>();

  /**
   * Configurable cache duration (TTL) in milliseconds.
   * Defaults to 3600000 (1 hour) - BGP allocations change slowly.
   */
  private getCacheTtl(): number {
    const envTtl = process.env.ASN_CACHE_TTL_MS;
    if (envTtl) {
      const parsed = parseInt(envTtl, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 60 * 60 * 1000;
  }

  /**
   * Configurable per-lookup timeout in milliseconds. Defaults to 4000 -
   * deliberately below the orchestrator's 5000ms per-connector default so
   * this connector's own descriptive ERROR wins the race rather than being
   * surfaced as a generic outer TIMEOUT.
   */
  private getLookupTimeoutMs(): number {
    const envTimeout = process.env.ASN_TIMEOUT_MS;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 4000;
  }

  /**
   * Wraps a DNS promise with a strict timeout so a hanging resolver fails
   * fast. Mirrors the DnsConnector's own timeout helper.
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Timeout reached")), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
  }

  private extractHost(term: string): string {
    let cleaned = term.trim().toLowerCase();
    if (cleaned.includes("@")) cleaned = cleaned.split("@")[1] || cleaned;
    cleaned = cleaned.replace(/^\w+:\/\//, "");
    cleaned = cleaned.split("/")[0].split("?")[0];
    // Strip a trailing :port, but leave IPv6 literals (which are colon-dense)
    // intact so they still parse as addresses.
    if (!net.isIP(cleaned) && cleaned.split(":").length === 2) {
      cleaned = cleaned.split(":")[0];
    }
    cleaned = cleaned.replace(/^www\./, "");
    return cleaned.trim();
  }

  private looksLikeDomain(term: string): boolean {
    return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(term);
  }

  /**
   * True for dotted-numeric terms that are not valid addresses, e.g.
   * "999.999.999.999". These are syntactically legal DNS names, so the
   * hostname check alone would let them through and trigger a pointless
   * lookup; they are malformed input, not resolvable targets.
   */
  private looksLikeMalformedIp(term: string): boolean {
    return /^\d+(\.\d+)+$/.test(term) && !net.isIP(term);
  }

  private truncate(value: string): string {
    const collapsed = value.replace(/\s+/g, " ").trim();
    return collapsed.length > MAX_VALUE_LENGTH
      ? `${collapsed.slice(0, MAX_VALUE_LENGTH)}…`
      : collapsed;
  }

  /**
   * Builds the reversed-octet query name Team Cymru expects for an IPv4
   * address: 8.8.8.8 -> 8.8.8.8.origin.asn.cymru.com
   */
  private ipv4QueryName(ip: string): string {
    return `${ip.split(".").reverse().join(".")}.origin.asn.cymru.com`;
  }

  /**
   * Expands an IPv6 address to its full 32-nibble hex form, or returns null
   * if the address cannot be expanded.
   */
  private expandIpv6(address: string): string | null {
    const halves = address.split("::");
    if (halves.length > 2) return null;

    const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : [];

    let groups: string[];
    if (halves.length === 1) {
      if (head.length !== 8) return null;
      groups = head;
    } else {
      const missing = 8 - head.length - tail.length;
      if (missing < 0) return null;
      groups = [...head, ...Array(missing).fill("0"), ...tail];
    }

    if (groups.some(g => !/^[0-9a-fA-F]{1,4}$/.test(g))) return null;
    return groups.map(g => g.padStart(4, "0")).join("").toLowerCase();
  }

  /**
   * Builds the reversed-nibble query name Team Cymru expects for an IPv6
   * address, under the origin6 zone.
   */
  private ipv6QueryName(ip: string): string | null {
    const expanded = this.expandIpv6(ip);
    if (!expanded) return null;
    return `${expanded.split("").reverse().join(".")}.origin6.asn.cymru.com`;
  }

  /**
   * Computes the exact first and last address of an announced CIDR. This is
   * arithmetic on an observed prefix, not an inference: given
   * 104.16.128.0/20 the range is fully determined.
   */
  public cidrToRange(cidr: string): AddressRange | null {
    const [base, prefixPart] = cidr.split("/");
    const prefix = parseInt(prefixPart, 10);
    if (!base || isNaN(prefix)) return null;

    if (net.isIPv4(base)) {
      if (prefix < 0 || prefix > 32) return null;
      const octets = base.split(".").map(o => parseInt(o, 10));
      if (octets.length !== 4 || octets.some(o => isNaN(o) || o < 0 || o > 255)) return null;

      const baseInt = octets.reduce((acc, o) => (acc << 8n) | BigInt(o), 0n);
      const hostBits = BigInt(32 - prefix);
      const size = 1n << hostBits;
      const start = (baseInt >> hostBits) << hostBits;
      const end = start + size - 1n;

      return {
        start: this.bigIntToIpv4(start),
        end: this.bigIntToIpv4(end),
        addressCount: size.toString()
      };
    }

    if (net.isIPv6(base)) {
      if (prefix < 0 || prefix > 128) return null;
      const expanded = this.expandIpv6(base);
      if (!expanded) return null;

      const baseInt = BigInt(`0x${expanded}`);
      const hostBits = BigInt(128 - prefix);
      const size = 1n << hostBits;
      const start = (baseInt >> hostBits) << hostBits;
      const end = start + size - 1n;

      return {
        start: this.bigIntToIpv6(start),
        end: this.bigIntToIpv6(end),
        addressCount: size.toString()
      };
    }

    return null;
  }

  private bigIntToIpv4(value: bigint): string {
    return [24n, 16n, 8n, 0n].map(shift => ((value >> shift) & 0xffn).toString()).join(".");
  }

  /**
   * Renders an IPv6 address in full uncompressed form. Range endpoints are
   * written out rather than :: compressed so they are unambiguous.
   */
  private bigIntToIpv6(value: bigint): string {
    const hex = value.toString(16).padStart(32, "0");
    return (hex.match(/.{4}/g) || []).join(":");
  }

  /**
   * Splits one Team Cymru pipe-delimited TXT answer into trimmed fields.
   * Empty fields are preserved as empty strings so positions stay aligned.
   */
  private splitFields(txt: string): string[] {
    return txt.split("|").map(field => field.trim());
  }

  /**
   * Resolves TXT records, distinguishing an authoritative "no such record"
   * (the name genuinely is not in the zone) from an inconclusive failure.
   * Returns null for the former and throws for the latter, so the caller
   * never reports a failed lookup as a confirmed absence.
   */
  private async resolveTxtOrNull(name: string, timeoutMs: number): Promise<string[][] | null> {
    try {
      return await this.withTimeout(dns.resolveTxt(name), timeoutMs);
    } catch (err: any) {
      if (err?.code === "ENOTFOUND" || err?.code === "ENODATA" || err?.code === "NXDOMAIN") {
        return null;
      }
      throw err;
    }
  }

  public async run(query: InvestigationQuery): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const host = this.extractHost(query.term || "");
    const startedAt = Date.now();
    const timeoutMs = this.getLookupTimeoutMs();

    const isIpTarget = !!net.isIP(host);

    // Organization and Person targets have no address of their own to look
    // up, and a term that is neither an IP nor a hostname cannot be resolved.
    if (
      !host ||
      query.type === "Organization" ||
      query.type === "Person" ||
      this.looksLikeMalformedIp(host) ||
      (!isIpTarget && !this.looksLikeDomain(host))
    ) {
      return this.buildNoDataResult(
        timestamp,
        0,
        "ASN / IP intelligence lookup skipped: target is not a domain or IP address."
      );
    }

    const cacheKey = `${query.type || "Generic"}:${host}`;
    const ttl = this.getCacheTtl();
    const cached = AsnIpIntelligenceConnector.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttl) {
      console.log(`[AsnIpIntelligence Cache] Serving cached result for ${cacheKey}`);
      return { ...cached.result, timestamp };
    }

    // ---- Step 1: establish the set of addresses to look up -------------
    let resolvedIps: string[] = [];
    let resolutionFailed: string | undefined;

    if (isIpTarget) {
      resolvedIps = [host];
    } else {
      const v4 = await Promise.allSettled([
        this.withTimeout(dns.resolve4(host), timeoutMs),
        this.withTimeout(dns.resolve6(host), timeoutMs)
      ]);

      const addresses: string[] = [];
      let hardFailures = 0;
      for (const outcome of v4) {
        if (outcome.status === "fulfilled") {
          addresses.push(...outcome.value);
        } else {
          const code = (outcome.reason as any)?.code;
          // ENODATA/ENOTFOUND simply mean this record type is absent, which
          // is normal (most hosts have no AAAA). Anything else is a real
          // resolver failure.
          if (code !== "ENODATA" && code !== "ENOTFOUND") hardFailures++;
        }
      }

      resolvedIps = addresses;
      if (addresses.length === 0 && hardFailures > 0) {
        resolutionFailed = `Could not resolve "${host}" to any IP address: the DNS resolver failed.`;
      }
    }

    if (resolutionFailed) {
      return this.buildErrorResult(timestamp, Date.now() - startedAt, resolutionFailed);
    }

    // Never send private, loopback, link-local, or metadata addresses to an
    // external lookup service. Reuses the shared SSRF guard's block list.
    const publicIps: string[] = [];
    let skippedNonPublic = 0;
    for (const ip of resolvedIps) {
      if (isBlockedAddress(ip)) {
        skippedNonPublic++;
        continue;
      }
      if (!publicIps.includes(ip)) publicIps.push(ip);
    }

    if (publicIps.length === 0) {
      return this.buildNoDataResult(
        timestamp,
        Date.now() - startedAt,
        skippedNonPublic > 0
          ? `"${host}" resolves only to non-public addresses, which have no BGP origin to report.`
          : `No public IP address could be derived from "${host}".`
      );
    }

    const truncatedIps = publicIps.length > MAX_IPS_QUERIED;
    const queriedIps = publicIps.slice(0, MAX_IPS_QUERIED);

    // ---- Step 2: BGP origin lookup per address -------------------------
    const origins: OriginRecord[] = [];
    let ipsWithoutOrigin = 0;
    let lookupErrors = 0;
    let lastLookupError: string | undefined;

    await Promise.allSettled(
      queriedIps.map(async ip => {
        const queryName = net.isIPv4(ip) ? this.ipv4QueryName(ip) : this.ipv6QueryName(ip);
        if (!queryName) {
          ipsWithoutOrigin++;
          return;
        }

        let records: string[][] | null;
        try {
          records = await this.resolveTxtOrNull(queryName, timeoutMs);
        } catch (err: any) {
          lookupErrors++;
          lastLookupError = err?.message || String(err);
          console.warn(`[AsnIpIntelligence] Origin lookup failed for ${ip}: ${lastLookupError}`);
          return;
        }

        if (!records || records.length === 0) {
          // Authoritative NXDOMAIN: this address is genuinely not announced.
          ipsWithoutOrigin++;
          return;
        }

        for (const chunks of records) {
          const fields = this.splitFields(chunks.join(""));
          // An origin answer without at least an ASN field is unusable.
          const asnField = fields[0] || "";
          const asns = asnField.split(/\s+/).map(a => a.trim()).filter(a => /^\d+$/.test(a));
          if (asns.length === 0) continue;

          origins.push({
            ip,
            asns,
            cidr: fields[1] || undefined,
            countryCode: fields[2] || undefined,
            registry: fields[3] || undefined,
            allocatedOn: fields[4] || undefined
          });
        }
      })
    );

    // Every lookup failed inconclusively - we cannot claim the host has no
    // ASN, so this is an error, not an absence.
    if (origins.length === 0 && lookupErrors > 0 && ipsWithoutOrigin === 0) {
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        `Could not complete the IP-to-ASN lookup for "${host}": ${lastLookupError || "the lookup service was unreachable"}.`
      );
    }

    if (origins.length === 0) {
      return this.buildNoDataResult(
        timestamp,
        Date.now() - startedAt,
        isIpTarget
          ? `No BGP origin record is published for "${host}".`
          : `No BGP origin record is published for the ${queriedIps.length === 1 ? "address" : "addresses"} "${host}" resolves to.`
      );
    }

    // ---- Step 3: AS registration lookup per distinct ASN ---------------
    const distinctAsns: string[] = [];
    for (const origin of origins) {
      for (const asn of origin.asns) {
        if (!distinctAsns.includes(asn)) distinctAsns.push(asn);
      }
    }

    const truncatedAsns = distinctAsns.length > MAX_ASNS_QUERIED;
    const queriedAsns = distinctAsns.slice(0, MAX_ASNS_QUERIED);
    const asRecords = new Map<string, AsRecord>();

    await Promise.allSettled(
      queriedAsns.map(async asn => {
        let records: string[][] | null;
        try {
          records = await this.resolveTxtOrNull(`AS${asn}.asn.cymru.com`, timeoutMs);
        } catch (err: any) {
          // A missing organization name degrades the report; it does not
          // invalidate the ASN evidence already gathered.
          lookupErrors++;
          console.warn(`[AsnIpIntelligence] AS registration lookup failed for AS${asn}: ${err?.message}`);
          return;
        }

        if (!records || records.length === 0) return;

        const fields = this.splitFields(records[0].join(""));
        asRecords.set(asn, {
          asn,
          countryCode: fields[1] || undefined,
          registry: fields[2] || undefined,
          allocatedOn: fields[3] || undefined,
          organization: fields[4] ? this.truncate(fields[4]) : undefined
        });
      })
    );

    const detectionTimeMs = Date.now() - startedAt;

    const diagnostics = {
      detectionTimeMs,
      source: "Team Cymru IP-to-ASN (DNS)",
      target: host,
      ipsResolved: resolvedIps.length,
      ipsQueried: queriedIps.length,
      ipsSkippedNonPublic: skippedNonPublic,
      ipsWithoutOrigin,
      asnsDiscovered: distinctAsns.length,
      organizationsResolved: asRecords.size,
      lookupErrors,
      truncatedIps,
      truncatedAsns,
      organizationSource: "AS registration record",
      // The source publishes no registrant contact detail; RDAP would be
      // required for that, and is not consulted by this connector.
      registrantContactsAvailable: false
    };

    // ---- Step 4: evidence ---------------------------------------------
    const evidences: Evidence[] = [];
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    const networks = origins.map(origin => {
      const range = origin.cidr ? this.cidrToRange(origin.cidr) : null;
      return {
        ip: origin.ip,
        asn: origin.asns[0],
        allAsns: origin.asns,
        cidr: origin.cidr,
        rangeStart: range?.start,
        rangeEnd: range?.end,
        addressCount: range?.addressCount,
        countryCode: origin.countryCode,
        registry: origin.registry ? REGISTRY_NAMES[origin.registry.toLowerCase()] || origin.registry : undefined,
        allocatedOn: origin.allocatedOn,
        organization: asRecords.get(origin.asns[0])?.organization
      };
    });

    const asnSummary = distinctAsns.map(a => `AS${a}`).join(", ");

    evidences.push({
      id: "ev_asn_networks",
      connector: this.name,
      title: "Autonomous System & Network Allocation",
      description:
        `${queriedIps.length} resolved address${queriedIps.length === 1 ? " is" : "es are"} announced from ` +
        `${distinctAsns.length} autonomous system${distinctAsns.length === 1 ? "" : "s"} (${asnSummary}). ` +
        networks
          .map(n => `${n.ip} is announced by AS${n.asn}${n.cidr ? ` within ${n.cidr}` : ""}`)
          .join("; ") + ".",
      confidence: CONFIDENCE_ASN,
      timestamp,
      rawData: {
        networks,
        asnCount: distinctAsns.length,
        ipCount: queriedIps.length,
        diagnostics
      },
      verified: true,
      source: "Team Cymru IP-to-ASN (DNS)",
      strength: CONFIDENCE_ASN / 100,
      url: "https://team-cymru.com/community-services/ip-asn-mapping/"
    });

    const organizations = queriedAsns
      .map(asn => asRecords.get(asn))
      .filter((rec): rec is AsRecord => !!rec && !!rec.organization);

    if (organizations.length > 0) {
      evidences.push({
        id: "ev_asn_organization",
        connector: this.name,
        title: "Network Operator",
        description:
          `The announcing network${organizations.length === 1 ? " is" : "s are"} operated by ` +
          `${organizations.map(o => `${o.organization} (AS${o.asn})`).join(", ")}. ` +
          `This is the AS organization on record - the operator of the address space, ` +
          `which is the ISP or hosting provider serving the target.`,
        confidence: CONFIDENCE_ORG,
        timestamp,
        rawData: {
          organizations: organizations.map(o => ({
            asn: o.asn,
            organization: o.organization,
            registry: o.registry ? REGISTRY_NAMES[o.registry.toLowerCase()] || o.registry : undefined,
            registeredOn: o.allocatedOn,
            countryCode: o.countryCode
          })),
          diagnostics
        },
        verified: true,
        source: "Team Cymru AS registration (DNS)",
        strength: CONFIDENCE_ORG / 100,
        url: "https://team-cymru.com/community-services/ip-asn-mapping/"
      });
    }

    const registryEntries = networks
      .filter(n => n.registry || n.countryCode || n.allocatedOn)
      .map(n => ({
        cidr: n.cidr,
        registry: n.registry,
        countryCode: n.countryCode,
        allocatedOn: n.allocatedOn
      }));

    if (registryEntries.length > 0) {
      const registries = Array.from(new Set(registryEntries.map(r => r.registry).filter(Boolean)));
      const countries = Array.from(new Set(registryEntries.map(r => r.countryCode).filter(Boolean)));

      evidences.push({
        id: "ev_asn_registry",
        connector: this.name,
        title: "Registry & Allocation Record",
        description:
          `Address space is allocated by ${registries.join(", ") || "an unnamed registry"}` +
          `${countries.length > 0 ? `, registered under country code ${countries.join(", ")}` : ""}. ` +
          registryEntries
            .filter(r => r.allocatedOn)
            .map(r => `${r.cidr || "the prefix"} allocated ${r.allocatedOn}`)
            .join("; ") +
          `. The country code reflects the registry allocation record, not the physical location of the host.`,
        confidence: CONFIDENCE_REGISTRY,
        timestamp,
        rawData: {
          allocations: registryEntries,
          registries,
          countryCodes: countries,
          diagnostics
        },
        verified: true,
        source: "Team Cymru IP-to-ASN (DNS)",
        strength: CONFIDENCE_REGISTRY / 100,
        url: "https://team-cymru.com/community-services/ip-asn-mapping/"
      });
    }

    const evidenceIds = evidences.map(e => e.id);

    // ---- Step 5: entities & relationships ------------------------------
    // A domain target gets its own node, using the same `type` + `name`
    // canonical key the DNS connector uses so the two merge into one graph
    // node. An IP target is *already* one of the address nodes below, so no
    // separate entity is emitted for it - two entities sharing a canonical
    // key would just be merged back together downstream.
    const targetEntityId = isIpTarget
      ? `ent_asn_ip_${host.replace(/[^a-zA-Z0-9]/g, "_")}`
      : `ent_asn_target_${host.replace(/[^a-zA-Z0-9]/g, "_")}`;

    if (!isIpTarget) {
      entities.push({
        id: targetEntityId,
        name: host,
        type: "Domain",
        metadata: {
          resolver: this.name,
          addressesAnnounced: queriedIps.length,
          autonomousSystems: distinctAsns.map(a => `AS${a}`)
        },
        evidenceIds
      });
    }

    for (const network of networks) {
      const ipEntityId = `ent_asn_ip_${network.ip.replace(/[^a-zA-Z0-9]/g, "_")}`;
      if (!entities.some(e => e.id === ipEntityId)) {
        entities.push({
          id: ipEntityId,
          name: network.ip,
          type: "IPAddress",
          metadata: {
            announcedBy: `AS${network.asn}`,
            cidr: network.cidr,
            rangeStart: network.rangeStart,
            rangeEnd: network.rangeEnd,
            registry: network.registry,
            countryCode: network.countryCode
          },
          // The target address carries the full evidence set; addresses
          // reached only via resolution carry the network evidence alone.
          evidenceIds: ipEntityId === targetEntityId ? evidenceIds : ["ev_asn_networks"]
        });
      }

      if (!isIpTarget && !relationships.some(r => r.source === targetEntityId && r.target === ipEntityId)) {
        relationships.push({
          source: targetEntityId,
          target: ipEntityId,
          type: "RESOLVES_TO",
          metadata: { observedBy: this.name },
          evidenceIds: ["ev_asn_networks"]
        });
      }

      const asnEntityId = `ent_asn_as_${network.asn}`;
      if (!entities.some(e => e.id === asnEntityId)) {
        entities.push({
          id: asnEntityId,
          name: `AS${network.asn}`,
          type: "ASN",
          metadata: {
            asn: network.asn,
            organization: network.organization,
            registry: network.registry,
            countryCode: network.countryCode,
            allocatedOn: network.allocatedOn
          },
          evidenceIds: ["ev_asn_networks"]
        });
      }

      if (!relationships.some(r => r.source === ipEntityId && r.target === asnEntityId)) {
        relationships.push({
          source: ipEntityId,
          target: asnEntityId,
          type: "ANNOUNCED_BY",
          metadata: { cidr: network.cidr },
          evidenceIds: ["ev_asn_networks"]
        });
      }

      if (network.organization) {
        const orgEntityId = `ent_asn_org_${network.organization.replace(/[^a-zA-Z0-9]/g, "_")}`;
        if (!entities.some(e => e.id === orgEntityId)) {
          entities.push({
            id: orgEntityId,
            name: network.organization,
            type: "Organization",
            metadata: {
              role: "Network operator (AS organization)",
              asn: `AS${network.asn}`
            },
            evidenceIds: ["ev_asn_organization"]
          });
        }

        if (!relationships.some(r => r.source === asnEntityId && r.target === orgEntityId)) {
          relationships.push({
            source: asnEntityId,
            target: orgEntityId,
            type: "OPERATED_BY",
            metadata: { source: "AS registration record" },
            evidenceIds: ["ev_asn_organization"]
          });
        }
      }
    }

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
      sources: ["dns:origin.asn.cymru.com", "dns:asn.cymru.com"],
      rawData: {
        target: host,
        detectionTimeMs,
        networks,
        asnCount: distinctAsns.length,
        diagnostics
      }
    };

    AsnIpIntelligenceConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
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
      rawData: {
        detectionTimeMs,
        asnCount: 0,
        info
      }
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
      rawData: {
        detectionTimeMs,
        asnCount: 0
      }
    };
  }
}
