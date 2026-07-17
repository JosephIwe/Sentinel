import { describe, it, expect } from "vitest";
import { GoogleConnector } from "../src/connectors/google";
import { NewsConnector } from "../src/connectors/news";
import { GithubConnector } from "../src/connectors/github";
import { InvestigationQuery } from "../src/types";

describe("GoogleConnector", () => {
  const connector = new GoogleConnector();

  it("builds a domain/organization graph when the term looks like a domain", async () => {
    const result = await connector.run({ term: "example.com", type: "Domain" });
    expect(result.status).toBe("SUCCESS");
    expect(result.verified).toBe(false);
    expect(result.entities.map(e => e.type)).toEqual(expect.arrayContaining(["Domain", "Organization"]));
    expect(result.relationships[0]).toMatchObject({ type: "OWNED_BY" });
    expect(result.sources.some(s => s.includes("site%3Aexample.com"))).toBe(true);
  });

  it("strips protocol and path before deriving the domain entity name", async () => {
    const result = await connector.run({ term: "https://secure.example.org/some/path" });
    const domainEntity = result.entities.find(e => e.type === "Domain");
    expect(domainEntity?.name).toBe("secure.example.org");
  });

  it("builds a person/knowledge-graph result for a non-domain term", async () => {
    const result = await connector.run({ term: "Jane Analyst" });
    expect(result.entities.find(e => e.id === "ent_query_subject")?.type).toBe("Person");
    expect(result.entities.some(e => e.id === "ent_linked_social")).toBe(true);
  });

  it("classifies a non-domain term containing a corporate suffix as an Organization", async () => {
    const result = await connector.run({ term: "Acme Corp" });
    expect(result.entities.find(e => e.id === "ent_query_subject")?.type).toBe("Organization");
  });

  it("respects an explicit query.type over inferred classification", async () => {
    const result = await connector.run({ term: "Jane Analyst", type: "Organization" });
    expect(result.entities.find(e => e.id === "ent_query_subject")?.type).toBe("Organization");
  });

  it("reports NO_DATA status for an empty search term", async () => {
    const result = await connector.run({ term: "   " });
    expect(result.status).toBe("NO_DATA");
  });
});

describe("NewsConnector", () => {
  const connector = new NewsConnector();

  it("returns NO_DATA immediately for an IPv4 address", async () => {
    const result = await connector.run({ term: "192.168.1.1" });
    expect(result.status).toBe("NO_DATA");
    expect(result.entities).toHaveLength(0);
  });

  it("returns NO_DATA immediately for an IPv6 address", async () => {
    const result = await connector.run({ term: "2001:0db8:85a3:0000:0000:8a2e:0370:7334" });
    expect(result.status).toBe("NO_DATA");
  });

  it("builds a media mention graph for a normal search term", async () => {
    const result = await connector.run({ term: "Sentinel Labs" });
    expect(result.status).toBe("SUCCESS");
    expect(result.entities.find(e => e.id === "ent_news_target")?.name).toBe("Sentinel Labs");
    expect(result.entities.some(e => e.name === "TechCrunch")).toBe(true);
    expect(result.sources).toHaveLength(2);
  });

  it("classifies a domain-like term as an Organization", async () => {
    const result = await connector.run({ term: "acme.com" });
    expect(result.entities.find(e => e.id === "ent_news_target")?.type).toBe("Organization");
  });

  it("classifies a plain name as a Person absent other signals", async () => {
    const result = await connector.run({ term: "Jane Analyst" });
    expect(result.entities.find(e => e.id === "ent_news_target")?.type).toBe("Person");
  });
});

describe("GithubConnector (legacy)", () => {
  const connector = new GithubConnector();

  it("returns NO_DATA immediately for an IP address term", async () => {
    const result = await connector.run({ term: "10.0.0.5" });
    expect(result.status).toBe("NO_DATA");
    expect(result.entities).toHaveLength(0);
  });

  it("derives an org/repo slug from the search term", async () => {
    const result = await connector.run({ term: "Acme Corp!" });
    const repo = result.entities.find(e => e.type === "Repository");
    expect(repo?.name).toBe("github.com/acme-corp-/acme-corp--core");
  });

  it("falls back to a default org name when the term is empty", async () => {
    const result = await connector.run({ term: "" });
    const repo = result.entities.find(e => e.type === "Repository");
    expect(repo?.name).toBe("github.com/sentinel-labs/sentinel-labs-core");
  });

  it("derives the contributor's name from the first word of a multi-word term", async () => {
    const result = await connector.run({ term: "Jane Doe" });
    const contributor = result.entities.find(e => e.type === "Person");
    expect(contributor?.name).toBe("jane");
  });

  it("uses a default contributor name for a single-word term", async () => {
    const result = await connector.run({ term: "acme" });
    const contributor = result.entities.find(e => e.type === "Person");
    expect(contributor?.name).toBe("dev-sentinel");
  });

  it("links repository, owner, and contributor via relationships", async () => {
    const result = await connector.run({ term: "acme" });
    expect(result.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "OWNED_BY" }),
        expect.objectContaining({ type: "CONTRIBUTED_TO" }),
      ])
    );
  });
});
