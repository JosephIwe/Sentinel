import { Connector, ConnectorResult, Entity, Evidence, InvestigationQuery, Relationship } from "../types";
import { safeFetch } from "../utils/ssrfGuard";

interface CacheEntry {
  result: ConnectorResult;
  timestamp: number;
}

/**
 * A single crt.sh JSON record. Only the fields crt.sh actually returns are
 * modelled here - notably crt.sh's JSON API does NOT expose SHA-1/SHA-256
 * certificate fingerprints, so none is read or reported. `serial_number`
 * and the crt.sh entry `id` are the certificate identifiers this source
 * genuinely provides.
 */
interface CrtShRecord {
  issuer_ca_id?: number;
  issuer_name?: string;
  common_name?: string;
  name_value?: string;
  id?: number;
  entry_timestamp?: string;
  not_before?: string;
  not_after?: string;
  serial_number?: string;
}

interface NormalizedCertificate {
  crtShId?: number;
  issuer?: string;
  commonName?: string;
  serialNumber?: string;
  notBefore?: string;
  notAfter?: string;
  entryTimestamp?: string;
  /** SANs retained from this cert that genuinely belong to the target. */
  matchedNames: string[];
  isExpired?: boolean;
}

const MAX_VALUE_LENGTH = 200;

// crt.sh can return many thousands of records for a large domain. These caps
// bound memory and graph size; the *true* totals are always reported in
// rawData so a capped view is never mistaken for the full picture.
const MAX_RECORDS_PROCESSED = 1000;
const MAX_SUBDOMAIN_ENTITIES = 50;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8MB

// Confidence tiers. CT log entries are cryptographically-anchored public
// records, so directly-transcribed facts rank high; anything requiring
// interpretation ranks lower.
const CONFIDENCE_CERT_PRESENCE = 95; // "these certs exist in CT logs"
const CONFIDENCE_ISSUER = 92;        // Issuer transcribed from the record
const CONFIDENCE_SUBDOMAIN = 88;     // SAN present on a real logged cert
const CONFIDENCE_VALIDITY = 90;      // Dates transcribed from the record

/**
 * Certificate Transparency Connector
 *
 * Queries the public crt.sh Certificate Transparency log search for the
 * target domain and reports only what the returned records literally
 * contain: issuers, common names, Subject Alternative Names, validity
 * windows, serial numbers, and crt.sh entry IDs.
 *
 * Nothing is inferred. Subject Alternative Names are filtered so that only
 * names that genuinely belong to the target domain are reported as
 * subdomains - a certificate covering several unrelated domains will not
 * cause those unrelated names to be attributed to the target. Certificate
 * fingerprints are not reported at all, because crt.sh's JSON API does not
 * expose them; fabricating one would be worse than omitting it.
 *
 * An empty result set is NO_DATA (the log genuinely holds no matching
 * entry). Any failure to reach or parse the source is ERROR - never a
 * false "no certificates found".
 */
export class CertificateTransparencyConnector implements Connector {
  public name = "Certificate Transparency Resolver";

  private static cache = new Map<string, CacheEntry>();

  /**
   * Configurable cache duration (TTL) in milliseconds.
   * Defaults to 3600000 (1 hour) - CT log contents change slowly.
   */
  private getCacheTtl(): number {
    const envTtl = process.env.CT_CACHE_TTL_MS;
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
   * surfaced as a generic outer TIMEOUT. crt.sh is frequently slow, so a
   * timeout here is an expected outcome, not an exceptional one.
   */
  private getRequestTimeoutMs(): number {
    const envTimeout = process.env.CT_TIMEOUT_MS;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 4000;
  }

  private isIpAddress(term: string): boolean {
    const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    const ipv6Regex = /^(?:[a-fA-F0-9]{1,4}:){2,7}[a-fA-F0-9]{0,4}$/;
    return ipv4Regex.test(term) || ipv6Regex.test(term);
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
    return cleaned.trim();
  }

  private truncate(value: string): string {
    const collapsed = value.replace(/\s+/g, " ").trim();
    return collapsed.length > MAX_VALUE_LENGTH
      ? `${collapsed.slice(0, MAX_VALUE_LENGTH)}…`
      : collapsed;
  }

  /**
   * Decides whether a name from a certificate genuinely belongs to the
   * target domain. This is the connector's primary false-positive defence:
   * a single certificate can cover many unrelated domains, and attributing
   * those to the target would be fabricated intelligence.
   *
   * Accepts the apex itself and any subdomain of it. Rejects unrelated
   * domains, email addresses, and lookalike suffixes such as
   * "notexample.com" for target "example.com".
   */
  private belongsToTarget(rawName: string, domain: string): boolean {
    const name = rawName.trim().toLowerCase().replace(/^\*\./, "");
    if (!name || name.includes(" ")) return false;
    // crt.sh occasionally includes rfc822Name (email) SAN entries.
    if (name.includes("@")) return false;
    if (name === domain) return true;
    return name.endsWith(`.${domain}`);
  }

  public async run(query: InvestigationQuery): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const domain = this.extractDomain(query.term.trim());

    const skipTarget =
      !domain ||
      this.isIpAddress(domain) ||
      query.type === "Organization" ||
      query.type === "Person" ||
      !this.looksLikeDomain(domain);

    if (skipTarget) {
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
          certificatesFound: 0,
          info: "Certificate Transparency lookup skipped: target is not a domain."
        }
      };
    }

    const ttl = this.getCacheTtl();
    const cached = CertificateTransparencyConnector.cache.get(domain);
    if (cached && Date.now() - cached.timestamp < ttl) {
      console.log(`[CertificateTransparency Cache] Serving cached result for ${domain}`);
      return { ...cached.result, timestamp };
    }

    const url = `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`;
    const timeoutMs = this.getRequestTimeoutMs();
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await safeFetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Sentinel-CertificateTransparency-Connector/1.0",
          "Accept": "application/json"
        }
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === "AbortError" || /abort/i.test(err.message || "");
      const message = isTimeout
        ? `Timed out after ${timeoutMs}ms querying Certificate Transparency logs at ${url}.`
        : `Could not reach Certificate Transparency log search at ${url}: ${err.message || "network error"}.`;
      console.warn(`[CertificateTransparency] ${message}`);
      return this.buildErrorResult(timestamp, url, undefined, Date.now() - startedAt, message);
    }

    clearTimeout(timeoutId);
    const httpStatus = res.status;

    if (!res.ok) {
      const message = `Certificate Transparency log search returned HTTP ${httpStatus} for ${domain}.`;
      console.warn(`[CertificateTransparency] ${message}`);
      return this.buildErrorResult(timestamp, url, httpStatus, Date.now() - startedAt, message);
    }

    let bodyText: string;
    try {
      bodyText = await res.text();
    } catch (err: any) {
      const message = `Could not read the Certificate Transparency response body: ${err.message || "unknown error"}.`;
      return this.buildErrorResult(timestamp, url, httpStatus, Date.now() - startedAt, message);
    }

    if (bodyText.length > MAX_RESPONSE_BYTES) {
      const message = `Certificate Transparency response exceeded the ${MAX_RESPONSE_BYTES}-byte limit for ${domain}.`;
      return this.buildErrorResult(timestamp, url, httpStatus, Date.now() - startedAt, message);
    }

    // An empty body is not valid JSON; treat it as an inconclusive source
    // failure rather than a confirmed absence of certificates.
    const trimmed = bodyText.trim();
    if (!trimmed) {
      return this.buildErrorResult(
        timestamp, url, httpStatus, Date.now() - startedAt,
        `Certificate Transparency log search returned an empty response for ${domain}.`
      );
    }

    let records: unknown;
    try {
      records = JSON.parse(trimmed);
    } catch {
      return this.buildErrorResult(
        timestamp, url, httpStatus, Date.now() - startedAt,
        `Certificate Transparency log search returned a malformed (non-JSON) response for ${domain}.`
      );
    }

    if (!Array.isArray(records)) {
      return this.buildErrorResult(
        timestamp, url, httpStatus, Date.now() - startedAt,
        `Certificate Transparency log search returned an unexpected payload shape for ${domain}.`
      );
    }

    // A genuinely empty array is a confirmed absence: crt.sh answered, and
    // it holds no matching entry.
    if (records.length === 0) {
      const noDataResult = this.buildNoDataResult(timestamp, url, httpStatus, Date.now() - startedAt);
      CertificateTransparencyConnector.cache.set(domain, { result: noDataResult, timestamp: Date.now() });
      return noDataResult;
    }

    const truncatedRecords = records.length > MAX_RECORDS_PROCESSED;
    const considered = (records as CrtShRecord[]).slice(0, MAX_RECORDS_PROCESSED);

    const certificates: NormalizedCertificate[] = [];
    const subdomains = new Set<string>();
    const issuers = new Map<string, number>();
    let wildcardCount = 0;
    let rejectedNameCount = 0;

    const now = Date.now();

    for (const record of considered) {
      if (!record || typeof record !== "object") continue;

      const rawNames = String(record.name_value || "")
        .split(/[\r\n]+/)
        .map(n => n.trim())
        .filter(Boolean);

      const matchedNames: string[] = [];
      for (const rawName of rawNames) {
        if (!this.belongsToTarget(rawName, domain)) {
          rejectedNameCount++;
          continue;
        }
        const normalized = rawName.trim().toLowerCase();
        if (normalized.startsWith("*.")) wildcardCount++;
        const bare = normalized.replace(/^\*\./, "");
        matchedNames.push(normalized);
        if (bare !== domain) subdomains.add(bare);
      }

      // A record whose every name was rejected contributes nothing about
      // this target and is dropped rather than counted.
      if (matchedNames.length === 0) continue;

      const issuer = record.issuer_name ? this.truncate(String(record.issuer_name)) : undefined;
      if (issuer) issuers.set(issuer, (issuers.get(issuer) || 0) + 1);

      const notAfter = record.not_after ? String(record.not_after) : undefined;
      const parsedNotAfter = notAfter ? Date.parse(notAfter) : NaN;

      certificates.push({
        crtShId: typeof record.id === "number" ? record.id : undefined,
        issuer,
        commonName: record.common_name ? this.truncate(String(record.common_name)) : undefined,
        serialNumber: record.serial_number ? this.truncate(String(record.serial_number)) : undefined,
        notBefore: record.not_before ? String(record.not_before) : undefined,
        notAfter,
        entryTimestamp: record.entry_timestamp ? String(record.entry_timestamp) : undefined,
        matchedNames,
        isExpired: isNaN(parsedNotAfter) ? undefined : parsedNotAfter < now
      });
    }

    const detectionTimeMs = Date.now() - startedAt;

    // Every returned record referred exclusively to other domains - crt.sh
    // answered, but holds nothing about this target.
    if (certificates.length === 0) {
      const noDataResult = this.buildNoDataResult(
        timestamp, url, httpStatus, detectionTimeMs,
        `Certificate Transparency returned ${records.length} record(s), but none contained a name belonging to ${domain}.`
      );
      CertificateTransparencyConnector.cache.set(domain, { result: noDataResult, timestamp: Date.now() });
      return noDataResult;
    }

    const result = this.buildSuccessResult(
      timestamp, domain, url, httpStatus, detectionTimeMs,
      certificates, subdomains, issuers,
      { totalRecordsReturned: records.length, truncatedRecords, wildcardCount, rejectedNameCount }
    );
    CertificateTransparencyConnector.cache.set(domain, { result, timestamp: Date.now() });
    return result;
  }

  private buildSuccessResult(
    timestamp: string,
    domain: string,
    url: string,
    httpStatus: number | undefined,
    detectionTimeMs: number,
    certificates: NormalizedCertificate[],
    subdomains: Set<string>,
    issuers: Map<string, number>,
    stats: { totalRecordsReturned: number; truncatedRecords: boolean; wildcardCount: number; rejectedNameCount: number }
  ): ConnectorResult {
    const evidences: Evidence[] = [];
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    const sortedSubdomains = Array.from(subdomains).sort();
    const issuerList = Array.from(issuers.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([issuer, count]) => ({ issuer, certificateCount: count }));

    const expiredCount = certificates.filter(c => c.isExpired === true).length;
    const activeCount = certificates.filter(c => c.isExpired === false).length;

    const validNotAfter = certificates
      .map(c => (c.notAfter ? Date.parse(c.notAfter) : NaN))
      .filter(t => !isNaN(t));
    const validNotBefore = certificates
      .map(c => (c.notBefore ? Date.parse(c.notBefore) : NaN))
      .filter(t => !isNaN(t));

    const earliestIssued = validNotBefore.length
      ? new Date(Math.min(...validNotBefore)).toISOString()
      : undefined;
    const latestExpiry = validNotAfter.length
      ? new Date(Math.max(...validNotAfter)).toISOString()
      : undefined;

    // Diagnostics ride on each finding's rawData: the pipeline aggregates
    // connector evidence into the final InvestigationResult but does not
    // carry connector-level rawData through, and changing that is out of
    // scope for a connector.
    const diagnostics = {
      detectionTimeMs,
      source: "crt.sh",
      totalRecordsReturned: stats.totalRecordsReturned,
      recordsAttributedToTarget: certificates.length,
      namesRejectedAsUnrelated: stats.rejectedNameCount,
      subdomainsDiscovered: sortedSubdomains.length,
      recordsTruncated: stats.truncatedRecords,
      fingerprintsAvailable: false
    };

    // 1. Certificates present in CT logs.
    const sampleCertificates = certificates.slice(0, 25).map(c => ({
      crtShId: c.crtShId,
      issuer: c.issuer,
      commonName: c.commonName,
      serialNumber: c.serialNumber,
      notBefore: c.notBefore,
      notAfter: c.notAfter,
      entryTimestamp: c.entryTimestamp,
      names: c.matchedNames,
      isExpired: c.isExpired
    }));

    evidences.push({
      id: "ev_ct_certificates",
      connector: this.name,
      title: "Certificates found in Certificate Transparency logs",
      description:
        `${certificates.length} certificate record(s) referencing ${domain} were found in public ` +
        `Certificate Transparency logs via crt.sh.` +
        (stats.truncatedRecords ? ` Results were capped at ${MAX_RECORDS_PROCESSED} records for processing.` : ""),
      confidence: CONFIDENCE_CERT_PRESENCE,
      timestamp,
      rawData: {
        certificateCount: certificates.length,
        certificates: sampleCertificates,
        certificatesSampled: sampleCertificates.length < certificates.length,
        // crt.sh's JSON API does not expose SHA-1/SHA-256 fingerprints, so
        // none is reported. Serial numbers and crt.sh entry IDs are the
        // certificate identifiers this source actually provides.
        fingerprintsAvailable: false,
        urlChecked: url,
        diagnostics
      },
      verified: true,
      source: url,
      strength: CONFIDENCE_CERT_PRESENCE / 100,
      url
    });

    // 2. Issuing certificate authorities.
    if (issuerList.length > 0) {
      evidences.push({
        id: "ev_ct_issuers",
        connector: this.name,
        title: "Certificate issuers",
        description:
          `Certificates for ${domain} were issued by ${issuerList.length} distinct ` +
          `certificate authorit${issuerList.length === 1 ? "y" : "ies"}: ` +
          issuerList.slice(0, 5).map(i => i.issuer).join("; ") +
          (issuerList.length > 5 ? "; …" : "") + ".",
        confidence: CONFIDENCE_ISSUER,
        timestamp,
        rawData: { issuers: issuerList, urlChecked: url, diagnostics },
        verified: true,
        source: url,
        strength: CONFIDENCE_ISSUER / 100,
        url
      });
    }

    // 3. Subdomains discovered via Subject Alternative Names.
    if (sortedSubdomains.length > 0) {
      evidences.push({
        id: "ev_ct_subdomains",
        connector: this.name,
        title: "Subdomains disclosed by certificate SANs",
        description:
          `${sortedSubdomains.length} subdomain(s) of ${domain} appear as Subject Alternative Names ` +
          `on certificates logged in Certificate Transparency: ` +
          sortedSubdomains.slice(0, 10).join(", ") +
          (sortedSubdomains.length > 10 ? `, … (+${sortedSubdomains.length - 10} more)` : "") + ".",
        confidence: CONFIDENCE_SUBDOMAIN,
        timestamp,
        rawData: {
          subdomains: sortedSubdomains,
          subdomainCount: sortedSubdomains.length,
          wildcardNamesObserved: stats.wildcardCount,
          namesRejectedAsUnrelated: stats.rejectedNameCount,
          urlChecked: url,
          diagnostics
        },
        verified: true,
        source: url,
        strength: CONFIDENCE_SUBDOMAIN / 100,
        url
      });
    }

    // 4. Validity window across the observed certificates.
    if (earliestIssued || latestExpiry) {
      evidences.push({
        id: "ev_ct_validity",
        connector: this.name,
        title: "Certificate validity window",
        description:
          `Observed certificates span ${earliestIssued || "an unknown start"} to ` +
          `${latestExpiry || "an unknown expiry"}. ${activeCount} currently valid, ${expiredCount} expired.`,
        confidence: CONFIDENCE_VALIDITY,
        timestamp,
        rawData: {
          earliestIssued,
          latestExpiry,
          activeCertificates: activeCount,
          expiredCertificates: expiredCount,
          urlChecked: url,
          diagnostics
        },
        verified: true,
        source: url,
        strength: CONFIDENCE_VALIDITY / 100,
        url
      });
    }

    const evidenceIds = evidences.map(e => e.id);

    // Target domain entity. Uses the same `type` + `name` canonical key the
    // DNS connector uses so the two merge into a single graph node.
    const domainEntityId = `ent_ct_domain_${domain.replace(/[^a-zA-Z0-9]/g, "_")}`;
    entities.push({
      id: domainEntityId,
      name: domain,
      type: "Domain",
      metadata: {
        resolver: this.name,
        certificatesObserved: certificates.length,
        subdomainsDiscovered: sortedSubdomains.length,
        issuers: issuerList.map(i => i.issuer)
      },
      evidenceIds
    });

    // Subdomain entities, capped to keep the graph readable. The true count
    // is always available in the evidence rawData above.
    for (const subdomain of sortedSubdomains.slice(0, MAX_SUBDOMAIN_ENTITIES)) {
      const subdomainEntityId = `ent_ct_subdomain_${subdomain.replace(/[^a-zA-Z0-9]/g, "_")}`;
      entities.push({
        id: subdomainEntityId,
        name: subdomain,
        type: "Domain",
        metadata: { discoveredVia: "Certificate Transparency SAN", parentDomain: domain },
        evidenceIds: ["ev_ct_subdomains"]
      });
      relationships.push({
        source: domainEntityId,
        target: subdomainEntityId,
        type: "HAS_SUBDOMAIN",
        metadata: { discoveredVia: "Certificate Transparency" },
        evidenceIds: ["ev_ct_subdomains"]
      });
    }

    return {
      connectorName: this.name,
      success: true,
      status: "SUCCESS",
      verified: true,
      timestamp,
      entities,
      relationships,
      timeline: [],
      evidences,
      sources: [url],
      rawData: {
        urlChecked: url,
        httpStatus,
        detectionTimeMs,
        certificatesFound: certificates.length,
        subdomainsDiscovered: sortedSubdomains.length,
        issuerCount: issuerList.length,
        diagnostics
      }
    };
  }

  private buildNoDataResult(
    timestamp: string,
    urlChecked: string,
    httpStatus: number | undefined,
    detectionTimeMs: number,
    info?: string
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
      rawData: {
        urlChecked,
        httpStatus,
        detectionTimeMs,
        certificatesFound: 0,
        info: info || "Certificate Transparency logs hold no certificate records for this target."
      }
    };
  }

  private buildErrorResult(
    timestamp: string,
    urlChecked: string,
    httpStatus: number | undefined,
    detectionTimeMs: number,
    message: string
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
        urlChecked,
        httpStatus,
        detectionTimeMs,
        certificatesFound: 0
      }
    };
  }
}
