/**
 * Safi Desktop Host (reference) — OUTSIDE the core.
 *
 * The thin host that macOS and Windows companions wrap (Tauri 2 window,
 * tray icon, global shortcut). It wires the ONE shared Safi client and
 * the ONE shared widget brain to a MANUAL transport and a loopback-only
 * HTTP bridge. No clipboard monitoring, no screen reading, no hidden
 * capture: clipboard/selection access exists only behind the explicit
 * consent gate of the host contract, and MANUAL paste is always
 * available without any consent because the person typed it.
 *
 * Security posture:
 *  - binds to 127.0.0.1 only; never exposed to the network;
 *  - no secrets: the optional real provider reads env vars only when
 *    the user configures it, never bundled;
 *  - nothing is recorded between runs; only the in-memory last outcome
 *    and widget state are kept, exactly like a visible UI would.
 */

import { createSafiClient } from "../../packages/safi-client/index.js";
import { createSafiWidget, projectTrustState } from "../../packages/safi-widget/index.js";
import { createHostConsent, createHostProbe } from "../../packages/host-contract/index.js";
import { createManualTransport } from "../../packages/transport-manual/index.js";
import { RetryOnceStrategy } from "../../packages/adapter-provider-demo/index.js";
import { createCalculationVerifier } from "../../packages/verifier-calculation/index.js";
import { createSourceVerifier } from "../../packages/verifier-source/index.js";

/** Deterministic local provider for the host default path (no network). */
function createLocalEchoProvider() {
  return {
    id: "desktop-local-provider",
    async execute(request) {
      const text =
        `Ecco cosa ho capito della tua richiesta: "${request.humanMessage}". ` +
        "Sono il provider locale deterministico dell'host desktop: nessun dato lascia questa macchina.";
      return { text, provider: this.id, attempt: request.attempt };
    },
  };
}

/** Coherence check: the answer must address the original human message. */
function createCoherenceVerifier() {
  return {
    checkId: "coherence",
    async verify(candidate) {
      const addresses = candidate.text.trim().length > 0;
      return {
        checkId: "coherence",
        outcome: addresses ? "PASS" : "FAIL",
        detail: addresses
          ? "La risposta affronta la richiesta della persona."
          : "La risposta è vuota.",
        verifierId: "desktop-coherence",
      };
    },
  };
}

/**
 * Creates the desktop host.
 *
 * @param {object} [options]
 * @param {string} [options.platform]  "macos" | "windows"
 * @param {number} [options.port]      loopback port for the host bridge
 * @param {object} [options.deps]      overrides: provider, verifiers
 */
export function createDesktopHost({ platform = "macos", deps = {} } = {}) {
  if (platform !== "macos" && platform !== "windows") {
    throw new Error('platform must be "macos" or "windows"');
  }

  // Consent: the desktop companion starts minimal. Global shortcut is the
  // only pre-granted capability (it summons a visible window; it reads
  // nothing). Clipboard paste and selection verification stay OFF until
  // the person grants them; telemetry does not exist here.
  const consent = createHostConsent({
    hostId: `safi-desktop-${platform}`,
    platform,
    granted: { globalShortcut: true },
  });

  const clipboardProbe = createHostProbe(consent, {
    capability: "clipboardPaste",
    describe: "leggere gli appunti su tua richiesta",
  });

  const provider = deps.provider ?? createLocalEchoProvider();
  const verifiers = deps.verifiers ?? [createCoherenceVerifier()];
  const transport = createManualTransport("desktop-manual-transport");

  const state = { lastDelivery: undefined, lastTranslation: undefined };

  const widget = createSafiWidget({
    host: { hostId: consent.hostId, platform },
  });

  const client = createSafiClient({
    deps: {
      provider,
      verifiers,
      correctionStrategy: new RetryOnceStrategy(),
    },
    policy: {
      id: "desktop-companion",
      scope: { requiredChecks: ["coherence"] },
      maxCorrectionAttempts: 1,
    },
    transport,
  });

  return {
    hostId: consent.hostId,
    platform,
    /** Loopback-only bridge descriptor: declared, never assumed. */
    bridge: { bind: "127.0.0.1", modes: ["MANUAL"] },
    consent,
    clipboardProbe,
    widget,
    client,

    /**
     * One manual Human→AI run through the shared client, the shared
     * transport and the shared widget brain.
     */
    async runPipeline(message) {
      if (typeof message !== "string" || message.trim().length === 0) {
        throw new Error("runPipeline requires the human message");
      }
      // Terminal states only reset through IDLE (Visual Contract flow).
      if (this.widget.get().state !== "IDLE") this.widget.transition("IDLE");
      // Dev-inspection preview (translate() never executes anything).
      state.lastTranslation = this.client.translate({ message });
      for (const step of ["UNDERSTANDING", "TRANSLATING", "WAITING_AI"]) {
        this.widget.transition(step);
      }
      const loop = await this.client.execute({ message, transport });
      const outcome = loop.delivery.outcome;
      state.lastDelivery = loop.delivery;
      // The ONLY path to a terminal widget state: a certified outcome.
      this.widget.showOutcome(outcome);
      return loop;
    },

    /**
     * AI→Human verification of an external answer the person pasted.
     * Arithmetic answers additionally get the deterministic calculation
     * verifier; everything else is checked for coherence.
     */
    async verifyExternalAnswer(answer) {
      if (typeof answer !== "string" || answer.trim().length === 0) {
        throw new Error("verifyExternalAnswer requires the external answer text");
      }
      const hasArithmetic = /(\d+\s*[+×x*\-/÷]\s*\d+)/.test(answer);
      const extra = hasArithmetic
        ? createCalculationVerifier({ checkId: "calculation" })
        : createSourceVerifier({ checkId: "sources", claim: answer });
      // Arithmetic answers get the calculation check as REQUIRED, so a
      // wrong pasted result certifies FAILED instead of being ignored
      // as an optional check.
      const policyOverride = hasArithmetic
        ? {
            id: "desktop-verify-calculation",
            scope: { requiredChecks: ["coherence", "calculation"] },
            maxCorrectionAttempts: 0,
          }
        : {
            // Non-arithmetic answers: a factual claim must be grounded in
            // external sources. Without corroboration the honest outcome
            // is UNCERTAIN — a second opinion is NEVER enough for
            // VERIFIED (Phase 4 principle, kept intact).
            id: "desktop-verify-sources",
            scope: { requiredChecks: ["coherence", "sources"] },
            maxCorrectionAttempts: 0,
          };
      if (this.widget.get().state !== "IDLE") this.widget.transition("IDLE");
      for (const step of ["UNDERSTANDING", "VERIFYING"]) {
        if (this.widget.canTransition(step)) this.widget.transition(step);
      }
      const outcome = await this.client.verify({
        answer,
        providerId: "external-ai-pasted",
        ...(extra ? { verifier: extra } : {}),
        ...(policyOverride ? { policy: policyOverride } : {}),
      });
      this.widget.showOutcome(outcome);
      return outcome;
    },

    /**
     * Clipboard paste, reachable ONLY with explicit consent and ONLY
     * because the person pressed "incolla". The readFn is supplied by
     * the native layer (Tauri plugin); here it is injected so tests can
     * prove the gate.
     */
    async pasteFromClipboard(readFn) {
      return this.clipboardProbe.read(readFn);
    },

    /**
     * Serializable projection for any UI: identical interpretation of
     * the same certificate on every host.
     */
    widgetSnapshot() {
      const snap = this.widget.get();
      const collapsed = this.widget.collapsed();
      return {
        hostId: snap.host.hostId,
        platform: snap.host.platform,
        state: snap.state,
        collapsed: { glyph: collapsed.glyph, label: collapsed.label, aria: collapsed.aria },
        trust:
          snap.outcome?.kind === "result"
            ? projectTrustState(snap.outcome.certificate.trustStatus)
            : undefined,
        stamp: snap.stamp ?? undefined,
        history: snap.history.map((h) => h.state),
      };
    },

    /** Last serialized delivery (outcome deep-frozen by the core). */
    lastDelivery() {
      return state.lastDelivery;
    },

    /** Last translation preview (frame + semantic, dev inspector data). */
    lastTranslation() {
      return state.lastTranslation;
    },
  };
}
