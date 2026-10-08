/**
 * Shared demo data for the static UX mocks. Plain ES module, no deps.
 * These objects imitate a real SafiCertificate / SafiStamp / developer
 * context produced by the reference runtime.
 */

export const DEMO_CERTIFICATE = {
  schema: "safi-certificate/v0.1",
  trustStatus: "VERIFIED",
  verificationScope: {
    requiredChecks: ["coherence", "meaning-preservation", "sources"],
    optionalChecks: ["freshness"],
  },
  checks: [
    {
      checkId: "coherence",
      outcome: "PASS",
      detail: "La risposta affronta la richiesta dichiarata.",
      verifierId: "coherence-verifier",
    },
    {
      checkId: "meaning-preservation",
      outcome: "PASS",
      detail: "Il testo umanizzato preserva le affermazioni della risposta grezza.",
      verifierId: "meaning-verifier",
    },
    {
      checkId: "sources",
      outcome: "PASS",
      detail: "Una fonte indipendente conferma l'affermazione principale.",
      verifierId: "sources-verifier",
    },
    {
      checkId: "freshness",
      outcome: "INCONCLUSIVE",
      detail: "Controllo opzionale non determinante.",
      verifierId: "freshness-verifier",
    },
  ],
  missingRequiredChecks: [],
  conflictingChecks: [],
  attempt: 1,
  maxAttempts: 1,
  provider: "example-provider",
  policyId: "example-policy",
  createdAt: "2026-09-18T08:30:00.000Z",
  responseSha256: "b6a3f2e31a9d4c08b5e7f6a1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d5e4f",
};

export const DEMO_STAMP = {
  schema: "safi-stamp/v0.1",
  trustStatus: "VERIFIED",
  createdAt: "2026-09-18T08:30:00.000Z",
  policyId: "example-policy",
  responseSha256: "b6a3f2e31a9d4c08b5e7f6a1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d5e4f",
  requiredChecks: ["coherence", "meaning-preservation", "sources"],
  attempt: 1,
  maxAttempts: 1,
  provider: "example-provider",
};

export const DEMO_DEVELOPER_CONTEXT = {
  humanRequest: {
    message: "Ciao, per favore spiegami cos'è un DNS in parole semplici.",
  },
  intentFrame: {
    goal: "answer the person's request",
    task: "spiegami cos'è un DNS in parole semplici",
    constraints: { depth: "beginner", language: "italian" },
    needsClarification: false,
  },
  semantic: {
    kind: "semantic-representation/v0.1",
    goal: "answer the person's request",
    task: "spiegami cos'è un DNS in parole semplici",
    constraints: { depth: "beginner", language: "italian" },
    originalMessage: "Ciao, per favore spiegami cos'è un DNS in parole semplici.",
    interpretationNotes: [
      "removed politeness formula without changing the request",
      "removed greeting without changing the request",
    ],
    translatedBy: "plain-language-translator",
  },
  safiRequest: {
    goal: "answer the person's request",
    task: "spiegami cos'è un DNS in parole semplici",
    constraints: { depth: "beginner", language: "italian" },
    humanMessage: "Ciao, per favore spiegami cos'è un DNS in parole semplici.",
    attempt: 1,
  },
};
