import { Connector, ConnectorResult, Evidence, InvestigationQuery } from "../types";
import { safeFetch } from "../utils/ssrfGuard";

interface CacheEntry {
  result: ConnectorResult;
  timestamp: number;
}

interface ParsedSecurityTxt {
  contact: string[];
  expires?: string;
  encryption: string[];
  preferredLanguages?: string;
  canonical: string[];
  policy: string[];
  hiring: string[];
}

// RFC 9116 recommends checking /.well-known/security.txt first, falling
// back to the legacy /security.txt location.
const CANDIDATE_PATHS = ["/.well-known/security.txt", "/security.txt"];

/**
 * security.txt Compliance Connector (RFC 9116)
 *
 * Checks a target's well-known and legacy security.txt locations, parses
 * the standard RFC 9116 fields when present, and surfaces the published
 * security contact/disclosure policy as evidence. Never fabricates data:
 * a clean 404 on both candidate paths is reported as NO_DATA, and any
 * failure to reach the host (DNS, network, SSRF block, timeout) is
 * reported as ERROR rather than a false "confirmed absent".
 */
export class SecurityTxtConnector implements Connector {
  public name = "SecurityTxt Compliance Resolver";

  private static cache = new Map<string, CacheEntry>();

  /**
   * Retrieves the configurable cache duration (TTL) in milliseconds.
   * Defaults to 1800000 (30 minutes).
   */
  private getCacheTtl(): number {
    const envTtl = process.env.SECURITYTXT_CACHE_TTL_MS;
    if (envTtl) {
      const parsed = parseInt(envTtl, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 30 * 60 * 1000; // Default: 30 minutes
  }

  /**
   * Retrieves the configurable per-request timeout in milliseconds.
   * Defaults to 5000 (5 seconds), matching the RFC 9116 connector spec.
   */
  private getRequestTimeoutMs(): number {
    const envTimeout = process.env.SECURITYTXT_TIMEOUT_MS;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 5000; // Default: 5 seconds per request
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

  public async run(query: InvestigationQuery): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const searchTerm = query.term.trim();
    const domain = this.extractDomain(searchTerm);

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
        rawData: { info: "security.txt lookup skipped for non-domain target." }
      };
    }

    const ttl = this.getCacheTtl();
    const cached = SecurityTxtConnector.cache.get(domain);
    if (cached && Date.now() - cached.timestamp < ttl) {
      console.log(`[SecurityTxt Cache] Serving cached result for ${domain}`);
      return { ...cached.result, timestamp };
    }

    const timeoutMs = this.getRequestTimeoutMs();
    let lastUrlChecked: string | undefined;
    let lastHttpStatus: number | undefined;
    let lastContentType: string | undefined;
    let lastResponseTimeMs: number | undefined;

    for (const path of CANDIDATE_PATHS) {
      const url = `https://${domain}${path}`;
      lastUrlChecked = url;
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await safeFetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Sentinel-SecurityTxt-Connector/1.0",
            "Accept": "text/plain, */*;q=0.8"
          }
        });
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastResponseTimeMs = Date.now() - startedAt;
        const isTimeout = err.name === "AbortError" || /abort/i.test(err.message || "");
        const message = isTimeout
          ? `Timed out after ${timeoutMs}ms fetching ${url}.`
          : `Could not reach ${url}: ${err.message || "network error"}.`;
        console.warn(`[SecurityTxt] ${message}`);
        // A DNS/network/SSRF/timeout failure applies identically to both
        // candidate paths (same host) - stop instead of retrying the
        // fallback path, which would fail the same way.
        return this.buildErrorResult(timestamp, lastUrlChecked, lastHttpStatus, lastContentType, lastResponseTimeMs, message);
      }

      clearTimeout(timeoutId);
      lastResponseTimeMs = Date.now() - startedAt;
      lastHttpStatus = res.status;
      lastContentType = res.headers.get("content-type") || undefined;

      if (res.status === 404) {
        continue; // Try the next candidate path.
      }

      if (!res.ok) {
        const message = `Unexpected HTTP status ${res.status} at ${url}.`;
        console.warn(`[SecurityTxt] ${message}`);
        return this.buildErrorResult(timestamp, lastUrlChecked, lastHttpStatus, lastContentType, lastResponseTimeMs, message);
      }

      const body = await res.text();
      if (!body || !body.trim()) {
        continue; // Empty file behaves like absence; try the next candidate.
      }

      const { parsed, warnings, sawAnyField } = this.parseSecurityTxt(body);

      if (!sawAnyField) {
        const message = `Retrieved content at ${url} but it contained no recognizable RFC 9116 fields.`;
        console.warn(`[SecurityTxt] ${message}`);
        return this.buildErrorResult(timestamp, lastUrlChecked, lastHttpStatus, lastContentType, lastResponseTimeMs, message);
      }

      const result = this.buildSuccessResult(
        timestamp, domain, url, lastHttpStatus, lastContentType, lastResponseTimeMs, parsed, warnings
      );
      SecurityTxtConnector.cache.set(domain, { result, timestamp: Date.now() });
      return result;
    }

    // Both candidate paths were reached and genuinely have no file (404s or
    // empty bodies) - this is a confirmed absence, not an inconclusive check.
    const noDataResult = this.buildNoDataResult(timestamp, lastUrlChecked, lastHttpStatus, lastContentType, lastResponseTimeMs);
    SecurityTxtConnector.cache.set(domain, { result: noDataResult, timestamp: Date.now() });
    return noDataResult;
  }

  /**
   * Parses RFC 9116 fields from a security.txt body. Unrecognized lines and
   * validation problems are recorded as parseWarnings rather than rejecting
   * the file outright, per the "malformed but usable" handling rule.
   */
  private parseSecurityTxt(body: string): { parsed: ParsedSecurityTxt; warnings: string[]; sawAnyField: boolean } {
    const warnings: string[] = [];
    const parsed: ParsedSecurityTxt = {
      contact: [],
      encryption: [],
      canonical: [],
      policy: [],
      hiring: []
    };
    let sawAnyField = false;

    const lines = body.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) {
        warnings.push(`Ignored unparseable line: "${line.substring(0, 80)}"`);
        continue;
      }

      const field = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      if (!value) {
        warnings.push(`Field "${field}" has no value.`);
        continue;
      }

      switch (field.toLowerCase()) {
        case "contact":
          parsed.contact.push(value);
          sawAnyField = true;
          break;
        case "expires":
          if (parsed.expires) {
            warnings.push(`Duplicate "Expires" field; keeping the first value.`);
          } else if (isNaN(new Date(value).getTime())) {
            warnings.push(`"Expires" value "${value}" is not a valid date.`);
          } else {
            parsed.expires = value;
          }
          sawAnyField = true;
          break;
        case "encryption":
          parsed.encryption.push(value);
          sawAnyField = true;
          break;
        case "preferred-languages":
          if (parsed.preferredLanguages) {
            warnings.push(`Duplicate "Preferred-Languages" field; keeping the first value.`);
          } else {
            parsed.preferredLanguages = value;
          }
          sawAnyField = true;
          break;
        case "canonical":
          parsed.canonical.push(value);
          sawAnyField = true;
          break;
        case "policy":
          parsed.policy.push(value);
          sawAnyField = true;
          break;
        case "hiring":
          parsed.hiring.push(value);
          sawAnyField = true;
          break;
        default:
          warnings.push(`Unrecognized field "${field}" was ignored.`);
      }
    }

    if (!parsed.expires) {
      warnings.push(`RFC 9116 requires an "Expires" field, which was not found or was invalid.`);
    }

    return { parsed, warnings, sawAnyField };
  }

  /**
   * Builds evidence items per the connector spec's confidence guidance.
   * Only publishable facts become evidence - no entities are created from
   * security.txt text, and contact addresses are surfaced as evidence data
   * only, never as standalone entities.
   */
  private buildEvidences(domain: string, url: string, parsed: ParsedSecurityTxt, warnings: string[], timestamp: string): Evidence[] {
    const evidences: Evidence[] = [];

    evidences.push({
      id: "ev_securitytxt_detected",
      connector: this.name,
      title: "security.txt detected",
      description: `A security.txt file was found for ${domain} at ${url}.`,
      confidence: 85,
      timestamp,
      rawData: {
        urlChecked: url,
        contact: parsed.contact,
        expires: parsed.expires,
        encryption: parsed.encryption,
        preferredLanguages: parsed.preferredLanguages,
        canonical: parsed.canonical,
        policy: parsed.policy,
        hiring: parsed.hiring,
        parseWarnings: warnings
      },
      verified: true,
      source: url,
      strength: 0.85,
      url
    });

    if (parsed.contact.length > 0) {
      evidences.push({
        id: "ev_securitytxt_contact",
        connector: this.name,
        title: "Security contact published",
        description: `Published security contact(s): ${parsed.contact.join(", ")}.`,
        confidence: 90,
        timestamp,
        rawData: { contact: parsed.contact },
        verified: true,
        source: url,
        strength: 0.9,
        url
      });
    }

    if (parsed.policy.length > 0) {
      evidences.push({
        id: "ev_securitytxt_policy",
        connector: this.name,
        title: "Vulnerability disclosure policy published",
        description: `Published vulnerability disclosure polic${parsed.policy.length > 1 ? "ies" : "y"}: ${parsed.policy.join(", ")}.`,
        confidence: 80,
        timestamp,
        rawData: { policy: parsed.policy },
        verified: true,
        source: url,
        strength: 0.8,
        url
      });
    }

    if (parsed.preferredLanguages) {
      evidences.push({
        id: "ev_securitytxt_languages",
        connector: this.name,
        title: "Preferred languages declared",
        description: `Preferred contact languages: ${parsed.preferredLanguages}.`,
        confidence: 70,
        timestamp,
        rawData: { preferredLanguages: parsed.preferredLanguages },
        verified: true,
        source: url,
        strength: 0.7,
        url
      });
    }

    if (parsed.expires) {
      const isExpired = new Date(parsed.expires).getTime() < Date.now();
      if (isExpired) {
        evidences.push({
          id: "ev_securitytxt_expired",
          connector: this.name,
          title: "security.txt is expired",
          description: `The security.txt file expired on ${parsed.expires} and should be renewed.`,
          confidence: 40,
          timestamp,
          rawData: { expires: parsed.expires },
          verified: true,
          source: url,
          strength: 0.4,
          url
        });
      }
    }

    return evidences;
  }

  private buildSuccessResult(
    timestamp: string,
    domain: string,
    url: string,
    httpStatus: number | undefined,
    contentType: string | undefined,
    responseTimeMs: number | undefined,
    parsed: ParsedSecurityTxt,
    warnings: string[]
  ): ConnectorResult {
    const evidences = this.buildEvidences(domain, url, parsed, warnings, timestamp);

    return {
      connectorName: this.name,
      success: true,
      status: "SUCCESS",
      verified: true,
      timestamp,
      entities: [],
      relationships: [],
      timeline: [],
      evidences,
      sources: [url],
      rawData: {
        urlChecked: url,
        httpStatus,
        contentType,
        responseTimeMs,
        parseWarnings: warnings,
        contact: parsed.contact,
        expires: parsed.expires,
        encryption: parsed.encryption,
        preferredLanguages: parsed.preferredLanguages,
        canonical: parsed.canonical,
        policy: parsed.policy,
        hiring: parsed.hiring
      }
    };
  }

  private buildNoDataResult(
    timestamp: string,
    urlChecked: string | undefined,
    httpStatus: number | undefined,
    contentType: string | undefined,
    responseTimeMs: number | undefined
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
        contentType,
        responseTimeMs,
        parseWarnings: [],
        info: "No security.txt file was found at either candidate location."
      }
    };
  }

  private buildErrorResult(
    timestamp: string,
    urlChecked: string | undefined,
    httpStatus: number | undefined,
    contentType: string | undefined,
    responseTimeMs: number | undefined,
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
        contentType,
        responseTimeMs,
        parseWarnings: []
      }
    };
  }
}
