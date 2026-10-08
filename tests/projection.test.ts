// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  PIPELINE_STATES,
  TRUST_LABELS,
  isStampSource,
  microstateLabel,
  projectDetails,
  projectForDisplay,
  projectSummary,
} from "../ui/projection.js";
import type { SafiCertificate } from "../src/types.js";

function certificateFixture(): SafiCertificate {
  return {
    schema: "safi-certificate/v0.1",
    trustStatus: "VERIFIED",
    verificationScope: {
      requiredChecks: ["coherence", "meaning-preservation", "math"],
      optionalChecks: ["freshness"],
    },
    checks: [
      { checkId: "coherence", outcome: "PASS", detail: "ok", verifierId: "v1" },
      { checkId: "meaning-preservation", outcome: "PASS", detail: "ok", verifierId: "v2" },
      { checkId: "math", outcome: "PASS", detail: "ok", verifierId: "v3" },
      { checkId: "freshness", outcome: "INCONCLUSIVE", detail: "optional", verifierId: "v4" },
    ],
    missingRequiredChecks: [],
    conflictingChecks: [],
    attempt: 2,
    maxAttempts: 3,
    provider: "example-provider",
    policyId: "example-policy",
    createdAt: "2026-09-18T08:30:00.000Z",
    responseSha256: "b6a3f2e31a9d4c08b5e7f6a1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d5e4f",
  };
}

describe("UI projection — acceptance", () => {
  it("projects a certificate without mutating it", () => {
    const certificate = certificateFixture();
    const snapshot = JSON.stringify(certificate);
    const display = projectForDisplay(certificate);
    expect(JSON.stringify(certificate)).toBe(snapshot);
    expect(display.trustStatus).toBe("VERIFIED");
    expect(Object.isFrozen(display)).toBe(true);
  });

  it("counts passed checks as 3/3 (ratio from required scope)", () => {
    const summary = projectSummary(certificateFixture());
    expect(summary.checksRatio).toBe("3/3");
    expect(summary.labelHuman).toBe("Verified");
    expect(summary.labelLong).toBe("Verificato");
  });

  it("every trust state has glyph, label and ARIA name: color is never the only signal", () => {
    for (const status of ["VERIFIED", "UNCERTAIN", "FAILED"] as const) {
      const certificate = { ...certificateFixture(), trustStatus: status };
      const display = projectForDisplay(certificate);
      expect(display.glyph.length).toBeGreaterThan(0);
      expect(display.labelHuman.length).toBeGreaterThan(0);
      expect(display.labelLong.length).toBeGreaterThan(0);
      expect(display.ariaLabel).toContain(status);
      expect(display.ariaLabel).toContain("Safi");
    }
    // Distinct glyphs: shape encodes state independently of color.
    const glyphs = new Set(
      (["VERIFIED", "UNCERTAIN", "FAILED"] as const).map(
        (s) => projectForDisplay({ ...certificateFixture(), trustStatus: s }).glyph,
      ),
    );
    expect(glyphs.size).toBe(3);
    expect(TRUST_LABELS.VERIFIED.shape).not.toBe(TRUST_LABELS.FAILED.shape);
  });

  it("level 2 exposes scope, evidences, attempts, timestamp, provider and hash", () => {
    const details = projectDetails(certificateFixture());
    const terms = details.map((row) => row.term);
    expect(terms).toEqual(
      expect.arrayContaining([
        "Verification scope",
        "Evidenze",
        "Tentativi",
        "Timestamp",
        "Provider",
        "Response hash",
      ]),
    );
    const attempts = details.find((row) => row.term === "Tentativi")!;
    expect(attempts.description).toBe("2 di 3");
    const hash = details.find((row) => row.term === "Response hash")!;
    expect(hash.description).toContain("…");
    expect(hash.description.length).toBeLessThan(64);
  });

  it("shows microstates only for Human→AI activity states", () => {
    expect(microstateLabel("UNDERSTANDING")).toBe("Safi sta capendo…");
    expect(microstateLabel("TRANSLATING")).toBe("Safi sta traducendo…");
    expect(microstateLabel("RESULT")).toBeNull();
    expect(microstateLabel("NOT_A_STATE")).toBeNull();
    expect(PIPELINE_STATES).toEqual([
      "IDLE",
      "UNDERSTANDING",
      "TRANSLATING",
      "WAITING_AI",
      "HUMANIZING",
      "VERIFYING",
      "CORRECTING",
      "RESULT",
    ]);
  });

  it("rejects non-certificate sources", () => {
    expect(isStampSource(null)).toBe(false);
    expect(isStampSource({})).toBe(false);
    expect(isStampSource({ trustStatus: "VERIFIED" })).toBe(false);
    expect(() => projectForDisplay({ trustStatus: "VERIFIED" })).toThrow(TypeError);
  });

  it("works with a transport SafiStamp too", () => {
    const stamp = {
      schema: "safi-stamp/v0.1" as const,
      trustStatus: "UNCERTAIN" as const,
      createdAt: "2026-09-18T08:30:00.000Z",
      policyId: "p",
      responseSha256: "a".repeat(64),
      requiredChecks: ["sources", "freshness"],
      attempt: 1,
      maxAttempts: 2,
      provider: "x",
    };
    const display = projectForDisplay(stamp);
    expect(display.trustStatus).toBe("UNCERTAIN");
    expect(display.checksRatio).toBe("0/2");
    expect(display.scope.requiredChecks).toEqual(["sources", "freshness"]);
  });

  it("surfaces conflicts and missing checks as text, not color", () => {
    const certificate = {
      ...certificateFixture(),
      trustStatus: "UNCERTAIN" as const,
      conflictingChecks: ["sources"],
      missingRequiredChecks: ["freshness"],
    };
    const display = projectForDisplay(certificate);
    expect(display.conflictNote).toContain("sources");
    expect(display.missingNote).toContain("freshness");
  });
});
