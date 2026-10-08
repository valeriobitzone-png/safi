/**
 * Safi Companion contracts — OUTSIDE the Core.
 *
 * A Companion is a consentful, DOM-only host beside another AI.  This file
 * contains no provider-specific selectors and no trust semantics.  A site
 * adapter may read only the current, explicitly authorized composer or
 * current, explicitly authorized response; it never receives a document
 * history, screen surface, clipboard, OCR stream, or telemetry sink.
 */

/** User-visible states owned by the Companion host, not by Safi Core. */
export const COMPANION_STATUS = Object.freeze({
  IDLE: "IDLE",
  UNDERSTANDING: "UNDERSTANDING",
  TRANSLATING: "TRANSLATING",
  PROMPT_READY: "PROMPT_READY",
  RESPONSE_OBSERVER_ARMED: "RESPONSE_OBSERVER_ARMED",
  OBSERVING: "OBSERVING",
  NEW_ASSISTANT_TURN_DETECTED: "NEW_ASSISTANT_TURN_DETECTED",
  STREAMING: "STREAMING",
  STABILIZING: "STABILIZING",
  FINAL_RESPONSE_READY: "FINAL_RESPONSE_READY",
  VERIFYING: "VERIFYING",
  VERIFIED: "VERIFIED",
  UNCERTAIN: "UNCERTAIN",
  FAILED: "FAILED",
  COMPANION_UNAVAILABLE: "COMPANION_UNAVAILABLE",
  PERMISSION_REQUIRED: "PERMISSION_REQUIRED",
});

/**
 * The Companion response-observation lifecycle.
 *
 * The observer is armed by the explicit insertion step, not by the later
 * verification click, so a fast turn that appears and completes in under two
 * seconds is still recognized as a new assistant turn.
 */
export const COMPANION_OBSERVATION_PHASES = Object.freeze([
  COMPANION_STATUS.RESPONSE_OBSERVER_ARMED,
  COMPANION_STATUS.NEW_ASSISTANT_TURN_DETECTED,
  COMPANION_STATUS.STREAMING,
  COMPANION_STATUS.STABILIZING,
  COMPANION_STATUS.FINAL_RESPONSE_READY,
]);

/** The minimum content capabilities a site adapter may ever request. */
export const COMPANION_PERMISSIONS = Object.freeze({
  COMPOSER_READ: "composer:read",
  COMPOSER_WRITE: "composer:write",
  RESPONSE_READ: "response:read",
});

export const COMPANION_PERMISSION_KEYS = Object.freeze(Object.values(COMPANION_PERMISSIONS));

/** Required methods for every provider-neutral site adapter. */
export const SITE_ADAPTER_METHODS = Object.freeze([
  "detect",
  "captureComposer",
  "insertPrompt",
  "observeResponse",
  "isResponseStreaming",
  "captureFinalResponse",
  "attachProjection",
  "healthCheck",
]);

/** A stable, provider-neutral failure result. It never contains page text. */
export function companionUnavailable(reason, details = {}) {
  return Object.freeze({
    ok: false,
    status: COMPANION_STATUS.COMPANION_UNAVAILABLE,
    reason: String(reason),
    ...details,
  });
}

/** A stable, explicit-permission failure result. */
export function permissionRequired(permission) {
  return Object.freeze({
    ok: false,
    status: COMPANION_STATUS.PERMISSION_REQUIRED,
    permission,
    reason: `${permission} requires an explicit user permission and action`,
  });
}

/**
 * Validate a site adapter at the boundary.  This is deliberately structural:
 * provider-specific code remains in its own module and cannot add a second
 * trust or translation implementation.
 */
export function assertCompanionSiteAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw new TypeError("Companion requires a site adapter object");
  }
  for (const method of SITE_ADAPTER_METHODS) {
    if (typeof adapter[method] !== "function") {
      throw new TypeError(`CompanionSiteAdapter is missing ${method}()`);
    }
  }
  return adapter;
}

/**
 * Create the minimum-permission ledger for a Companion host.
 *
 * No sensitive capability is granted by default.  A grant requires an
 * explicit user gesture at the moment the user chooses the corresponding
 * flow.  Revocation is always allowed and takes effect immediately.
 */
export function createCompanionPermissions({ granted = {} } = {}) {
  const state = Object.fromEntries(COMPANION_PERMISSION_KEYS.map((key) => [key, false]));
  for (const [key, value] of Object.entries(granted)) {
    if (!COMPANION_PERMISSION_KEYS.includes(key)) {
      throw new Error(`Unknown Companion permission: ${key}`);
    }
    if (typeof value !== "boolean") {
      throw new Error(`Companion permission ${key} must be boolean`);
    }
    // Initial grants are accepted only as an explicit host configuration;
    // normal user-facing flows use grant() with userGesture=true.
    state[key] = value;
  }

  const known = (permission) => {
    if (!COMPANION_PERMISSION_KEYS.includes(permission)) {
      throw new Error(`Unknown Companion permission: ${permission}`);
    }
  };

  const minimumRequired = Object.freeze([...COMPANION_PERMISSION_KEYS]);
  return Object.freeze({
    minimumRequired,
    isGranted(permission) {
      known(permission);
      return state[permission] === true;
    },
    grant(permission, { userGesture = false } = {}) {
      known(permission);
      if (userGesture !== true) {
        throw new Error(`${permission} requires an explicit user gesture`);
      }
      state[permission] = true;
      return Object.freeze({ permission, granted: true });
    },
    revoke(permission) {
      known(permission);
      state[permission] = false;
      return Object.freeze({ permission, granted: false });
    },
    require(permission, { userGesture = false } = {}) {
      known(permission);
      if (userGesture !== true) {
        throw new Error(`${permission} requires an explicit user gesture`);
      }
      if (state[permission] !== true) {
        throw new Error(`${permission} has not been granted by the user`);
      }
      return true;
    },
    snapshot() {
      return Object.freeze({
        minimumRequired: [...minimumRequired],
        granted: { ...state },
      });
    },
  });
}

/**
 * Hash the exact UTF-8 text that was captured.  No trimming, normalization,
 * or line-ending conversion happens here: the digest must bind the same
 * string that is passed to the existing Verify path.
 *
 * Web Crypto is available in browsers and modern Node.  Tests/hosts may
 * inject a compatible `{ subtle: { digest() } }` implementation.
 */
export async function sha256Text(text, cryptoImpl = globalThis.crypto) {
  if (typeof text !== "string") {
    throw new TypeError("sha256Text requires the exact captured text as a string");
  }
  if (!cryptoImpl?.subtle?.digest || typeof TextEncoder !== "function") {
    throw new Error("A Web Crypto SHA-256 implementation is required");
  }
  const bytes = new TextEncoder().encode(text);
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** A manual, integration-free fallback descriptor. It captures nothing. */
export function createManualFallback(reason = "The current site DOM is not recognized") {
  return Object.freeze({
    mode: "MANUAL",
    status: COMPANION_STATUS.COMPANION_UNAVAILABLE,
    reason: String(reason),
    capturesAnything: false,
    automaticSend: false,
    instructions: [
      "Copy the current composer text or final response yourself.",
      "Use Safi Manual mode to paste only that text.",
      "No other tab, app, screen, or conversation is read.",
    ],
  });
}
