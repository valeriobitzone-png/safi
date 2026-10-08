# SAFI Architecture

SAFI is a provider-neutral trust layer between a person and any AI
system. The core defines the protocol. Everything else is an adapter.

## Flow

```
HUMAN LANGUAGE
      ↓
HumanRequest
      ↓
Intent interpreter
      ↓
IntentFrame
      ↓
Intent guard
      ↓
SafiRequest
      ↓
ProviderAdapter
      ↓
any AI / system
      ↓
CandidateResponse
      ↓
VerifierAdapter(s)
      ↓
VerificationResult(s)
      ↓
deterministic aggregation
      ↓
bounded correction, if any
      ↓
SafiCertificate
      ↓
Presenter / Empathy adapter
      ↓
HUMAN + SAFI STAMP
```

## Core

Core contains only the protocol pieces:

- protocol types
- the state machine
- verification aggregation
- bounded correction orchestration
- certificate creation

Core does **not** contain:

- LLMs
- search
- browsers
- databases
- agents
- React
- UI
- provider-specific logic

Provider-specific DOM logic stays inside site adapters.

## Universal Prompt Composer

Human language is not a prompt. SAFI interprets the intent, produces an
`IntentFrame`, then builds a semantically neutral `SafiRequest`.

Only the `ProviderAdapter` maps that meaning to the shape the destination
system expects. That is why one provider can be swapped for another without
changing the protocol.

## ProviderAdapter

`ProviderAdapter` turns a `SafiRequest` into the provider-specific request
and returns a `CandidateResponse`.

The adapter is the only place provider-specific translation lives.

## TransportAdapter

SAFI reaches people through a provider-independent transport:

- `EMBEDDED` — SAFI is inside the host app; input/output is captured
  automatically.
- `COMPANION` — a browser extension, desktop overlay or host adapter
  accompanies an external AI conversation where technically and legally
  permitted.
- `MANUAL` — universal copy/paste fallback; no integration required.

Transports move messages. They can never alter a certified outcome.

## Companion model

Companion control is provider-neutral. Provider-specific selectors and DOM
behavior stay inside the site adapters, for example:

```
ChatGPTSiteAdapter ─┐
                   ├─→ provider-neutral Companion controller
GeminiSiteAdapter ─┘
```

## Verifier pipeline

Core defines the `Verifier` interface. A verifier may check, for example:

- arithmetic
- sources
- coherence
- freshness
- code
- schema
- domain
- citations
- policy

Different verifier implementations can be swapped without changing core
semantics.

## Fulfillment / Completeness Judge

SAFI keeps three questions separate:

- **Truth / Evidence** — is a claim supported?
- **Fulfillment** — did the answer address the actual ask?
- **Completeness** — is something important missing?

The judge layer works with these as distinct concerns. Trust states belong
to the evidence/trust layer, not to a generic quality score.

## Claim model

SAFI can work at the level of individual claims rather than treating an
answer as one opaque block. That lets evidence and trust be attached where
they actually belong.

## AI → Human Translator

A response from the provider is always a `CandidateResponse`. It is never
automatically a verified answer.

SAFI can humanize the response before final verification, then certify the
exact text the human will see.

## Certificate

The `SafiCertificate` binds the answer to:

- trust status
- checks performed
- verification scope
- attempt
- provider
- policy
- timestamp
- optional SHA-256 of the exact human-facing answer
- optional attempt history

The certificate is handed to transports deep-frozen. The SAFI Stamp is a
read-only projection of the certificate.

## Important invariants

- streaming response ≠ certifiable response
- the final displayed text is hashed
- mutation before projection → abort
- verification ≠ authorization
- provider-specific DOM logic stays inside the site adapter
- no component can modify a `SafiCertificate`, a trust status, or a
  semantic request

## Boundary summary

| In core | Outside core |
| --- | --- |
| types, state machine, aggregation, correction, certificate | providers, DOM, search, UI, LLM, database |

## Companion surface set

SAFI is designed to travel with the person across surfaces, including:

- ChatGPT Companion
- Gemini Companion
- macOS floating companion
- Android true `TYPE_APPLICATION_OVERLAY` companion
- 3:2 floating widget

Each surface is a consumer of the same brain. Hosts do not duplicate trust
semantics.
