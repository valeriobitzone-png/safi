# RFC 0001 — Transport layer and Human→AI Translation as a primary capability

- Status: ACCEPTED (implemented in v0.1.x)
- Date: 2026-09-18
- Supersedes: nothing
- Superseded by: nothing

## Context

Safi v0.1 defined a complete AI→Human trust path: candidate answers are
verified, corrected within bounds, humanized and certified before reaching
the person. The Human→AI direction, however, was underspecified: an
`IntentFrame` existed, but nothing normative protected the translation from
the person's natural words to a provider-neutral semantic request.

Two gaps follow:

1. **Transport.** The spec describes a flow between a person and Safi, but
   never says *how* input reaches Safi or how the outcome and its stamp
   reach the person. Without a transport contract, every integration
   invents its own plumbing and may be tempted to post-process certified
   outcomes.
2. **Human→AI Translation.** "Improve the prompt" is not a protocol. If the
   translation step is free to reinterpret the person, the intent
   sovereignty invariant (spec §15.1) is silently lost.

This RFC extends the protocol. It does not change any existing v0.1
semantic. It is written here, openly, instead of silently altering the
protocol.

## Decision

### 1. Human→AI Translation is a primary capability

Human→AI Translation is declared **equivalent in importance to AI→Human
Verification**. The protocol now names both directions:

- **Human → AI**: translate human intent into a provider-neutral semantic
  representation. The provider-specific prompt is built *only* by the
  Provider Adapter.
- **AI → Human**: verify, correct within bounds, humanize, certify.

The translator MUST NOT be a "prompt improver". Its contract:

- It consumes the `HumanRequest` and the interpreted `IntentFrame`.
- It produces a `SemanticRepresentation`: an explicit, provider-neutral
  description of WHAT the person wants, not HOW a provider should be asked.
- It MUST preserve the person's goal, task and original wording
  (`humanMessage` remains immutable and is carried verbatim).
- It MUST NOT address any provider, format, model or prompt style.
- It MUST NOT remove or weaken constraints already present.
- It MAY record interpretation provenance (rules, patterns, interpreter
  id) for inspectability.

The **Provider Adapter** remains the only component that turns a semantic
representation into a provider-specific prompt.

### 2. TransportAdapter

A provider-independent interface with no dependencies in Core:

```text
TransportAdapter
  mode: TransportMode (EMBEDDED | COMPANION | MANUAL)
  deliver(humanRequest) -> TransportIngress
  deliverOutcome(outcome) -> TransportDelivery
  capability(): transport capability descriptor
```

- **EMBEDDED** — Safi is embedded directly in the application and captures
  input/output automatically through the host app's own channels.
- **COMPANION** — a browser extension, desktop overlay or host adapter
  intercepts conversations with external AI systems, where technically and
  legally permitted. Companion transports declare interception legality;
  Safi itself does not obtain any right.
- **MANUAL** — universal copy/paste fallback. Requires no integration at
  all and MUST always work.

Transport adapters move messages. They MUST NOT:

- alter a `SafiOutcome` after certification (outcomes are delivered
  deep-frozen; tampering throws);
- alter the `SafiCertificate`, its hash, or the trust status;
- see or modify the verification scope or verifier results before
  certification.

### 3. End-to-end loop

```text
Human natural input
  → Transport (capture)
  → Intent Interpreter
  → Human-to-AI Translator
  → SafiRequest (semantic representation attached)
  → Provider Adapter
  → AI
  → CandidateResponse
  → Humanizer
  → Verifiers
  → bounded correction if needed
  → SafiCertificate
  → Transport (delivery)
  → Human + Safi Stamp
```

`SafiStamp` is a minimal, structured projection of the certificate (status,
timestamp, policy, answer hash, scope summary). It is transport-safe by
construction: it is produced deep-frozen from the certificate and carries
no capability to change it.

### 4. Compatibility

- All v0.1 types, aggregation rules, trust semantics, correction bounds and
  certification ordering are unchanged.
- `SafiEngine` gains an optional `translator`. When absent, a deterministic
  default translator preserves the previous behavior exactly.
- All existing conformance vectors continue to pass unchanged.

## Consequences

- Three transport modes are normative; new modes require a new RFC.
- The stamp is a projection of the certificate, never a separate truth.
- Companion-mode legality is the deployer's responsibility; Safi only
  records what the transport declares.
- Manual mode is the universal floor: the protocol must remain fully usable
  with copy/paste alone.
