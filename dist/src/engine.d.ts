import type { CorrectionStrategy, HumanRequest, IntentFrame, SafiOutcome, ProviderAdapter, PresenterAdapter, Verifier, HumanToAITranslator } from "./types.js";
/**
 * Interpreter from HumanRequest to IntentFrame.
 * Core ships a minimal deterministic interpreter; real intent
 * understanding is an adapter concern.
 */
export type IntentInterpreter = (human: HumanRequest) => IntentFrame | null;
/** Control decision produced by the intent guard. */
export type IntentDecision = {
    action: "PROCEED";
} | {
    action: "CLARIFY";
    questions: readonly string[];
    reason?: string;
} | {
    action: "RESTRICT";
    reason: string;
} | {
    action: "REJECT";
    reason: string;
};
/** Guard from IntentFrame to a control decision. Real policies are adapters. */
export type IntentGuard = (frame: IntentFrame) => IntentDecision;
/** Declared policy for one engine run. */
export interface SafiEnginePolicy {
    readonly id: string;
    readonly scope: {
        readonly requiredChecks: readonly string[];
        readonly optionalChecks?: readonly string[];
    };
    /** Maximum correction attempts after the first response. Integer >= 0. */
    readonly maxCorrectionAttempts: number;
}
export interface SafiEngineOptions {
    provider: ProviderAdapter;
    verifiers: readonly Verifier[];
    policy: SafiEnginePolicy;
    /** Bounded correction strategy; required when maxCorrectionAttempts > 0. */
    correctionStrategy?: CorrectionStrategy;
    /** Presenter/Empathy adapter. Runs BEFORE final verification (spec §17). */
    presenter?: PresenterAdapter;
    interpreter?: IntentInterpreter;
    guard?: IntentGuard;
    /**
     * Human→AI translator (RFC 0001). When absent, a deterministic default
     * translator preserves v0.1 behavior exactly.
     */
    translator?: HumanToAITranslator;
    /** Monotonic clock override for deterministic tests. */
    now?: () => Date;
}
/**
 * Safi state machine. Transitions are deterministic given inputs and
 * verifier outputs. No semantic rewrite happens after certification.
 */
export declare class SafiEngine {
    private readonly options;
    constructor(options: SafiEngineOptions);
    process(human: HumanRequest): Promise<SafiOutcome>;
}
//# sourceMappingURL=engine.d.ts.map