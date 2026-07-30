import dns from "dns/promises";
import net from "net";
import { Connector, ConnectorResult, Entity, Evidence, InvestigationQuery, Relationship } from "../types";
import { isBlockedAddress } from "../utils/ssrfGuard";

interface CacheEntry {
  result: ConnectorResult;
  timestamp: number;
}

/** The outcome of one reverse lookup, kept verbatim. */
type ReverseStatus = "RESOLVED" | "NO_PTR" | "LOOKUP_FAILED";

interface ReverseRecord {
  ip: string;
  family: "IPv4" | "IPv6";
  status: ReverseStatus;
  /** Hostnames the resolver returned for this address, lowercased. */
  hostnames: string[];
  /**
   * Hostnames whose forward A/AAAA lookup maps back to this same address
   * (forward-confirmed reverse DNS). Always a subset of `hostnames`.
   */
  forwardConfirmed: string[];
  /** ISO timestamp of the moment this address's lookup completed. */
  resolvedAt: string;
  /** Resolver error, present only when status is LOOKUP_FAILED. */
  error?: string;
}

const MAX_VALUE_LENGTH = 200;

// A domain can resolve to many addresses. These caps bound the number of
// outbound lookups and the graph size; the true totals always appear in the
// diagnostics, so a capped view is never mistaken for the full picture.
const MAX_IPS_QUERIED = 8;
const MAX_PTR_PER_IP = 10;

// Confidence tiers. A PTR record read straight off the resolver is a direct
// observation. A forward-confirmed record is stronger still, because the
// forward zone independently corroborates it - and PTR records alone are
// controlled by whoever holds the reverse zone, so the distinction matters.
const CONFIDENCE_PTR = 94;
const CONFIDENCE_FORWARD_CONFIRMED = 97;
const CONFIDENCE_COVERAGE = 92;

/**
 * Reverse DNS Connector
 *
 * Resolves the investigation target to its public IP addresses and reports
 * the PTR records published for each one.
 *
 *   - An IP target is looked up directly.
 *   - A domain target is resolved to its A and AAAA records first, and each
 *     resulting address is then looked up in reverse.
 *
 * Every hostname reported is one the resolver actually returned. In
 * addition, each PTR hostname is resolved forward and checked against the
 * originating address, so the report distinguishes a merely-published PTR
 * from a forward-confirmed one (FCrDNS). That distinction is a real check
 * this connector performs, not an assumption: a PTR record is controlled by
 * whoever holds the reverse zone, so on its own it proves less than it
 * appears to.
 *
 * Nothing is inferred. An address with no PTR is reported as having none
 * rather than being given its forward hostname, and a hostname is never
 * carried over from another connector's findings.
 *
 * Status semantics: an authoritative NXDOMAIN/ENODATA means the address
 * genuinely publishes no PTR and contributes NO_DATA. A timeout, SERVFAIL,
 * or refused lookup is inconclusive and yields ERROR - never a false "this
 * address has no reverse record".
 */
export class ReverseDnsConnector implements Connector {
  public name = "Reverse DNS Resolver";

  private static cache = new Map<string, CacheEntry>();

  /**
   * Configurable cache duration (TTL) in milliseconds. Defaults to 300000
   * (5 minutes), matching the forward DNS connector - PTR records are
   * ordinary DNS data and change on the same timescale.
   */
  private getCacheTtl(): number {
    const envTtl = process.env.REVERSE_DNS_CACHE_TTL_MS;
    if (envTtl) {
      const parsed = parseInt(envTtl, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 5 * 60 * 1000;
  }

  /**
   * Configurable per-lookup timeout in milliseconds. Defaults to 4000 -
   * deliberately below the orchestrator's 5000ms per-connector default so
   * this connector's own descriptive ERROR wins the race rather than being
   * surfaced as a generic outer TIMEOUT.
   */
  private getLookupTimeoutMs(): number {
    const envTimeout = process.env.REVERSE_DNS_TIMEOUT_MS;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 4000;
  }

  /**
   * Wraps a DNS promise with a strict timeout so a hanging resolver fails
   * fast. Mirrors the forward DNS connector's own timeout helper.
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
    // Strip a trailing :port, but leave IPv6 literals (colon-dense) intact.
    if (!net.isIP(cleaned) && cleaned.split(":").length === 2) {
      cleaned = cleaned.split(":")[0];
    }
    cleaned = cleaned.replace(/^www\./, "");
    return cleaned.replace(/\.$/, "").trim();
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
    const collapsed = String(value).replace(/\s+/g, " ").trim();
    return collapsed.length > MAX_VALUE_LENGTH
      ? `${collapsed.slice(0, MAX_VALUE_LENGTH)}…`
      : collapsed;
  }

  /**
   * Distinguishes an authoritative "no such record" from an inconclusive
   * resolver failure, so a failed lookup is never reported as a confirmed
   * absence of PTR data.
   */
  private isAuthoritativeAbsence(code: string | undefined): boolean {
    return code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN";
  }

  /**
   * Resolves a PTR hostname forward and reports whether any of its
   * addresses match the address the PTR came from. A lookup failure means
   * "not confirmed", never "confirmed" - confirmation requires positive
   * evidence.
   */
  private async isForwardConfirmed(hostname: string, ip: string, timeoutMs: number): Promise<boolean> {
    const wantV6 = net.isIPv6(ip);
    try {
      const addresses = wantV6
        ? await this.withTimeout(dns.resolve6(hostname), timeoutMs)
        : await this.withTimeout(dns.resolve4(hostname), timeoutMs);
      return Array.isArray(addresses) && addresses.some(a => a === ip);
    } catch {
      return false;
    }
  }

  public async run(query: InvestigationQuery): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const host = this.extractHost(query.term || "");
    const startedAt = Date.now();
    const timeoutMs = this.getLookupTimeoutMs();

    const isIpTarget = !!net.isIP(host);

    // Organization and Person targets have no address to look up, and a
    // term that is neither an IP nor a hostname cannot be resolved.
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
        "Reverse DNS lookup skipped: target is not a domain or IP address."
      );
    }

    const cacheKey = `${query.type || "Generic"}:${host}`;
    const ttl = this.getCacheTtl();
    const cached = ReverseDnsConnector.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttl) {
      console.log(`[ReverseDns Cache] Serving cached result for ${cacheKey}`);
      return { ...cached.result, timestamp };
    }

    // ---- Step 1: establish the set of addresses to look up -------------
    let resolvedIps: string[] = [];

    if (isIpTarget) {
      resolvedIps = [host];
    } else {
      const outcomes = await Promise.allSettled([
        this.withTimeout(dns.resolve4(host), timeoutMs),
        this.withTimeout(dns.resolve6(host), timeoutMs)
      ]);

      const addresses: string[] = [];
      let hardFailures = 0;
      for (const outcome of outcomes) {
        if (outcome.status === "fulfilled") {
          addresses.push(...outcome.value);
        } else {
          const code = (outcome.reason as any)?.code;
          // ENODATA/ENOTFOUND simply mean this record type is absent, which
          // is normal (most hosts have no AAAA). Anything else is a real
          // resolver failure.
          if (!this.isAuthoritativeAbsence(code)) hardFailures++;
        }
      }

      if (addresses.length === 0 && hardFailures > 0) {
        return this.buildErrorResult(
          timestamp,
          Date.now() - startedAt,
          `Could not resolve "${host}" to any IP address: the DNS resolver failed.`
        );
      }

      resolvedIps = addresses;
    }

    // Reverse lookups on private, loopback, and link-local space describe
    // internal infrastructure rather than the target. Reuses the shared
    // SSRF guard's block list.
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
          ? `"${host}" resolves only to non-public addresses, which are not looked up in reverse.`
          : `No public IP address could be derived from "${host}".`
      );
    }

    const truncatedIps = publicIps.length > MAX_IPS_QUERIED;
    const queriedIps = publicIps.slice(0, MAX_IPS_QUERIED);

    // ---- Step 2: reverse lookup per address ----------------------------
    const records: ReverseRecord[] = [];

    await Promise.all(
      queriedIps.map(async ip => {
        const family: "IPv4" | "IPv6" = net.isIPv6(ip) ? "IPv6" : "IPv4";

        let hostnames: string[];
        try {
          const raw = await this.withTimeout(dns.reverse(ip), timeoutMs);
          hostnames = (Array.isArray(raw) ? raw : [])
            .map(h => this.truncate(String(h)).toLowerCase().replace(/\.$/, ""))
            .filter(Boolean)
            .slice(0, MAX_PTR_PER_IP);
        } catch (err: any) {
          const code = err?.code;
          if (this.isAuthoritativeAbsence(code)) {
            // Authoritative: this address publishes no PTR record.
            records.push({
              ip,
              family,
              status: "NO_PTR",
              hostnames: [],
              forwardConfirmed: [],
              resolvedAt: new Date().toISOString()
            });
            return;
          }
          console.warn(`[ReverseDns] Reverse lookup failed for ${ip}: ${err?.message}`);
          records.push({
            ip,
            family,
            status: "LOOKUP_FAILED",
            hostnames: [],
            forwardConfirmed: [],
            resolvedAt: new Date().toISOString(),
            error: this.truncate(err?.message || "reverse lookup failed")
          });
          return;
        }

        // Some resolvers answer with an empty array rather than NXDOMAIN.
        if (hostnames.length === 0) {
          records.push({
            ip,
            family,
            status: "NO_PTR",
            hostnames: [],
            forwardConfirmed: [],
            resolvedAt: new Date().toISOString()
          });
          return;
        }

        const confirmations = await Promise.all(
          hostnames.map(async hostname => ({
            hostname,
            confirmed: await this.isForwardConfirmed(hostname, ip, timeoutMs)
          }))
        );

        records.push({
          ip,
          family,
          status: "RESOLVED",
          hostnames,
          forwardConfirmed: confirmations.filter(c => c.confirmed).map(c => c.hostname),
          resolvedAt: new Date().toISOString()
        });
      })
    );

    // Keep output order stable and independent of resolution timing.
    records.sort((a, b) => queriedIps.indexOf(a.ip) - queriedIps.indexOf(b.ip));

    const resolvedRecords = records.filter(r => r.status === "RESOLVED");
    const noPtrCount = records.filter(r => r.status === "NO_PTR").length;
    const failedCount = records.filter(r => r.status === "LOOKUP_FAILED").length;

    // Every lookup failed inconclusively - we cannot claim these addresses
    // publish no PTR, so this is an error, not an absence.
    if (resolvedRecords.length === 0 && failedCount > 0 && noPtrCount === 0) {
      const firstError = records.find(r => r.error)?.error;
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        `Could not complete the reverse DNS lookup for "${host}": ${firstError || "the resolver was unreachable"}.`
      );
    }

    if (resolvedRecords.length === 0) {
      const result = this.buildNoDataResult(
        timestamp,
        Date.now() - startedAt,
        isIpTarget
          ? `No PTR record is published for "${host}".`
          : `No PTR record is published for the ${queriedIps.length === 1 ? "address" : "addresses"} "${host}" resolves to.`
      );
      ReverseDnsConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    const detectionTimeMs = Date.now() - startedAt;

    const distinctHostnames = Array.from(
      new Set(resolvedRecords.flatMap(r => r.hostnames))
    ).sort();
    const distinctConfirmed = Array.from(
      new Set(resolvedRecords.flatMap(r => r.forwardConfirmed))
    ).sort();

    const diagnostics = {
      detectionTimeMs,
      source: "System DNS resolver (PTR)",
      target: host,
      targetKind: isIpTarget ? "IPAddress" : "Domain",
      ipsResolved: resolvedIps.length,
      ipsQueried: queriedIps.length,
      ipsSkippedNonPublic: skippedNonPublic,
      ipsWithPtr: resolvedRecords.length,
      ipsWithoutPtr: noPtrCount,
      ipsLookupFailed: failedCount,
      ptrRecordsFound: distinctHostnames.length,
      forwardConfirmedCount: distinctConfirmed.length,
      truncatedIps
    };

    // ---- Step 3: evidence ----------------------------------------------
    const evidences: Evidence[] = [];
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    evidences.push({
      id: "ev_rdns_ptr_records",
      connector: this.name,
      title: "Reverse DNS PTR Records",
      description:
        `${resolvedRecords.length} of ${queriedIps.length} queried address${queriedIps.length === 1 ? "" : "es"} ` +
        `publish${resolvedRecords.length === 1 ? "es" : ""} a PTR record. ` +
        resolvedRecords
          .map(r => `${r.ip} resolves to ${r.hostnames.join(", ")}`)
          .join("; ") + ".",
      confidence: CONFIDENCE_PTR,
      timestamp,
      rawData: {
        records: resolvedRecords.map(r => ({
          ip: r.ip,
          family: r.family,
          status: r.status,
          hostnames: r.hostnames,
          forwardConfirmed: r.forwardConfirmed,
          resolvedAt: r.resolvedAt
        })),
        ptrRecordCount: distinctHostnames.length,
        diagnostics
      },
      verified: true,
      source: "System DNS resolver (PTR)",
      strength: CONFIDENCE_PTR / 100,
      url: `https://dns.google/resolve?name=${encodeURIComponent(resolvedRecords[0].ip)}&type=PTR`
    });

    evidences.push({
      id: "ev_rdns_hostnames",
      connector: this.name,
      title: "Hostnames Discovered via Reverse DNS",
      description:
        `Reverse lookups surfaced ${distinctHostnames.length} distinct hostname${distinctHostnames.length === 1 ? "" : "s"}: ` +
        `${distinctHostnames.join(", ")}.`,
      confidence: CONFIDENCE_PTR,
      timestamp,
      rawData: {
        hostnames: distinctHostnames,
        forwardConfirmedHostnames: distinctConfirmed,
        diagnostics
      },
      verified: true,
      source: "System DNS resolver (PTR)",
      strength: CONFIDENCE_PTR / 100
    });

    if (distinctConfirmed.length > 0) {
      evidences.push({
        id: "ev_rdns_forward_confirmed",
        connector: this.name,
        title: "Forward-Confirmed Reverse DNS",
        description:
          `${distinctConfirmed.length} of ${distinctHostnames.length} PTR hostname${distinctHostnames.length === 1 ? "" : "s"} ` +
          `resolve back to the originating address (FCrDNS): ${distinctConfirmed.join(", ")}. ` +
          `A PTR record alone is controlled by the holder of the reverse zone; forward confirmation ` +
          `means the forward zone independently corroborates it.`,
        confidence: CONFIDENCE_FORWARD_CONFIRMED,
        timestamp,
        rawData: {
          forwardConfirmedHostnames: distinctConfirmed,
          unconfirmedHostnames: distinctHostnames.filter(h => !distinctConfirmed.includes(h)),
          diagnostics
        },
        verified: true,
        source: "System DNS resolver (PTR + forward A/AAAA)",
        strength: CONFIDENCE_FORWARD_CONFIRMED / 100
      });
    }

    // Reverse lookup coverage, including addresses that genuinely publish
    // nothing and any that could not be checked.
    if (noPtrCount > 0 || failedCount > 0) {
      evidences.push({
        id: "ev_rdns_coverage",
        connector: this.name,
        title: "Reverse Lookup Coverage",
        description:
          `${resolvedRecords.length} address${resolvedRecords.length === 1 ? "" : "es"} returned a PTR record` +
          `${noPtrCount > 0 ? `, ${noPtrCount} publish${noPtrCount === 1 ? "es" : ""} none` : ""}` +
          `${failedCount > 0 ? `, and ${failedCount} could not be checked` : ""}. ` +
          `An address with no PTR record is reported as having none; it is never given its forward hostname.`,
        confidence: CONFIDENCE_COVERAGE,
        timestamp,
        rawData: {
          withPtr: resolvedRecords.map(r => r.ip),
          withoutPtr: records.filter(r => r.status === "NO_PTR").map(r => r.ip),
          lookupFailed: records
            .filter(r => r.status === "LOOKUP_FAILED")
            .map(r => ({ ip: r.ip, error: r.error })),
          diagnostics
        },
        verified: true,
        source: "System DNS resolver (PTR)",
        strength: CONFIDENCE_COVERAGE / 100
      });
    }

    const evidenceIds = evidences.map(e => e.id);

    // ---- Step 4: entities & relationships ------------------------------
    // A domain target gets its own node, using the same `type` + `name`
    // canonical key the forward DNS connector uses so the two merge into
    // one graph node. An IP target is already one of the address nodes
    // below, so no separate entity is emitted for it.
    const targetEntityId = isIpTarget
      ? `ent_rdns_ip_${host.replace(/[^a-zA-Z0-9]/g, "_")}`
      : `ent_rdns_target_${host.replace(/[^a-zA-Z0-9]/g, "_")}`;

    if (!isIpTarget) {
      entities.push({
        id: targetEntityId,
        name: host,
        type: "Domain",
        metadata: {
          resolver: this.name,
          addressesQueried: queriedIps.length,
          addressesWithPtr: resolvedRecords.length
        },
        evidenceIds
      });
    }

    for (const record of records) {
      const ipEntityId = `ent_rdns_ip_${record.ip.replace(/[^a-zA-Z0-9]/g, "_")}`;
      if (!entities.some(e => e.id === ipEntityId)) {
        entities.push({
          id: ipEntityId,
          name: record.ip,
          type: "IPAddress",
          metadata: {
            family: record.family,
            reverseLookupStatus: record.status,
            ptrRecords: record.hostnames,
            forwardConfirmed: record.forwardConfirmed,
            resolvedAt: record.resolvedAt
          },
          evidenceIds: ipEntityId === targetEntityId ? evidenceIds : ["ev_rdns_ptr_records"]
        });
      }

      if (!isIpTarget && !relationships.some(r => r.source === targetEntityId && r.target === ipEntityId)) {
        relationships.push({
          source: targetEntityId,
          target: ipEntityId,
          type: "RESOLVES_TO",
          metadata: { observedBy: this.name },
          evidenceIds: ["ev_rdns_ptr_records"]
        });
      }

      for (const hostname of record.hostnames) {
        const hostEntityId = `ent_rdns_ptr_${hostname.replace(/[^a-zA-Z0-9]/g, "_")}`;
        if (!entities.some(e => e.id === hostEntityId)) {
          entities.push({
            id: hostEntityId,
            name: hostname,
            type: "Domain",
            metadata: {
              role: "PTR hostname",
              discoveredVia: "Reverse DNS",
              forwardConfirmed: record.forwardConfirmed.includes(hostname)
            },
            evidenceIds: ["ev_rdns_hostnames"]
          });
        }

        if (!relationships.some(r => r.source === ipEntityId && r.target === hostEntityId)) {
          relationships.push({
            source: ipEntityId,
            target: hostEntityId,
            type: "HAS_PTR_RECORD",
            metadata: { forwardConfirmed: record.forwardConfirmed.includes(hostname) },
            evidenceIds: ["ev_rdns_ptr_records"]
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
      sources: [`dns:${host}?type=PTR`],
      rawData: {
        target: host,
        detectionTimeMs,
        records,
        hostnames: distinctHostnames,
        forwardConfirmedHostnames: distinctConfirmed,
        diagnostics
      }
    };

    ReverseDnsConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
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
        ptrRecordCount: 0,
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
        ptrRecordCount: 0
      }
    };
  }
}
