import { describe, expect, it } from "vitest";

import { SafiEngine } from "../src/engine.js";
import type {
  CandidateResponse,
  ProviderAdapter,
  SafiRequest,
  Verifier,
  VerificationContext,
  VerificationResult,
} from "../src/types.js";
import { createHash } from "node:crypto";

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function providerOf(textOr: string | ((request: SafiRequest) => string)): ProviderAdapter {
  return {
    id: "stub-provider",
    async execute(request: SafiRequest): Promise<CandidateResponse> {
      const text = typeof textOr === "function" ? textOr(request) : textOr;
      return { text, provider: "stub-provider", attempt: request.attempt };
    },
  };
}

function verifierOf(checkId: string, outcome: VerificationResult["outcome"]): Verifier {
  return {
    checkId,
    async verify(): Promise<VerificationResult> {
      return { checkId, outcome, detail: `${checkId} -> ${outcome}`, verifierId: `v-${checkId}` };
    },
  };
}

const POLICY = {
  id: "test-policy",
  scope: { requiredChecks: ["math"] },
  maxCorrectionAttempts: 0,
} as const;

describe("SafiEngine — control outcomes", () => {
  it("interpreter returning null -> REJECTED", async () => {
    const engine = new SafiEngine({
      provider: providerOf("x"),
      verifiers: [],
      policy: POLICY,
      interpreter: () => null,
    });
    const outcome = await engine.process({ message: "hello" });
    expect(outcome.kind).toBe("rejected");
  });

  it("clarifying frame -> CLARIFICATION", async () => {
    const engine = new SafiEngine({
      provider: providerOf("x"),
      verifiers: [],
      policy: POLICY,
      interpreter: () => ({
        goal: "g",
        task: "t",
        needsClarification: true,
        clarificationQuestions: ["Which one?"],
      }),
    });
    const outcome = await engine.process({ message: "tell me about it" });
    expect(outcome.kind).toBe("clarification");
    if (outcome.kind === "clarification") {
      expect(outcome.questions).toEqual(["Which one?"]);
    }
  });

  it("empty message -> CLARIFICATION via default interpreter", async () => {
    const engine = new SafiEngine({
      provider: providerOf("x"),
      verifiers: [],
      policy: POLICY,
    });
    const outcome = await engine.process({ message: "   " });
    expect(outcome.kind).toBe("clarification");
  });

  it("provider exception -> ERROR, never a passing answer", async () => {
    const engine = new SafiEngine({
      provider: {
        id: "broken",
        execute: async () => {
          throw new Error("provider down");
        },
      },
      verifiers: [],
      policy: POLICY,
    });
    const outcome = await engine.process({ message: "hello" });
    expect(outcome.kind).toBe("error");
  });

  it("guard REJECT -> REJECTED without provider call", async () => {
    let called = 0;
    const engine = new SafiEngine({
      provider: {
        id: "counting",
        execute: async () => {
          called += 1;
          return { text: "x", provider: "counting", attempt: 1 };
        },
      },
      verifiers: [],
      policy: POLICY,
      interpreter: () => ({ goal: "g", task: "t", needsClarification: false }),
      guard: () => ({ action: "REJECT", reason: "not allowed" }),
    });
    const outcome = await engine.process({ message: "hello" });
    expect(outcome.kind).toBe("rejected");
    expect(called).toBe(0);
  });
});

describe("SafiEngine — trust semantics", () => {
  it("no checks executed -> UNCERTAIN, never VERIFIED", async () => {
    const engine = new SafiEngine({
      provider: providerOf("an answer"),
      verifiers: [],
      policy: { id: "p", scope: { requiredChecks: [] }, maxCorrectionAttempts: 0 },
    });
    const outcome = await engine.process({ message: "hello" });
    expect(outcome.kind).toBe("result");
    if (outcome.kind === "result") {
      expect(outcome.certificate.trustStatus).toBe("UNCERTAIN");
    }
  });

  it("missing required check -> UNCERTAIN", async () => {
    const engine = new SafiEngine({
      provider: providerOf("an answer"),
      verifiers: [],
      policy: { id: "p", scope: { requiredChecks: ["math"] }, maxCorrectionAttempts: 0 },
    });
    const outcome = await engine.process({ message: "hello" });
    if (outcome.kind === "result") {
      expect(outcome.certificate.trustStatus).toBe("UNCERTAIN");
      expect(outcome.certificate.missingRequiredChecks).toEqual(["math"]);
    } else {
      throw new Error("expected a result");
    }
  });

  it("all required PASS -> VERIFIED", async () => {
    const engine = new SafiEngine({
      provider: providerOf("an answer"),
      verifiers: [verifierOf("math", "PASS")],
      policy: { id: "p", scope: { requiredChecks: ["math"] }, maxCorrectionAttempts: 0 },
    });
    const outcome = await engine.process({ message: "hello" });
    if (outcome.kind === "result") {
      expect(outcome.certificate.trustStatus).toBe("VERIFIED");
    } else {
      throw new Error("expected a result");
    }
  });

  it("required FAIL with exhausted budget -> FAILED certified honestly", async () => {
    const engine = new SafiEngine({
      provider: providerOf("a wrong answer"),
      verifiers: [verifierOf("math", "FAIL")],
      policy: { id: "p", scope: { requiredChecks: ["math"] }, maxCorrectionAttempts: 0 },
    });
    const outcome = await engine.process({ message: "hello" });
    if (outcome.kind === "result") {
      expect(outcome.certificate.trustStatus).toBe("FAILED");
    } else {
      throw new Error("expected a result");
    }
  });

  it("conflicting verifiers -> UNCERTAIN with conflict recorded", async () => {
    const engine = new SafiEngine({
      provider: providerOf("an answer"),
      verifiers: [verifierOf("math", "PASS"), verifierOf("math", "FAIL")],
      policy: { id: "p", scope: { requiredChecks: ["math"] }, maxCorrectionAttempts: 0 },
    });
    const outcome = await engine.process({ message: "hello" });
    if (outcome.kind === "result") {
      expect(outcome.certificate.trustStatus).toBe("UNCERTAIN");
      expect(outcome.certificate.conflictingChecks).toEqual(["math"]);
    } else {
      throw new Error("expected a result");
    }
  });
});

describe("SafiEngine — bounded correction", () => {
  it("correction retries and can reach VERIFIED", async () => {
    let verifierCalls = 0;
    const engine = new SafiEngine({
      provider: providerOf((request) => `answer ${request.attempt}`),
      verifiers: [
        {
          checkId: "math",
          verify: async () => {
            verifierCalls += 1;
            const outcome = verifierCalls <= 2 ? "FAIL" : "PASS";
            return { checkId: "math", outcome, detail: `call ${verifierCalls}`, verifierId: "v-math" };
          },
        },
      ],
      policy: { id: "p", scope: { requiredChecks: ["math"] }, maxCorrectionAttempts: 2 },
      correctionStrategy: {
        plan: () => ({ note: "retry with stricter constraint" }),
      },
    });
    const outcome = await engine.process({ message: "hello" });
    if (outcome.kind === "result") {
      expect(outcome.certificate.attempt).toBe(3);
      expect(outcome.certificate.trustStatus).toBe("VERIFIED");
      expect(outcome.certificate.attemptHistory?.map((h) => h.trustStatus)).toEqual(["FAILED", "FAILED"]);
    } else {
      throw new Error("expected a result");
    }
  });

  it("correction cannot replace the original human message", async () => {
    let lastRequest: SafiRequest | undefined;
    const engine = new SafiEngine({
      provider: {
        id: "spy",
        execute: async (request) => {
          lastRequest = request;
          return { text: "x", provider: "spy", attempt: request.attempt };
        },
      },
      verifiers: [verifierOf("math", "FAIL")],
      policy: { id: "p", scope: { requiredChecks: ["math"] }, maxCorrectionAttempts: 2 },
      correctionStrategy: {
        plan: () => ({ note: "retry", additionalConstraints: { extra: "be careful" } }),
      },
    });
    await engine.process({ message: "the original human words" });
    expect(lastRequest?.humanMessage).toBe("the original human words");
    expect(lastRequest?.attempt).toBe(3);
    expect(lastRequest?.constraints).toEqual({ extra: "be careful" });
  });

  it("correction declines -> certified FAILED on the same run", async () => {
    const engine = new SafiEngine({
      provider: providerOf("bad answer"),
      verifiers: [verifierOf("math", "FAIL")],
      policy: { id: "p", scope: { requiredChecks: ["math"] }, maxCorrectionAttempts: 2 },
      correctionStrategy: { plan: () => null },
    });
    const outcome = await engine.process({ message: "hello" });
    if (outcome.kind === "result") {
      expect(outcome.certificate.trustStatus).toBe("FAILED");
      expect(outcome.certificate.attempt).toBe(1);
    } else {
      throw new Error("expected a result");
    }
  });

  it("maxCorrectionAttempts > 0 without a strategy is a configuration error", () => {
    expect(
      () =>
        new SafiEngine({
          provider: providerOf("x"),
          verifiers: [],
          policy: { id: "p", scope: { requiredChecks: [] }, maxCorrectionAttempts: 1 },
        }),
    ).toThrow();
  });
});

describe("SafiEngine — humanization and certification", () => {
  it("humanization runs before final verification and the hash binds the shown text", async () => {
    const engine = new SafiEngine({
      provider: providerOf("Technical answer with jargon."),
      verifiers: [verifierOf("math", "PASS")],
      policy: { id: "p", scope: { requiredChecks: ["math"] }, maxCorrectionAttempts: 0 },
      presenter: {
        id: "humanizer",
        present: async ({ candidate }) => `In simple words: ${candidate.text.replace(" jargon", "")}`,
      },
      now: () => new Date(0),
    });
    const outcome = await engine.process({ message: "hello" });
    if (outcome.kind !== "result") throw new Error("expected a result");
    expect(outcome.answer.startsWith("In simple words:")).toBe(true);
    expect(outcome.certificate.responseSha256).toBe(sha(outcome.answer));
  });

  it("no semantic rewrite after certification: outcome text matches hash", async () => {
    const engine = new SafiEngine({
      provider: providerOf("plain answer"),
      verifiers: [verifierOf("math", "PASS")],
      policy: { id: "p", scope: { requiredChecks: ["math"] }, maxCorrectionAttempts: 0 },
    });
    const outcome = await engine.process({ message: "hello" });
    if (outcome.kind !== "result") throw new Error("expected a result");
    expect(outcome.certificate.responseSha256).toBe(sha(outcome.answer));
  });

  it("verifier exception during final verification never yields VERIFIED", async () => {
    const engine = new SafiEngine({
      provider: providerOf("answer"),
      verifiers: [
        {
          checkId: "math",
          verify: () => {
            throw new Error("boom");
          },
        },
      ],
      policy: { id: "p", scope: { requiredChecks: ["math"] }, maxCorrectionAttempts: 0 },
    });
    const outcome = await engine.process({ message: "hello" });
    if (outcome.kind === "result") {
      expect(outcome.certificate.trustStatus).toBe("UNCERTAIN");
    } else {
      throw new Error("expected a result");
    }
  });

  it("certificate carries policy id, scope, provider and attempt", async () => {
    const engine = new SafiEngine({
      provider: providerOf("answer"),
      verifiers: [verifierOf("math", "PASS")],
      policy: {
        id: "pol-42",
        scope: { requiredChecks: ["math"], optionalChecks: ["freshness"] },
        maxCorrectionAttempts: 0,
      },
      now: () => new Date(0),
    });
    const outcome = await engine.process({ message: "hello" });
    if (outcome.kind !== "result") throw new Error("expected a result");
    expect(outcome.certificate.policyId).toBe("pol-42");
    expect(outcome.certificate.verificationScope.requiredChecks).toEqual(["math"]);
    expect(outcome.certificate.verificationScope.optionalChecks).toEqual(["freshness"]);
    expect(outcome.certificate.provider).toBe("stub-provider");
    expect(outcome.certificate.createdAt).toBe(new Date(0).toISOString());
  });
});

describe("SafiEngine — verification scope guard", () => {
  it("humanization cannot introduce new claims without checks: context exposes raw text", async () => {
    let seenRaw: string | undefined;
    const engine = new SafiEngine({
      provider: providerOf("raw technical answer"),
      verifiers: [
        {
          checkId: "math",
          verify: async (_candidate, context: VerificationContext) => {
            seenRaw = context.rawText;
            return { checkId: "math", outcome: "PASS", detail: "ok" };
          },
        },
      ],
      policy: { id: "p", scope: { requiredChecks: ["math"] }, maxCorrectionAttempts: 0 },
      presenter: {
        id: "humanizer",
        present: async ({ candidate }) => `plain: ${candidate.text}`,
      },
    });
    await engine.process({ message: "hello" });
    expect(seenRaw).toBe("raw technical answer");
  });
});
