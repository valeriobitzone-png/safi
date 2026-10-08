/**
 * ChatGPTSiteAdapter — DOM-only Companion adapter.
 *
 * This adapter is intentionally conservative.  It recognizes the current
 * ChatGPT web document from semantic attributes/roles and a small bounded set
 * of structural fallbacks.  It never scans the whole page for text, never
 * observes another tab/window, never uses OCR, and never clicks a send
 * control.  If the document is not recognized with enough confidence every
 * content operation fails closed and the host offers MANUAL mode.
 */

const CHAT_GPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
const PROJECTION_TRUST_STATUSES = new Set(["VERIFIED", "UNCERTAIN", "FAILED"]);

const SELECTORS = Object.freeze({
  main: Object.freeze(["main", '[role="main"]']),
  composer: Object.freeze([
    'textarea[data-testid="prompt-textarea"]',
    'textarea[aria-label]',
    'textarea[placeholder]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label]',
  ]),
  conversation: Object.freeze([
    "[data-message-author-role]",
    '[data-testid="conversation-turn"]',
    "article",
  ]),
  assistant: Object.freeze([
    '[data-message-author-role="assistant"]',
    '[data-testid="assistant-message"]',
  ]),
  content: Object.freeze([
    '[data-testid="assistant-message-content"]',
    '[data-message-author-role="assistant"] .markdown',
    ".markdown",
    '[role="document"]',
  ]),
});

/**
 * Bounded allowlist of *real* streaming signals.
 *
 * The live site keeps its Stop/Cancel control in the composer footer, outside
 * the response subtree, so the control search is performed against a bounded
 * set of known roots (response node, its ancestors, the recognized
 * conversation scope, the recognized composer).  Only these specific
 * selectors are ever queried: the DOM is never scanned generically.
 */
const STREAMING_SIGNALS = Object.freeze({
  attributes: Object.freeze(["data-streaming", "data-message-state", "data-state", "data-status"]),
  busyValues: Object.freeze(["true", "streaming", "busy", "in-progress", "generating", "partial"]),
  busyPattern: /(?:stream|generat|in-?progress|partial|pending)/,
  settledPattern: /(?:not|complete|completed|done|idle|finished|error|failed|aborted)/,
  controls: Object.freeze([
    '[data-testid="stop-button"]',
    'button[data-testid="stop-button"]',
    '[data-testid="send-button"][data-streaming="true"]',
    'button[aria-label="Stop"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label*="Stop"]',
    'button[aria-label="Interrompi"]',
    'button[aria-label="Interrompi la generazione"]',
    'button[aria-label*="Interrompi"]',
    'button[aria-label="Ferma"]',
    'button[aria-label="Ferma generazione"]',
    'button[aria-label*="Ferma"]',
    'button[aria-label="Annulla"]',
    'button[aria-label*="Annulla generazione"]',
    '.result-streaming',
  ]),
});

const DEFAULT_STABLE_WINDOWS = 2;
const ANCESTOR_DEPTH = 6;

function attr(node, name) {
  try {
    return node?.getAttribute?.(name) ?? null;
  } catch {
    return null;
  }
}

function hasAttr(node, name) {
  try {
    return node?.hasAttribute?.(name) === true;
  } catch {
    return false;
  }
}

function lower(value) {
  return String(value ?? "").toLowerCase();
}

function isVisible(node) {
  if (!node) return false;
  try {
    if (node.hidden === true) return false;
    if (lower(attr(node, "aria-hidden")) === "true") return false;
    if (lower(attr(node, "aria-disabled")) === "true") return false;
    if (lower(attr(node, "data-safi-ignore")) === "true") return false;
    const view = node.ownerDocument?.defaultView;
    if (view?.getComputedStyle) {
      const style = view.getComputedStyle(node);
      if (style?.display === "none" || style?.visibility === "hidden") return false;
    }
    return true;
  } catch {
    return false;
  }
}

function matchesSelector(node, selector) {
  try {
    if (typeof node.matches === "function") return node.matches(selector);
  } catch {
    // A minimal DOM fixture may not implement matches; selector query below
    // remains the source of truth in that case.
  }
  return false;
}

function unique(nodes) {
  return [...new Set(nodes.filter(Boolean))];
}

function queryAll(root, selector) {
  try {
    if (!root?.querySelectorAll) return [];
    return [...root.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function queryWithin(root, selectors) {
  const result = [];
  for (const selector of selectors) {
    if (root && matchesSelector(root, selector)) result.push(root);
    result.push(...queryAll(root, selector));
  }
  return unique(result).filter(isVisible);
}

function textOf(node) {
  if (!node) return null;
  try {
    const tag = String(node.tagName ?? "").toLowerCase();
    // Read the live value only for actual form controls.  Some lightweight DOM
    // fixtures (and custom elements) expose a `value` property on ordinary
    // nodes; treating that as response text would hide the real textContent.
    if ((tag === "textarea" || tag === "input") && typeof node.value === "string") return node.value;
    if (typeof node.textContent === "string") return node.textContent;
    if (typeof node.value === "string") return node.value;
    return null;
  } catch {
    return null;
  }
}

function elementKey(node) {
  if (!node) return null;
  return (
    attr(node, "data-message-id") ??
    attr(node, "data-testid") ??
    attr(node, "id") ??
    null
  );
}

function unavailable(reason, details = {}) {
  return Object.freeze({
    ok: false,
    status: "COMPANION_UNAVAILABLE",
    reason: String(reason),
    ...details,
  });
}

function permissionRequired(permission) {
  return Object.freeze({
    ok: false,
    status: "PERMISSION_REQUIRED",
    permission,
    reason: `${permission} requires explicit authorization and a user gesture`,
  });
}

function authorized(options, permission) {
  if (options?.authorized !== true || options?.userGesture !== true) {
    return permissionRequired(permission);
  }
  return null;
}

function inputScore(node) {
  try {
    let score = 0;
    if (String(node.tagName ?? "").toLowerCase() === "textarea") score += 4;
    if (lower(attr(node, "data-testid")) === "prompt-textarea") score += 8;
    if (lower(attr(node, "role")) === "textbox") score += 5;
    if (hasAttr(node, "aria-label")) score += 3;
    if (hasAttr(node, "placeholder")) score += 2;
    if (lower(attr(node, "contenteditable")) === "true") score += 4;
    if (node.closest?.("form")) score += 2;
    return score;
  } catch {
    return 0;
  }
}

function assistantScore(node) {
  try {
    let score = 0;
    if (lower(attr(node, "data-message-author-role")) === "assistant") score += 9;
    if (lower(attr(node, "data-testid")) === "assistant-message") score += 9;
    if (lower(attr(node, "aria-label")).includes("assistant")) score += 4;
    return score;
  } catch {
    return 0;
  }
}

function bestUnique(nodes, score) {
  const visible = unique(nodes).filter(isVisible).map((node) => ({ node, score: score(node) }));
  visible.sort((left, right) => right.score - left.score);
  if (visible.length === 0 || visible[0].score <= 0) return null;
  // Ambiguous equal-score composer targets are unsafe.  The latest assistant
  // is handled separately because a conversation naturally has many turns.
  if (visible.filter((entry) => entry.score === visible[0].score).length > 1) return null;
  return visible[0].node;
}

function latestAssistant(nodes) {
  const candidates = unique(nodes)
    .filter(isVisible)
    .map((node) => ({ node, score: assistantScore(node) }))
    .filter((entry) => entry.score > 0);
  if (candidates.length === 0) return null;
  const highestScore = Math.max(...candidates.map((entry) => entry.score));
  const highest = candidates.filter((entry) => entry.score === highestScore);
  // Query order is the bounded DOM order; for equally strong semantic
  // signals, the last matching turn is the current response.
  return highest[highest.length - 1].node;
}

function boundedRoots(node, extra = []) {
  const roots = [];
  let current = node;
  let depth = 0;
  while (current && depth < ANCESTOR_DEPTH) {
    roots.push(current);
    current = current.parentNode;
    depth += 1;
  }
  for (const root of extra) {
    if (root) roots.push(root);
  }
  return unique(roots);
}

/**
 * Inspect only the bounded allowlist of streaming signals.  Returns the name of
 * the signal that fired, or null.  Absence of a signal is never treated as
 * proof that a response is final: stability is proven separately by the
 * consecutive-equal-snapshot window in `captureFinalResponse`.
 */
function streamingSignal(roots) {
  for (const root of roots) {
    for (const name of STREAMING_SIGNALS.attributes) {
      const value = lower(attr(root, name));
      if (!value || STREAMING_SIGNALS.settledPattern.test(value)) continue;
      if (STREAMING_SIGNALS.busyValues.includes(value)) return `attribute:${name}`;
      if (STREAMING_SIGNALS.busyPattern.test(value)) return `attribute:${name}`;
    }
    for (const selector of STREAMING_SIGNALS.controls) {
      if (queryAll(root, selector).length > 0) return `control:${selector}`;
    }
  }
  return null;
}

function isResponseContent(node) {
  if (!node) return false;
  if (hasAttr(node, "data-safi-ignore")) return false;
  if (String(node.tagName ?? "").toLowerCase() === "button") return false;
  // Health/detection must not read response text.  The final capture method
  // performs the only text read, after explicit response permission.
  return true;
}

export class ChatGPTSiteAdapter {
  /**
   * @param {object} options
   * @param {Document} [options.document] current page document only
   * @param {Window} [options.window] current page window only
   * @param {Location|{hostname:string}} [options.location] current location only
   */
  constructor({ document: doc, window: win, location } = {}) {
    this.id = "chatgpt-site-adapter";
    this.provider = "chatgpt";
    this.document = doc ?? globalThis.document ?? null;
    this.window = win ?? this.document?.defaultView ?? globalThis.window ?? null;
    this.location = location ?? this.window?.location ?? this.document?.location ?? null;
    this._nodeKeys = new WeakMap();
    this._nextNodeKey = 1;
    // Consecutive-equal-snapshot window.  A response is only readable once the
    // exact same text survived at least `requiredStableWindows` polls with no
    // streaming signal; a missing Stop control never makes it certifiable.
    this._stability = { key: null, text: null, since: 0, windows: 0 };
  }

  _streamRoots(resolution) {
    return boundedRoots(resolution.assistant, [
      resolution.content,
      resolution.conversation,
      resolution.main,
      resolution.composer,
    ]);
  }

  _noteStability({ key, text, streaming, now, requiredStableMs, requiredWindows }) {
    if (streaming) {
      this._stability = { key, text: null, since: now(), windows: 0 };
      return { stable: false, windows: 0 };
    }
    if (this._stability.key !== key || this._stability.text !== text) {
      this._stability = { key, text, since: now(), windows: 1 };
      return { stable: requiredStableMs <= 0 && requiredWindows <= 1, windows: 1 };
    }
    this._stability.windows += 1;
    const elapsed = now() - this._stability.since;
    return {
      stable: this._stability.windows >= requiredWindows && elapsed >= requiredStableMs,
      windows: this._stability.windows,
    };
  }

  /** Drop the stability window; used when a new turn boundary is observed. */
  resetStability() {
    this._stability = { key: null, text: null, since: 0, windows: 0 };
  }

  _responseKey(node) {
    // Use object identity for the turn boundary.  A provider may reuse a
    // semantic id while replacing the response node, which must still count
    // as a new current response.
    if (!node || (typeof node !== "object" && typeof node !== "function")) return null;
    let key = this._nodeKeys.get(node);
    if (!key) {
      key = this._nextNodeKey++;
      this._nodeKeys.set(node, key);
    }
    return `dom:node-${key}`;
  }

  hostname() {
    const candidates = [];
    for (const source of [this.location, this.document?.location, this.window?.location]) {
      try {
        const hostname = source?.hostname ?? (source?.href ? new URL(source.href).hostname : "");
        if (hostname) candidates.push(lower(hostname));
      } catch {
        // A malformed or inaccessible location is not a supported origin.
      }
    }
    const unique = [...new Set(candidates)];
    // Do not allow a caller to pair a ChatGPT-looking document with a
    // different current location.  A mismatch fails closed.
    return unique.length === 1 ? unique[0] : "";
  }

  _resolve() {
    const main = bestUnique(queryWithin(this.document, SELECTORS.main), () => 1);
    if (!main) return { main: null, composer: null, conversation: null, assistant: null, content: null };
    const composer = bestUnique(queryWithin(main, SELECTORS.composer), inputScore);
    const conversationCandidates = queryWithin(main, SELECTORS.conversation);
    // Multiple message turns are expected.  The recognized `main` container
    // is the bounded conversation scope; never widen the search to body or
    // another document surface.
    const conversation = conversationCandidates.length > 0 ? main : null;
    const assistantRoot = conversation ?? main;
    const assistant = latestAssistant(queryWithin(assistantRoot, SELECTORS.assistant));
    const contentCandidates = assistant ? queryWithin(assistant, SELECTORS.content) : [];
    const assistantIsContent = assistant
      ? SELECTORS.content.some((selector) => matchesSelector(assistant, selector))
      : false;
    const content = contentCandidates.find(isResponseContent) ?? (assistantIsContent ? assistant : null);
    return { main, composer, conversation, assistant, content };
  }

  detect() {
    const host = this.hostname();
    const signals = [];
    if (CHAT_GPT_HOSTS.has(host)) signals.push("chatgpt-host");
    // Do not inspect arbitrary page DOM on an unsupported origin.  The
    // adapter is allowed to recognize only the explicitly supported site.
    if (!CHAT_GPT_HOSTS.has(host)) {
      return Object.freeze({
        supported: false,
        status: "COMPANION_UNAVAILABLE",
        provider: this.provider,
        confidence: 0,
        signals,
        reason: "The current host is not a supported ChatGPT web origin",
      });
    }
    const resolution = this._resolve();
    if (resolution.main) signals.push("semantic-main");
    if (resolution.composer) signals.push("semantic-composer");
    if (resolution.conversation) signals.push("conversation-container");
    if (resolution.assistant) signals.push("assistant-turn");
    if (!resolution.main || !resolution.composer) {
      return Object.freeze({
        supported: false,
        status: "COMPANION_UNAVAILABLE",
        provider: this.provider,
        confidence: resolution.main ? 0.55 : 0.25,
        signals,
        reason: "ChatGPT semantic composer signals were not found",
      });
    }
    // A new conversation may not have an assistant turn yet.  Host + main +
    // one unambiguous semantic composer is enough for capture; response
    // observation remains unavailable until a recognized assistant turn exists.
    const confidence = Math.min(1, 0.55 + (resolution.conversation ? 0.2 : 0.1) + (resolution.assistant ? 0.15 : 0));
    return Object.freeze({
      supported: true,
      status: "READY",
      provider: this.provider,
      confidence: Number(confidence.toFixed(2)),
      signals,
      reason: null,
    });
  }

  healthCheck() {
    const detection = this.detect();
    if (!detection.supported) return Object.freeze({ ...detection, ok: false });
    const resolution = this._resolve();
    if (!resolution.main || !resolution.composer) {
      return unavailable("ChatGPT DOM health check failed", {
        provider: this.provider,
        detection,
      });
    }
    return Object.freeze({
      ok: true,
      status: "READY",
      provider: this.provider,
      detection,
      responseAvailable: Boolean(resolution.assistant && resolution.content),
      scopes: Object.freeze({
        main: elementKey(resolution.main),
        composer: elementKey(resolution.composer),
        conversation: elementKey(resolution.conversation),
        assistant: elementKey(resolution.assistant),
        response: elementKey(resolution.content),
      }),
    });
  }

  captureComposer(options = {}) {
    const denied = authorized(options, "composer:read");
    if (denied) return denied;
    const health = this.healthCheck();
    if (!health.ok) return health;
    const { composer } = this._resolve();
    if (!composer) return unavailable("Recognized composer disappeared before capture");
    const text = textOf(composer);
    if (typeof text !== "string" || text.length === 0) {
      return Object.freeze({ ok: false, status: "EMPTY_COMPOSER", reason: "The authorized composer is empty" });
    }
    return Object.freeze({
      ok: true,
      status: "CAPTURED",
      provider: this.provider,
      source: "current-composer",
      text,
    });
  }

  insertPrompt(text, options = {}) {
    const denied = authorized(options, "composer:write");
    if (denied) return denied;
    if (typeof text !== "string" || text.length === 0) {
      return Object.freeze({ ok: false, status: "EMPTY_PROMPT", reason: "Prompt text is required" });
    }
    const health = this.healthCheck();
    if (!health.ok) return health;
    const { composer } = this._resolve();
    if (!composer) return unavailable("Recognized composer disappeared before insertion");
    const view = composer.ownerDocument?.defaultView ?? globalThis;
    const EventCtor = view.Event ?? globalThis.Event;
    if (!EventCtor || typeof composer.dispatchEvent !== "function") {
      return unavailable("The recognized composer cannot emit an input event");
    }
    const previous = textOf(composer);
    try {
      const tag = String(composer.tagName ?? "").toLowerCase();
      const contentEditable = lower(attr(composer, "contenteditable")) === "true";
      const valueControl = !contentEditable && (tag === "textarea" || tag === "input" || "value" in composer);
      if (valueControl) {
        const view = composer.ownerDocument?.defaultView;
        const prototype = tag === "textarea"
          ? view?.HTMLTextAreaElement?.prototype
          : view?.HTMLInputElement?.prototype;
        const setter = prototype ? Object.getOwnPropertyDescriptor(prototype, "value")?.set : undefined;
        if (setter) setter.call(composer, text);
        else composer.value = text;
      } else {
        composer.textContent = text;
      }
      composer.dispatchEvent(new EventCtor("input", { bubbles: true, composed: true }));
      return Object.freeze({
        ok: true,
        status: "PROMPT_INSERTED",
        provider: this.provider,
        textLength: text.length,
        sendTriggered: false,
      });
    } catch {
      try {
        if (typeof previous === "string") {
          const tag = String(composer.tagName ?? "").toLowerCase();
          const contentEditable = lower(attr(composer, "contenteditable")) === "true";
          const valueControl = !contentEditable && (tag === "textarea" || tag === "input" || "value" in composer);
          if (valueControl) composer.value = previous;
          else composer.textContent = previous;
        }
      } catch {
        // The DOM may reject rollback too; still fail closed without exposing
        // any page text in the result.
      }
      return unavailable("Prompt insertion was refused by the recognized DOM");
    }
  }

  _responseResolution() {
    const resolution = this._resolve();
    if (!resolution.assistant || !resolution.content) return { ...resolution, responseMissing: true };
    return { ...resolution, responseMissing: false };
  }

  observeResponse(options = {}) {
    const denied = authorized(options, "response:read");
    if (denied) return denied;
    const health = this.healthCheck();
    if (!health.ok) return health;
    const resolution = this._responseResolution();
    if (resolution.responseMissing) {
      return Object.freeze({
        ok: false,
        status: "NO_RESPONSE",
        provider: this.provider,
        reason: "No recognized current assistant response is available",
      });
    }
    const signal = streamingSignal(this._streamRoots(resolution));
    return Object.freeze({
      ok: true,
      status: signal ? "STREAMING" : "READY",
      provider: this.provider,
      streaming: Boolean(signal),
      streamingSignal: signal,
      stable: false,
      responseKey: this._responseKey(resolution.assistant),
    });
  }

  isResponseStreaming(options = {}) {
    const observation = this.observeResponse(options);
    if (!observation.ok) return observation;
    return Object.freeze({
      ok: true,
      status: observation.status,
      streaming: observation.streaming,
      responseKey: observation.responseKey,
    });
  }

  captureFinalResponse(options = {}) {
    const denied = authorized(options, "response:read");
    if (denied) return denied;
    const {
      stableMs = 0,
      requiredStableWindows = DEFAULT_STABLE_WINDOWS,
      now = () => Date.now(),
    } = options;
    const health = this.healthCheck();
    if (!health.ok) return health;
    const resolution = this._responseResolution();
    if (resolution.responseMissing) {
      return Object.freeze({
        ok: false,
        status: "NO_RESPONSE",
        provider: this.provider,
        reason: "No recognized current assistant response is available",
        certifiable: false,
      });
    }
    const responseKey = this._responseKey(resolution.assistant);
    const signal = streamingSignal(this._streamRoots(resolution));
    const text = textOf(resolution.content);
    if (typeof text !== "string" || text.length === 0) {
      this._noteStability({ key: responseKey, text: null, streaming: true, now, requiredStableMs: stableMs, requiredWindows: requiredStableWindows });
      return Object.freeze({
        ok: false,
        status: "EMPTY_RESPONSE",
        provider: this.provider,
        reason: "The recognized response is empty",
        certifiable: false,
        text: null,
        responseKey,
      });
    }
    const stability = this._noteStability({
      key: responseKey,
      text,
      streaming: Boolean(signal),
      now,
      requiredStableMs: stableMs,
      requiredWindows: requiredStableWindows,
    });
    if (signal) {
      // Crucially, no partial text is returned on this path.
      return Object.freeze({
        ok: false,
        status: "STREAMING",
        provider: this.provider,
        reason: "The assistant response is still streaming",
        streamingSignal: signal,
        certifiable: false,
        text: null,
        responseKey,
      });
    }
    if (!stability.stable) {
      return Object.freeze({
        ok: true,
        status: "STABILIZING",
        provider: this.provider,
        stable: false,
        streaming: false,
        certifiable: false,
        stableWindows: stability.windows,
        requiredStableWindows,
        text: null,
        responseKey,
      });
    }
    return Object.freeze({
      ok: true,
      status: "FINAL",
      provider: this.provider,
      stable: true,
      streaming: false,
      certifiable: true,
      stableWindows: stability.windows,
      text,
      responseKey,
    });
  }

  /**
   * Wait for a non-streaming, byte-for-byte stable current response.  The
   * text is returned only after the same exact string survives the complete
   * stability window; a timeout never certifies a partial stream.
   */
  async waitForFinalResponse({
    authorized: isAuthorized = false,
    userGesture = false,
    timeoutMs = 30_000,
    stableMs = 0,
    pollMs = 100,
    requiredStableWindows = DEFAULT_STABLE_WINDOWS,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    const options = {
      authorized: isAuthorized,
      userGesture,
      stableMs,
      requiredStableWindows,
      now,
    };
    const denied = authorized(options, "response:read");
    if (denied) return denied;
    const started = now();
    let sawStreaming = false;
    while (now() - started <= timeoutMs) {
      const observation = this.observeResponse(options);
      if (observation.ok && observation.streaming) sawStreaming = true;
      const capture = this.captureFinalResponse(options);
      if (capture.ok && capture.stable && capture.streaming === false && capture.certifiable === true) {
        return capture;
      }
      await sleep(Math.max(1, pollMs));
    }
    return Object.freeze({
      ok: false,
      status: sawStreaming ? "STREAMING" : "NO_RESPONSE",
      provider: this.provider,
      reason: sawStreaming
        ? "The response did not become final before the timeout"
        : "No final response became available before the timeout",
      certifiable: false,
      text: null,
    });
  }

  attachProjection(projection, options = {}) {
    const denied = authorized(options, "response:read");
    if (denied) return denied;
    const health = this.healthCheck();
    if (!health.ok) return health;
    const resolution = this._responseResolution();
    if (resolution.responseMissing) {
      return unavailable("Cannot attach a projection without a recognized current response");
    }
    const target = resolution.content ?? resolution.assistant;
    const parent = resolution.assistant?.parentNode ?? target?.parentNode;
    if (!target || !parent || typeof parent.appendChild !== "function") {
      return unavailable("The recognized response has no safe sibling projection mount");
    }

    let label;
    let hash;
    try {
      label = String(projection?.label ?? projection?.trustStatus ?? "Safi").slice(0, 200);
      hash = String(projection?.responseSha256 ?? "");
    } catch {
      return unavailable("Projection data could not be read safely");
    }
    if (!/^[0-9a-f]{64}$/i.test(hash)) {
      return unavailable("Projection hash is not a SHA-256 digest");
    }
    let trustStatus;
    try {
      trustStatus = String(projection?.trustStatus ?? "");
    } catch {
      return unavailable("Projection trust status could not be read safely");
    }
    if (!PROJECTION_TRUST_STATUSES.has(trustStatus)) {
      return unavailable("Projection trust status is not recognized");
    }

    const before = textOf(target);
    if (typeof before !== "string") {
      return unavailable("The recognized response text is unavailable for projection");
    }
    if (options.expectedResponseText !== undefined && before !== options.expectedResponseText) {
      return unavailable("The recognized response changed before projection");
    }
    let existing;
    try {
      existing = [...(parent.children ?? [])].find(
        (child) => lower(attr(child, "data-safi-companion-projection")) === this.provider,
      );
    } catch {
      return unavailable("The projection mount could not be inspected safely");
    }

    let element = existing;
    let created = false;
    try {
      if (!element) {
        const create = target.ownerDocument?.createElement?.bind(target.ownerDocument);
        if (!create) return unavailable("The response document cannot create a projection element");
        element = create("aside");
        created = true;
        parent.appendChild(element);
      }
      element.setAttribute?.("data-safi-companion-projection", this.provider);
      element.setAttribute?.("data-safi-ignore", "true");
      element.setAttribute?.("data-safi-response-sha256", hash);
      element.setAttribute?.("role", "status");
      element.setAttribute?.("aria-label", String(projection?.ariaLabel ?? `Safi: ${label}`).slice(0, 300));
      element.textContent = `${label} · ${hash.slice(0, 8)}…${hash.slice(-8)}`;
    } catch {
      if (created) {
        try {
          element?.remove?.();
        } catch {
          // Keep the original DOM failure fail-closed.
        }
      }
      return unavailable("Projection attachment was refused by the DOM");
    }
    const after = textOf(target);
    if (before !== after) {
      try {
        element.remove?.();
      } catch {
        // The response mismatch is still a hard refusal even if cleanup fails.
      }
      return unavailable("Projection attachment changed the response text; refusing the result");
    }
    return Object.freeze({
      ok: true,
      status: "PROJECTED",
      provider: this.provider,
      attached: true,
      responseUnchanged: true,
      projection: Object.freeze({
        schema: "safi-companion-projection/v0.1",
        trustStatus,
        label,
        responseSha256: hash,
        separate: true,
      }),
    });
  }
}

export const CHATGPT_ADAPTER_SELECTORS = SELECTORS;
export const CHATGPT_ADAPTER_STREAMING_SIGNALS = STREAMING_SIGNALS;
export const CHATGPT_ADAPTER_STABLE_WINDOWS = DEFAULT_STABLE_WINDOWS;
