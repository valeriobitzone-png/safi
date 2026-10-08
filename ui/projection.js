/**
 * Safi UX Visual Spec v0.1 — pure projection logic.
 *
 * Presentation only: this module reads a SafiCertificate or SafiStamp and
 * produces frozen, display-ready projections. It never mutates its input,
 * never recomputes hashes and never produces protocol objects.
 * No dependencies. Runs in Node (tests) and in the browser (Web Component).
 */

/**
 * Deep-freezes a value (same semantics as the transport layer).
 * Local copy so the UI layer has zero imports from the Core.
 */
export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze(value[key]);
    }
  }
  return value;
}

/** Human-facing labels. Protocol term second, human word first. */
export const TRUST_LABELS = {
  VERIFIED: { human: "Verified", long: "Verificato", glyph: "●", shape: "filled" },
  UNCERTAIN: { human: "Not certain", long: "Non certo", glyph: "◐", shape: "half" },
  FAILED: { human: "Not verified", long: "Non verificato", glyph: "○", shape: "outline" },
};

/** Recommended (non-normative) color mapping. Never the only signal. */
export const TRUST_COLORS = {
  VERIFIED: "#2e7d32",
  UNCERTAIN: "#b45309",
  FAILED: "#c62828",
};

/** Presentation-only activity states (UX_VISUAL_SPEC_v0.1 §2). */
export const PIPELINE_STATES = [
  "IDLE",
  "UNDERSTANDING",
  "TRANSLATING",
  "WAITING_AI",
  "HUMANIZING",
  "VERIFYING",
  "CORRECTING",
  "RESULT",
];

/** Human→AI micro-states, shown sparingly (spec §2). */
export const MICROSTATE_LABELS = {
  UNDERSTANDING: "Safi sta capendo…",
  TRANSLATING: "Safi sta traducendo…",
  WAITING_AI: "Safi attende la risposta dell'AI…",
  HUMANIZING: "Safi sta semplificando il linguaggio…",
  VERIFYING: "Safi sta verificando…",
  CORRECTING: "Safi sta chiedendo una correzione…",
};

const TRUST_STATUSES = new Set(["VERIFIED", "UNCERTAIN", "FAILED"]);

/** True when the object looks like a certificate or a stamp. */
export function isStampSource(source) {
  if (!source || typeof source !== "object") return false;
  if (typeof source.responseSha256 !== "string") return false;
  return TRUST_STATUSES.has(source.trustStatus);
}

function truncatedHash(hash) {
  if (typeof hash !== "string" || hash.length < 12) return hash ?? "";
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

function checksOf(source) {
  if (Array.isArray(source.checks)) {
    return source.checks.map((c) => ({
      checkId: String(c.checkId ?? ""),
      outcome: String(c.outcome ?? ""),
      detail: typeof c.detail === "string" ? c.detail : "",
    }));
  }
  return [];
}

function scopeOf(source) {
  const scope = source.verificationScope;
  // Certificates carry verificationScope; stamps carry requiredChecks directly.
  const required = scope
    ? scope.requiredChecks
    : source.requiredChecks;
  const optional = scope ? scope.optionalChecks : undefined;
  return {
    requiredChecks: Array.isArray(required) ? [...required] : [],
    optionalChecks: Array.isArray(optional) ? [...optional] : [],
  };
}

/**
 * Full projection of a certificate/stamp into display-ready, frozen data.
 * Accepts a SafiCertificate or a SafiStamp (stamp fields are optional and
 * rendered only when present).
 */
export function projectForDisplay(source) {
  if (!isStampSource(source)) {
    throw new TypeError("projectForDisplay expects a SafiCertificate or SafiStamp");
  }
  const checks = checksOf(source);
  const scope = scopeOf(source);
  // Only REQUIRED checks count: optional checks never influence the ratio.
  const requiredSet = new Set(scope.requiredChecks);
  const passed = checks.filter((c) => c.outcome === "PASS" && requiredSet.has(c.checkId)).length;
  const total = scope.requiredChecks.length;
  const label = TRUST_LABELS[source.trustStatus] ?? TRUST_LABELS.UNCERTAIN;

  const display = {
    schema: typeof source.schema === "string" ? source.schema : "safi-certificate/v0.1",
    trustStatus: source.trustStatus,
    glyph: label.glyph,
    shape: label.shape,
    labelHuman: label.human,
    labelLong: label.long,
    color: TRUST_COLORS[source.trustStatus] ?? TRUST_COLORS.UNCERTAIN,
    ariaLabel: `Safi: ${label.long}. Stato di fiducia ${source.trustStatus}.`,
    checksPassed: passed,
    checksTotal: total,
    checksRatio: `${passed}/${total}`,
    checks,
    scope,
    attempts: {
      attempt: typeof source.attempt === "number" ? source.attempt : 1,
      max: typeof source.maxAttempts === "number" ? source.maxAttempts : 1,
      text: `Tentativi: ${source.attempt ?? 1} di ${source.maxAttempts ?? 1}`,
    },
    timestamp: typeof source.createdAt === "string" ? source.createdAt : "",
    provider: typeof source.provider === "string" ? source.provider : "",
    responseHashTruncated: truncatedHash(source.responseSha256),
    conflictNote:
      Array.isArray(source.conflictingChecks) && source.conflictingChecks.length > 0
        ? `Controlli in disaccordo: ${source.conflictingChecks.join(", ")}`
        : "",
    missingNote:
      Array.isArray(source.missingRequiredChecks) && source.missingRequiredChecks.length > 0
        ? `Controlli non eseguiti: ${source.missingRequiredChecks.join(", ")}`
        : "",
  };
  return deepFreeze(display);
}

/** Level 0/1 summary: the minimal presence and its one-line expansion. */
export function projectSummary(source) {
  const d = projectForDisplay(source);
  return deepFreeze({
    trustStatus: d.trustStatus,
    glyph: d.glyph,
    labelHuman: d.labelHuman,
    labelLong: d.labelLong,
    color: d.color,
    checksRatio: d.checksRatio,
    ariaLabel: `${d.ariaLabel} Controlli superati ${d.checksPassed} su ${d.checksTotal}.`,
  });
}

/** Level 2 detail rows for the expanded panel. */
export function projectDetails(source) {
  const d = projectForDisplay(source);
  return deepFreeze([
    { term: "Verification scope", description: d.scope.requiredChecks.join(", ") || "—" },
    {
      term: "Evidenze",
      description:
        d.checks.map((c) => `${c.checkId}: ${c.outcome}${c.detail ? ` — ${c.detail}` : ""}`).join("; ") || "—",
    },
    { term: "Tentativi", description: `${d.attempts.attempt} di ${d.attempts.max}` },
    { term: "Timestamp", description: d.timestamp || "—" },
    { term: "Provider", description: d.provider || "—" },
    { term: "Response hash", description: d.responseHashTruncated },
    ...(d.conflictNote ? [{ term: "Conflitti", description: d.conflictNote }] : []),
    ...(d.missingNote ? [{ term: "Mancanti", description: d.missingNote }] : []),
  ]);
}

/** Micro-state label for the Human→AI direction (presentation only). */
export function microstateLabel(state) {
  return MICROSTATE_LABELS[state] ?? null;
}

/** Contexts (spec §5). Presentation-only concern. */
export const UX_CONTEXTS = ["EMBEDDED", "COMPANION", "MANUAL"];

/** Recommended context labels for assistive technology. */
export const CONTEXT_ARIA_LABELS = {
  EMBEDDED: "Segnale di verifica Safi accanto alla risposta",
  COMPANION: "Verifica indipendente Safi per questa risposta",
  MANUAL: "Verifica Safi della risposta incollata",
};
