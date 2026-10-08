// Editable source for every mobile host. tools/stage-mobile-assets.mjs packages it.
import { PlainLanguageTranslator } from "./dist/src/translate.js";
import { createSafiClient } from "./packages/safi-client/index.js";
import { createSafiWidget } from "./packages/safi-widget/index.js";
import { deliverTranslatedPrompt } from "./packages/ask-prompt-renderer/index.js";
import { createCalculationVerifier } from "./packages/verifier-calculation/index.js";

const coherence = {
  checkId: "coherence",
  async verify(candidate) {
    const answer = String(candidate.text ?? "").trim();
    const coherent = answer.length > 0 && !/^no\b/i.test(answer);
    return {
      checkId: "coherence",
      outcome: coherent ? "PASS" : "FAIL",
      detail: coherent
        ? "La risposta è pertinente alla richiesta."
        : "La risposta non è pertinente alla richiesta.",
      verifierId: "mobile-coherence",
    };
  },
};

const widget = createSafiWidget({
  host: { hostId: "safi-mobile", platform: "mobile" },
});

const client = createSafiClient({
  deps: {
    // createSafiClient requires a provider; translation and pasted-answer
    // verification never execute it.
    provider: {
      id: "mobile-unused-provider",
      async execute() {
        throw new Error("Mobile Ask must not execute a provider");
      },
    },
    verifiers: [coherence],
    translator: new PlainLanguageTranslator(),
  },
  policy: {
    id: "mobile-companion",
    scope: { requiredChecks: ["coherence"] },
    maxCorrectionAttempts: 0,
  },
});

async function ask(message) {
  if (typeof message !== "string" || message.trim().length === 0) {
    throw new Error("ask requires the human message");
  }
  if (widget.get().state !== "IDLE") widget.transition("IDLE");
  widget.transition("UNDERSTANDING");
  widget.transition("TRANSLATING");
  const translation = client.translate({ message });
  const prompt = deliverTranslatedPrompt(translation);
  widget.transition("PROMPT_READY");
  return { translation, prompt };
}

async function verify(answer) {
  if (typeof answer !== "string" || answer.trim().length === 0) {
    return { message: "Incolla prima la risposta da verificare." };
  }
  const hasArithmetic = /(\d+\s*[+×x*/\-÷]\s*\d+)/.test(answer);
  const policy = hasArithmetic
    ? {
        id: "mobile-verify-calculation",
        scope: { requiredChecks: ["coherence", "calculation"] },
        maxCorrectionAttempts: 0,
      }
    : undefined;
  if (widget.get().state !== "IDLE") widget.transition("IDLE");
  widget.transition("VERIFYING");
  const outcome = await client.verify({
    answer,
    providerId: "external-ai-pasted",
    ...(hasArithmetic
      ? { verifier: createCalculationVerifier({ checkId: "calculation" }) }
      : {}),
    ...(policy ? { policy } : {}),
  });
  widget.showOutcome(outcome);
  return outcome;
}

globalThis.SafiBrain = { ask, verify };
