/**
 * Safi Quality / Completeness Judge — the second brain, not the first.
 *
 * Truth is not this layer's business. Something can be entirely true and still
 * be the wrong answer: five ideas when three were asked for, two of them built
 * on the advertising the request excluded. The verifier answers "is this
 * true?"; this layer answers two different questions:
 *
 *   fulfillment   — did it do the thing that was asked?
 *   completeness  — is anything that mattered left out?
 *
 * Three rules are structural, not stylistic:
 *
 *   1. The reference is the *person's* intent, never an abstract ideal of a
 *      good answer. A perfect essay that ignores the request is MISALIGNED.
 *   2. The vocabulary is closed and disjoint from the trust vocabulary. No
 *      VERIFIED / UNCERTAIN / FAILED, no booleans, no confidence. A judge
 *      that says "true" has crossed into the verifier's job.
 *   3. A verdict never depends on whether the content is true. Only on what
 *      was asked for and what came back.
 */

export const FULFILLMENT = Object.freeze({
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
  MISALIGNED: "MISALIGNED",
});

export const COMPLETENESS = Object.freeze({
  COMPLETE: "COMPLETE",
  MISSING_NONCRITICAL: "MISSING_NONCRITICAL",
  MISSING_CRITICAL: "MISSING_CRITICAL",
});

/** The words this layer is allowed to use to describe its own work. */
export const JUDGE_VOCABULARY = Object.freeze({
  fulfillment: Object.freeze(Object.values(FULFILLMENT)),
  completeness: Object.freeze(Object.values(COMPLETENESS)),
});

/**
 * Words that belong to the evidence layer. Finding one of these as a *verdict*
 * of this layer is a defect. Finding one inside quoted material is not: an
 * answer about certificates says "certificate", and a person asking to avoid
 * "verified" says "verified" — the judge reports on their text, it does not
 * hand it out as its own vocabulary.
 */
const RESERVED_VERDICT_WORDS = /\b(verified|unverified|uncertain|failed)\b/i;

/** The only status words this layer is allowed to use about a requirement. */
const REQUIREMENT_STATUSES = Object.freeze(["MET", "THIN", "UNADDRESSED", "OFF_TARGET", "VIOLATED"]);

const STOPWORDS = new Set([
  "il", "lo", "la", "i", "gli", "le", "un", "una", "uno", "di", "a", "da", "in", "con", "su",
  "per", "e", "o", "che", "mi", "ti", "ci", "vi", "ne", "del", "della", "dei", "degli", "delle",
  "the", "a", "an", "of", "to", "and", "or", "in", "on", "for", "with", "is", "are", "be",
  "come", "sono", "puoi", "voglio", "vorrei", "dimmi", "fammi", "mi", "ti", "piacerebbe",
]);

const NUMBER_WORDS = Object.freeze({
  uno: 1, una: 1, un: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8,
  nove: 9, dieci: 10, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10,
});

const normalize = (text) => String(text ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function contentWords(text) {
  return normalize(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(" ")
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/** Sentences and list items, which is how answers are actually written. */
export function segmentsOf(text) {
  return String(text ?? "")
    .split(/\n+|(?<=[.!?])\s+(?=[A-ZÀ-Þ0-9])/)
    .map((part) => part.replace(/^[\s\-*•\d.)]+/, "").trim())
    .filter((part) => part.length > 0);
}

/**
 * Requirements as the *person* stated them. Each carries what was asked and
 * how to look for it in the answer — no model, no network, no provider.
 */
function requirementsFrom({ intent, blueprint }) {
  const text = normalize(`${intent} ${blueprint?.objective ?? ""} ${blueprint?.context ?? ""}`);
  const requirements = [];

  // A count: "tre idee", "5 suggerimenti", "due esempi".
  const counted = text.match(/\b(\d{1,2}|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|one|two|three|four|five|six|seven|eight|nine|ten)\s+([a-zà-ÿ]{3,24})/);
  if (counted) {
    const amount = Number(counted[1]) || NUMBER_WORDS[counted[1]] || 0;
    if (amount > 0) {
      requirements.push({ kind: "COUNT", label: `un numero preciso di elementi (${amount} × ${counted[2]})`, amount, subject: counted[2] });
    }
  }

  // A prohibition: "senza pubblicità", "no ads", "non voglio".
  const prohibition = text.match(/\b(?:senza|no|non|senza)\s+([a-zà-ÿ ]{4,40})/);
  if (prohibition) {
    const forbidden = prohibition[1].split(/\b(?:e|ed|o|con|per|di|che|a|al|alla)\b/)[0].trim();
    if (forbidden.length > 2) {
      requirements.push({ kind: "PROHIBITION", label: `evitare: ${forbidden}`, terms: contentWords(forbidden) });
    }
  }

  // A must: "deve", "deve essere", "con almeno", "in modo che".
  const musts = [...text.matchAll(/\b(?:deve|devono|devi|con almeno|con non pi[uù]|preferibilmente|per favore)\s+([a-zà-ÿ ]{4,44})/g)];
  for (const match of musts.slice(0, 4)) {
    const need = match[1].split(/\b(?:e|ed|o|che|perché)\b/)[0].trim();
    if (need.length > 2) requirements.push({ kind: "MUST", label: `richiesto esplicitamente: ${need}`, terms: contentWords(need) });
  }

  // A format: "in punti", "in tabella", "un'email", "in paragrafi".
  if (/\b(in punti|elenco|bullet|liste|tabella|schema|passaggi|sezioni)\b/.test(text)) {
    requirements.push({ kind: "FORMAT", label: "un formato specifico", terms: ["punti", "elenco", "tabella", "schema", "sezioni", "passaggi"] });
  }

  // An enumeration: "che cosa devo considerare", "quali sono", "elenca".
  // The person asked for *things*, so an answer that gives one is incomplete
  // however true it is — this is the person's own requirement, not an ideal.
  if (/\b(che cosa|che cose|cosa devo|cosa considerare|quali|elenca|elenchami|passi|idee|motivi|opzioni|consigli|requisiti)\b/.test(text)) {
    const declared = requirements.find((entry) => entry.kind === "COUNT");
    requirements.push({
      kind: "ENUMERATION",
      label: declared ? `almeno ${declared.amount} elementi` : "un elenco di almeno 2 punti",
      minItems: declared ? declared.amount : 2,
    });
  }

  // The objective itself, when the intent is a build or a decision.
  if (blueprint?.shape === "BUILD" || blueprint?.shape === "DECIDE") {
    const objectiveTerms = contentWords(`${intent} ${blueprint.objective}`);
    if (objectiveTerms.length) requirements.push({ kind: "OBJECTIVE", label: "l'obiettivo richiesto", terms: objectiveTerms });
  }
  return requirements;
}

function countItemsIn(response) {
  // Counted on the raw lines: the list marker is the evidence, so it must be
  // read before anything strips it away.
  const lines = String(response ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const ordered = lines.filter((line) => /^\d+[.)]\s+/.test(line));
  if (ordered.length > 0) return ordered.length;
  const bulleted = lines.filter((line) => /^[-*•]\s+/.test(line));
  if (bulleted.length > 0) return bulleted.length;
  const inline = normalize(response).match(/\b(\d{1,2})\s+(?:idee|suggerimenti|opzioni|esempi|modi|proposte|punti|consigli|motivi|regole|passi)\b/);
  if (inline) return Number(inline[1]);
  return null;
}

/**
 * How many of these terms the text actually contains.
 *
 * Matching is on whole words, with a stem allowance for long terms: a plain
 * substring test makes "sto" match inside "storico" and "locale" inside
 * "località", which silently turns an irrelevant paragraph into a relevant
 * one. A term of four letters or more may match a longer word that starts with
 * it, so "increment" still finds "incrementi".
 */
function mentionsAny(text, terms) {
  if (!terms?.length) return 0;
  const tokens = new Set(normalize(text).replace(/[^\p{L}\p{N}\s]/gu, " ").split(" ").filter(Boolean));
  return terms.filter((term) => {
    if (tokens.has(term)) return true;
    return term.length >= 5 && [...tokens].some((token) => token.startsWith(term));
  }).length;
}

function judgeRequirement(requirement, response) {
  if (requirement.kind === "COUNT") {
    const found = countItemsIn(response);
    if (found === null) return { requirement, status: "UNADDRESSED" };
    return { requirement, status: found === requirement.amount ? "MET" : "OFF_TARGET", detail: `richiesti ${requirement.amount}, trovati ${found}` };
  }
  if (requirement.kind === "PROHIBITION") {
    // The prohibition is respected unless the answer visibly does the thing.
    const leaks = mentionsAny(response, requirement.terms);
    return { requirement, status: leaks > 0 ? "VIOLATED" : "MET", detail: leaks > 0 ? `l'answer contiene: ${requirement.terms.join(", ")}` : undefined };
  }
  if (requirement.kind === "ENUMERATION") {
    const items = countItemsIn(response) ?? segmentsOf(response).length;
    return items >= requirement.minItems
      ? { requirement, status: "MET" }
      : { requirement, status: "UNADDRESSED", detail: `chiesti almeno ${requirement.minItems}, trovati ${items}` };
  }
  if (requirement.kind === "FORMAT") {
    return mentionsAny(response, requirement.terms) > 0 ? { requirement, status: "MET" } : { requirement, status: "UNADDRESSED" };
  }
  // MUST and OBJECTIVE are matched on content words: partial credit is real
  // credit, and the words that are missing are what the person will notice.
  const hits = mentionsAny(response, requirement.terms);
  const ratio = requirement.terms.length ? hits / requirement.terms.length : 0;
  if (hits === 0) return { requirement, status: "UNADDRESSED" };
  return { requirement, status: ratio >= 0.5 ? "MET" : "THIN", detail: `coperto parzialmente (${hits}/${requirement.terms.length})` };
}

/**
 * Material the person did not ask for.
 *
 * "Not the person's words" is not the test: a good answer about why the sky is
 * blue never repeats "sky" in every sentence. The test is whether a passage
 * shares anything with the *rest of the answer* — a digression stands alone,
 * while a relevant detail sits inside the same vocabulary as everything else.
 */
function irrelevantMaterialOf({ response, intentTerms }) {
  const segments = segmentsOf(response);
  // A digression is only judgeable in an answer long enough to contain one.
  // In a three-sentence reply every sentence *is* the answer, and flagging one
  // of them would be inventing a complaint nobody made.
  if (segments.length < 5) return [];
  const stray = [];
  for (const [index, segment] of segments.entries()) {
    if (segment.length < 80) continue;
    // The comparison is with the *rest* of the answer: a passage always
    // shares vocabulary with itself, which would make the test meaningless.
    const elsewhere = segments.filter((_, other) => other !== index).join(" ");
    const onTopic = intentTerms.length > 0 && mentionsAny(segment, intentTerms) > 0;
    const sharesTheAnswer = mentionsAny(segment, contentWords(elsewhere)) >= 1;
    if (!onTopic && !sharesTheAnswer) {
      stray.push(segment.slice(0, 120));
      if (stray.length >= 2) break;
    }
  }
  return stray;
}

/**
 * Judge one answer against one intent.
 *
 * @param {object} input
 * @param {string} input.intent the person's original words
 * @param {object} [input.blueprint] the PromptBlueprint the prompt was built from
 * @param {string} input.response the exact response, read by somebody else
 * @returns {object} a provider-neutral judgment in a closed vocabulary
 */
export function judgeAnswer({ intent, blueprint, response } = {}) {
  const text = String(response ?? "");
  const requirements = requirementsFrom({ intent, blueprint });
  const judged = requirements.map((requirement) => judgeRequirement(requirement, text));

  const violations = judged.filter((entry) => entry.status === "VIOLATED");
  const offTarget = judged.filter((entry) => entry.status === "OFF_TARGET" || entry.status === "THIN");
  const unaddressed = judged.filter((entry) => entry.status === "UNADDRESSED");
  const met = judged.filter((entry) => entry.status === "MET");

  const intentTerms = contentWords(`${intent} ${blueprint?.objective ?? ""}`);
  // MISALIGNED is reserved for what can actually be shown: an answer that is
  // not an answer, or a request whose every stated requirement went
  // untouched. Topical drift is reported as unassessed, never as a verdict.
  const notAnAnswer = text.trim().length === 0 || text.trim().length < 25 || NON_ANSWER.test(text);
  // A partially answered question is still this person's question. Only when
  // every *substantive* requirement went untouched — never merely because an
  // enumeration came back short — is the answer off the mark.
  const substantiveUntouched = requirements.some((entry) => entry.kind !== "ENUMERATION")
    && met.length === 0 && violations.length === 0
    && requirements.filter((entry) => entry.kind !== "ENUMERATION").every((entry) => unaddressed.some((item) => item.requirement === entry));
  const answeredSomethingElse = notAnAnswer || substantiveUntouched;

  let fulfillment = FULFILLMENT.COMPLETE;
  if (answeredSomethingElse) {
    fulfillment = FULFILLMENT.MISALIGNED;
  } else if (violations.length > 0 || offTarget.length > 0 || unaddressed.length > 0) {
    fulfillment = FULFILLMENT.PARTIAL;
  }

  // Completeness asks about the *ask*, not about the world: a missing piece
  // of what was requested. Critical means the answer cannot do its job
  // without it.
  let completeness = COMPLETENESS.COMPLETE;
  if (fulfillment === FULFILLMENT.MISALIGNED) {
    completeness = COMPLETENESS.MISSING_CRITICAL;
  } else if (unaddressed.some((entry) => entry.requirement.kind === "OBJECTIVE" || entry.requirement.kind === "MUST")) {
    completeness = COMPLETENESS.MISSING_CRITICAL;
  } else if (unaddressed.length > 0 || offTarget.length > 0) {
    completeness = COMPLETENESS.MISSING_NONCRITICAL;
  }

  const judgment = {
    fulfillment,
    completeness,
    // How much of this judgment rests on structure rather than on words. A
    // caller that needs to explain itself can see where the limit is.
    fulfilledRequirements: met.map((entry) => entry.requirement.label),
    missingRequirements: unaddressed.map((entry) => entry.requirement.label),
    violatedConstraints: violations.map((entry) => entry.requirement.label),
    // Delivering five when three were asked for is neither "missing" nor
    // "broken": it is off target, and the person is entitled to be told.
    offTargetRequirements: offTarget.map((entry) => Object.freeze({ label: entry.requirement.label, detail: entry.detail ?? "presente solo in parte" })),
    irrelevantMaterial: irrelevantMaterialOf({ response: text, intentTerms }),
    // What the verdict above actually rests on, stated rather than implied.
    alignmentBasis: requirements.length > 0 ? JUDGE_ALIGNMENT_BASIS.REQUIREMENTS : JUDGE_ALIGNMENT_BASIS.NOT_ASSESSED,
  };

  // A structural guarantee, not a style note: the words this layer speaks
  // about its own work are its own. Quoted material is exempt on purpose.
  const spoken = [judgment.fulfillment, judgment.completeness, ...judged.map((entry) => entry.status), ...judged.map((entry) => entry.requirement.kind)];
  if (spoken.some((word) => RESERVED_VERDICT_WORDS.test(String(word)) || !REQUIREMENT_STATUSES.includes(String(word)) && !JUDGE_VOCABULARY.fulfillment.includes(String(word)) && !JUDGE_VOCABULARY.completeness.includes(String(word)) && !/^[A-Z_]+$/.test(String(word)))) {
    throw new Error("the quality judge produced trust vocabulary");
  }
  return Object.freeze({
    ...judgment,
    fulfilledRequirements: Object.freeze(judgment.fulfilledRequirements),
    missingRequirements: Object.freeze(judgment.missingRequirements),
    violatedConstraints: Object.freeze(judgment.violatedConstraints),
    offTargetRequirements: Object.freeze(judgment.offTargetRequirements),
    irrelevantMaterial: Object.freeze(judgment.irrelevantMaterial),
    details: Object.freeze(judged.map((entry) => Object.freeze({ label: entry.requirement.label, kind: entry.requirement.kind, status: entry.status, detail: entry.detail }))),
  });
}

/**
 * A documented limit, not a hidden one.
 *
 * Whether an answer is *about* the right subject cannot be settled by matching
 * words: a perfect answer about opening a restaurant never repeats the word
 * "restaurant", and a fluent answer about HTTPS shares nothing with a question
 * about photovoltaics — yet those two are not equally on topic. So this layer
 * does not guess. When the request yields requirements, those decide the
 * verdict; when it does not, the verdict rests on what is checkable and
 * `alignmentBasis` says out loud that topical alignment was not assessed. The
 * consumer never sees a "misaligned" verdict the layer cannot support, and the
 * original response is never hidden whatever the verdict is.
 */
export const JUDGE_ALIGNMENT_BASIS = Object.freeze({
  REQUIREMENTS: "REQUIREMENTS",
  NOT_ASSESSED: "NOT_ASSESSED",
});

/** Phrases that mean "I am not answering this". */
const NON_ANSWER = /\b(non posso|non sono in grado|mi dispiace|non ho informazioni|non è possibile rispondere|as an ai)\b/i;

export const QUALITY_JUDGE_STATUS = "PHASE 9 QUALITY / COMPLETENESS JUDGE — AWAITING HUMAN ACCEPTANCE";
