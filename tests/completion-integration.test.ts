// @vitest-environment node
/**
 * A + B + C inside the real vertical slice.
 *
 * The unit tests prove the three layers work on their own. This file proves
 * the *product* uses them: one capture, one insert, one observed answer, and
 * the result object carries a proportional prompt, an independent fulfillment
 * judgment, per-claim detail and a compact human reading — with the provider's
 * own words still intact underneath all of it.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  COMPANION_STATUS,
  ScriptedCompanionAdapter,
  createCompanionPermissions,
  createCompanionVerticalSlice,
} from "../packages/companion/index.js";

const INTENT = "sto aprendo un ristorante, dimmi in parole semplici che cose devo considerare prima di scegliere il locale";
const ANSWER = [
  "Controlla l'usanza: un canone in aumento inciso nel contratto vale anche per gli incrementi futuri.",
  "Verifica la destinazione d'uso dell'immobile con il Comune.",
  "Il visto di conformità dell'impianto idraulico è obbligatorio per la cucina.",
].join(" ");

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** Time only moves when the slice asks it to: no real waiting in a test. */
function deterministicClock() {
  let t = 0;
  return { nowMs: () => t, sleep: async (ms: number) => { t += Math.max(1, ms); } };
}

function makeSlice(answer = ANSWER) {
  const hash = sha(answer);
  const adapter = new ScriptedCompanionAdapter({
    composerText: INTENT,
    responseText: answer,
  });
  const certificate = {
    trustStatus: "VERIFIED",
    responseSha256: hash,
    claimEvidence: [
      { spanId: "claim-1", verificationStatus: "VERIFIED", evidenceRefs: ["art-1576-cc"] },
      { spanId: "claim-2", verificationStatus: "VERIFIED", evidenceRefs: ["regolamento-comunale"] },
    ],
  };
  const client = {
    translate: async ({ message }: { message: string }) => ({
      frame: { goal: "spiegare in parole semplici", task: message, needsClarification: false },
      semantic: { originalMessage: message, goal: "spiegare in parole semplici", task: message },
    }),
    verify: async ({ answer: text }: { answer: string }) => ({
      kind: "result",
      answer: text,
      certificate,
    }),
  };
  const permissions = createCompanionPermissions();
  const clock = deterministicClock();
  const slice = createCompanionVerticalSlice({
    adapter,
    safiClient: client as never,
    permissions,
    hashText: async (text: string) => sha(text),
    nowMs: clock.nowMs,
    sleep: clock.sleep,
  } as never);
  return { slice, certificate, permissions, adapter };
}

async function runToVerification(answer = ANSWER) {
  const { slice, certificate, permissions, adapter } = makeSlice(answer);
  for (const permission of ["composer:read", "composer:write", "response:read"]) {
    // granted exactly the way the panel does it: through the real API
    permissions.grant(permission as never, { userGesture: true });
  }
  const prepared = await (slice as never as { preparePrompt: (o: object) => Promise<Record<string, unknown>> }).preparePrompt({ userGesture: true });
  const used = await (slice as never as { usePreparedPrompt: (o: object) => Promise<Record<string, unknown>> }).usePreparedPrompt({ userGesture: true, promptId: prepared.promptId });
  // the provider answers: a new, stable turn is what the observer is waiting for
  adapter.startNewTurn({ streaming: false, text: answer });
  const observed = await (slice as never as { observeAndVerify: (o: object) => Promise<Record<string, unknown>> }).observeAndVerify({ userGesture: true, timeoutMs: 5_000 });
  return { prepared, used, observed, certificate };
}

describe("A + B + C in the real slice", () => {
  it("builds the prompt with Layer A and keeps the original message", async () => {
    const { prepared, used } = await runToVerification();
    expect(prepared.kind).toBe(COMPANION_STATUS.PROMPT_READY);
    expect(prepared.automaticSend).toBe(false);
    expect(prepared.original).toBe(INTENT);
    // proportional: the human's sentence, not a project brief
    expect(String(prepared.translated)).toContain("ristorante");
    expect(String(prepared.translated).length).toBeLessThan(220);
    // and Safi still inserts without sending
    expect(used.sent).toBe(false);
    expect(used.automaticSend).toBe(false);
  });

  it("keeps truth, fulfillment and the human reading as three separate results", async () => {
    const { observed, certificate } = await runToVerification();
    expect(observed.certified).toBe(true);
    expect(observed.certificate).toBe(certificate);
    // the provider's text is untouched and hash-bound
    expect(observed.exactFinalText).toBe(ANSWER);
    expect(observed.exactFinalTextSha256).toBe(sha(ANSWER));
    expect(observed.responseUnchanged).toBe(true);

    const fulfillment = observed.fulfillment as Record<string, unknown>;
    expect(["COMPLETE", "PARTIAL", "MISALIGNED"]).toContain(fulfillment.fulfillment);
    expect(["COMPLETE", "MISSING_NONCRITICAL", "MISSING_CRITICAL"]).toContain(fulfillment.completeness);

    const human = observed.human as Record<string, unknown>;
    expect(human.isEvidence).toBe(false);
    expect(String((human.card as { text: string }).text).startsWith("SAFI")).toBe(true);
    expect(human.humanizedResponse).not.toBe(ANSWER);
  });

  it("does not let a failure to explain an answer destroy its certificate", async () => {
    // an answer with no usable structure at all: the judge has almost nothing
    // to work with and the humanizer has one span to read
    const { observed } = await runToVerification("Nessuna informazione utile");
    // the certificate stands whatever the reading layers make of it
    expect(observed.certified).toBe(true);
    expect(observed.certificate).toBeTruthy();
    expect(observed.human).not.toBeNull();
    // short, but it is still an answer to an enumeration request: PARTIAL, not MISALIGNED
    expect((observed.fulfillment as Record<string, unknown>).fulfillment).toBe("PARTIAL");
  });

  it("carries per-claim detail so a mixed answer cannot be one colour", async () => {
    const mixed = [
      "Il canone in locazione commerciale si adegua solo se previsto in contratto.",
      "La licenza di apertura va rinnovata ogni anno.",
      "Gli attrezzi da cucina vanno refrigerazione documentata.",
    ].join(" ");
    const { observed } = await runToVerification(mixed);
    const summary = observed.claimSummary as Record<string, unknown>;
    expect(summary.total).toBe(3);
    expect(summary.assessed).toBe(2);
    expect(summary.isMixed).toBe(true);
    expect(summary.collapsesSafely).toBe(false);
  });
});
