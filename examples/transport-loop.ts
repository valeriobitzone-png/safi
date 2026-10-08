/**
 * Safi v0.1.x — transport loop example.
 *
 * Runs the same human message through the three transport modes
 * (EMBEDDED, COMPANION, MANUAL) and prints one outcome per mode,
 * including the Safi Stamp projected from the certificate.
 */
import { SafiEngine } from "../src/engine.js";
import { PlainLanguageTranslator } from "../src/translate.js";
import {
  CompanionTransport,
  EmbeddedTransport,
  ManualTransport,
  safiLoop,
} from "../src/transport.js";
import type {
  CandidateResponse,
  ProviderAdapter,
  SafiRequest,
  TransportAdapter,
} from "../src/types.js";

function makeEngine(providerId: string): SafiEngine {
  const provider: ProviderAdapter = {
    id: providerId,
    execute: async (request: SafiRequest): Promise<CandidateResponse> => ({
      text: `Answer to "${request.task}" (via ${providerId}).`,
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
    policy: {
      id: "transport-demo-policy",
      scope: { requiredChecks: ["coherence"] },
      maxCorrectionAttempts: 0,
    },
    translator: new PlainLanguageTranslator(),
  });
}

async function run(mode: string, transport: TransportAdapter): Promise<void> {
  const result = await safiLoop({
    engine: makeEngine(`provider-${mode.toLowerCase()}`),
    transport,
    message: "Ciao, per favore spiegami cos'è un DNS in parole semplici.",
  });
  console.log(`--- ${mode} ---`);
  console.log(JSON.stringify(result.delivery, null, 2));
}

async function main(): Promise<void> {
  await run("EMBEDDED", new EmbeddedTransport());
  await run("COMPANION", new CompanionTransport());
  await run("MANUAL", new ManualTransport());
}

main().then(
  () => console.log("RESULT"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
