# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog.
SAFI uses Semantic Versioning.

## [0.1.0] - 2026-02-02

### Added

- SAFI protocol reference implementation:
  - protocol types
  - state machine
  - verification aggregation
  - bounded correction
  - certificate creation
- Human → AI translation path
- Universal Prompt Composer
- AI → Human translation path
- Verifier interface and swappable verifier implementations
- Transport model: EMBEDDED, COMPANION, MANUAL
- Companion transport with provider-neutral controller and
  provider-specific site adapters
- Desktop Alpha for macOS and Windows
- Android architecture and working mock
- iOS architecture and working mock
- 3:2 floating widget
- Reference UX projection as a zero-dependency Web Component
- Local end-to-end demo
- Conformance vectors and conformance runner
- Documentation set for the public release

### Trust model

- `VERIFIED`, `UNCERTAIN`, `FAILED` trust states
- Explicit verification scope
- Deterministic aggregation for required checks
- Separation of truth/evidence, fulfillment and completeness
- Exact-content SHA-256 certification of the human-facing answer

### Repository

- Apache License 2.0 for software
- `BRAND-ASSETS-LICENSE.md` for SAFI brand assets
- `NOTICE` file
- `THIRD_PARTY_NOTICES.md` for third-party components
- Public documentation: `README.md`, `ARCHITECTURE.md`,
  `GETTING_STARTED.md`, `TRUST_MODEL.md`, `PRIVACY.md`,
  `DEVELOPMENT.md`, `CONTRIBUTING.md`, `SECURITY.md`,
  `CHANGELOG.md`, `CODE_OF_CONDUCT.md`

### Not covered by this release

- absolute truth guarantees
- complete verifier coverage for every claim type
- complete native distribution signing and notarization for every platform
- production stability guarantees beyond Developer Preview status

### Notes

- Companion DOM adapters remain provider-specific and may need maintenance
  as provider UIs change.
- Mobile and iOS surface maturity differs from the desktop reference and is
  tracked honestly.

## Older history

Internal implementation history predates this public release. For the public
project, the meaningful baseline is the v0.1.0 Developer Preview.
