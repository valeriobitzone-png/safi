#!/usr/bin/env node
/**
 * Phase 4 demo verification — runs the five scenarios end-to-end and
 * asserts the acceptance criteria. Zero dependencies beyond devDeps.
 *
 *   node packages/demo-web/verify-demos.mjs
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { ok, strictEqual: eq } = require("node:assert");

import { demo1Translation, demo2Calculation, demo3Correction, demo4Uncertainty, demo4bFailed } from "./scenarios.js";
import { projectStamp } from "../transport-manual/index.js";
import { sha256Text } from "./hashing.js";

async function run(scenario, expectations) {
  const result = await scenario.run();
  const outcome = result.delivery.outcome;
  const certificate = outcome.kind === "result" ? outcome.certificate : undefined;

  if (expectations.kind) eq(outcome.kind, expectations.kind, `${scenario.humanMessage}: outcome kind`);
  if (expectations.trust) {
    eq(certificate?.trustStatus, expectations.trust, `${scenario.humanMessage}: trust status`);
  }
  if (expectations.hashMatchesAnswer) {
    eq(certificate.responseSha256, sha256Text(outcome.answer), "certificate hash binds the shown answer");
  }
  return { result, outcome, certificate };
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* Demo 1 — colloquial input translated, intent preserved, no prompt written by the person */
await check("Demo 1 — colloquial translation preserves intent", async () => {
  const scenario = demo1Translation();
  const { result, outcome, certificate } = await run(scenario, { kind: "result", trust: "VERIFIED", hashMatchesAnswer: true });
  const s = result.steps.semantic;
  eq(s.originalMessage, scenario.humanMessage, "original human words carried verbatim");
  ok(s.task.includes("buchi neri"), "task keeps the black holes subject");
  ok(!s.task.includes("Oh") && !s.task.includes("semplice semplice"), "colloquialisms normalized");
  eq(s.constraints.depth, "beginner", "beginner constraint preserved");
  eq(result.steps.safiRequest.humanMessage, scenario.humanMessage, "humanMessage immutable in SafiRequest");
  eq(certificate.responseSha256, sha256Text(outcome.answer), "hash binds the human-facing answer");
});

/* Demo 2 — real deterministic verification: VERIFIED only if math matches */
await check("Demo 2 — deterministic calculation verified", async () => {
  const { outcome, certificate } = await run(demo2Calculation(), { kind: "result", trust: "VERIFIED", hashMatchesAnswer: true });
  ok(outcome.answer.includes("3318"), "answer states 3318");
  eq(certificate.policyId, "demo-calculation");
  eq(certificate.attempt, 1);
});

/* Demo 3 — first candidate wrong on purpose, correction reaches VERIFIED with history */
await check("Demo 3 — wrong answer corrected at second attempt with history", async () => {
  const { outcome, certificate } = await run(demo3Correction(), { kind: "result", trust: "VERIFIED", hashMatchesAnswer: true });
  eq(certificate.attempt, 2, "certified attempt is the second");
  eq(certificate.attemptHistory?.length, 1, "history keeps the failed first attempt");
  eq(certificate.attemptHistory?.[0]?.trustStatus, "FAILED", "first attempt was FAILED");
  ok(outcome.answer.includes("3318"), "final answer is the correct one");
});

/* Demo 4 — insufficient evidence stays UNCERTAIN */
await check("Demo 4 — insufficient evidence stays UNCERTAIN", async () => {
  const { certificate } = await run(demo4Uncertainty(), { kind: "result", trust: "UNCERTAIN", hashMatchesAnswer: true });
  eq(certificate.missingRequiredChecks.length, 0);
  ok(certificate.checks.some((c) => c.checkId === "sources" && c.outcome === "INCONCLUSIVE"));
});

/* Demo 4b — really FAILED, honestly certified */
await check("Demo 4b — unverifiable claim is FAILED", async () => {
  const { certificate } = await run(demo4bFailed(), { kind: "result", trust: "FAILED", hashMatchesAnswer: true });
  ok(certificate.checks.some((c) => c.checkId === "sources" && c.outcome === "FAIL"), "source contradiction yields FAIL");
});

/* Stamp projection matches the certificate */
await check("Stamp projection matches certificate", async () => {
  const { result, certificate } = await run(demo2Calculation(), {});
  const stamp = result.delivery.stamp;
  eq(stamp.schema, "safi-stamp/v0.1");
  eq(stamp.responseSha256, certificate.responseSha256);
  eq(stamp.trustStatus, certificate.trustStatus);
});

console.log(failures === 0 ? "\nAll demo scenarios verified." : `\n${failures} demo checks failed.`);
process.exit(failures === 0 ? 0 : 1);
