/**
 * SSRF Guard
 *
 * Prevents server-initiated outbound requests (e.g. the GitHub-discovery
 * homepage fetch in investigation.ts) from being aimed at internal
 * infrastructure via attacker-controlled hostnames or DNS. Resolves the
 * target hostname first and rejects loopback, private, link-local,
 * multicast, and known cloud-metadata addresses, for both IPv4 and IPv6.
 * Redirects are followed manually so each hop is re-validated.
 */

import dns from "dns/promises";
import net, { BlockList } from "net";

const blockList = new BlockList();

// IPv4: loopback, private, link-local (incl. cloud metadata 169.254.169.254),
// carrier-grade NAT, multicast, and reserved ranges.
blockList.addSubnet("0.0.0.0", 8, "ipv4");
blockList.addSubnet("10.0.0.0", 8, "ipv4");
blockList.addSubnet("100.64.0.0", 10, "ipv4");
blockList.addSubnet("127.0.0.0", 8, "ipv4");
blockList.addSubnet("169.254.0.0", 16, "ipv4");
blockList.addSubnet("172.16.0.0", 12, "ipv4");
blockList.addSubnet("192.0.0.0", 24, "ipv4");
blockList.addSubnet("192.168.0.0", 16, "ipv4");
blockList.addSubnet("198.18.0.0", 15, "ipv4");
blockList.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
blockList.addSubnet("240.0.0.0", 4, "ipv4"); // reserved

// IPv6: loopback, unique-local (private), link-local, multicast.
blockList.addAddress("::1", "ipv6");
blockList.addSubnet("fc00::", 7, "ipv6");
blockList.addSubnet("fe80::", 10, "ipv6");
blockList.addSubnet("ff00::", 8, "ipv6");

const IPV4_MAPPED_IPV6 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

/**
 * Returns true if the given literal IP address falls inside a blocked range.
 */
export function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    return blockList.check(address, "ipv4");
  }
  if (net.isIPv6(address)) {
    const mapped = address.match(IPV4_MAPPED_IPV6);
    if (mapped) {
      return blockList.check(mapped[1], "ipv4");
    }
    return blockList.check(address, "ipv6");
  }
  // Not a recognizable IP literal - fail closed.
  return true;
}

/**
 * Resolves `hostname` (accepts both DNS names and IP literals) and throws a
 * clear error if it is unresolvable or resolves to any blocked address.
 */
export async function assertPublicHostname(hostname: string): Promise<void> {
  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err: any) {
    throw new Error(`SSRF Guard: Unable to resolve hostname "${hostname}": ${err.message}`);
  }

  if (!records || records.length === 0) {
    throw new Error(`SSRF Guard: Hostname "${hostname}" did not resolve to any address.`);
  }

  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new Error(
        `SSRF Guard: Target "${hostname}" resolves to a blocked address (${record.address}). ` +
        `Loopback, private, link-local, multicast, and cloud-metadata addresses are not permitted.`
      );
    }
  }
}

/**
 * Drop-in replacement for `fetch()` that validates the target hostname (and
 * every redirect hop) against assertPublicHostname before each request.
 */
export async function safeFetch(url: string, options: RequestInit = {}, maxRedirects = 5): Promise<Response> {
  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`SSRF Guard: Unsupported protocol "${parsed.protocol}" for target "${currentUrl}".`);
    }

    await assertPublicHostname(parsed.hostname);

    const res = await fetch(currentUrl, { ...options, redirect: "manual" });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) {
        return res;
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return res;
  }

  throw new Error(`SSRF Guard: Too many redirects while fetching "${url}".`);
}
