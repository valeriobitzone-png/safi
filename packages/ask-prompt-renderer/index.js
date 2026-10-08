/**
 * Safi Ask prompt renderer — OUTSIDE the core.
 *
 * This is the consumer-facing projection of the provider-neutral semantic
 * translation. It does not interpret, verify, or execute anything: it only
 * turns fields already present in the translation into a copyable prompt.
 * The original human message is always retained in the projection.
 */

const GENERIC_GOAL = "realizzare la richiesta descritta sopra";

function cleanTask(value) {
  return String(value ?? "")
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function has(text, ...terms) {
  return terms.some((term) => text.includes(term));
}

function goalFor(semantic) {
  const original = String(semantic.originalMessage ?? semantic.task ?? "").toLowerCase();
  const task = cleanTask(semantic.task).toLowerCase();
  const text = `${original} ${task}`;
  const declaredGoal = cleanTask(semantic.goal).toLowerCase();

  if (declaredGoal && declaredGoal !== "answer the person's request" && declaredGoal !== GENERIC_GOAL.toLowerCase()) {
    return declaredGoal;
  }
  if (has(text, "grafica", "design", "interfaccia", "app", "applicazione")) {
    return "progettare un'esperienza applicativa con un'interfaccia visivamente curata";
  }
  if (has(text, "mail", "email", "e-mail", "commercialista")) {
    return "redigere un messaggio email professionale e adatto al destinatario indicato";
  }
  if (has(text, "spieg", "insegn", "impara")) {
    return "spiegare la richiesta in modo chiaro e adatto al contesto indicato";
  }
  if (has(text, "riassunt", "sintetizz", "riassumi")) {
    return "rielaborare il materiale fornito in una sintesi chiara e fedele";
  }
  return GENERIC_GOAL;
}

function clarificationFor(semantic, frame, intentText) {
  const declared = frame?.clarificationQuestions ?? [];
  if (declared.length > 0) return declared;

  // These are questions delegated to the AI, not new requirements invented
  // by Safi. They are only emitted for an otherwise underspecified creative
  // design request, where the example in the product brief calls them out.
  if (has(intentText, "grafica", "design", "interfaccia", "app", "applicazione")) {
    return [
      "Qual è il tipo di app e quali sono gli utenti target?",
      "Su quale piattaforma deve funzionare?",
    ];
  }
  if (has(intentText, "mail", "email", "e-mail")) {
    return [
      "Qual è il tono desiderato e quali dettagli del messaggio devo includere?",
    ];
  }
  return [];
}

function sectionFor(semantic, intentText) {
  if (has(intentText, "grafica", "design", "interfaccia", "app", "applicazione")) {
    return {
      help: [
        "definire stile visivo e design system;",
        "scegliere palette, tipografia e componenti;",
        "progettare navigazione e gerarchia delle schermate;",
        "mantenere accessibilità e leggibilità;",
        "creare micro-interazioni e animazioni coerenti;",
        "adattare il design a mobile e desktop se necessario.",
      ],
      output: [
        "1. direzione creativa;",
        "2. struttura delle schermate;",
        "3. componenti principali;",
        "4. design tokens;",
        "5. suggerimenti di implementazione.",
      ],
    };
  }
  if (has(intentText, "mail", "email", "e-mail", "commercialista")) {
    return {
      help: [
        "rispettare il tono e il contesto indicati nella richiesta;",
        "rendere chiari oggetto, destinatario e azione richiesta;",
        "usare un registro professionale e adatto al destinatario.",
      ],
      output: [
        "1. una bozza di email pronta da inviare;",
        "2. eventuali dettagli mancanti da completare prima dell'invio.",
      ],
    };
  }
  return {
    help: [
      "mantenere fedelmente obiettivo e vincoli della richiesta;",
      "fornire una risposta chiara, verificabile e adatta al contesto indicato;",
      "segnalare ogni informazione indispensabile che manca."
    ],
    output: [
      "1. una risposta diretta;",
      "2. le assunzioni essenziali e gli eventuali chiarimenti necessari."
    ],
  };
}

function renderTranslatedPrompt(semantic, frame) {
  if (!semantic || typeof semantic.originalMessage !== "string") {
    throw new Error("renderTranslatedPrompt requires a semantic translation with originalMessage");
  }

  const original = semantic.originalMessage;
  const intentText = `${original} ${semantic.task ?? ""}`.toLowerCase();
  const goal = goalFor(semantic);
  const task = cleanTask(semantic.task) || cleanTask(original);
  const questions = clarificationFor(semantic, frame, intentText);
  const { help, output } = sectionFor(semantic, intentText);
  const constraints = Object.entries(semantic.constraints ?? {});

  const lines = [
    `Voglio ${goal}.`,
    `Richiesta originale da preservare: "${original}"`,
    "",
    "Aiutami a:",
    ...help.map((item) => `- ${item}`),
  ];

  if (task && task.toLowerCase() !== original.toLowerCase()) {
    lines.push(`Obiettivo operativo: ${task}.`);
  }
  if (constraints.length > 0) {
    lines.push("", "Rispetta questi vincoli:");
    for (const [key, value] of constraints) lines.push(`- ${key}: ${value}`);
  }
  if (questions.length > 0) {
    lines.push("", "Prima di proporre la soluzione, fammi eventuali domande mancanti su:");
    for (const question of questions) lines.push(`- ${question}`);
  }
  lines.push("", "Restituisci poi una proposta strutturata con:");
  for (const item of output) lines.push(`- ${item}`);
  lines.push("", "Non cambiare il mio obiettivo, non inventare requisiti e segnala ogni informazione indispensabile che non è stata fornita.");

  return Object.freeze({
    kind: "prompt-ready/v0.1",
    text: Object.freeze(lines.join("\n")),
    originalMessage: original,
    goal,
  });
}

/**
 * Stable delivery contract for the standalone widget and future Companion.
 * The Companion can replace the manual copy by consuming this projection.
 */
export function deliverTranslatedPrompt({ semantic, frame } = {}) {
  return renderTranslatedPrompt(semantic, frame);
}

export { renderTranslatedPrompt };
