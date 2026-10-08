// @vitest-environment node
/**
 * Final human product acceptance — the five scenarios, end to end.
 *
 * No new behaviour is introduced here. Each scenario drives the *real* vertical
 * slice: the composer's prompt goes in, the scripted provider answers, the
 * verifier certifies the exact text, and the judge and translator read it. The
 * point is to see what a person would actually be shown, including the cases
 * where the answer is true but wrong, or mixed, or simply long.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ScriptedCompanionAdapter,
  createCompanionPermissions,
  createCompanionVerticalSlice,
} from "../packages/companion/index.js";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function clock() {
  let t = 0;
  return { nowMs: () => t, sleep: async (ms: number) => { t += Math.max(1, ms); } };
}

/** One full person → provider → Safi cycle, with the real layers attached. */
async function cycle({
  request,
  answer,
  trustStatus = "VERIFIED",
  claimEvidence = [] as object[],
  corrections = [] as object[],
}: {
  request: string;
  answer: string;
  trustStatus?: string;
  claimEvidence?: object[];
  corrections?: object[];
}) {
  const adapter = new ScriptedCompanionAdapter({ composerText: request, responseText: answer });
  const certificate = { trustStatus, responseSha256: sha(answer), claimEvidence, corrections };
  const client = {
    translate: async ({ message }: { message: string }) => ({
      frame: { goal: "", task: message, needsClarification: false },
      semantic: { originalMessage: message, goal: "", task: message },
    }),
    verify: async ({ answer: text }: { answer: string }) => ({ kind: "result", answer: text, certificate }),
  };
  const permissions = createCompanionPermissions();
  for (const permission of ["composer:read", "composer:write", "response:read"]) {
    permissions.grant(permission as never, { userGesture: true });
  }
  const time = clock();
  const slice = createCompanionVerticalSlice({
    adapter,
    safiClient: client as never,
    permissions,
    hashText: async (text: string) => sha(text),
    nowMs: time.nowMs,
    sleep: time.sleep,
  } as never);
  const api = slice as never as Record<string, (options: object) => Promise<Record<string, unknown>>>;
  const prepared = await api.preparePrompt({ userGesture: true });
  await api.usePreparedPrompt({ userGesture: true, promptId: prepared.promptId });
  adapter.startNewTurn({ streaming: false, text: answer });
  const observed = await api.observeAndVerify({ userGesture: true, timeoutMs: 5_000 });
  return { prepared, observed, human: observed.human as Record<string, never>, judgment: observed.fulfillment as Record<string, never>, card: (observed.human as never as { card: { text: string } }).card };
}

describe("Scenario 1 — a simple request stays simple", () => {
  it("composes a short, proportional prompt and asks nothing", async () => {
    const { prepared, card } = await cycle({
      request: "mi fai una mail al commercialista per dirgli che pago venerdì?",
      answer: "Gentile dottore, le confermo che effettuerò il pagamento venerdì. Cordiali saluti.",
    });
    const translated = String(prepared.translated);
    expect(translated.length).toBeLessThanOrEqual(120);
    expect(translated).toContain("commercialista");
    // no scaffolding, no interrogation
    expect(translated).not.toMatch(/vincoli|formato richiesto|Non fare/i);
    expect(prepared.automaticSend).toBe(false);
    expect(card.text.startsWith("SAFI")).toBe(true);
  });
});

describe("Scenario 2 — the central case, end to end", () => {
  const answer = [
    "Controlla l'usanza: un canone in aumento inciso nel contratto vale anche per gli incrementi futuri.",
    "Verifica la destinazione d'uso dell'immobile con il Comune e che l'attività sia compatibile con il regolamento di quartiere.",
    "Il visto di conformità dell'impianto idraulico è obbligatorio per la cucina.",
  ].join(" ");

  it("walks blueprint → prompt → response → truth → fulfillment → completeness → card", async () => {
    const { prepared, observed, human, judgment } = await cycle({
      request: "sto aprendo un ristorante, dimmi in parole semplici che cose devo considerare prima di scegliere il locale",
      answer,
      claimEvidence: [
        { spanId: "claim-1", verificationStatus: "VERIFIED", evidenceRefs: ["art-1576-c.c."] },
        { spanId: "claim-2", verificationStatus: "VERIFIED", evidenceRefs: ["regolamento-comunale"] },
      ],
    });
    // PromptBlueprint: proportional, human's own words preserved
    expect(String(prepared.translated)).toContain("ristorante");
    expect(String(prepared.translated).length).toBeLessThan(220);
    // truth, on the exact response
    expect(observed.certified).toBe(true);
    expect(observed.exactFinalTextSha256).toBe(sha(answer));
    // fulfillment and completeness, judged separately from truth
    expect(judgment.fulfillment).toBe("COMPLETE");
    expect(judgment.completeness).toBe("COMPLETE");
    // humanization, and the separation from evidence
    expect(human.isEvidence).toBe(false);
    expect(String((human.card as never as { text: string }).text)).toContain("In breve");
  });
});

describe("Scenario 3 — true, but incomplete", () => {
  it("keeps VERIFIED while completeness is not COMPLETE, and says Manca", async () => {
    // Every sentence here is defensible; the answer simply leaves out the
    // things the person asked to consider.
    const answer = "Il canone si adegua solo se è previsto nel contratto di locazione commerciale.";
    const { observed, judgment, human, card } = await cycle({
      request: "sto aprendo un ristorante, dimmi in parole semplici che cose devo considerare prima di scegliere il locale",
      answer,
      trustStatus: "VERIFIED",
    });
    // truth is untouched
    expect(observed.certificate.trustStatus).toBe("VERIFIED");
    // and the gaps are named
    expect(judgment.completeness).not.toBe("COMPLETE");
    expect((human.missing as never as unknown[]).length).toBeGreaterThan(0);
    expect(card.text).toContain("Manca");
  });
});

describe("Scenario 4 — a mixed answer stays mixed", () => {
  it("separates a supported, an uncertain and a contradicted claim", async () => {
    const answer = [
      "Il canone in locazione commerciale si adegua solo se previsto in contratto.",
      "La licenza di apertura del locale va rinnovata ogni anno.",
      "Gli attrezzi da cucina possono stare a temperatura ambiente.",
    ].join(" ");
    const { human, card } = await cycle({
      request: "dimmi in parole semplici che cosa devo considerare per aprire un ristorante",
      answer,
      trustStatus: "UNCERTAIN",
      claimEvidence: [
        { spanId: "claim-1", verificationStatus: "VERIFIED", evidenceRefs: ["art-1582-cc"] },
        { spanId: "claim-2", verificationStatus: "UNCERTAIN", evidenceRefs: [] },
        { spanId: "claim-3", verificationStatus: "FAILED", evidenceRefs: ["haccp-alimentare"] },
      ],
    });
    const confirmed = human.confirmed as never as unknown[];
    const cautions = human.cautions as never as { reason: string; text: string }[];
    // exactly one claim is presented as confirmed
    expect(confirmed).toHaveLength(1);
    expect((confirmed[0] as { text: string }).text).toContain("canone");
    // the contradicted one is named as contradicted, not quietly confirmed
    const contradicted = cautions.find((item) => item.reason === "CONTRADITTA_DALL_EVIDENZA");
    expect(contradicted).toBeTruthy();
    expect(contradicted!.text).toContain("temperatura ambiente");
    // and the uncertain one is neither confirmed nor dropped
    expect(cautions.some((item) => item.text.includes("licenza"))).toBe(true);
    expect(card.text).toMatch(/Da controllare/);
  });
});

describe("Scenario 5 — long but correct", () => {
  it("is complete, and reads far shorter than it is", async () => {
    const answer = [
      "1. Prima di scegliere il locale controlla l'usanza e gli incrementi futuri del canone.",
      "2. Per il locale verifica la destinazione d'uso e il regolamento di quartiere.",
      "3. Per la cucina del ristorante richiedi il visto di conformità dell'impianto idraulico.",
      "4. Per il locale verifica ventilazione, capienza e isolamento acustico per i vicini.",
      "5. Per il ristorante controlla l'orario di chiusura e le licenze per somministrazione.",
    ].join("\n");
    const { observed, judgment, human } = await cycle({
      request: "sto aprendo un ristorante, dimmi in parole semplici che cose devo considerare prima di scegliere il locale",
      answer,
    });
    expect(observed.certified).toBe(true);
    expect(judgment.fulfillment).toBe("COMPLETE");
    expect(judgment.completeness).toBe("COMPLETE");
    // the reading is a fraction of the original, and still built from it
    const summary = String(human.humanSummary);
    expect(summary.length).toBeLessThan(answer.length / 2);
    const source = new Set(answer.toLowerCase().split(/\W+/));
    for (const word of summary.toLowerCase().split(/\W+/)) {
      if (word.length > 3) expect(source.has(word)).toBe(true);
    }
  });
});
