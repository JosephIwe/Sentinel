# Connector Scorecard

Tracks the maturity and operational status of each investigation connector.
Connectors are added incrementally, one at a time, to avoid regressions —
see `CHANGELOG.md` for the history of each addition.

| Connector | Status | Accuracy | Coverage | Incidents | Risk |
|---|---|---|---|---|---|
| WHOIS | Stable | TBD | TBD | 0 | Low |
| DNS | Stable | TBD | TBD | 0 | Low |
| GitHub Intelligence | Stable | TBD | TBD | 0 | Low |
| SecurityTxt | Beta | TBD | TBD | 0 | Medium |
| Technology Fingerprint | Beta | TBD | TBD | 0 | Medium |
| Certificate Transparency | Beta | TBD | TBD | 0 | Medium |
| ASN / IP Intelligence | Beta | TBD | TBD | 0 | Low |
| RDAP Intelligence | Beta | TBD | TBD | 0 | Medium |
| Reverse DNS | Beta | TBD | TBD | 0 | Low |
| HTTP Security Headers | Beta | TBD | TBD | 0 | Low |
| DNSSEC | Beta | TBD | TBD | 0 | Low |
| Shodan Intelligence | Beta | TBD | TBD | 0 | Medium |
| Web Footprint (Crawl4AI) | Beta (unmerged) | TBD | TBD | 0 | Medium |

**Web Footprint — scope limits and safety posture**

Implemented 2026-07-30 on `feature/crawl4ai-web-footprint`. Crawl4AI is integrated as an **HTTP service**, never a library, and never
falls back to a second crawler when unconfigured.

| Limit | Value | Enforced |
|---|---|---|
| Crawl depth | 0 | Sent to the service *and* only the first result is read |
| Pages crawled | 1 | Same |
| Links followed | 0 | Counted only; asserted by test |
| External fetches | 0 | `exclude_external_links`, asserted by test |
| Subdomain expansion | none | Not implemented |
| Vulnerability claims | none | Asserted by test |

Because the service performs the fetch, the target is proven public with `assertPublicHostname` *before* being handed over, and the
final URL is re-checked afterwards so a redirect into private space is discarded rather than reported. `CRAWL4AI_URL` is operator
infrastructure config (typically a private sidecar) and is reached with a plain fetch after http/https validation — it is never
derived from investigation input.

**HTTP Security Headers — classification and confidence tiers**

Shipped 2026-07-30 (PR #15). Inspects twelve headers over HTTPS; the response
body is never read. Each header is classified, and the classification decides
whether its *absence* is reportable — an absent `Server` header is the
desirable state, not a finding.

| Classification | Headers | Absence reported? |
|---|---|---|
| `SECURITY` | HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP, COEP, CORP | Yes |
| `INFORMATIONAL` | Cache-Control | No |
| `DISCLOSURE` | Server, X-Powered-By | No — presence is the finding |

| Evidence | Confidence | Rationale |
|---|---|---|
| `ev_headers_present` | 97 | The header and its value are read straight off the response |
| `ev_headers_missing` | 95 | Absence from a response that was actually received |
| `ev_headers_disclosure` | 94 | Verbatim self-identification; no product or version inferred |
| `ev_headers_observations` | 92 | A literal reading of a value, carrying the exact text it came from |

Observations are mechanical readings, never a verdict on the site, and no
value is scored or graded — `ScoringService` is untouched. **Overlap with
Technology Fingerprinting on HSTS/CSP/Referrer-Policy/Permissions-Policy is
intentional**: that connector does signature *detection* (presence as a
technology signal), this one does security-control *analysis* and value
interpretation.

**Technology Fingerprint — detection surfaces and confidence tiers**

| Surface | Confidence | Rationale |
|---|---|---|
| Security response headers | 95 | Header presence/value *is* the fact reported — no inference |
| `Server` / `X-Powered-By` / `<meta generator>` | 90 | Direct self-identification by the target |
| Vendor-proprietary headers (`cf-ray`, `x-amz-request-id`, …) | 85 | Unique to one vendor; presence only, values are trace IDs |
| Parsed `<script src>` / `<link rel=stylesheet>` URLs | 82 | Real asset URLs, not raw page text |
| Framework runtime globals / hydration markers | 78 | Namespaced identifiers unlikely to occur by coincidence |
| `Set-Cookie` names | 70 | Conventional but customizable; names only, values never read |

Independent corroboration adds +3 per extra source, capped at 95. Versions are
reported only when they literally appear in the matched text.

**Columns**

- **Status** — `Beta` (newly added, still gathering production signal) or `Stable` (proven in production beta usage).
- **Accuracy** / **Coverage** — Filled in once enough production investigations have run to measure them; `TBD` until then.
- **Incidents** — Count of verified production bugs attributed to this connector since it was added.
- **Risk** — Qualitative assessment of blast radius if the connector misbehaves (e.g. false data, SSRF exposure, timeout amplification).
