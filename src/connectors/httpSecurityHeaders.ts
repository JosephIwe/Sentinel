import { Connector, ConnectorResult, Entity, Evidence, InvestigationQuery, Relationship } from "../types";
import { safeFetch } from "../utils/ssrfGuard";

interface CacheEntry {
  result: ConnectorResult;
  timestamp: number;
}

/** How a header is treated when absent. */
type HeaderImportance =
  /** A security control whose absence is itself a reportable finding. */
  | "SECURITY"
  /** Reported when present; its absence carries no security meaning. */
  | "INFORMATIONAL"
  /** Presence discloses software detail; absence is the desirable state. */
  | "DISCLOSURE";

interface HeaderSpec {
  name: string;
  importance: HeaderImportance;
  /** What the header controls, stated without reference to any value. */
  purpose: string;
}

/**
 * The headers this connector inspects. Ordered as reported. Nothing outside
 * this list is examined, and nothing in it is assumed present.
 */
const INSPECTED_HEADERS: HeaderSpec[] = [
  {
    name: "strict-transport-security",
    importance: "SECURITY",
    purpose: "Forces browsers to use HTTPS for subsequent requests"
  },
  {
    name: "content-security-policy",
    importance: "SECURITY",
    purpose: "Restricts which sources content may be loaded from"
  },
  {
    name: "x-frame-options",
    importance: "SECURITY",
    purpose: "Controls whether the page may be framed, limiting clickjacking"
  },
  {
    name: "x-content-type-options",
    importance: "SECURITY",
    purpose: "Stops browsers from MIME-sniffing a response away from its declared type"
  },
  {
    name: "referrer-policy",
    importance: "SECURITY",
    purpose: "Controls how much referrer information is sent with requests"
  },
  {
    name: "permissions-policy",
    importance: "SECURITY",
    purpose: "Controls which browser features and APIs the page may use"
  },
  {
    name: "cross-origin-opener-policy",
    importance: "SECURITY",
    purpose: "Isolates the browsing context group from cross-origin windows"
  },
  {
    name: "cross-origin-embedder-policy",
    importance: "SECURITY",
    purpose: "Requires embedded resources to opt in to being loaded"
  },
  {
    name: "cross-origin-resource-policy",
    importance: "SECURITY",
    purpose: "Controls which origins may embed this resource"
  },
  {
    name: "cache-control",
    importance: "INFORMATIONAL",
    purpose: "Directs how responses may be cached"
  },
  {
    name: "server",
    importance: "DISCLOSURE",
    purpose: "Identifies the server software"
  },
  {
    name: "x-powered-by",
    importance: "DISCLOSURE",
    purpose: "Identifies the application framework or runtime"
  }
];

/** A single observed header. */
interface ObservedHeader {
  name: string;
  value: string;
  importance: HeaderImportance;
  purpose: string;
}

/** A header absent from the response. */
interface MissingHeader {
  name: string;
  importance: HeaderImportance;
  purpose: string;
}

/**
 * One observation about a header's literal value. `evidenceValue` is the
 * exact text the observation was read from, so any observation can be
 * independently re-checked against the raw header.
 */
interface HeaderObservation {
  header: string;
  observation: string;
  evidenceValue: string;
}

const MAX_VALUE_LENGTH = 400;

// Confidence tiers. A header read off a response is a direct observation, so
// presence and value rank very high. Observations derived from a value are a
// literal reading of that value, so they rank just below it.
const CONFIDENCE_PRESENT = 97;
const CONFIDENCE_MISSING = 95;
const CONFIDENCE_OBSERVATION = 92;
const CONFIDENCE_DISCLOSURE = 94;

/**
 * The HSTS max-age below which the value is worth remarking on. 15552000
 * seconds is 180 days; the HSTS preload list requires at least 31536000
 * (one year). Both are published thresholds, not judgements invented here.
 */
const HSTS_SHORT_MAX_AGE = 15552000;
const HSTS_PRELOAD_MIN_MAX_AGE = 31536000;

/**
 * HTTP Security Headers Connector
 *
 * Requests the target's homepage over HTTPS and reports the security-relevant
 * response headers exactly as the server sent them: which are present and
 * with what values, which are absent, and what each present value literally
 * says.
 *
 * Every observation is tied to the literal text it was read from and carries
 * that text alongside it, so nothing has to be taken on trust. No value is
 * scored, graded, or converted into a rating - the connector reports what the
 * header says and what that means mechanically (for example, that a CSP
 * contains `unsafe-inline`), never a judgement about the site's overall
 * security.
 *
 * The response body is never read; only headers are examined.
 *
 * A response is a response whatever its status code: a 403 or 500 still
 * carries the headers the server chose to send, so its headers are reported
 * with the status recorded alongside them. Only a failure to obtain any
 * response at all - a network error, a timeout, or an SSRF-guard rejection -
 * is ERROR, never a false "this site sends no security headers".
 */
export class HttpSecurityHeadersConnector implements Connector {
  public name = "HTTP Security Headers";

  private static cache = new Map<string, CacheEntry>();

  /**
   * Configurable cache duration (TTL) in milliseconds. Defaults to 1800000
   * (30 minutes), matching the technology fingerprint connector - both read
   * the same live response surface.
   */
  private getCacheTtl(): number {
    const envTtl = process.env.HTTPHEADERS_CACHE_TTL_MS;
    if (envTtl) {
      const parsed = parseInt(envTtl, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 30 * 60 * 1000;
  }

  /**
   * Configurable request timeout in milliseconds. Defaults to 4000 -
   * deliberately below the orchestrator's 5000ms per-connector default so
   * this connector's own descriptive ERROR wins the race rather than being
   * surfaced as a generic outer TIMEOUT.
   */
  private getRequestTimeoutMs(): number {
    const envTimeout = process.env.HTTPHEADERS_TIMEOUT_MS;
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
    return cleaned.replace(/\.$/, "").trim();
  }

  private truncate(value: string): string {
    const collapsed = String(value).replace(/\s+/g, " ").trim();
    return collapsed.length > MAX_VALUE_LENGTH
      ? `${collapsed.slice(0, MAX_VALUE_LENGTH)}…`
      : collapsed;
  }

  /**
   * Reads observations out of a Strict-Transport-Security value. Every
   * branch is driven by a directive literally present in the header.
   */
  private observeHsts(value: string): HeaderObservation[] {
    const observations: HeaderObservation[] = [];
    const lower = value.toLowerCase();

    const maxAgeMatch = lower.match(/max-age\s*=\s*"?(\d+)"?/);
    if (!maxAgeMatch) {
      observations.push({
        header: "strict-transport-security",
        observation: "The header declares no max-age directive, so browsers have no duration to enforce HTTPS for.",
        evidenceValue: value
      });
    } else {
      const maxAge = parseInt(maxAgeMatch[1], 10);
      if (maxAge === 0) {
        observations.push({
          header: "strict-transport-security",
          observation: "max-age is 0, which instructs browsers to stop enforcing HTTPS for this host.",
          evidenceValue: maxAgeMatch[0]
        });
      } else if (maxAge < HSTS_SHORT_MAX_AGE) {
        observations.push({
          header: "strict-transport-security",
          observation:
            `max-age is ${maxAge} seconds, under the 180-day (${HSTS_SHORT_MAX_AGE}s) mark, so enforcement lapses ` +
            `comparatively soon after a visit.`,
          evidenceValue: maxAgeMatch[0]
        });
      }

      if (lower.includes("preload") && maxAge < HSTS_PRELOAD_MIN_MAX_AGE) {
        observations.push({
          header: "strict-transport-security",
          observation:
            `The header requests preload, but max-age is ${maxAge} seconds, below the ` +
            `${HSTS_PRELOAD_MIN_MAX_AGE}s the HSTS preload list requires.`,
          evidenceValue: value
        });
      }
    }

    if (!lower.includes("includesubdomains")) {
      observations.push({
        header: "strict-transport-security",
        observation: "The header omits includeSubDomains, so the policy covers only this exact host.",
        evidenceValue: value
      });
    }

    return observations;
  }

  /** Reads observations out of a Content-Security-Policy value. */
  private observeCsp(value: string): HeaderObservation[] {
    const observations: HeaderObservation[] = [];
    const lower = value.toLowerCase();

    for (const token of ["'unsafe-inline'", "'unsafe-eval'"]) {
      if (lower.includes(token)) {
        observations.push({
          header: "content-security-policy",
          observation: `The policy contains ${token}, which permits exactly the class of script execution CSP otherwise blocks.`,
          evidenceValue: token
        });
      }
    }

    const defaultSrcMatch = lower.match(/default-src([^;]*)/);
    if (!defaultSrcMatch) {
      observations.push({
        header: "content-security-policy",
        observation: "The policy declares no default-src, so directives absent from it are unrestricted.",
        evidenceValue: this.truncate(value)
      });
    } else if (/\*(\s|$)/.test(defaultSrcMatch[1])) {
      observations.push({
        header: "content-security-policy",
        observation: "default-src includes a bare wildcard, permitting content from any origin.",
        evidenceValue: defaultSrcMatch[0].trim()
      });
    }

    if (!lower.includes("frame-ancestors")) {
      observations.push({
        header: "content-security-policy",
        observation: "The policy declares no frame-ancestors directive, so framing is not restricted by CSP.",
        evidenceValue: this.truncate(value)
      });
    }

    return observations;
  }

  /** Reads observations out of the remaining single-purpose headers. */
  private observeHeader(name: string, value: string): HeaderObservation[] {
    const lower = value.toLowerCase().trim();

    switch (name) {
      case "x-content-type-options":
        return lower === "nosniff"
          ? []
          : [
              {
                header: name,
                observation: `The only defined value for this header is "nosniff"; the server sent "${this.truncate(value)}", which browsers ignore.`,
                evidenceValue: value
              }
            ];

      case "x-frame-options":
        if (lower === "deny" || lower === "sameorigin") return [];
        if (lower.startsWith("allow-from")) {
          return [
            {
              header: name,
              observation: "ALLOW-FROM is obsolete and ignored by current browsers; frame-ancestors in CSP is its replacement.",
              evidenceValue: value
            }
          ];
        }
        return [
          {
            header: name,
            observation: `"${this.truncate(value)}" is not one of the defined values (DENY, SAMEORIGIN), so browsers ignore it.`,
            evidenceValue: value
          }
        ];

      case "referrer-policy":
        if (lower === "unsafe-url") {
          return [
            {
              header: name,
              observation: "unsafe-url sends the full URL, including path and query, to every destination including plaintext HTTP.",
              evidenceValue: value
            }
          ];
        }
        if (lower === "no-referrer-when-downgrade") {
          return [
            {
              header: name,
              observation: "no-referrer-when-downgrade sends the full URL to any HTTPS destination, including third parties.",
              evidenceValue: value
            }
          ];
        }
        return [];

      case "cache-control":
        if (/(^|,\s*)public/.test(lower)) {
          return [
            {
              header: name,
              observation: "The response is marked public, so shared caches may store it.",
              evidenceValue: value
            }
          ];
        }
        return [];

      default:
        return [];
    }
  }

  /**
   * Reports cross-origin isolation, which is a property of two headers held
   * together rather than of either alone.
   */
  private observeCrossOriginIsolation(headers: Map<string, string>): HeaderObservation[] {
    const coop = headers.get("cross-origin-opener-policy")?.toLowerCase().trim();
    const coep = headers.get("cross-origin-embedder-policy")?.toLowerCase().trim();
    if (!coop || !coep) return [];

    if (coop === "same-origin" && (coep === "require-corp" || coep === "credentialless")) {
      return [
        {
          header: "cross-origin-opener-policy",
          observation: `COOP is "${coop}" and COEP is "${coep}", the combination that puts a document in a cross-origin isolated context.`,
          evidenceValue: `cross-origin-opener-policy: ${coop}; cross-origin-embedder-policy: ${coep}`
        }
      ];
    }
    return [];
  }

  public async run(query: InvestigationQuery): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const domain = this.extractDomain(query.term || "");
    const startedAt = Date.now();
    const timeoutMs = this.getRequestTimeoutMs();

    // Response headers belong to a host. An organization or person has none,
    // and a bare IP has no HTTPS virtual host to address reliably.
    if (
      !domain ||
      this.isIpAddress(domain) ||
      query.type === "Organization" ||
      query.type === "Person" ||
      query.type === "IPAddress" ||
      !this.looksLikeDomain(domain)
    ) {
      return this.buildNoDataResult(
        timestamp,
        undefined,
        undefined,
        0,
        "HTTP security header inspection skipped: target is not a domain."
      );
    }

    const cacheKey = domain;
    const ttl = this.getCacheTtl();
    const cached = HttpSecurityHeadersConnector.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttl) {
      console.log(`[HttpSecurityHeaders Cache] Serving cached result for ${domain}`);
      return { ...cached.result, timestamp };
    }

    // HTTPS only. Security headers delivered over plaintext HTTP carry no
    // guarantee at all, so falling back to it would report a posture the
    // site does not actually have.
    const requestedUrl = `https://${domain}/`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await safeFetch(requestedUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "Sentinel-HttpSecurityHeaders-Connector/1.0",
          Accept: "text/html,application/xhtml+xml"
        }
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isTimeout = err?.name === "AbortError" || /abort/i.test(err?.message || "");
      const message = isTimeout
        ? `Timed out after ${timeoutMs}ms requesting ${requestedUrl}.`
        : `Could not reach ${requestedUrl}: ${err?.message || "network error"}.`;
      console.warn(`[HttpSecurityHeaders] ${message}`);
      return this.buildErrorResult(timestamp, requestedUrl, undefined, Date.now() - startedAt, message);
    }
    clearTimeout(timeoutId);

    const httpStatus = response.status;
    // safeFetch follows redirects itself, re-validating each hop. Comparing
    // the final URL to the requested one is how a redirect becomes visible
    // here without changing the shared guard.
    const finalUrl = response.url || requestedUrl;
    const redirected = this.normalizeUrl(finalUrl) !== this.normalizeUrl(requestedUrl);

    // Collect the inspected headers exactly as sent.
    const rawHeaders = new Map<string, string>();
    for (const spec of INSPECTED_HEADERS) {
      const value = response.headers.get(spec.name);
      if (value !== null && value !== undefined && value !== "") {
        rawHeaders.set(spec.name, value);
      }
    }

    const present: ObservedHeader[] = [];
    const missing: MissingHeader[] = [];
    for (const spec of INSPECTED_HEADERS) {
      const value = rawHeaders.get(spec.name);
      if (value !== undefined) {
        present.push({
          name: spec.name,
          value: this.truncate(value),
          importance: spec.importance,
          purpose: spec.purpose
        });
      } else if (spec.importance === "SECURITY") {
        // Only security controls are reported as missing. An absent Server
        // header is desirable, and an absent Cache-Control says nothing.
        missing.push({ name: spec.name, importance: spec.importance, purpose: spec.purpose });
      }
    }

    // A response that carried none of the inspected headers is still a
    // response; there is simply nothing in it to report on.
    if (present.length === 0 && missing.length === 0) {
      const result = this.buildNoDataResult(
        timestamp,
        finalUrl,
        httpStatus,
        Date.now() - startedAt,
        `${finalUrl} responded with none of the inspected headers.`
      );
      HttpSecurityHeadersConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    const observations: HeaderObservation[] = [];
    for (const [name, value] of rawHeaders) {
      if (name === "strict-transport-security") observations.push(...this.observeHsts(value));
      else if (name === "content-security-policy") observations.push(...this.observeCsp(value));
      else observations.push(...this.observeHeader(name, value));
    }
    observations.push(...this.observeCrossOriginIsolation(rawHeaders));

    const disclosures = present.filter(h => h.importance === "DISCLOSURE");
    const securityPresent = present.filter(h => h.importance === "SECURITY");
    const detectionTimeMs = Date.now() - startedAt;

    const diagnostics = {
      detectionTimeMs,
      source: "HTTPS response headers",
      target: domain,
      requestedUrl,
      finalUrl,
      redirected,
      httpStatus,
      // Headers on an error response are still the headers the server sent,
      // but the reader should know which response they came from.
      errorResponse: httpStatus >= 400,
      headersInspected: INSPECTED_HEADERS.length,
      headersPresent: present.length,
      securityHeadersPresent: securityPresent.length,
      securityHeadersMissing: missing.length,
      disclosureHeadersPresent: disclosures.length,
      observationCount: observations.length,
      bodyRead: false
    };

    const evidences: Evidence[] = [];
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    const statusNote =
      httpStatus >= 400
        ? ` These headers were read from an HTTP ${httpStatus} response, which may differ from a successful one.`
        : "";
    const redirectNote = redirected ? ` The request to ${requestedUrl} was redirected to ${finalUrl}.` : "";

    if (present.length > 0) {
      evidences.push({
        id: "ev_headers_present",
        connector: this.name,
        title: "Security Headers Present",
        description:
          `${finalUrl} returned ${present.length} of the ${INSPECTED_HEADERS.length} inspected headers ` +
          `(${securityPresent.length} security control${securityPresent.length === 1 ? "" : "s"}): ` +
          present.map(h => `${h.name}: ${h.value}`).join("; ") +
          `.${redirectNote}${statusNote}`,
        confidence: CONFIDENCE_PRESENT,
        timestamp,
        rawData: { present, httpStatus, finalUrl, redirected, diagnostics },
        verified: true,
        source: finalUrl,
        strength: CONFIDENCE_PRESENT / 100,
        url: finalUrl
      });
    }

    if (missing.length > 0) {
      evidences.push({
        id: "ev_headers_missing",
        connector: this.name,
        title: "Security Headers Absent",
        description:
          `${finalUrl} returned none of the following ${missing.length} security header` +
          `${missing.length === 1 ? "" : "s"}: ` +
          missing.map(h => `${h.name} (${h.purpose})`).join("; ") +
          `.${statusNote}`,
        confidence: CONFIDENCE_MISSING,
        timestamp,
        rawData: { missing, httpStatus, finalUrl, diagnostics },
        verified: true,
        source: finalUrl,
        strength: CONFIDENCE_MISSING / 100,
        url: finalUrl
      });
    }

    if (observations.length > 0) {
      evidences.push({
        id: "ev_headers_observations",
        connector: this.name,
        title: "Header Value Observations",
        description:
          `${observations.length} observation${observations.length === 1 ? "" : "s"} read directly from the ` +
          `header values returned by ${finalUrl}: ` +
          observations.map(o => `[${o.header}] ${o.observation}`).join(" ") +
          ` Each observation carries the exact header text it was read from.`,
        confidence: CONFIDENCE_OBSERVATION,
        timestamp,
        rawData: { observations, diagnostics },
        verified: true,
        source: finalUrl,
        strength: CONFIDENCE_OBSERVATION / 100,
        url: finalUrl
      });
    }

    if (disclosures.length > 0) {
      evidences.push({
        id: "ev_headers_disclosure",
        connector: this.name,
        title: "Software Disclosure Headers",
        description:
          `${finalUrl} identifies its software in ${disclosures.length} header` +
          `${disclosures.length === 1 ? "" : "s"}: ` +
          disclosures.map(h => `${h.name}: ${h.value}`).join("; ") +
          `. These values are reported exactly as sent; no version or product is inferred from them.`,
        confidence: CONFIDENCE_DISCLOSURE,
        timestamp,
        rawData: { disclosures, diagnostics },
        verified: true,
        source: finalUrl,
        strength: CONFIDENCE_DISCLOSURE / 100,
        url: finalUrl
      });
    }

    const evidenceIds = evidences.map(e => e.id);

    // Uses the same `type` + `name` canonical key the DNS connector uses so
    // the two merge into a single graph node.
    const domainEntityId = `ent_headers_domain_${domain.replace(/[^a-zA-Z0-9]/g, "_")}`;
    entities.push({
      id: domainEntityId,
      name: domain,
      type: "Domain",
      metadata: {
        resolver: this.name,
        securityHeadersPresent: securityPresent.map(h => h.name),
        securityHeadersMissing: missing.map(h => h.name),
        disclosureHeaders: disclosures.map(h => h.name),
        httpStatus,
        finalUrl
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
      sources: [finalUrl],
      rawData: {
        domain,
        requestedUrl,
        finalUrl,
        redirected,
        httpStatus,
        detectionTimeMs,
        present,
        missing,
        observations,
        diagnostics
      }
    };

    HttpSecurityHeadersConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }

  /** Normalizes a URL for redirect comparison, ignoring a trailing slash. */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`;
    } catch {
      return url.replace(/\/$/, "");
    }
  }

  private buildNoDataResult(
    timestamp: string,
    urlChecked: string | undefined,
    httpStatus: number | undefined,
    detectionTimeMs: number,
    info: string
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
      rawData: { urlChecked, httpStatus, detectionTimeMs, headersPresent: 0, info }
    };
  }

  private buildErrorResult(
    timestamp: string,
    urlChecked: string | undefined,
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
      rawData: { urlChecked, httpStatus, detectionTimeMs, headersPresent: 0 }
    };
  }
}
