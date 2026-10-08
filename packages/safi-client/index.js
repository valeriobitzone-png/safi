/**
 * Safi Client — the shared brain of every Safi host. OUTSIDE the core.
 *
 * One client, four hosts (macOS, Windows, Android, iOS). The client
 * consumes the existing protocol contracts; it never duplicates trust
 * semantics: statuses, aggregation and certificates come only from the
 * core engine, stamps only from projectStamp, immutability only from
 * deepFreeze.
 *
 * Conceptual API (mandate):
 *   submitHumanRequest()  hand over natural human input
 *   translate()           Human→AI translation preview (no execution)
 *   execute()             full pipeline → certified outcome
 *   verify()              verify an external AI answer (AI→Human)
 *   getCertificate()      read the certificate of the last result
 *
 * The pipeline states it reports follow the approved UX Visual
 * Contract and are presentation labels only — never trust semantics.
 */

import { SafiEngine } from "../../dist/src/engine.js";
import { deepFreeze, projectStamp } from "../../dist/src/transport.js";
import { PlainLanguageTranslator } from "../../dist/src/translate.js";

/** Presentation labels from UX_VISUAL_SPEC_v0.1 (not trust states). */
export const WIDGET_STATES = deepFreezeCopy([
  "IDLE",
  "UNDERSTANDING",
  "TRANSLATING",
  "WAITING_AI",
  "HUMANIZING",
  "VERIFYING",
  "CORRECTING",
  "VERIFIED",
  "UNCERTAIN",
  "FAILED",
]);

/** Maps a certified outcome to its final widget state label. */
export function terminalStateFor(outcome) {
  if (outcome.kind !== "result") return "IDLE";
  return outcome.certificate.trustStatus; // VERIFIED | UNCERTAIN | FAILED
}

function deepFreezeCopy(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreezeCopy(value[key]);
    }
  }
  return value;
}

/**
 * Creates the shared Safi client.
 *
 * @param {object} options
 * @param {object}   options.deps            injected adapters (no hard deps)
 * @param {object}   [options.deps.provider] ProviderAdapter
 * @param {Array}    [options.deps.verifiers] Verifier list
 * @param {object}   [options.deps.interpreter] (HumanRequest) => IntentFrame|null
 * @param {object}   [options.deps.translator] HumanToAITranslator
 * @param {object}   [options.deps.presenter] PresenterAdapter
 * @param {object}   [options.deps.correctionStrategy] CorrectionStrategy
 * @param {object}   options.policy           { id, scope, maxCorrectionAttempts }
 * @param {object}   [options.transport]      TransportAdapter for the loop
 * @param {(state: string, info?: object) => void} [options.onState]
 *        widget state callback (presentation only)
 */
export function createSafiClient(options) {
  const { deps = {}, policy, transport, onState } = options ?? {};
  if (!policy) throw new Error("createSafiClient requires a policy");
  if (!deps.provider) throw new Error("createSafiClient requires a provider adapter");

  const translator = deps.translator ?? new PlainLanguageTranslator();
  const engine = new SafiEngine({
    provider: deps.provider,
    verifiers: deps.verifiers ?? [],
    policy,
    ...(deps.interpreter ? { interpreter: deps.interpreter } : {}),
    translator,
    ...(deps.presenter ? { presenter: deps.presenter } : {}),
    ...(deps.correctionStrategy ? { correctionStrategy: deps.correctionStrategy } : {}),
  });

  let lastOutcome = undefined;

  const emit = (state, info) => {
    if (onState) onState(state, deepFreezeCopy(info ?? {}));
    return state;
  };

  return {
    /** The engine is the one shared brain; hosts never rebuild it. */
    engine,
    translator,

    /** Human→AI translation preview: no execution, no trust change. */
    translate(human) {
      emit("UNDERSTANDING", { phase: "interpret" });
      const frame = deps.interpreter
        ? deps.interpreter(human)
        : undefined;
      if (!frame) {
        // Deterministic default: reuse the core default via a tiny run
        // through the translator contract with a neutral frame.
        emit("TRANSLATING", { phase: "translate" });
        const semantic = translator.translate({
          human,
          frame: {
            goal: "answer the person's request",
            task: human.message.trim().toLowerCase().replace(/[?.!]+$/, ""),
            needsClarification: false,
          },
        });
        return deepFreezeCopy({ frame: undefined, semantic });
      }
      emit("TRANSLATING", { phase: "translate" });
      const semantic = translator.translate({ human, frame });
      return deepFreezeCopy({ frame, semantic });
    },

    /**
     * Full pipeline: HumanRequest → engine → certified outcome.
     * Widget states are emitted for presentation only.
     */
    async submitHumanRequest(human) {
      lastOutcome = undefined;
      emit("UNDERSTANDING", { phase: "interpret" });
      emit("TRANSLATING", { phase: "translate" });
      emit("WAITING_AI", { phase: "provider" });
      const outcome = await engine.process(human);
      if (outcome.kind === "result") {
        emit("HUMANIZING", { phase: "humanize" });
        emit("VERIFYING", { phase: "verify", attempt: outcome.certificate.attempt });
        if (outcome.certificate.attemptHistory?.length) {
          emit("CORRECTING", { attempts: outcome.certificate.attemptHistory.length });
        }
        lastOutcome = outcome;
        emit(outcome.certificate.trustStatus, { outcome });
      } else {
        lastOutcome = outcome;
        emit("IDLE", { outcome });
      }
      return outcome;
    },

    /**
     * execute(): the same as submitHumanRequest, routed through the
     * host's transport so ingress/delivery records are produced.
     */
    async execute({ message, humanRequest, transport: overrideTransport } = {}) {
      const t = overrideTransport ?? transport;
      if (!t) {
        return this.submitHumanRequest(humanRequest ?? { message: message ?? "" });
      }
      const { safiLoop } = await import("../../dist/src/transport.js");
      emit("WAITING_AI", { phase: "loop" });
      const loopResult = await safiLoop({
        engine,
        transport: t,
        ...(humanRequest ? { humanRequest } : { message: message ?? "" }),
      });
      if (loopResult.delivery.outcome.kind === "result") {
        lastOutcome = loopResult.delivery.outcome;
        emit(loopResult.delivery.outcome.certificate.trustStatus, {
          outcome: loopResult.delivery.outcome,
        });
      } else {
        lastOutcome = loopResult.delivery.outcome;
        emit("IDLE", { outcome: loopResult.delivery.outcome });
      }
      return loopResult;
    },

    /**
     * verify(): AI→Human verification of an answer produced by any
     * external AI. The external answer is treated exactly like an
     * untrusted CandidateResponse; the required checks decide trust.
     */
    async verify({ answer, providerId = "external-ai", verifier: extraVerifier, policy: policyOverride } = {}) {
      if (typeof answer !== "string" || answer.length === 0) {
        throw new Error("verify requires the external AI answer text");
      }
      const effectivePolicy = policyOverride ?? policy;
      const required = effectivePolicy.scope.requiredChecks;
      if (required.length === 0) {
        throw new Error(
          "verify refuses an empty verification scope: an empty scope can never produce VERIFIED",
        );
      }
      const externalProvider = {
        id: providerId,
        execute: async () => ({ text: answer, provider: providerId, attempt: 1 }),
      };
      const verifiers = [...(deps.verifiers ?? [])];
      if (extraVerifier) verifiers.push(extraVerifier);
      // Neutral deterministic frame: the pasted text is an answer to
      // verify, not a new request to interpret.
      const verifyInterpreter =
        deps.interpreter ??
        ((human) => ({
          goal: "verify an answer produced by an AI system",
          task: human.message.trim(),
          needsClarification: false,
        }));
      const verifyEngine = new SafiEngine({
        provider: externalProvider,
        verifiers,
        policy: effectivePolicy,
        interpreter: verifyInterpreter,
        translator,
      });
      emit("VERIFYING", { phase: "external-answer" });
      const outcome = await verifyEngine.process({ message: answer });
      lastOutcome = outcome;
      if (outcome.kind === "result") {
        emit(outcome.certificate.trustStatus, { outcome });
      } else {
        emit("IDLE", { outcome });
      }
      return outcome;
    },

    /** Certificate of the last certified result (read-only view). */
    getCertificate() {
      if (!lastOutcome || lastOutcome.kind !== "result") return undefined;
      return deepFreezeCopy(lastOutcome.certificate);
    },

    /** Stamp of the last certified result (read-only projection). */
    getStamp() {
      const certificate = this.getCertificate();
      return certificate ? projectStamp(certificate) : undefined;
    },
  };
}
