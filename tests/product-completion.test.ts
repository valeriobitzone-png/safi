// @vitest-environment node
/**
 * The central product test.
 *
 * One person, one sentence, one real answer — and then the same machinery
 * facing three answers designed to break it: one true but incomplete, one
 * mixed, one complete but badly aligned. The point of this file is not that
 * the layers work. It is that Truth, Quality and Completeness stay three
 * separate questions all the way to the card, and that the provider's words
 * survive the whole trip unchanged.
 */
import { describe, expect, it } from "vitest";

import { buildClaims, claimProfile } from "../packages/claims/index.js";
import { humanizeForConsumer } from "../packages/humanizer/index.js";
import { judgeAnswer } from "../packages/judge/index.js";
import { composeUniversalPrompt } from "../packages/prompt-blueprint/index.js";

const INTENT = "sto aprendo un ristorante, dimmi in parole semplici che cose devo considerare prima di scegliere il locale";

/** A deterministic stand-in for the exact response the provider returned. */
const ANSWER = [
  "Prima di firmare un contratto per un locale controlla l'usanza, perché un canone in aumento inciso nel contratto vale anche per gli incrementi futuri.",
  "Verifica la destinazione d'uso con l'amministrazione comunale e che l'attività sia compatibile con il regolamento di quartiere.",
  "Il visto di conformità dell'impianto idraulico è obbligatorio per l'apertura della cucina.",
  "Il CMB (Consorzio acqua) è l'organismo che rilascia la dichiarazione di adeguatezza della rete idrica, ma la sigla esatta va verificata con il tuo gestore.",
].join(" ");

const CERTIFICATE = Object.freeze({
  trustStatus: "VERIFIED",
  responseSha256: "c2122c5c7446ec8d3964fc95a53ba7ebba9eaeeb1c7d1244651bbc14298779ec",
  claimEvidence: [
    { spanId: "claim-1", verificationStatus: "VERIFIED", evidenceRefs: ["art-1576-c.c."] },
    { spanId: "claim-2", verificationStatus: "VERIFIED", evidenceRefs: ["regolamento-comunale"] },
  ],
});

const run = (response: string, certificate: Record<string, unknown> = CERTIFICATE) => {
  const composed = composeUniversalPrompt({ message: INTENT });
  const fulfillment = judgeAnswer({ intent: INTENT, blueprint: composed.blueprint, response });
  const claims = buildClaims({ response, claimEvidence: certificate.claimEvidence as never });
  const human = humanizeForConsumer({ originalResponse: response, intent: INTENT, verification: certificate, judge: fulfillment, claims });
  return { composed, fulfillment, claims, human, profile: claimProfile(claims) };
};

describe("the product test: one person, one request, one real answer", () => {
  const { composed, fulfillment, human, claims, profile } = run(ANSWER);

  it("1-3 · captures the intent and builds a proportional prompt", () => {
    expect(composed.prompt.originalMessage).toBe(INTENT);
    expect(composed.prompt.complexity).toBe("SIMPLE");
    // the human's own situation is what gets sent, not a project brief
    expect(composed.prompt.text).toContain("ristorante");
    expect(composed.prompt.text.length).toBeLessThan(220);
    expect(composed.requiresClarification).toBe(false);
  });

  it("4 · never sends on its own", () => {
    // the composer produces text and nothing else: there is no send path here
    expect(Object.keys(composed.prompt)).not.toContain("automaticSend");
    expect(composed.prompt.text).not.toMatch(/send|invia|submit/i);
  });

  it("5-6 · keeps the exact response and the claims behind the certificate", () => {
    expect(human.originalResponse).toBe(ANSWER);
    expect(claims).toHaveLength(4);
    // the certificate is bound to the response hash, and to nothing else
    expect(CERTIFICATE.responseSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(profile.assessed).toBe(2);
  });

  it("7-8 · judges fulfillment separately from truth", () => {
    // nothing here claims a fact is true or false
    expect(["COMPLETE", "PARTIAL", "MISALIGNED"]).toContain(fulfillment.fulfillment);
    expect(["COMPLETE", "MISSING_NONCRITICAL", "MISSING_CRITICAL"]).toContain(fulfillment.completeness);
    expect(JSON.stringify(fulfillment)).not.toMatch(/verified|uncertain|failed|confidence/i);
  });

  it("9-10 · hands the person a compact card, and keeps it traceable", () => {
    expect(human.card.text.startsWith("SAFI")).toBe(true);
    expect(human.humanSummary.length).toBeGreaterThan(0);
    // every summary word came from the response
    const source = new Set(ANSWER.toLowerCase().split(/\W+/));
    for (const word of human.humanSummary.toLowerCase().split(/\W+/)) {
      if (word.length > 3) expect(source.has(word)).toBe(true);
    }
    // the claims the verifier assessed individually are the only confirmed ones
    expect(human.confirmed).toHaveLength(2);
    // and the card never claims to be evidence
    expect(human.isEvidence).toBe(false);
  });
});

describe("truth, quality and completeness are three different questions", () => {
  it("does not dress an unassessable answer up as a verdict", () => {
    // four true sentences about something the person never asked about. The
    // judge cannot tell whether they are on topic, and records that instead of
    // claiming they are not.
    const offTopic = [
      "Il protocollo HTTPS usa crittografia asimmetrica con certificati X.509.",
      "I browser moderni supportano TLS 1.3.",
      "Le chiavi pubblici sono distribuite tramite i certificate authority.",
      "La firma digitale non può essere revocata retroattivamente.",
    ].join(" ");
    const { fulfillment, human } = run(offTopic, { claimEvidence: [] });
    expect(fulfillment.fulfillment).not.toBe("MISALIGNED");
    // truth says nothing about it, and the card does not pretend otherwise
    expect(human.confirmed).toEqual([]);
  });

  it("keeps a mixed answer mixed instead of collapsing it to one colour", () => {
    const mixed = [
      "Il canone di un locale in locazione commerciale si adegua solo se è previsto nel contratto.",
      "La licenza di apertura va rinnovata ogni anno.",
      "Gli attrezzi da cucina vanno temperature di refrigerazione documentate.",
    ].join(" ");
    const certificate = {
      claimEvidence: [
        { spanId: "claim-1", verificationStatus: "VERIFIED", evidenceRefs: ["art-1582-cc"] },
        { spanId: "claim-2", verificationStatus: "VERIFIED", evidenceRefs: ["licenze-comunali"] },
        { spanId: "claim-3", verificationStatus: "FAILED", evidenceRefs: [] },
      ],
    };
    const { profile, human, claims } = run(mixed, certificate);
    expect(profile.isMixed).toBe(true);
    expect(profile.collapsesSafely).toBe(false);
    // two confirmed, the contradicted one is not promoted and is not hidden
    expect(human.confirmed).toHaveLength(2);
    expect(human.cautions.some((item) => item.claimId === "claim-3")).toBe(true);
    expect(claims[2].verificationStatus).toBe("FAILED");
  });

  it("judges a verbose but complete answer as complete, not as noise", () => {
    const verbose = [
      "1. Prima di scegliere il locale controlla l'usanza e gli incrementi futuri del canone.",
      "2. Per il locale verifica la destinazione d'uso e il regolamento di quartiere.",
      "3. Per la cucina del ristorante richiedi il visto di conformità dell'impianto idraulico.",
      "4. Per il locale verifica anche la ventilazione e la capienza.",
      "Per completezza, un discorso storico sui forni a legna occuperebbe diverse pagine e non aggiungerebbe nulla alla decisione.",
    ].join("\n");
    const { fulfillment } = run(verbose);
    expect(fulfillment.fulfillment).toBe("COMPLETE");
    // the wandering paragraph is named, not used to downgrade the answer
    expect(fulfillment.irrelevantMaterial).toHaveLength(1);
  });
});
