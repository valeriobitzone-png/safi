/**
 * Safi Companion vertical slice — OUTSIDE the Core.
 *
 * The controller owns orchestration and permissions only.  It delegates
 * provider DOM work to a CompanionSiteAdapter and delegates trust semantics
 * to an injected existing Safi client (`translate` and `verify`).  It never
 * reimplements translation, verification, certificates, or trust states.
 */
import {
  COMPANION_PERMISSIONS,
  COMPANION_STATUS,
  assertCompanionSiteAdapter,
  createCompanionPermissions,
  createManualFallback,
  sha256Text,
} from "./site-adapter.js";
import { buildPromptBlueprint, renderPromptBlueprint } from "../prompt-blueprint/index.js";
import { judgeAnswer } from "../judge/index.js";
import { buildClaims, claimProfile } from "../claims/index.js";
import { humanizeForConsumer } from "../humanizer/index.js";
import { projectSummary } from "../../ui/projection.js";

/**
 * The one renderer the Companion uses. The Universal Prompt Composer replaces
 * the old template renderer outright: the size of the prompt follows the size
 * of the intent, and there is no second system left running beside it.
 */
function composePromptFromTranslation(translationInput) {
  const semantic = translationInput?.semantic;
  const blueprint = buildPromptBlueprint({
    message: semantic?.originalMessage,
    semantic,
    frame: translationInput?.frame,
  });
  return { blueprint, prompt: renderPromptBlueprint(blueprint) };
}

const LEGAL_TRANSITIONS = Object.freeze({
  IDLE: ["UNDERSTANDING", "COMPANION_UNAVAILABLE"],
  UNDERSTANDING: ["TRANSLATING", "IDLE", "COMPANION_UNAVAILABLE"],
  TRANSLATING: ["PROMPT_READY", "IDLE", "COMPANION_UNAVAILABLE"],
  PROMPT_READY: ["RESPONSE_OBSERVER_ARMED", "OBSERVING", "IDLE", "COMPANION_UNAVAILABLE"],
  RESPONSE_OBSERVER_ARMED: ["NEW_ASSISTANT_TURN_DETECTED", "IDLE", "COMPANION_UNAVAILABLE"],
  NEW_ASSISTANT_TURN_DETECTED: [
    "STREAMING",
    "STABILIZING",
    "FINAL_RESPONSE_READY",
    "IDLE",
    "COMPANION_UNAVAILABLE",
  ],
  STREAMING: [
    "STABILIZING",
    "FINAL_RESPONSE_READY",
    "NEW_ASSISTANT_TURN_DETECTED",
    "OBSERVING",
    "VERIFYING",
    "IDLE",
    "COMPANION_UNAVAILABLE",
  ],
  STABILIZING: [
    "STREAMING",
    "FINAL_RESPONSE_READY",
    "NEW_ASSISTANT_TURN_DETECTED",
    "IDLE",
    "COMPANION_UNAVAILABLE",
  ],
  FINAL_RESPONSE_READY: ["VERIFYING", "STABILIZING", "IDLE", "COMPANION_UNAVAILABLE"],
  OBSERVING: ["STREAMING", "STABILIZING", "VERIFYING", "IDLE", "COMPANION_UNAVAILABLE"],
  VERIFYING: ["VERIFIED", "UNCERTAIN", "FAILED", "STABILIZING", "IDLE", "COMPANION_UNAVAILABLE"],
  VERIFIED: ["IDLE", "COMPANION_UNAVAILABLE"],
  UNCERTAIN: ["IDLE", "COMPANION_UNAVAILABLE"],
  FAILED: ["IDLE", "COMPANION_UNAVAILABLE"],
  COMPANION_UNAVAILABLE: ["IDLE"],
});

const TRUST_STATUSES = new Set(["VERIFIED", "UNCERTAIN", "FAILED"]);

function isSha256Digest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function noContentDetails() {
  return Object.freeze({
    contentTelemetry: false,
    historyRead: false,
    clipboardRead: false,
    screenRead: false,
    ocr: false,
    otherTabsRead: false,
  });
}

function manualResult(reason) {
  return Object.freeze({
    kind: COMPANION_STATUS.COMPANION_UNAVAILABLE,
    mode: "MANUAL",
    reason: String(reason),
    fallback: createManualFallback(reason),
    privacy: noContentDetails(),
  });
}

function errorResult(message) {
  return Object.freeze({
    kind: "ERROR",
    mode: "COMPANION",
    message: String(message),
    certified: false,
    privacy: noContentDetails(),
  });
}

function currentHealth(adapter) {
  try {
    return adapter.healthCheck();
  } catch {
    return manualResult("The site adapter health check failed");
  }
}

async function waitForFinal(adapter, options) {
  if (typeof adapter.waitForFinalResponse === "function") {
    return adapter.waitForFinalResponse(options);
  }
  // Contract-compatible fallback for a future adapter that has not yet
  // implemented the convenience method.  It still refuses streaming text.
  const started = Date.now();
  let sawStreaming = false;
  let previous = null;
  let stableSince = null;
  while (Date.now() - started <= (options.timeoutMs ?? 30_000)) {
    const observation = await adapter.observeResponse(options);
    if (observation?.streaming) sawStreaming = true;
    const capture = await adapter.captureFinalResponse(options);
    if (capture?.ok && capture.stable && capture.streaming === false) {
      if (capture.text !== previous) {
        previous = capture.text;
        stableSince = Date.now();
      }
      if (stableSince !== null && Date.now() - stableSince >= (options.stableMs ?? 500)) return capture;
    } else {
      previous = null;
      stableSince = null;
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 100));
  }
  return {
    ok: false,
    status: sawStreaming ? "STREAMING" : "NO_RESPONSE",
    certifiable: false,
    text: null,
  };
}

function projectionFor(certificate) {
  const summary = projectSummary(certificate);
  return Object.freeze({
    schema: "safi-companion-projection/v0.1",
    trustStatus: certificate.trustStatus,
    label: summary.labelLong,
    ariaLabel: summary.ariaLabel,
    responseSha256: certificate.responseSha256,
    separate: true,
  });
}

/**
 * Create the Phase 7 first vertical slice.
 *
 * @param {object} options
 * @param {import('./site-adapter.js').CompanionSiteAdapter} options.adapter
 * @param {{translate:Function, verify:Function}} options.safiClient existing shared client
 * @param {object} [options.permissions]
 * @param {(text:string)=>Promise<string>} [options.hashText]
 * @param {(translation:object)=>object} [options.renderPrompt] defaults to the Universal Prompt Composer
 */
export function createCompanionVerticalSlice({
  adapter,
  safiClient,
  permissions = createCompanionPermissions(),
  hashText = sha256Text,
  renderPrompt = composePromptFromTranslation,
  now = () => new Date().toISOString(),
  nowMs = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollMs = 120,
  stableMs = 400,
  requiredStableWindows = 2,
  observeTimeoutMs = 10 * 60_000,
  maxObserverTicks = 5_000,
} = {}) {
  assertCompanionSiteAdapter(adapter);
  if (!safiClient || typeof safiClient.translate !== "function" || typeof safiClient.verify !== "function") {
    throw new TypeError("Companion vertical slice requires an existing Safi client with translate() and verify()");
  }
  if (!permissions || typeof permissions.require !== "function") {
    throw new TypeError("Companion vertical slice requires a permission ledger");
  }

  let state = COMPANION_STATUS.IDLE;
  let prepared = null;
  let promptInserted = false;
  let lastCertificate = null;
  let observation = null;
  let observerLoop = null;
  let epochCounter = 0;
  const history = [];

  function transition(next) {
    if (next === state) return state;
    const allowed = LEGAL_TRANSITIONS[state] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(`Illegal Companion transition: ${state} → ${next}`);
    }
    state = next;
    history.push({ state: next, at: now() });
    return state;
  }

  function returnToIdle() {
    if (state !== COMPANION_STATUS.IDLE) transition(COMPANION_STATUS.IDLE);
  }

  function markUnavailable() {
    if (state === COMPANION_STATUS.COMPANION_UNAVAILABLE) return;
    const allowed = LEGAL_TRANSITIONS[state] ?? [];
    if (allowed.includes(COMPANION_STATUS.COMPANION_UNAVAILABLE)) {
      transition(COMPANION_STATUS.COMPANION_UNAVAILABLE);
      return;
    }
    returnToIdle();
    transition(COMPANION_STATUS.COMPANION_UNAVAILABLE);
  }

  function stopObserver() {
    if (observation) observation.stopped = true;
    observerLoop = null;
  }

  function resetForNewFlow() {
    stopObserver();
    returnToIdle();
    prepared = null;
    promptInserted = false;
    observation = null;
  }

  function publicObservation() {
    if (!observation) return null;
    return Object.freeze({
      epoch: observation.epoch,
      promptId: observation.promptId,
      armedAt: observation.armedAt,
      baselineTurns: Object.freeze([...observation.baselineTurns]),
      baselineCaptured: observation.baselineCaptured,
      baselineConversation: observation.baselineConversation,
      phase: observation.phase,
      turnKey: observation.turnKey,
      detectedAt: observation.detectedAt,
      sawStreaming: observation.sawStreaming,
      stableWindows: observation.stableWindows,
      aborted: observation.aborted,
      finalTextSha256: observation.finalTextSha256,
    });
  }

  /**
   * Arm the response observer immediately after the explicit insertion, not
   * when the user later presses the verification control.  The baseline turn
   * set, the baseline conversation state, the promptId and the observation
   * epoch are recorded here, so a fast turn that appears and completes in
   * under two seconds is still recognized as a *new* assistant turn.
   */
  function armResponseObserver() {
    let baseline = null;
    let baselineCaptured = false;
    try {
      if (permissions.isGranted(COMPANION_PERMISSIONS.RESPONSE_READ)) {
        baseline = adapter.observeResponse({ authorized: true, userGesture: true });
        // An empty conversation is a valid baseline: what matters is that the
        // adapter answered at all, not that a turn already exists.
        baselineCaptured = Boolean(baseline)
          && baseline.status !== "PERMISSION_REQUIRED"
          && baseline.status !== "COMPANION_UNAVAILABLE";
      }
    } catch {
      baseline = null;
      baselineCaptured = false;
    }
    epochCounter += 1;
    observation = {
      epoch: epochCounter,
      promptId: prepared?.promptId ?? null,
      armedAt: now(),
      baselineTurns: new Set(
        baseline?.ok && typeof baseline.responseKey === "string" && baseline.responseKey.length > 0
          ? [baseline.responseKey]
          : [],
      ),
      baselineCaptured,
      baselineConversation: baseline?.ok ? (baseline.responseKey ?? null) : null,
      baselineStreaming: baseline?.ok ? baseline.streaming === true : false,
      phase: COMPANION_STATUS.RESPONSE_OBSERVER_ARMED,
      turnKey: null,
      detectedAt: null,
      sawStreaming: false,
      stableWindows: 0,
      aborted: 0,
      finalText: null,
      finalTextSha256: null,
      stopped: false,
    };
    transition(COMPANION_STATUS.RESPONSE_OBSERVER_ARMED);
    startObserverLoop();
    return publicObservation();
  }

  function syncPhase() {
    if (observation) observation.phase = state;
  }

  function requireBaseline() {
    // Without a captured baseline a turn can never be proven new: refuse
    // rather than certify a pre-existing answer.
    return observation?.baselineCaptured === true;
  }

  async function tickObserver() {
    if (!observation || observation.stopped) return true;
    const options = { authorized: true, userGesture: true, stableMs, requiredStableWindows, now: nowMs };
    let current;
    try {
      current = adapter.observeResponse(options);
    } catch {
      markUnavailable();
      syncPhase();
      observation.stopped = true;
      return true;
    }
    if (!current?.ok) {
      if (state === COMPANION_STATUS.FINAL_RESPONSE_READY) {
        observation.stopped = true;
        return true;
      }
      syncPhase();
      return false;
    }
    const key = typeof current.responseKey === "string" && current.responseKey.length > 0
      ? current.responseKey
      : null;
    if (!requireBaseline()) {
      syncPhase();
      return false;
    }
    if (key && !observation.baselineTurns.has(key)) {
      if (observation.turnKey !== key) {
        observation.turnKey = key;
        observation.detectedAt = now();
        observation.finalText = null;
        observation.finalTextSha256 = null;
        try {
          adapter.resetStability?.();
        } catch {
          // An adapter without a stability window still re-verifies by hash.
        }
        if (state !== COMPANION_STATUS.FINAL_RESPONSE_READY) {
          transition(COMPANION_STATUS.NEW_ASSISTANT_TURN_DETECTED);
        }
      }
    } else if (observation.turnKey === null) {
      // Only the pre-existing turn is visible: keep waiting.
      syncPhase();
      return false;
    }
    if (current.streaming === true) {
      observation.sawStreaming = true;
      if (state !== COMPANION_STATUS.STREAMING && state !== COMPANION_STATUS.FINAL_RESPONSE_READY) {
        transition(COMPANION_STATUS.STREAMING);
      }
      syncPhase();
      return false;
    }
    let capture;
    try {
      capture = adapter.captureFinalResponse(options);
    } catch {
      markUnavailable();
      syncPhase();
      observation.stopped = true;
      return true;
    }
    if (capture?.status === "STREAMING" || capture?.streaming === true) {
      observation.sawStreaming = true;
      if (state !== COMPANION_STATUS.STREAMING && state !== COMPANION_STATUS.FINAL_RESPONSE_READY) {
        transition(COMPANION_STATUS.STREAMING);
      }
      syncPhase();
      return false;
    }
    if (
      capture?.ok === true
      && capture.stable === true
      && capture.streaming === false
      && capture.certifiable === true
      && typeof capture.text === "string"
      && capture.text.length > 0
    ) {
      observation.finalText = capture.text;
      observation.stableWindows = capture.stableWindows ?? requiredStableWindows;
      if (state !== COMPANION_STATUS.FINAL_RESPONSE_READY) transition(COMPANION_STATUS.FINAL_RESPONSE_READY);
      syncPhase();
      observation.stopped = true;
      return true;
    }
    observation.stableWindows = capture?.stableWindows ?? 0;
    if (state !== COMPANION_STATUS.STABILIZING && state !== COMPANION_STATUS.FINAL_RESPONSE_READY) {
      transition(COMPANION_STATUS.STABILIZING);
    }
    syncPhase();
    return false;
  }

  function startObserverLoop() {
    if (observerLoop) return observerLoop;
    observerLoop = (async () => {
      const startedAt = nowMs();
      let ticks = 0;
      while (observation && !observation.stopped && ticks < maxObserverTicks) {
        ticks += 1;
        if (nowMs() - startedAt > observeTimeoutMs) break;
        const finished = await tickObserver();
        if (finished) break;
        await sleep(pollMs);
      }
      observerLoop = null;
    })();
    return observerLoop;
  }

  async function awaitFinalState(timeoutMs) {
    const deadline = nowMs() + timeoutMs;
    let spins = 0;
    while (spins < maxObserverTicks) {
      spins += 1;
      if (state === COMPANION_STATUS.FINAL_RESPONSE_READY) return true;
      if (observation?.stopped) break;
      if (!observerLoop) startObserverLoop();
      await sleep(pollMs);
      if (nowMs() > deadline) break;
    }
    return state === COMPANION_STATUS.FINAL_RESPONSE_READY;
  }

  async function preparePrompt({ userGesture = false } = {}) {
    try {
      permissions.require(COMPANION_PERMISSIONS.COMPOSER_READ, { userGesture });
    } catch (error) {
      return manualResult(error instanceof Error ? error.message : String(error));
    }
    resetForNewFlow();
    const health = currentHealth(adapter);
    if (!health?.ok) {
      markUnavailable();
      return manualResult(health?.reason ?? "The current site DOM is not supported");
    }
    let captured;
    try {
      transition(COMPANION_STATUS.UNDERSTANDING);
      captured = await adapter.captureComposer({ authorized: true, userGesture: true });
    } catch {
      markUnavailable();
      return manualResult("The authorized composer could not be captured");
    }
    if (!captured?.ok || typeof captured.text !== "string" || captured.text.length === 0) {
      if (captured?.status === COMPANION_STATUS.COMPANION_UNAVAILABLE) markUnavailable();
      else returnToIdle();
      return manualResult(captured?.reason ?? "The authorized composer could not be captured");
    }
    try {
      transition(COMPANION_STATUS.TRANSLATING);
      const translation = await safiClient.translate({ message: captured.text });
      const translationInput = translation?.semantic ? translation : { semantic: translation };
      const composed = renderPrompt(translationInput);
      // The composer returns { blueprint, prompt }; a custom renderer may still
      // return the prompt alone, and the blueprint is then simply absent.
      const prompt = composed?.prompt ?? composed;
      const blueprint = composed?.blueprint ?? null;
      if (!prompt || typeof prompt.text !== "string" || prompt.text.length === 0) {
        returnToIdle();
        return errorResult("Safi produced no inspectable prompt");
      }
      if (prompt.originalMessage !== captured.text) {
        returnToIdle();
        return errorResult("The prompt projection did not preserve the original message");
      }
      const translated = prompt.text;
      const promptId = await hashText(`${captured.text}\u0000${translated}`);
      if (!isSha256Digest(promptId)) {
        returnToIdle();
        return errorResult("Safi could not identify the prepared prompt");
      }
      prepared = Object.freeze({
        promptId,
        original: captured.text,
        translated,
        prompt: Object.freeze({ ...prompt }),
        // Kept so the judge can compare the answer with what was *actually*
        // asked, instead of re-deriving the intent later.
        blueprint: blueprint ? Object.freeze({ ...blueprint }) : null,
        capturedAt: now(),
      });
      promptInserted = false;
      transition(COMPANION_STATUS.PROMPT_READY);
      return Object.freeze({
        kind: COMPANION_STATUS.PROMPT_READY,
        promptId,
        original: prepared.original,
        translated: prepared.translated,
        prompt: prepared.prompt,
        sent: false,
        automaticSend: false,
        privacy: noContentDetails(),
      });
    } catch {
      returnToIdle();
      return errorResult("Translation failed closed");
    }
  }

  async function usePreparedPrompt({ userGesture = false, promptId } = {}) {
    try {
      permissions.require(COMPANION_PERMISSIONS.COMPOSER_WRITE, { userGesture });
    } catch (error) {
      return manualResult(error instanceof Error ? error.message : String(error));
    }
    if (!prepared || state !== COMPANION_STATUS.PROMPT_READY || promptId !== prepared.promptId) {
      return errorResult("The prepared prompt is missing or stale; regenerate it before insertion");
    }
    if (promptInserted) {
      return errorResult("The prepared prompt was already inserted; start a new flow");
    }
    try {
      permissions.require(COMPANION_PERMISSIONS.COMPOSER_READ, { userGesture });
    } catch (error) {
      return manualResult(error instanceof Error ? error.message : String(error));
    }
    let current;
    try {
      current = await adapter.captureComposer({ authorized: true, userGesture: true });
    } catch {
      markUnavailable();
      return manualResult("The composer safety check failed");
    }
    if (!current?.ok || current.text !== prepared.original) {
      prepared = null;
      promptInserted = false;
      returnToIdle();
      return errorResult("The authorized composer changed; regenerate the prompt before insertion");
    }
    try {
      const inserted = await adapter.insertPrompt(prepared.translated, { authorized: true, userGesture: true });
      if (!inserted?.ok || inserted.status !== "PROMPT_INSERTED") {
        if (inserted?.status === COMPANION_STATUS.COMPANION_UNAVAILABLE) markUnavailable();
        return manualResult(inserted?.reason ?? "The site refused prompt insertion");
      }
      if (inserted.sendTriggered !== false) {
        markUnavailable();
        return errorResult("The site adapter did not prove that sending was disabled");
      }
      promptInserted = true;
      // The response observer is armed here, not when the user later presses
      // the verification control, so a fast turn is still recognized.
      const armed = armResponseObserver();
      return Object.freeze({
        kind: "PROMPT_INSERTED",
        promptId: prepared.promptId,
        textLength: prepared.translated.length,
        sent: false,
        automaticSend: false,
        next: "RESPONSE_OBSERVER_ARMED — the user must press the site's own send control",
        observer: armed,
        privacy: noContentDetails(),
      });
    } catch {
      markUnavailable();
      return errorResult("Prompt insertion failed closed");
    }
  }

  async function observeAndVerify({
    userGesture = false,
    timeoutMs = 30_000,
  } = {}) {
    try {
      permissions.require(COMPANION_PERMISSIONS.RESPONSE_READ, { userGesture });
    } catch (error) {
      return manualResult(error instanceof Error ? error.message : String(error));
    }
    if (!prepared || !promptInserted) {
      return errorResult("The explicit prompt insertion step has not completed");
    }
    const health = currentHealth(adapter);
    if (!health?.ok) {
      markUnavailable();
      return manualResult(health?.reason ?? "The current site DOM is not supported");
    }
    if (!observation) {
      return errorResult("The response observer is not armed; insert the prompt first");
    }
    if (state === COMPANION_STATUS.PROMPT_READY) transition(COMPANION_STATUS.RESPONSE_OBSERVER_ARMED);
    else if (
      state !== COMPANION_STATUS.RESPONSE_OBSERVER_ARMED
      && state !== COMPANION_STATUS.NEW_ASSISTANT_TURN_DETECTED
      && state !== COMPANION_STATUS.STREAMING
      && state !== COMPANION_STATUS.STABILIZING
      && state !== COMPANION_STATUS.FINAL_RESPONSE_READY
    ) {
      return errorResult("The Companion observation flow is not active");
    }
    await awaitFinalState(timeoutMs);
    if (state !== COMPANION_STATUS.FINAL_RESPONSE_READY || typeof observation?.finalText !== "string") {
      // No partial text is ever exposed on this path.
      return Object.freeze({
        kind: observation?.phase ?? state,
        certified: false,
        reason: "A new stable assistant response is not available yet",
        partialTextExposed: false,
        streamingCertified: false,
        observation: publicObservation(),
        privacy: noContentDetails(),
      });
    }
    return verifyAndProject();
  }

  /**
   * Verify the exact final text with the existing shared client, then re-capture
   * and re-hash the exact text *immediately before* the projection is attached.
   * If it changed, abort and return to STABILIZING instead of projecting.
   */
  async function verifyAndProject() {
    const finalText = observation.finalText;
    let exactHash;
    let certificate;
    let projection;
    try {
      transition(COMPANION_STATUS.VERIFYING);
      syncPhase();
      exactHash = await hashText(finalText);
      if (!isSha256Digest(exactHash)) {
        throw new Error("invalid response hash");
      }
      const outcome = await safiClient.verify({
        answer: finalText,
        providerId: adapter.id,
      });
      if (!outcome || outcome.kind !== "result" || !outcome.certificate) {
        throw new Error("missing certificate");
      }
      certificate = outcome.certificate;
      if (!TRUST_STATUSES.has(certificate.trustStatus)) {
        throw new Error("invalid trust status");
      }
      if (outcome.answer !== finalText || certificate.responseSha256 !== exactHash) {
        throw new Error("certificate does not bind the exact final response");
      }
      projection = projectionFor(certificate);
    } catch {
      returnToIdle();
      prepared = null;
      promptInserted = false;
      stopObserver();
      observation = null;
      return errorResult("Verification failed closed");
    }

    // Immediately before the projection: recapture the exact text, hash it
    // again, and abort to STABILIZING if anything moved.
    let reconfirmHash = null;
    try {
      const reconfirm = adapter.captureFinalResponse({
        authorized: true,
        userGesture: true,
        stableMs: 0,
        requiredStableWindows: 1,
        now: nowMs,
      });
      if (reconfirm?.ok && typeof reconfirm.text === "string") {
        reconfirmHash = await hashText(reconfirm.text);
      }
    } catch {
      reconfirmHash = null;
    }
    if (reconfirmHash !== exactHash) {
      observation.aborted += 1;
      observation.finalText = null;
      observation.finalTextSha256 = null;
      observation.stableWindows = 0;
      observation.stopped = false;
      try {
        adapter.resetStability?.();
      } catch {
        // The hash comparison below is the hard guard either way.
      }
      transition(COMPANION_STATUS.STABILIZING);
      syncPhase();
      startObserverLoop();
      return Object.freeze({
        kind: COMPANION_STATUS.STABILIZING,
        certified: false,
        aborted: true,
        reason: "The response changed immediately before the projection; returning to STABILIZING",
        partialTextExposed: false,
        streamingCertified: false,
        observation: publicObservation(),
        privacy: noContentDetails(),
      });
    }

    observation.finalTextSha256 = exactHash;
    lastCertificate = certificate;
    transition(certificate.trustStatus);

    // The reading of the answer, in this order and never the other way round:
    // truth has already been decided by the verifier above; what happens here
    // is the question the verifier does not answer — did it do the job, is
    // anything missing, and how do we say it to a person without changing what
    // the provider wrote. Each step is wrapped: a failure to *explain* an
    // answer must never destroy a certificate that is already valid.
    const intent = prepared?.original ?? "";
    let fulfillment = null;
    let claims = [];
    let human = null;
    try {
      fulfillment = judgeAnswer({ intent, blueprint: prepared?.blueprint ?? undefined, response: finalText });
    } catch {
      fulfillment = null;
    }
    try {
      claims = buildClaims({ response: finalText, claimEvidence: certificate?.claimEvidence });
      human = humanizeForConsumer({
        originalResponse: finalText,
        intent,
        verification: certificate,
        judge: fulfillment,
        claims,
        hashes: {
          originalResponseHash: exactHash,
          // Bound to the original so the two can never be confused later.
          safiHumanizedResponseHash: await hashText(human?.humanizedResponse ?? ""),
        },
      });
    } catch {
      claims = [];
      human = null;
    }
    const claimSummary = claimProfile(claims);
    let attached;
    try {
      attached = await adapter.attachProjection(projection, {
        authorized: true,
        userGesture: true,
        expectedResponseText: finalText,
      });
    } catch {
      attached = { ok: false, reason: "Projection attachment failed closed" };
    }
    if (!attached?.ok || attached.responseUnchanged !== true) {
      return Object.freeze({
        kind: "PROJECTION_UNAVAILABLE",
        certified: true,
        certificate,
        exactFinalText: finalText,
        exactFinalTextSha256: exactHash,
        streamingCertified: false,
        reason: attached?.reason ?? "The response was certified but no safe projection mount exists",
        responseUnchanged: attached?.responseUnchanged ?? false,
        observation: publicObservation(),
        privacy: noContentDetails(),
      });
    }
    return Object.freeze({
      kind: certificate.trustStatus,
      certified: true,
      certificate,
      exactFinalText: finalText,
      exactFinalTextSha256: exactHash,
      streamingCertified: false,
      responseUnchanged: true,
      projection,
      // Three different questions, three different owners. `certificate` is
      // truth; `fulfillment` is task quality and completeness; `human` is the
      // consumer reading, and is explicitly not evidence for either.
      fulfillment,
      claims,
      claimSummary,
      human,
      observation: publicObservation(),
      privacy: noContentDetails(),
    });
  }

  return Object.freeze({
    adapterId: adapter.id,
    provider: adapter.provider,
    getState() {
      return state;
    },
    getHistory() {
      return Object.freeze([...history]);
    },
    getPreparedPrompt() {
      return prepared;
    },
    getLastCertificate() {
      return lastCertificate;
    },
    getObservation() {
      return publicObservation();
    },
    disposeObserver() {
      stopObserver();
      observation = null;
      return true;
    },
    manualFallback(reason = "Manual mode is available") {
      return createManualFallback(reason);
    },
    preparePrompt,
    usePreparedPrompt,
    observeAndVerify,
  });
}

export const COMPANION_VERTICAL_SLICE_STATUS = "PHASE 7 VERTICAL SLICE — AWAITING HUMAN ACCEPTANCE";
