# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- New `SecurityTxtConnector` (Beta): checks a target's `/.well-known/security.txt`
  and legacy `/security.txt` locations, parses the RFC 9116 fields (Contact,
  Expires, Encryption, Preferred-Languages, Canonical, Policy, Hiring), and
  surfaces the published security contact, disclosure policy, and expiry
  status as evidence. Reports are shown in a new "Security Posture" report
  section. See `docs/CONNECTOR_SCORECARD.md`.

### Security
- API key secrets are now generated with a cryptographically secure random
  source (`crypto.randomBytes`) instead of `Math.random()`.
- Authentication is now required on the key management, job status, metrics,
  playground transform, and intelligence analysis endpoints, which were
  previously reachable without any credentials.
- API secrets are now masked everywhere except immediately after creation or
  rotation, where the full secret is shown exactly once. Listing or revoking
  a key never returns a usable secret value again.

### Fixed
- Removed three connectors (Google Search, legacy GitHub, News) that returned
  entirely fabricated data — invented repositories, press coverage, and
  search results — presented as verified, high-confidence evidence.
  Investigations now only surface data from connectors that query a real
  external source (WHOIS, DNS, GitHub REST API).
- Added a `verified` flag carried through connector results and evidence, so
  unverified data is structurally rejected before it can reach a report,
  rather than relying on keyword-based filtering alone.
- Fixed a display bug in the invest
