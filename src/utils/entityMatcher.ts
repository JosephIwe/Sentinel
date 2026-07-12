/**
 * Reusable Deterministic Entity Matching Utilities
 * 
 * Provides pure, deterministic matching routines for deduplicating,
 * normalizing, and cross-referencing asset indicators without relying on AI.
 */

/**
 * Normalizes punctuation and spaces to lower case for loose matching.
 */
export function normalizeString(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Strips protocol, www prefix, query params, and trailing slash from URL or domain.
 */
export function extractDomain(value: string): string {
  if (!value) return "";
  let clean = value.toLowerCase().trim();
  
  // Remove protocol
  clean = clean.replace(/^(https?:\/\/)?(www\.)?/, "");
  
  // Keep only host/domain part
  clean = clean.split("/")[0];
  clean = clean.split("?")[0];
  clean = clean.split("#")[0];
  
  return clean;
}

/**
 * Extracts organization name or owner handle from GitHub URLs or paths.
 * Handles patterns like "https://github.com/google/guava" -> "google"
 * or "github.com/google" -> "google" or "google" -> "google".
 */
export function extractGitHubOrg(githubString: string): string {
  if (!githubString) return "";
  let clean = githubString.toLowerCase().trim();
  
  // Strip protocol and hostname if present
  clean = clean.replace(/^(https?:\/\/)?(www\.)?github\.com\//, "");
  
  // Get first segment which represents organization/owner
  const parts = clean.split("/");
  return parts[0] || "";
}

/**
 * Computes standard Levenshtein distance between two strings.
 */
export function getLevenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  const lenA = a.length;
  const lenB = b.length;
  
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;
  
  for (let i = 0; i <= lenA; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= lenB; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // Deletion
        matrix[i][j - 1] + 1,      // Insertion
        matrix[i - 1][j - 1] + cost // Substitution
      );
    }
  }
  
  return matrix[lenA][lenB];
}

/**
 * Calculates a similarity ratio between 0.0 and 1.0 based on Levenshtein distance.
 */
export function getStringSimilarity(a: string, b: string): number {
  const normA = a.toLowerCase().trim();
  const normB = b.toLowerCase().trim();
  
  if (normA === normB) return 1.0;
  
  const maxLength = Math.max(normA.length, normB.length);
  if (maxLength === 0) return 1.0;
  
  const distance = getLevenshteinDistance(normA, normB);
  return (maxLength - distance) / maxLength;
}

/**
 * Determines whether two entities match based on a suite of deterministic rules.
 * Supports configurable similarity threshold.
 */
export function areEntitiesMatching(
  nameA: string,
  typeA: string,
  nameB: string,
  typeB: string,
  threshold: number = 0.85
): { matched: boolean; rule: string } {
  const cleanA = nameA.trim();
  const cleanB = nameB.trim();
  
  if (!cleanA || !cleanB) {
    return { matched: false, rule: "empty_string" };
  }
  
  // 1. Case-insensitive exact match
  if (cleanA.toLowerCase() === cleanB.toLowerCase()) {
    return { matched: true, rule: "case_insensitive_exact" };
  }
  
  // 2. Normalized punctuation exact match
  if (normalizeString(cleanA) === normalizeString(cleanB)) {
    return { matched: true, rule: "normalized_punctuation_exact" };
  }
  
  // 3. Domain/Website matching
  const isDomainA = ["domain", "website", "ipaddress"].includes(typeA.toLowerCase());
  const isDomainB = ["domain", "website", "ipaddress"].includes(typeB.toLowerCase());
  
  if (isDomainA || isDomainB) {
    const domainA = extractDomain(cleanA);
    const domainB = extractDomain(cleanB);
    if (domainA && domainB && domainA === domainB) {
      return { matched: true, rule: "exact_domain_match" };
    }
  }
  
  // 4. GitHub organization matching
  const isGithubA = ["repository", "organization", "github"].includes(typeA.toLowerCase()) || cleanA.includes("github.com");
  const isGithubB = ["repository", "organization", "github"].includes(typeB.toLowerCase()) || cleanB.includes("github.com");
  
  if (isGithubA || isGithubB) {
    const orgA = extractGitHubOrg(cleanA);
    const orgB = extractGitHubOrg(cleanB);
    if (orgA && orgB && orgA === orgB) {
      return { matched: true, rule: "github_org_match" };
    }
  }
  
  // 5. Loose fuzzy similarity check (with similarity threshold)
  // Only apply to similar entity types to avoid cross-matching unrelated entities
  const typeMatch = typeA.toLowerCase() === typeB.toLowerCase() || 
                    (typeA.toLowerCase() === "generic" || typeB.toLowerCase() === "generic");
  
  if (typeMatch) {
    const similarity = getStringSimilarity(cleanA, cleanB);
    if (similarity >= threshold) {
      return { matched: true, rule: `fuzzy_similarity_threshold_${similarity.toFixed(2)}` };
    }
  }
  
  return { matched: false, rule: "no_match" };
}
