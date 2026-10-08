/**
 * Safi Widget (headless) — OUTSIDE the core.
 *
 * One widget brain shared by every host: the same certificate must be
 * interpreted the same way on macOS, Windows, Android and iOS. It
 * implements the presentation layers of UX_VISUAL_SPEC_v0.1:
 *
 *   pipeline states (Human→AI): UNDERSTANDING → TRANSLATING →
 *   WAITING_AI → HUMANIZING → VERIFYING → CORRECTING → RESULT
 *
 *   terminal states (Safi Stamp): VERIFIED | UNCERTAIN | FAILED
 *
 * Trust semantics stay in the core: the widget only reads certificates
 * and outcomes (deep-frozen) and renders. It never mutates them, has
 * no setters for certificate content, and renders non-color signals
 * (glyph + label + human text) exactly as the Visual Contract requires.
 *
 * Terminal projection:
 *   VERIFIED  → "●" + "Verificato"      (green suggested, never alone)
 *   UNCERTAIN → "◐" + "Non certo"       (amber suggested, never alone)
 *   FAILED    → "○" + "Non verificato"  (red suggested, never alone)
 */

/** Terminal projection of a trust status. Color is never the only signal. */
export function projectTrustState(trustStatus) {
  switch (trustStatus) {
    case "VERIFIED":
      return { glyph: "●", label: "Verificato", aria: "Safi: risposta verificata", color: "green" };
    case "UNCERTAIN":
      return { glyph: "◐", label: "Non certo", aria: "Safi: risposta non certa", color: "amber" };
    case "FAILED":
      return { glyph: "○", label: "Non verificato", aria: "Safi: risposta non verificata", color: "red" };
    default:
      throw new Error(`Unknown trust status: ${trustStatus}`);
  }
}

/** All pipeline states, in order, per the approved UX Visual Contract. */
export const PIPELINE_STATES = Object.freeze([
  "IDLE",
  "UNDERSTANDING",
  "TRANSLATING",
  "WAITING_AI",
  "HUMANIZING",
  "VERIFYING",
  "CORRECTING",
  "VERIFIED",
  "UNCERTAIN",
  "FAILED",
]);

/** Legal transitions. Strict: presentation cannot invent its own flow. */
const TRANSITIONS = Object.freeze({
  IDLE: ["UNDERSTANDING", "VERIFYING"],
  UNDERSTANDING: ["TRANSLATING", "IDLE"],
  TRANSLATING: ["WAITING_AI", "IDLE"],
  WAITING_AI: ["HUMANIZING", "VERIFYING", "IDLE"],
  HUMANIZING: ["VERIFYING", "IDLE"],
  VERIFYING: ["CORRECTING", "VERIFIED", "UNCERTAIN", "FAILED", "IDLE"],
  CORRECTING: ["VERIFIED", "UNCERTAIN", "FAILED", "IDLE"],
  VERIFIED: ["IDLE"],
  UNCERTAIN: ["IDLE"],
  FAILED: ["IDLE"],
});

/** Human→AI microstates (UX spec: never show the technical prompt). */
const MICROSTATES = Object.freeze({
  UNDERSTANDING: "Safi sta capendo…",
  TRANSLATING: "Safi sta traducendo…",
});

/**
 * Creates the headless widget controller.
 *
 * @param {object}   [options.host]           host descriptor { hostId, platform }
 * @param {(snapshot: object) => void} [options.onChange] notified on every change
 */
export function createSafiWidget({ host = { hostId: "shared", platform: "shared" }, onChange } = {}) {
  let current = "IDLE";
  let lastOutcome = undefined;
  let lastStamp = undefined;
  const history = [];

  const snapshot = () =>
    Object.freeze({
      host,
      state: current,
      microstate: MICROSTATES[current],
      outcome: lastOutcome,
      stamp: lastStamp,
      history: Object.freeze([...history]),
    });

  const notify = () => {
    if (onChange) onChange(snapshot());
    return snapshot();
  };

  return {
    /** True when a transition is legal per the Visual Contract flow. */
    canTransition(to) {
      return (TRANSITIONS[current] ?? []).includes(to);
    },

    /** Move to a pipeline state; throws on illegal transitions. */
    transition(to) {
      if (!PIPELINE_STATES.includes(to)) {
        throw new Error(`Unknown widget state: ${to}`);
      }
      if (!this.canTransition(to)) {
        throw new Error(`Illegal widget transition: ${current} → ${to}`);
      }
      current = to;
      if (to === "IDLE") {
        lastOutcome = undefined;
        lastStamp = undefined;
      }
      history.push({ state: to, at: new Date().toISOString() });
      return notify();
    },

    /**
     * The ONLY way a terminal state appears: from a certified outcome.
     * Certificates are read-only here; the widget cannot rewrite them.
     */
    showOutcome(outcome) {
      if (!outcome || outcome.kind !== "result") {
        throw new Error("showOutcome requires a certified RESULT outcome");
      }
      // Freeze what we were given so rendering cannot mutate it.
      if (outcome && typeof outcome === "object" && !Object.isFrozen(outcome)) {
        Object.freeze(outcome);
      }
      lastOutcome = outcome;
      lastStamp = {
        schema: "safi-stamp/v0.1",
        trustStatus: outcome.certificate.trustStatus,
        createdAt: outcome.certificate.createdAt,
        policyId: outcome.certificate.policyId,
        responseSha256: outcome.certificate.responseSha256,
        requiredChecks: [...outcome.certificate.verificationScope.requiredChecks],
        attempt: outcome.certificate.attempt,
        maxAttempts: outcome.certificate.maxAttempts,
        provider: outcome.certificate.provider,
      };
      current = outcome.certificate.trustStatus;
      history.push({ state: current, at: new Date().toISOString() });
      return notify();
    },

    /** Minimal collapsed form: just "●". Opens only when asked. */
    collapsed() {
      if (current !== "VERIFIED" && current !== "UNCERTAIN" && current !== "FAILED") {
        return { glyph: "◐", label: undefined, aria: "Safi: elaborazione in corso" };
      }
      return projectTrustState(current);
    },

    /** Current immutable snapshot. */
    get() {
      return snapshot();
    },
  };
}
