import { describe, expect, it } from "vitest";

import type { VerificationResult, VerificationScope } from "../src/types.js";
import {
  aggregateCheckOutcomes,
  aggregateVerification,
  runVerifiers,
} from "../src/verify.js";

function result(checkId: string, outcome: VerificationResult["outcome"], verifierId?: string): VerificationResult {
  return {
    checkId,
    outcome,
    detail: `${outcome} on ${checkId}`,
    ...(verifierId ? { verifierId } : {}),
  };
}

const SCOPE_ONE: VerificationScope = { requiredChecks: ["math"] };

describe("aggregateCheckOutcomes", () => {
  it("all PASS -> PASS", () => {
    expect(aggregateCheckOutcomes(["PASS", "PASS"])).toBe("PASS");
  });

  it("PASS + FAIL -> CONFLICT", () => {
    expect(aggregateCheckOutcomes(["PASS", "FAIL"])).toBe("CONFLICT");
  });

  it("PASS + INCONCLUSIVE -> CONFLICT", () => {
    expect(aggregateCheckOutcomes(["PASS", "INCONCLUSIVE"])).toBe("CONFLICT");
  });

  it("FAIL + INCONCLUSIVE -> FAIL", () => {
    expect(aggregateCheckOutcomes(["FAIL", "INCONCLUSIVE"])).toBe("FAIL");
  });

  it("only INCONCLUSIVE -> CONFLICT (UNCERTAIN at aggregation)", () => {
    expect(aggregateCheckOutcomes(["INCONCLUSIVE"])).toBe("CONFLICT");
  });
});

describe("aggregateVerification", () => {
  it("empty required scope is never VERIFIED", () => {
    const summary = aggregateVerification({ requiredChecks: [] }, { results: [result("math", "PASS")] });
    expect(summary.status).toBe("UNCERTAIN");
  });

  it("no results at all -> UNCERTAIN", () => {
    const summary = aggregateVerification(SCOPE_ONE, { results: [] });
    expect(summary.status).toBe("UNCERTAIN");
    expect(summary.missingRequiredChecks).toEqual(["math"]);
  });

  it("missing required check -> UNCERTAIN", () => {
    const summary = aggregateVerification(SCOPE_ONE, { results: [result("other", "PASS")] });
    expect(summary.status).toBe("UNCERTAIN");
    expect(summary.missingRequiredChecks).toEqual(["math"]);
  });

  it("all required PASS -> VERIFIED", () => {
    const summary = aggregateVerification(SCOPE_ONE, { results: [result("math", "PASS")] });
    expect(summary.status).toBe("VERIFIED");
  });

  it("any required FAIL -> FAILED", () => {
    const summary = aggregateVerification(SCOPE_ONE, { results: [result("math", "FAIL")] });
    expect(summary.status).toBe("FAILED");
  });

  it("required INCONCLUSIVE -> UNCERTAIN", ()  => {
    const summary = aggregateVerification(SCOPE_ONE, { results: [result("math", "INCONCLUSIVE")] });
    expect(summary.status).toBe("UNCERTAIN");
  });

  it("required conflict -> UNCERTAIN and conflict recorded", () => {
    const summary = aggregateVerification(SCOPE_ONE, {
      results: [result("math", "PASS", "a"), result("math", "FAIL", "b")],
    });
    expect(summary.status).toBe("UNCERTAIN");
    expect(summary.conflictingChecks).toEqual(["math"]);
  });

  it("optional failure is ignored by scope", () => {
    const summary = aggregateVerification(
      { requiredChecks: ["math"], optionalChecks: ["freshness"] },
      { results: [result("math", "PASS"), result("freshness", "FAIL")] },
    );
    expect(summary.status).toBe("VERIFIED");
    expect(summary.ignoredOptionalFailures).toEqual(["freshness"]);
  });

  it("raw results are merged for conflict detection", () => {
    const summary = aggregateVerification(SCOPE_ONE, {
      results: [result("math", "PASS")],
      rawResults: [result("math", "FAIL")],
    });
    expect(summary.status).toBe("UNCERTAIN");
    expect(summary.conflictingChecks).toEqual(["math"]);
  });
});

describe("runVerifiers", () => {
  it("a throwing verifier becomes INCONCLUSIVE, never PASS", async () => {
    const throwing = {
      checkId: "boom",
      verify: () => {
        throw new Error("verifier exploded");
      },
    };
    const results = await runVerifiers([throwing], candidateStub(), contextStub());
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("INCONCLUSIVE");
    expect(results[0]?.detail).toContain("verifier exploded");
  });

  it("an invalid outcome is normalized to INCONCLUSIVE", async () => {
    const invalid = {
      checkId: "weird",
      // @ts-expect-error deliberately invalid outcome
      verify: async () => ({ checkId: "weird", outcome: "MAYBE", detail: "bad" }),
    };
    const results = await runVerifiers([invalid], candidateStub(), contextStub());
    expect(results[0]?.outcome).toBe("INCONCLUSIVE");
  });
});

function candidateStub() {
  return { text: "candidate text", provider: "stub", attempt: 1 };
}

function contextStub() {
  return { request: { goal: "g", task: "t", humanMessage: "m", attempt: 1 }, text: "candidate text" };
}
