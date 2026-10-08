import { createHash } from "node:crypto";

import type {
  AttemptRecord,
  CandidateResponse,
  CorrectionStrategy,
  HumanRequest,
  IntentFrame,
  SafiCertificate,
  SafiOutcome,
  SafiRequest,
  SemanticRepresentation,
  VerificationContext,
  VerificationSummary,
  ProviderAdapter,
  PresenterAdapter,
  Verifier,
  HumanToAITranslator,
} from "./types.js";
import { aggregateVerification, runVerifiers } from "./verify.js";
import {
  DefaultHumanToAITranslator,
  DEFAULT_FORBIDDEN_PROVIDER_TERMS,
  assertProviderNeutral,
} from "./translate.js";

/**
 * Interpreter from HumanRequest to IntentFrame.
 * Core ships a minimal deterministic interpreter; real intent
 * understanding is an adapter concern.
 */
export type IntentInterpreter = (human: HumanRequest) => IntentFrame | null;

/** Control decision produced by the intent guard. */
export type IntentDecision =
  | { action: "PROCEED" }
  | { action: "CLARIFY"; questions: readonly string[]; reason?: string }
  | { action: "RESTRICT"; reason: string }
  | { action: "REJECT"; reason: string };

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
export class SafiEngine {
  constructor(private readonly options: SafiEngineOptions) {
    const { policy } = options;
    if (!Number.isInteger(policy.maxCorrectionAttempts) || policy.maxCorrectionAttempts < 0) {
      throw new Error("maxCorrectionAttempts must be an integer >= 0");
    }
    if (policy.maxCorrectionAttempts > 0 && !options.correctionStrategy) {
      throw new Error("maxCorrectionAttempts > 0 requires a correctionStrategy");
    }
    if (!options.provider) {
      throw new Error("A provider adapter is required");
    }
    if (!Array.isArray(options.verifiers)) {
      throw new Error("verifiers must be an array of Verifier adapters");
    }
  }

  async process(human: HumanRequest): Promise<SafiOutcome> {
    const { options } = this;
    const now = options.now ?? (() => new Date());

    // 1. Interpret intent.
    let frame: IntentFrame | null;
    try {
      frame = options.interpreter ? options.interpreter(human) : defaultInterpreter(human);
    } catch (error) {
      return { kind: "error", message: `Interpreter exception captured: ${describe(error)}` };
    }
    if (!frame) {
      return { kind: "rejected", reason: "Intent could not be interpreted." };
    }

    // 2. Guard.
    let decision: IntentDecision;
    try {
      decision = options.guard ? options.guard(frame) : defaultDecision(frame);
    } catch (error) {
      return { kind: "error", message: `Guard exception captured: ${describe(error)}` };
    }
    if (decision.action === "REJECT" || decision.action === "RESTRICT") {
      return { kind: "rejected", reason: decision.reason };
    }
    if (decision.action === "CLARIFY") {
      return {
        kind: "clarification",
        questions: decision.questions,
        ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
      };
    }

    // 3. Translate human intent into a provider-neutral semantic representation.
    let semantic: SemanticRepresentation;
    try {
      const translator = options.translator ?? new DefaultHumanToAITranslator();
      semantic = translator.translate({ human, frame });
      assertProviderNeutral(semantic, DEFAULT_FORBIDDEN_PROVIDER_TERMS);
    } catch (error) {
      return { kind: "error", message: `Translator exception captured: ${describe(error)}` };
    }

    // 4. Build the first SafiRequest. humanMessage is immutable afterwards.
    const baseRequest: SafiRequest = {
      goal: frame.goal,
      task: frame.task,
      ...(frame.constraints ? { constraints: { ...frame.constraints } } : {}),
      humanMessage: human.message,
      attempt: 1,
      semantic,
    };

    const maxAttempts = 1 + options.policy.maxCorrectionAttempts;
    const history: AttemptRecord[] = [];
    let request = baseRequest;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;
      request = { ...request, attempt, semantic: request.semantic ?? semantic };

      // 4. Provider executes the neutral semantic request.
      let response: CandidateResponse;
      try {
        response = await options.provider.execute(request);
      } catch (error) {
        return { kind: "error", message: `Provider exception captured: ${describe(error)}` };
      }

      // 5. Verify the raw candidate.
      const rawContext: VerificationContext = { request, text: response.text };
      const rawResults = await runVerifiers(options.verifiers, response, rawContext);
      let summary = aggregateVerification(options.policy.scope, { results: rawResults });

      // 6. Bounded correction on FAILED, only while budget remains.
      if (summary.status === "FAILED" && attempt < maxAttempts) {
        const plan = options.correctionStrategy!.plan({
          request,
          summary,
          candidate: response,
          attempt,
        });
        if (plan) {
          history.push({
            attempt,
            trustStatus: summary.status,
            reason: plan.note,
            responseSha256: sha256(response.text),
          });
          const constraints = mergeConstraints(request.constraints, plan.additionalConstraints);
          request = {
            goal: request.goal,
            task: request.task,
            ...(constraints ? { constraints } : {}),
            humanMessage: request.humanMessage,
            attempt: attempt + 1,
          };
          continue;
        }
        // No plan: fall through and certify the FAILED state honestly.
      }

      // 7. Humanize BEFORE final verification (spec §17).
      let answerText = response.text;
      if (options.presenter) {
        try {
          answerText = await options.presenter.present({
            request,
            candidate: response,
            summary,
          });
        } catch (error) {
          return { kind: "error", message: `Presenter exception captured: ${describe(error)}` };
        }
        // 8. Final verification targets the exact text the human will see.
        const humanizedContext: VerificationContext = {
          request,
          text: answerText,
          ...(response.text !== answerText ? { rawText: response.text } : {}),
          ...(rawResults.length > 0 ? { humanizationResults: rawResults } : {}),
        };
        const humanizedResults = await runVerifiers(options.verifiers, response, humanizedContext);
        summary = aggregateVerification(options.policy.scope, {
          results: humanizedResults,
          rawResults,
        });
      }

      // 9. Certify. No semantic rewrite after this point.
      const certificate = buildCertificate({
        policy: options.policy,
        summary,
        attempt,
        maxAttempts,
        provider: response.provider,
        answer: answerText,
        now: now(),
        history,
      });
      return { kind: "result", answer: answerText, certificate };
    }

    // Defensive: the loop always returns on its first iteration.
    return {
      kind: "error",
      message: "Attempt budget exhausted without a certified outcome.",
    };
  }
}

function mergeConstraints(
  base: Readonly<Record<string, string>> | undefined,
  added: Readonly<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (!base && !added) return undefined;
  const merged: Record<string, string> = {};
  if (base) Object.assign(merged, base);
  if (added) Object.assign(merged, added);
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function defaultInterpreter(human: HumanRequest): IntentFrame {
  const trimmed = human.message.trim();
  if (trimmed.length === 0) {
    return {
      goal: "clarify an empty request",
      task: "ask the person for a concrete request",
      needsClarification: true,
      clarificationQuestions: ["Could you state your request?"],
    };
  }
  return {
    goal: "answer the person's request",
    task: trimmed,
    needsClarification: false,
  };
}

function defaultDecision(frame: IntentFrame): IntentDecision {
  if (frame.needsClarification && frame.clarificationQuestions && frame.clarificationQuestions.length > 0) {
    return { action: "CLARIFY", questions: frame.clarificationQuestions };
  }
  return { action: "PROCEED" };
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface BuildCertificateInput {
  policy: SafiEnginePolicy;
  summary: VerificationSummary;
  attempt: number;
  maxAttempts: number;
  provider: string;
  answer: string;
  now: Date;
  history: readonly AttemptRecord[];
}

function buildCertificate(input: BuildCertificateInput): SafiCertificate {
  const { policy, summary, attempt, maxAttempts, provider, answer, now, history } = input;
  return {
    schema: "safi-certificate/v0.1",
    trustStatus: summary.status,
    verificationScope: {
      requiredChecks: [...policy.scope.requiredChecks],
      ...(policy.scope.optionalChecks
        ? { optionalChecks: [...policy.scope.optionalChecks] }
        : {}),
    },
    checks: summary.checks,
    missingRequiredChecks: summary.missingRequiredChecks,
    conflictingChecks: summary.conflictingChecks,
    attempt,
    maxAttempts,
    provider,
    policyId: policy.id,
    createdAt: now.toISOString(),
    responseSha256: sha256(answer),
    ...(history.length > 0 ? { attemptHistory: history } : {}),
  };
}
