/**
 * Safi claim model.
 *
 * A response is rarely one thing. Four sentences can be right and the fifth
 * wrong, and a consumer card that paints the whole answer a single colour is
 * lying by simplification. This module splits the *exact* response into spans
 * a verdict can be attached to, one at a time.
 *
 * The honest case matters as much as the mixed one: when the verifier worked on
 * the response as a whole and produced no per-claim evidence, these claims say
 * exactly that — `NOT_ASSESSED_AT_CLAIM_LEVEL` — instead of inheriting the
 * global verdict. A simplified sentence must never look verified because the
 * response around it was.
 *
 * The model reads the response and, optionally, whatever per-claim evidence
 * the verifier supplies. It never verifies anything itself.
 */

/** How a span should be read, independent of whether it is true. */
export const CLAIM_TYPES = Object.freeze({
  DEFINITION: "DEFINITION",
  FACT: "FACT",
  PROCEDURE: "PROCEDURE",
  RECOMMENDATION: "RECOMMENDATION",
  OPINION: "OPINION",
});

/**
 * Where a claim's verification status came from. These are *provenance* words,
 * not verdicts: the module never decides that something is right.
 */
export const CLAIM_REVIEW = Object.freeze({
  ASSESSED: "ASSESSED_AT_CLAIM_LEVEL",
  NOT_ASSESSED: "NOT_ASSESSED_AT_CLAIM_LEVEL",
});

const DEFINITION_CUES = /\b(è|sono|consiste in|significa|definizione|chiamato|noto come|si definisce)\b/i;
const PROCEDURE_CUES = /\b(poi|quindi|infine|devi|puoi|procedi|passo|step|apri|clicca|installa|configura|prima|successivamente)\b/i;
const RECOMMENDATION_CUES = /\b(consiglio|ti consiglio|consigliamo|è meglio|ti suggerisco|dovresti|conviene|ideale|optimo)\b/i;
const OPINION_CUES = /\b(penso|credo|secondo me|a mio avviso|personalmente|mi sembra)\b/i;

/** Sentences and list items, with the exact text the provider wrote. */
export function claimSpans(response) {
  return String(response ?? "")
    // A sentence may end with no following space ("…atmosfera).Ecco"), and a
    // capital alone is not a sentence boundary ("U.S.A.", "3.5"): the next word
    // has to look like a word.
    .split(/\n+|(?<=[.!?])["')\]]?\s*(?=[A-ZÀ-Þ][a-zà-ÿ])|(?<=[.!?])\s+(?=[A-ZÀ-Þ0-9])/)
    .map((part) => part.replace(/^[\s>*•]+/, "").replace(/\s+$/, ""))
    .filter((part) => part.trim().length > 0)
    // The claim id is the locator evidence is attached to, so it is built here
    // and never renumbered downstream.
    .map((part, index) => ({ claimId: `claim-${index + 1}`, text: part.trim(), index }));
}

function typeOf(text) {
  if (OPINION_CUES.test(text)) return CLAIM_TYPES.OPINION;
  if (RECOMMENDATION_CUES.test(text)) return CLAIM_TYPES.RECOMMENDATION;
  if (PROCEDURE_CUES.test(text)) return CLAIM_TYPES.PROCEDURE;
  if (DEFINITION_CUES.test(text)) return CLAIM_TYPES.DEFINITION;
  return CLAIM_TYPES.FACT;
}

/**
 * Per-claim evidence arrives from the verifier in whatever shape it has. Only
 * two things are accepted: a list of `{ spanId | text, verificationStatus,
 * evidenceRefs }`, or a map keyed the same way. Anything else is ignored rather
 * than guessed at.
 */
function indexSuppliedEvidence(supplied) {
  const index = new Map();
  const entries = Array.isArray(supplied)
    ? supplied
    : supplied && typeof supplied === "object"
      ? Object.entries(supplied).map(([key, value]) => ({ spanId: key, ...(typeof value === "object" && value ? value : { verificationStatus: value }) }))
      : [];
  for (const entry of entries) {
    if (!entry) continue;
    const key = entry.spanId ?? entry.id ?? entry.text;
    if (typeof key !== "string" || key.length === 0) continue;
    if (typeof entry.verificationStatus !== "string" || entry.verificationStatus.length === 0) continue;
    index.set(key.trim().toLowerCase(), entry);
  }
  return index;
}

/**
 * Build the claims for one exact response.
 *
 * @param {object} input
 * @param {string} input.response the exact text, unedited
 * @param {object} [input.claimEvidence] per-claim evidence from the verifier
 * @returns {object[]} claims, each traceable to an exact source span
 */
export function buildClaims({ response, claimEvidence } = {}) {
  const evidence = indexSuppliedEvidence(claimEvidence);
  const claims = claimSpans(response).map((span) => {
    const supplied = evidence.get(span.claimId.toLowerCase()) ?? evidence.get(span.text.toLowerCase());
    if (supplied) {
      return Object.freeze({
        id: span.claimId,
        exactSourceSpan: span.text,
        type: typeOf(span.text),
        verificationStatus: supplied.verificationStatus,
        reviewBasis: CLAIM_REVIEW.ASSESSED,
        evidenceRefs: Object.freeze([...(supplied.evidenceRefs ?? [])].map(String)),
        confidence: supplied.confidence ?? null,
      });
    }
    return Object.freeze({
      id: span.claimId,
      exactSourceSpan: span.text,
      type: typeOf(span.text),
      // The truth is deliberately absent: nobody looked at this sentence on
      // its own, and a card must not pretend otherwise.
      verificationStatus: CLAIM_REVIEW.NOT_ASSESSED,
      reviewBasis: CLAIM_REVIEW.NOT_ASSESSED,
      evidenceRefs: Object.freeze([]),
      confidence: null,
    });
  });
  return Object.freeze(claims);
}

/**
 * A response is "mixed" when its claims do not all carry the same status. The
 * consumer card needs to know, because that is the case a single global colour
 * would flatten.
 */
export function claimProfile(claims) {
  const list = Array.isArray(claims) ? claims : [];
  const assessed = list.filter((claim) => claim.reviewBasis === CLAIM_REVIEW.ASSESSED);
  const statuses = new Set(list.map((claim) => claim.verificationStatus));
  return Object.freeze({
    total: list.length,
    assessed: assessed.length,
    unassessed: list.length - assessed.length,
    isMixed: statuses.size > 1,
    statuses: Object.freeze([...statuses]),
    /**
     * Whether one colour would be a lie. With no claim-level evidence at all
     * the answer is not "uniformly fine", it is simply not known claim by
     * claim — and the card has to say which of the two it is.
     */
    collapsesSafely: statuses.size === 1 && assessed.length === list.length && list.length > 0,
  });
}

export const CLAIM_MODEL_STATUS = "PHASE 9 CLAIM MODEL — AWAITING HUMAN ACCEPTANCE";
