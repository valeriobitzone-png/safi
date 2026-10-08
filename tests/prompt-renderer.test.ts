import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deliverTranslatedPrompt, renderTranslatedPrompt } from "../packages/ask-prompt-renderer/index.js";

const hostJsPath = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "desktop", "host.js");

const original = "come creo un app con una bella grafica?";
const semantic = {
  kind: "semantic-representation/v0.1" as const,
  goal: "answer the person's request",
  task: "come creo un app con una bella grafica",
  originalMessage: original,
  translatedBy: "test-translator",
};

describe("Ask prompt renderer", () => {
  if (!existsSync(hostJsPath)) {
    it.todo("projects the neutral translation into a structured AI-ready prompt");
    it.todo("does not leak provider-specific vocabulary into the consumer prompt");
    it.todo("retains explicit constraints and declared clarification questions");
    it.todo("exposes the same delivery projection through the desktop host");
    it.todo("does not reuse a previous prompt when Ask requests overlap");
    it.todo("keeps Ask completion separate from factual verification");
    return;
  }

  it("projects the neutral translation into a structured AI-ready prompt", () => {
    const prompt = deliverTranslatedPrompt({ semantic });
    expect(prompt.kind).toBe("prompt-ready/v0.1");
    expect(prompt.originalMessage).toBe(original);
    expect(prompt.text).toContain("Richiesta originale da preservare");
    expect(prompt.text).toContain("Aiutami a:");
    expect(prompt.text).toContain("design system");
    expect(prompt.text).toContain("eventuali domande mancanti");
    expect(prompt.text).toContain("1. direzione creativa");
  });

  it("does not leak provider-specific vocabulary into the consumer prompt", () => {
    const prompt = renderTranslatedPrompt(semantic);
    for (const forbidden of ["OpenAI", "Gemini", "Claude", "ChatGPT", "system prompt"]) {
      expect(prompt.text).not.toContain(forbidden);
    }
  });

  it("retains explicit constraints and declared clarification questions", () => {
    const prompt = renderTranslatedPrompt(
      {
        ...semantic,
        constraints: { lingua: "italiano", tono: "formale" },
      },
      {
        goal: semantic.goal,
        task: semantic.task,
        clarificationQuestions: ["Qual è il tono preferito?"],
        needsClarification: true,
      },
    );
    expect(prompt.text).toContain("lingua: italiano");
    expect(prompt.text).toContain("tono: formale");
    expect(prompt.text).toContain("Qual è il tono preferito?");
  });

  it("exposes the same delivery projection through the desktop host", async () => {
    const { createDesktopHost } = await import("../apps/desktop/host.js");
    const host = createDesktopHost({ platform: "macos" });
    const loop = await host.runPipeline(original);
    expect(loop.delivery.outcome.kind).toBe("result");
    expect(host.deliverTranslatedPrompt()).toMatchObject({
      kind: "prompt-ready/v0.1",
      originalMessage: original,
    });
    expect(host.deliverTranslatedPrompt()?.text).toContain("Richiesta originale da preservare");
  });

  it("does not reuse a previous prompt when Ask requests overlap", async () => {
    const { createDesktopHost } = await import("../apps/desktop/host.js");
    const host = createDesktopHost({ platform: "macos" });
    const [first, second] = await Promise.all([
      host.runAsk("prima richiesta"),
      host.runAsk("seconda richiesta"),
    ]);
    expect(first.prompt.originalMessage).toBe("prima richiesta");
    expect(second.prompt.originalMessage).toBe("seconda richiesta");
  });

  it("keeps Ask completion separate from factual verification", async () => {
    const { createDesktopHost } = await import("../apps/desktop/host.js");
    const host = createDesktopHost({ platform: "macos" });
    const ask = await host.runAsk(original);
    const snapshot = host.widgetSnapshot();

    expect(ask.prompt.kind).toBe("prompt-ready/v0.1");
    expect(snapshot.state).toBe("PROMPT_READY");
    expect(snapshot.trust).toBeUndefined();
    expect(host.widget.collapsed()).toMatchObject({
      label: "Prompt pronto",
      color: "neutral",
    });
    expect(ask.prompt.certificate).toMatchObject({
      scope: "translation-only",
      factual: false,
    });
    expect(ask.prompt.certificate.checks.map((check: { checkId: string }) => check.checkId)).toEqual([
      "intent_preservation",
      "constraint_preservation",
      "original_message_preservation",
    ]);
  });
});
