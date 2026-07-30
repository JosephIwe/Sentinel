import { Connector, ConnectorResult, Entity, Evidence, InvestigationQuery, Relationship } from "../types";
import { safeFetch, assertPublicHostname } from "../utils/ssrfGuard";

interface CacheEntry {
  result: ConnectorResult;
  timestamp: number;
}

/**
 * One crawl result from the Crawl4AI service.
 *
 * Crawl4AI's REST shape has moved between releases, so every field here is
 * optional and read defensively: a field the service did not send stays
 * undefined rather than being defaulted, and an unrecognisable payload is an
 * ERROR rather than an empty footprint. The service's exact contract is an
 * assumption this connector cannot verify offline - see the class docstring.
 */
interface Crawl4AiResult {
  url?: string;
  /** Where the crawl actually landed after redirects. Preferred over `url`. */
  redirected_url?: string;
  success?: boolean;
  status_code?: number;
  error_message?: string;
  html?: string;
  cleaned_html?: string;
  metadata?: Record<string, unknown>;
  links?: { internal?: unknown[]; external?: unknown[] };
  media?: { images?: unknown[] };
  // `response_headers` is deliberately NOT modelled. CrawlResult carries it,
  // and it can contain Set-Cookie and authorization-bearing values; leaving it
  // off the type keeps it from being read into evidence by accident.
}

interface Crawl4AiResponse {
  success?: boolean;
  results?: Crawl4AiResult[];
  error?: string;
  detail?: unknown;
}

/** Page metadata, each field present only when the crawler reported it. */
interface PageMetadata {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  language?: string;
  generator?: string;
}

/** A form observed in the markup. Never submitted, never filled. */
interface ObservedForm {
  method: string;
  action?: string;
  inputTypes: string[];
  inputCount: number;
}

/** A technology indicator read directly out of the crawled markup. */
interface TechnologyIndicator {
  indicator: string;
  source: string;
  /** The literal text the indicator was read from. */
  evidenceValue: string;
}

interface ResourceCounts {
  scripts: number;
  stylesheets: number;
  images: number;
  iframes: number;
  externalResources: number;
  insecureResources: number;
}

const MAX_VALUE_LENGTH = 300;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCE_URLS = 15;
const MAX_FORMS_REPORTED = 10;
const MAX_TECH_INDICATORS = 20;

// v1 is deliberately a single-page read, not a crawler.
//
// These are enforced by construction rather than by asking the service
// nicely. Crawl4AI's untrusted-request filter (`_filter_untrusted_fields`)
// silently DROPS any key absent from its CrawlerRunConfig allowlist, so
// invented knobs like `max_depth`/`max_pages`/`follow_links` would be
// no-ops that merely looked like limits. What actually holds the line:
//   1. Exactly one URL is submitted.
//   2. `deep_crawl_strategy` - the only field that enables multi-page
//      crawling - is on Crawl4AI's UNTRUSTED_FORBIDDEN_FIELDS list, so a
//      request body cannot turn deep crawling on at all.
//   3. Only `results[0]` is read here, so a service that returned more
//      still cannot widen the footprint.
const MAX_DEPTH = 0;
const MAX_PAGES = 1;

const CRAWLER_USER_AGENT = "Sentinel-WebFootprint-Connector/1.0";

// Confidence tiers. A tag parsed out of the returned markup is a direct
// observation. Counts rank alongside it. Technology indicators rank lower
// because a marker's presence is weaker evidence than the marker itself.
const CONFIDENCE_METADATA = 94;
const CONFIDENCE_RESOURCES = 92;
const CONFIDENCE_FORMS = 92;
const CONFIDENCE_LINKS = 90;
const CONFIDENCE_TECH = 84;

/**
 * Crawl4AI Web Footprint Connector
 *
 * Reads a single page - the target's own URL, depth 0, one page - through a
 * configured Crawl4AI service, and reports the footprint that page literally
 * exhibits: its metadata, how many same-origin links it carries, what
 * resources it loads, what forms it presents, and which technology markers
 * appear verbatim in its markup.
 *
 * It is deliberately not a crawler. Discovered links are counted, never
 * followed; external links are never fetched; subdomains are never expanded;
 * nothing recurses. Anything requiring judgement about significance is out of
 * scope, and no vulnerability or CVE claim is ever made.
 *
 * ## Integration
 *
 * Crawl4AI is integrated as an HTTP service (`CRAWL4AI_URL`), not a library.
 * Every other connector in this project is a thin network client with no
 * heavy local dependency, and Crawl4AI is a Python/browser stack; running it
 * as a service keeps that property. Without `CRAWL4AI_URL` the connector is
 * inert: NO_DATA with a "not configured" diagnostic and no request, matching
 * the pattern `ShodanConnector` established. It never falls back to a second
 * crawling implementation.
 *
 * ## Security boundary
 *
 * The Crawl4AI service performs the actual page fetch, so the target must be
 * proven public *before* it is handed over, and the URL the service reports
 * coming back must be re-checked in case it followed a redirect into private
 * space. Both checks use the shared SSRF guard - `assertPublicHostname` for
 * the target and the returned final URL, `safeFetch` for robots.txt.
 *
 * `CRAWL4AI_URL` itself is operator infrastructure configuration, on the same
 * trust footing as a database URL, and is normally a private-network sidecar.
 * It is therefore reached with a plain fetch rather than `safeFetch` - which
 * would reject exactly the private address a sidecar deployment uses - after
 * validating that it parses as an http/https URL. It is never derived from
 * investigation input, so a user cannot point it anywhere. Because it may
 * legitimately carry basic-auth credentials, only its redacted form is ever
 * written to evidence, diagnostics, errors, or logs.
 *
 * ## Verified against the Crawl4AI service contract
 *
 * Checked against `deploy/docker/{schemas,server,api}.py` and
 * `crawl4ai/{async_configs,models}.py` upstream:
 *
 *   - `POST /crawl` accepts `{urls, browser_config, crawler_config}` and
 *     answers `{success, results: [CrawlResult…]}`.
 *   - Every `crawler_config` key sent here is on Crawl4AI's
 *     `UNTRUSTED_FIELD_ALLOWLIST` for `CrawlerRunConfig`, so each takes
 *     effect. Non-allowlisted keys are silently dropped server-side, which is
 *     why no invented limit knobs are sent - they would look like constraints
 *     while doing nothing.
 *   - Every `CrawlResult` field read here (`url`, `redirected_url`, `html`,
 *     `cleaned_html`, `metadata`, `links`, `status_code`, `success`,
 *     `error_message`) exists on the upstream model. `response_headers` also
 *     exists but is deliberately never read.
 *   - The endpoint carries a token dependency that is active only when the
 *     operator sets an api_token or enables JWT. This connector sends no
 *     credential; a 401/403 is surfaced as an ERROR that says so.
 *
 * ## robots.txt
 *
 * robots.txt is honoured. An explicit `Disallow` covering the target path is
 * NO_DATA. A 404/410 means no restrictions exist, which is the standard's own
 * meaning rather than an assumption. A robots.txt that cannot be retrieved -
 * network failure, timeout, or a 5xx - leaves permission unestablished, so
 * the page is not crawled and the connector returns ERROR rather than
 * inventing permission or reporting a false absence.
 */
export class Crawl4AiWebFootprintConnector implements Connector {
  public name = "Web Footprint";

  private static cache = new Map<string, CacheEntry>();

  /**
   * Strips any userinfo from a service URL before it is shown anywhere.
   * `CRAWL4AI_URL` may legitimately carry basic-auth credentials
   * (`http://user:pass@crawl4ai:11235`), and the raw value otherwise reaches
   * diagnostics, evidence, error strings and logs. Only the redacted form is
   * ever surfaced; the raw value is used solely to build the request.
   */
  /**
   * Splits a service URL into a credential-free request URL and, when the
   * configured value carried basic-auth userinfo, an Authorization header.
   *
   * `fetch()` refuses a URL containing credentials outright - and its rejection
   * message echoes the whole URL, password included - so the userinfo has to be
   * moved into a header both to work at all and to stay out of error text.
   */
  public buildServiceRequest(url: string): { requestUrl: string; authHeader?: string } {
    try {
      const parsed = new URL(url);
      const user = decodeURIComponent(parsed.username || "");
      const pass = decodeURIComponent(parsed.password || "");
      if (!user && !pass) return { requestUrl: url };
      parsed.username = "";
      parsed.password = "";
      return {
        requestUrl: parsed.toString().replace(/\/+$/, ""),
        authHeader: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`
      };
    } catch {
      return { requestUrl: url };
    }
  }

  /**
   * Removes any configured-credential material from text that is about to be
   * surfaced. Upstream errors can quote the URL we handed them, so redacting
   * only our own interpolations is not enough.
   */
  private sanitizeMessage(message: string, rawServiceUrl: string): string {
    let out = String(message).replace(/\/\/[^/@\s]*@/g, "//");
    try {
      const parsed = new URL(rawServiceUrl);
      for (const secret of [parsed.password, parsed.username]) {
        if (secret) out = out.split(decodeURIComponent(secret)).join("***").split(secret).join("***");
      }
    } catch {
      /* unparseable: the userinfo strip above still applies */
    }
    return out;
  }

  public redactServiceUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (!parsed.username && !parsed.password) return url;
      parsed.username = "";
      parsed.password = "";
      return parsed.toString().replace(/\/+$/, "");
    } catch {
      // Unparseable: strip anything before an "@" rather than risk echoing it.
      return url.replace(/\/\/[^/@]*@/, "//");
    }
  }

  /** The configured Crawl4AI service base URL, or null when unconfigured. */
  private getServiceUrl(): string | null {
    const raw = process.env.CRAWL4AI_URL;
    if (!raw || !raw.trim()) return null;

    // Operator-supplied infrastructure config, but still validated: a value
    // that is not an http/https URL is treated as unconfigured rather than
    // being passed to fetch.
    try {
      const parsed = new URL(raw.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return raw.trim().replace(/\/+$/, "");
    } catch {
      return null;
    }
  }

  private getCacheTtl(): number {
    const envTtl = process.env.CRAWL4AI_CACHE_TTL_MS;
    if (envTtl) {
      const parsed = parseInt(envTtl, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 30 * 60 * 1000;
  }

  /**
   * Per-request timeout. Defaults to 4000 - below the orchestrator's 5000ms
   * per-connector default so this connector's own descriptive ERROR wins the
   * race rather than a generic outer TIMEOUT. A browser-backed crawl can
   * legitimately need longer, so operators rendering full pages will want to
   * raise both this and the orchestrator budget together.
   */
  private getTimeoutMs(): number {
    const envTimeout = process.env.CRAWL4AI_TIMEOUT_MS;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 4000;
  }

  private isIpAddress(term: string): boolean {
    const ipv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    const ipv6 = /^(?:[a-fA-F0-9]{1,4}:){2,7}[a-fA-F0-9]{0,4}$/;
    return ipv4.test(term) || ipv6.test(term);
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

  private truncate(value: unknown, limit = MAX_VALUE_LENGTH): string {
    const collapsed = String(value).replace(/\s+/g, " ").trim();
    return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed;
  }

  /**
   * Checks robots.txt for the target. Returns whether crawling the path is
   * permitted, or an inconclusive verdict when robots.txt could not be read.
   */
  private async checkRobots(
    domain: string,
    path: string,
    timeoutMs: number
  ): Promise<{ verdict: "allowed" | "disallowed" | "inconclusive"; detail: string }> {
    const robotsUrl = `https://${domain}/robots.txt`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await safeFetch(robotsUrl, {
        signal: controller.signal,
        headers: { "User-Agent": CRAWLER_USER_AGENT, Accept: "text/plain" }
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      return {
        verdict: "inconclusive",
        detail: `robots.txt at ${robotsUrl} could not be retrieved: ${err?.message || "network error"}.`
      };
    }
    clearTimeout(timeoutId);

    // RFC 9309: an absent robots.txt means no restrictions. That is the
    // standard's own meaning, not an assumption made here.
    if (response.status === 404 || response.status === 410) {
      return { verdict: "allowed", detail: `No robots.txt is published (HTTP ${response.status}), so no rule restricts this path.` };
    }

    if (response.status >= 500) {
      return {
        verdict: "inconclusive",
        detail: `robots.txt returned HTTP ${response.status}, leaving crawl permission unestablished.`
      };
    }

    if (!response.ok) {
      return {
        verdict: "inconclusive",
        detail: `robots.txt returned HTTP ${response.status}, leaving crawl permission unestablished.`
      };
    }

    let body: string;
    try {
      body = await response.text();
    } catch (err: any) {
      return { verdict: "inconclusive", detail: `robots.txt could not be read: ${err?.message || "unknown error"}.` };
    }

    return this.evaluateRobots(body, path);
  }

  /**
   * Evaluates robots.txt content for this crawler. Groups are matched for
   * our own user-agent first and `*` otherwise; within the applicable group
   * the longest matching rule wins, with Allow beating Disallow on ties, per
   * RFC 9309.
   */
  public evaluateRobots(body: string, path: string): { verdict: "allowed" | "disallowed"; detail: string } {
    const lines = body.split(/\r?\n/).map(l => l.replace(/#.*$/, "").trim()).filter(Boolean);

    let currentAgents: string[] = [];
    const groups = new Map<string, { allow: string[]; disallow: string[] }>();
    let lastWasAgent = false;

    for (const line of lines) {
      const separator = line.indexOf(":");
      if (separator === -1) continue;
      const field = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();

      if (field === "user-agent") {
        if (!lastWasAgent) currentAgents = [];
        currentAgents.push(value.toLowerCase());
        if (!groups.has(value.toLowerCase())) groups.set(value.toLowerCase(), { allow: [], disallow: [] });
        lastWasAgent = true;
        continue;
      }

      lastWasAgent = false;
      if (field !== "allow" && field !== "disallow") continue;
      for (const agent of currentAgents) {
        const group = groups.get(agent);
        if (!group) continue;
        if (field === "allow") group.allow.push(value);
        else group.disallow.push(value);
      }
    }

    const ourAgent = CRAWLER_USER_AGENT.toLowerCase();
    const specific = Array.from(groups.keys()).find(a => a !== "*" && ourAgent.includes(a));
    const group = groups.get(specific || "*");
    if (!group) {
      return { verdict: "allowed", detail: "robots.txt publishes no group applicable to this crawler." };
    }

    const match = (rule: string): number => {
      if (rule === "") return -1; // An empty Disallow imposes nothing.
      // Only the `*` wildcard and `$` anchor are honoured, per RFC 9309.
      const pattern = rule
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\\\$$/, "$");
      try {
        return new RegExp(`^${pattern}`).test(path) ? rule.length : -1;
      } catch {
        return -1;
      }
    };

    const bestAllow = Math.max(-1, ...group.allow.map(match));
    const bestDisallow = Math.max(-1, ...group.disallow.map(match));

    if (bestDisallow > bestAllow) {
      return {
        verdict: "disallowed",
        detail: `robots.txt explicitly disallows "${path}" for ${specific ? `"${specific}"` : "all crawlers"}.`
      };
    }
    return { verdict: "allowed", detail: `robots.txt permits "${path}".` };
  }

  /** Counts occurrences of a tag in the returned markup. */
  private countTag(html: string, tag: string): number {
    const matches = html.match(new RegExp(`<${tag}\\b`, "gi"));
    return matches ? matches.length : 0;
  }

  /** Extracts the src/href URLs of a resource tag. */
  private extractResourceUrls(html: string, pattern: RegExp): string[] {
    const found: string[] = [];
    let match: RegExpExecArray | null;
    const re = new RegExp(pattern.source, "gi");
    while ((match = re.exec(html)) !== null) {
      if (match[1]) found.push(match[1]);
    }
    return found;
  }

  /**
   * Reads page metadata out of the markup. Every value returned is text that
   * literally appears in a tag; nothing is derived.
   */
  private extractMetadata(html: string, serviceMetadata?: Record<string, unknown>): PageMetadata {
    const meta: PageMetadata = {};

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch?.[1]?.trim()) meta.title = this.truncate(titleMatch[1]);

    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
    if (descMatch?.[1]?.trim()) meta.description = this.truncate(descMatch[1]);

    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
    if (canonicalMatch?.[1]?.trim()) meta.canonicalUrl = this.truncate(canonicalMatch[1]);

    const langMatch = html.match(/<html[^>]+lang=["']([^"']*)["']/i);
    if (langMatch?.[1]?.trim()) meta.language = this.truncate(langMatch[1]);

    const generatorMatch = html.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']*)["']/i);
    if (generatorMatch?.[1]?.trim()) meta.generator = this.truncate(generatorMatch[1]);

    // The service may supply metadata of its own; it fills gaps only, and
    // never overrides something read directly from the markup.
    if (serviceMetadata && typeof serviceMetadata === "object") {
      const pick = (key: string): string | undefined => {
        const value = serviceMetadata[key];
        return typeof value === "string" && value.trim() ? this.truncate(value) : undefined;
      };
      meta.title = meta.title ?? pick("title");
      meta.description = meta.description ?? pick("description");
      meta.language = meta.language ?? pick("language");
    }

    return meta;
  }

  /**
   * Reads technology indicators that appear verbatim in the markup. This is
   * deliberately a narrow set - the Technology Fingerprinting connector owns
   * technology detection, and this reports only what the crawled page itself
   * exposes, tagged with the exact text it was read from.
   */
  private extractTechnologyIndicators(html: string, metadata: PageMetadata): TechnologyIndicator[] {
    const indicators: TechnologyIndicator[] = [];

    if (metadata.generator) {
      indicators.push({
        indicator: metadata.generator,
        source: "<meta name=\"generator\"> tag",
        evidenceValue: metadata.generator
      });
    }

    // Framework markers that are unambiguous attributes or globals in the
    // markup, not prose mentions.
    const markers: { pattern: RegExp; indicator: string; source: string }[] = [
      { pattern: /<div[^>]+id=["']__next["']/i, indicator: "Next.js", source: "#__next mount point" },
      { pattern: /<script[^>]+id=["']__NEXT_DATA__["']/i, indicator: "Next.js", source: "__NEXT_DATA__ script" },
      { pattern: /<div[^>]+id=["']___gatsby["']/i, indicator: "Gatsby", source: "#___gatsby mount point" },
      { pattern: /<div[^>]+id=["']app["'][^>]*data-v-app/i, indicator: "Vue", source: "data-v-app attribute" },
      { pattern: /\bng-version=["'][^"']+["']/i, indicator: "Angular", source: "ng-version attribute" },
      { pattern: /<[^>]+data-reactroot/i, indicator: "React", source: "data-reactroot attribute" },
      { pattern: /\/wp-content\//i, indicator: "WordPress", source: "/wp-content/ asset path" },
      { pattern: /\/wp-includes\//i, indicator: "WordPress", source: "/wp-includes/ asset path" },
      { pattern: /\/sites\/default\/files\//i, indicator: "Drupal", source: "Drupal asset path" },
      { pattern: /cdn\.shopify\.com/i, indicator: "Shopify", source: "cdn.shopify.com asset host" },
      { pattern: /\.cloudfront\.net/i, indicator: "Amazon CloudFront", source: "cloudfront.net asset host" },
      { pattern: /cdn\.jsdelivr\.net/i, indicator: "jsDelivr CDN", source: "jsdelivr.net asset host" },
      { pattern: /cdnjs\.cloudflare\.com/i, indicator: "Cloudflare CDN", source: "cdnjs.cloudflare.com asset host" }
    ];

    for (const marker of markers) {
      const found = html.match(marker.pattern);
      if (!found) continue;
      if (indicators.some(i => i.indicator === marker.indicator && i.source === marker.source)) continue;
      indicators.push({
        indicator: marker.indicator,
        source: marker.source,
        evidenceValue: this.truncate(found[0], 120)
      });
    }

    return indicators.slice(0, MAX_TECH_INDICATORS);
  }

  /** Reads forms out of the markup. Nothing is ever submitted or filled. */
  private extractForms(html: string): ObservedForm[] {
    const forms: ObservedForm[] = [];
    const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
    let match: RegExpExecArray | null;

    while ((match = formRe.exec(html)) !== null && forms.length < MAX_FORMS_REPORTED) {
      const attrs = match[1] || "";
      const inner = match[2] || "";

      const methodMatch = attrs.match(/method=["']([^"']*)["']/i);
      const actionMatch = attrs.match(/action=["']([^"']*)["']/i);

      const inputTypes: string[] = [];
      const inputRe = /<input\b[^>]*type=["']([^"']*)["']/gi;
      let inputMatch: RegExpExecArray | null;
      while ((inputMatch = inputRe.exec(inner)) !== null) {
        const type = inputMatch[1].toLowerCase();
        if (!inputTypes.includes(type)) inputTypes.push(type);
      }

      forms.push({
        method: (methodMatch?.[1] || "get").toLowerCase(),
        action: actionMatch?.[1] ? this.truncate(actionMatch[1]) : undefined,
        inputTypes,
        inputCount: this.countTag(inner, "input")
      });
    }

    return forms;
  }

  /** Counts resources and classifies them as same-origin, external, insecure. */
  private countResources(html: string, pageUrl: string): { counts: ResourceCounts; scriptUrls: string[]; styleUrls: string[] } {
    const scriptUrls = this.extractResourceUrls(html, /<script\b[^>]*\bsrc=["']([^"']+)["']/);
    const styleUrls = this.extractResourceUrls(html, /<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["']/);
    const altStyleUrls = this.extractResourceUrls(html, /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']stylesheet["']/);
    const allStyles = Array.from(new Set([...styleUrls, ...altStyleUrls]));
    const imageUrls = this.extractResourceUrls(html, /<img\b[^>]*\bsrc=["']([^"']+)["']/);

    let origin: string | null = null;
    try {
      origin = new URL(pageUrl).origin;
    } catch {
      origin = null;
    }

    const allResources = [...scriptUrls, ...allStyles, ...imageUrls];
    let external = 0;
    let insecure = 0;

    for (const resource of allResources) {
      // A protocol-relative or absolute http:// resource on an https page is
      // directly observable mixed content.
      if (/^http:\/\//i.test(resource) && pageUrl.startsWith("https://")) insecure++;
      if (!origin) continue;
      if (/^https?:\/\//i.test(resource) && !resource.startsWith(origin)) external++;
    }

    return {
      counts: {
        scripts: this.countTag(html, "script"),
        stylesheets: allStyles.length,
        images: this.countTag(html, "img"),
        iframes: this.countTag(html, "iframe"),
        externalResources: external,
        insecureResources: insecure
      },
      scriptUrls: scriptUrls.slice(0, MAX_RESOURCE_URLS),
      styleUrls: allStyles.slice(0, MAX_RESOURCE_URLS)
    };
  }

  /** Counts same-origin and external links. Neither set is ever followed. */
  private countLinks(html: string, pageUrl: string, serviceLinks?: { internal?: unknown[]; external?: unknown[] }) {
    // Prefer the service's own classification when it provides one.
    if (serviceLinks && (Array.isArray(serviceLinks.internal) || Array.isArray(serviceLinks.external))) {
      return {
        sameOrigin: Array.isArray(serviceLinks.internal) ? serviceLinks.internal.length : 0,
        external: Array.isArray(serviceLinks.external) ? serviceLinks.external.length : 0,
        classifiedBy: "crawler"
      };
    }

    const hrefs = this.extractResourceUrls(html, /<a\b[^>]*\bhref=["']([^"']+)["']/);
    let origin: string | null = null;
    try {
      origin = new URL(pageUrl).origin;
    } catch {
      origin = null;
    }

    let sameOrigin = 0;
    let external = 0;
    for (const href of hrefs) {
      if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
      if (/^https?:\/\//i.test(href)) {
        if (origin && href.startsWith(origin)) sameOrigin++;
        else external++;
      } else {
        sameOrigin++;
      }
    }

    return { sameOrigin, external, classifiedBy: "markup" };
  }

  public async run(query: InvestigationQuery): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const domain = this.extractDomain(query.term || "");
    const startedAt = Date.now();

    if (
      !domain ||
      this.isIpAddress(domain) ||
      query.type === "Organization" ||
      query.type === "Person" ||
      query.type === "IPAddress" ||
      !this.looksLikeDomain(domain)
    ) {
      return this.buildNoDataResult(timestamp, 0, "Web footprint crawl skipped: target is not a domain.", {
        configured: !!this.getServiceUrl()
      });
    }

    // Not configured: say so and make no request, exactly as the Shodan
    // connector does. No fallback crawler is ever substituted.
    const serviceUrl = this.getServiceUrl();
    if (!serviceUrl) {
      return this.buildNoDataResult(
        timestamp,
        Date.now() - startedAt,
        "Web Footprint is not configured: CRAWL4AI_URL is not set, so no crawl was performed. " +
          "This says nothing about the target's actual web footprint.",
        { configured: false }
      );
    }

    const cacheKey = domain;
    const cached = Crawl4AiWebFootprintConnector.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.getCacheTtl()) {
      console.log(`[WebFootprint Cache] Serving cached result for ${domain}`);
      return { ...cached.result, timestamp };
    }

    const timeoutMs = this.getTimeoutMs();
    const targetUrl = `https://${domain}/`;
    // Everything user-visible uses the redacted form; `serviceUrl` itself is
    // only ever used to build the outbound request.
    const safeServiceUrl = this.redactServiceUrl(serviceUrl);

    // ---- Step 1: prove the target is public BEFORE handing it over -----
    // The Crawl4AI service performs the fetch, so this check has to happen
    // here; the service will not apply our block list for us.
    try {
      await assertPublicHostname(domain);
    } catch (err: any) {
      return this.buildNoDataResult(
        timestamp,
        Date.now() - startedAt,
        `Web footprint crawl refused: ${err?.message || "the target is not a public host"}.`,
        { configured: true, blockedByGuard: true }
      );
    }

    // ---- Step 2: robots.txt --------------------------------------------
    const robots = await this.checkRobots(domain, "/", timeoutMs);

    if (robots.verdict === "disallowed") {
      const result = this.buildNoDataResult(timestamp, Date.now() - startedAt, robots.detail, {
        configured: true,
        robotsAllowed: false
      });
      Crawl4AiWebFootprintConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    if (robots.verdict === "inconclusive") {
      // Permission was never established, so the page is not crawled. This
      // is an infrastructure failure, not an absence of footprint.
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        `${robots.detail} The page was not crawled, because crawl permission could not be established.`,
        { configured: true, robotsAllowed: null }
      );
    }

    // ---- Step 3: crawl exactly one page --------------------------------
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      // The service endpoint is operator infrastructure (commonly a private
      // sidecar), so it is reached with a plain fetch rather than safeFetch,
      // which would reject that private address. It is validated as an
      // http/https URL above and never derived from investigation input.
      const { requestUrl, authHeader } = this.buildServiceRequest(serviceUrl);
      response = await fetch(`${requestUrl}/crawl`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": CRAWLER_USER_AGENT,
          ...(authHeader ? { Authorization: authHeader } : {})
        },
        body: JSON.stringify({
          // Exactly one URL. `deep_crawl_strategy` is never sent - it is on
          // Crawl4AI's forbidden-for-untrusted list anyway - so the service
          // performs a single page load and cannot wander.
          urls: [targetUrl],
          crawler_config: {
            // Every key below is on Crawl4AI's CrawlerRunConfig allowlist for
            // untrusted requests, so each one actually takes effect. Keys
            // outside that allowlist are silently dropped server-side, so
            // none are sent.
            exclude_external_links: true,
            check_robots_txt: true,
            user_agent: CRAWLER_USER_AGENT
          }
        })
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isTimeout = err?.name === "AbortError" || /abort/i.test(err?.message || "");
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        isTimeout
          ? `The Crawl4AI service at ${safeServiceUrl} timed out after ${timeoutMs}ms.`
          : `The Crawl4AI service at ${safeServiceUrl} is unreachable: ` +
            `${this.sanitizeMessage(err?.message || "network error", serviceUrl)}.`,
        { configured: true, robotsAllowed: true }
      );
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      // Crawl4AI can be deployed with an api_token or JWT gate. Say so
      // plainly rather than leaving an operator guessing at a bare 401.
      const message =
        response.status === 401 || response.status === 403
          ? `The Crawl4AI service at ${safeServiceUrl} rejected the request (HTTP ${response.status}). ` +
            `The service appears to require authentication, which this connector does not send.`
          : `The Crawl4AI service returned HTTP ${response.status} for ${targetUrl}.`;
      return this.buildErrorResult(timestamp, Date.now() - startedAt, message, {
        configured: true,
        httpStatus: response.status,
        robotsAllowed: true
      });
    }

    let text: string;
    try {
      text = await response.text();
    } catch (err: any) {
      return this.buildErrorResult(timestamp, Date.now() - startedAt, `Could not read the Crawl4AI response: ${err?.message}.`, {
        configured: true
      });
    }

    if (text.length > MAX_RESPONSE_BYTES) {
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        `The Crawl4AI response exceeded the ${MAX_RESPONSE_BYTES}-byte limit.`,
        { configured: true }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        "The Crawl4AI service returned a malformed (non-JSON) response.",
        { configured: true }
      );
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        "The Crawl4AI service returned an unexpected payload shape.",
        { configured: true }
      );
    }

    const body = parsed as Crawl4AiResponse;
    const results = Array.isArray(body.results) ? body.results : [];

    if (body.success === false && results.length === 0) {
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        `The Crawl4AI service reported a failure: ${this.truncate(body.error || body.detail || "no detail given")}.`,
        { configured: true }
      );
    }

    if (results.length === 0) {
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        "The Crawl4AI service returned no crawl result for the target.",
        { configured: true }
      );
    }

    // v1 is one page. If the service ignored the cap, only the first result
    // is read - nothing else is reported on.
    const page = results[0];

    if (page.success === false) {
      return this.buildErrorResult(
        timestamp,
        Date.now() - startedAt,
        `The crawl of ${targetUrl} failed: ${this.truncate(page.error_message || "no detail given")}.`,
        { configured: true, httpStatus: page.status_code }
      );
    }

    // `redirected_url` is where the crawl actually ended; `url` may still be
    // the URL originally requested. The SSRF re-check below must run against
    // the real destination, so the redirect field wins when present.
    const finalUrl =
      (typeof page.redirected_url === "string" && page.redirected_url ? page.redirected_url : "") ||
      (typeof page.url === "string" && page.url ? page.url : targetUrl);

    // ---- Step 4: re-check where the crawl actually ended ----------------
    // The service follows redirects; if it landed on a private host, the
    // page contents describe internal infrastructure and are not reported.
    try {
      const finalHost = new URL(finalUrl).hostname;
      await assertPublicHostname(finalHost);
    } catch (err: any) {
      return this.buildNoDataResult(
        timestamp,
        Date.now() - startedAt,
        `Web footprint discarded: the crawl of ${targetUrl} ended at ${finalUrl}, which is not a public host ` +
          `(${err?.message || "blocked by the SSRF guard"}).`,
        { configured: true, blockedByGuard: true, robotsAllowed: true }
      );
    }

    const html = typeof page.html === "string" && page.html ? page.html : typeof page.cleaned_html === "string" ? page.cleaned_html : "";

    if (!html.trim()) {
      const result = this.buildNoDataResult(
        timestamp,
        Date.now() - startedAt,
        `The crawl of ${finalUrl} returned no page content, so no footprint could be described.`,
        { configured: true, robotsAllowed: true, httpStatus: page.status_code }
      );
      Crawl4AiWebFootprintConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    // ---- Step 5: read the footprint ------------------------------------
    const metadata = this.extractMetadata(html, page.metadata);
    const { counts, scriptUrls, styleUrls } = this.countResources(html, finalUrl);
    const links = this.countLinks(html, finalUrl, page.links);
    const forms = this.extractForms(html);
    const technologies = this.extractTechnologyIndicators(html, metadata);
    const detectionTimeMs = Date.now() - startedAt;

    const hasMetadata = !!(metadata.title || metadata.description || metadata.canonicalUrl || metadata.language);
    const hasResources = counts.scripts > 0 || counts.stylesheets > 0 || counts.images > 0 || counts.iframes > 0;

    const diagnostics = {
      detectionTimeMs,
      source: "Crawl4AI service",
      serviceUrl: safeServiceUrl,
      target: domain,
      requestedUrl: targetUrl,
      finalUrl,
      redirected: finalUrl !== targetUrl,
      httpStatus: typeof page.status_code === "number" ? page.status_code : undefined,
      pagesCrawled: 1,
      maxDepth: MAX_DEPTH,
      maxPages: MAX_PAGES,
      robotsAllowed: true,
      robotsDetail: robots.detail,
      https: finalUrl.startsWith("https://"),
      resourcesObserved: counts.scripts + counts.stylesheets + counts.images + counts.iframes,
      sameOriginLinks: links.sameOrigin,
      externalLinks: links.external,
      linksClassifiedBy: links.classifiedBy,
      linksFollowed: 0,
      formCount: forms.length,
      technologyIndicators: technologies.length,
      // No vulnerability or CVE claim is ever derived from a crawled page.
      vulnerabilitiesReported: false
    };

    // A page that yielded nothing describable is an absence, not a failure.
    if (!hasMetadata && !hasResources && forms.length === 0 && links.sameOrigin === 0 && technologies.length === 0) {
      const result = this.buildNoDataResult(
        timestamp,
        detectionTimeMs,
        `The crawl of ${finalUrl} succeeded but the page exhibits no reportable footprint.`,
        { configured: true, robotsAllowed: true, httpStatus: page.status_code }
      );
      Crawl4AiWebFootprintConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    const evidences: Evidence[] = [];
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    if (hasMetadata) {
      evidences.push({
        id: "ev_footprint_metadata",
        connector: this.name,
        title: "Page Metadata",
        description:
          `${finalUrl} declares` +
          `${metadata.title ? ` the title "${metadata.title}"` : ""}` +
          `${metadata.language ? `, language "${metadata.language}"` : ""}` +
          `${metadata.canonicalUrl ? `, canonical URL ${metadata.canonicalUrl}` : ""}` +
          `${metadata.description ? `, and a meta description` : ""}. ` +
          `Each value is the literal text of the corresponding tag in the crawled page.`,
        confidence: CONFIDENCE_METADATA,
        timestamp,
        rawData: { ...metadata, finalUrl, diagnostics },
        verified: true,
        source: finalUrl,
        strength: CONFIDENCE_METADATA / 100,
        url: finalUrl
      });
    }

    if (hasResources || links.sameOrigin > 0) {
      evidences.push({
        id: "ev_footprint_resources",
        connector: this.name,
        title: "Page Resources & Links",
        description:
          `${finalUrl} loads ${counts.scripts} script${counts.scripts === 1 ? "" : "s"}, ` +
          `${counts.stylesheets} stylesheet${counts.stylesheets === 1 ? "" : "s"}, ` +
          `${counts.images} image${counts.images === 1 ? "" : "s"} and ` +
          `${counts.iframes} iframe${counts.iframes === 1 ? "" : "s"}, of which ` +
          `${counts.externalResources} are loaded from another origin. ` +
          `It carries ${links.sameOrigin} same-origin link${links.sameOrigin === 1 ? "" : "s"} and ` +
          `${links.external} external link${links.external === 1 ? "" : "s"}; none were followed.`,
        confidence: CONFIDENCE_RESOURCES,
        timestamp,
        rawData: {
          counts,
          sameOriginLinks: links.sameOrigin,
          externalLinks: links.external,
          linksFollowed: 0,
          scriptUrls,
          styleUrls,
          diagnostics
        },
        verified: true,
        source: finalUrl,
        strength: CONFIDENCE_RESOURCES / 100,
        url: finalUrl
      });
    }

    if (forms.length > 0) {
      evidences.push({
        id: "ev_footprint_forms",
        connector: this.name,
        title: "Forms Present on the Page",
        description:
          `${finalUrl} presents ${forms.length} form${forms.length === 1 ? "" : "s"}: ` +
          forms
            .map(f => `${f.method.toUpperCase()} to ${f.action || "the current URL"} with ${f.inputCount} input${f.inputCount === 1 ? "" : "s"}` +
              `${f.inputTypes.length > 0 ? ` (${f.inputTypes.join(", ")})` : ""}`)
            .join("; ") +
          `. Only the form structure is described - no form was submitted and no field value was read.`,
        confidence: CONFIDENCE_FORMS,
        timestamp,
        rawData: { forms, formsSubmitted: 0, diagnostics },
        verified: true,
        source: finalUrl,
        strength: CONFIDENCE_FORMS / 100,
        url: finalUrl
      });
    }

    if (technologies.length > 0) {
      evidences.push({
        id: "ev_footprint_technology",
        connector: this.name,
        title: "Technology Indicators in Page Markup",
        description:
          `The crawled markup of ${finalUrl} contains ${technologies.length} technology ` +
          `indicator${technologies.length === 1 ? "" : "s"}: ` +
          technologies.map(t => `${t.indicator} (${t.source})`).join("; ") +
          `. Each indicator carries the exact markup it was read from. This describes what the crawled page ` +
          `exposes; the Technology Fingerprinting connector remains the authority on technology detection.`,
        confidence: CONFIDENCE_TECH,
        timestamp,
        rawData: { technologies, diagnostics },
        verified: true,
        source: finalUrl,
        strength: CONFIDENCE_TECH / 100,
        url: finalUrl
      });
    }

    if (links.sameOrigin > 0 || links.external > 0) {
      evidences.push({
        id: "ev_footprint_links",
        connector: this.name,
        title: "Discovered Links (Counted, Not Followed)",
        description:
          `${links.sameOrigin} same-origin and ${links.external} external link${links.external === 1 ? "" : "s"} appear on ` +
          `${finalUrl}. This connector crawls a single page at depth 0: discovered links are counted and never fetched, ` +
          `and no subdomain or external host is expanded.`,
        confidence: CONFIDENCE_LINKS,
        timestamp,
        rawData: {
          sameOriginLinks: links.sameOrigin,
          externalLinks: links.external,
          classifiedBy: links.classifiedBy,
          linksFollowed: 0,
          maxDepth: MAX_DEPTH,
          maxPages: MAX_PAGES,
          diagnostics
        },
        verified: true,
        source: finalUrl,
        strength: CONFIDENCE_LINKS / 100,
        url: finalUrl
      });
    }

    const evidenceIds = evidences.map(e => e.id);

    entities.push({
      id: `ent_footprint_domain_${domain.replace(/[^a-zA-Z0-9]/g, "_")}`,
      name: domain,
      type: "Domain",
      metadata: {
        resolver: this.name,
        pageTitle: metadata.title,
        language: metadata.language,
        canonicalUrl: metadata.canonicalUrl,
        sameOriginLinks: links.sameOrigin,
        formCount: forms.length,
        https: finalUrl.startsWith("https://")
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
        target: domain,
        finalUrl,
        detectionTimeMs,
        metadata,
        counts,
        links: { sameOrigin: links.sameOrigin, external: links.external },
        forms,
        technologies,
        diagnostics
      }
    };

    Crawl4AiWebFootprintConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
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
      // The pipeline carries `error` into connectorStatuses, and the reason a
      // footprint is absent matters - "not configured" in particular must
      // never be read as "this site has no web presence". Matches the
      // ShodanConnector and DnsConnector pattern.
      error: info,
      rawData: {
        detectionTimeMs,
        pagesCrawled: 0,
        info,
        diagnostics: { detectionTimeMs, source: "Crawl4AI service", pagesCrawled: 0, info, ...extra }
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
        pagesCrawled: 0,
        diagnostics: { detectionTimeMs, source: "Crawl4AI service", pagesCrawled: 0, error: message, ...extra }
      }
    };
  }
}
