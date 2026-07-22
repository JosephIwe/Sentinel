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

**Columns**

- **Status** — `Beta` (newly added, still gathering production signal) or `Stable` (proven in production beta usage).
- **Accuracy** / **Coverage** — Filled in once enough production investigations have run to measure them; `TBD` until then.
- **Incidents** — Count of verified production bugs attributed to this connector since it was added.
- **Risk** — Qualitative assessment of blast radius if the connector misbehaves (e.g. false data, SSRF exposure, timeout amplification).
