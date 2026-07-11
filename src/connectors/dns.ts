import { Connector, ConnectorResult, Entity, Relationship, TimelineEvent, Evidence, InvestigationQuery } from "../types";

/**
 * DNS Infrastructure Name Service Connector
 * 
 * Simulates high-precision DNS recursive queries to find A, AAAA, MX,
 * NS, and TXT verification keys. Helps locate cloud hosting endpoints.
 */
export class DnsConnector implements Connector {
  public name = "Domain Name System Resolver";

  public async run(query: InvestigationQuery): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const searchTerm = query.term;
    const queryLower = searchTerm.toLowerCase();

    const entities: Entity[] = [];
    const relationships: Relationship[] = [];
    const timeline: TimelineEvent[] = [];
    const evidences: Evidence[] = [];
    const sources: string[] = [];

    const isDomain = query.type === "Domain" || (queryLower.includes(".") && !queryLower.includes(" "));
    const domain = isDomain ? searchTerm.replace(/(^\w+:|^)\/\//, "").split("/")[0] : "sentinel-gateway.net";

    // 1. Core target domain entity
    entities.push({
      id: "ent_dns_domain",
      name: domain,
      type: "Domain",
      metadata: {
        nameservers: ["ns1.cloudflare.com", "ns2.cloudflare.com"],
        dnssec: "unsigned",
      },
      evidenceIds: ["ev_dns_a_record", "ev_dns_mx_record"]
    });

    // 2. IP Address A records
    const simulatedIp = isDomain && queryLower.includes("google") ? "142.250.190.46" : "104.21.43.112";
    entities.push({
      id: "ent_dns_ip",
      name: simulatedIp,
      type: "IPAddress",
      metadata: {
        provider: "Cloudflare, Inc.",
        asn: "AS13335",
        geo: "US / California",
      },
      evidenceIds: ["ev_dns_a_record"]
    });

    // 3. Mail servers MX records
    const simulatedMx = `mail.protection.outlook.com`;
    entities.push({
      id: "ent_dns_mx",
      name: simulatedMx,
      type: "Domain",
      metadata: {
        provider: "Microsoft Office 365",
        priority: 10,
      },
      evidenceIds: ["ev_dns_mx_record"]
    });

    // Relationships
    relationships.push({
      source: "ent_dns_domain",
      target: "ent_dns_ip",
      type: "RESOLVES_TO",
      metadata: { recordType: "A", ttl: 300 },
      evidenceIds: ["ev_dns_a_record"]
    });

    relationships.push({
      source: "ent_dns_domain",
      target: "ent_dns_mx",
      type: "RESOLVES_TO",
      metadata: { recordType: "MX", ttl: 3600 },
      evidenceIds: ["ev_dns_mx_record"]
    });

    timeline.push({
      date: "2023-11-15",
      event: "Zone Routing Configuration",
      description: `Migrated zone management and nameservers to Cloudflare.`,
      source: "DNS AXFR Sync log"
    });

    evidences.push({
      id: "ev_dns_a_record",
      connector: this.name,
      title: "DNS A Record Resolution",
      description: `Discovered active A-record mapping ${domain} to secure server node ${simulatedIp}.`,
      confidence: 95,
      timestamp,
      rawData: {
        A: [simulatedIp],
        AAAA: ["2606:4700:3030::6815:2b70"],
      },
      source: "Cloudflare Nameservers",
      strength: 0.95,
      url: `https://dns.google/resolve?name=${domain}`
    });

    evidences.push({
      id: "ev_dns_mx_record",
      connector: this.name,
      title: "DNS MX Record Alignment",
      description: `Discovered corporate mail server alignment routing through Microsoft Office 365.`,
      confidence: 85,
      timestamp,
      rawData: {
        MX: [`10 ${simulatedMx}`],
      },
      source: "Office 365 Routing",
      strength: 0.85,
      url: `https://dns.google/resolve?name=${domain}`
    });

    sources.push(`dns:${domain}?type=ANY`);
    sources.push(`https://dns.google/resolve?name=${domain}`);

    return {
      connectorName: this.name,
      success: true,
      timestamp,
      entities,
      relationships,
      timeline,
      evidences,
      sources,
      rawData: {
        A: [simulatedIp],
        AAAA: ["2606:4700:3030::6815:2b70"],
        MX: [`10 ${simulatedMx}`],
        TXT: ["v=spf1 include:_spf.google.com ~all", "google-site-verification=SentinelGateway824"],
        NS: ["ns1.cloudflare.com", "ns2.cloudflare.com"]
      }
    };
  }
}
