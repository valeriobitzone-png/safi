/**
 * Deterministic scripted site adapter for hardware-free acceptance demos.
 * It implements the same provider-neutral contract as ChatGPTSiteAdapter;
 * it is never used by the production ChatGPT adapter.
 *
 * A "turn" is created explicitly with `startNewTurn()`, exactly like a live
 * site creating an assistant turn after the user presses send.  Response text
 * grows with `appendChunk()` and the turn settles with `finishStreaming()`.
 */
export class ScriptedCompanionAdapter {
  constructor({ composerText = "", responseText = "", streaming = false } = {}) {
    this.id = "scripted-companion-adapter";
    this.provider = "scripted";
    this.composerText = composerText;
    this.responseText = responseText;
    this.streaming = streaming;
    this.inserted = [];
    this.projections = [];
    this.calls = [];
    this.sendCount = 0;
    // 0 means "no assistant turn exists yet".  The first turn is 1.
    this.responseGeneration = 0;
    this._stability = { key: null, text: null, windows: 0 };
  }

  _call(method, detail = {}) {
    this.calls.push({ method, ...detail });
  }

  _responseKey() {
    return this.responseGeneration === 0 ? null : `scripted-response-${this.responseGeneration}`;
  }

  _hasTurn() {
    return this.responseGeneration > 0;
  }

  /** Create the assistant turn that follows the user's manual send. */
  startNewTurn({ streaming = true, text = "" } = {}) {
    this.responseGeneration += 1;
    this.responseText = text;
    this.streaming = streaming;
    this.resetStability();
    return this.responseGeneration;
  }

  appendChunk(chunk) {
    this.responseText += String(chunk);
    this.resetStability();
    return this.responseText;
  }

  finishStreaming() {
    this.streaming = false;
    return this.streaming;
  }

  resetStability() {
    this._stability = { key: null, text: null, windows: 0 };
    return true;
  }

  _noteStability(key, text, streaming, requiredWindows) {
    if (streaming) {
      this._stability = { key, text: null, windows: 0 };
      return { stable: false, windows: 0 };
    }
    if (this._stability.key !== key || this._stability.text !== text) {
      this._stability = { key, text, windows: 1 };
      return { stable: requiredWindows <= 1, windows: 1 };
    }
    this._stability.windows += 1;
    return { stable: this._stability.windows >= requiredWindows, windows: this._stability.windows };
  }

  detect() {
    this._call("detect");
    return { supported: true, status: "READY", provider: this.provider, confidence: 1, signals: ["scripted"] };
  }

  healthCheck() {
    this._call("healthCheck");
    return { ok: true, status: "READY", provider: this.provider, detection: this.detect(), responseAvailable: this._hasTurn() };
  }

  captureComposer({ authorized = false, userGesture = false } = {}) {
    this._call("captureComposer");
    if (!authorized || !userGesture) return { ok: false, status: "PERMISSION_REQUIRED" };
    return { ok: true, status: "CAPTURED", text: this.composerText, source: "current-composer" };
  }

  insertPrompt(text, { authorized = false, userGesture = false } = {}) {
    this._call("insertPrompt", { length: text.length });
    if (!authorized || !userGesture) return { ok: false, status: "PERMISSION_REQUIRED" };
    this.inserted.push(text);
    this.composerText = text;
    return { ok: true, status: "PROMPT_INSERTED", textLength: text.length, sendTriggered: false };
  }

  observeResponse({ authorized = false, userGesture = false } = {}) {
    this._call("observeResponse");
    if (!authorized || !userGesture) return { ok: false, status: "PERMISSION_REQUIRED" };
    if (!this._hasTurn()) {
      return { ok: false, status: "NO_RESPONSE", provider: this.provider, reason: "No recognized current assistant response is available" };
    }
    return {
      ok: true,
      status: this.streaming ? "STREAMING" : "READY",
      provider: this.provider,
      streaming: this.streaming,
      streamingSignal: this.streaming ? "scripted:streaming" : null,
      stable: false,
      responseKey: this._responseKey(),
    };
  }

  isResponseStreaming(options = {}) {
    const observation = this.observeResponse(options);
    if (!observation.ok) return { ...observation, streaming: false };
    return { ...observation, streaming: observation.streaming === true };
  }

  captureFinalResponse({ authorized = false, userGesture = false, requiredStableWindows = 2 } = {}) {
    this._call("captureFinalResponse");
    if (!authorized || !userGesture) return { ok: false, status: "PERMISSION_REQUIRED" };
    if (!this._hasTurn()) {
      return { ok: false, status: "NO_RESPONSE", provider: this.provider, certifiable: false, text: null, responseKey: null };
    }
    const responseKey = this._responseKey();
    if (this.streaming) {
      this._noteStability(responseKey, null, true, requiredStableWindows);
      return {
        ok: false,
        status: "STREAMING",
        provider: this.provider,
        certifiable: false,
        text: null,
        responseKey,
      };
    }
    if (typeof this.responseText !== "string" || this.responseText.length === 0) {
      return {
        ok: false,
        status: "EMPTY_RESPONSE",
        provider: this.provider,
        reason: "The recognized response is empty",
        certifiable: false,
        text: null,
        responseKey,
      };
    }
    const stability = this._noteStability(responseKey, this.responseText, false, requiredStableWindows);
    if (!stability.stable) {
      return {
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
      };
    }
    return {
      ok: true,
      status: "FINAL",
      provider: this.provider,
      stable: true,
      streaming: false,
      certifiable: true,
      stableWindows: stability.windows,
      text: this.responseText,
      responseKey,
    };
  }

  async waitForFinalResponse({ authorized = false, userGesture = false, timeoutMs = 100, requiredStableWindows = 2 } = {}) {
    this._call("waitForFinalResponse");
    if (!authorized || !userGesture) return { ok: false, status: "PERMISSION_REQUIRED", certifiable: false, text: null };
    await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 5)));
    return this.captureFinalResponse({ authorized, userGesture, requiredStableWindows });
  }

  attachProjection(projection, { authorized = false, userGesture = false } = {}) {
    this._call("attachProjection");
    if (!authorized || !userGesture) return { ok: false, status: "PERMISSION_REQUIRED" };
    this.projections.push(projection);
    return {
      ok: true,
      status: "PROJECTED",
      provider: this.provider,
      attached: true,
      responseUnchanged: true,
      projection: { ...projection, separate: true },
    };
  }
}
