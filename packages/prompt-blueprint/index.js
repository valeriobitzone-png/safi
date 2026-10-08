/**
 * Safi Prompt Blueprint — the Universal Prompt Composer.
 *
 * The composer is a *model* of an ideal request, not a template. It answers
 * three questions and nothing else:
 *
 *   1. what is being asked            → objective
 *   2. what the answer has to respect → constraints, audience, outputFormat…
 *   3. what is genuinely missing      → missingEssentialInformation
 *
 * The rule the whole layer is built around: **the complexity of the prompt
 * follows the complexity of the intent**. "Write an email to my accountant
 * saying I pay on Friday" is a complete request and must come out as two plain
 * sentences. A request for a piece of software is not, and earns objective,
 * context, constraints, output structure and success criteria. Anything in
 * between gets the middle. Nothing gets a mega-prompt by default.
 *
 * This module is provider-neutral by construction: it never mentions a site, a
 * DOM node, a permission or a trust word, and it never decides whether
 * anything is true.
 */

/** How much structure the rendered request is allowed to carry. */
export const PROMPT_COMPLEXITY = Object.freeze({
  SIMPLE: "SIMPLE",
  STANDARD: "STANDARD",
  COMPLEX: "COMPLEX",
});

/**
 * Missing information is split before it is ever used. Only an
 * ESSENTIAL_MISSING entry may stop and ask; everything else is recorded and
 * carried, never interrogated. A person who already said what they want must
 * not be asked what they want.
 */
export const MISSING_INFORMATION = Object.freeze({
  ESSENTIAL: "ESSENTIAL_MISSING",
  OPTIONAL: "USEFUL_BUT_OPTIONAL",
});

/** The request shapes the composer can recognise without asking anyone. */
const SHAPES = Object.freeze({
  EMAIL: "EMAIL",
  EXPLAIN: "EXPLAIN",
  SUMMARIZE: "SUMMARIZE",
  BUILD: "BUILD",
  DECIDE: "DECIDE",
  GENERAL: "GENERAL",
});

const SOFTWARE_WORDS = [
  "app", "applicazione", "software", "sito", "web", "piattaforma", "dashboard",
  "interfaccia", "api", "database", "script", "programma", "gioco", "plugin",
  "funzionalità", "sistema", "strumento", "landing", "e-commerce", "app mobile",
];

const EMAIL_WORDS = ["mail", "email", "e-mail", "messaggio", "commercialista", "lettera", "rispondere a", "contattare"];
const EXPLAIN_WORDS = ["spieg", "insegn", "impara", "cosa sono", "cosa significa", "in parole semplici", "come funziona"];
const SUMMARIZE_WORDS = ["riassunt", "sintetizz", "riassumi", "sintesi", "semplific"];
const DECISION_WORDS = ["conviene", "scegliere", "meglio", "confronto", "pro e contro", "quale mi consigli"];

const words = (text) => String(text ?? "").toLowerCase();
const includesAny = (text, list) => list.some((word) => text.includes(word));

function shapeOf(text) {
  // A build request wins over an email request: "una web app con login via
  // email" is a piece of software, not a letter, and the more complex shape
  // is the honest one.
  if (includesAny(text, SOFTWARE_WORDS)) return SHAPES.BUILD;
  if (includesAny(text, EMAIL_WORDS)) return SHAPES.EMAIL;
  if (includesAny(text, SUMMARIZE_WORDS)) return SHAPES.SUMMARIZE;
  if (includesAny(text, EXPLAIN_WORDS)) return SHAPES.EXPLAIN;
  if (includesAny(text, DECISION_WORDS)) return SHAPES.DECIDE;
  return SHAPES.GENERAL;
}

/** Roles are the audience when the person names one, determiner and all. */
const ROLES = "commercialista|cliente|datore|boss|capo|collega|professore|medico|avvocato|socio|fornitore|banca|insegnante|studente|consulente";

/**
 * Complexity is a property of the request, not of its length. Three signals
 * decide it: how much the person already specified, how many distinct
 * requirements they stated, and how much freedom the answer needs.
 */
function complexityOf({ text, shape, sentenceCount, explicitRequirements, enumeratedParts }) {
  if (shape === SHAPES.EMAIL || shape === SHAPES.EXPLAIN || shape === SHAPES.SUMMARIZE) {
    // These are well-understood everyday requests: one clear ask, one clear
    // answer. Structure would be noise.
    return sentenceCount <= 1 && explicitRequirements <= 1 ? PROMPT_COMPLEXITY.SIMPLE : PROMPT_COMPLEXITY.STANDARD;
  }
  if (shape === SHAPES.BUILD || shape === SHAPES.DECIDE) return PROMPT_COMPLEXITY.COMPLEX;
  // A single sentence that enumerates four things is not a simple request.
  if (sentenceCount >= 3 || explicitRequirements >= 3 || enumeratedParts >= 3) return PROMPT_COMPLEXITY.STANDARD;
  return PROMPT_COMPLEXITY.SIMPLE;
}

function countRequirements(text) {
  const markers = text.match(/\b(deve|devono|devi|vuoi|requisit|vincol|obblig|non deve|senza|preferibil|con almeno|con non più|format|struttur|passaggi|sezion|tabell|elenco|bullet)\w*/g);
  return markers ? markers.length : 0;
}

function sentencesOf(text) {
  return String(text ?? "").split(/[.!?\n]+/).map((part) => part.trim()).filter(Boolean);
}

/** How many things the person listed in one breath: "a, b, c e d". */
function enumeratedParts(text) {
  const parts = String(text ?? "")
    .split(/,| e | ed | oltre a | insieme a /i)
    .map((part) => part.trim())
    .filter(Boolean);
  return Math.max(0, parts.length - 1);
}

/** The objective, in the person's own register — never inflated. */
function objectiveFor({ original, shape, semantic }) {
  const declared = String(semantic?.goal ?? "").trim();
  const task = String(semantic?.task ?? "").trim();
  if (shape === SHAPES.EMAIL) return declared || "scrivere il messaggio richiesto";
  if (shape === SHAPES.EXPLAIN) return declared || "spiegare in modo comprensibile";
  if (shape === SHAPES.SUMMARIZE) return declared || "rielaborare il materiale in una sintesi fedele";
  if (declared && !/answer the person's request|realizzare la richiesta descritta sopra/i.test(declared)) return declared;
  if (task && task.length > 3) return task;
  return declared || original;
}

/**
 * The original message is an input, not decoration: a complex request is
 * built around it and the answer must keep the human's own words.
 */
function inputsFor({ original, shape }) {
  if (shape === SHAPES.SUMMARIZE) return [original];
  return [original];
}

function audienceFor(text) {
  const named = text.match(new RegExp(`\\b(?:${ROLES})\\b`));
  if (!named) return null;
  // "al mio commercialista" and "per il cliente" name the same role; the
  // determiner in between is grammar, not information.
  const addressed = text.match(new RegExp(`\\b(?:al|alla|ai|agli|per|a)\\s+(?:mio|mia|nosso|nostra)?\\s*(${ROLES})\\b`));
  return (addressed ? addressed[1] : named[0]);
}

function toneFor(text, shape) {
  const declared = text.match(/\b(formale|cordiale|amichevole|professionale|gentile|serio|informale)\b/);
  if (declared) return declared[1];
  // A register is only implied by writing to someone. "login con email" is a
  // build detail, not a tone.
  if (shape === SHAPES.EMAIL) return "professionale";
  return null;
}

function detailLevelFor(complexity) {
  if (complexity === PROMPT_COMPLEXITY.COMPLEX) return "completo";
  if (complexity === PROMPT_COMPLEXITY.STANDARD) return "essenziale";
  return "minimo";
}

/**
 * What is genuinely missing.
 *
 * The rule is narrow on purpose: an absence earns ESSENTIAL_MISSING only when
 * it makes a coherent answer *impossible* — right now that means there is no
 * request at all to work from. Everything else (a recipient for an email, a
 * register, a platform) improves the result without blocking it, so it is
 * recorded as USEFUL_BUT_OPTIONAL and never asked. A person who asked for
 * something must not be interrogated about how they asked for it.
 */
function missingInformationFor({ original, shape, audience, tone, complexity }) {
  const missing = [];
  if (!original || sentencesOf(original).length === 0) {
    missing.push({ field: "objective", question: "Cosa vuoi ottenere?", severity: MISSING_INFORMATION.ESSENTIAL });
    return missing;
  }
  if (shape === SHAPES.EMAIL && !audience) {
    missing.push({ field: "audience", question: "A chi scrivo?", severity: MISSING_INFORMATION.OPTIONAL });
  }
  if (shape === SHAPES.BUILD && complexity === PROMPT_COMPLEXITY.COMPLEX) {
    if (!audience) missing.push({ field: "audience", question: "Chi userà questa cosa?", severity: MISSING_INFORMATION.OPTIONAL });
    if (!tone) missing.push({ field: "tone", question: "Che registro preferisci?", severity: MISSING_INFORMATION.OPTIONAL });
  }
  return missing;
}

/**
 * Build the provider-neutral blueprint for one human request. Only the fields
 * that earn their place are present: a simple email has no `successCriteria`
 * because there is nothing to succeed at beyond writing the email.
 */
export function buildPromptBlueprint({ message, semantic, frame } = {}) {
  const original = String(message ?? semantic?.originalMessage ?? "").trim();
  const text = words(`${original} ${semantic?.task ?? ""}`);
  const shape = shapeOf(text);
  const sentenceCount = sentencesOf(original).length;
  const explicitRequirements = countRequirements(text);
  const complexity = complexityOf({ text, shape, sentenceCount, explicitRequirements, enumeratedParts: enumeratedParts(original) });
  const audience = audienceFor(text);
  const tone = toneFor(text, shape);
  const objective = objectiveFor({ original, shape, semantic });
  const missing = missingInformationFor({ original, shape, audience, tone, complexity });
  const declaredConstraints = semantic?.constraints && typeof semantic.constraints === "object" ? Object.entries(semantic.constraints) : [];
  const declaredQuestions = Array.isArray(frame?.clarificationQuestions) ? frame.clarificationQuestions : [];

  const blueprint = {
    shape,
    complexity,
    objective,
    inputs: inputsFor({ original, shape }),
  };

  // The register travels at every size: "brief and professional" is part of
  // what the person asked for, not scaffolding.
  if (tone) blueprint.tone = tone;
  if (audience) blueprint.audience = audience;

  if (complexity !== PROMPT_COMPLEXITY.SIMPLE) {
    blueprint.detailLevel = detailLevelFor(complexity);
    if (declaredConstraints.length > 0) blueprint.constraints = Object.fromEntries(declaredConstraints);
    if (declaredQuestions.length > 0) blueprint.clarification = [...declaredQuestions];
  }

  if (complexity === PROMPT_COMPLEXITY.COMPLEX) {
    blueprint.context = original;
    blueprint.outputFormat = "struttura in sezioni, con un esempio per ogni sezione";
    blueprint.successCriteria = [
      "copre ogni requisito dichiarato",
      "è applicabile così com'è, senza passaggi impliciti",
    ];
    blueprint.exclusions = ["nessun requisito inventato", "nessuna assunzione implicita"];
  }

  blueprint.missingEssentialInformation = missing;
  return Object.freeze(blueprint);
}

/**
 * Render a blueprint. The size of the result is a function of the
 * `complexity` field and nothing else: a SIMPLE request becomes a couple of
 * plain sentences, a COMPLEX one becomes a structured brief.
 */
export function renderPromptBlueprint(blueprint) {
  if (!blueprint || typeof blueprint.objective !== "string") {
    throw new Error("renderPromptBlueprint requires a blueprint with an objective");
  }
  const original = blueprint.inputs?.[0] ?? "";
  if (blueprint.complexity === PROMPT_COMPLEXITY.SIMPLE) {
    // One sentence, the person's own request, plus the one thing that was
    // added. No scaffolding, no "here is what I need you to do" ritual.
    const spoken = original.replace(/[?.!]+$/, "").replace(/^\s*(mi fai|puoi|per favore|vorrei)\s+/i, "Scrivi ");
    // The person may already have said "in parole semplici"; saying it twice
    // would be Safi talking over them.
    const alreadyPlain = /\bin parole semplici\b/i.test(spoken);
    const parts = blueprint.shape === SHAPES.EXPLAIN
      ? [alreadyPlain ? spoken : `Spiegami in parole semplici: ${spoken}`]
      : [spoken];
    if (blueprint.tone) parts.push(`Mantieni un tono ${blueprint.tone}.`);
    return Object.freeze({
      kind: "prompt-ready/v0.2",
      text: Object.freeze(`${parts.join(" ")}`.trim().replace(/([^.!?])\s+([A-ZÀ-Þ])/g, "$1. $2")),
      originalMessage: original,
      complexity: blueprint.complexity,
      goal: blueprint.objective,
    });
  }

  // "Voglio costruire…" already carries its own verb; prefixing one again
  // would produce "Voglio Voglio costruire…".
  const speaks = /^(voglio|vorrei|potresti|puoi|devi|crea|scrivi|spiega|realizza|progetta|analizza|prepara|genera|fammi|dimmi)\b/i.test(blueprint.objective);
  const lines = [speaks ? `${blueprint.objective}.` : `Voglio ${blueprint.objective}.`];
  if (original) lines.push(`Richiesta originale da preservare: "${original}"`);
  if (blueprint.context && blueprint.context !== original) lines.push(`Contesto: ${blueprint.context}`);
  if (blueprint.audience) lines.push(`Destinatario: ${blueprint.audience}`);
  if (blueprint.tone) lines.push(`Tono: ${blueprint.tone}.`);
  if (blueprint.constraints && Object.keys(blueprint.constraints).length > 0) {
    lines.push("", "Vincoli:");
    for (const [key, value] of Object.entries(blueprint.constraints)) lines.push(`- ${key}: ${value}`);
  }
  if (blueprint.clarification?.length) {
    lines.push("", "Prima di rispondere, chiarisci:");
    for (const question of blueprint.clarification) lines.push(`- ${question}`);
  }
  lines.push("", `Livello di dettaglio: ${blueprint.detailLevel}.`);
  if (blueprint.outputFormat) lines.push(`Formato richiesto: ${blueprint.outputFormat}.`);
  if (blueprint.successCriteria?.length) {
    lines.push("Il risultato è completo solo se:");
    for (const criterion of blueprint.successCriteria) lines.push(`- ${criterion}`);
  }
  if (blueprint.exclusions?.length) {
    lines.push("Non fare:");
    for (const exclusion of blueprint.exclusions) lines.push(`- ${exclusion}`);
  }
  return Object.freeze({
    kind: "prompt-ready/v0.2",
    text: Object.freeze(lines.join("\n")),
    originalMessage: original,
    complexity: blueprint.complexity,
    goal: blueprint.objective,
  });
}

/**
 * Delivery contract. The Companion consumes exactly what the widget consumes,
 * so both surfaces speak the same prompt — and neither can reach a provider.
 */
export function composeUniversalPrompt({ message, semantic, frame } = {}) {
  const blueprint = buildPromptBlueprint({ message, semantic, frame });
  const prompt = renderPromptBlueprint(blueprint);
  const essential = blueprint.missingEssentialInformation.filter((entry) => entry.severity === MISSING_INFORMATION.ESSENTIAL);
  return Object.freeze({
    blueprint,
    prompt,
    requiresClarification: essential.length > 0,
    clarificationQuestions: Object.freeze(essential.map((entry) => entry.question)),
  });
}

export const PROMPT_BLUEPRINT_STATUS = "PHASE 9 UNIVERSAL PROMPT COMPOSER — AWAITING HUMAN ACCEPTANCE";
