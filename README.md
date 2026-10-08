# SAFI

The bidirectional interface between humans and AI.

SAFI lets people speak naturally to AI. It structures human intent into
AI-ready requests, then evaluates AI responses for evidence, fulfillment
and completeness before translating them back into clear human language.

Human → SAFI → AI → SAFI → Human.

```
HUMAN LANGUAGE
      ↓
Understand · Compose · Translate
      ↓
      AI
      ↓
Verify · Judge · Humanize
      ↓
CLEARER, EVIDENCE-AWARE OUTPUT
```

## What SAFI does

SAFI sits between a person and any AI system. It does not replace the
AI; it gives the interaction a shared structure the person can actually
read.

The public reference today is a **Developer Preview**.

### Human → AI

- **Universal Prompt Composer.** SAFI takes ordinary human language and
  turns it into a semantically neutral request the AI can act on without
  the person having to learn prompt craft.
- **Human → AI translation.** Informal intent is preserved, not rewritten
  into a technical prompt the person never sees.
- **Exact-response capture.** The answer the AI actually returned is
  captured and bound to the certificate, not paraphrased later.

### AI → Human

- **AI → Human translator.** SAFI can restate a response in clearer human
  language before the person reads it.
- **Claim-level handling.** Individual factual claims can be surfaced and
  evaluated rather than treating an answer as one opaque block.
- **Trust semantics.** Each certified response carries one of:

  - `VERIFIED`
  - `UNCERTAIN`
  - `FAILED`

  These are trust/evidence signals, not generic quality scores.

- **Exact-content SHA-256 certification.** The certificate is bound to the
  exact text shown to the human.

### Verification

SAFI separates three questions that are often collapsed into one:

- **Truth / Evidence** — Is a factual claim actually supported?
- **Fulfillment** — Did the AI answer what the person asked?
- **Completeness** — Is something important missing?

`VERIFIED` means the declared checks passed. It does **not** mean
absolute truth, nor does it mean the answer is high quality,
complete, or safe. `UNCERTAIN` means SAFI does not have enough evidence.
`FAILED` means at least one required check failed.

### Transports

SAFI reaches people through a provider-independent transport layer:

- **Manual transport.** Copy/paste fallback. No integration required.
- **Embedded transport.** SAFI lives inside the host app.
- **Companion transport.** SAFI accompanies an existing AI session where
  technically and legally permitted.

### Companion surfaces

SAFI is built to travel with the person across surfaces:

- ChatGPT Companion
- Gemini Companion
- macOS floating companion
- Android true `TYPE_APPLICATION_OVERLAY` companion
- 3:2 floating widget
- Explicit permission model
- Streaming protection
- Mutation guard
- Manual fail-closed fallback

### Host independence

The same certificate is interpreted the same way on every host. The core
defines the protocol. LLMs, search, browsers, databases, UI frameworks and
provider-specific logic are adapters outside the core.

## Developer Preview

SAFI v0.1 is a Developer Preview.

It is a protocol-first release: contracts, state machine, trust semantics,
deterministic aggregation, bounded correction, a reference runtime and
conformance vectors.

What this preview does **not** claim:

- it is always correct
- it guarantees truth
- it is complete for every provider or surface

Platform and distribution maturity, companion DOM adapters, and verifier
coverage all improve over time. Companion DOM adapters can require
maintenance as provider UIs change. Mobile and iOS maturity are
tracked honestly where they differ from the desktop reference.

## Supported surfaces

- Desktop Alpha for macOS and Windows: floating widget, loopback bridge,
  tray support via a thin native shell.
- Android: architecture plus a working mock with an optional overlay
  bubble behind an explicit permission, share sheet and manual fallback.
- iOS: architecture plus a working mock where a global overlay is
  platform-forbidden; app, Share Extension, Safari Extension, Shortcuts
  and keyboard are future capability directions.

## Project status

- **Core protocol:** stable for this preview.
- **Reference runtime:** usable and tested.
- **Companion adapters:** provider-specific DOM logic is intentionally
  encapsulated in site adapters and can change as provider UIs change.
- **Verifier coverage:** depends on the available check types and evidence.
- **Native distribution:** signing and distribution steps are documented
  where relevant and are not assumed to be complete for every platform.

## Repository layout

```
packages/
  core/                  structural boundary over the core protocol
  safi-client/           the one protocol consumer
  safi-widget/           one widget brain: pipeline + trust states
  host-contract/         consent-first capabilities
  adapter-provider-demo/ env-only real provider + deterministic demo
  verifier-calculation/  model-independent arithmetic verifier
  verifier-source/       external-source verifier (fetchFn injectable)
  transport-manual/      MANUAL transport with frozen outcomes
  prompt-blueprint/      prompt authoring helpers
  ask-prompt-renderer/   ask-side prompt rendering
  claims/                claim model support
  humanizer/             empathy / humanization adapter
  judge/                 fulfillment/completeness judgment support
  demo-web/              local end-to-end demo
  companion/             companion transport and site adapters

apps/
  desktop/               Desktop Alpha (macOS + Windows)
  android/               Android architecture + working mock
  ios/                   iOS architecture + working mock

ui/                      reference UX projection (zero-dependency Web Component)
docs/                    architecture and operational docs
tests/                   vitest suite, conformance vectors, conformance runner
tools/                   schema validation, staging, release helpers
golden/                  canonical visual references
examples/                runtime examples and example payloads
schemas/                 JSON Schema contracts
rfcs/                    protocol decisions and extensions
```

## Getting started

From a fresh clone:

```bash
npm ci
npm run build        # tsc -p tsconfig.json
npm test             # ui color semantics + vitest suite
npm run typecheck    # tsc -p tsconfig.json --noEmit
node tests/run-conformance.mjs
```

Useful daily commands:

```bash
npm run demo         # local end-to-end demo
npm run demo:check   # verify the demo scenarios and their certificates
npm run smoke        # build + run basic-flow example
npm run smoke:wire   # OpenAI-compatible wire shape against a local stub
npm run validate     # validate example payloads against schemas
npm run lint:ui-colors
```

Provider credentials for the real-provider smoke come exclusively from
environment variables and are never stored. Without them the smoke skips
honestly.

Static reference states for the UX projection can be opened directly in a
browser:

```text
ui/mocks/desktop.html
ui/mocks/mobile.html
ui/mocks/companion.html
ui/mocks/manual.html
```

## Trust model in brief

An empty verification scope can never be `VERIFIED`.

For one required check, the deterministic aggregation is:

```text
no required checks   -> UNCERTAIN
missing check        -> UNCERTAIN
all PASS             -> VERIFIED contributing
PASS + FAIL          -> UNCERTAIN (conflict)
PASS + INCONCLUSIVE  -> UNCERTAIN (conflict)
FAIL + INCONCLUSIVE  -> FAILED
```

Optional checks never change the trust status. A broken verifier can never
produce `PASS`; verifier exceptions are captured as `INCONCLUSIVE`.

The empathy/humanizer adapter runs **before** final verification. The
certificate binds the exact text shown to the human.

## License

Software: Apache License 2.0. See `LICENSE`.

Brand assets — the SAFI name, logos, mascot, character artwork and
canonical production mascot assets — are **not** licensed under Apache-2.0
and remain all rights reserved. See `BRAND-ASSETS-LICENSE.md`.

Third-party components, where present, are listed in
`THIRD_PARTY_NOTICES.md`.

## Contributing

See `CONTRIBUTING.md`.

## Security

See `SECURITY.md`.

## Changelog

See `CHANGELOG.md`.

## Code of conduct

See `CODE_OF_CONDUCT.md`.
