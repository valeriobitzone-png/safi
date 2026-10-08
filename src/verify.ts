import type {
  CandidateResponse,
  SafiRequest,
  VerificationPolicy,
  VerificationResult,
  VerificationScope,
  VerificationSummary,
  Verifier,
  VerificationContext,
} from "./types.js";

/**
 * Deterministic aggregation rules for one required check with multiple
 * verifier results (spec §18):
 *
 *   PASS + FAIL         -> UNCERTAIN (conflict)
 *   PASS + INCONCLUSIVE -> UNCERTAIN (conflict)
 *   FAIL + INCONCLUSIVE -> FAILED
 *   all PASS            -> PASS
 *
 * FAIL dominates INCONCLUSIVE; any disagreement that is not
 * FAIL-dominated becomes UNCERTAIN.
 */
export function aggregateCheckOutcomes(outcomes: readonly string[]): "PASS" | "FAIL" | "CONFLICT" {
  const hasFail = outcomes.includes("FAIL");
  const hasInconclusive = outcomes.includes("INCONCLUSIVE");
  const hasPass = outcomes.includes("PASS");

  if (hasFail && hasPass) return "CONFLICT"; // PASS + FAIL
  if (hasFail && hasInconclusive) return "FAIL";
  if (hasFail) return "FAIL";
  if (hasPass && hasInconclusive) return "CONFLICT"; // PASS + INCONCLUSIVE
  if (hasPass) return "PASS";
  return "CONFLICT"; // only INCONCLUSIVE -> treat as disagreement -> UNCERTAIN
}

export interface AggregateOptions {
  /** Results already targeted at the final humanized text. */
  results: readonly VerificationResult[];
  /** Results targeted at the raw candidate text (merged for conflict detection). */
  rawResults?: readonly VerificationResult[];
}

/**
 * Aggregate verification results against a scope.
 *
 * Deterministic guarantees (spec §9):
 *   no checks executed          -> UNCERTAIN
 *   missing required check      -> UNCERTAIN
 *   any required FAIL           -> FAILED
 *   any required INCONCLUSIVE   -> UNCERTAIN
 *   all required PASS           -> VERIFIED
 *   empty required scope        -> never VERIFIED
 *
 * Optional checks never influence the trust status.
 */
export function aggregateVerification(
  scope: VerificationScope,
  options: AggregateOptions,
): VerificationSummary {
  const { results, rawResults } = options;
  const all = [...results, ...(rawResults ?? [])];

  const byCheck = new Map<string, VerificationResult[]>();
  for (const r of all) {
    const list = byCheck.get(r.checkId) ?? [];
    list.push(r);
    byCheck.set(r.checkId, list);
  }

  const missingRequiredChecks: string[] = [];
  const conflictingChecks: string[] = [];
  const ignoredOptionalFailures: string[] = [];
  const checks: VerificationResult[] = [];
  let anyRequiredFail = false;

  const required = scope.requiredChecks;
  const optional = scope.optionalChecks ?? [];

  if (required.length === 0) {
    // Empty scope: nothing can be required, status stays UNCERTAIN below.
  }

  for (const checkId of required) {
    const list = byCheck.get(checkId);
    if (!list || list.length === 0) {
      missingRequiredChecks.push(checkId);
      continue;
    }
    const verdict = aggregateCheckOutcomes(list.map((r) => r.outcome));
    checks.push(...list);
    if (verdict === "FAIL") {
      anyRequiredFail = true;
    } else if (verdict === "CONFLICT") {
      conflictingChecks.push(checkId);
    }
  }

  for (const checkId of optional) {
    const list = byCheck.get(checkId);
    if (!list || list.length === 0) continue;
    checks.push(...list);
    const verdict = aggregateCheckOutcomes(list.map((r) => r.outcome));
    if (verdict !== "PASS") {
      ignoredOptionalFailures.push(checkId);
    }
  }

  let status: VerificationSummary["status"];
  if (anyRequiredFail) {
    status = "FAILED";
  } else if (
    required.length === 0 ||
    missingRequiredChecks.length > 0 ||
    conflictingChecks.length > 0
  ) {
    status = "UNCERTAIN";
  } else {
    status = "VERIFIED";
  }

  return {
    status,
    checks: sortChecks(checks),
    missingRequiredChecks,
    conflictingChecks,
    ignoredOptionalFailures,
  };
}

function sortChecks(checks: readonly VerificationResult[]): VerificationResult[] {
  return [...checks].sort((a, b) => {
    if (a.checkId !== b.checkId) return a.checkId < b.checkId ? -1 : 1;
    const va = a.verifierId ?? "";
    const vb = b.verifierId ?? "";
    if (va !== vb) return va < vb ? -1 : 1;
    return a.outcome < b.outcome ? -1 : a.outcome > b.outcome ? 1 : 0;
  });
}

/**
 * Run every verifier once against the candidate text.
 * Verifier exceptions are captured as INCONCLUSIVE: a broken verifier
 * can never produce PASS.
 */
export async function runVerifiers(
  verifiers: readonly Verifier[],
  candidate: CandidateResponse,
  context: VerificationContext,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  for (const verifier of verifiers) {
    results.push(await runOneVerifier(verifier, candidate, context));
  }
  return results;
}

async function runOneVerifier(
  verifier: Verifier,
  candidate: CandidateResponse,
  context: VerificationContext,
): Promise<VerificationResult> {
  try {
    const result = await verifier.verify(candidate, context);
    if (result.outcome !== "PASS" && result.outcome !== "FAIL" && result.outcome !== "INCONCLUSIVE") {
      return {
        checkId: verifier.checkId,
        outcome: "INCONCLUSIVE",
        detail: `Verifier returned an invalid outcome and was normalized to INCONCLUSIVE.`,
        verifierId: verifier.constructor?.name,
      };
    }
    return {
      ...result,
      checkId: result.checkId ?? verifier.checkId,
      verifierId: result.verifierId ?? verifier.constructor?.name,
    };
  } catch (error) {
    return {
      checkId: verifier.checkId,
      outcome: "INCONCLUSIVE",
      detail: `Verifier exception captured: ${error instanceof Error ? error.message : String(error)}`,
      verifierId: verifier.constructor?.name,
    };
  }
}

/** Convenience: verify one candidate under a policy and aggregate. */
export async function verifyCandidate(
  candidate: CandidateResponse,
  policy: VerificationPolicy,
  verifiers: readonly Verifier[],
  request: SafiRequest,
): Promise<VerificationSummary> {
  const context: VerificationContext = { request, text: candidate.text };
  const results = await runVerifiers(verifiers, candidate, context);
  return aggregateVerification(policy.scope, { results });
}
