/**
 * Safi AI → Human translator.
 *
 * This is the other half of the original idea: take a real answer and hand a
 * person something they can actually use, without ever changing what the
 * provider said.
 *
 * Four rules, all structural:
 *
 *   1. **No new facts.** Every line the consumer sees is traceable to an exact
 *      span of the original response. The summary is *extractive*: sentences
 *      chosen and shortened, never invented. Nothing that cannot be traced is
 *      dropped, not kept "because it sounds right".
 *   2. **Original ≠ humanized.** Both are carried with their own hashes, and
 *      the humanized text is explicitly not evidence.
 *   3. **A simplification does not inherit trust.** Only a claim the verifier
 *      assessed on its own can appear under "Confermato". A response verified
 *      as a whole does not promote its sentences.
 *   4. **A correction must be sourced.** Safi may propose a correction only
 *      with a reference to real evidence; without one it becomes a caution, not
 *      a fact.
 *
 * Sections are emitted only when they have something in them: a good, simple
 * answer can legitimately be two lines.
 */

import { CLAIM_REVIEW, buildClaims, claimProfile } from "../claims/index.js";

/** The consumer vocabulary. Short, fixed, and identical in every host. */
export const HUMAN_SECTION_IDS = Object.freeze({
  SUMMARY: "summary",
  CONFIRMED: "confirmed",
  CAUTIONS: "cautions",
  MISSING: "missing",
  CORRECTIONS: "corrections",
});

const MAX_SUMMARY_SENTENCES = 2;
const MAX_SUMMARY_CHARS = 320;
const MAX_ITEMS = 6;

const normalize = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

/**
 * The polarity of a verdict, read from the verifier's own word.
 *
 * This is the one place the consumer layer looks at trust vocabulary, and it
 * only ever *reads* it: a contradicted sentence with perfect evidence must not
 * be able to reach "Confermato" because it happened to arrive with a citation
 * attached. Anything this function does not recognise is treated as uncertain,
 * which is the safe direction to be wrong in.
 */
function polarityOf(status) {
  const word = String(status ?? "").toUpperCase();
  if (/VERIFIED|CONFIRMED|SUPPORTED|CONFIRMED_BY/.test(word)) return "SUPPORTED";
  if (/FAILED|CONTRADICTED|REFUTED|RETRACTED|WRONG/.test(word)) return "CONTRADICTED";
  return "UNCERTAIN";
}

/**
 * Shorten a sentence without adding meaning: strip list furniture, collapse
 * whitespace, cut at a clause boundary if it runs long. What is removed is
 * formatting, never content.
 */
function tighten(text, limit = 240) {
  const clean = normalize(String(text ?? "").replace(/^[\s>*•]+/, "").replace(/^\d+[.)]\s*/, ""));
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(", "), cut.lastIndexOf("; "));
  return `${(lastStop > limit * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim()}…`;
}

/**
 * Pick the sentences that carry the person's own subject. Ranking is by shared
 * content words with the intent, with the opening sentence as the tiebreak —
 * an answer's own structure is information too.
 */
function pickSummarySpans(claims, intent) {
  const intentWords = new Set(
    normalize(intent)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(" ")
      .filter((word) => word.length > 3),
  );
  const scored = claims.map((claim) => {
    const words = normalize(claim.exactSourceSpan).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(" ");
    const shared = words.filter((word) => intentWords.has(word)).length;
    return { claim, score: shared, order: claims.indexOf(claim) };
  });
  const best = [...scored].sort((a, b) => b.score - a.score || a.order - b.order);
  const chosen = best.filter((entry) => entry.score > 0).slice(0, MAX_SUMMARY_SENTENCES);
  const pool = chosen.length > 0 ? chosen : best.slice(0, 1);
  return pool.sort((a, b) => a.order - b.order).map((entry) => entry.claim);
}

/**
 * Build the compact Safi projection for a person.
 *
 * @param {object} input
 * @param {string} input.originalResponse the exact provider text, unedited
 * @param {string} input.intent the person's original words
 * @param {object} [input.verification] the verifier's result for that text
 * @param {object} [input.judge] the Layer B judgment
 * @param {object[]} [input.claims] pre-built claims, if the caller has them
 * @param {object} [input.hashes] `{ originalResponseHash, safiHumanizedResponseHash }`
 */
export function humanizeForConsumer({ originalResponse, intent, verification, judge, claims, hashes } = {}) {
  const text = String(originalResponse ?? "");
  const list = Array.isArray(claims) && claims.length > 0 ? claims : buildClaims({ response: text, claimEvidence: verification?.claimEvidence });
  const profile = claimProfile(list);

  // ── In breve: extractive, and every sentence traceable ────────────────────
  const summaryClaims = pickSummarySpans(list, intent);
  const summaryParts = summaryClaims.map((claim) => tighten(claim.exactSourceSpan, 180));
  let humanSummary = summaryParts.join(" ");
  if (humanSummary.length > MAX_SUMMARY_CHARS) {
    humanSummary = `${tighten(humanSummary, MAX_SUMMARY_CHARS)}`;
  }

  // ── Confermato: only claims the verifier both upheld *and* evidenced ─────
  const confirmed = list
    .filter((claim) => claim.reviewBasis === CLAIM_REVIEW.ASSESSED && claim.evidenceRefs.length > 0 && polarityOf(claim.verificationStatus) === "SUPPORTED")
    .slice(0, MAX_ITEMS)
    .map((claim) => ({ text: tighten(claim.exactSourceSpan), claimId: claim.id, evidenceRefs: [...claim.evidenceRefs] }));

  // ── Da controllare: what the judge and the evidence leave open ─────────────
  const cautions = [];
  for (const claim of list) {
    if (claim.reviewBasis !== CLAIM_REVIEW.ASSESSED) continue;
    const polarity = polarityOf(claim.verificationStatus);
    if (polarity === "SUPPORTED" && claim.evidenceRefs.length === 0) {
      cautions.push({ text: tighten(claim.exactSourceSpan), reason: "NESSUNA_EVIDENZA_COLLEGATA", claimId: claim.id });
    } else if (polarity === "CONTRADICTED") {
      // Evidence exists and it points the other way. This is the one line a
      // person must never miss, so it keeps its own reason and its own span.
      cautions.push({
        text: tighten(claim.exactSourceSpan),
        reason: "CONTRADITTA_DALL_EVIDENZA",
        claimId: claim.id,
        evidenceRefs: [...claim.evidenceRefs],
      });
    } else if (polarity === "UNCERTAIN") {
      cautions.push({ text: tighten(claim.exactSourceSpan), reason: "INCERTA", claimId: claim.id, evidenceRefs: [...claim.evidenceRefs] });
    }
  }
  if (profile.total > 0 && profile.assessed === 0) {
    // Nobody looked at these sentences one by one. Saying so once is honest;
    // staying silent would let a whole-response verdict pass as a sentence-level
    // guarantee.
    cautions.unshift({ text: "Le singole frasi non sono state verificate una per una", reason: "NESSUNA_VERIFICA_PER_FRASE" });
  }
  for (const label of judge?.violatedConstraints ?? []) {
    cautions.push({ text: `La risposta non rispetta: ${label}`, reason: "VINCOLO_NON_RISPETTATO" });
  }
  for (const item of judge?.offTargetRequirements ?? []) {
    cautions.push({ text: `${item.label} — ${item.detail}`, reason: "FUORI_TARGET" });
  }
  for (const segment of judge?.irrelevantMaterial ?? []) {
    cautions.push({ text: `Parte non necessaria: ${tighten(segment, 140)}`, reason: "MATERIALE_IRRLEVANTE" });
  }

  // ── Manca: what the request asked for and did not get ─────────────────────
  const missing = [];
  for (const label of judge?.missingRequirements ?? []) {
    missing.push({ text: `Non è stato affrontato: ${label}`, severity: judge?.completeness === "MISSING_CRITICAL" ? "CRITICAL" : "NON_CRITICAL" });
  }

  // ── Correzione: only with a real source behind it ─────────────────────────
  const corrections = [];
  for (const correction of verification?.corrections ?? []) {
    const source = correction?.evidenceRef ?? correction?.evidenceRefs?.[0];
    if (typeof source !== "string" || source.length === 0) {
      // No evidence behind it: it may not be presented as a fact.
      cautions.push({ text: `Da controllare: ${tighten(correction?.text ?? "", 160)}`, reason: "CORREZIONE_SENZA_EVIDENZA" });
      continue;
    }
    corrections.push({ text: tighten(correction.text), source, origin: "VERIFIER" });
  }

  const sections = [];
  if (humanSummary) sections.push({ id: HUMAN_SECTION_IDS.SUMMARY, title: "In breve", items: [{ text: humanSummary }] });
  if (confirmed.length) sections.push({ id: HUMAN_SECTION_IDS.CONFIRMED, title: "Confermato", items: confirmed });
  if (cautions.length) sections.push({ id: HUMAN_SECTION_IDS.CAUTIONS, title: "Da controllare", items: cautions.slice(0, MAX_ITEMS) });
  if (missing.length) sections.push({ id: HUMAN_SECTION_IDS.MISSING, title: "Manca", items: missing.slice(0, MAX_ITEMS) });
  if (corrections.length) sections.push({ id: HUMAN_SECTION_IDS.CORRECTIONS, title: "Correzione", items: corrections });

  // ── The compact card the consumer actually sees ───────────────────────────
  // Blank lines separate the sections; nothing else earns vertical space, and
  // a section is only here at all if it has something in it.
  const blocks = [];
  if (humanSummary) blocks.push(["In breve", humanSummary]);
  if (confirmed.length) blocks.push(["Confermato", ...confirmed.map((item) => `✓ ${item.text}`)]);
  if (cautions.length) blocks.push(["Da controllare", ...cautions.slice(0, MAX_ITEMS).map((item) => `? ${item.text}`)]);
  if (missing.length) blocks.push(["Manca", ...missing.slice(0, MAX_ITEMS).map((item) => `· ${item.text}`)]);
  if (corrections.length) blocks.push(["Correzione", ...corrections.map((item) => `→ ${item.text}`)]);
  const humanizedText = ["SAFI", ...blocks.map((block) => block.join("\n")), "Dettagli"].join("\n\n");



  return Object.freeze({
    // The card is a *reading* of the response, never evidence for it.
    isEvidence: false,
    humanSummary,
    confirmed: Object.freeze(confirmed),
    cautions: Object.freeze(cautions),
    missing: Object.freeze(missing),
    corrections: Object.freeze(corrections),
    sections: Object.freeze(sections.map((section) => Object.freeze({ ...section, items: Object.freeze(section.items) }))),
    card: Object.freeze({ title: "SAFI", text: humanizedText, hasDetails: true }),
    claimProfile: profile,
    originalResponse: text,
    humanizedResponse: humanizedText,
    ...(hashes ?? {}),
  });
}

export const HUMANIZER_STATUS = "PHASE 9 AI → HUMAN TRANSLATOR — AWAITING HUMAN ACCEPTANCE";
