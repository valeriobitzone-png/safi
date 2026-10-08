# Safi Glossary

**HumanRequest**  
Raw request expressed naturally by a person.

**IntentFrame**  
Structured semantic interpretation of the user's goal.

**GuardDecision**  
Control decision: proceed, clarify, restrict or reject.

**SafiRequest**  
Provider-neutral semantic request.

**Provider Adapter**  
Converts a SafiRequest into a provider-specific execution and returns a CandidateResponse.

**CandidateResponse**  
Untrusted generated result from a provider.

**Verifier**  
Adapter that performs one named check against a candidate response.

**VerificationResult**  
Outcome of one check: PASS, INCONCLUSIVE or FAIL.

**Verification Scope**  
Set of checks required before Safi may declare the response VERIFIED.

**Safi Client (shared)**
The one protocol consumer shared by every Safi host. Exposes
submitHumanRequest, translate, execute, verify and getCertificate. No
trust semantics may be duplicated in a host.

**Host Adapter**
Platform-specific shell (desktop, Android bubble, iOS extensions) that
hosts the widget and captures input with explicit consent. Adapters
can never alter a certificate.

**Host Capability (consent-gated)**
A declared host ability (clipboard paste, overlay bubble, companion
interception, telemetry). Every sensitive capability starts denied and
requires explicit consent; visible actions (global shortcut, manual
input) do not read anything.

**Safi Widget Brain**
The single state machine shared by all hosts: pipeline states
(UNDERSTANDING, TRANSLATING, WAITING_AI, HUMANIZING, VERIFYING,
CORRECTING) plus terminal trust states (VERIFIED, UNCERTAIN, FAILED),
per the Visual Contract.

**Trust Status**  
VERIFIED, UNCERTAIN or FAILED.

**CorrectionStrategy**  
Adapter that prepares a revised request after a correctable failure.

**Presenter / Empathy Adapter**  
Transforms accepted content for human comprehension without changing trust semantics.

**SafiCertificate**  
Machine-readable record of what was checked and what trust state resulted.

**Safi Stamp**  
Minimal user-facing projection of the certificate.

**SafiOutcome**  
Top-level runtime outcome: RESULT, CLARIFICATION, REJECTED or ERROR.

**Human→AI Translator**  
Adapter that preserves human intent and produces a provider-neutral SemanticRepresentation. It is not a prompt improver: provider-specific wording belongs to the Provider Adapter only.

**SemanticRepresentation**  
Provider-neutral description of WHAT the person wants; carries the original message verbatim.

**TransportAdapter**  
Provider-independent bridge that delivers human input in and certified outcomes out. Modes: EMBEDDED, COMPANION, MANUAL.

**TransportMode**  
EMBEDDED (in-app automatic capture), COMPANION (extension/overlay interception where permitted), MANUAL (universal copy/paste fallback).

**SafiStamp**  
Minimal user-facing projection of the certificate; deep-frozen and transport-safe.

**Safi Stamp (UI projection)**  
Reference Web Component (`ui/safi-stamp.js`) that renders the stamp at three disclosure levels. Presentation only: it cannot alter certified state.
