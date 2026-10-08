/**
 * Safi v0.1 — basic runtime flow.
 *
 * Deterministic demo: a stub provider, two verifiers and a policy with
 * explicit verification scope. Prints the final SafiOutcome as JSON,
 * including the certificate bound to the exact human-facing answer.
 */
import { SafiEngine } from "../src/engine.js";
import type {
  CandidateResponse,
  ProviderAdapter,
  SafiRequest,
  Verifier,
  VerificationContext,
  VerificationResult,
} from "../src/types.js";

class EchoProvider implements ProviderAdapter {
  readonly id = "echo-provider";

  async execute(request: SafiRequest): Promise<CandidateResponse> {
    return {
      text: `Answer to "${request.task}" (attempt ${request.attempt}).`,
      provider: this.id,
      attempt: request.attempt,
    };
  }
}

class MathVerifier implements Verifier {
  readonly checkId = "math";

  async verify(candidate: CandidateResponse, _context: VerificationContext): Promise<VerificationResult> {
    return {
      checkId: this.checkId,
      outcome: "PASS",
      detail: "Arithmetic statements in the candidate are consistent.",
      verifierId: "MathVerifier",
    };
  }
}

class CoherenceVerifier implements Verifier {
  readonly checkId = "coherence";

  async verify(candidate: CandidateResponse, context: VerificationContext): Promise<VerificationResult> {
    const coherent = candidate.text.trim().length > 0 && context.text.includes("Answer");
    return {
      checkId: this.checkId,
      outcome: coherent ? "PASS" : "FAIL",
      detail: coherent
        ? "The candidate addresses the stated task."
        : "The candidate does not address the stated task.",
      verifierId: "CoherenceVerifier",
    };
  }
}

async function main(): Promise<void> {
  const engine = new SafiEngine({
    provider: new EchoProvider(),
    verifiers: [new MathVerifier(), new CoherenceVerifier()],
    policy: {
      id: "demo-policy-strict",
      scope: { requiredChecks: ["math", "coherence"], optionalChecks: ["freshness"] },
      maxCorrectionAttempts: 1,
    },
    correctionStrategy: {
      plan: ({ summary }) =>
        summary.status === "FAILED"
          ? { note: "retry once with the same explicit verification scope" }
          : null,
    },
    now: () => new Date(0),
  });

  const outcome = await engine.process({
    message: "Explain this to me as if I knew nothing about computers.",
  });

  console.log(JSON.stringify(outcome, null, 2));
}

main().then(
  () => console.log("RESULT"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
