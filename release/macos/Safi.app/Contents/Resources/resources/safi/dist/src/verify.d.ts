import type { CandidateResponse, SafiRequest, VerificationPolicy, VerificationResult, VerificationScope, VerificationSummary, Verifier, VerificationContext } from "./types.js";
/**
 * Deterministic aggregation rules for one required check with multiple
 * verifier results (spec §18):
 *
 *   PASS + FAIL         -> UNCERTAIN (conflict)
 *   PASS + INCONCLUSIVE -> UNCERTAIN (conflict)
 *   FAIL + INCONCLUSIVE -> FAILED
 *   all PASS            -> PASS
 *
 * FAIL dominates INCONCLUSIVE; any disagreement that is not
 * FAIL-dominated becomes UNCERTAIN.
 */
export declare function aggregateCheckOutcomes(outcomes: readonly string[]): "PASS" | "FAIL" | "CONFLICT";
export interface AggregateOptions {
    /** Results already targeted at the final humanized text. */
    results: readonly VerificationResult[];
    /** Results targeted at the raw candidate text (merged for conflict detection). */
    rawResults?: readonly VerificationResult[];
}
/**
 * Aggregate verification results against a scope.
 *
 * Deterministic guarantees (spec §9):
 *   no checks executed          -> UNCERTAIN
 *   missing required check      -> UNCERTAIN
 *   any required FAIL           -> FAILED
 *   any required INCONCLUSIVE   -> UNCERTAIN
 *   all required PASS           -> VERIFIED
 *   empty required scope        -> never VERIFIED
 *
 * Optional checks never influence the trust status.
 */
export declare function aggregateVerification(scope: VerificationScope, options: AggregateOptions): VerificationSummary;
/**
 * Run every verifier once against the candidate text.
 * Verifier exceptions are captured as INCONCLUSIVE: a broken verifier
 * can never produce PASS.
 */
export declare function runVerifiers(verifiers: readonly Verifier[], candidate: CandidateResponse, context: VerificationContext): Promise<VerificationResult[]>;
/** Convenience: verify one candidate under a policy and aggregate. */
export declare function verifyCandidate(candidate: CandidateResponse, policy: VerificationPolicy, verifiers: readonly Verifier[], request: SafiRequest): Promise<VerificationSummary>;
//# sourceMappingURL=verify.d.ts.map