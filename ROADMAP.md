# Safi Roadmap

## v0.1 — Contract first
Goal: prove the protocol.

Deliverables:
- invariants;
- data contracts;
- state machine;
- trust semantics;
- deterministic aggregation;
- correction bounds;
- reference runtime;
- conformance vectors.

Exit condition:
Two different provider adapters and two different verifier implementations can be swapped without changing Safi Core semantics.

## v0.1.1 — Hardened reference implementation
- exhaustive tests;
- schema validation in CI;
- property-based state tests;
- runtime event hooks;
- privacy tests.

## v0.2 — Interoperability
Potential candidates:
- adapter capability discovery;
- canonical certificate serialization;
- claim-level verification;
- verifier attestation;
- signed certificates.

## v1.0 — Stable protocol
Requirements before 1.0:
- real-world implementation feedback;
- security review;
- stable trust semantics;
- stable certificate schema;
- stable conformance suite;
- at least two independent implementations or adapter ecosystems.

## Explicit anti-roadmap

Do not rush to add:
- dashboards;
- autonomous agent swarms;
- proprietary orchestration;
- giant policy engines;
- mandatory cloud services.

Safi wins if the core stays boring.
