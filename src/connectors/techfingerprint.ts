import { Connector, ConnectorResult, Entity, Evidence, InvestigationQuery, Relationship } from "../types";
import { safeFetch } from "../utils/ssrfGuard";

interface CacheEntry {
  result: ConnectorResult;
  timestamp: number;
}

/**
 * Where a detection came from. Recorded on every finding so an analyst can
 * independently re-verify it against the raw response.
 */
type MatchSource =
  | "header"
  | "cookie"
  | "meta-generator"
  | "html-marker";

interface Detection {
  /** Canonical technology name, e.g. "nginx", "WordPress". */
  technology: string;
  /** Broad grouping used for reporting only, e.g. "Web Server", "CDN". */
  category: string;
  /** Version string ONLY when it literally appeared in the matched text. */
  version?: string;
  matchSource: MatchSource;
  /** Precise locator, e.g. "header:server", "cookie:PHPSESSID". */
  matchedOn: string;
  /** The literal observed text that produced this detection (truncated). */
  matchedValue: string;
  confidence: number;
}

/**
 * Vendor-proprietary response headers. Presence of these headers is itself
 * the signal - their values are request/trace IDs, so only the header name
 * is treated as meaningful.
 */
const VENDOR_HEADER_SIGNATURES: Array<{ header: string; technology: string; category: string }> = [
  { header: "cf-ray", technology: "Cloudflare", category: "CDN" },
  { header: "x-vercel-id", technology: "Vercel", category: "Hosting" },
  { header: "x-amz-cf-id", technology: "Amazon CloudFront", category: "CDN" },
  { header: "x-fastly-request-id", technology: "Fastly", category: "CDN" },
  { header: "fastly-debug-digest", technology: "Fastly", category: "CDN" },
  { header: "x-nf-request-id", technology: "Netlify", category: "Hosting" },
  { header: "x-github-request-id", technology: "GitHub Pages", category: "Hosting" },
  { header: "x-shopify-stage", technology: "Shopify", category: "Ecommerce" },
  { header: "x-drupal-cache", technology: "Drupal", category: "CMS" },
  { header: "x-akamai-transformed", technology: "Akamai", category: "CDN" }
];

/**
 * Session/framework cookie names. Weaker than direct self-identification -
 * cookie names are conventional, not guaranteed - hence lower confidence.
 */
const COOKIE_SIGNATURES: Array<{ pattern: RegExp; technology: string; category: string }> = [
  { pattern: /^PHPSESSID$/i, technology: "PHP", category: "Language" },
  { pattern: /^JSESSIONID$/i, technology: "Java Servlet Container", category: "Application Server" },
  { pattern: /^ASP\.NET_SessionId$/i, technology: "ASP.NET", category: "Framework" },
  { pattern: /^laravel_session$/i, technology: "Laravel", category: "Framework" },
  { pattern: /^wordpress_logged_in/i, technology: "WordPress", category: "CMS" },
  { pattern: /^wp-settings-/i, technology: "WordPress", category: "CMS" },
  { pattern: /^_shopify_/i, technology: "Shopify", category: "Ecommerce" },
  { pattern: /^csrftoken$/i, technology: "Django", category: "Framework" },
  { pattern: /^_rails_session$/i, technology: "Ruby on Rails", category: "Framework" }
];

/**
 * Distinctive markup/asset-path markers. Each is chosen to be specific
 * enough that a match is not plausibly coincidental.
 */
const HTML_MARKER_SIGNATURES: Array<{ pattern: RegExp; technology: string; category: string }> = [
  { pattern: /\/wp-content\//i, technology: "WordPress", category: "CMS" },
  { pattern: /\/wp-includes\//i, technology: "WordPress", category: "CMS" },
  { pattern: /id="__NEXT_DATA__"/i, technology: "Next.js", category: "Framework" },
  { pattern: /\/_next\/static\//i, technology: "Next.js", category: "Framework" },
  { pattern: /window\.__NUXT__/i, technology: "Nuxt", category: "Framework" },
  { pattern: /ng-version="/i, technology: "Angular", category: "Framework" },
  { pattern: /cdn\.shopify\.com/i, technology: "Shopify", category: "Ecommerce" },
  { pattern: /static1\.squarespace\.com/i, technology: "Squarespace", category: "Website Builder" },
  { pattern: /static\.wixstatic\.com/i, technology: "Wix", category: "Website Builder" },
  { pattern: /Drupal\.settings/i, technology: "Drupal", category: "CMS" },
  { pattern: /\/media\/jui\/js\//i, technology: "Joomla", category: "CMS" }
];

/**
 * Products commonly named in a `Server:` header, with the token used to
 * detect them. Matched case-insensitively against the header value.
 */
const SERVER_HEADER_PRODUCTS: Array<{ token: string; technology: string; category: string }> = [
  { token: "nginx", technology: "nginx", category: "Web Server" },
  { token: "apache", technology: "Apache HTTP Server", category: "Web Server" },
  { token: "microsoft-iis", technology: "Microsoft IIS", category: "Web Server" },
  { token: "litespeed", technology: "LiteSpeed", category: "Web Server" },
  { token: "caddy", technology: "Caddy", category: "Web Server" },
  { token: "openresty", technology: "OpenResty", category: "Web Server" },
  { token: "cloudflare", technology: "Cloudflare", category: "CDN" },
  { token: "gunicorn", technology: "Gunicorn", category: "Application Server" },
  { token: "cowboy", technology: "Cowboy", category: "Application Server" }
];

/**
 * Products commonly named in an `X-Powered-By` header.
 */
const POWERED_BY_PRODUCTS: Array<{ token: string; technology: string; category: string }> = [
  { token: "php", technology: "PHP", category: "Language" },
  { token: "express", technology: "Express", category: "Framework" },
  { token: "asp.net", technology: "ASP.NET", category: "Framework" },
  { token: "next.js", technology: "Next.js", category: "Framework" },
  { token: "servlet", technology: "Java Servlet Container", category: "Application Server" },
  { token: "plesk", technology: "Plesk", category: "Hosting" },
  { token: "wp engine", technology: "WP Engine", category: "Hosting" }
];

// Confidence tiers, ordered by how directly the signal identifies the
// technology. Direct self-identification outranks conventional markers.
const CONFIDENCE_SELF_REPORTED = 90; // Server, X-Powered-By, meta generator
const CONFIDENCE_VENDOR_HEADER = 85; // Proprietary headers unique to a vendor
const CONFIDENCE_HTML_MARKER = 78;   // Distinctive markup/asset paths
const CONFIDENCE_COOKIE = 70;        // Conventional cookie names (customizable)

const MAX_VALUE_LENGTH = 200;
const MAX_HTML_BYTES = 512 * 1024; // Cap parsed HTML at 512KB.

/**
 * Technology Fingerprinting Connector
 *
 * Performs a single HTTPS GET of the target's homepage and identifies the
 * web technologies it runs from directly observable signal only: response
 * headers, Set-Cookie names, the HTML `<meta name="generator">` tag, and a
 * small set of unambiguous markup/asset-path markers.
 *
 * Never fabricates or infers: every detection records the exact source
 * (`matchedOn`) and the literal observed text (`matchedValue`) that produced
 * it, so any finding can be independently re-verified against the raw
 * response. Versions are reported only when they literally appear in the
 * matched string. A page that is fetched cleanly but matches no signature is
 * reported as NO_DATA (a genuine absence of detectable technology), while
 * any failure to reach the host is reported as ERROR - never as a false
 * "no technologies found".
 */
export class TechnologyFingerprintConnector implements Connector {
  public name = "Technology Fingerprint Resolver";

  private static cache = new Map<string, CacheEntry>();

  /**
   * Configurable cache duration (TTL) in milliseconds.
   * Defaults to 1800000 (30 minutes).
   */
  private getCacheTtl(): number {
    const envTtl = process.env.TECHFINGERPRINT_CACHE_TTL_MS;
    if (envTtl) {
      const parsed = parseInt(envTtl, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 30 * 60 * 1000; // Default: 30 minutes
  }

  /**
   * Configurable per-request timeout in milliseconds. Defaults to 4000 -
   * deliberately below the orchestrator's 5000ms per-connector default so
   * this connector's own descriptive ERROR wins the race instead of being
   * surfaced as a generic outer TIMEOUT.
   */
  private getRequestTimeoutMs(): number {
    const envTimeout = process.env.TECHFINGERPRINT_TIMEOUT_MS;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 4000; // Default: 4 seconds
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
        rawData: { info: "Technology fingerprinting skipped for non-domain target." }
      };
    }

    const ttl = this.getCacheTtl();
    const cached = TechnologyFingerprintConnector.cache.get(domain);
    if (cached && Date.now() - cached.timestamp < ttl) {
      console.log(`[TechFingerprint Cache] Serving cached result for ${domain}`);
      return { ...cached.result, timestamp };
    }

    const url = `https://${domain}/`;
    const timeoutMs = this.getRequestTimeoutMs();
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await safeFetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Sentinel-TechFingerprint-Connector/1.0",
          "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
        }
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      const responseTimeMs = Date.now() - startedAt;
      const isTimeout = err.name === "AbortError" || /abort/i.test(err.message || "");
      const message = isTimeout
        ? `Timed out after ${timeoutMs}ms fetching ${url}.`
        : `Could not reach ${url}: ${err.message || "network error"}.`;
      console.warn(`[TechFingerprint] ${message}`);
      return this.buildErrorResult(timestamp, url, undefined, undefined, responseTimeMs, message);
    }

    clearTimeout(timeoutId);
    const responseTimeMs = Date.now() - startedAt;
    const httpStatus = res.status;
    const contentType = res.headers.get("content-type") || undefined;

    if (!res.ok) {
      const message = `Unexpected HTTP status ${httpStatus} at ${url}.`;
      console.warn(`[TechFingerprint] ${message}`);
      return this.buildErrorResult(timestamp, url, httpStatus, contentType, responseTimeMs, message);
    }

    // Header- and cookie-derived detections do not require a readable body,
    // so collect them even if the body turns out to be unreadable.
    const detections: Detection[] = [
      ...this.detectFromHeaders(res.headers),
      ...this.detectFromCookies(res.headers)
    ];

    let body = "";
    try {
      body = await res.text();
    } catch (err: any) {
      // A body we cannot read is not a failed check - header/cookie signal
      // already gathered above remains valid. Record it and continue.
      console.warn(`[TechFingerprint] Could not read response body for ${url}: ${err.message || "unknown error"}.`);
    }

    if (body) {
      const truncatedBody = body.length > MAX_HTML_BYTES ? body.slice(0, MAX_HTML_BYTES) : body;
      detections.push(...this.detectFromHtml(truncatedBody));
    }

    const merged = this.dedupeDetections(detections);

    if (merged.length === 0) {
      const noDataResult = this.buildNoDataResult(timestamp, url, httpStatus, contentType, responseTimeMs);
      TechnologyFingerprintConnector.cache.set(domain, { result: noDataResult, timestamp: Date.now() });
      return noDataResult;
    }

    const result = this.buildSuccessResult(
      timestamp, domain, url, httpStatus, contentType, responseTimeMs, merged, body.length
    );
    TechnologyFingerprintConnector.cache.set(domain, { result, timestamp: Date.now() });
    return result;
  }

  /**
   * Extracts a version only when it literally follows the product token in
   * the observed text (e.g. "nginx/1.18.0", "WordPress 6.4"). Returns
   * undefined otherwise - versions are never inferred.
   */
  private extractVersion(value: string, token: string): string | undefined {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = value.match(new RegExp(`${escaped}[\\s/v-]+([0-9]+(?:\\.[0-9]+)*)`, "i"));
    return match ? match[1] : undefined;
  }

  private detectFromHeaders(headers: Headers): Detection[] {
    const detections: Detection[] = [];

    const serverHeader = headers.get("server");
    if (serverHeader) {
      for (const product of SERVER_HEADER_PRODUCTS) {
        if (serverHeader.toLowerCase().includes(product.token)) {
          detections.push({
            technology: product.technology,
            category: product.category,
            version: this.extractVersion(serverHeader, product.token),
            matchSource: "header",
            matchedOn: "header:server",
            matchedValue: this.truncate(serverHeader),
            confidence: CONFIDENCE_SELF_REPORTED
          });
        }
      }
    }

    const poweredBy = headers.get("x-powered-by");
    if (poweredBy) {
      for (const product of POWERED_BY_PRODUCTS) {
        if (poweredBy.toLowerCase().includes(product.token)) {
          detections.push({
            technology: product.technology,
            category: product.category,
            version: this.extractVersion(poweredBy, product.token),
            matchSource: "header",
            matchedOn: "header:x-powered-by",
            matchedValue: this.truncate(poweredBy),
            confidence: CONFIDENCE_SELF_REPORTED
          });
        }
      }
    }

    // `X-Generator` is a self-reported generator name (Drupal, Hugo, etc.).
    const generatorHeader = headers.get("x-generator");
    if (generatorHeader) {
      detections.push({
        technology: this.truncate(generatorHeader.split(/[,;]/)[0]),
        category: "Generator",
        matchSource: "header",
        matchedOn: "header:x-generator",
        matchedValue: this.truncate(generatorHeader),
        confidence: CONFIDENCE_SELF_REPORTED
      });
    }

    for (const signature of VENDOR_HEADER_SIGNATURES) {
      const value = headers.get(signature.header);
      if (value !== null && value !== undefined) {
        detections.push({
          technology: signature.technology,
          category: signature.category,
          matchSource: "header",
          matchedOn: `header:${signature.header}`,
          // The header's presence is the signal; values are trace IDs.
          matchedValue: `${signature.header} header present`,
          confidence: CONFIDENCE_VENDOR_HEADER
        });
      }
    }

    return detections;
  }

  private detectFromCookies(headers: Headers): Detection[] {
    const detections: Detection[] = [];
    const setCookie = headers.get("set-cookie");
    if (!setCookie) return detections;

    // A combined Set-Cookie header may carry several cookies; only the name
    // (text before "=") of each is inspected - never the value, which can
    // hold session material.
    const cookieNames = setCookie
      .split(/,(?=[^;]+=)/)
      .map(part => part.split("=")[0].trim())
      .filter(Boolean);

    for (const name of cookieNames) {
      for (const signature of COOKIE_SIGNATURES) {
        if (signature.pattern.test(name)) {
          detections.push({
            technology: signature.technology,
            category: signature.category,
            matchSource: "cookie",
            matchedOn: `cookie:${this.truncate(name)}`,
            matchedValue: `Set-Cookie name "${this.truncate(name)}"`,
            confidence: CONFIDENCE_COOKIE
          });
        }
      }
    }

    return detections;
  }

  private detectFromHtml(html: string): Detection[] {
    const detections: Detection[] = [];

    // <meta name="generator" content="..."> is a direct self-declaration.
    const metaGenerator = html.match(
      /<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/i
    ) || html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']generator["']/i
    );
    if (metaGenerator && metaGenerator[1]) {
      const content = metaGenerator[1].trim();
      // Take the leading product name; keep the full string as evidence.
      const productName = content.split(/\s+\d/)[0].trim() || content;
      detections.push({
        technology: this.truncate(productName),
        category: "Generator",
        version: this.extractVersion(content, productName),
        matchSource: "meta-generator",
        matchedOn: "html:meta[name=generator]",
        matchedValue: this.truncate(content),
        confidence: CONFIDENCE_SELF_REPORTED
      });
    }

    for (const signature of HTML_MARKER_SIGNATURES) {
      const match = html.match(signature.pattern);
      if (match) {
        detections.push({
          technology: signature.technology,
          category: signature.category,
          matchSource: "html-marker",
          matchedOn: `html:${signature.pattern.source}`,
          matchedValue: this.truncate(match[0]),
          confidence: CONFIDENCE_HTML_MARKER
        });
      }
    }

    return detections;
  }

  /**
   * Collapses repeat detections of the same technology, keeping the
   * highest-confidence one and recording every corroborating source. Multiple
   * independent signals for one technology raise confidence by a small,
   * capped amount, since independent corroboration is genuinely stronger
   * evidence than a single signal.
   */
  private dedupeDetections(detections: Detection[]): Array<Detection & { corroboratingSources: string[] }> {
    const byTechnology = new Map<string, Detection & { corroboratingSources: string[] }>();

    for (const detection of detections) {
      const key = detection.technology.toLowerCase();
      const existing = byTechnology.get(key);

      if (!existing) {
        byTechnology.set(key, { ...detection, corroboratingSources: [detection.matchedOn] });
        continue;
      }

      if (!existing.corroboratingSources.includes(detection.matchedOn)) {
        existing.corroboratingSources.push(detection.matchedOn);
      }
      // Prefer the stronger signal as the primary record.
      if (detection.confidence > existing.confidence) {
        const sources = existing.corroboratingSources;
        byTechnology.set(key, { ...detection, corroboratingSources: sources });
      }
      // Keep a version if any signal supplied one.
      const current = byTechnology.get(key)!;
      if (!current.version && detection.version) {
        current.version = detection.version;
      }
    }

    return Array.from(byTechnology.values()).map(detection => {
      const extraSources = detection.corroboratingSources.length - 1;
      const boosted = Math.min(95, detection.confidence + Math.min(5, extraSources * 3));
      return { ...detection, confidence: boosted };
    });
  }

  private buildSuccessResult(
    timestamp: string,
    domain: string,
    url: string,
    httpStatus: number | undefined,
    contentType: string | undefined,
    responseTimeMs: number | undefined,
    detections: Array<Detection & { corroboratingSources: string[] }>,
    htmlBytes: number
  ): ConnectorResult {
    const evidences: Evidence[] = [];
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    // Same canonical key convention (`type` + `name`) the DNS connector uses
    // for the target domain, so the two merge into a single graph node
    // rather than producing duplicates.
    const domainEntityId = `ent_techfp_domain_${domain.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const domainEvidenceIds: string[] = [];

    for (const detection of detections) {
      const slug = detection.technology.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      const evidenceId = `ev_techfp_${slug}`;
      const label = detection.version
        ? `${detection.technology} ${detection.version}`
        : detection.technology;

      evidences.push({
        id: evidenceId,
        connector: this.name,
        title: `${detection.category}: ${label}`,
        description:
          `Detected ${label} on ${domain} via ${detection.matchedOn} ` +
          `(observed: "${detection.matchedValue}").` +
          (detection.corroboratingSources.length > 1
            ? ` Corroborated by ${detection.corroboratingSources.length} independent signals.`
            : ""),
        confidence: detection.confidence,
        timestamp,
        rawData: {
          technology: detection.technology,
          category: detection.category,
          version: detection.version,
          matchSource: detection.matchSource,
          matchedOn: detection.matchedOn,
          matchedValue: detection.matchedValue,
          corroboratingSources: detection.corroboratingSources,
          urlChecked: url
        },
        verified: true,
        source: url,
        strength: detection.confidence / 100,
        url
      });

      domainEvidenceIds.push(evidenceId);

      const technologyEntityId = `ent_techfp_tech_${slug}`;
      entities.push({
        id: technologyEntityId,
        name: detection.technology,
        // Deliberately a distinct type (not "Generic"), which would be
        // eligible for the entity resolver's cross-type wildcard match.
        type: "Technology",
        metadata: {
          category: detection.category,
          version: detection.version,
          detectedVia: detection.matchedOn,
          corroboratingSources: detection.corroboratingSources
        },
        evidenceIds: [evidenceId]
      });

      relationships.push({
        source: domainEntityId,
        target: technologyEntityId,
        type: "RUNS_TECHNOLOGY",
        metadata: { category: detection.category, version: detection.version },
        evidenceIds: [evidenceId]
      });
    }

    entities.unshift({
      id: domainEntityId,
      name: domain,
      type: "Domain",
      metadata: {
        resolver: this.name,
        technologiesDetected: detections.length,
        urlChecked: url
      },
      evidenceIds: domainEvidenceIds
    });

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
        contentType,
        responseTimeMs,
        htmlBytes,
        technologiesDetected: detections.length,
        technologies: detections.map(d => ({
          technology: d.technology,
          category: d.category,
          version: d.version,
          matchedOn: d.matchedOn,
          matchedValue: d.matchedValue,
          confidence: d.confidence,
          corroboratingSources: d.corroboratingSources
        }))
      }
    };
  }

  private buildNoDataResult(
    timestamp: string,
    urlChecked: string,
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
        technologiesDetected: 0,
        info: "The page was retrieved successfully but matched no known technology signature."
      }
    };
  }

  private buildErrorResult(
    timestamp: string,
    urlChecked: string,
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
        technologiesDetected: 0
      }
    };
  }
}
