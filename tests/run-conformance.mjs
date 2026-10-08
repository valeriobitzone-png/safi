#!/usr/bin/env node
/**
 * Safi v0.1 — zero-dependency conformance runner.
 *
 * Executes the conformance vectors in tests/vectors against the compiled
 * core in dist/. No npm packages are required: Node built-ins only.
 *
 * Build first:  npm run build   (or: tsc -p tsconfig.json)
 * Then run:     node tests/run-conformance.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const distIndex = join(here, "..", "dist", "src", "index.js");

if (!existsSync(distIndex)) {
  console.error("dist/src/index.js not found. Run `npm run build` first.");
  process.exit(1);
}

const safi = await import(distIndex);

const vectorsDir = join(here, "vectors");
const files = readdirSync(vectorsDir).filter((f) => f.endsWith(".json")).sort();

let passCount = 0;
let failCount = 0;

for (const file of files) {
  const vector = JSON.parse(readFileSync(join(vectorsDir, file), "utf8"));
  try {
    const engine = new safi.SafiEngine({
      provider: makeProvider(vector),
      verifiers: makeVerifiers(vector),
      policy: {
        id: vector.policy.id,
        scope: vector.policy.scope,
        maxCorrectionAttempts: vector.policy.maxCorrectionAttempts ?? 0,
      },
      ...(vector.policy.maxCorrectionAttempts > 0
        ? { correctionStrategy: makeCorrection(vector) }
        : {}),
      now: () => new Date(vector.frozenTime ?? 0),
    });

    const outcome = await engine.process({ message: vector.humanMessage });

    const expected = vector.expectedOutcome;
    const actual = outcome.kind;

    if (actual !== expected.kind) {
      failCount += 1;
      console.log(`FAIL ${file}: expected outcome ${expected.kind}, got ${actual}`);
      continue;
    }

    if (expected.kind === "result") {
      if (outcome.certificate.trustStatus !== expected.trustStatus) {
        failCount += 1;
        console.log(
          `FAIL ${file}: expected trust ${expected.trustStatus}, got ${outcome.certificate.trustStatus}`,
        );
        continue;
      }
      if (expected.answerEqualsHumanMessage === true && outcome.answer !== vector.humanMessage) {
        failCount += 1;
        console.log(`FAIL ${file}: answer does not equal the human message`);
        continue;
      }
    }

    passCount += 1;
    const status = expected.kind === "result" ? expected.trustStatus : actual.toUpperCase();
    console.log(`PASS ${file}: ${status}`);
  } catch (error) {
    failCount += 1;
    console.log(`FAIL ${file}: ${error && error.message ? error.message : String(error)}`);
  }
}

console.log(`\n${passCount} conformance vectors passed.`);

if (failCount > 0) {
  console.log(`${failCount} conformance vectors failed.`);
  process.exit(1);
}

/* ---------- vector helpers (no dependencies) ---------- */

function makeProvider(vector) {
  return {
    id: "vector-provider",
    async execute(request) {
      const entry =
        (vector.providerResponses ?? []).find((r) => r.attempt === request.attempt) ??
        vector.providerResponses?.[vector.providerResponses.length - 1];
      return {
        text: entry ? entry.text : "",
        provider: "vector-provider",
        attempt: request.attempt,
      };
    },
  };
}

function makeVerifiers(vector) {
  return (vector.verifierResults ?? []).map((spec) => ({
    checkId: spec.checkId,
    async verify(candidate, context) {
      const scripted = typeof spec.outcome === "function" ? "INCONCLUSIVE" : spec.outcome;
      return {
        checkId: spec.checkId,
        outcome: scripted,
        detail: spec.detail ?? `Scripted outcome ${scripted} for check ${spec.checkId}.`,
        verifierId: `scripted-${spec.checkId}`,
        ...(spec.evidence !== undefined ? { evidence: spec.evidence } : {}),
      };
    },
  }));
}

function makeCorrection(vector) {
  return {
    plan() {
      return vector.correction ? { note: vector.correction.note ?? "correction attempt" } : null;
    },
  };
}
