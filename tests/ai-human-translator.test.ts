// @vitest-environment node
/**
 * The claim model and the AI → Human translator.
 *
 * The translator is the layer most able to do harm quietly, because its output
 * *looks* like an answer. These tests therefore check the three things that
 * must never be true: a new fact, an inherited verdict, and a correction
 * without a source.
 */
import { describe, expect, it } from "vitest";

import { CLAIM_REVIEW, buildClaims, claimProfile } from "../packages/claims/index.js";
import { HUMAN_SECTION_IDS, humanizeForConsumer } from "../packages/humanizer/index.js";

const RESPONSE = [
  "Il mare è salato perché l'acqua dissolve i sali minerali portati dai fiumi e dal suolo.",
  "Questo fenomeno è chiamato salinizzazione.",
  "La salsedine media delle coste mediterranee si aggira intorno ai 38 grammi di sali per litro.",
  "Le concentrazioni variano molto da zona a zona e con la profondità.",
].join(" ");

describe("claim model", () => {
  it("keeps the exact span a verdict would attach to", () => {
    const claims = buildClaims({ response: RESPONSE });
    expect(claims).toHaveLength(4);
    expect(claims[0].exactSourceSpan).toBe("Il mare è salato perché l'acqua dissolve i sali minerali portati dai fiumi e dal suolo.");
    expect(claims.map((claim) => claim.id)).toEqual(["claim-1", "claim-2", "claim-3", "claim-4"]);
  });

  it("does not let a whole-response verdict leak into the sentences", () => {
    const claims = buildClaims({ response: RESPONSE });
    for (const claim of claims) {
      expect(claim.verificationStatus).toBe(CLAIM_REVIEW.NOT_ASSESSED);
      expect(claim.evidenceRefs).toEqual([]);
    }
  });

  it("records per-claim evidence when the verifier really supplied it", () => {
    const claims = buildClaims({
      response: RESPONSE,
      claimEvidence: [{ spanId: "claim-3", verificationStatus: "VERIFIED", evidenceRefs: ["europarl-2019"] }],
    });
    expect(claims[2].verificationStatus).toBe("VERIFIED");
    expect(claims[2].evidenceRefs).toEqual(["europarl-2019"]);
    expect(claims[0].reviewBasis).toBe(CLAIM_REVIEW.NOT_ASSESSED);
  });

  it("refuses to collapse a mixed answer into one colour", () => {
    const claims = buildClaims({
      response: RESPONSE,
      claimEvidence: [
        { spanId: "claim-1", verificationStatus: "VERIFIED", evidenceRefs: ["a"] },
        { spanId: "claim-2", verificationStatus: "VERIFIED", evidenceRefs: ["b"] },
        { spanId: "claim-3", verificationStatus: "VERIFIED", evidenceRefs: ["c"] },
        { spanId: "claim-4", verificationStatus: "FAILED", evidenceRefs: [] },
      ],
    });
    const profile = claimProfile(claims);
    expect(profile.isMixed).toBe(true);
    expect(profile.collapsesSafely).toBe(false);
    expect(profile.statuses).toEqual(["VERIFIED", "FAILED"]);
  });

  it("refuses to collapse an entirely unassessed answer into 'all fine'", () => {
    const profile = claimProfile(buildClaims({ response: RESPONSE }));
    expect(profile.collapsesSafely).toBe(false);
    expect(profile.unassessed).toBe(4);
  });
});

describe("AI → Human translator", () => {
  const base = { originalResponse: RESPONSE, intent: "spiegami perché il mare è salato" };

  it("builds a summary out of the original words, not new ones", () => {
    const { humanSummary } = humanizeForConsumer(base);
    const summaryWords = new Set(humanSummary.toLowerCase().split(/\W+/));
    const responseWords = new Set(RESPONSE.toLowerCase().split(/\W+/));
    for (const word of summaryWords) {
      if (word.length > 3) expect(responseWords.has(word)).toBe(true);
    }
  });

  it("never presents the reading as evidence", () => {
    const { isEvidence, humanizedResponse, originalResponse } = humanizeForConsumer(base);
    expect(isEvidence).toBe(false);
    expect(humanizedResponse).not.toBe(originalResponse);
  });

  it("promotes nothing to confirmed when the verifier only judged the whole response", () => {
    const { confirmed, cautions } = humanizeForConsumer({ ...base, verification: { trustStatus: "VERIFIED" } });
    expect(confirmed).toEqual([]);
    // the unassessed claims are surfaced as cautions instead of vanishing
    expect(cautions.length).toBeGreaterThan(0);
  });

  it("confirms only the claims with evidence attached", () => {
    const { confirmed, cautions } = humanizeForConsumer({
      ...base,
      verification: {
        trustStatus: "UNCERTAIN",
        claimEvidence: [
          { spanId: "claim-1", verificationStatus: "VERIFIED", evidenceRefs: ["noaa-salinity"] },
          { spanId: "claim-2", verificationStatus: "VERIFIED", evidenceRefs: [] },
        ],
      },
    });
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].evidenceRefs).toEqual(["noaa-salinity"]);
    expect(cautions.some((item) => item.claimId === "claim-2")).toBe(true);
  });

  it("refuses to show a correction as a fact when nothing backs it", () => {
    const { corrections, cautions } = humanizeForConsumer({
      ...base,
      verification: { corrections: [{ text: "In realtà il fenomeno si chiama salinizzazione marina" }] },
    });
    expect(corrections).toEqual([]);
    expect(cautions.some((item) => item.reason === "CORREZIONE_SENZA_EVIDENZA")).toBe(true);
  });

  it("shows a correction when the verifier cites the evidence behind it", () => {
    const { corrections } = humanizeForConsumer({
      ...base,
      verification: { corrections: [{ text: "La salinità media è 35 g/l", evidenceRef: "unesco-medsea" }] },
    });
    expect(corrections).toHaveLength(1);
    expect(corrections[0].source).toBe("unesco-medsea");
    expect(corrections[0].origin).toBe("VERIFIER");
  });

  it("shows only the sections that have something in them", () => {
    const clean = humanizeForConsumer({
      originalResponse: "Il mare è salato perché il sale viene dai fiumi.",
      intent: "perché il mare è salato",
    });
    const ids = clean.sections.map((section) => section.id);
    expect(ids).toContain(HUMAN_SECTION_IDS.SUMMARY);
    expect(ids).not.toContain(HUMAN_SECTION_IDS.CONFIRMED);
    expect(ids).not.toContain(HUMAN_SECTION_IDS.CORRECTIONS);
  });

  it("renders a compact card, not a report", () => {
    const { card } = humanizeForConsumer({
      ...base,
      verification: { claimEvidence: [{ spanId: "claim-1", verificationStatus: "VERIFIED", evidenceRefs: ["x"] }] },
      judge: { violatedConstraints: ["esempio senza pubblicità"], missingRequirements: ["un preventivo"], offTargetRequirements: [], irrelevantMaterial: [] },
    });
    // worst case: every section populated at once, and still a card
    expect(card.text.split("\n").length).toBeLessThanOrEqual(16);
    expect(card.text.startsWith("SAFI")).toBe(true);
    expect(card.text).toContain("Dettagli");
    // technical material stays out of the card
    expect(card.text).not.toMatch(/claim-|sha256|certificate|schema/);
  });

  it("stays short and honest when there is nothing wrong", () => {
    const { card, sections, cautions } = humanizeForConsumer({
      originalResponse: "Il mare è salato perché l'acqua dissolve i sali portati dai fiumi.",
      intent: "perché il mare è salato",
    });
    // title, In breve, the one honest caution, Dettagli
    expect(card.text.split("\n").length).toBeLessThanOrEqual(9);
    expect(sections.map((section) => section.id)).toEqual([HUMAN_SECTION_IDS.SUMMARY, HUMAN_SECTION_IDS.CAUTIONS]);
    expect(cautions).toHaveLength(1);
    expect(cautions[0].reason).toBe("NESSUNA_VERIFICA_PER_FRASE");
  });

  it("reads a real answer whose sentences run together without spaces", () => {
    // Seen in a live Gemini answer: "(l'atmosfera).Ecco come funziona" — a
    // missing space must not glue two sentences into one unreadable claim.
    const glued = "Il cielo è azzurro per via della luce (l'atmosfera).Ecco come funziona. Il blu viene deviato ovunque.";
    const { humanizedResponse } = humanizeForConsumer({ originalResponse: glued, intent: "perché il cielo è azzurro" });
    expect(humanizedResponse).not.toMatch(/\)\.[A-Z]/);
    const spans = buildClaims({ response: glued });
    expect(spans.some((claim) => claim.exactSourceSpan.startsWith("Ecco come funziona"))).toBe(true);
  });

  it("freezes what it returns", () => {
    const result = humanizeForConsumer(base);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sections)).toBe(true);
    expect(Object.isFrozen(result.card)).toBe(true);
  });
});
