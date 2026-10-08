/**
 * Browser page bridge for the Phase 7 Companion.
 *
 * This module owns only page wiring and the small Companion surface.  It does
 * not translate, verify, hash, or decide trust: those remain in the existing
 * renderer/client/vertical-slice/Core paths.
 */
import {
  COMPANION_PERMISSIONS,
  COMPANION_STATUS,
  createCompanionPermissions,
  createManualFallback,
  sha256Text,
} from "./site-adapter.js";
import { ChatGPTSiteAdapter } from "./chatgpt-site-adapter.js";
import { createCompanionVerticalSlice } from "./vertical-slice.js";
import {
  COMPANION_MOTION_SURFACE_ATTR,
  createCompanionMotionController,
  createCompanionMotionDecoration,
  installCompanionMotionStylesheet,
} from "./motion-layer.js";

const PANEL_ID = "safi-companion-live-panel";
const ALL_PERMISSIONS = Object.freeze(Object.values(COMPANION_PERMISSIONS));

/**
 * P7-LIVE-3 — deterministic panel collision avoidance.
 *
 * The Companion panel must never cover the site's send control, its stop
 * control, or the composer itself.  The anchors below are tried in order and
 * the first one whose box does not intersect any critical control box wins;
 * if every anchor collides, the one with the smallest overlap area wins, so
 * the result is always deterministic and never depends on a manual nudge.
 */
export const PANEL_ANCHORS = Object.freeze([
  Object.freeze({ id: "top-right", top: "16px", right: "16px" }),
  Object.freeze({ id: "top-left", top: "16px", left: "16px" }),
  Object.freeze({ id: "above-composer", top: "auto", right: "16px", aboveReserved: true }),
  Object.freeze({ id: "bottom-left", bottom: "16px", left: "16px" }),
  Object.freeze({ id: "top-center", top: "16px", left: "50%" }),
]);

/** Critical controls the panel may never cover. Specific, bounded selectors. */
export const PANEL_CRITICAL_SELECTORS = Object.freeze([
  '[data-testid="send-button"]',
  '[data-testid="stop-button"]',
  '[data-testid="composer-footer"]',
  "#composer-footer",
]);

function toBox(rect) {
  if (!rect) return null;
  const left = Number(rect.left);
  const top = Number(rect.top);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![left, top, width, height].every((value) => Number.isFinite(value))) return null;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

export function boxesIntersect(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function overlapArea(a, b) {
  if (!a || !b) return 0;
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

const MIN_PANEL_WIDTH = 240;
const MIN_PANEL_HEIGHT = 160;

function unionBox(boxes) {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.right));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function anchorPlacement(anchor, panel, viewport, reserved) {
  const gap = 16;
  const width = Math.max(0, Math.min(panel.width, viewport.width - gap * 2));
  let left;
  if (anchor.right != null) left = viewport.width - gap - width;
  else if (anchor.left === "50%") left = (viewport.width - width) / 2;
  else left = gap;

  let top;
  let maxHeight = Math.max(0, Math.min(panel.height, viewport.height - gap * 2));
  if (anchor.aboveReserved === true) {
    if (!reserved) {
      top = gap;
    } else {
      top = Math.max(gap, reserved.top - Math.min(panel.height, viewport.height - gap * 2) - gap);
      maxHeight = Math.max(0, reserved.top - gap - top);
    }
  } else if (anchor.bottom != null) {
    top = viewport.height - gap - maxHeight;
    if (reserved && reserved.bottom < viewport.height - gap) {
      top = reserved.bottom + gap;
      maxHeight = Math.max(0, viewport.height - gap - top);
    }
  } else {
    top = gap;
    if (reserved && reserved.top > gap) {
      maxHeight = Math.max(0, reserved.top - gap * 2);
    }
  }
  const height = Math.max(0, Math.min(maxHeight, viewport.height - gap - top));
  return { left, top, width, height, maxHeight: Math.round(height) };
}

/**
 * Pure resolver: given the panel size, the viewport and the critical control
 * boxes, return the anchor (and the fitted max height) that keeps the panel
 * clear of every critical control.  No DOM access, fully deterministic.
 */
export function resolvePanelAnchor({ panel, viewport, critical = [], anchors = PANEL_ANCHORS }) {
  const size = { width: panel?.width ?? 390, height: panel?.height ?? 720 };
  const view = { width: viewport?.width ?? 1280, height: viewport?.height ?? 800 };
  const boxes = critical
    .map((entry) => ({ id: entry?.id ?? "unknown", box: toBox(entry?.box) }))
    .filter((entry) => entry.box);
  const reserved = unionBox(boxes.map((entry) => entry.box));
  let best = null;
  for (const anchor of anchors) {
    const placement = anchorPlacement(anchor, size, view, reserved);
    const box = {
      left: placement.left,
      top: placement.top,
      right: placement.left + placement.width,
      bottom: placement.top + placement.height,
      width: placement.width,
      height: placement.height,
    };
    const collisions = boxes.filter((entry) => boxesIntersect(box, entry.box)).map((entry) => entry.id);
    const area = collisions.reduce((total, entry) => total + overlapArea(box, entry.box), 0);
    const usable = box.width >= MIN_PANEL_WIDTH && box.height >= MIN_PANEL_HEIGHT;
    const style = {
      top: anchor.top === "auto" ? `${placement.top}px` : anchor.top,
      right: anchor.right,
      left: anchor.left,
      bottom: anchor.bottom,
    };
    const candidate = Object.freeze({
      anchor: anchor.id,
      box: Object.freeze(box),
      maxHeight: placement.maxHeight,
      collisions: Object.freeze(collisions),
      overlapArea: area,
      usable,
      style: Object.freeze(style),
    });
    if (collisions.length === 0 && usable) return candidate;
    if (!best || area < best.overlapArea) best = candidate;
  }
  return best;
}

/** Collect the critical control boxes in the current document (bounded). */
export function collectCriticalControls(doc, view, selectors = PANEL_CRITICAL_SELECTORS) {
  const controls = [];
  for (const selector of selectors) {
    let nodes = [];
    try {
      nodes = [...(doc?.querySelectorAll?.(selector) ?? [])];
    } catch {
      nodes = [];
    }
    for (const node of nodes) {
      const rect = toBox(node.getBoundingClientRect?.());
      if (rect) controls.push({ id: selector, box: rect });
    }
  }
  const win = view ?? doc?.defaultView ?? null;
  const width = win?.innerWidth ?? doc?.documentElement?.clientWidth ?? 1280;
  const height = win?.innerHeight ?? doc?.documentElement?.clientHeight ?? 800;
  return { controls, viewport: { width, height } };
}

function nodeDescriptor(node) {
  if (!node) return null;
  const read = (name) => {
    try {
      return node.getAttribute?.(name) ?? null;
    } catch {
      return null;
    }
  };
  return Object.freeze({
    tagName: String(node.tagName ?? "").toLowerCase() || null,
    role: read("role"),
    dataTestId: read("data-testid"),
    dataMessageAuthorRole: read("data-message-author-role"),
  });
}

function safeText(value) {
  return value == null ? "" : String(value);
}

/**
 * Install the minimal in-page bridge.  The returned API is intentionally
 * command-driven: no permission is granted and no DOM content is captured
 * until a human gesture calls one of the explicit methods.
 */
export function installCompanionPage({
  adapter,
  document: doc = globalThis.document,
  window: win = globalThis.window,
  location: loc = doc?.location ?? win?.location,
  safiClient,
  permissions = createCompanionPermissions(),
} = {}) {
  if (!doc?.body || !doc?.createElement) throw new Error("Companion browser bridge requires the current document");
  if (!safiClient || typeof safiClient.translate !== "function" || typeof safiClient.verify !== "function") {
    throw new Error("Companion browser bridge requires the existing Safi client");
  }
  if (!adapter || typeof adapter.detect !== "function" || typeof adapter.id !== "string") {
    throw new Error("Companion browser bridge requires a site adapter");
  }
  // The collision engine is parameterized by the adapter: the provider decides
  // which controls are critical, the host only places the panel.
  const criticalSelectors = Array.isArray(adapter.criticalSelectors) && adapter.criticalSelectors.length > 0
    ? adapter.criticalSelectors
    : PANEL_CRITICAL_SELECTORS;

  const slice = createCompanionVerticalSlice({ adapter, safiClient, permissions, hashText: sha256Text });
  const runtimeErrors = [];
  const accessAudit = [];
  const panelMutations = [];
  let lastResult = null;
  let mounted = false;
  let lastPanelDecision = null;
  // The motion layer is presentation only: it mirrors the phase the vertical
  // slice already decided and never influences it.  Nothing below reads a
  // pixel back out of the provider page.
  let motion = null;
  let motionAppliedAt = 0;

  /**
   * How long a phase must stay on screen before the next one is shown.  On a
   * fast provider the whole UNDERSTANDING → TRANSLATING leg can finish inside
   * a single frame, and an entrance nobody can see is not motion, it is a
   * missing cue.  One `--safi-motion-fast` is the shortest hold that still
   * reads as deliberate.  This delays nothing: the slice, the ledger, the
   * capture and the observer all move on their own schedule; only the panel's
   * attribute waits.
   */
  const MOTION_MIN_HOLD_MS = 140;

  const nowMs = () => (typeof win?.performance?.now === "function" ? win.performance.now() : Date.now());

  function setMotionState(state) {
    if (!motion) return false;
    const changed = motion.setState(state);
    if (changed) motionAppliedAt = nowMs();
    return changed;
  }

  /**
   * The phases one action went through that the panel never had a frame to
   * show.  The slice records every transition it makes; a fast provider can
   * finish UNDERSTANDING → TRANSLATING → PROMPT_READY between two frames, and
   * an entrance nobody can see is not motion, it is a missing cue.  So the
   * panel plays back only the run of phases that arrived faster than a single
   * motion token, skipping the ones already on screen.  The last entry is the
   * phase the slice ended on, and showing it once here is what the panel would
   * have shown had the leg taken its time — the caller then confirms it, which
   * for that same phase is a no-op rather than a second entrance.
   */
  function phasesMissedSince(startIndex, shown) {
    const history = slice.getHistory?.() ?? [];
    const missed = [];
    for (let index = Math.max(0, startIndex); index < history.length; index += 1) {
      const entry = history[index];
      const previous = history[index - 1];
      // The first phase that had time on screen was seen; the slice paced
      // everything after it itself, so the walk stops there.
      if (previous && entry.at - previous.at >= MOTION_MIN_HOLD_MS) break;
      if (!shown.has(entry.state)) missed.push(entry.state);
    }
    return missed;
  }

  /**
   * Play recorded phases back on the frame clock, one motion token each, then
   * hand the panel back to the truth.  This runs only after the operation it
   * describes is already complete, on frames like everything else here, and
   * it walks exactly the list it is given — it never invents a phase and
   * never re-shows one.
   */
  function replayMotion(raf, phases, done) {
    if (!raf || !phases.length) return done();
    let index = 0;
    let since = nowMs();
    const step = () => {
      if (nowMs() - since < MOTION_MIN_HOLD_MS) {
        raf(step);
        return;
      }
      since = nowMs();
      setMotionState(phases[index]);
      index += 1;
      if (index < phases.length) raf(step);
      else done();
    };
    raf(step);
    return undefined;
  }

  function applyPanelAnchor(panel) {
    if (!panel) return null;
    const rect = panel.getBoundingClientRect?.();
    const { controls, viewport } = collectCriticalControls(doc, win, criticalSelectors);
    const decision = resolvePanelAnchor({
      panel: { width: rect?.width || 390, height: rect?.height || 720 },
      viewport,
      critical: controls,
    });
    panel.style.top = decision.style.top ?? "";
    panel.style.right = decision.style.right ?? "";
    panel.style.left = decision.style.left ?? "";
    panel.style.bottom = decision.style.bottom ?? "";
    if (decision.maxHeight > 0) panel.style.maxHeight = `${decision.maxHeight}px`;
    panel.setAttribute("data-safi-anchor", decision.anchor);
    panel.setAttribute("data-safi-collisions", decision.collisions.join(","));
    lastPanelDecision = decision;
    return decision;
  }

  /**
   * Mirror the canonical lifecycle onto the panel for the duration of one
   * user action.  The loop reads a controller getter, never the DOM, exists
   * only while an action is in flight, and stops on its own — there is no
   * permanent poller and no timer left running after the user is done.
   */
  async function withMotionMirror(run) {
    if (!motion) return run();
    // Frames are the only clock here.  Where a frame callback exists we walk
    // it; where it does not there is simply no hold and the phase lands on
    // whatever the slice says, which is still the correct behaviour.
    const raf = typeof win?.requestAnimationFrame === "function" ? win.requestAnimationFrame.bind(win) : null;
    const startIndex = slice.getHistory?.().length ?? 0;
    const shown = new Set();
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      // Hold the current phase for a beat before adopting the next one, so a
      // sub-frame transition still gets its entrance.  No timer is involved:
      // the next frame simply tries again.
      const phase = slice.getState();
      if (nowMs() - motionAppliedAt >= MOTION_MIN_HOLD_MS && setMotionState(phase)) shown.add(phase);
      raf?.(tick);
    };
    if (raf) raf(tick);
    try {
      return await run();
    } finally {
      stopped = true;
      // The action is over and nothing about it is delayed.  Phases that ran
      // faster than a frame are shown now, in the order the slice took them,
      // and the panel lands on the real final phase when the last one lands.
      // They are only played back if the figure is on screen to play them: a
      // long panel scrolls its own body, and a cue nobody can see would just
      // hold the real answer back.
      const missed = phasesMissedSince(startIndex, shown);
      if (raf && missed.length && motion.isFigureVisible?.()) replayMotion(raf, missed, () => setMotionState(slice.getState()));
      else setMotionState(slice.getState());
    }
  }

  function recordError(phase, error) {
    runtimeErrors.push({
      phase,
      message: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
    });
  }

  function recordAccess(resource, operation, { authorized = true, contentRead = false, node = null } = {}) {
    accessAudit.push(Object.freeze({
      resource,
      operation,
      authorized,
      contentRead,
      node: nodeDescriptor(node),
      at: new Date().toISOString(),
    }));
  }

  function el(tag, attrs = {}, text = "") {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text) node.textContent = text;
    return node;
  }

  function ensurePanel() {
    if (mounted) return doc.getElementById(PANEL_ID);
    mounted = true;
    const panel = el("aside", {
      id: PANEL_ID,
      "data-safi-companion-live": "true",
      role: "region",
      "aria-label": "Safi Companion",
    });
    panel.style.cssText = [
      "position:fixed",
      "z-index:2147483646",
      "width:min(390px,calc(100vw - 32px))",
      "max-height:min(72vh,720px)",
      "overflow:auto",
      "padding:16px",
      "border:1px solid #6b6b6b",
      "border-radius:12px",
      "background:#fff",
      "color:#171717",
      "font:14px/1.4 system-ui,sans-serif",
      "box-shadow:0 12px 36px rgba(0,0,0,.22)",
    ].join(";");

    const heading = el("div", { "data-safi-live-role": "heading" }, `✦ SAFI COMPANION · ${adapter.provider}`);
    heading.style.cssText = "font-weight:700;letter-spacing:.04em;margin-bottom:10px";
    const status = el("div", { "data-safi-live-role": "status", role: "status" }, "Permessi non concessi");
    status.style.cssText = "padding:8px;border:1px solid #aaa;margin-bottom:10px";

    const permissionBox = el("div", { "data-safi-live-role": "permissions" });
    permissionBox.style.cssText = "display:grid;gap:6px;margin-bottom:10px";
    for (const permission of ALL_PERMISSIONS) {
      const row = el("div", { "data-safi-permission": permission });
      row.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px";
      const label = el("span", {}, permission);
      const actions = el("span");
      const grant = el("button", { type: "button", "data-safi-action": `grant:${permission}` }, "Concedi");
      const revoke = el("button", { type: "button", "data-safi-action": `revoke:${permission}` }, "Revoca");
      grant.addEventListener("click", () => {
        try {
          permissions.grant(permission, { userGesture: true });
          status.textContent = `${permission}: concesso`;
        } catch (error) {
          recordError(`grant:${permission}`, error);
          status.textContent = `Permesso non concesso: ${permission}`;
        }
      });
      revoke.addEventListener("click", () => {
        try {
          permissions.revoke(permission);
          status.textContent = `${permission}: revocato`;
        } catch (error) {
          recordError(`revoke:${permission}`, error);
          status.textContent = `Revoca non riuscita: ${permission}`;
        }
      });
      actions.append(grant, doc.createTextNode(" "), revoke);
      row.append(label, actions);
      permissionBox.append(row);
    }

    const originalLabel = el("div", { "data-safi-live-role": "original-label" }, "TU");
    originalLabel.style.cssText = "font-weight:700;margin-top:8px";
    const original = el("pre", { "data-safi-live-role": "original" });
    original.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 10px;padding:8px;background:#f4f4f4";
    const readyLabel = el("div", { "data-safi-live-role": "ready-label" }, "✦ PROMPT PRONTO");
    readyLabel.style.cssText = "font-weight:700;margin-top:8px";
    const translated = el("pre", { "data-safi-live-role": "translated" });
    translated.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 10px;padding:8px;background:#f4f4f4";

    const capture = el("button", { type: "button", "data-safi-action": "capture" }, "Cattura e traduci");
    const use = el("button", { type: "button", "data-safi-action": "use-prompt" }, "Usa questo prompt");
    const observe = el("button", { type: "button", "data-safi-action": "observe" }, "Osserva e verifica");
    use.disabled = true;
    observe.disabled = true;
    const actions = el("div", { "data-safi-live-role": "actions" });
    actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    actions.append(capture, use, observe);
    const result = el("pre", { "data-safi-live-role": "result" }, "In attesa");
    result.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;margin-top:10px;padding:8px;border:1px solid #aaa";
    // The compact reading of an answer, and the technical record behind it.
    // Progressive disclosure: the card is what a person reads, the disclosure
    // is where the certificate, the claims and the hashes live.
    const humanCard = el("div", { "data-safi-live-role": "human-card" });
    humanCard.style.cssText = "margin-top:10px;padding:10px;border:1px solid #6b6b6b;border-radius:8px;white-space:pre-wrap;overflow-wrap:anywhere";
    const details = el("details", { "data-safi-live-role": "details" });
    details.append(el("summary", {}, "Dettagli"), result);
    function showResult(next) {
      result.textContent = JSON.stringify(next, null, 2);
      const card = next?.human?.card?.text;
      humanCard.textContent = card ?? "";
      humanCard.hidden = !card;
      details.hidden = !card;
      if (card) details.open = false;
      return card;
    }

    heading.style.cssText = "font-weight:700;letter-spacing:.04em;margin-bottom:10px;padding-left:26px";

    // The motion surface is a plain block wrapper: it is transparent to the
    // panel's own layout (no padding, border or display change of its own), so
    // the panel box measured by the anchor engine is byte-identical to before.
    // The lift lives on this node, never on the `aside`, because a transform on
    // the anchored element would move the rect the engine measures.
    const surface = el("div", { [COMPANION_MOTION_SURFACE_ATTR]: "" });
    surface.append(heading, status, permissionBox, originalLabel, original, readyLabel, translated, actions, humanCard, details);

    const decoration = createCompanionMotionDecoration({ document: doc });
    if (decoration) surface.append(decoration.mascot, decoration.sparkle, decoration.stream);
    panel.append(surface);
    doc.body.append(panel);

    installCompanionMotionStylesheet({ document: doc });
    motion = createCompanionMotionController({ panel, decoration });
    setMotionState(slice.getState());
    motion.mount();

    applyPanelAnchor(panel);
    if (typeof win?.addEventListener === "function") {
      win.addEventListener("resize", () => applyPanelAnchor(panel), { passive: true });
    }
    if (typeof win?.MutationObserver === "function" && doc?.body) {
      // Re-anchor when the site adds or moves a send/stop control.
      const observer = new win.MutationObserver(() => applyPanelAnchor(panel));
      observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "aria-label"] });
      panelMutations.push(observer);
    }

    capture.addEventListener("click", async () => {
      status.textContent = "UNDERSTANDING";
      try {
        const next = await withMotionMirror(() => api.preparePrompt());
        lastResult = next;
        showResult(next);
        if (next.kind === COMPANION_STATUS.PROMPT_READY) {
          original.textContent = next.original;
          translated.textContent = next.translated;
          use.disabled = false;
          status.textContent = COMPANION_STATUS.PROMPT_READY;
        } else {
          status.textContent = next.kind;
        }
      } catch (error) {
        recordError("preparePrompt", error);
        status.textContent = "Errore fail-closed";
      }
    });

    use.addEventListener("click", async () => {
      const prepared = slice.getPreparedPrompt();
      try {
        const next = await withMotionMirror(() => api.usePrompt(prepared?.promptId));
        lastResult = next;
        showResult(next);
        status.textContent = next.kind === "PROMPT_INSERTED" ? "Prompt inserito — NON inviato" : next.kind;
        if (next.kind === "PROMPT_INSERTED") observe.disabled = false;
      } catch (error) {
        recordError("usePrompt", error);
        status.textContent = "Errore fail-closed";
      }
    });

    observe.addEventListener("click", async () => {
      status.textContent = "OBSERVING";
      try {
        const next = await withMotionMirror(() => api.observeAndVerify());
        lastResult = next;
        showResult(next);
        status.textContent = next.kind;
      } catch (error) {
        recordError("observeAndVerify", error);
        status.textContent = "Errore fail-closed";
      }
    });

    return panel;
  }

  async function preparePrompt() {
    ensurePanel();
    const result = await slice.preparePrompt({ userGesture: true });
    if (result.kind === COMPANION_STATUS.PROMPT_READY) {
      const resolution = adapter._resolve();
      recordAccess("composer", "captureComposer", { contentRead: true, node: resolution.composer });
    } else if (result.mode === "MANUAL") {
      recordAccess("none", "manualFallback", { authorized: false, contentRead: false });
    }
    return result;
  }

  async function usePrompt(promptId = slice.getPreparedPrompt()?.promptId) {
    ensurePanel();
    const result = await slice.usePreparedPrompt({ userGesture: true, promptId });
    if (result.kind === "PROMPT_INSERTED") {
      const resolution = adapter._resolve();
      recordAccess("composer", "insertPrompt", { contentRead: false, node: resolution.composer });
    }
    return result;
  }

  async function observeAndVerify(options = {}) {
    ensurePanel();
    const result = await slice.observeAndVerify({ userGesture: true, ...options });
    if (result.kind === COMPANION_STATUS.STREAMING) {
      const resolution = adapter._resolve();
      recordAccess("response", "streamingObserve", { contentRead: false, node: resolution.assistant });
    } else if (result.certified === true) {
      const resolution = adapter._resolve();
      recordAccess("response", "captureFinalResponse", { contentRead: true, node: resolution.content });
      const projection = doc.querySelector('[data-safi-companion-projection="chatgpt"]');
      recordAccess("safi-projection", "attachProjection", { contentRead: false, node: projection });
    }
    return result;
  }

  function runFailClosedProbe() {
    const detached = doc.implementation?.createHTMLDocument?.("Safi fail-closed probe");
    if (!detached) return { ok: false, status: "PROBE_UNAVAILABLE" };
    const probe = new ChatGPTSiteAdapter({
      document: detached,
      window: win,
      location: { hostname: loc?.hostname ?? "chatgpt.com" },
    });
    const health = probe.healthCheck();
    const fallback = createManualFallback(health.reason ?? "Intentionally incompatible DOM");
    recordAccess("none", "failClosedProbe", { authorized: false, contentRead: false });
    return { ok: health.ok === false && health.status === COMPANION_STATUS.COMPANION_UNAVAILABLE, health, fallback };
  }

  async function verifyRuntimeRevocation() {
    ensurePanel();
    const snapshot = permissions.snapshot();
    const results = {};
    for (const permission of ALL_PERMISSIONS) permissions.revoke(permission);
    const preparedId = slice.getPreparedPrompt()?.promptId;
    results.composerRead = (await slice.preparePrompt({ userGesture: true })).mode === "MANUAL";
    results.composerWrite = (await slice.usePreparedPrompt({ userGesture: true, promptId: preparedId })).mode === "MANUAL";
    results.responseRead = (await slice.observeAndVerify({ userGesture: true, timeoutMs: 1 })).mode === "MANUAL";
    for (const [permission, value] of Object.entries(snapshot.granted)) permissions.grant(permission, { userGesture: true });
    return Object.freeze({ revoked: Object.keys(results), deniedImmediately: Object.values(results).every(Boolean), results });
  }

  const api = Object.freeze({
    adapter,
    controller: slice,
    permissions,
    // The shared client is exposed read-only for acceptance diagnostics: the
    // Companion never calls it directly, the controller does.
    safiClient,
    ensurePanel,
    preparePrompt,
    usePrompt,
    observeAndVerify,
    runFailClosedProbe,
    verifyRuntimeRevocation,
    getPanelDecision() {
      return lastPanelDecision;
    },
    refreshPanelPosition() {
      return applyPanelAnchor(doc?.getElementById?.(PANEL_ID) ?? null);
    },
    dispose() {
      for (const observer of panelMutations.splice(0)) {
        try {
          observer.disconnect();
        } catch {
          // Nothing else to do: the panel is going away with the document.
        }
      }
      return true;
    },
    getLastResult: () => lastResult,
    getRuntimeErrors: () => Object.freeze([...runtimeErrors]),
    /** Presentation-only diagnostics for the motion acceptance pass. */
    getMotionState: () => motion?.getState() ?? null,
    getMotionMascotState: () => motion?.getMascotState() ?? null,
    getAccessAudit: () => Object.freeze([...accessAudit]),
    async acceptanceSnapshot({ includeText = true } = {}) {
      const result = lastResult ?? {};
      const prepared = slice.getPreparedPrompt();
      const certificate = result.certificate ?? slice.getLastCertificate();
      const originalInputSha256 = prepared ? await sha256Text(prepared.original) : null;
      const translatedPromptSha256 = prepared ? await sha256Text(prepared.translated) : null;
      const projectionNode = doc.querySelector('[data-safi-companion-projection="chatgpt"]');
      return {
        domain: loc?.hostname ?? null,
        permissions: permissions.snapshot(),
        adapterHealth: adapter.healthCheck(),
        originalInputSha256,
        translatedPromptSha256,
        autoSend: false,
        streamingCertified: result.streamingCertified === true,
        capturedFinalText: includeText && typeof result.exactFinalText === "string" ? result.exactFinalText : null,
        finalResponseSha256: result.exactFinalTextSha256 ?? certificate?.responseSha256 ?? null,
        certificateContentHash: certificate?.responseSha256 ?? null,
        certificateHashMatch: Boolean(certificate && result.exactFinalTextSha256 === certificate.responseSha256),
        mutationGuard: "exact response reconfirmed before verification and projection",
        projectionSeparated: result.projection?.separate === true || Boolean(projectionNode),
        manualFallback: runFailClosedProbe(),
        runtimeErrors: Object.freeze([...runtimeErrors]),
        domAccess: Object.freeze([...accessAudit]),
        observation: slice.getObservation(),
        panel: lastPanelDecision
          ? Object.freeze({
            anchor: lastPanelDecision.anchor,
            collisions: Object.freeze([...lastPanelDecision.collisions]),
            overlapArea: lastPanelDecision.overlapArea,
          })
          : null,
        status: `PHASE 8 COMPANION (${adapter.provider}) — LIVE ACCEPTANCE PENDING`,
      };
    },
  });

  ensurePanel();
  return api;
}

/**
 * Backwards-compatible ChatGPT entry point.  It only supplies the ChatGPT
 * adapter; everything else is the shared, provider-neutral host.
 */
export function installChatGPTCompanion(options = {}) {
  const {
    document: doc = globalThis.document,
    window: win = globalThis.window,
    location: loc = doc?.location ?? win?.location,
  } = options;
  return installCompanionPage({
    ...options,
    adapter: new ChatGPTSiteAdapter({ document: doc, window: win, location: loc }),
  });
}

export const COMPANION_BROWSER_BRIDGE_VERSION = "phase8/gemini/v0.1";
