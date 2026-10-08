/**
 * Safi Host Contract — OUTSIDE the core.
 *
 * Every Safi host (desktop tray app, Android overlay, iOS extension,
 * embedded SDK) declares what it CAN do and obtains EXPLICIT user
 * consent before it may do anything that touches content the person
 * did not explicitly hand to Safi.
 *
 * Non-negotiables (Phase 5 mandate):
 *  - no clipboard monitoring, screen reading or conversation capture
 *    without explicit, per-source, revocable user consent;
 *  - consent state lives in the HOST, never in the core and never in
 *    the protocol; the core keeps trusting only verifier results;
 *  - MANUAL mode always exists as the integration-free fallback.
 */

/**
 * Optional per-host permissions. Any capability not declared here is
 * simply absent from that host; nothing falls back silently to
 * "allowed".
 */
export const HOST_CAPABILITIES = {
  /** Explicitly granted clipboard paste (not monitoring). */
  clipboardPaste: { requiresConsent: true, capture: false },
  /** Explicitly granted "verify this selection" action. */
  verifySelection: { requiresConsent: true, capture: false },
  /** Companion interception of an external AI conversation. */
  companionInterception: { requiresConsent: true, capture: true },
  /** Global keyboard shortcut to summon the widget. */
  globalShortcut: { requiresConsent: false, capture: false },
  /** Android overlay bubble above other apps. */
  overlayBubble: { requiresConsent: true, capture: false },
  /** Telemetry. Always opt-in, always off by default, separate from
   *  the protocol. Part of this contract so hosts cannot invent it. */
  telemetry: { requiresConsent: true, capture: false, default: "off" },
};

/** All capabilities the host has granted (never inferred). */
export const DEFAULT_CONSENT = Object.freeze({
  clipboardPaste: false,
  verifySelection: false,
  companionInterception: false,
  globalShortcut: true,
  overlayBubble: false,
  telemetry: false,
});

/**
 * Creates the host's consent ledger.
 *
 * `available` lists the capabilities THIS host physically has (iOS has
 * no overlayBubble, the desktop has no overlay of any kind). Only
 * available capabilities appear in the state, can be granted, or be
 * probed: an OS power the host does not have cannot even be asked for.
 * Only declared capabilities may be granted; unknown ones are rejected
 * so new OS powers cannot silently switch themselves on.
 */
export function createHostConsent({ hostId, platform, granted = {}, available } = {}) {
  if (!hostId || !platform) {
    throw new Error("createHostConsent requires hostId and platform");
  }
  const allKeys = Object.keys(HOST_CAPABILITIES);
  const capabilityKeys = Array.isArray(available) && available.length > 0 ? available : allKeys;
  for (const key of capabilityKeys) {
    if (!(key in HOST_CAPABILITIES)) {
      throw new Error(`Unknown host capability "${key}"`);
    }
  }
  const state = {};
  for (const key of capabilityKeys) {
    // Capabilities that require consent start OFF. Visible actions that
    // read nothing (like summoning the widget) default ON.
    state[key] = HOST_CAPABILITIES[key].requiresConsent ? false : true;
  }
  for (const [key, value] of Object.entries(granted)) {
    if (!(key in HOST_CAPABILITIES)) {
      throw new Error(`Unknown host capability "${key}": hosts may only declare known capabilities`);
    }
    if (!capabilityKeys.includes(key)) {
      throw new Error(`Capability "${key}" is not available on this host`);
    }
    if (typeof value !== "boolean") {
      throw new Error(`Capability "${key}" must be granted as a boolean`);
    }
    state[key] = value;
  }
  return {
    hostId,
    platform,
    /** Capabilities this host physically has. */
    available: Object.freeze([...capabilityKeys]),
    /** True only for available capabilities explicitly granted. */
    isGranted(capability) {
      if (!capabilityKeys.includes(capability)) return false;
      return state[capability] === true;
    },
    /** Grant one available capability; records when, for the audit trail. */
    grant(capability, at = new Date().toISOString()) {
      if (!(capability in HOST_CAPABILITIES)) {
        throw new Error(`Unknown host capability "${capability}"`);
      }
      if (!capabilityKeys.includes(capability)) {
        throw new Error(`Capability "${capability}" is not available on this host`);
      }
      state[capability] = true;
      return { capability, granted: true, at };
    },
    /** Revoke one capability. Revocation is immediate. */
    revoke(capability, at = new Date().toISOString()) {
      if (!(capability in HOST_CAPABILITIES)) {
        throw new Error(`Unknown host capability "${capability}"`);
      }
      if (capability in state) state[capability] = false;
      return { capability, granted: false, at };
    },
    /** Immutable snapshot of the consent state. */
    snapshot() {
      return deepFreezeCopy({ ...state, hostId, platform });
    },
  };
}

/**
 * Gated host probe. Every sensitive operation goes through this gate:
 * without consent the probe throws instead of performing the action.
 * Hosts pass readFn only when the person asked for the action right now
 * (paste button, "verify selection" click) — the gate is the second
 * lock on top of explicit intent.
 */
export function createHostProbe(consent, { capability, describe } = {}) {
  if (!consent || typeof consent.isGranted !== "function") {
    throw new Error("createHostProbe requires a consent ledger");
  }
  if (!capability || !(capability in HOST_CAPABILITIES)) {
    throw new Error(`createHostProbe requires a known capability, got "${capability}"`);
  }
  return {
    capability,
    describe: describe ?? capability,
    /** Human-readable reason shown when the gate blocks. */
    refusalReason() {
      return `"${this.describe}" requires your explicit consent; Safi never reads this content on its own.`;
    },
    /**
     * Runs readFn only with consent; readFn itself is called at most
     * once per invocation and only because the person acted explicitly.
     */
    async read(readFn) {
      if (!consent.isGranted(capability)) {
        throw new Error(this.refusalReason());
      }
      return readFn();
    },
  };
}

function deepFreezeCopy(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreezeCopy(value[key]);
    }
  }
  return value;
}
