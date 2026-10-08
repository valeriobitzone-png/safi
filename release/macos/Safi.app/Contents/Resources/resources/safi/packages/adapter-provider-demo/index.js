/**
 * Demo provider adapter — OUTSIDE the core.
 *
 * Two implementations of the same ProviderAdapter interface:
 *
 *  1. OpenAICompatProvider: talks to any OpenAI-compatible chat
 *     completions endpoint. Credentials come EXCLUSIVELY from
 *     environment variables (SAFI_DEMO_API_KEY, SAFI_DEMO_BASE_URL,
 *     SAFI_DEMO_MODEL). No key, secret or endpoint is stored in this
 *     repository. This file is the ONLY place that reads them, and it
 *     is never imported by the core, by tests or by the deterministic
 *     demo path.
 *
 *  2. ScriptedDemoProvider: fully deterministic provider for demos and
 *     tests. No network, no credentials, no environment.
 *
 * It translates the provider-neutral SafiRequest (and its
 * SemanticRepresentation) into a provider-specific prompt. The core
 * never sees prompts, models or endpoints.
 */

/** Reads provider configuration exclusively from the environment. */
export function readProviderConfigFromEnv(env = process.env) {
  const apiKey = env.SAFI_DEMO_API_KEY;
  const baseUrl = env.SAFI_DEMO_BASE_URL ?? "https://api.openai.com/v1";
  const model = env.SAFI_DEMO_MODEL ?? "gpt-4o-mini";
  if (!apiKey) {
    throw new Error(
      "SAFI_DEMO_API_KEY is not set. The real provider reads credentials exclusively from environment variables; nothing is stored in the repository.",
    );
  }
  return { apiKey, baseUrl, model };
}

/**
 * Builds a provider-specific system+user prompt from a SafiRequest.
 * This is the only place where provider-specific wording is created.
 */
export function buildProviderPrompt(request) {
  const s = request.semantic;
  const constraints = s?.constraints ?? request.constraints ?? {};
  const constraintLines = Object.entries(constraints)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const system = [
    "You are an assistant behind Safi, a human-AI trust middleware.",
    "Answer the person's request faithfully, clearly and simply.",
    constraintLines ? `Constraints:\n${constraintLines}` : "",
    "The original request came from a person in their own words.",
  ]
    .filter(Boolean)
    .join("\n");
  // The person's verbatim words are the user message; the neutral task
  // gives structure. The core's humanMessage is never replaced.
  const user = s?.originalMessage ?? request.humanMessage;
  return { system, user };
}

/** Provider adapter for any OpenAI-compatible chat completions API. */
export class OpenAICompatProvider {
  constructor(config = readProviderConfigFromEnv()) {
    this.id = `openai-compat:${config.model}`;
    this.config = config;
  }

  async execute(request) {
    const { system, user } = buildProviderPrompt(request);
    const url = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Provider request failed: ${response.status} ${detail.slice(0, 200)}`);
    }
    const payload = await response.json();
    const text =
      payload?.choices?.[0]?.message?.content ??
      (() => {
        throw new Error("Provider response has no message content");
      })();
    return { text, provider: this.id, attempt: request.attempt };
  }
}

/**
 * Deterministic scripted provider for demos/tests: no network, no keys.
 * It can be told to produce a wrong (verifiably wrong) first answer so
 * Demo 3 can exercise bounded correction.
 */
export class ScriptedDemoProvider {
  constructor({ answers, wrongFirstFor = [] } = {}) {
    this.id = "scripted-demo-provider";
    this.answers = answers ?? {};
    this.wrongFirstFor = new Set(wrongFirstFor);
  }

  async execute(request) {
    const key = request.task;
    let text = this.answers[key];
    if (text === undefined) {
      // Deterministic generic answer echoing the neutral task.
      text = `Risposta alla richiesta: ${request.task}`;
    }
    if (this.wrongFirstFor.has(key) && request.attempt === 1) {
      text = this.wrapWrong(text, key);
    }
    return { text, provider: this.id, attempt: request.attempt };
  }

  wrapWrong(text, key) {
    // Produce a verifiably wrong arithmetic answer when the task asks
    // for a multiplication the calculation verifier can check.
    const match = /(\d+)\s*[x×*]\s*(\d+)/i.exec(key);
    if (match) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      return `Il risultato di ${a} × ${b} è ${a * b + 7}.`;
    }
    return text;
  }
}

/**
 * Bounded correction strategy: retries once after a FAILED verification.
 * It only adds a constraint (never removes required checks, never
 * touches the original human message).
 */
export class RetryOnceStrategy {
  constructor() {
    this.id = "retry-once-strategy";
  }

  plan({ summary, attempt }) {
    if (summary.status !== "FAILED") return null;
    return {
      note: `attempt ${attempt} failed verification; retrying with an accuracy constraint`,
      additionalConstraints: { accuracy: "verify every numeric claim before answering" },
    };
  }
}
