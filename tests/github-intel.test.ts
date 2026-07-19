import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GithubIntelligenceConnector } from "../src/connectors/github-intel";

describe("GithubIntelligenceConnector - failure vs. absence semantics", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(handler: (url: string) => { status: number; body?: any }) {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const { status, body } = handler(url);
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body ?? {}),
        headers: { get: (name: string) => (name === "x-ratelimit-remaining" ? "10" : null) }
      });
    }) as any;
  }

  it("reports NO_DATA when the org/user genuinely does not exist (404/404)", async () => {
    mockFetch(() => ({ status: 404 }));

    const connector = new GithubIntelligenceConnector();
    const result = await connector.run({ term: "definitely-not-a-real-account-xyz", type: "Generic" });

    expect(result.status).toBe("NO_DATA");
    expect(result.error).toBeUndefined();
  });

  it("reports ERROR (not NO_DATA) when the org lookup is rate-limited (429)", async () => {
    mockFetch((url) => {
      if (url.includes("/search/repositories")) return { status: 404 };
      return { status: 429 };
    });

    const connector = new GithubIntelligenceConnector();
    const result = await connector.run({ term: "some-account-429", type: "Generic" });

    expect(result.status).toBe("ERROR");
    expect(result.error).toMatch(/rate-limited/i);
  });

  it("reports ERROR (not NO_DATA) when the org lookup is denied (403)", async () => {
    mockFetch((url) => {
      if (url.includes("/search/repositories")) return { status: 404 };
      return { status: 403 };
    });

    const connector = new GithubIntelligenceConnector();
    const result = await connector.run({ term: "some-account-403", type: "Generic" });

    expect(result.status).toBe("ERROR");
    expect(result.error).toMatch(/denied/i);
  });

  it("reports ERROR (not NO_DATA) when the org lookup hits an upstream server error (5xx)", async () => {
    mockFetch((url) => {
      if (url.includes("/search/repositories")) return { status: 404 };
      return { status: 503 };
    });

    const connector = new GithubIntelligenceConnector();
    const result = await connector.run({ term: "some-account-503", type: "Generic" });

    expect(result.status).toBe("ERROR");
    expect(result.error).toMatch(/server error/i);
  });

  it("reports ERROR (not NO_DATA) when the org lookup throws a network exception", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/search/repositories")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({}),
          headers: { get: () => null }
        });
      }
      return Promise.reject(new Error("getaddrinfo ENOTFOUND api.github.com"));
    }) as any;

    const connector = new GithubIntelligenceConnector();
    const result = await connector.run({ term: "some-account-network-error", type: "Generic" });

    expect(result.status).toBe("ERROR");
    expect(result.error).toMatch(/network error/i);
  });

  it("still reports SUCCESS when the org lookup resolves real data", async () => {
    mockFetch((url) => {
      if (url.includes("/search/repositories")) return { status: 404 };
      if (url.includes("/orgs/")) {
        return {
          status: 200,
          body: { login: "acme", name: "Acme Org", type: "Organization", public_repos: 3, followers: 10, created_at: "2020-01-01T00:00:00Z" }
        };
      }
      return { status: 404 };
    });

    const connector = new GithubIntelligenceConnector();
    const result = await connector.run({ term: "acme", type: "Generic" });

    expect(result.status).toBe("SUCCESS");
    expect(result.entities.length).toBeGreaterThan(0);
  });
});
