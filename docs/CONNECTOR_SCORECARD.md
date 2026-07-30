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
