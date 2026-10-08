# SAFI Development

This is the day-to-day working guide for the public v0.1.0 codebase.

## Repository shape

The core lives in `src/`. Everything provider-specific, host-specific,
UI-specific or demo-specific lives outside the core.

Key areas:

- `src/` — core protocol types, state machine, aggregation, correction,
  certificate
- `packages/` — adapters, verifiers, transports, client, widget,
  companion, demo
- `apps/` — desktop, Android, iOS shells and mocks
- `ui/` — reference UX projection
- `tests/` — vitest suite, conformance vectors, conformance runner
- `tools/` — schema validation, staging, release helpers
- `golden/` — canonical visual references
- `schemas/` — JSON Schema contracts
- `examples/` — runtime examples and example payloads

## Local commands

```bash
npm ci
npm run build
npm run typecheck
npm test
node tests/run-conformance.mjs
npm run lint:ui-colors
npm run demo
npm run demo:check
npm run smoke
npm run smoke:wire
npm run validate
```

## Core rule

The core should stay boring and stable across preview releases. New host,
adapter, verifier and demo work should land outside the core when possible.

## Provider adapters

Provider adapters translate a `SafiRequest` into the provider-specific shape
and return a `CandidateResponse`. The adapter is the only place
provider-specific translation lives.

Credentials for the real-provider path come from environment variables only.

## Companion adapters

Companion site adapters encapsulate provider-specific DOM logic and selectors.
The companion controller stays provider-neutral.

Because companion acceptance can require an authenticated browser profile, it
is opt-in, not a default CI gate.

## Verifiers

Verifiers are swappable. The core defines the verifier interface; concrete
verifier implementations live outside the core.

## Tests

- Prefer tests that prove behavior, not ones that assert internal
  implementation detail.
- UI color semantics are enforced with a dedicated lint check.
- Visual acceptance for presentation changes should use the real build where
  practical and human review where judgment is required.
- Android device paths are opt-in. Use the Android Studio emulator for routine
  Android development.

## Adding files

Do not add generated binaries, local build output, local browser profiles, or
personal test data to the repository. The `.gitignore` already excludes the
main build artifacts; follow the same spirit for anything else that should
stay local.

## Code review discipline

Before landing a change:

- confirm it does not introduce secrets
- confirm it does not reintroduce personal paths
- confirm it does not change core trust semantics without a reason
- confirm the relevant conformance vectors still pass
- confirm the demo still verifies

## Presentation changes

Presentation-only changes should not alter protocol types, schemas, the state
machine, aggregation, or the certificate.

If a change touches the widget, mascot, or visual behavior, check the visual
tests and the visual evidence before claiming it is done.

## When in doubt

Read `docs/ARCHITECTURE.md`, then the relevant test file, then the relevant
host or package README. Do not start by editing the core.
