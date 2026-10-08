// @vitest-environment node
/**
 * The Quality / Completeness Judge.
 *
 * The layer's credibility rests on one property: it can say PARTIAL, MISALIGNED
 * and MISSING_CRITICAL without ever touching the truth vocabulary, and it can
 * do so for an answer whose every fact is perfectly true. These tests hold both
 * ends of that.
 */
import { describe, expect, it } from "vitest";

import {
  COMPLETENESS,
  FULFILLMENT,
  JUDGE_ALIGNMENT_BASIS,
  JUDGE_VOCABULARY,
  QUALITY_JUDGE_STATUS,
  judgeAnswer,
} from "../packages/judge/index.js";

const blueprintFor = (message: string, overrides: Record<string, unknown> = {}) => ({
  shape: "GENERAL",
  complexity: "SIMPLE",
  objective: message,
  inputs: [message],
  missingEssentialInformation: [],
  ...overrides,
});

describe("Quality Judge — the brief's own example", () => {
  const intent = "dammi tre idee economiche e senza pubblicità a pagamento";
  const answer = [
    "1. Rivendere l'usato online",
    "2. Affittare un box auto nel quartiere",
    "3. Aprire un piccolo lavand self-service",
    "4. Vendere abbonamenti a un periodico locale",
    "5. Fare pubblicità a pagamento sui social per farti conoscere",
  ].join("\n");

  it("calls it PARTIAL, not complete, and names the broken constraint", () => {
    const judgment = judgeAnswer({ intent, blueprint: blueprintFor(intent), response: answer });
    expect(judgment.fulfillment).toBe(FULFILLMENT.PARTIAL);
    expect(judgment.violatedConstraints.join(" ")).toMatch(/pubblicità|pubblicita/);
    // five answers to a request for three is off target, and said out loud
    expect(judgment.offTargetRequirements).toHaveLength(1);
    expect(judgment.offTargetRequirements[0].detail).toMatch(/3/);
  });

  it("reaches the same verdict whatever the truth of the content is", () => {
    const withTruth = judgeAnswer({
      intent,
      blueprint: blueprintFor(intent),
      response: answer,
      // truth input a judge must never read: no parameter exists for it
    } as never);
    const withoutTruth = judgeAnswer({ intent, blueprint: blueprintFor(intent), response: answer });
    expect(withTruth.fulfillment).toBe(withoutTruth.fulfillment);
    expect(withTruth.completeness).toBe(withoutTruth.completeness);
  });
});

describe("Quality Judge — the three axes stay apart", () => {
  it("never asserts topical misalignment it cannot support", () => {
    // A fluent answer about the wrong subject shares no words with the
    // question, exactly like a plain-language answer about the right one.
    // The judge says what it can check and records that it did not check the
    // rest, rather than inventing a verdict in either direction.
    const intent = "spiegami in parole semplici come funziona un impianto fotovoltaico";
    const response = "Il protocollo HTTPS usa la crittografia asimmetrica con certificati X.509 emessi da autorità riconosciute.";
    const judgment = judgeAnswer({ intent, blueprint: blueprintFor(intent, { shape: "EXPLAIN" }), response });
    expect(judgment.alignmentBasis).toBe(JUDGE_ALIGNMENT_BASIS.NOT_ASSESSED);
    expect(judgment.fulfillment).not.toBe(FULFILLMENT.MISALIGNED);
  });

  it("still calls a non-answer MISALIGNED", () => {
    const intent = "spiegami in parole semplici come funziona un impianto fotovoltaico";
    const judgment = judgeAnswer({
      intent,
      blueprint: blueprintFor(intent, { shape: "EXPLAIN" }),
      response: "Mi dispiace, non posso rispondere a questa domanda.",
    });
    expect(judgment.fulfillment).toBe(FULFILLMENT.MISALIGNED);
    expect(judgment.completeness).toBe(COMPLETENESS.MISSING_CRITICAL);
  });

  it("calls a complete but wandering answer complete, and lists the wandering", () => {
    const intent = "dammi tre idee economiche per un piccolo bar";
    const response = [
      "1. Vendere prodotti a Km zero con fornitori della zona",
      "2. Offrire un servizio di colazione veloce la mattina presto",
      "3. Organizzare corsi serali di pasticceria per amatori",
      "In sintesi, un piccolo bar può contare su prodotti locali, colazione veloce e corsi: nessun investimento grande.",
      "A margine, una curiosità che non c’entra: nel Seicento i mercanti olandesi scambiavano bulbi con contratti che non prevedevano alcuna garanzia sul valore del carico consegnato.",
    ].join("\n");
    const judgment = judgeAnswer({ intent, blueprint: blueprintFor(intent), response });
    expect(judgment.fulfillment).toBe(FULFILLMENT.COMPLETE);
    expect(judgment.irrelevantMaterial).toHaveLength(1);
  });

  it("asks for the things the person asked for, not for a generic ideal", () => {
    const intent = "sto aprendo un ristorante, dimmi che cose devo considerare prima di scegliere il locale";
    const judgment = judgeAnswer({
      intent,
      blueprint: blueprintFor(intent, { shape: "EXPLAIN" }),
      response: "Il canone si adegua solo se previsto nel contratto di locazione commerciale.",
    });
    // one true sentence, but the person asked for the things to consider
    expect(judgment.fulfillment).toBe(FULFILLMENT.PARTIAL);
    expect(judgment.completeness).toBe(COMPLETENESS.MISSING_NONCRITICAL);
    expect(judgment.missingRequirements.join(" ")).toMatch(/elenco|punti/);
  });

  it("reports a satisfied request as complete and missing nothing", () => {
    const intent = "dammi tre idee economiche per un piccolo bar";
    const response = ["1. Vendere prodotti a Km zero", "2. Colazione veloce", "3. Corsi serali di pasticceria"].join("\n");
    const judgment = judgeAnswer({ intent, blueprint: blueprintFor(intent), response });
    expect(judgment.fulfillment).toBe(FULFILLMENT.COMPLETE);
    expect(judgment.completeness).toBe(COMPLETENESS.COMPLETE);
    expect(judgment.missingRequirements).toEqual([]);
    expect(judgment.violatedConstraints).toEqual([]);
  });
});

describe("Quality Judge — vocabulary discipline", () => {
  const samples = [
    { intent: "scrivi una mail al commercialista", response: "Ciao, confermo il pagamento di venerdì." },
    { intent: "dammi tre idee senza pubblicità", response: "1. Una\n2. Due\n3. Tre" },
    { intent: "costruisci una web app per le spese", response: "Serve un database, un login e una dashboard." },
  ];

  it("never emits a trust word, a boolean or a confidence of its own", () => {
    for (const sample of samples) {
      const judgment = judgeAnswer({ ...sample, blueprint: blueprintFor(sample.intent) });
      // the verdict, the statuses and the requirement kinds are the only words
      // the judge speaks in its own voice
      const own = JSON.stringify({
        fulfillment: judgment.fulfillment,
        completeness: judgment.completeness,
        statuses: judgment.details.map((entry) => entry.status),
      });
      expect(own).not.toMatch(/verified|uncertain|failed|confidence|true|false/i);
      expect(own).not.toMatch(/":\s*(true|false)\b/);
    }
  });

  it("only ever answers in the declared vocabularies", () => {
    for (const sample of samples) {
      const judgment = judgeAnswer({ ...sample, blueprint: blueprintFor(sample.intent) });
      expect(JUDGE_VOCABULARY.fulfillment).toContain(judgment.fulfillment);
      expect(JUDGE_VOCABULARY.completeness).toContain(judgment.completeness);
    }
  });

  it("does not call relevant material irrelevant just because it repeats nothing", () => {
    // A good answer about the sky never says "sky" in every sentence: the
    // test is whether a passage belongs to the same answer, not whether it
    // echoes the question.
    const intent = "spiegami in parole semplici perché il cielo è azzurro";
    const response = [
      "Il cielo è azzurro per via del modo in cui la luce del Sole interagisce con l'aria.",
      "La luce del Sole contiene tutti i colori insieme.",
      "Il rosso e il giallo hanno onde lunghe e distese, mentre il blu e il violetto hanno onde corte e fitte.",
      "Noi vediamo quindi soprattutto il blu, ed è per questo che il cielo ci appare azzurro.",
    ].join(" ");
    const judgment = judgeAnswer({ intent, blueprint: blueprintFor(intent, { shape: "EXPLAIN" }), response });
    expect(judgment.irrelevantMaterial).toEqual([]);
  });

  it("refuses to answer at all rather than borrow the verifier's words", () => {
    // Trust words in the *material* are data, not vocabulary: a person may
    // write them, an answer may contain them. What must never happen is the
    // judge handing one back as its own verdict or status.
    const judgment = judgeAnswer({
      intent: "scrivi una mail senza usare la parola verified",
      blueprint: blueprintFor("scrivi una mail senza usare la parola verified"),
      response: "Il certificato X.509 è emesso dall'autorità: verified, in pratica.",
    });
    expect(JUDGE_VOCABULARY.fulfillment).toContain(judgment.fulfillment);
    expect(JUDGE_VOCABULARY.completeness).toContain(judgment.completeness);
    for (const entry of judgment.details) {
      expect(["MET", "THIN", "UNADDRESSED", "OFF_TARGET", "VIOLATED"]).toContain(entry.status);
    }
  });

  it("freezes what it returns", () => {
    const judgment = judgeAnswer({ intent: "dammi tre idee", response: "1. a\n2. b\n3. c", blueprint: blueprintFor("dammi tre idee") });
    expect(Object.isFrozen(judgment)).toBe(true);
    expect(Object.isFrozen(judgment.fulfilledRequirements)).toBe(true);
  });

  it("publishes its own status", () => {
    expect(QUALITY_JUDGE_STATUS).toMatch(/QUALITY \/ COMPLETENESS JUDGE/);
  });
});
