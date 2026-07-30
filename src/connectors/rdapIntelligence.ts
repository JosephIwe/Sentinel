import { Connector, ConnectorResult, Entity, Evidence, InvestigationQuery, Relationship } from "../types";
import { safeFetch } from "../utils/ssrfGuard";

interface CacheEntry {
  result: ConnectorResult;
  timestamp: number;
}

/**
 * The IANA RDAP bootstrap file for DNS (RFC 7484). `services` is a list of
 * [ [tld, ...], [rdapBaseUrl, ...] ] pairs.
 */
interface RdapBootstrap {
  version?: string;
  publication?: string;
  services?: string[][][];
}

/** An RDAP event object (RFC 9083 §4.5). */
interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
  eventActor?: string;
}

/** An RDAP entity object (RFC 9083 §5.1). */
interface RdapEntity {
  handle?: string;
  roles?: string[];
  vcardArray?: any[];
  publicIds?: { type?: string; identifier?: string }[];
  entities?: RdapEntity[];
}

/** An RDAP nameserver object (RFC 9083 §5.2). */
interface RdapNameserver {
  ldhName?: string;
  unicodeName?: string;
  ipAddresses?: { v4?: string[]; v6?: string[] };
}

/** An RDAP domain response (RFC 9083 §5.3). */
interface RdapDomainResponse {
  objectClassName?: string;
  handle?: string;
  ldhName?: string;
  unicodeName?: string;
  status?: string[];
  events?: RdapEvent[];
  entities?: RdapEntity[];
  nameservers?: RdapNameserver[];
  secureDNS?: {
    zoneSigned?: boolean;
    delegationSigned?: boolean;
    dsData?: { keyTag?: number; algorithm?: number; digestType?: number; digest?: string }[];
    keyData?: unknown[];
  };
  links?: { rel?: string; href?: string; type?: string }[];
  port43?: string;
  notices?: { title?: string; description?: string[] }[];
}

/** A contact flattened out of an RDAP entity's jCard. */
interface RdapContact {
  role: string;
  handle?: string;
  name?: string;
  organization?: string;
  email?: string;
  phone?: string;
}

const MAX_VALUE_LENGTH = 200;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_NAMESERVERS = 25;
const MAX_EVENTS = 25;

// Confidence tiers. RDAP is the registry's own authoritative record served
// as structured JSON, so transcribed facts rank very high. Contact details
// rank slightly lower only because registries routinely redact them, so an
// absent contact says nothing about the real one.
const CONFIDENCE_REGISTRATION = 97;
const CONFIDENCE_EVENTS = 96;
const CONFIDENCE_NAMESERVERS = 95;
const CONFIDENCE_DNSSEC = 95;
const CONFIDENCE_CONTACTS = 90;

/** RDAP event actions mapped to the report's plain-language field names. */
const EVENT_CREATION = "registration";
const EVENT_UPDATED = "last changed";
const EVENT_EXPIRATION = "expiration";

/**
 * RDAP Intelligence Connector
 *
 * Queries the authoritative Registration Data Access Protocol service for
 * the target domain and reports only what the registry's own response
 * literally contains: registrar, registry handle, registration statuses,
 * registration/update/expiry events, abuse and (where published) technical
 * and administrative contacts, delegated nameservers, and DNSSEC state.
 *
 * The authoritative server is discovered through the IANA RDAP bootstrap
 * registry (RFC 7484) rather than guessed, so the reported RDAP source is
 * always the service the TLD actually delegates to. Responses are read per
 * RFC 9083; no field is synthesised and no value is carried over from any
 * other connector.
 *
 * Registries redact contact data extensively under GDPR. A redacted or
 * absent contact is simply not reported - it is never filled in from
 * another source, and its absence is never presented as a finding about
 * the registrant.
 *
 * Status semantics:
 *   - A TLD with no RDAP service published in the bootstrap file, or an
 *     authoritative 404, is NO_DATA - the registry answered, and there is
 *     no record.
 *   - Any failure to reach or parse the bootstrap file or the RDAP service
 *     is ERROR, never a false "this domain has no registration record".
 */
export class RdapIntelligenceConnector implements Connector {
  public name = "RDAP Intelligence";

  private static cache = new Map<string, CacheEntry>();
  private static bootstrapCache: { services: string[][][]; timestamp: number } | null = null;

  /**
   * Configurable cache duration (TTL) in milliseconds.
   * Defaults to 3600000 (1 hour) - registration records change slowly.
   */
  private getCacheTtl(): number {
    const envTtl = process.env.RDAP_CACHE_TTL_MS;
    if (envTtl) {
      const parsed = parseInt(envTtl, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 60 * 60 * 1000;
  }

  /**
   * Configurable per-request timeout in milliseconds. Defaults to 4000 -
   * deliberately below the orchestrator's 5000ms per-connector default so
   * this connector's own descriptive ERROR wins the race rather than being
   * surfaced as a generic outer TIMEOUT.
   */
  private getRequestTimeoutMs(): number {
    const envTimeout = process.env.RDAP_TIMEOUT_MS;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 4000;
  }

  /** The IANA RDAP bootstrap file for DNS, overridable for mirrors. */
  private getBootstrapUrl(): string {
    return process.env.RDAP_BOOTSTRAP_URL || "https://data.iana.org/rdap/dns.json";
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
    return cleaned.replace(/\.$/, "").trim();
  }

  private truncate(value: string): string {
    const collapsed = String(value).replace(/\s+/g, " ").trim();
    return collapsed.length > MAX_VALUE_LENGTH
      ? `${collapsed.slice(0, MAX_VALUE_LENGTH)}…`
      : collapsed;
  }

  /**
   * Performs a JSON fetch with a hard timeout, returning a discriminated
   * outcome so callers can tell an authoritative 404 from a transport
   * failure without inspecting exceptions.
   */
  private async fetchJson(
    url: string,
    timeoutMs: number
  ): Promise<
    | { outcome: "ok"; body: unknown; httpStatus: number }
    | { outcome: "notFound"; httpStatus: number }
    | { outcome: "failed"; message: string; httpStatus?: number }
  > {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await safeFetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Sentinel-RDAP-Connector/1.0",
          Accept: "application/rdap+json, application/json"
        }
      });
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isTimeout = err?.name === "AbortError" || /abort/i.test(err?.message || "");
      return {
        outcome: "failed",
        message: isTimeout
          ? `Timed out after ${timeoutMs}ms querying ${url}.`
          : `Could not reach ${url}: ${err?.message || "network error"}.`
      };
    }
    clearTimeout(timeoutId);

    // RFC 9083: 404 is the registry's authoritative "no such object".
    if (res.status === 404) {
      return { outcome: "notFound", httpStatus: 404 };
    }

    if (!res.ok) {
      return {
        outcome: "failed",
        message: `${url} returned HTTP ${res.status}.`,
        httpStatus: res.status
      };
    }

    let text: string;
    try {
      text = await res.text();
    } catch (err: any) {
      return {
        outcome: "failed",
        message: `Could not read the response body from ${url}: ${err?.message || "unknown error"}.`,
        httpStatus: res.status
      };
    }

    if (text.length > MAX_RESPONSE_BYTES) {
      return {
        outcome: "failed",
        message: `Response from ${url} exceeded the ${MAX_RESPONSE_BYTES}-byte limit.`,
        httpStatus: res.status
      };
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return {
        outcome: "failed",
        message: `${url} returned an empty response.`,
        httpStatus: res.status
      };
    }

    try {
      return { outcome: "ok", body: JSON.parse(trimmed), httpStatus: res.status };
    } catch {
      return {
        outcome: "failed",
        message: `${url} returned a malformed (non-JSON) response.`,
        httpStatus: res.status
      };
    }
  }

  /**
   * Resolves the authoritative RDAP base URL for a TLD from the IANA
   * bootstrap registry. Returns null when the TLD publishes no RDAP
   * service, which is an absence rather than a failure.
   */
  private async resolveRdapBase(
    tld: string,
    timeoutMs: number
  ): Promise<
    | { outcome: "found"; baseUrl: string }
    | { outcome: "noService" }
    | { outcome: "failed"; message: string }
  > {
    const ttl = this.getCacheTtl();
    const cached = RdapIntelligenceConnector.bootstrapCache;

    let services: string[][][];
    if (cached && Date.now() - cached.timestamp < ttl) {
      services = cached.services;
    } else {
      const bootstrapUrl = this.getBootstrapUrl();
      const fetched = await this.fetchJson(bootstrapUrl, timeoutMs);

      if (fetched.outcome === "notFound") {
        return { outcome: "failed", message: `The RDAP bootstrap registry at ${bootstrapUrl} is unavailable (HTTP 404).` };
      }
      if (fetched.outcome === "failed") {
        return { outcome: "failed", message: fetched.message };
      }

      const bootstrap = fetched.body as RdapBootstrap;
      if (!bootstrap || !Array.isArray(bootstrap.services)) {
        return { outcome: "failed", message: `The RDAP bootstrap registry at ${bootstrapUrl} returned an unexpected payload shape.` };
      }

      services = bootstrap.services;
      RdapIntelligenceConnector.bootstrapCache = { services, timestamp: Date.now() };
    }

    for (const service of services) {
      const tlds = Array.isArray(service?.[0]) ? service[0] : [];
      const urls = Array.isArray(service?.[1]) ? service[1] : [];
      if (!tlds.some(entry => String(entry).toLowerCase() === tld)) continue;

      // Prefer an HTTPS endpoint; the SSRF guard rejects anything that is
      // not http/https anyway.
      const httpsUrl = urls.find(u => String(u).startsWith("https://")) || urls[0];
      if (!httpsUrl) continue;
      return { outcome: "found", baseUrl: String(httpsUrl).replace(/\/+$/, "") };
    }

    return { outcome: "noService" };
  }

  /**
   * Flattens a jCard (RFC 7095) property array into a plain lookup of the
   * properties this connector reports. Only values actually present are
   * returned; nothing is defaulted.
   */
  private parseVcard(vcardArray: any[] | undefined): { name?: string; organization?: string; email?: string; phone?: string } {
    const out: { name?: string; organization?: string; email?: string; phone?: string } = {};
    if (!Array.isArray(vcardArray) || vcardArray.length < 2) return out;

    const properties = vcardArray[1];
    if (!Array.isArray(properties)) return out;

    for (const property of properties) {
      if (!Array.isArray(property) || property.length < 4) continue;
      const key = String(property[0]).toLowerCase();
      const raw = property[3];
      // Structured values (e.g. `n`, `adr`) arrive as arrays; this connector
      // only reports the flat properties, so arrays are skipped rather than
      // stitched into a guessed string.
      if (typeof raw !== "string" || !raw.trim()) continue;
      const value = this.truncate(raw);

      if (key === "fn" && !out.name) out.name = value;
      else if (key === "org" && !out.organization) out.organization = value;
      else if (key === "email" && !out.email) out.email = value;
      else if (key === "tel" && !out.phone) out.phone = value.replace(/^tel:/i, "");
    }

    return out;
  }

  /**
   * Walks the RDAP entity tree and flattens every entity carrying one of
   * the requested roles. Registrar abuse contacts are normally nested one
   * level under the registrar entity, so the walk is recursive.
   */
  private collectContacts(entities: RdapEntity[] | undefined, wanted: string[], depth = 0): RdapContact[] {
    if (!Array.isArray(entities) || depth > 3) return [];

    const found: RdapContact[] = [];
    for (const entity of entities) {
      if (!entity || typeof entity !== "object") continue;

      const roles = Array.isArray(entity.roles) ? entity.roles.map(r => String(r).toLowerCase()) : [];
      for (const role of roles) {
        if (!wanted.includes(role)) continue;
        const card = this.parseVcard(entity.vcardArray);
        // An entity with a role but no publishable detail at all tells us
        // nothing, so it is dropped rather than reported as an empty contact.
        if (!card.name && !card.organization && !card.email && !card.phone && !entity.handle) continue;
        found.push({
          role,
          handle: entity.handle ? this.truncate(entity.handle) : undefined,
          ...card
        });
      }

      found.push(...this.collectContacts(entity.entities, wanted, depth + 1));
    }

    return found;
  }

  /** Returns the eventDate for a given RDAP event action, if published. */
  private findEventDate(events: RdapEvent[] | undefined, action: string): string | undefined {
    if (!Array.isArray(events)) return undefined;
    const match = events.find(e => String(e?.eventAction || "").toLowerCase() === action);
    return match?.eventDate ? String(match.eventDate) : undefined;
  }

  public async run(query: InvestigationQuery): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const domain = this.extractDomain(query.term || "");
    const startedAt = Date.now();
    const timeoutMs = this.getRequestTimeoutMs();

    // RDAP domain lookups apply to domains only. IP and AS lookups exist in
    // RDAP too, but they are a different object class and out of scope here.
    if (
      !domain ||
      this.isIpAddress(domain) ||
      query.type === "Organization" ||
      query.type === "Person" ||
      !this.looksLikeDomain(domain)
    ) {
      return this.buildNoDataResult(
        timestamp,
        undefined,
        undefined,
        0,
        "RDAP lookup skipped: target is not a domain."
      );
    }

    const cacheKey = domain;
    const ttl = this.getCacheTtl();
    const cached = RdapIntelligenceConnector.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttl) {
      console.log(`[RdapIntelligence Cache] Serving cached result for ${domain}`);
      return { ...cached.result, timestamp };
    }

    // ---- Step 1: discover the authoritative RDAP service ---------------
    const tld = domain.split(".").pop() || "";
    const bootstrap = await this.resolveRdapBase(tld, timeoutMs);

    if (bootstrap.outcome === "failed") {
      const message = `Could not determine the authoritative RDAP service for ".${tld}": ${bootstrap.message}`;
      console.warn(`[RdapIntelligence] ${message}`);
      return this.buildErrorResult(timestamp, this.getBootstrapUrl(), undefined, Date.now() - startedAt, message);
    }

    if (bootstrap.outcome === "noService") {
      const result = this.buildNoDataResult(
        timestamp,
        this.getBootstrapUrl(),
        undefined,
        Date.now() - startedAt,
        `The ".${tld}" registry publishes no RDAP service in the IANA bootstrap registry.`
      );
      RdapIntelligenceConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    // ---- Step 2: query the RDAP service --------------------------------
    const rdapUrl = `${bootstrap.baseUrl}/domain/${encodeURIComponent(domain)}`;
    const fetched = await this.fetchJson(rdapUrl, timeoutMs);

    if (fetched.outcome === "failed") {
      console.warn(`[RdapIntelligence] ${fetched.message}`);
      return this.buildErrorResult(timestamp, rdapUrl, fetched.httpStatus, Date.now() - startedAt, fetched.message);
    }

    if (fetched.outcome === "notFound") {
      // Authoritative: the registry answered and holds no such domain.
      const result = this.buildNoDataResult(
        timestamp,
        rdapUrl,
        404,
        Date.now() - startedAt,
        `The registry for ".${tld}" holds no registration record for "${domain}".`
      );
      RdapIntelligenceConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    const body = fetched.body as RdapDomainResponse;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      const message = `The RDAP service at ${rdapUrl} returned an unexpected payload shape.`;
      return this.buildErrorResult(timestamp, rdapUrl, fetched.httpStatus, Date.now() - startedAt, message);
    }

    // ---- Step 3: transcribe the response -------------------------------
    const statuses = Array.isArray(body.status) ? body.status.map(s => this.truncate(String(s))) : [];
    const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];

    const registrationEvents = events
      .filter(e => e?.eventAction && e?.eventDate)
      .map(e => ({
        action: this.truncate(String(e.eventAction)),
        date: String(e.eventDate),
        actor: e.eventActor ? this.truncate(String(e.eventActor)) : undefined
      }));

    const createdOn = this.findEventDate(events, EVENT_CREATION);
    const updatedOn = this.findEventDate(events, EVENT_UPDATED);
    const expiresOn = this.findEventDate(events, EVENT_EXPIRATION);

    const registrarEntities = this.collectContacts(body.entities, ["registrar"]);
    const registrar = registrarEntities[0];

    // The registrar's IANA ID, when published, is the registry's own
    // identifier for it - not a value this connector derives.
    let registrarIanaId: string | undefined;
    for (const entity of body.entities || []) {
      const roles = Array.isArray(entity?.roles) ? entity.roles.map(r => String(r).toLowerCase()) : [];
      if (!roles.includes("registrar")) continue;
      const publicId = (entity.publicIds || []).find(p => /iana/i.test(String(p?.type || "")));
      if (publicId?.identifier) registrarIanaId = this.truncate(String(publicId.identifier));
    }

    const abuseContacts = this.collectContacts(body.entities, ["abuse"]);
    const technicalContacts = this.collectContacts(body.entities, ["technical"]);
    const adminContacts = this.collectContacts(body.entities, ["administrative"]);

    const nameservers = (Array.isArray(body.nameservers) ? body.nameservers : [])
      .slice(0, MAX_NAMESERVERS)
      .map(ns => ({
        host: ns?.ldhName ? this.truncate(String(ns.ldhName)).toLowerCase() : undefined,
        ipv4: Array.isArray(ns?.ipAddresses?.v4) ? ns!.ipAddresses!.v4! : [],
        ipv6: Array.isArray(ns?.ipAddresses?.v6) ? ns!.ipAddresses!.v6! : []
      }))
      .filter(ns => !!ns.host);

    // RFC 9083: absence of secureDNS means the registry published nothing
    // about DNSSEC, which is not the same as "DNSSEC is off".
    const secureDns = body.secureDNS;
    const dnssecKnown = !!secureDns && typeof secureDns.delegationSigned === "boolean";
    const dnssecSigned = dnssecKnown ? !!secureDns!.delegationSigned : undefined;
    const dsRecordCount = Array.isArray(secureDns?.dsData) ? secureDns!.dsData!.length : 0;

    const selfLink = (body.links || []).find(l => String(l?.rel || "").toLowerCase() === "self")?.href;
    const registryHandle = body.handle ? this.truncate(String(body.handle)) : undefined;

    const detectionTimeMs = Date.now() - startedAt;

    const diagnostics = {
      detectionTimeMs,
      source: "RDAP (RFC 9083)",
      target: domain,
      tld,
      rdapBaseUrl: bootstrap.baseUrl,
      rdapUrl,
      rdapSource: selfLink ? this.truncate(String(selfLink)) : rdapUrl,
      httpStatus: fetched.httpStatus,
      bootstrapUrl: this.getBootstrapUrl(),
      port43: body.port43 ? this.truncate(String(body.port43)) : undefined,
      statusCount: statuses.length,
      eventCount: registrationEvents.length,
      nameserverCount: nameservers.length,
      abuseContactsPublished: abuseContacts.length,
      technicalContactsPublished: technicalContacts.length,
      administrativeContactsPublished: adminContacts.length,
      dnssecPublished: dnssecKnown
    };

    // ---- Step 4: evidence ----------------------------------------------
    const evidences: Evidence[] = [];
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    const hasRegistrationFacts = !!registrar || statuses.length > 0 || !!registryHandle;

    if (hasRegistrationFacts) {
      const registrarName = registrar?.organization || registrar?.name;
      evidences.push({
        id: "ev_rdap_registration",
        connector: this.name,
        title: "Domain Registration Record",
        description:
          `The registry for ".${tld}" holds a registration record for ${domain}` +
          `${registryHandle ? ` under handle ${registryHandle}` : ""}. ` +
          `${registrarName ? `The sponsoring registrar is ${registrarName}${registrarIanaId ? ` (IANA ID ${registrarIanaId})` : ""}. ` : ""}` +
          `${statuses.length > 0 ? `Registration status: ${statuses.join(", ")}.` : "The registry published no status codes."}`,
        confidence: CONFIDENCE_REGISTRATION,
        timestamp,
        rawData: {
          domain,
          registryHandle,
          registrar: registrarName,
          registrarHandle: registrar?.handle,
          registrarIanaId,
          statuses,
          registry: bootstrap.baseUrl,
          rdapSource: diagnostics.rdapSource,
          port43: diagnostics.port43,
          diagnostics
        },
        verified: true,
        source: diagnostics.rdapSource,
        strength: CONFIDENCE_REGISTRATION / 100,
        url: rdapUrl
      });
    }

    if (registrationEvents.length > 0) {
      const parts: string[] = [];
      if (createdOn) parts.push(`registered ${createdOn}`);
      if (updatedOn) parts.push(`last changed ${updatedOn}`);
      if (expiresOn) parts.push(`expires ${expiresOn}`);

      evidences.push({
        id: "ev_rdap_events",
        connector: this.name,
        title: "Registration Lifecycle Events",
        description:
          `The registry published ${registrationEvents.length} lifecycle event${registrationEvents.length === 1 ? "" : "s"} for ${domain}` +
          `${parts.length > 0 ? `: ${parts.join(", ")}` : ""}.`,
        confidence: CONFIDENCE_EVENTS,
        timestamp,
        rawData: {
          createdOn,
          updatedOn,
          expiresOn,
          events: registrationEvents,
          diagnostics
        },
        verified: true,
        source: diagnostics.rdapSource,
        strength: CONFIDENCE_EVENTS / 100,
        url: rdapUrl
      });
    }

    const allContacts = [...abuseContacts, ...technicalContacts, ...adminContacts];
    if (allContacts.length > 0) {
      const describe = (label: string, list: RdapContact[]) =>
        list.length > 0
          ? `${label}: ${list.map(c => c.email || c.phone || c.organization || c.name || c.handle).filter(Boolean).join(", ")}`
          : "";

      const summary = [
        describe("Abuse", abuseContacts),
        describe("Technical", technicalContacts),
        describe("Administrative", adminContacts)
      ]
        .filter(Boolean)
        .join(". ");

      evidences.push({
        id: "ev_rdap_contacts",
        connector: this.name,
        title: "Published Registration Contacts",
        description:
          `${summary}. Only contacts the registry publishes are shown; registries redact ` +
          `contact data extensively, so an absent role means nothing was published, ` +
          `not that no such contact exists.`,
        confidence: CONFIDENCE_CONTACTS,
        timestamp,
        rawData: {
          abuse: abuseContacts,
          technical: technicalContacts,
          administrative: adminContacts,
          diagnostics
        },
        verified: true,
        source: diagnostics.rdapSource,
        strength: CONFIDENCE_CONTACTS / 100,
        url: rdapUrl
      });
    }

    if (nameservers.length > 0) {
      evidences.push({
        id: "ev_rdap_nameservers",
        connector: this.name,
        title: "Delegated Nameservers",
        description:
          `The registry delegates ${domain} to ${nameservers.length} nameserver${nameservers.length === 1 ? "" : "s"}: ` +
          `${nameservers.map(ns => ns.host).join(", ")}.`,
        confidence: CONFIDENCE_NAMESERVERS,
        timestamp,
        rawData: { nameservers, diagnostics },
        verified: true,
        source: diagnostics.rdapSource,
        strength: CONFIDENCE_NAMESERVERS / 100,
        url: rdapUrl
      });
    }

    if (dnssecKnown) {
      evidences.push({
        id: "ev_rdap_dnssec",
        connector: this.name,
        title: "DNSSEC Delegation Status",
        description:
          `The registry reports that ${domain} is ${dnssecSigned ? "signed" : "not signed"} at the delegation` +
          `${dnssecSigned && dsRecordCount > 0 ? `, with ${dsRecordCount} DS record${dsRecordCount === 1 ? "" : "s"} published` : ""}.`,
        confidence: CONFIDENCE_DNSSEC,
        timestamp,
        rawData: {
          delegationSigned: dnssecSigned,
          zoneSigned: typeof secureDns?.zoneSigned === "boolean" ? secureDns.zoneSigned : undefined,
          dsRecordCount,
          diagnostics
        },
        verified: true,
        source: diagnostics.rdapSource,
        strength: CONFIDENCE_DNSSEC / 100,
        url: rdapUrl
      });
    }

    // A 200 response that carried none of the fields this connector reports
    // is a real answer with nothing in it.
    if (evidences.length === 0) {
      const result = this.buildNoDataResult(
        timestamp,
        rdapUrl,
        fetched.httpStatus,
        detectionTimeMs,
        `The RDAP service for ".${tld}" answered for "${domain}" but published no registration detail.`
      );
      RdapIntelligenceConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
      return result;
    }

    const evidenceIds = evidences.map(e => e.id);

    // ---- Step 5: entities & relationships ------------------------------
    // The domain entity uses the same `type` + `name` canonical key the DNS
    // connector uses, so the two merge into a single graph node.
    const domainEntityId = `ent_rdap_domain_${domain.replace(/[^a-zA-Z0-9]/g, "_")}`;
    entities.push({
      id: domainEntityId,
      name: domain,
      type: "Domain",
      metadata: {
        resolver: this.name,
        registryHandle,
        registrar: registrar?.organization || registrar?.name,
        statuses,
        createdOn,
        updatedOn,
        expiresOn,
        dnssecSigned
      },
      evidenceIds
    });

    const registrarName = registrar?.organization || registrar?.name;
    if (registrarName) {
      const registrarEntityId = `ent_rdap_registrar_${registrarName.replace(/[^a-zA-Z0-9]/g, "_")}`;
      entities.push({
        id: registrarEntityId,
        name: registrarName,
        type: "Organization",
        metadata: {
          role: "Sponsoring registrar",
          ianaId: registrarIanaId,
          handle: registrar?.handle
        },
        evidenceIds: ["ev_rdap_registration"]
      });
      relationships.push({
        source: domainEntityId,
        target: registrarEntityId,
        type: "REGISTERED_THROUGH",
        metadata: { ianaId: registrarIanaId },
        evidenceIds: ["ev_rdap_registration"]
      });
    }

    for (const nameserver of nameservers) {
      const nsEntityId = `ent_rdap_ns_${nameserver.host!.replace(/[^a-zA-Z0-9]/g, "_")}`;
      if (entities.some(e => e.id === nsEntityId)) continue;
      entities.push({
        id: nsEntityId,
        name: nameserver.host!,
        type: "Domain",
        metadata: {
          role: "Delegated nameserver (registry record)",
          ipv4: nameserver.ipv4,
          ipv6: nameserver.ipv6
        },
        evidenceIds: ["ev_rdap_nameservers"]
      });
      relationships.push({
        source: domainEntityId,
        target: nsEntityId,
        type: "DELEGATED_TO",
        metadata: { source: "RDAP registry record" },
        evidenceIds: ["ev_rdap_nameservers"]
      });
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
      sources: [rdapUrl],
      rawData: {
        domain,
        rdapUrl,
        httpStatus: fetched.httpStatus,
        detectionTimeMs,
        registrar: registrarName,
        statuses,
        createdOn,
        updatedOn,
        expiresOn,
        nameserverCount: nameservers.length,
        diagnostics
      }
    };

    RdapIntelligenceConnector.cache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
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
      rawData: {
        urlChecked,
        httpStatus,
        detectionTimeMs,
        recordFound: false,
        info
      }
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
      rawData: {
        urlChecked,
        httpStatus,
        detectionTimeMs,
        recordFound: false
      }
    };
  }
}
