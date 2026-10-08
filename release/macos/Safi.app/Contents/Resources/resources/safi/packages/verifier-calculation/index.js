/**
 * Calculation verifier — OUTSIDE the core.
 *
 * Checks arithmetic claims in a candidate response against a
 * deterministic, model-independent evaluation. Returns only a
 * VerificationResult; the core decides what it means.
 */

const OPERATIONS = {
  "+": { sign: 1, apply: (a, b) => a + b },
  "-": { sign: -1, apply: (a, b) => a - b },
  "*": { sign: 1, apply: (a, b) => a * b },
  "/": { sign: 1, apply: (a, b) => (b === 0 ? null : a / b) },
};

/** Extracts a + b, a - b, a × b, a * b, a / b (integer operands). */
export function extractArithmetic(text) {
  const matches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*([+\-×x*/÷])\s*(\d+(?:[.,]\d+)?)/gi)];
  const found = [];
  for (const m of matches) {
    const a = Number(m[1].replace(",", "."));
    const rawOp = m[2].toLowerCase();
    const op = rawOp === "×" || rawOp === "x" ? "*" : rawOp === "÷" ? "/" : rawOp;
    const b = Number(m[3].replace(",", "."));
    if (Number.isFinite(a) && Number.isFinite(b) && OPERATIONS[op]) {
      found.push({ a, op, b, raw: m[0] });
    }
  }
  return found;
}

/** Deterministic evaluation, independent of any model. */
export function evaluateArithmetic({ a, op, b }) {
  const expected = OPERATIONS[op].apply(a, b);
  return expected === null ? null : Number(expected.toFixed(10));
}

/** Extracts integer/decimal results from the text near an expression. */
export function extractClaimedResults(text) {
  const results = [];
  const matches = [...text.matchAll(/(?:=|è|eccolo|risultato(?:\s+è)?)\s*(-?\d+(?:[.,]\d+)?)/gi)];
  for (const m of matches) {
    const value = Number(m[1].replace(",", "."));
    if (Number.isFinite(value)) results.push(value);
  }
  return results;
}

/**
 * Verifier factory. checkId defaults to "calculation".
 */
export function createCalculationVerifier({ checkId = "calculation" } = {}) {
  return {
    checkId,
    async verify(candidate) {
      const expressions = extractArithmetic(candidate.text);
      if (expressions.length === 0) {
        return {
          checkId,
          outcome: "INCONCLUSIVE",
          detail: "Nessuna espressione aritmetica trovata nella risposta.",
          verifierId: "verifier-calculation",
        };
      }
      const failures = [];
      for (const expr of expressions) {
        const expected = evaluateArithmetic(expr);
        if (expected === null) {
          failures.push(`${expr.raw}: divisione per zero`);
          continue;
        }
        const claimed = extractClaimedResults(candidate.text);
        const claimedNear = claimed.find((c) => Math.abs(c - expected) < 1e-9);
        if (claimedNear === undefined) {
          failures.push(`${expr.raw} dovrebbe essere ${expected}; dichiarato: ${claimed.join(", ") || "niente"}`);
        }
      }
      if (failures.length > 0) {
        return {
          checkId,
          outcome: "FAIL",
          detail: `Calcolo errato: ${failures.join(" | ")}`,
          verifierId: "verifier-calculation",
        };
      }
      return {
        checkId,
        outcome: "PASS",
        detail: `Calcolo corretto: ${expressions.map((e) => e.raw).join(", ")}.`,
        verifierId: "verifier-calculation",
      };
    },
  };
}
