import { Connector, ConnectorResult, Entity, Relationship, TimelineEvent, Evidence, InvestigationQuery } from "../types";

interface CacheEntry {
  result: ConnectorResult;
  timestamp: number;
}

/**
 * Production-Quality GitHub Intelligence Connector
 * 
 * Integrates with GitHub REST API, handles rate-limiting gracefully, supports 
 * both authenticated (GITHUB_TOKEN) and unauthenticated operations, and caches 
 * results with configurable GITHUB_CACHE_TTL_MS.
 */
export class GithubIntelligenceConnector implements Connector {
  public name = "GitHub Intelligence Resolver";

  private static cache = new Map<string, CacheEntry>();

  /**
   * Retrieves the configurable cache TTL from environment variables.
   * Defaults to 1 hour (3,600,000ms).
   */
  private getCacheTtl(): number {
    const envTtl = process.env.GITHUB_CACHE_TTL_MS;
    if (envTtl) {
      const parsed = parseInt(envTtl, 10);
      if (!isNaN(parsed) && parsed >= 0) return parsed;
    }
    return 60 * 60 * 1000; // 1 hour default
  }

  /**
   * Helper to perform rate-limit-aware fetch requests to GitHub REST API.
   * `status: 0` signals a network-level exception (no HTTP response was
   * ever received), distinct from a real upstream HTTP status.
   */
  private async fetchGithub<T>(url: string, token?: string): Promise<{ data: T | null; status: number; rateLimitRemaining: number; networkError?: string }> {
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Sentinel-Intelligence-Engine"
    };

    if (token) {
      headers["Authorization"] = `token ${token}`;
    }

    try {
      const res = await fetch(url, { headers });
      const rateLimitRemaining = parseInt(res.headers.get("x-ratelimit-remaining") || "60", 10);

      if (res.status === 403 || res.status === 429) {
        console.warn(`[GitHub API] Rate limit or access issue on ${url} (Status ${res.status}). Remaining: ${rateLimitRemaining}`);
        return { data: null, status: res.status, rateLimitRemaining };
      }

      if (!res.ok) {
        return { data: null, status: res.status, rateLimitRemaining };
      }

      const data = await res.json() as T;
      return { data, status: res.status, rateLimitRemaining };
    } catch (err: any) {
      console.error(`[GitHub API Connection Error] Failed fetching ${url}:`, err.message);
      return { data: null, status: 0, rateLimitRemaining: 0, networkError: err.message || "Network error" };
    }
  }

  /**
   * Distinguishes a genuine "not found" (404) from a failure that means we
   * simply couldn't determine whether the target exists (auth/rate-limit/
   * server/network errors) - these must never be reported as NO_DATA.
   */
  private isFailureStatus(status: number): boolean {
    return status === 0 || status === 401 || status === 403 || status === 429 || status >= 500;
  }

  /**
   * Produces a human-readable diagnostic reason for a failed existence check.
   */
  private describeFailure(context: string, res: { status: number; networkError?: string }): string {
    if (res.networkError) {
      return `GitHub API ${context} failed due to a network error: ${res.networkError}`;
    }
    if (res.status === 429) {
      return `GitHub API ${context} was rate-limited (HTTP 429). Configure GITHUB_TOKEN to raise the rate limit.`;
    }
    if (res.status === 401 || res.status === 403) {
      return `GitHub API ${context} was denied (HTTP ${res.status}). This may be an unauthenticated rate limit or an invalid GITHUB_TOKEN.`;
    }
    return `GitHub API ${context} failed with an upstream server error (HTTP ${res.status}).`;
  }

  /**
   * Safely checks for the existence of a file path in a repository.
   */
  private async checkFileExists(owner: string, repo: string, path: string, token?: string): Promise<boolean> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const headers: Record<string, string> = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "Sentinel-Intelligence-Engine"
    };
    if (token) {
      headers["Authorization"] = `token ${token}`;
    }

    try {
      const res = await fetch(url, { method: "HEAD", headers });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Parses the search term to determine if it is a Repository URL, Repo Slug, or Username/Organization.
   */
  private parseQueryTerm(term: string): { owner: string; repo: string | null; isRepo: boolean } {
    const cleaned = term.trim();
    
    // 1. Check if it's a full GitHub URL
    if (cleaned.includes("github.com")) {
      try {
        const urlString = cleaned.startsWith("http") ? cleaned : `https://${cleaned}`;
        const parsedUrl = new URL(urlString);
        const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
        if (pathParts.length >= 2) {
          return { owner: pathParts[0], repo: pathParts[1], isRepo: true };
        } else if (pathParts.length === 1) {
          return { owner: pathParts[0], repo: null, isRepo: false };
        }
      } catch {
        // Fallback if parsing fails
      }
    }

    // 2. Check if it's an owner/repo slug
    if (cleaned.includes("/")) {
      const parts = cleaned.split("/");
      if (parts.length >= 2 && parts[0] && parts[1]) {
        return { owner: parts[0].trim(), repo: parts[1].trim(), isRepo: true };
      }
    }

    // 3. Defaults to just owner (could be a user, org, or repo name to be searched)
    return { owner: cleaned, repo: null, isRepo: false };
  }

  public async run(query: InvestigationQuery): Promise<ConnectorResult> {
    const timestamp = new Date().toISOString();
    const searchTerm = query.term;
    const cacheKey = `${query.type || "Generic"}:${searchTerm.toLowerCase()}`;
    const ttl = this.getCacheTtl();

    // Check Cache
    const cached = GithubIntelligenceConnector.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttl) {
      console.log(`[GitHub Cache] Serving cached intelligence for ${cacheKey}`);
      return {
        ...cached.result,
        timestamp
      };
    }

    const token = process.env.GITHUB_TOKEN;
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];
    const timeline: TimelineEvent[] = [];
    const evidences: Evidence[] = [];
    const sources: string[] = [];

    let { owner, repo, isRepo } = this.parseQueryTerm(searchTerm);

    // Smart Fallback Search: If they provided a single-term, check if it's actually a popular repository
    if (!isRepo && owner) {
      const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(owner)}&per_page=1`;
      const searchRes = await this.fetchGithub<{ items: any[] }>(searchUrl, token);
      if (searchRes.data && searchRes.data.items && searchRes.data.items.length > 0) {
        const bestMatch = searchRes.data.items[0];
        // If the best match name matches exactly (case-insensitive), treat it as a Repository query
        if (bestMatch.name.toLowerCase() === owner.toLowerCase()) {
          owner = bestMatch.owner.login;
          repo = bestMatch.name;
          isRepo = true;
          console.log(`[GitHub Search] Resolved term "${searchTerm}" to repository: ${owner}/${repo}`);
        }
      }
    }

    if (!owner) {
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
        error: "Could not parse or resolve a valid GitHub owner or repository target"
      };
    }

    // Data containers
    let orgData: any = null;
    let repoData: any = null;
    // Set when an existence-determining lookup (org/user or repo) fails with
    // a rate-limit/auth/server/network error, so that failure is never
    // silently reported as NO_DATA below.
    let criticalFailureReason: string | null = null;
    let languagesData: Record<string, number> = {};
    let communityProfile: any = null;
    let securityMdExists = false;
    let dependabotExists = false;
    let codeScanningActive = false;
    let commits: any[] = [];
    let releases: any[] = [];
    let contributorCount = 0;

    // Fetch Organization/User Details
    const orgUrl = `https://api.github.com/orgs/${owner}`;
    const userUrl = `https://api.github.com/users/${owner}`;
    let orgRes = await this.fetchGithub<any>(orgUrl, token);
    if (orgRes.status === 404) {
      // Try user profile instead
      orgRes = await this.fetchGithub<any>(userUrl, token);
    }
    orgData = orgRes.data;
    if (!orgData && this.isFailureStatus(orgRes.status)) {
      criticalFailureReason = this.describeFailure("organization/user lookup", orgRes);
    }

    // If it's not explicitly a repository query but we have a user/org, let's fetch their public repositories to analyze the most active one
    if (!isRepo && orgData) {
      const reposUrl = `https://api.github.com/users/${owner}/repos?sort=updated&per_page=5`;
      const reposRes = await this.fetchGithub<any[]>(reposUrl, token);
      if (reposRes.data && reposRes.data.length > 0) {
        // Pick the most updated repository to present cohesive repo indicators
        repo = reposRes.data[0].name;
        isRepo = true;
        console.log(`[GitHub Auto-Select] Selected most recently updated repository for ${owner}: ${repo}`);
      }
    }

    // Fetch Repository Details if we have a repo target
    if (isRepo && repo) {
      const repoUrl = `https://api.github.com/repos/${owner}/${repo}`;
      const repoRes = await this.fetchGithub<any>(repoUrl, token);
      repoData = repoRes.data;
      if (!repoData && this.isFailureStatus(repoRes.status)) {
        criticalFailureReason = this.describeFailure("repository lookup", repoRes);
      }

      if (repoData) {
        sources.push(`https://github.com/${owner}/${repo}`);
        sources.push(`https://api.github.com/repos/${owner}/${repo}`);

        // Languages breakdown
        const langUrl = `https://api.github.com/repos/${owner}/${repo}/languages`;
        const langRes = await this.fetchGithub<Record<string, number>>(langUrl, token);
        if (langRes.data) {
          languagesData = langRes.data;
        }

        // Community Profile (contains license, security policy status)
        const commUrl = `https://api.github.com/repos/${owner}/${repo}/community/profile`;
        const commRes = await this.fetchGithub<any>(commUrl, token);
        communityProfile = commRes.data;

        // Check SECURITY.md presence
        if (communityProfile?.files?.security_policy) {
          securityMdExists = true;
        } else {
          // Double check common root paths
          const checkRoot = await this.checkFileExists(owner, repo, "SECURITY.md", token);
          const checkDotGithub = await this.checkFileExists(owner, repo, ".github/SECURITY.md", token);
          securityMdExists = checkRoot || checkDotGithub;
        }

        // Check Dependabot presence
        const checkDepYml = await this.checkFileExists(owner, repo, ".github/dependabot.yml", token);
        const checkDepYaml = await this.checkFileExists(owner, repo, ".github/dependabot.yaml", token);
        dependabotExists = checkDepYml || checkDepYaml;

        // Check Code Scanning Status
        const scanUrl = `https://api.github.com/repos/${owner}/${repo}/code-scanning/analyses?per_page=1`;
        const scanRes = await this.fetchGithub<any[]>(scanUrl, token);
        codeScanningActive = scanRes.status === 200 && Array.isArray(scanRes.data) && scanRes.data.length > 0;

        // Fetch Commits
        const commitsUrl = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=10`;
        const commitsRes = await this.fetchGithub<any[]>(commitsUrl, token);
        if (Array.isArray(commitsRes.data)) {
          commits = commitsRes.data;
        }

        // Fetch Releases
        const releasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=5`;
        const releasesRes = await this.fetchGithub<any[]>(releasesUrl, token);
        if (Array.isArray(releasesRes.data)) {
          releases = releasesRes.data;
        }

        // Fetch Contributor Count via Link headers trick
        const contribsUrl = `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1&anon=true`;
        const headers: Record<string, string> = { "User-Agent": "Sentinel-Intelligence-Engine" };
        if (token) headers["Authorization"] = `token ${token}`;

        try {
          const contribRes = await fetch(contribsUrl, { headers });
          const linkHeader = contribRes.headers.get("link");
          if (linkHeader) {
            const match = linkHeader.match(/&page=(\d+)[^>]*>;\s*rel="last"/);
            if (match) {
              contributorCount = parseInt(match[1], 10);
            }
          }
          if (contributorCount === 0) {
            const listRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=100`, { headers });
            if (listRes.ok) {
              const listData = await listRes.json() as any[];
              contributorCount = listData.length;
            }
          }
        } catch (e: any) {
          console.warn("[GitHub API] Failed calculating contributors:", e.message);
        }
      }
    }

    if (orgData) {
      sources.push(`https://github.com/${owner}`);
      sources.push(`https://api.github.com/users/${owner}`);
    }

    // --- Score Calculations ---
    // 1. Security Score (0 to 100)
    let securityScore = 15; // default baseline for open source visibility
    if (securityMdExists) securityScore += 35;
    if (dependabotExists) securityScore += 25;
    if (codeScanningActive) securityScore += 25;
    securityScore = Math.min(100, securityScore);

    // 2. Activity Score (0 to 100)
    let activityScore = 20; // baseline public presence
    if (commits.length > 0) activityScore += 30;
    if (releases.length > 0) activityScore += 25;
    if (contributorCount > 5) activityScore += 15;
    if (contributorCount > 20) activityScore += 10;
    
    // Recency modifier
    if (repoData?.updated_at) {
      const daysSinceUpdate = (Date.now() - new Date(repoData.updated_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate < 7) {
        activityScore += 10;
      } else if (daysSinceUpdate > 90) {
        activityScore -= 15;
      }
    }
    activityScore = Math.max(10, Math.min(100, activityScore));

    // 3. Repository Health (0 to 100)
    let healthScore = 30; // base code health
    if (repoData?.license) healthScore += 20;
    if (securityMdExists) healthScore += 20;
    if (repoData?.has_issues) {
      const openIssues = repoData.open_issues_count || 0;
      const stars = repoData.stargazers_count || 1;
      const issueRatio = openIssues / stars;
      if (issueRatio < 0.1) healthScore += 20;
      else if (issueRatio < 0.3) healthScore += 10;
    }
    if (repoData?.description) healthScore += 10;
    healthScore = Math.min(100, healthScore);

    // --- Populate Entities ---
    const orgEntityId = `ent_gh_org_${owner.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
    if (orgData) {
      entities.push({
        id: orgEntityId,
        name: orgData.name || orgData.login || owner,
        type: "Organization",
        metadata: {
          username: orgData.login,
          description: orgData.bio || orgData.description,
          website: orgData.blog || orgData.html_url,
          followers: orgData.followers,
          publicRepos: orgData.public_repos,
          createdAt: orgData.created_at,
          githubType: orgData.type || "User"
        },
        evidenceIds: ["ev_gh_org_intelligence"]
      });
    }

    const repoEntityId = `ent_gh_repo_${owner.toLowerCase()}_${repo?.toLowerCase()}`;
    if (repoData) {
      entities.push({
        id: repoEntityId,
        name: repoData.full_name,
        type: "Repository",
        metadata: {
          owner: repoData.owner?.login,
          stars: repoData.stargazers_count,
          forks: repoData.forks_count,
          watchers: repoData.watchers_count,
          openIssues: repoData.open_issues_count,
          primaryLanguage: repoData.language,
          license: repoData.license?.spdx_id || repoData.license?.name || "None",
          topics: repoData.topics || [],
          defaultBranch: repoData.default_branch,
          lastUpdated: repoData.updated_at,
          healthScore,
          activityScore,
          securityScore,
          languages: languagesData
        },
        evidenceIds: ["ev_gh_repo_intelligence"]
      });

      if (orgData) {
        relationships.push({
          source: repoEntityId,
          target: orgEntityId,
          type: "OWNED_BY",
          metadata: { role: "Main Repository Space" },
          evidenceIds: ["ev_gh_repo_intelligence"]
        });
      }
    }

    // --- Populate Evidences ---
    if (orgData) {
      evidences.push({
        id: "ev_gh_org_intelligence",
        connector: this.name,
        title: "GitHub Profile Intelligence",
        description: `Discovered GitHub profile for "${owner}" (${orgData.type || "User"}) with ${orgData.public_repos} public repositories and ${orgData.followers} followers. Established public identity footprint created on ${new Date(orgData.created_at).toLocaleDateString()}.`,
        confidence: 99,
        timestamp,
        rawData: orgData,
        verified: true
      });
    }

    if (repoData) {
      evidences.push({
        id: "ev_gh_repo_intelligence",
        connector: this.name,
        title: "GitHub Repository Core Intelligence",
        description: `Successfully analyzed repository "${repoData.full_name}". Metrics: ${repoData.stargazers_count} stars, ${repoData.forks_count} forks, configured with default branch "${repoData.default_branch}". Core stack is centered around ${repoData.language || "Unknown Language"}.`,
        confidence: 99,
        timestamp,
        rawData: {
          ...repoData,
          languages: languagesData
        },
        verified: true
      });

      evidences.push({
        id: "ev_gh_security_intelligence",
        connector: this.name,
        title: "GitHub Codebase Security Registry",
        description: `Assessed code security posture for repository "${repoData.full_name}". Findings: SECURITY.md file is ${securityMdExists ? "ACTIVE" : "MISSING"}; Dependabot is ${dependabotExists ? "ENABLED" : "NOT CONFIGURED"}; GitHub public code scanning is ${codeScanningActive ? "ACTIVE" : "INACTIVE OR PRIVATE"}. Calculated Security Score: ${securityScore}%.`,
        confidence: 95,
        timestamp,
        rawData: {
          securityMdExists,
          dependabotExists,
          codeScanningActive,
          securityScore
        },
        verified: true
      });

      evidences.push({
        id: "ev_gh_activity_intelligence",
        connector: this.name,
        title: "GitHub Development Activity & Timelines",
        description: `Verified recent development timeline for repository "${repoData.full_name}". Retrieved ${commits.length} recent commit logs, discovered ${releases.length} releases, and calculated ${contributorCount} distinct contributors. Calculated Activity Score: ${activityScore}%.`,
        confidence: 95,
        timestamp,
        rawData: {
          commits: commits.map(c => ({
            sha: c.sha?.substring(0, 7),
            message: c.commit?.message?.split("\n")[0],
            date: c.commit?.author?.date,
            author: c.commit?.author?.name
          })),
          releases: releases.map(r => ({
            tagName: r.tag_name,
            name: r.name,
            publishedAt: r.published_at
          })),
          contributorCount,
          activityScore
        },
        verified: true
      });

      // Populate Timeline events
      if (repoData.created_at) {
        timeline.push({
          date: repoData.created_at.split("T")[0],
          event: "Repository Initialized",
          description: `Repository "${repoData.full_name}" was initialized on GitHub under owner "${owner}".`,
          source: "GitHub Platform Registry"
        });
      }

      if (commits.length > 0 && commits[0]?.commit?.author?.date) {
        timeline.push({
          date: commits[0].commit.author.date.split("T")[0],
          event: "Recent Commits Activity",
          description: `Latest development updates pushed to repository: "${commits[0].commit.message.split("\n")[0]}" by ${commits[0].commit.author.name}.`,
          source: "GitHub Commit Stream"
        });
      }

      releases.forEach(rel => {
        if (rel.published_at) {
          timeline.push({
            date: rel.published_at.split("T")[0],
            event: `Release Marked: ${rel.tag_name}`,
            description: `Official semantic code release tagged as ${rel.tag_name} ("${rel.name || 'Semantic Update'}").`,
            source: "GitHub Releases"
          });
        }
      });
    }

    // Combine metadata to store in cache
    const finalRawData = {
      queryTerm: searchTerm,
      owner,
      repo,
      isRepo,
      orgData,
      repoData,
      languages: languagesData,
      security: {
        securityMdExists,
        dependabotExists,
        codeScanningActive,
        securityScore
      },
      activity: {
        commitsCount: commits.length,
        releasesCount: releases.length,
        contributorCount,
        activityScore
      },
      health: {
        healthScore
      }
    };

    const hasData = !!(repoData || orgData);
    // A rate-limit/auth/server/network failure must never be reported as
    // NO_DATA (which means "confirmed absent") - only a real 404 means that.
    const status: ConnectorResult["status"] = hasData
      ? "SUCCESS"
      : criticalFailureReason
        ? "ERROR"
        : "NO_DATA";

    const result: ConnectorResult = {
      connectorName: this.name,
      success: status !== "ERROR",
      status,
      verified: true,
      timestamp,
      entities,
      relationships,
      timeline,
      evidences,
      sources,
      rawData: finalRawData,
      ...(status === "ERROR" && criticalFailureReason ? { error: criticalFailureReason } : {})
    };

    // Store in Cache
    GithubIntelligenceConnector.cache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });

    return result;
  }
}
