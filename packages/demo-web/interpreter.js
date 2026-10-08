/**
 * Demo intent interpreter (adapter, outside the core).
 *
 * Maps the demo questions to provider-neutral tasks. Real intent
 * understanding would be an LLM-based adapter; the demo stays
 * deterministic so results are reproducible.
 */

const DEMO_INTENTS = [
  {
    match: /buchi\s*neri/i,
    task: "spiegami in modo semplice cosa sono i buchi neri, senza dare per scontata la fisica",
    constraints: { depth: "beginner", language: "italian", tone: "reassuring" },
  },
  {
    match: /(\d+)\s*[x×*]\s*(\d+)/i,
    task: (message) => {
      const m = /(\d+)\s*[x×*]\s*(\d+)/i.exec(message);
      return `calcola ${m[1]} × ${m[2]} e dai solo il risultato`;
    },
    constraints: { language: "italian" },
  },
  {
    match: /vallarsa/i,
    task: "rispondi con i dati richiesti se disponibili, altrimenti dichiara l'incertezza",
    constraints: { language: "italian" },
  },
];

export function createDemoInterpreter(defaultTask = "", defaultConstraints = {}) {
  return function interpret(humanRequest) {
    const message = humanRequest.message.trim();
    if (message.length === 0) {
      return {
        goal: "clarify an empty request",
        task: "ask the person for a concrete request",
        needsClarification: true,
        clarificationQuestions: ["Could you state your request?"],
      };
    }
    for (const intent of DEMO_INTENTS) {
      if (intent.match.test(message)) {
        return {
          goal: "answer the person's request",
          task: typeof intent.task === "function" ? intent.task(message) : intent.task,
          constraints: { ...defaultConstraints, ...intent.constraints },
          needsClarification: false,
        };
      }
    }
    return {
      goal: "answer the person's request",
      task: defaultTask || message,
      constraints: defaultConstraints,
      needsClarification: false,
    };
  };
}
