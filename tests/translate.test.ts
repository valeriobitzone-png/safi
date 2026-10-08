import { describe, expect, it } from "vitest";

import { SafiEngine } from "../src/engine.js";
import {
  DefaultHumanToAITranslator,
  PlainLanguageTranslator,
  assertProviderNeutral,
  DEFAULT_FORBIDDEN_PROVIDER_TERMS,
} from "../src/translate.js";
import type {
  CandidateResponse,
  HumanRequest,
  IntentFrame,
  ProviderAdapter,
  SafiRequest,
} from "../src/types.js";

function frameOf(task: string, goal = "answer the person's request"): IntentFrame {
  return { goal, task, needsClarification: false };
}

describe("Human→AI translation — purpose preservation", () => {
  it("an informal human phrase is translated without changing its purpose", () => {
    const translator = new PlainLanguageTranslator();
    const human: HumanRequest = {
      message: "Ciao, per favore spiegami le ondas gravitazionali come se non sapessi nulla di fisica.",
    };
    const frame = frameOf(human.message.trim());
    const semantic = translator.translate({ human, frame });

    expect(semantic.originalMessage).toBe(human.message);
    expect(semantic.task).not.toContain("Ciao");
    expect(semantic.task).not.toContain("per favore");
    expect(semantic.task).toContain("spiegami le ondas gravitazionali");
    expect(semantic.goal).toBe(frame.goal);
    expect(semantic.interpretationNotes?.length).toBeGreaterThan(0);
  });

  it("the original human message is carried verbatim, never rewritten", () => {
    const translator = new DefaultHumanToAITranslator();
    const human: HumanRequest = { message: "Il mio modo di scrivere resta mio." };
    const semantic = translator.translate({ human, frame: frameOf(human.message) });
    expect(semantic.originalMessage).toBe(human.message);
    expect(semantic.task).toBe(human.message);
  });

  it("existing constraints are never removed or weakened", () => {
    const translator = new PlainLanguageTranslator();
    const human: HumanRequest = { message: "hi there, summarize this" };
    const frame: IntentFrame = {
      goal: "summarize",
      task: "hi there, summarize this",
      constraints: { language: "italian", depth: "beginner" },
      needsClarification: false,
    };
    const semantic = translator.translate({ human, frame });
    expect(semantic.constraints).toEqual({ language: "italian", depth: "beginner" });
  });
});

describe("Human→AI translation — provider neutrality", () => {
  it("a semantic representation never mentions any provider", () => {
    const translator = new DefaultHumanToAITranslator();
    const human: HumanRequest = { message: "Explain DNS records." };
    const semantic = translator.translate({ human, frame: frameOf(human.message) });
    expect(() => assertProviderNeutral(semantic, DEFAULT_FORBIDDEN_PROVIDER_TERMS)).not.toThrow();
  });

  it("a translator that leaks provider wording is rejected by the core guard", () => {
    const leaky = {
      id: "leaky-translator",
      translate: () => ({
        kind: "semantic-representation/v0.1" as const,
        goal: "g",
        task: "Answer using the ChatGPT API style system prompt",
        originalMessage: "m",
        translatedBy: "leaky-translator",
      }),
    };
    const engine = new SafiEngine({
      provider: stubProvider(),
      verifiers: [],
      policy: { id: "p", scope: { requiredChecks: [] }, maxCorrectionAttempts: 0 },
      // @ts-expect-error deliberately non-conforming translator
      translator: leaky,
    });
    // The engine captures the guard failure as ERROR, never as a certified answer.
    return engine.process({ message: "hello" }).then((outcome) => {
      expect(outcome.kind).toBe("error");
      expect(outcome.kind === "error" && outcome.message).toContain("provider-neutral");
    });
  });

  it("the engine attaches the semantic representation to the SafiRequest", async () => {
    let seen: SafiRequest | undefined;
    const engine = new SafiEngine({
      provider: {
        id: "spy",
        execute: async (request) => {
          seen = request;
          return { text: "answer", provider: "spy", attempt: request.attempt };
        },
      },
      verifiers: [],
      policy: { id: "p", scope: { requiredChecks: [] }, maxCorrectionAttempts: 0 },
      translator: new PlainLanguageTranslator(),
    });
    await engine.process({ message: "hey, what is DNS?" });
    expect(seen?.semantic).toBeDefined();
    expect(seen?.semantic?.translatedBy).toBe("plain-language-translator");
    expect(seen?.semantic?.originalMessage).toBe("hey, what is DNS?");
  });
});

describe("Human→AI translation — provider independence of intent", () => {
  it("changing provider does not change the intent", async () => {
    const makeEngine = (provider: ProviderAdapter) =>
      new SafiEngine({
        provider,
        verifiers: [],
        policy: { id: "p", scope: { requiredChecks: [] }, maxCorrectionAttempts: 0 },
        translator: new PlainLanguageTranslator(),
      });

    const providerA: ProviderAdapter = {
      id: "provider-a",
      execute: async (request) => ({
        text: `A: ${request.task}`,
        provider: "provider-a",
        attempt: request.attempt,
      }),
    };
    const providerB: ProviderAdapter = {
      id: "provider-b",
      execute: async (request) => ({
        text: `B: ${request.task}`,
        provider: "provider-b",
        attempt: request.attempt,
      }),
    };

    const outcomeA = await makeEngine(providerA).process({ message: "hey, explain gravity simply" });
    const outcomeB = await makeEngine(providerB).process({ message: "hey, explain gravity simply" });

    const semanticA = outcomeA.kind === "result" ? outcomeA.certificate : undefined;
    const semanticB = outcomeB.kind === "result" ? outcomeB.certificate : undefined;
    // Same intent: same semantic task in both flows (verified via provider spy below).
    expect(outcomeA.kind).toBe("result");
    expect(outcomeB.kind).toBe("result");

    let intentA: string | undefined;
    let intentB: string | undefined;
    const spyA: ProviderAdapter = {
      id: "spy-a",
      execute: async (r) => {
        intentA = r.semantic?.task;
        return providerA.execute(r);
      },
    };
    const spyB: ProviderAdapter = {
      id: "spy-b",
      execute: async (r) => {
        intentB = r.semantic?.task;
        return providerB.execute(r);
      },
    };
    await makeEngine(spyA).process({ message: "hey, explain gravity simply" });
    await makeEngine(spyB).process({ message: "hey, explain gravity simply" });
    expect(intentA).toBe(intentB);
    expect(semanticA && semanticB).toBeDefined();
  });
});

function stubProvider(): ProviderAdapter {
  return {
    id: "stub",
    execute: async (request: SafiRequest): Promise<CandidateResponse> => ({
      text: "stub answer",
      provider: "stub",
      attempt: request.attempt,
    }),
  };
}
