import { describe, expect, it } from "vitest";

import { SafiEngine } from "../src/engine.js";
import { PlainLanguageTranslator } from "../src/translate.js";
import {
  CompanionTransport,
  EmbeddedTransport,
  ManualTransport,
  projectStamp,
  safiLoop,
} from "../src/transport.js";
import type {
  CandidateResponse,
  ProviderAdapter,
  SafiRequest,
  TransportAdapter,
  TransportMode,
} from "../src/types.js";

function makeEngine(providerId: string): SafiEngine {
  const provider: ProviderAdapter = {
    id: providerId,
    execute: async (request: SafiRequest): Promise<CandidateResponse> => ({
      text: `Answer to "${request.task}" for ${providerId}.`,
      provider: providerId,
      attempt: request.attempt,
    }),
  };
  return new SafiEngine({
    provider,
    verifiers: [
      {
        checkId: "coherence",
        verify: async () => ({ checkId: "coherence", outcome: "PASS", detail: "ok" }),
      },
    ],
    policy: { id: "policy-transport", scope: { requiredChecks: ["coherence"] }, maxCorrectionAttempts: 0 },
    translator: new PlainLanguageTranslator(),
  });
}

describe("Transport — three modes, same SAFI meaning", () => {
  const MODES: { name: string; make: () => TransportAdapter }[] = [
    { name: "EMBEDDED", make: () => new EmbeddedTransport() },
    { name: "COMPANION", make: () => new CompanionTransport() },
    { name: "MANUAL", make: () => new ManualTransport() },
  ];

  for (const { name, make } of MODES) {
    it(`${name}: same intent, same trust status, same answer hash`, async () => {
      const transport = make();
      const result = await safiLoop({
        engine: makeEngine(`provider-${name.toLowerCase()}`),
        transport,
        message: "Ciao, per favore spiegami cos'è un DNS in parole semplici.",
      });

      expect(result.delivery.outcome.kind).toBe("result");
      if (result.delivery.outcome.kind !== "result") return;
      const { certificate, answer } = result.delivery.outcome;
      expect(certificate.trustStatus).toBe("VERIFIED");
      expect(result.delivery.stamp?.responseSha256).toBe(certificate.responseSha256);
      expect(certificate.verificationScope.requiredChecks).toEqual(["coherence"]);
      expect(certificate.provider).toBe(`provider-${name.toLowerCase()}`);
    });
  }

  it("the semantic intent is identical across the three modes", async () => {
    const MESSAGE = "hey, explain gravity simply";
    const intents: string[] = [];
    for (const make of [() => new EmbeddedTransport(), () => new CompanionTransport(), () => new ManualTransport()]) {
      let capturedIntent: string | undefined;
      const engine = new SafiEngine({
        provider: {
          id: "spy",
          execute: async (request) => {
            capturedIntent = request.semantic?.task;
            return { text: "answer", provider: "spy", attempt: request.attempt };
          },
        },
        verifiers: [],
        policy: { id: "p", scope: { requiredChecks: [] }, maxCorrectionAttempts: 0 },
        translator: new PlainLanguageTranslator(),
      });
      await safiLoop({ engine, transport: make(), message: MESSAGE });
      intents.push(capturedIntent!);
    }
    expect(intents[0]).toBe(intents[1]);
    expect(intents[1]).toBe(intents[2]);
    expect(intents[0]).not.toContain("hey");
  });
});

describe("Transport — automatic capture", () => {
  it("input and output can be captured automatically via a transport adapter", async () => {
    const transport = new EmbeddedTransport("app-embedded");
    const result = await safiLoop({
      engine: makeEngine("provider-embedded"),
      transport,
      message: "hello there",
    });

    expect(transport.captures.length).toBeGreaterThanOrEqual(2);
    expect(transport.captures[0]?.direction).toBe("input");
    expect(transport.captures[0]?.summary).toBe("hello there");
    expect(transport.captures[transport.captures.length - 1]?.direction).toBe("output");
    expect(transport.captures[transport.captures.length - 1]?.summary).toBe("VERIFIED");
    expect(result.ingress.mode).toBe("EMBEDDED");
    expect(transport.capabilities.autoCapture.input).toBe(true);
    expect(transport.capabilities.autoCapture.output).toBe(true);
  });

  it("a companion transport declares interception legality; Safi only records it", async () => {
    const transport = new CompanionTransport("ext-companion", "user consent + provider ToS");
    await safiLoop({ engine: makeEngine("provider-companion"), transport, message: "hello" });
    expect(transport.capabilities.interceptionLegality?.declared).toBe(true);
    expect(transport.capabilities.interceptionLegality?.basis).toBe("user consent + provider ToS");
  });
});

describe("Transport — manual fallback", () => {
  it("manual transport works with no integration at all", async () => {
    const transport = new ManualTransport();
    const result = await safiLoop({
      engine: makeEngine("provider-manual"),
      transport,
      message: "paste: what is 2 + 2?",
    });
    expect(result.ingress.transportId).toBe("manual-transport");
    expect(result.ingress.mode).toBe("MANUAL");
    expect(transport.capabilities.integrationFree).toBe(true);
    expect(transport.capabilities.autoCapture.input).toBe(false);
    expect(transport.captures.length).toBeGreaterThanOrEqual(2);
    expect(result.delivery.outcome.kind).toBe("result");
  });
});

describe("Transport — certified outcome immutability", () => {
  it("no transport adapter can alter the certificate: mutation throws", async () => {
    const transport = new EmbeddedTransport();
    const result = await safiLoop({
      engine: makeEngine("provider-x"),
      transport,
      message: "hello",
    });

    const frozen = result.delivery.outcome;
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(() => {
      // @ts-expect-error deliberate tampering attempt
      frozen.kind = "rejected";
    }).toThrow();
    if (frozen.kind === "result") {
      expect(() => {
        // @ts-expect-error deliberate tampering attempt
        (frozen.certificate as { trustStatus: string }).trustStatus = "VERIFIED";
      }).toThrow();
      expect(() => {
        // @ts-expect-error deliberate tampering attempt
        (frozen.certificate as { responseSha256: string }).responseSha256 =
          "f".repeat(64);
      }).toThrow();
    }
  });

  it("the stamp is frozen and cannot diverge from the certificate", async () => {
    const transport = new ManualTransport();
    const result = await safiLoop({
      engine: makeEngine("provider-y"),
      transport,
      message: "hello",
    });
    const stamp = result.delivery.stamp!;
    expect(Object.isFrozen(stamp)).toBe(true);
    expect(stamp.schema).toBe("safi-stamp/v0.1");
    if (result.delivery.outcome.kind === "result") {
      expect(stamp.trustStatus).toBe(result.delivery.outcome.certificate.trustStatus);
      expect(stamp.responseSha256).toBe(result.delivery.outcome.certificate.responseSha256);
    }
  });

  it("deep-frozen certificates can be safely handed to any transport", () => {
    const certificate = {
      schema: "safi-certificate/v0.1" as const,
      trustStatus: "UNCERTAIN" as const,
      verificationScope: { requiredChecks: ["a"] },
      checks: [],
      missingRequiredChecks: [],
      conflictingChecks: [],
      attempt: 1,
      maxAttempts: 1,
      provider: "p",
      policyId: "pol",
      createdAt: new Date(0).toISOString(),
      responseSha256: "a".repeat(64),
    };
    const stamp = projectStamp(certificate);
    expect(stamp.trustStatus).toBe("UNCERTAIN");
    expect(stamp.requiredChecks).toEqual(["a"]);
    expect(() => {
      // @ts-expect-error deliberate tampering attempt
      (stamp as { trustStatus: string }).trustStatus = "VERIFIED";
    }).toThrow();
  });

  it("every transport mode rejects certificate tampering identically", async () => {
    for (const transport of [new EmbeddedTransport(), new CompanionTransport(), new ManualTransport()]) {
      const result = await safiLoop({
        engine: makeEngine("provider-z"),
        transport,
        message: "hello",
      });
      expect(Object.isFrozen(result.delivery.outcome)).toBe(true);
      expect(Object.isFrozen(result.delivery.stamp)).toBe(true);
    }
  });
});
