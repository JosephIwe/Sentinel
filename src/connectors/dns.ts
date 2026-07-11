import { Connector, ConnectorResult, Entity, Relationship, TimelineEvent } from "../types";

/**
 * DNS Infrastructure Name Service Connector
 * 
 * Simulates high-precision DNS recursive queries to find A, AAAA, MX,
 * NS, and TXT verification keys. Helps locate cloud hosting endpoints.
 */
export class DnsConnector implements Connector {
  public name = "Domain Name System Resolver";

  public async run(query: string): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const queryLower = query.toLowerCase();

    const entities: Entity[] = [];
    const relationships: Relationship[] = [];
    const timeline: TimelineEvent[] = [];
    const sources: string[] = [];

    const isDomain = queryLower.includes(".") && !queryLower.includes(" ");
    const domain = isDomain ? query.replace(/(^\w+:|^)\/\//, "").split("/")[0] : "sentinel-gateway.net";

    // 1. Core target domain entity
    entities.push({
      id: "ent_dns_domain",
      name: domain,
      type: "Domain",
      metadata: {
        nameservers: ["ns1.cloudflare.com", "ns2.cloudflare.com"],
        dnssec: "unsigned",
      }
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
      }
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
      }
    });

    // Relationships
    relationships.push({
      source: "ent_dns_domain",
      target: "ent_dns_ip",
      type: "RESOLVES_TO",
      metadata: { recordType: "A", ttl: 300 }
    });

    relationships.push({
      source: "ent_dns_domain",
      target: "ent_dns_mx",
      type: "RESOLVES_TO",
      metadata: { recordType: "MX", ttl: 3600 }
    });

    timeline.push({
      date: "2023-11-15",
      event: "Zone Routing Configuration",
      description: `Migrated zone management and nameservers to Cloudflare.`,
      source: "DNS AXFR Sync log"
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
