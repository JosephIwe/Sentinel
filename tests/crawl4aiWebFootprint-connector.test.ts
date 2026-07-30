import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Crawl4AiWebFootprintConnector } from "../src/connectors/crawl4aiWebFootprint";

/**
 * robots.txt goes through safeFetch (stubbed here); the Crawl4AI service
 * call uses global fetch (stubbed separately). `assertPublicHostname` is
 * stubbed per-test so SSRF rejection can be exercised deliberately, and left
 * permissive otherwise.
 */
const safeFetchMock = vi.fn();
const assertPublicHostnameMock = vi.fn();
vi.mock("../src/utils/ssrfGuard", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/utils/ssrfGuard")>();
  return {
    ...actual,
    safeFetch: (...a: any[]) => safeFetchMock(...a),
    assertPublicHostname: (...a: any[]) => assertPublicHostnameMock(...a)
  };
});

const SERVICE = "http://crawl4ai.internal:11235";

function textResponse(body: string, status = 200): any {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

/** A representative page with metadata, resources, links, forms and markers. */
const RICH_HTML = `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <title>Example Corporation</title>
  <meta name="description" content="We make examples.">
  <meta name="generator" content="WordPress 6.5">
  <link rel="canonical" href="https://example.test/">
  <link rel="stylesheet" href="/wp-content/themes/main.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lib.css">
</head>
<body>
  <div id="__next"></div>
  <img src="/img/logo.png"><img src="https://cdn.example.org/hero.jpg">
  <a href="/about">About</a><a href="/contact">Contact</a>
  <a href="https://twitter.com/example">Twitter</a>
  <a href="mailto:hi@example.test">Mail</a>
  <form method="POST" action="/subscribe">
    <input type="email" name="email"><input type="hidden" name="csrf"><input type="submit">
  </form>
  <iframe src="https://www.youtube.com/embed/x"></iframe>
  <script src="/wp-includes/js/app.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/x.js"></script>
</body>
</html>`;

function crawlResponse(overrides: Record<string, any> = {}, html: string = RICH_HTML) {
  return JSON.stringify({
    success: true,
    results: [{ url: "https://example.test/", success: true, status_code: 200, html, ...overrides }]
  });
}

let counter = 0;
function uniqueDomain(): string {
  counter++;
  return `fp-test-${counter}.example`;
}

/** Routes robots.txt through safeFetch with a permissive default. */
function robots(body = "User-agent: *\nAllow: /", status = 200) {
  safeFetchMock.mockResolvedValue(textResponse(body, status));
}

describe("Crawl4AiWebFootprintConnector", () => {
  let connector: Crawl4AiWebFootprintConnector;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    safeFetchMock.mockReset();
    assertPublicHostnameMock.mockReset().mockResolvedValue(undefined);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    (Crawl4AiWebFootprintConnector as any).cache.clear();
    process.env.CRAWL4AI_URL = SERVICE;
    connector = new Crawl4AiWebFootprintConnector();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CRAWL4AI_URL;
    delete process.env.CRAWL4AI_TIMEOUT_MS;
    delete process.env.CRAWL4AI_CACHE_TTL_MS;
  });

  describe("configuration", () => {
    it("returns NO_DATA with a not-configured diagnostic when CRAWL4AI_URL is unset", async () => {
      delete process.env.CRAWL4AI_URL;

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.success).toBe(true);
      expect(result.error).toMatch(/not configured/i);
      expect(result.rawData.diagnostics.configured).toBe(false);
      expect(result.evidences).toHaveLength(0);
    });

    it("makes no request of any kind when unconfigured", async () => {
      delete process.env.CRAWL4AI_URL;

      await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(safeFetchMock).not.toHaveBeenCalled();
    });

    it("never falls back to another crawler when unconfigured", async () => {
      delete process.env.CRAWL4AI_URL;

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.evidences).toHaveLength(0);
      expect(result.entities).toHaveLength(0);
      expect(result.error).toMatch(/says nothing about the target's actual web footprint/i);
    });

    it("carries the marker the report keys on to render 'not configured'", async () => {
      delete process.env.CRAWL4AI_URL;

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status === "NO_DATA" && /not configured/i.test(result.error || "")).toBe(true);
      expect(result.status).not.toBe("ERROR");
    });

    it("treats a non-http CRAWL4AI_URL as unconfigured rather than passing it to fetch", async () => {
      process.env.CRAWL4AI_URL = "file:///etc/passwd";

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.error).toMatch(/not configured/i);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uses the configured service endpoint for the crawl", async () => {
      robots();
      fetchMock.mockResolvedValue(textResponse(crawlResponse()));

      await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(fetchMock.mock.calls[0][0]).toBe(`${SERVICE}/crawl`);
    });
  });

  describe("successful crawl", () => {
    beforeEach(() => {
      robots();
      fetchMock.mockResolvedValue(textResponse(crawlResponse()));
    });

    it("returns SUCCESS with grounded evidence", async () => {
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.evidences.length).toBeGreaterThan(0);
    });

    it("extracts page metadata from the markup", async () => {
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const meta = result.evidences.find(e => e.id === "ev_footprint_metadata")!.rawData;

      expect(meta.title).toBe("Example Corporation");
      expect(meta.description).toBe("We make examples.");
      expect(meta.canonicalUrl).toBe("https://example.test/");
      expect(meta.language).toBe("en-GB");
    });

    it("counts resources, external resources and iframes", async () => {
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const counts = result.evidences.find(e => e.id === "ev_footprint_resources")!.rawData.counts;

      expect(counts.scripts).toBe(2);
      expect(counts.stylesheets).toBe(2);
      expect(counts.images).toBe(2);
      expect(counts.iframes).toBe(1);
      expect(counts.externalResources).toBeGreaterThan(0);
    });

    it("describes forms without submitting or reading any value", async () => {
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const formsEv = result.evidences.find(e => e.id === "ev_footprint_forms")!;
      const form = formsEv.rawData.forms[0];

      expect(form.method).toBe("post");
      expect(form.action).toBe("/subscribe");
      expect(form.inputTypes).toEqual(["email", "hidden", "submit"]);
      expect(form.inputCount).toBe(3);
      expect(formsEv.rawData.formsSubmitted).toBe(0);
      expect(formsEv.description).toMatch(/no form was submitted/i);
      // Field names/values must never be carried into evidence.
      expect(JSON.stringify(formsEv.rawData)).not.toContain("csrf");
    });

    it("counts same-origin and external links without following any", async () => {
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const links = result.evidences.find(e => e.id === "ev_footprint_links")!.rawData;

      expect(links.sameOriginLinks).toBe(2);
      expect(links.externalLinks).toBe(1);
      expect(links.linksFollowed).toBe(0);
      expect(links.maxDepth).toBe(0);
      expect(links.maxPages).toBe(1);
      // Only robots.txt + the single service call: no link was fetched.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(safeFetchMock).toHaveBeenCalledTimes(1);
    });

    it("prefers the crawler's own link classification when provided", async () => {
      (Crawl4AiWebFootprintConnector as any).cache.clear();
      fetchMock.mockResolvedValue(
        textResponse(crawlResponse({ links: { internal: ["/a", "/b", "/c"], external: ["https://x.test"] } }))
      );

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const links = result.evidences.find(e => e.id === "ev_footprint_links")!.rawData;

      expect(links.sameOriginLinks).toBe(3);
      expect(links.classifiedBy).toBe("crawler");
    });

    it("reports technology indicators with the markup each was read from", async () => {
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const techs = result.evidences.find(e => e.id === "ev_footprint_technology")!.rawData.technologies;
      const names = techs.map((t: any) => t.indicator);

      expect(names).toContain("WordPress 6.5");
      expect(names).toContain("Next.js");
      expect(names).toContain("WordPress");
      for (const t of techs) {
        expect(t.source).toBeTruthy();
        expect(t.evidenceValue).toBeTruthy();
      }
    });

    it("defers to Technology Fingerprinting rather than claiming authority", async () => {
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const techEv = result.evidences.find(e => e.id === "ev_footprint_technology")!;

      expect(techEv.description).toMatch(/Technology Fingerprinting connector remains the authority/i);
    });

    it("records crawl diagnostics on every evidence item", async () => {
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      for (const evidence of result.evidences) {
        const d = evidence.rawData.diagnostics;
        expect(d).toBeDefined();
        expect(d.source).toBe("Crawl4AI service");
        expect(d.pagesCrawled).toBe(1);
        expect(d.maxDepth).toBe(0);
        expect(d.maxPages).toBe(1);
        expect(d.robotsAllowed).toBe(true);
        expect(d.linksFollowed).toBe(0);
        expect(d.vulnerabilitiesReported).toBe(false);
        expect(typeof d.detectionTimeMs).toBe("number");
        expect(d.httpStatus).toBe(200);
        expect(d.finalUrl).toBe("https://example.test/");
      }
    });

    it("satisfies the canonical evidence contract on every item", async () => {
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      for (const e of result.evidences) {
        expect(e.id).toMatch(/^ev_footprint_/);
        expect(e.connector).toBe("Web Footprint");
        expect(e.title.length).toBeGreaterThan(0);
        expect(e.description.length).toBeGreaterThan(0);
        expect(e.confidence).toBeGreaterThan(0);
        expect(e.confidence).toBeLessThanOrEqual(100);
        expect(e.timestamp).toBeTruthy();
        expect(e.rawData).toBeDefined();
      }
    });

    it("instructs the service not to follow links or leave the origin", async () => {
      await connector.run({ term: uniqueDomain(), type: "Domain" });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);

      expect(body.urls).toHaveLength(1);
      expect(body.crawler_config.max_depth).toBe(0);
      expect(body.crawler_config.max_pages).toBe(1);
      expect(body.crawler_config.follow_links).toBe(false);
      expect(body.crawler_config.exclude_external_links).toBe(true);
    });

    it("emits a Domain entity carrying the page footprint", async () => {
      const domain = uniqueDomain();
      const result = await connector.run({ term: domain, type: "Domain" });
      const entity = result.entities.find(e => e.type === "Domain")!;

      expect(entity.name).toBe(domain);
      expect(entity.metadata.pageTitle).toBe("Example Corporation");
      expect(entity.metadata.https).toBe(true);
    });

    it("never reports a vulnerability or CVE", async () => {
      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(JSON.stringify(result)).not.toMatch(/CVE-\d{4}-\d+/);
      expect(result.rawData.diagnostics.vulnerabilitiesReported).toBe(false);
    });
  });

  describe("NO_DATA", () => {
    it("returns NO_DATA when the crawl returns no page content", async () => {
      robots();
      fetchMock.mockResolvedValue(textResponse(crawlResponse({}, "")));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.evidences).toHaveLength(0);
      expect(result.error).toMatch(/no page content/i);
    });

    it("returns NO_DATA when the page exhibits no reportable footprint", async () => {
      robots();
      fetchMock.mockResolvedValue(textResponse(crawlResponse({}, "<html><body><p>hi</p></body></html>")));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.error).toMatch(/no reportable footprint/i);
    });

    it("returns NO_DATA when robots.txt explicitly disallows the target", async () => {
      robots("User-agent: *\nDisallow: /");

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.error).toMatch(/explicitly disallows/i);
      // The page must not be crawled at all.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("crawls when robots.txt is absent, which the standard defines as unrestricted", async () => {
      robots("", 404);
      fetchMock.mockResolvedValue(textResponse(crawlResponse()));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("SUCCESS");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("skips non-domain targets without any request", async () => {
      for (const q of [
        { term: "8.8.8.8", type: "IPAddress" as const },
        { term: "Acme Corporation", type: "Organization" as const },
        { term: "   ", type: "Domain" as const },
        { term: "not a domain!!", type: "Generic" as const }
      ]) {
        const result = await connector.run(q);
        expect(result.status).toBe("NO_DATA");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("ERROR", () => {
    it("returns ERROR when the Crawl4AI service is unreachable", async () => {
      robots();
      fetchMock.mockRejectedValue(new Error("ECONNREFUSED 10.1.2.3:11235"));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/unreachable/i);
      expect(result.evidences).toHaveLength(0);
    });

    it("returns ERROR when the crawl times out", async () => {
      robots();
      const abort = new Error("aborted");
      abort.name = "AbortError";
      fetchMock.mockRejectedValue(abort);
      process.env.CRAWL4AI_TIMEOUT_MS = "50";

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/timed out after 50ms/i);
    });

    it("returns ERROR on a malformed (non-JSON) service response", async () => {
      robots();
      fetchMock.mockResolvedValue(textResponse("<html>gateway error</html>"));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/malformed \(non-JSON\)/i);
    });

    it("returns ERROR on an unexpected payload shape", async () => {
      robots();
      fetchMock.mockResolvedValue(textResponse(JSON.stringify([1, 2, 3])));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/unexpected payload shape/i);
    });

    it("returns ERROR when the service returns no crawl result", async () => {
      robots();
      fetchMock.mockResolvedValue(textResponse(JSON.stringify({ success: true, results: [] })));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/no crawl result/i);
    });

    it("returns ERROR when the service reports the crawl itself failed", async () => {
      robots();
      fetchMock.mockResolvedValue(
        textResponse(JSON.stringify({ success: true, results: [{ success: false, error_message: "net::ERR_NAME_NOT_RESOLVED" }] }))
      );

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/ERR_NAME_NOT_RESOLVED/);
    });

    it("returns ERROR on an HTTP failure from the service", async () => {
      robots();
      fetchMock.mockResolvedValue(textResponse("upstream error", 502));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/HTTP 502/);
    });

    it("returns ERROR — not NO_DATA — when robots.txt cannot be retrieved", async () => {
      safeFetchMock.mockRejectedValue(new Error("ETIMEDOUT"));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(result.error).toMatch(/crawl permission could not be established/i);
      // Permission was never established, so nothing was crawled.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns ERROR when robots.txt returns a server error", async () => {
      robots("", 503);

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("ERROR");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("only ever returns SUCCESS, NO_DATA or ERROR", async () => {
      const setups: Array<() => void> = [
        () => { robots(); fetchMock.mockResolvedValue(textResponse(crawlResponse())); },
        () => { robots("User-agent: *\nDisallow: /"); },
        () => { robots(); fetchMock.mockRejectedValue(new Error("down")); },
        () => { robots(); fetchMock.mockResolvedValue(textResponse("nonsense")); },
        () => { safeFetchMock.mockRejectedValue(new Error("robots gone")); }
      ];

      for (const setup of setups) {
        safeFetchMock.mockReset();
        fetchMock.mockReset();
        (Crawl4AiWebFootprintConnector as any).cache.clear();
        setup();
        const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
        expect(["SUCCESS", "NO_DATA", "ERROR"]).toContain(result.status);
      }
    });
  });

  describe("security / SSRF", () => {
    /** Each blocked family is rejected before the target is handed to the crawler. */
    const blocked = [
      ["private IPv4", "10.0.0.5 is a private address"],
      ["private IPv6", "fd00::1 is a unique-local address"],
      ["loopback", "127.0.0.1 is loopback"],
      ["link-local", "169.254.169.254 is link-local cloud metadata"],
      ["multicast/reserved", "224.0.0.1 is multicast"]
    ];

    for (const [label, reason] of blocked) {
      it(`refuses to crawl when the target resolves to a ${label} address`, async () => {
        assertPublicHostnameMock.mockRejectedValue(new Error(`SSRF Guard: ${reason}.`));

        const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

        expect(result.status).toBe("NO_DATA");
        expect(result.error).toMatch(/crawl refused/i);
        expect(result.rawData.diagnostics.blockedByGuard).toBe(true);
        // Nothing is fetched: not robots.txt, not the crawl.
        expect(fetchMock).not.toHaveBeenCalled();
        expect(safeFetchMock).not.toHaveBeenCalled();
      });
    }

    it("checks the target against the SSRF guard before contacting the crawler", async () => {
      robots();
      fetchMock.mockResolvedValue(textResponse(crawlResponse()));
      const domain = uniqueDomain();

      await connector.run({ term: domain, type: "Domain" });

      expect(assertPublicHostnameMock).toHaveBeenCalledWith(domain);
      expect(assertPublicHostnameMock.mock.invocationCallOrder[0]).toBeLessThan(
        fetchMock.mock.invocationCallOrder[0]
      );
    });

    it("discards the footprint when the crawl redirects to a private host", async () => {
      robots();
      fetchMock.mockResolvedValue(textResponse(crawlResponse({ url: "http://192.168.1.10/admin" })));
      // The target passes; the redirect destination does not.
      assertPublicHostnameMock
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("SSRF Guard: resolves to a blocked address (192.168.1.10)."));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(result.status).toBe("NO_DATA");
      expect(result.error).toMatch(/not a public host/i);
      expect(result.evidences).toHaveLength(0);
      // No page content from the private host is reported.
      expect(JSON.stringify(result)).not.toContain("Example Corporation");
    });

    it("re-checks the final URL even when the crawl succeeded", async () => {
      robots();
      fetchMock.mockResolvedValue(textResponse(crawlResponse({ url: "https://redirected.test/" })));

      await connector.run({ term: uniqueDomain(), type: "Domain" });

      expect(assertPublicHostnameMock).toHaveBeenCalledTimes(2);
      expect(assertPublicHostnameMock).toHaveBeenLastCalledWith("redirected.test");
    });

    it("does not fetch external links found on the page", async () => {
      robots();
      fetchMock.mockResolvedValue(textResponse(crawlResponse()));

      await connector.run({ term: uniqueDomain(), type: "Domain" });

      // Exactly one service call; the page's twitter.com link is never fetched.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const fetched = fetchMock.mock.calls.map(c => String(c[0])).join(" ");
      expect(fetched).not.toContain("twitter.com");
      expect(fetched).not.toContain("youtube.com");
    });

    it("never sends the target URL to a user-influenced endpoint", async () => {
      robots();
      fetchMock.mockResolvedValue(textResponse(crawlResponse()));

      // A target that looks like it is trying to redirect the service call.
      await connector.run({ term: "evil.test/../../admin", type: "Domain" });

      const called = String(fetchMock.mock.calls[0]?.[0] ?? "");
      expect(called).toBe(`${SERVICE}/crawl`);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.urls[0]).toBe("https://evil.test/");
    });

    it("collects no cookies, tokens or credential material from the page", async () => {
      robots();
      const sensitive = `<html lang="en"><head><title>T</title></head><body>
        <input type="password" name="pw" value="hunter2">
        <script>document.cookie="session=abc123"; window.__TOKEN__="Bearer zzz";</script>
      </body></html>`;
      fetchMock.mockResolvedValue(textResponse(crawlResponse({}, sensitive)));

      const result = await connector.run({ term: uniqueDomain(), type: "Domain" });
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("hunter2");
      expect(serialized).not.toContain("abc123");
      expect(serialized).not.toContain("Bearer zzz");
      expect(serialized).not.toContain("session=");
    });
  });

  describe("robots.txt evaluation", () => {
    it("honours a directive targeting this crawler specifically", () => {
      const body = "User-agent: Sentinel-WebFootprint-Connector\nDisallow: /\n\nUser-agent: *\nAllow: /";
      expect(connector.evaluateRobots(body, "/").verdict).toBe("disallowed");
    });

    it("lets a longer Allow override a shorter Disallow", () => {
      const body = "User-agent: *\nDisallow: /\nAllow: /public";
      expect(connector.evaluateRobots(body, "/public").verdict).toBe("allowed");
      expect(connector.evaluateRobots(body, "/private").verdict).toBe("disallowed");
    });

    it("treats an empty Disallow as imposing nothing", () => {
      expect(connector.evaluateRobots("User-agent: *\nDisallow:", "/").verdict).toBe("allowed");
    });

    it("ignores comments and unrelated fields", () => {
      const body = "# comment\nUser-agent: *\nCrawl-delay: 10\nDisallow: /admin";
      expect(connector.evaluateRobots(body, "/").verdict).toBe("allowed");
      expect(connector.evaluateRobots(body, "/admin").verdict).toBe("disallowed");
    });

    it("allows when robots.txt publishes no applicable group", () => {
      expect(connector.evaluateRobots("User-agent: Googlebot\nDisallow: /", "/").verdict).toBe("allowed");
    });
  });
});
