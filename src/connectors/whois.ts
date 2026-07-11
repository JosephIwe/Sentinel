import { Connector, ConnectorResult, Entity, Relationship, TimelineEvent } from "../types";

/**
 * WHOIS Directory Registry Connector
 * 
 * Simulates real-time WHOIS server queries, resolving domain names,
 * registrar chains, registration dates, and corporate owner details.
 */
export class WhoisConnector implements Connector {
  public name = "WHOIS Registry Resolver";

  public async run(query: string): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const queryLower = query.toLowerCase();

    const entities: Entity[] = [];
    const relationships: Relationship[] = [];
    const timeline: TimelineEvent[] = [];
    const sources: string[] = [];

    const isDomain = queryLower.includes(".") && !queryLower.includes(" ");

    if (isDomain) {
      const domain = query.replace(/(^\w+:|^)\/\//, "").split("/")[0];
      
      entities.push({
        id: "ent_whois_domain",
        name: domain,
        type: "Domain",
        metadata: {
          registrar: "NameCheap, Inc.",
          dnssec: "unsigned",
          status: "clientTransferProhibited",
        }
      });

      entities.push({
        id: "ent_whois_registrant",
        name: "WhoisGuard Protected / Domain Administrator",
        type: "Organization",
        metadata: {
          organization: "WhoisGuard, Inc.",
          country: "Panama",
          address: "P.O. Box 0823-03411, Panama City",
        }
      });

      entities.push({
        id: "ent_whois_registrar",
        name: "NameCheap, Inc.",
        type: "Organization",
        metadata: {
          ianaId: "1068",
        }
      });

      relationships.push({
        source: "ent_whois_domain",
        target: "ent_whois_registrant",
        type: "OWNED_BY",
        metadata: { field: "registrant" }
      });

      relationships.push({
        source: "ent_whois_domain",
        target: "ent_whois_registrar",
        type: "RESOLVES_TO",
        metadata: { field: "registrar" }
      });

      timeline.push({
        date: "2019-06-15",
        event: "Domain Registration Date",
        description: `Domain ${domain} was originally registered.`,
        source: "WHOIS Registry Database"
      });

      timeline.push({
        date: "2026-06-15",
        event: "Domain Expiration Date",
        description: `Domain renewal cycle deadline.`,
        source: "WHOIS Registry Database"
      });

      sources.push(`whois://whois.iana.org/domain/${domain}`);
    } else {
      // For general query, mock domain registry registration record of matching organization name
      const entityName = query;
      const cleanName = query.toLowerCase().replace(/[^a-z0-9]/g, "");
      const generatedDomain = `${cleanName || "sentineltarget"}.io`;

      entities.push({
        id: "ent_whois_domain",
        name: generatedDomain,
        type: "Domain",
        metadata: {
          registrar: "GoDaddy.com, LLC",
          status: "active",
        }
      });

      entities.push({
        id: "ent_whois_registrant",
        name: entityName,
        type: "Organization",
        metadata: {
          organization: entityName,
          country: "US",
        }
      });

      relationships.push({
        source: "ent_whois_domain",
        target: "ent_whois_registrant",
        type: "OWNED_BY",
        metadata: { evidence: "WHOIS Contact Email" }
      });

      timeline.push({
        date: "2021-08-20",
        event: "Domain Registry Created",
        description: `Registered brand identity domain ${generatedDomain} to track digital assets.`,
        source: "Verisign GRS WHOIS"
      });

      sources.push(`whois://whois.nic.io/domain/${generatedDomain}`);
    }

    return {
      connectorName: this.name,
      success: true,
      timestamp,
      entities,
      relationships,
      timeline,
      sources,
      rawData: {
        rawWhoisOutput: "Domain Name: TARGET\nRegistry Domain ID: 24209\nRegistrar WHOIS Server: whois.namecheap.com",
        queriedServer: "whois.iana.org"
      }
    };
  }
}
