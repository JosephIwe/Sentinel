import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import net from "net";
import dns from "dns/promises";
import { isBlockedAddress, assertPublicHostname, safeFetch } from "../src/utils/ssrfGuard";

// dns.lookup short-circuits for literal IP addresses in real Node, but a bare
// mock doesn't know that - replicate it here, and let individual tests
// register resolutions for named hosts via mockLookup().
vi.mock("dns/promises", () => ({
  default: { lookup: vi.fn() }
}));

function mockLookup(hostMap: Record<string, string> = {}) {
  vi.mocked(dns.lookup).mockImplementation(async (hostname: any) => {
    if (net.isIP(hostname)) {
      return [{ address: hostname, family: net.isIPv4(hostname) ? 4 : 6 }] as any;
    }
    const resolved = hostMap[hostname];
    if (resolved) {
      return [{ address: resolved, family: net.isIPv4(resolved) ? 4 : 6 }] as any;
    }
    throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
  });
}

beforeEach(() => {
  mockLookup();
});

describe("isBlockedAddress", () => {
  it("blocks IPv4 loopback", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
  });

  it("blocks IPv6 loopback", () => {
    expect(isBlockedAddress("::1")).toBe(true);
  });

  it("blocks RFC1918 private ranges", () => {
    expect(isBlockedAddress("10.0.0.5")).toBe(true);
    expect(isBlockedAddress("172.16.0.5")).toBe(true);
    expect(isBlockedAddress("172.31.255.254")).toBe(true);
    expect(isBlockedAddress("192.168.0.5")).toBe(true);
  });

  it("blocks link-local addresses, including the cloud metadata endpoint", () => {
    expect(isBlockedAddress("169.254.0.1")).toBe(true);
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
  });

  it("blocks IPv6 unique-local and link-local ranges", () => {
    expect(isBlockedAddress("fc00::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
  });

  it("blocks multicast ranges for both families", () => {
    expect(isBlockedAddress("224.0.0.1")).toBe(true);
    expect(isBlockedAddress("ff02::1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 addresses that embed a blocked IPv4 target", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
  });

  it("allows ordinary public IPv4/IPv6 addresses", () => {
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });
});

describe("assertPublicHostname", () => {
  it("rejects a loopback IP literal", async () => {
    await expect(assertPublicHostname("127.0.0.1")).rejects.toThrow(/blocked address/i);
  });

  it("rejects an internal RFC1918 IP literal", async () => {
    await expect(assertPublicHostname("10.0.0.1")).rejects.toThrow(/blocked address/i);
  });

  it("rejects the cloud metadata IP literal", async () => {
    await expect(assertPublicHostname("169.254.169.254")).rejects.toThrow(/blocked address/i);
  });

  it("resolves without throwing for a public IP literal", async () => {
    await expect(assertPublicHostname("8.8.8.8")).resolves.toBeUndefined();
  });

  it("rejects a hostname that resolves to a private address", async () => {
    mockLookup({ "internal.corp.example": "10.5.5.5" });
    await expect(assertPublicHostname("internal.corp.example")).rejects.toThrow(/blocked address/i);
  });

  it("resolves without throwing for a hostname that resolves to a public address", async () => {
    mockLookup({ "public-site.example": "93.184.216.34" });
    await expect(assertPublicHostname("public-site.example")).resolves.toBeUndefined();
  });
});

describe("safeFetch", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects non-http(s) protocols before making any request", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    await expect(safeFetch("ftp://example.com/file")).rejects.toThrow(/unsupported protocol/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks a direct request to a private-range target", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as any;

    await expect(safeFetch("http://127.0.0.1/admin")).rejects.toThrow(/blocked address/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("re-validates and blocks a redirect that points at an internal address", async () => {
    mockLookup({ "public-site.example": "93.184.216.34" });
    global.fetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: (name: string) => (name.toLowerCase() === "location" ? "http://169.254.169.254/latest/meta-data/" : null) }
    }) as any;

    await expect(safeFetch("https://public-site.example/")).rejects.toThrow(/blocked address/i);
  });

  it("follows a redirect chain that stays on public addresses", async () => {
    mockLookup({ "public-site.example": "93.184.216.34" });
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: (name: string) => (name.toLowerCase() === "location" ? "https://public-site.example/final" : null) }
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { get: () => null }
      });
    global.fetch = fetchSpy as any;

    const res = await safeFetch("https://public-site.example/start");
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
