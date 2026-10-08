/**
 * Minimal content-script entry.
 *
 * It only boots the page bridge; all behavior lives in the existing Companion
 * adapter/controller and the shared Safi client.
 *
 * P7-LIVE-2 — real MV3 lifecycle.  The browser injects this file into every
 * matching document, so the Companion is reinstalled automatically after a
 * reload or a navigation.  Installation is idempotent within a document, and
 * the permission ledger is deliberately document-scoped: a consent grant never
 * outlives the document that carried it.
 */
import { createSafiClient } from "../../packages/safi-client/index.js";
import { installCompanionPage } from "../../packages/companion/browser-bridge.js";
import { createAdapterForHost } from "../../packages/companion/adapter-registry.js";

export const COMPANION_CONTENT_SCRIPT_VERSION = "phase8-gemini/v0.1";
export const COMPANION_GLOBAL_KEY = "__SAFI_COMPANION_LIVE__";

/**
 * Intended persistence policy for the explicit permission ledger.
 * A reload re-runs this file, the bridge is rebuilt, and every permission
 * starts ungranted again: consent is re-requested, never remembered.
 */
export const COMPANION_PERMISSION_PERSISTENCE = Object.freeze({
  policy: "document-scoped",
  survivesReload: false,
  survivesNavigation: false,
  rationale:
    "A consent grant never outlives the document that carried it; the user re-grants explicitly on every load.",
});

export function createCompanionContentClient() {
  return createSafiClient({
    deps: {
      provider: {
        id: "companion-live-unused-provider",
        async execute() {
          throw new Error("Companion live bridge must not execute a provider");
        },
      },
      verifiers: [{
        checkId: "coherence",
        async verify(candidate) {
          const text = String(candidate?.text ?? "").trim();
          return {
            checkId: "coherence",
            outcome: text.length > 0 ? "PASS" : "FAIL",
            detail: "Risposta non vuota e pronta per la verifica Safi.",
            verifierId: "companion-live-coherence",
          };
        },
      }],
    },
    policy: {
      id: "phase8-companion-live",
      scope: { requiredChecks: ["coherence"] },
      maxCorrectionAttempts: 0,
    },
  });
}

/**
 * Install the Companion in the current document.  The provider is resolved
 * from the current hostname alone: an allowlisted host gets its adapter, any
 * other host gets nothing at all.  Re-invoking this in the same document is a
 * no-op that returns the existing bridge, so a double injection can never
 * create two panels or two ledgers.
 */
export function installSafiCompanionContentScript({ global: scope = globalThis, document: doc = scope?.document } = {}) {
  if (scope?.[COMPANION_GLOBAL_KEY]) return scope[COMPANION_GLOBAL_KEY];
  const win = doc?.defaultView ?? scope;
  const adapter = createAdapterForHost(doc?.location ?? win?.location, {
    document: doc,
    window: win,
    location: doc?.location ?? win?.location,
  });
  if (!adapter) return null;
  const bridge = installCompanionPage({
    adapter,
    document: doc,
    window: win,
    safiClient: createCompanionContentClient(),
  });
  scope[COMPANION_GLOBAL_KEY] = bridge;
  return bridge;
}

// Real content scripts run this file as the document entry point.  Node test
// environments have no `document`, so importing the module is side-effect free.
if (typeof document !== "undefined" && document?.body) {
  try {
    installSafiCompanionContentScript();
  } catch (error) {
    // The content script must fail closed and must not install a partial UI.
    console.error("Safi Companion unavailable", error instanceof Error ? error.message : String(error));
  }
}
