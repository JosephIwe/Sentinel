import dns from "dns/promises";
import net from "net";
import { Connector, ConnectorResult, Entity, Evidence, InvestigationQuery, Relationship } from "../types";
import { safeFetch, isBlockedAddress } from "../utils/ssrfGuard";

interface CacheEntry {
  result: ConnectorResult;
  timestamp: number;
}

/**
 * One service banner from a Shodan host record's `data[]` array. Only the
 * fields this connector reports are modelled; anything Shodan does not send
 * is simply absent, never defaulted.
 */
interface ShodanServiceRecord {
  port?: number;
  transport?: string;
  product?: string;
  version?: string;
  data?: string;
  os?: string;
  hostnames?: string[];
  timestamp?: string;
  _shodan?: { module?: string };
}

/** A Shodan `/shodan/host/{ip}` response. */
interface ShodanHostResponse {
  ip_str?: string;
  org?: string;
  asn?: string;
  isp?: string;
  hostnames?: string[];
  domains?: string[];
  ports?: number[];
  os?: string;
  country_name?: string;
  country_code?: string;
  city?: string;
  last_update?: string;
  data?: ShodanServiceRecord[];
  error?: string;
}

/** A service normalized for reporting. */
interface NormalizedService {
  port?: number;
  transport?: string;
  module?: string;
  product?: string;
  version?: string;
  os?: string;
  bannerExcerpt?: string;
  observedAt?: string;
}

/** Everything reported for a single queried address. */
interface HostIntelligence {
  ip: string;
  family: "IPv4" | "IPv6";
  organization?: string;
  asn?: string;
  isp?: string;
  hostnames: string[];
  domains: string[];
  ports: number[];
  operatingSystem?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  lastUpdate?: string;
  services: NormalizedService[];
}

const MAX_VALUE_LENGTH = 200;
const MAX_BANNER_LENGTH = 400;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

// A domain can resolve to many addresses, and each address costs one Shodan
// API credit. These caps bound both spend and graph size; true totals always
// appear in the diagnostics so a capped view is never mistaken for the whole.
const MAX_IPS_QUERIED = 5;
const MAX_SERVICES_REPORTED = 25;

// Confidence tiers. Shodan reports what its scanners actually observed, but
// it is a third-party snapshot rather than a live reading taken by us, so
// even its most direct facts rank a little below first-hand observations.
const CONFIDENCE_HOST = 90;
const CONFIDENCE_PORTS = 90;
const CONFIDENCE_SERVICES = 86;
const CONFIDENCE_OS = 82;

/**
 * Shodan Intelligence Connector
 *
 * Enriches a target with internet-exposure data from Shodan's host API:
 * the addresses it has scanned, the ports it found open, the services it
 * fingerprinted, and the network ownership it records.
 *
 * Everything reported is a field Shodan actually returned. Products and
 * versions appear only where Shodan states them explicitly - a service with
 * no `product` is reported as an open port with a banner, never guessed at
 * from the banner text. Organization, ISP and ASN are transcribed from
 * Shodan's own fields rather than derived, and the country is reported as
 * the location Shodan records for the address.
 *
 * Vulnerabilities are deliberately not reported. Shodan's `vulns` field is
 * largely derived by matching detected versions against CVE lists, which is
 * exactly the kind of inference this project treats as fabricated evidence;
 * surfacing it as a verified finding would misrepresent its strength.
 *
 * Configuration: `SHODAN_API_KEY` is required. Without it the connector
 * returns NO_DATA with a diagnostic saying so and makes no API request -
 * an unconfigured connector must never look like a target with nothing to
 * find.
 *
 * Only public addresses are ever queried. Private, loopback, link-local,
 * multicast and reserved space is filtered out through the shared SSRF
 * guard's block list before any request is made.
 *
 * Status semantics: a Shodan 404 ("no information available") is the
 * authoritative absence and yields NO_DATA. Authentication failures (401,
 * 403), rate limiting (429), server errors and transport failures are all
 * ERROR - never a false "this host is not exposed".
 */
export class ShodanConnector implements Connector {
  public name = "Shodan Intelligence";

  private static cache = new Map<string, CacheEntry>();

  /** The API key, or null when the connector is not configured. */
  private getApiKey(): string | null {
    const key = process.env.SHODAN_API_KEY;
    if (!key || !key.trim()) return null;
    return key.trim();
  }

  /**
   * Configurable cache duration (TTL) in milliseconds. Defaults to 3600000
   * (1 hour) - Shodan's own scan data updates on a far slower cadence, and
   * each lookup costs an API credit.
   */
  private getCacheTtl(): number {
    const envTtl = process.env.SHODAN_CACHE_TTL_MS;
    if (envTtl) {
      const parsed = parseInt(envTtl, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 60 * 60 * 1000;
  }

  /**
   * Configurable request timeout in milliseconds. Defaults to 4000 -
   * deliberately below the orchestrator's 5000ms per-connector default so
   * this connector's own descriptive ERROR wins the race rather than being
   * surfaced as a generic outer TIMEOUT.
   */
  private getRequestTimeoutMs(): number {
    const envTimeout = process.env.SHODAN_TIMEOUT_MS;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 4000;
  }

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
    if (!net.isIP(cleaned) && cleaned.split(":").length === 2) {
      cleaned = cleaned.split(":")[0];
    }
    cleaned = cleaned.replace(/^www\./, "");
    return cleaned.replace(/\.$/, "").trim();
  }

  private looksLikeDomain(term: string): boolean {
    return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(term);
  }

  private looksLikeMalformedIp(term: string): boolean {
    return /^\d+(\.\d+)+$/.test(term) && !net.isIP(term);
  }

  private truncate(value: unknown, limit = MAX_VALUE_LENGTH): string {
    const collapsed = String(value).replace(/\s+/g, " ").trim();
    return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
  }

  /**
   * Normalizes one Shodan service record. A field Shodan did not send stays
   * undefined; nothing is derived from the banner text.
   */
  private normalizeService(record: ShodanServiceRecord): NormalizedService | null {
    if (!record || typeof record !== "object") return null;

    const port = typeof record.port === "number" ? record.port : undefined;
    const banner = typeof record.data === "string" && record.data.trim()
      ? this.truncate(record.data, MAX_BANNER_LENGTH)
      : undefined;

    // A record with neither a port nor any content says nothing about the host.
    if (port === undefined && !banner && !record.product) return null;

    return {
      port,
      transport: record.transport ? this.truncate(record.transport) : undefined,
      module: record._shodan?.module ? this.truncate(record._shodan.module) : undefined,
      product: record.product ? this.truncate(record.product) : undefined,
      // Versions are reported only where Shodan states them explicitly.
      version: record.version ? this.truncate(record.version) : undefined,
      os: record.os ? this.truncate(record.os) : undefined,
      bannerExcerpt: banner,
      observedAt: record.timestamp ? this.truncate(record.timestamp) : undefined
    };
  }

  /**
   * Queries Shodan for a single address, returning a discriminated outcome
   * so an authoritative 404 is never confused with a transport failure.
   */
  private async queryHost(
    ip: string,
    apiKey: string,
    timeoutMs: number
  ): Promise<
    | { outcome: "ok"; body: ShodanHostResponse }
    | { outcome: "noData"; httpStatus: number }
    | { outcome: "failed"; message: string; httpStatus?: number }
  > {
    const url = `https://api.shodan.io/shodan/host/${encodeURIComponent(ip)}?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await safeFetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Sentinel-Shodan-Connector/1.0", Accept: "application/json" }
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isTimeout = err?.name === "AbortError" || /abort/i.test(err?.message || "");
      return {
        outcome: "failed",
        message: isTimeout
          ? `Timed out after ${timeoutMs}ms querying Shodan for ${ip}.`
          : `Could not reach the Shodan API for ${ip}: ${err?.message || "network error"}.`
      };
    }
    clearTimeout(timeoutId);

    const status = response.status;

    // Shodan answers 404 when it holds no record for an address. That is an
    // authoritative absence, not a failure.
    if (status === 404) return { outcome: "noData", httpStatus: 404 };

    if (status === 401 || status === 403) {
      return {
        outcome: "failed",
        message: `Shodan rejected the API key (HTTP ${status}). Check SHODAN_API_KEY.`,
        httpStatus: status
      };
    }

    if (status === 429) {
      return {
        outcome: "failed",
        message: "Shodan rate limit exceeded (HTTP 429). No exposure data was retrieved for this target.",
        httpStatus: status
      };
    }

    if (!response.ok) {
      return {
        outcome: "failed",
        message: `The Shodan API returned HTTP ${status} for ${ip}.`,
        httpStatus: status
      };
    }

    let text: string;
    try {
      text = await response.text();
    } catch (err: any) {
      return {
        outcome: "failed",
        message: `Could not read the Shodan response for ${ip}: ${err?.message || "unknown error"}.`,
        httpStatus: status
      };
    }

    if (text.length > MAX_RESPONSE_BYTES) {
      return {
        outcome: "failed",
        message: `The Shodan response for ${ip} exceeded the ${MAX_RESPONSE_BYTES}-byte limit.`,
        httpStatus: status
      };
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return { outcome: "failed", message: `The Shodan API returned an empty response for ${ip}.`, httpStatus: status };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        outcome: "failed",
        message: `The Shodan API returned a malformed (non-JSON) response for ${ip}.`,
        httpStatus: status
      };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        outcome: "failed",
        message: `The Shodan API returned an unexpected payload shape for ${ip}.`,
        httpStatus: status
      };
    }

    const body = parsed as ShodanHostResponse;

    // Shodan can answer 200 with an error envelope.
    if (body.error) {
      return /no information/i.test(body.error)
        ? { outcome: "noData", httpStatus: status }
        : { outcome: "failed", message: `The Shodan API reported: ${this.truncate(body.error)}`, httpStatus: status };
    }

    return { outcome: "ok", body };
  }

  public async run(query: InvestigationQuery): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const host = this.extractHost(query.term || "");
    const startedAt = Date.now();

    if (
      !host ||
      query.type === "Organization" ||
      query.type === "Person" ||
      this.looksLikeMalformedIp(host) ||
      (!net.isIP(host) && !this.looksLikeDomain(host))
    ) {
      return this.buildNoDataResult(timestamp, 0, "Shodan lookup skipped: target is not a domain or IP address.", {
        configured: !!this.getApiKey()
      });
    }

    // Not configured: report that plainly and make no request. An
    // unconfigured connector must never resemble a clean target.
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return this.buildNoDataResult(
        timestamp,
        Date.now() - startedAt,
        "Shodan is not configured: SHODAN_API_KEY is not set, so no exposure data was requested. " +
          "This says nothing about the target's actual internet exposure.",
        { configured: false }
      );
    }

    const cacheKey = `${query.type || "Generic"}:${host}`;
    const cached = ShodanConnector.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.getCacheTtl()) {
      console.log(`[Shodan Cache] Serving cached result for ${cacheKey}`);
      return { ...cached.result, timestamp };
    }

    const timeoutMs = this.getRequestTimeoutMs();
    const isIpTarget = !!net.isIP(host);

    // ---- Step 1: establish the addresses to query ----------------------
    let resolvedIps: string[] = [];
    if (isIpTarget) {
      resolvedIps = [host];
    } else {
      const outcomes = await Promise.allSettled([
        this.withTimeout(dns.resolve4(host), timeoutMs),
        this.withTimeout(dns.resolve6(host), timeoutMs)
      ]);

      let hardFailures = 0;
      for (const outcome of outcomes) {
        if (outcome.status === "fulfilled") {
          resolvedIps.push(...outcome.value);
        } else {
          const code = (outcome.reason as any)?.code;
          if (code !== "ENODATA" && code !== "ENOTFOUND") hardFailures++;
        }
      }

      if (resolvedIps.length === 0 && hardFailures > 0) {
        return this.buildErrorResult(
          timestamp,
          Date.now() - startedAt,
          `Could not resolve "${host}" to any IP address: the DNS resolver failed.`,
          { configured: true }
        );
      }
    }

    // Private, loopback, link-local, multicast and reserved space is never
    // sent to Shodan. Reuses the shared SSRF guard's block list.
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
          ? `"${host}" resolves only to non-public addresses, which are never submitted to Shodan.`
          : `No public IP address could be derived from "${host}".`,
        { configured: true, ipsSkippedNonPublic: skippedNonPublic }
      );
    }

    const truncatedIps = publicIps.length > MAX_IPS_QUERIED;
    const queriedIps = publicIps.slice(0, MAX_IPS_QUERIED);

    // ---- Step 2: query Shodan per address ------------------------------
    const hosts: HostIntelligence[] = [];
    let noDataCount = 0;
    const failures: { ip: string; message: string; httpStatus?: number }[] = [];

    await Promise.all(
      queriedIps.map(async ip => {
        const outcome = await this.queryHost(ip, apiKey, timeoutMs);

        if (outcome.outcome === "failed") {
          console.warn(`[Shodan] ${outcome.message}`);
          failures.push({ ip, message: outcome.message, httpStatus: outcome.httpStatus });
          return;
        }
        if (outcome.outcome === "noData") {
          noDataCount++;
          return;
        }

        const body = outcome.body;
        const services = (Array.isArray(body.data) ? body.data : [])
          .map(record => this.normalizeService(record))
          .filter((s): s is NormalizedService => s !== null)
          .slice(0, MAX_SERVICES_REPORTED);

        const ports = Array.isArray(body.ports)
          ? body.ports.filter(p => typeof p === "number").sort((a, b) => a - b)
          : [];

        hosts.push({
          ip: body.ip_str ? this.truncate(body.ip_str) : ip,
          family: net.isIPv6(ip) ? "IPv6" : "IPv4",
          organization: body.org ? this.truncate(body.org) : undefined,
          asn: body.asn ? this.truncate(body.asn) : undefined,
          isp: body.isp ? this.truncate(body.isp) : undefined,
          hostnames: Array.isArray(body.hostnames) ? body.hostnames.map(h => this.truncate(h)) : [],
          domains: Array.isArray(body.domains) ? body.domains.map(d => this.truncate(d)) : [],
          ports,
          operatingSystem: body.os ? this.truncate(body.os) : undefined,
          country: body.country_name ? this.truncate(body.country_name) : undefined,
          countryCode: body.country_code ? this.truncate(body.country_code) : undefined,
          city: body.city ? this.truncate(body.city) : undefined,
          lastUpdate: body.last_update ? this.truncate(body.last_update) : undefined,
          services
        });
      })
    );

    // Every query failed for a reason that is not an absence - we cannot
    // claim the target is unexposed, so this is an error.
    if (hosts.length === 0 && failures.length > 0 && noDataCount === 0) {
      const first = failures[0];
      return this.buildErrorResult(timestamp, Date.now() - startedAt, first.message, {
        configured: true,
        httpStatus: first.httpStatus,
        failures
      });
    }

    if (hosts.length === 0) {
      const result = this.buildNoDataResult(
        timestamp,
        Date.now() - startedAt,
        isIpTarget
          ? `Shodan holds no record for "${host}".`
          : `Shodan holds no record for the ${queriedIps.length === 1 ? "address" : "addresses"} "${host}" resolves to.`,
        { configured: true, ipsQueried: queriedIps.length }
      );
      ShodanConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    const detectionTimeMs = Date.now() - startedAt;
    const allPorts = Array.from(new Set(hosts.flatMap(h => h.ports))).sort((a, b) => a - b);
    const allServices = hosts.flatMap(h => h.services);
    const identifiedProducts = allServices.filter(s => !!s.product);

    const diagnostics = {
      detectionTimeMs,
      source: "Shodan host API",
      target: host,
      configured: true,
      ipsResolved: resolvedIps.length,
      ipsQueried: queriedIps.length,
      ipsSkippedNonPublic: skippedNonPublic,
      ipsWithData: hosts.length,
      ipsWithoutData: noDataCount,
      lookupFailures: failures.length,
      truncatedIps,
      openPortCount: allPorts.length,
      serviceCount: allServices.length,
      productsIdentified: identifiedProducts.length,
      // Shodan's `vulns` field is largely version-matched CVE inference, so
      // it is deliberately not read or reported.
      vulnerabilitiesReported: false
    };

    // ---- Step 3: evidence ----------------------------------------------
    const evidences: Evidence[] = [];
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    evidences.push({
      id: "ev_shodan_host",
      connector: this.name,
      title: "Shodan Host Record",
      description:
        `Shodan holds scan data for ${hosts.length} of the ${queriedIps.length} queried address` +
        `${queriedIps.length === 1 ? "" : "es"}. ` +
        hosts
          .map(h => {
            const parts = [`${h.ip}`];
            if (h.organization) parts.push(`organization ${h.organization}`);
            if (h.isp) parts.push(`ISP ${h.isp}`);
            if (h.asn) parts.push(h.asn);
            if (h.country) parts.push(h.country);
            return parts.join(", ");
          })
          .join("; ") + ".",
      confidence: CONFIDENCE_HOST,
      timestamp,
      rawData: { hosts, diagnostics },
      verified: true,
      source: "Shodan host API",
      strength: CONFIDENCE_HOST / 100,
      url: `https://www.shodan.io/host/${encodeURIComponent(hosts[0].ip)}`
    });

    if (allPorts.length > 0) {
      evidences.push({
        id: "ev_shodan_ports",
        connector: this.name,
        title: "Open Ports Observed by Shodan",
        description:
          `Shodan observed ${allPorts.length} distinct open port${allPorts.length === 1 ? "" : "s"} across the ` +
          `scanned address${hosts.length === 1 ? "" : "es"}: ${allPorts.join(", ")}. ` +
          hosts
            .filter(h => h.ports.length > 0)
            .map(h => `${h.ip} exposes ${h.ports.join(", ")}`)
            .join("; ") +
          `. These reflect Shodan's last scan, not a live check performed now.`,
        confidence: CONFIDENCE_PORTS,
        timestamp,
        rawData: {
          openPorts: allPorts,
          perHost: hosts.map(h => ({ ip: h.ip, ports: h.ports, lastUpdate: h.lastUpdate })),
          diagnostics
        },
        verified: true,
        source: "Shodan host API",
        strength: CONFIDENCE_PORTS / 100
      });
    }

    if (allServices.length > 0) {
      evidences.push({
        id: "ev_shodan_services",
        connector: this.name,
        title: "Services Detected by Shodan",
        description:
          `Shodan fingerprinted ${allServices.length} service${allServices.length === 1 ? "" : "s"}, ` +
          `${identifiedProducts.length} of which it names a product for: ` +
          allServices
            .map(s => {
              const label = s.product
                ? `${s.product}${s.version ? ` ${s.version}` : ""}`
                : s.module || "unidentified service";
              return `${s.port ?? "?"}/${s.transport || "tcp"} ${label}`;
            })
            .join("; ") +
          `. Products and versions are reported only where Shodan states them explicitly; a service with no ` +
          `product is reported as an open port with its banner, never guessed at from the banner text.`,
        confidence: CONFIDENCE_SERVICES,
        timestamp,
        rawData: {
          services: hosts.map(h => ({ ip: h.ip, services: h.services })),
          productsIdentified: identifiedProducts.length,
          diagnostics
        },
        verified: true,
        source: "Shodan host API",
        strength: CONFIDENCE_SERVICES / 100
      });
    }

    const hostsWithOs = hosts.filter(h => !!h.operatingSystem);
    if (hostsWithOs.length > 0) {
      evidences.push({
        id: "ev_shodan_os",
        connector: this.name,
        title: "Operating System Reported by Shodan",
        description:
          hostsWithOs.map(h => `${h.ip} is reported as ${h.operatingSystem}`).join("; ") +
          `. Reported only where Shodan states an operating system explicitly.`,
        confidence: CONFIDENCE_OS,
        timestamp,
        rawData: {
          operatingSystems: hostsWithOs.map(h => ({ ip: h.ip, os: h.operatingSystem })),
          diagnostics
        },
        verified: true,
        source: "Shodan host API",
        strength: CONFIDENCE_OS / 100
      });
    }

    const evidenceIds = evidences.map(e => e.id);

    // ---- Step 4: entities & relationships ------------------------------
    // A domain target gets its own node, using the same `type` + `name`
    // canonical key the DNS connector uses so they merge into one node.
    const targetEntityId = isIpTarget
      ? `ent_shodan_ip_${host.replace(/[^a-zA-Z0-9]/g, "_")}`
      : `ent_shodan_target_${host.replace(/[^a-zA-Z0-9]/g, "_")}`;

    if (!isIpTarget) {
      entities.push({
        id: targetEntityId,
        name: host,
        type: "Domain",
        metadata: {
          resolver: this.name,
          addressesScanned: hosts.length,
          openPorts: allPorts
        },
        evidenceIds
      });
    }

    for (const hostRecord of hosts) {
      const ipEntityId = `ent_shodan_ip_${hostRecord.ip.replace(/[^a-zA-Z0-9]/g, "_")}`;
      if (!entities.some(e => e.id === ipEntityId)) {
        entities.push({
          id: ipEntityId,
          name: hostRecord.ip,
          type: "IPAddress",
          metadata: {
            family: hostRecord.family,
            organization: hostRecord.organization,
            isp: hostRecord.isp,
            asn: hostRecord.asn,
            openPorts: hostRecord.ports,
            operatingSystem: hostRecord.operatingSystem,
            country: hostRecord.country,
            lastScanned: hostRecord.lastUpdate
          },
          evidenceIds: ipEntityId === targetEntityId ? evidenceIds : ["ev_shodan_host"]
        });
      }

      if (!isIpTarget && !relationships.some(r => r.source === targetEntityId && r.target === ipEntityId)) {
        relationships.push({
          source: targetEntityId,
          target: ipEntityId,
          type: "RESOLVES_TO",
          metadata: { observedBy: this.name },
          evidenceIds: ["ev_shodan_host"]
        });
      }

      if (hostRecord.organization) {
        const orgEntityId = `ent_shodan_org_${hostRecord.organization.replace(/[^a-zA-Z0-9]/g, "_")}`;
        if (!entities.some(e => e.id === orgEntityId)) {
          entities.push({
            id: orgEntityId,
            name: hostRecord.organization,
            type: "Organization",
            metadata: { role: "Address-space organization (Shodan)", isp: hostRecord.isp },
            evidenceIds: ["ev_shodan_host"]
          });
        }
        if (!relationships.some(r => r.source === ipEntityId && r.target === orgEntityId)) {
          relationships.push({
            source: ipEntityId,
            target: orgEntityId,
            type: "HOSTED_BY",
            metadata: { source: "Shodan host record" },
            evidenceIds: ["ev_shodan_host"]
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
      sources: hosts.map(h => `https://www.shodan.io/host/${h.ip}`),
      rawData: {
        target: host,
        detectionTimeMs,
        hosts,
        openPorts: allPorts,
        diagnostics
      }
    };

    ShodanConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }

  private buildNoDataResult(
    timestamp: string,
    detectionTimeMs: number,
    info: string,
    extra: Record<string, unknown> = {}
  ): ConnectorResult {
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
      // The pipeline carries `error` into connectorStatuses, and NO_DATA here
      // has a reason worth surfacing - "not configured" in particular must
      // never be mistaken for "nothing found". The DnsConnector sets `error`
      // on its own NO_DATA skip for the same reason.
      error: info,
      rawData: {
        detectionTimeMs,
        hostsFound: 0,
        info,
        diagnostics: { detectionTimeMs, source: "Shodan host API", info, ...extra }
      }
    };
  }

  private buildErrorResult(
    timestamp: string,
    detectionTimeMs: number,
    message: string,
    extra: Record<string, unknown> = {}
  ): ConnectorResult {
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
        hostsFound: 0,
        diagnostics: { detectionTimeMs, source: "Shodan host API", error: message, ...extra }
      }
    };
  }
}
