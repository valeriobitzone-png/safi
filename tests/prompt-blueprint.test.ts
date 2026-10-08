// @vitest-environment node
/**
 * The Universal Prompt Composer.
 *
 * The layer's whole promise is proportionality: a two-sentence request must
 * not come back wearing a project brief, and a genuinely underspecified build
 * request must not come back as one flat sentence. These tests hold that line,
 * and they also hold the two separations that matter more than the wording —
 * the composer never asks a question it does not need to, and it never speaks
 * in trust words that belong to the verifier.
 */
import { describe, expect, it } from "vitest";

import {
  MISSING_INFORMATION,
  PROMPT_BLUEPRINT_STATUS,
  PROMPT_COMPLEXITY,
  buildPromptBlueprint,
  composeUniversalPrompt,
  renderPromptBlueprint,
} from "../packages/prompt-blueprint/index.js";

describe("Universal Prompt Composer — proportionality", () => {
  it("keeps a simple, complete request simple", () => {
    const { blueprint, prompt, requiresClarification } = composeUniversalPrompt({
      message: "mi fai una mail al commercialista per dirgli che pago venerdì?",
    });
    expect(blueprint.complexity).toBe(PROMPT_COMPLEXITY.SIMPLE);
    expect(requiresClarification).toBe(false);
    // two plain sentences, not a project brief
    expect(prompt.text.split("\n")).toHaveLength(1);
    expect(prompt.text.length).toBeLessThanOrEqual(200);
    expect(prompt.text.toLowerCase()).toContain("commercialista");
    expect(prompt.text.toLowerCase()).toContain("venerdì");
    // and none of the scaffolding the old template always emitted
    expect(prompt.text).not.toMatch(/vincoli|formato richiesto|esito positivo|Rispetta questi/i);
  });

  it("does not interrogate someone who already said what they wanted", () => {
    const { requiresClarification, clarificationQuestions, blueprint } = composeUniversalPrompt({
      message: "Scrivi una mail breve al mio commercialista comunicandogli che venerdì effettuerò il pagamento.",
    });
    expect(requiresClarification).toBe(false);
    expect(clarificationQuestions).toHaveLength(0);
    expect(blueprint.missingEssentialInformation).toEqual([]);
  });

  it("still asks when the request genuinely cannot be acted on", () => {
    const { requiresClarification, clarificationQuestions } = composeUniversalPrompt({ message: "   " });
    expect(requiresClarification).toBe(true);
    expect(clarificationQuestions[0]).toMatch(/cosa vuoi ottenere/i);
  });

  it("records a missing recipient without ever blocking on it", () => {
    const { blueprint, requiresClarification, clarificationQuestions } = composeUniversalPrompt({ message: "mi scrivi una mail?" });
    // a coherent email can still be written, so this must not stop anything
    expect(requiresClarification).toBe(false);
    expect(clarificationQuestions).toEqual([]);
    expect(blueprint.missingEssentialInformation[0].field).toBe("audience");
    expect(blueprint.missingEssentialInformation[0].severity).toBe(MISSING_INFORMATION.OPTIONAL);
  });

  it("blocks only when there is no request at all to work from", () => {
    const cases = ["", "   ", "?"];
    for (const message of cases) {
      const { requiresClarification, blueprint } = composeUniversalPrompt({ message });
      const essential = blueprint.missingEssentialInformation.filter((entry) => entry.severity === MISSING_INFORMATION.ESSENTIAL);
      expect(essential.length).toBe(requiresClarification ? 1 : 0);
    }
  });

  it("records what it would like to know without ever blocking on it", () => {
    const { blueprint, requiresClarification } = composeUniversalPrompt({
      message:
        "Voglio costruire una web app per gestire le spese di famiglia, deve funzionare su mobile e desktop, con una dashboard per l'utente finale, login con email, export csv e test",
    });
    expect(requiresClarification).toBe(false);
    const severities = blueprint.missingEssentialInformation.map((entry) => entry.severity);
    expect(severities.every((severity) => severity === MISSING_INFORMATION.OPTIONAL)).toBe(true);
  });

  it("earns the full brief for a request that genuinely needs one", () => {
    const { blueprint, prompt } = composeUniversalPrompt({
      message:
        "Voglio costruire una web app per gestire le spese di famiglia, deve funzionare su mobile e desktop, con una dashboard per l'utente finale, login con email, export csv e test",
    });
    expect(blueprint.complexity).toBe(PROMPT_COMPLEXITY.COMPLEX);
    for (const field of ["objective", "context", "outputFormat", "successCriteria", "exclusions", "detailLevel"]) {
      expect(blueprint[field]).toBeTruthy();
    }
    expect(prompt.text).toMatch(/Formato richiesto/);
    expect(prompt.text).toMatch(/Il risultato è completo solo se/);
    expect(prompt.text).toMatch(/Non fare/);
    // the human's own words survive into the structured brief
    expect(prompt.text).toContain("spese di famiglia");
  });

  it("stays in the middle for a multi-part but non-build request", () => {
    const { blueprint } = composeUniversalPrompt({
      message:
        "Vorrei una presentazione per il consiglio d'amministrazione che copra i risultati dell'anno, i costi, i rischi e le prossime decisioni da prendere",
    });
    expect(blueprint.complexity).toBe(PROMPT_COMPLEXITY.STANDARD);
  });
});

describe("Universal Prompt Composer — separations", () => {
  it("never speaks in the verifier's trust vocabulary", () => {
    const { prompt, blueprint } = composeUniversalPrompt({
      message: "Voglio una web app per gestire le spese con login e export",
    });
    const text = `${prompt.text} ${JSON.stringify(blueprint)}`;
    expect(text).not.toMatch(/\bVERIFIED\b|\bUNCERTAIN\b|\bFAILED\b/);
  });

  it("never mentions a provider, a DOM node or a permission", () => {
    const { prompt, blueprint } = composeUniversalPrompt({ message: "Scrivi una mail al commercialista" });
    const text = `${prompt.text} ${JSON.stringify(blueprint)}`;
    for (const forbidden of ["gemini", "chatgpt", "openai", "document.", "querySelector", "composer:read", "permission"]) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("keeps the human message intact in the projection", () => {
    const original = "Perché la luna cambia forma?";
    const { prompt } = composeUniversalPrompt({ message: original });
    expect(prompt.originalMessage).toBe(original);
  });

  it("refuses to render something that is not a blueprint", () => {
    expect(() => renderPromptBlueprint({})).toThrow(/objective/);
  });

  it("freezes what it returns", () => {
    const { blueprint, prompt } = composeUniversalPrompt({ message: "spiegami in parole semplici cosa sono le maree" });
    expect(Object.isFrozen(blueprint)).toBe(true);
    expect(Object.isFrozen(prompt)).toBe(true);
  });

  it("publishes its own status", () => {
    expect(PROMPT_BLUEPRINT_STATUS).toMatch(/PROMPT COMPOSER/);
  });
});

describe("Universal Prompt Composer — rendering details that would embarrass it", () => {
  const build = (message: string) => composeUniversalPrompt({ message, semantic: { goal: message, task: message } });

  it("never doubles the verb when the objective already speaks", () => {
    const { prompt } = build("Voglio costruire una web app per le spese di famiglia, con login e export csv");
    expect(prompt.text).not.toMatch(/Voglio Voglio/i);
    expect(prompt.text.startsWith("Voglio costruire")).toBe(true);
  });

  it("does not invent a tone out of a build detail", () => {
    const { blueprint } = build("Voglio costruire una web app per le spese con login via email ed export csv");
    expect(blueprint.tone).toBeUndefined();
  });

  it("does invent one when the person is writing to someone", () => {
    const { blueprint } = build("mi fai una mail al commercialista per dirgli che pago venerdì");
    expect(blueprint.tone).toBe("professionale");
  });

  it("turns a first-person explanation request into an ask", () => {
    const { prompt, blueprint } = build("sto aprendo un ristorante, dimmi in parole semplici che cose devo considerare prima di scegliere il locale");
    expect(blueprint.shape).toBe("EXPLAIN");
    // the person already asked for plain words: Safi does not say it twice
    expect(prompt.text).not.toMatch(/Spiegami in parole semplici:/);
    expect(blueprint.detailLevel).toBeUndefined();
  });

  it("asks plainly when the person has not already said how", () => {
    const { prompt } = build("spiegami che cos'è il credito concesso");
    expect(prompt.text.startsWith("Spiegami in parole semplici:")).toBe(true);
  });

  it("separates its sentences properly", () => {
    const { prompt } = build("mi fai una mail al commercialista per dirgli che pago venerdì");
    expect(prompt.text).toBe("Scrivi una mail al commercialista per dirgli che pago venerdì. Mantieni un tono professionale.");
  });
});
