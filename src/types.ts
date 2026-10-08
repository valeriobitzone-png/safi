/**
 * Safi v0.1 — protocol types.
 *
 * Core contains only protocol types, the state machine, deterministic
 * verification aggregation, bounded correction orchestration and
 * certificate creation. Everything else is an adapter.
 */

/** Trust states. `VERIFIED` never means absolute truth. */
export type TrustStatus = "VERIFIED" | "UNCERTAIN" | "FAILED";

/** Control outcomes. Control flow is separate from answer trust. */
export type SafiOutcomeStatus = "RESULT" | "CLARIFICATION" | "REJECTED" | "ERROR";

/** Outcome of a single verification check. */
export type CheckOutcome = "PASS" | "INCONCLUSIVE" | "FAIL";

/** A raw request expressed naturally by a person. Not a prompt. */
export interface HumanRequest {
  /** The person's message, in their own words. */
  readonly message: string;
  /** Optional stable identifier for tracing. */
  readonly id?: string;
  /** Optional free-form metadata. Never used for verification semantics. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Structured semantic interpretation of the user's goal. */
export interface IntentFrame {
  /** What the person wants to achieve, restated neutrally. */
  readonly goal: string;
  /** The concrete task derived from the goal. */
  readonly task: string;
  /** Optional constraints declared or inferred (audience, language, depth...). */
  readonly constraints?: Readonly<Record<string, string>>;
  /** Optional clarifying questions when intent is ambiguous. */
  readonly clarificationQuestions?: readonly string[];
  /** True when the intent is too ambiguous to proceed without clarification. */
  readonly needsClarification: boolean;
}

/** Control decision: proceed, clarify, restrict or reject. */
export type GuardAction = "PROCEED" | "CLARIFY" | "RESTRICT" | "REJECT";

/** Result of the intent guard step. */
export interface GuardDecision {
  readonly action: GuardAction;
  /** Required when action is CLARIFY. */
  readonly questions?: readonly string[];
  /** Human-facing reason for RESTRICT/REJECT/CLARIFY. */
  readonly reason?: string;
}

/** Provider-neutral semantic request. */
export interface SafiRequest {
  readonly goal: string;
  readonly task: string;
  readonly constraints?: Readonly<Record<string, string>>;
  /** The original human message. Correction can never replace it. */
  readonly humanMessage: string;
  /** Attempt number: 1 for the initial request, incremented on correction. */
  readonly attempt: number;
  /** Structured semantic representation produced by the Human→AI translator. */
  readonly semantic?: SemanticRepresentation;
}

/** Untrusted generated result from a provider. */
export interface CandidateResponse {
  /** Raw generated text. Never trusted by itself. */
  readonly text: string;
  /** Identifier of the provider/adapter that produced the response. */
  readonly provider: string;
  /** Attempt this response belongs to (1-based). */
  readonly attempt: number;
  /** Optional raw provider payload kept for evidence. */
  readonly raw?: unknown;
}

/** Adapter that performs one named check against a candidate response. */
export interface Verifier {
  /** Identifier of the check this verifier performs (e.g. "sources", "math"). */
  readonly checkId: string;
  verify(candidate: CandidateResponse, context: VerificationContext): Promise<VerificationResult>;
}

/** Context handed to verifiers. Evidences are never invented by Core. */
export interface VerificationContext {
  readonly request: SafiRequest;
  /** The humanized (or raw, pre-humanization) text under verification. */
  readonly text: string;
  /** Original raw provider text, when verifying after humanization. */
  readonly rawText?: string;
  /** Results already collected on the raw text, when verifying after humanization. */
  readonly humanizationResults?: readonly VerificationResult[];
}

/** Outcome of one check performed by one verifier. */
export interface VerificationResult {
  readonly checkId: string;
  readonly outcome: CheckOutcome;
  /** Human-inspectable explanation. Every stamp must be explainable. */
  readonly detail: string;
  /** Optional structured evidence. Core never fabricates it. */
  readonly evidence?: unknown;
  readonly verifierId?: string;
}

/** Result of checking the humanized text for meaning preservation. */
export interface HumanizationCheck {
  readonly checkId: string;
  readonly outcome: CheckOutcome;
  readonly detail: string;
}

/**
 * Set of checks required before Safi may declare a response VERIFIED.
 * An empty scope can never produce VERIFIED.
 */
export interface VerificationScope {
  /** Check IDs that must all PASS (and be present) for VERIFIED. */
  readonly requiredChecks: readonly string[];
  /** Check IDs executed only for evidence; failures are ignored for trust status. */
  readonly optionalChecks?: readonly string[];
}

/** Declared verification policy for a run. */
export interface VerificationPolicy {
  readonly id: string;
  readonly scope: VerificationScope;
  /** Maximum correction attempts after the first response. Must be >= 0. */
  readonly maxCorrectionAttempts: number;
}

/** Deterministic aggregation of verification results. */
export interface VerificationSummary {
  readonly status: TrustStatus;
  /** Per-check aggregated outcome. */
  readonly checks: readonly VerificationResult[];
  /** Check IDs required by the scope that never produced a result. */
  readonly missingRequiredChecks: readonly string[];
  /** Required checks whose verifiers reported disagreement. */
  readonly conflictingChecks: readonly string[];
  /** Optional checks that failed or were inconclusive (ignored for status). */
  readonly ignoredOptionalFailures: readonly string[];
}

/** A revised request prepared after a correctable failure. */
export interface CorrectionPlan {
  /** Constraints added or strengthened for the retry. */
  readonly additionalConstraints?: Readonly<Record<string, string>>;
  /** Human-inspectable explanation of the correction. */
  readonly note: string;
}

/** Adapter that prepares a revised request after a correctable failure. */
export interface CorrectionStrategy {
  plan(input: {
    request: SafiRequest;
    summary: VerificationSummary;
    candidate: CandidateResponse;
    attempt: number;
  }): CorrectionPlan | null;
}

/** Machine-readable record of what was checked and what trust state resulted. */
export interface SafiCertificate {
  readonly schema: "safi-certificate/v0.1";
  readonly trustStatus: TrustStatus;
  /** Explicit verification scope. Never implicit. */
  readonly verificationScope: VerificationScope;
  readonly checks: readonly VerificationResult[];
  readonly missingRequiredChecks: readonly string[];
  readonly conflictingChecks: readonly string[];
  /** Attempt the certified answer belongs to. */
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly provider: string;
  readonly policyId: string;
  readonly createdAt: string;
  /** SHA-256 (hex) of the exact human-facing answer. */
  readonly responseSha256: string;
  /** History of failed attempts, when correction occurred. */
  readonly attemptHistory?: readonly AttemptRecord[];
}

/** One previously discarded attempt. */
export interface AttemptRecord {
  readonly attempt: number;
  readonly trustStatus: TrustStatus;
  readonly reason: string;
  readonly responseSha256: string;
}

/** The final answer shown to the human, plus its certificate. */
export interface SafiResult {
  readonly kind: "result";
  /** Exact text shown to the human. The certificate binds this text. */
  readonly answer: string;
  readonly certificate: SafiCertificate;
}

/** Safi asks the person for clarification instead of answering. */
export interface SafiClarification {
  readonly kind: "clarification";
  readonly questions: readonly string[];
  readonly reason?: string;
}

/** Safi refused to process the request. */
export interface SafiRejection {
  readonly kind: "rejected";
  readonly reason: string;
}

/** Safi could not complete the flow. */
export interface SafiError {
  readonly kind: "error";
  readonly message: string;
}

/** Top-level runtime outcome. Control flow, not trust. */
export type SafiOutcome = SafiResult | SafiClarification | SafiRejection | SafiError;

/** Converts a SafiRequest into a provider-specific execution. */
export interface ProviderAdapter {
  readonly id: string;
  execute(request: SafiRequest): Promise<CandidateResponse>;
}

/** Transforms accepted content for human comprehension, before final verification. */
export interface PresenterAdapter {
  readonly id: string;
  /** Returns the exact text that will be shown to the human. */
  present(input: {
    request: SafiRequest;
    candidate: CandidateResponse;
    summary: VerificationSummary;
  }): Promise<string>;
}

/* ------------------------------------------------------------------ */
/* Human→AI Translation (RFC 0001) — primary capability, equivalent    */
/* in importance to AI→Human Verification.                             */
/* ------------------------------------------------------------------ */

/**
 * Provider-neutral semantic representation of WHAT the person wants.
 * It is not a prompt: provider-specific formatting happens only inside
 * the Provider Adapter.
 */
export interface SemanticRepresentation {
  readonly kind: "semantic-representation/v0.1";
  readonly goal: string;
  readonly task: string;
  readonly constraints?: Readonly<Record<string, string>>;
  /** The person's words, carried verbatim. Never rewritten. */
  readonly originalMessage: string;
  /** Optional provenance notes about the interpretation. */
  readonly interpretationNotes?: readonly string[];
  /** Identifier of the translator that produced this representation. */
  readonly translatedBy: string;
}

/**
 * Translates human intent into a SemanticRepresentation.
 * It MUST preserve the human's purpose and MUST NOT produce or hint at
 * any provider-specific prompt. It is not a "prompt improver".
 */
export interface HumanToAITranslator {
  readonly id: string;
  translate(input: { human: HumanRequest; frame: IntentFrame }): SemanticRepresentation;
}

/* ------------------------------------------------------------------ */
/* Transport (RFC 0001) — provider-independent, zero dependencies.     */
/* ------------------------------------------------------------------ */

export type TransportMode = "EMBEDDED" | "COMPANION" | "MANUAL";

/** Ingress record: a human request as captured by a transport. */
export interface TransportIngress {
  readonly humanRequest: HumanRequest;
  readonly receivedAt: string;
  readonly transportId: string;
  readonly mode: TransportMode;
}

/** Declared capabilities of a transport. Safi never grants rights. */
export interface TransportCapability {
  readonly supportedModes: readonly TransportMode[];
  /** Whether the transport captures input/output automatically. */
  readonly autoCapture: { readonly input: boolean; readonly output: boolean };
  /** True when the transport needs no integration at all (MANUAL). */
  readonly integrationFree: boolean;
  /** COMPANION only: the deployer's declared legal basis for interception. */
  readonly interceptionLegality?: {
    readonly declared: boolean;
    readonly basis: string;
  };
}

/**
 * Minimal user-facing projection of the SafiCertificate (the Safi Stamp).
 * Produced only from a certificate; transports receive it deep-frozen and
 * can never alter the certified answer or the trust state.
 */
export interface SafiStamp {
  readonly schema: "safi-stamp/v0.1";
  readonly trustStatus: TrustStatus;
  readonly createdAt: string;
  readonly policyId: string;
  readonly responseSha256: string;
  readonly requiredChecks: readonly string[];
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly provider: string;
}

/** Delivery record: an outcome handed back to the person through a transport. */
export interface TransportDelivery {
  readonly transportId: string;
  readonly mode: TransportMode;
  readonly deliveredAt: string;
  /** Present only for RESULT outcomes: the stamp is a projection of the certificate. */
  readonly stamp?: SafiStamp;
  /** The certified outcome, deep-frozen. Mutating it throws. */
  readonly outcome: Readonly<SafiOutcome>;
}

/**
 * Moves human input in and certified outcomes out.
 * Transports move messages; they never alter certified outcomes,
 * certificates, hashes or trust states.
 */
export interface TransportAdapter {
  readonly id: string;
  readonly mode: TransportMode;
  readonly capabilities: TransportCapability;
  deliver(humanRequest: HumanRequest): TransportIngress | Promise<TransportIngress>;
  deliverOutcome(
    outcome: SafiOutcome,
    stamp: SafiStamp | undefined,
  ): TransportDelivery | Promise<TransportDelivery>;
}
