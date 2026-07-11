import { Connector, ConnectorResult, Entity, Relationship, TimelineEvent, Evidence, InvestigationQuery } from "../types";

/**
 * GitHub API Open Source Code Repository Connector
 * 
 * Simulates high-precision code graph analysis, matching developers,
 * source repositories, organizations, and timeline commit sequences on GitHub.
 */
export class GithubConnector implements Connector {
  public name = "GitHub Code Graph Indexer";

  public async run(query: InvestigationQuery): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const searchTerm = query.term;
    const queryLower = searchTerm.toLowerCase();

    const entities: Entity[] = [];
    const relationships: Relationship[] = [];
    const timeline: TimelineEvent[] = [];
    const evidences: Evidence[] = [];
    const sources: string[] = [];

    const cleanName = searchTerm.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const orgName = cleanName || "sentinel-labs";
    const repoName = `${orgName}-core`;

    entities.push({
      id: "ent_gh_repo",
      name: `github.com/${orgName}/${repoName}`,
      type: "Repository",
      metadata: {
        stars: 342,
        forks: 24,
        primaryLanguage: "TypeScript",
        license: "Apache-2.0",
      },
      evidenceIds: ["ev_gh_repo_activity"]
    });

    entities.push({
      id: "ent_gh_owner",
      name: orgName,
      type: "Organization",
      metadata: {
        location: "San Francisco, CA",
        verified: true,
      },
      evidenceIds: ["ev_gh_repo_activity"]
    });

    relationships.push({
      source: "ent_gh_repo",
      target: "ent_gh_owner",
      type: "OWNED_BY",
      metadata: { role: "Organization space" },
      evidenceIds: ["ev_gh_repo_activity"]
    });

    const contributorName = queryLower.includes(" ") ? searchTerm.split(" ")[0].toLowerCase() : "dev-sentinel";
    entities.push({
      id: "ent_gh_contributor",
      name: contributorName,
      type: "Person",
      metadata: {
        contributions: 142,
        profileUrl: `https://github.com/${contributorName}`
      },
      evidenceIds: ["ev_gh_repo_activity"]
    });

    relationships.push({
      source: "ent_gh_contributor",
      target: "ent_gh_repo",
      type: "CONTRIBUTED_TO",
      metadata: { commits: 88, role: "Lead Maintainer" },
      evidenceIds: ["ev_gh_repo_activity"]
    });

    timeline.push({
      date: "2024-05-02",
      event: "Initial Code Push",
      description: `First commit initialized repository structure for ${repoName}.`,
      source: "GitHub Commit Graph"
    });

    timeline.push({
      date: "2025-09-14",
      event: "v1.0.0 Production Release",
      description: `Tagged official v1.0.0 semantic version marking code stabilization.`,
      source: "GitHub Releases"
    });

    evidences.push({
      id: "ev_gh_repo_activity",
      connector: this.name,
      title: "GitHub Codebase Repository Discovery",
      description: `Found active public codebase repository github.com/${orgName}/${repoName} with strong commit timeline.`,
      confidence: 90,
      timestamp,
      rawData: {
        repository: `github.com/${orgName}/${repoName}`,
        stars: 342,
        forks: 24,
        primaryLanguage: "TypeScript",
        license: "Apache-2.0",
        contributors: [contributorName],
        openIssues: 3,
        activeBranches: ["main", "dev-v2"]
      },
      source: "GitHub GraphQL API",
      strength: 0.9,
      url: `https://github.com/${orgName}/${repoName}`
    });

    sources.push(`https://github.com/${orgName}/${repoName}`);
    sources.push(`https://api.github.com/repos/${orgName}/${repoName}`);

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
        repositoryUrl: `https://github.com/${orgName}/${repoName}`,
        openIssues: 3,
        pullRequests: 1,
        activeBranches: ["main", "dev-v2"]
      }
    };
  }
}
