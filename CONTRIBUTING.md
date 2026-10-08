# Contributing to SAFI

Thanks for considering contributing.

## How SAFI is organized

SAFI is a protocol-first project. The core defines the protocol. Providers,
hosts, UI, verifiers and demos are adapters or consumers outside the core.

Before working on the core, make sure the change really belongs there.

## Getting started

See `docs/GETTING_STARTED.md`.

In short:

```bash
npm ci
npm run build
npm run typecheck
npm test
node tests/run-conformance.mjs
```

## What to focus on

Good contributions tend to be one of these:

- a clearer doc
- a better test
- a smaller, better-isolated adapter
- a conformance vector that captures a real edge case
- a bug fix with a reproducible check

If your change is bigger than that, say so explicitly in the PR description.

## What not to do lightly

- do not change core trust semantics without a clear reason
- do not add provider-specific logic into the core
- do not add secrets, local paths, or personal data
- do not weaken the no-secret and no-hidden-capture posture
- do not change schemas in a way that breaks existing vectors without
  explaining the migration

## Pull requests

A good PR description says:

- what changed
- why it changed
- how it was verified
- what, if anything, still needs device, browser-profile, or signing
  acceptance before it is fully done

If a change touches presentation, include the evidence you used to judge it.
A green test suite is necessary, but not always sufficient.

## Documentation

Docs should stay accurate and short. If the code changes, the docs should
catch up. If a doc makes a claim the code does not support, fix the doc.

## License

By contributing, you agree that your contributions to the software are
licensed under the Apache License 2.0 in `LICENSE`.

Brand assets are handled separately. See `BRAND-ASSETS-LICENSE.md`.

## Security

Do not open public issues for sensitive vulnerabilities. See `SECURITY.md`.
