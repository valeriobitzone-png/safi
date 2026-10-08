// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { demo1Translation, demo2Calculation, demo3Correction, demo4Uncertainty, demo4bFailed } from "../packages/demo-web/scenarios.js";
import { sha256Text } from "../packages/demo-web/hashing.js";
import { createManualTransport } from "../packages/transport-manual/index.js";
import {
  OpenAICompatProvider,
  ScriptedDemoProvider,
  RetryOnceStrategy,
  readProviderConfigFromEnv,
} from "../packages/adapter-provider-demo/index.js";
import {
  buildQuery,
  corroborates,
  contradicts,
  createSourceVerifier,
} from "../packages/verifier-source/index.js";
import { createCalculationVerifier, extractArithmetic, evaluateArithmetic } from "../packages/verifier-calculation/index.js";
import { SafiEngine } from "../src/engine.js";
import { PlainLanguageTranslator } from "../src/translate.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function outcomeOf(scenario: { run: () => Promise<any> }) {
  const result = await scenario.run();
  const outcome = result.delivery.outcome;
  return { result, outcome, certificate: outcome.kind === "result" ? outcome.certificate : undefined };
}

describe("Phase 4 — Demo 1: colloquial Human→AI translation", () => {
  it("translates 'sta cosa dei buchi neri' preserving intent, without a technical prompt", async () => {
    const scenario = demo1Translation();
    const { result, certificate } = await outcomeOf(scenario);
    const s = result.steps.semantic;
    expect(s.originalMessage).toBe(scenario.humanMessage);
    expect(s.task).toContain("buchi neri");
    expect(s.task).not.toContain("Oh");
    expect(s.task).not.toContain("semplice semplice");
    expect(s.constraints).toMatchObject({ depth: "beginner", language: "italian" });
    expect(result.steps.safiRequest.humanMessage).toBe(scenario.humanMessage);
    expect(certificate?.trustStatus).toBe("VERIFIED");
    expect(certificate?.responseSha256).toBe(sha256Text(result.delivery.outcome.answer));
  });
});

describe("Phase 4 — Demo 2: deterministic verification", () => {
  it("237 × 14 is VERIFIED only because the independent calculation agrees", async () => {
    const { outcome, certificate } = await outcomeOf(demo2Calculation());
    expect(outcome.answer).toContain("3318");
    expect(certificate?.trustStatus).toBe("VERIFIED");
    expect(certificate?.checks.some((c: any) => c.checkId === "calculation" && c.outcome === "PASS")).toBe(true);
    expect(certificate?.responseSha256).toBe(sha256Text(outcome.answer));
  });

  it("the calculation verifier is model-independent", () => {
    const expr = extractArithmetic("Il risultato di 237 × 14 è 3318.")[0];
    expect(evaluateArithmetic(expr)).toBe(3318);
    const verifier = createCalculationVerifier();
    return verifier
      .verify({ text: "Il risultato di 237 × 14 è 3325.", provider: "x", attempt: 1 } as any)
      .then((r) => expect(r.outcome).toBe("FAIL"));
  });
});

describe("Phase 4 — Demo 3: error and bounded correction", () => {
  it("wrong first candidate, FAIL, correction, VERIFIED with two-attempt history", async () => {
    const { outcome, certificate } = await outcomeOf(demo3Correction());
    expect(outcome.answer).toContain("3318");
    expect(certificate?.attempt).toBe(2);
    expect(certificate?.attemptHistory).toHaveLength(1);
    expect(certificate?.attemptHistory?.[0]?.trustStatus).toBe("FAILED");
    expect(certificate?.responseSha256).toBe(sha256Text(outcome.answer));
  });

  it("correction never replaces the original human message", async () => {
    let seen: any;
    const provider = new ScriptedDemoProvider({
      answers: { "calcola 9 × 7 e dai solo il risultato": "Il risultato di 9 × 7 è 63." },
      wrongFirstFor: ["calcola 9 × 7 e dai solo il risultato"],
    });
    const spy: any = {
      id: "spy",
      execute: async (request: any) => {
        seen = request;
        return provider.execute(request);
      },
    };
    const engine = new SafiEngine({
      provider: spy,
      verifiers: [createCalculationVerifier()],
      policy: { id: "p", scope: { requiredChecks: ["calculation"] }, maxCorrectionAttempts: 1 },
      correctionStrategy: new RetryOnceStrategy(),
      interpreter: () => ({
        goal: "answer the person's request",
        task: "calcola 9 × 7 e dai solo il risultato",
        needsClarification: false,
      }),
      translator: new PlainLanguageTranslator(),
    });
    const outcome = await engine.process({ message: "Quanto fa 9 × 7? nota mia personale" });
    expect(outcome.kind).toBe("result");
    expect(seen.humanMessage).toBe("Quanto fa 9 × 7? nota mia personale");
    expect(seen.attempt).toBe(2);
    expect((outcome as any).certificate.trustStatus).toBe("VERIFIED");
  });
});

describe("Phase 4 — Demo 4: honest uncertainty and honest failure", () => {
  it("insufficient evidence stays UNCERTAIN, never forced to VERIFIED", async () => {
    const { certificate } = await outcomeOf(demo4Uncertainty());
    expect(certificate?.trustStatus).toBe("UNCERTAIN");
    expect(certificate?.responseSha256).toBe(sha256Text((await outcomeOf(demo4Uncertainty())).outcome.answer));
  });

  it("a directly contradicted claim is FAILED", async () => {
    const { certificate } = await outcomeOf(demo4bFailed());
    expect(certificate?.trustStatus).toBe("FAILED");
    expect(certificate?.checks.some((c: any) => c.checkId === "sources" && c.outcome === "FAIL")).toBe(true);
  });
});

describe("Phase 4 — source verifier (adapter-based, real interface)", () => {
  it("builds a query and corroborates via overlapping meaningful terms", () => {
    const query = buildQuery("Quanti abitanti aveva il borgo di Vallarsa nel 1361?");
    expect(query).toContain("vallarsa");
    expect(corroborates("abitanti Vallarsa 1361", "Vallarsa conta 210 abitanti nel 1361")).toBe(true);
    expect(corroborates("abitanti Vallarsa 1361", "La ricetta della torta pasqualina")).toBe(false);
  });

  it("detects direct contradiction of declared figures", () => {
    expect(contradicts("esattamente 342 abitanti nel 1361", "nel 1361 contava 210 abitanti")).toBe(true);
    expect(contradicts("342 abitanti", "Vallarsa: 342 abitanti")).toBe(false);
  });

  it("PASS requires corroborating external sources", async () => {
    const verifier = createSourceVerifier({
      checkId: "sources",
      claim: "abitanti Vallarsa 1361",
      fetchFn: (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          query: { search: [{ title: "Vallarsa", snippet: "Vallarsa: abitanti nel 1361" }] },
        }),
      })) as any,
    });
    const result = await verifier.verify();
    expect(result.outcome).toBe("PASS");
    expect(result.verifierId).toBe("verifier-source");
  });

  it("network failure is INCONCLUSIVE: never a PASS", async () => {
    const verifier = createSourceVerifier({
      checkId: "sources",
      claim: "abitanti Vallarsa 1361",
      fetchFn: (async () => {
        throw new Error("network down");
      }) as any,
    });
    const result = await verifier.verify();
    expect(result.outcome).toBe("INCONCLUSIVE");
  });
});

describe("Phase 4 — credentials: environment only, nothing in the repository", () => {
  it("the real provider refuses to start without the env variable", () => {
    expect(() => readProviderConfigFromEnv({} as any)).toThrow(/SAFI_DEMO_API_KEY/);
  });

  it("with the env variable set it configures without leaking the key", () => {
    const config = readProviderConfigFromEnv({
      SAFI_DEMO_API_KEY: "test-key-from-env",
      SAFI_DEMO_BASE_URL: "https://example.invalid/v1",
      SAFI_DEMO_MODEL: "test-model",
    } as any);
    expect(config.apiKey).toBe("test-key-from-env");
    expect(config.model).toBe("test-model");
  });

  it("the repository contains no secrets and no .env files", () => {
    const offenders: string[] = [];
    const skip = new Set(["node_modules", "dist", "coverage"]);
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        // Skip build outputs and every hidden directory (config files of
        // local tools are not part of the repository content).
        if (skip.has(entry) || entry.startsWith(".")) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|js|mjs|json|md|html|css)$/.test(entry) || !entry.includes(".")) {
          const text = readFileSync(full, "utf8");
          if (/(sk|pk)-[A-Za-z0-9_-]{16,}/.test(text)) offenders.push(full);
        }
      }
    };
    walk(ROOT);
    expect(offenders).toEqual([]);
    expect(existsSync(join(ROOT, ".env"))).toBe(false);
  });
});

describe("Phase 4 — core purity: no provider, browser or search dependency in the core", () => {
  it("src/ contains no network calls, no API URLs and no credential reads", () => {
    const srcDir = join(ROOT, "src");
    const offenders: string[] = [];
    for (const entry of readdirSync(srcDir)) {
      if (!entry.endsWith(".ts")) continue;
      const text = readFileSync(join(srcDir, entry), "utf8");
      if (/fetch\(|axios|http:\/\/|https:\/\/|API_KEY|localStorage|window\.|document\./.test(text)) {
        offenders.push(entry);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("provider names appear in src only as the translator's forbidden-terms ban list", () => {
    const srcDir = join(ROOT, "src");
    for (const entry of readdirSync(srcDir)) {
      if (!entry.endsWith(".ts")) continue;
      const text = readFileSync(join(srcDir, entry), "utf8");
      const mentionsProvider = /openai|chatgpt|gpt-|gemini|anthropic/i.test(text);
      if (entry === "translate.ts") {
        expect(mentionsProvider).toBe(true); // the ban list itself
      } else {
        expect(mentionsProvider).toBe(false);
      }
    }
  });

  it("the OpenAI-compatible provider lives outside the core and is a drop-in ProviderAdapter", async () => {
    expect(new OpenAICompatProvider({
      apiKey: "unused",
      baseUrl: "https://example.invalid/v1",
      model: "test-model",
    }).id).toBe("openai-compat:test-model");
    // Scripted provider drives the same engine interface with no network.
    const provider = new ScriptedDemoProvider({ answers: { t: "hello" } });
    const candidate = await provider.execute({
      goal: "g", task: "t", humanMessage: "m", attempt: 1,
    } as any);
    expect(candidate.text).toBe("hello");
  });
});

describe("Phase 4 — manual transport", () => {
  it("delivers frozen outcomes and captures nothing automatically", async () => {
    const transport = createManualTransport();
    const scenario = demo2Calculation();
    const engine = (scenario as any).run; // scenario wraps its own transport
    const { result } = await outcomeOf(scenario);
    expect(Object.isFrozen(result.delivery.outcome)).toBe(true);
    expect(transport.capabilities.integrationFree).toBe(true);
    expect(transport.capabilities.autoCapture.input).toBe(false);
  });

  it("runManualLoop binds ingress and delivery to MANUAL mode", async () => {
    const { runManualLoop } = await import("../packages/transport-manual/index.js");
    const { SafiEngine: Engine } = await import("../src/engine.js");
    const engine = new Engine({
      provider: { id: "p", execute: async (r: any) => ({ text: "ok", provider: "p", attempt: r.attempt }) },
      verifiers: [],
      policy: { id: "p", scope: { requiredChecks: [] }, maxCorrectionAttempts: 0 },
    });
    const transport = createManualTransport();
    const { ingress, delivery } = await runManualLoop({ engine, transport, message: "ciao" });
    expect(ingress.mode).toBe("MANUAL");
    expect(delivery.mode).toBe("MANUAL");
    expect(delivery.outcome.kind).toBe("result");
  });
});
