import type {
  HumanRequest,
  HumanToAITranslator,
  IntentFrame,
  SemanticRepresentation,
} from "./types.js";

/**
 * Human→AI Translation (RFC 0001).
 *
 * The translator preserves the person's purpose and produces a
 * provider-neutral semantic representation. It is NOT a prompt improver:
 * no provider, format, model or prompt style may appear here.
 *
 * The Provider Adapter remains the only component allowed to turn a
 * semantic representation into a provider-specific prompt.
 */

/**
 * Terms that must never appear in a semantic representation.
 * Provider-specific wording belongs to the Provider Adapter only.
 */
export const DEFAULT_FORBIDDEN_PROVIDER_TERMS: readonly string[] = [
  "openai",
  "gemini",
  "claude",
  "anthropic",
  "chatgpt",
  "gpt-",
  "llama",
  "mistral",
  "deepseek",
  "system prompt",
];

/** Deterministic default translator shipped with the Core. */
export class DefaultHumanToAITranslator implements HumanToAITranslator {
  readonly id = "default-translator";

  translate(input: { human: HumanRequest; frame: IntentFrame }): SemanticRepresentation {
    return {
      kind: "semantic-representation/v0.1",
      goal: input.frame.goal,
      task: input.frame.task,
      ...(input.frame.constraints ? { constraints: { ...input.frame.constraints } } : {}),
      originalMessage: input.human.message,
      interpretationNotes: [
        "deterministic core translation: goal and task taken from the interpreted frame",
      ],
      translatedBy: this.id,
    };
  }
}

/**
 * Plain-language translator: normalizes informal phrasing into a neutral
 * task statement WITHOUT changing the person's purpose. Demonstrates the
 * required property: informal human phrasing in, same purpose out.
 */
export class PlainLanguageTranslator implements HumanToAITranslator {
  readonly id = "plain-language-translator";

  translate(input: { human: HumanRequest; frame: IntentFrame }): SemanticRepresentation {
    const notes: string[] = [];
    let task = input.frame.task;

    const polite = /\b(per favore|please|potresti|could you|can you|puoi)\b/i;
    if (polite.test(task)) {
      task = task.replace(polite, "").replace(/\s+/g, " ").trim();
      notes.push("removed politeness formula without changing the request");
    }

    const filler = /^(ciao|hi|hello|ehi|hey)[,!\s]+/i;
    if (filler.test(task)) {
      task = task.replace(filler, "").trim();
      notes.push("removed greeting without changing the request");
    }

    if (task.length === 0) {
      task = input.frame.task;
      notes.push("normalization produced an empty task; kept the interpreted task");
    }

    return {
      kind: "semantic-representation/v0.1",
      goal: input.frame.goal,
      task,
      ...(input.frame.constraints ? { constraints: { ...input.frame.constraints } } : {}),
      originalMessage: input.human.message,
      interpretationNotes: notes.length > 0 ? notes : ["no normalization needed"],
      translatedBy: this.id,
    };
  }
}

/** Structural guarantee: a representation must never mention providers. */
export function assertProviderNeutral(
  representation: SemanticRepresentation,
  forbidden: readonly string[],
): void {
  const haystack = [
    representation.goal,
    representation.task,
    ...(representation.interpretationNotes ?? []),
  ]
    .join(" ")
    .toLowerCase();

  for (const term of forbidden) {
    if (haystack.includes(term.toLowerCase())) {
      throw new Error(
        `Translation is not provider-neutral: it references "${term}". Provider-specific wording belongs to the Provider Adapter only.`,
      );
    }
  }
}
