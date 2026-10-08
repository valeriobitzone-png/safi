/**
 * Companion motion layer — Phase 8B.
 *
 * This module is presentation only.  It knows about pixels, not about trust:
 * it never reads the provider's DOM, never decides a phase, never touches the
 * vertical slice, and never changes what a state means.  The Companion
 * lifecycle, the permission ledger, the mutation guard, the projection
 * contract and the Manual fallback are untouched by everything below.
 *
 * Three rules shape the whole design:
 *
 * 1.  **No layout change.**  `transform` and `opacity` are compositor-only
 *     properties: they never move a box, so the panel anchor arithmetic — the
 *     one thing that must not regress — cannot see them.  Nothing animates
 *     `width`, `height`, `top` or `left`.  The mascot and the sparkle are
 *     absolutely positioned, so they are out of flow and cannot resize the
 *     panel.
 *
 * 2.  **No polling.**  `syncFromState()` is called by the bridge when it
 *     already has a reason to look, plus from a `requestAnimationFrame` loop
 *     that exists only while one user action is in flight.  The loop reads a
 *     controller getter, not the DOM, and stops on its own.
 *
 * 3.  **Calm by default.**  One repeating animation in the entire layer (the
 *     armed ring), and only because that state is genuinely "waiting".
 *     Everything else is a single pass.
 */
import { SAFI_COMPANION_MASCOT_ASSETS } from "./mascot-assets.generated.js";

export { SAFI_COMPANION_MASCOT_ASSETS, SAFI_COMPANION_MASCOT_SOURCES } from "./mascot-assets.generated.js";

export const COMPANION_MOTION_STYLE_ID = "safi-companion-motion";
export const COMPANION_MOTION_SURFACE_ATTR = "data-safi-motion-surface";
export const COMPANION_MOTION_MASCOT_ATTR = "data-safi-motion-mascot";
export const COMPANION_MOTION_SPARKLE_ATTR = "data-safi-motion-sparkle";
export const COMPANION_MOTION_STREAM_ATTR = "data-safi-motion-stream";
export const COMPANION_MOTION_STATE_ATTR = "data-safi-state";
export const COMPANION_MOTION_MOUNTED_ATTR = "data-safi-mounted";

/**
 * The tokens the brief froze, in one place.  They are declared on the panel
 * and on the projection only, so a provider page cannot accidentally inherit
 * them and restyle its own content.
 */
export const COMPANION_MOTION_TOKENS = Object.freeze({
  "--safi-motion-fast": "140ms",
  "--safi-motion-normal": "200ms",
  "--safi-motion-slow": "320ms",
  "--safi-ease-out": "cubic-bezier(.2,.8,.2,1)",
  "--safi-ease-soft": "cubic-bezier(.22,.61,.36,1)",
});

/**
 * Which artwork each state draws.  Trust states intentionally reuse `idle`:
 * the glow and the transform carry the verdict, so a green/amber/red picture
 * is never the thing the user reacts to.
 */
export const COMPANION_MOTION_MASCOT_STATES = Object.freeze({
  IDLE: "idle",
  UNDERSTANDING: "idle",
  TRANSLATING: "translating",
  PROMPT_READY: "idle",
  RESPONSE_OBSERVER_ARMED: "idle",
  NEW_ASSISTANT_TURN_DETECTED: "idle",
  STREAMING: "idle",
  STABILIZING: "idle",
  FINAL_RESPONSE_READY: "idle",
  VERIFYING: "idle",
  VERIFIED: "idle",
  UNCERTAIN: "idle",
  FAILED: "idle",
  MANUAL: "idle",
});

const TOKENS_CSS = Object.entries(COMPANION_MOTION_TOKENS)
  .map(([name, value]) => `  ${name}: ${value};`)
  .join("\n");

const panel = "#safi-companion-live-panel";
const projection = '[data-safi-companion-projection]';

/**
 * The complete stylesheet.  It is returned as a string so it can be asserted
 * against in tests without a DOM, and so the exact same text runs in the
 * browser and in the fixture.
 */
export function buildCompanionMotionStylesheet() {
  return `
/* ── SAFI COMPANION · MOTION LAYER ──────────────────────────────────────────
   Presentation only.  transform + opacity only; no layout property is ever
   animated, so the collision anchor arithmetic is blind to this file. */
:where(${panel}, ${projection}) {
${TOKENS_CSS}
}

/* ── Appearance ────────────────────────────────────────────────────────────
   opacity on the panel (invisible to getBoundingClientRect), the lift on an
   inner surface.  200ms, ease-out, no overshoot and no bounce. */
${panel} { opacity: 0; }
${panel}[${COMPANION_MOTION_MOUNTED_ATTR}="true"] {
  opacity: 1;
  transition: opacity var(--safi-motion-normal) var(--safi-ease-out);
}
[${COMPANION_MOTION_SURFACE_ATTR}] {
  position: relative;
  transform: translateY(6px);
  transition: transform var(--safi-motion-normal) var(--safi-ease-out);
  will-change: transform;
}
${panel}[${COMPANION_MOTION_MOUNTED_ATTR}="true"] [${COMPANION_MOTION_SURFACE_ATTR}] {
  transform: translateY(0);
  will-change: auto;
}

/* ── Mascot ────────────────────────────────────────────────────────────────
   Absolutely positioned inside the surface: out of flow, so it cannot resize
   the panel, and pointer-transparent so it never intercepts a real click. */
[${COMPANION_MOTION_MASCOT_ATTR}] {
  position: absolute;
  top: 0;
  left: 0;
  width: 20px;
  height: 20px;
  pointer-events: none;
  transform-origin: 50% 50%;
  will-change: transform, opacity;
}
[${COMPANION_MOTION_MASCOT_ATTR}] > img { width: 100%; height: 100%; display: block; }
[${COMPANION_MOTION_SPARKLE_ATTR}] {
  position: absolute;
  top: 9px;
  left: 0;
  width: 18px;
  height: 2px;
  border-radius: 1px;
  background: linear-gradient(90deg, rgba(59, 130, 246, 0), rgba(59, 130, 246, .9));
  pointer-events: none;
  opacity: 0;
  transform-origin: 0 50%;
}

/* ── UNDERSTANDING · one soft breath, once ───────────────────────────────── */
@keyframes safi-motion-understanding {
  0%   { transform: scale(1); }
  45%  { transform: scale(.975); }
  100% { transform: scale(1); }
}
${panel}[${COMPANION_MOTION_STATE_ATTR}="UNDERSTANDING"] [${COMPANION_MOTION_MASCOT_ATTR}] {
  animation: safi-motion-understanding var(--safi-motion-slow) var(--safi-ease-soft) 1 both;
}

/* ── TRANSLATING · one blue spark across the figure, never a loop ────────── */
@keyframes safi-motion-sparkle {
  0%   { opacity: 0; transform: translateX(0) scaleX(.55); }
  28%  { opacity: .85; }
  100% { opacity: 0; transform: translateX(22px) scaleX(1); }
}
${panel}[${COMPANION_MOTION_STATE_ATTR}="TRANSLATING"] [${COMPANION_MOTION_SPARKLE_ATTR}] {
  animation: safi-motion-sparkle 380ms var(--safi-ease-out) 1 both;
}
${panel}[${COMPANION_MOTION_STATE_ATTR}="TRANSLATING"] [${COMPANION_MOTION_MASCOT_ATTR}] {
  /* the same one-shot breath, stretched across the spark: the figure keeps
     still-ish while the blue light crosses it */
  animation: safi-motion-understanding 380ms var(--safi-ease-soft) 1 both;
}

/* ── PROMPT_READY · the card arrives, plus one short spark ───────────────── */
@keyframes safi-motion-card-in {
  0%   { opacity: 0; transform: translateY(4px) scale(.985); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes safi-motion-card-spark {
  0%   { opacity: 0; transform: translateX(0) scaleX(.4); }
  35%  { opacity: .9; }
  100% { opacity: 0; transform: translateX(26px) scaleX(1); }
}
${panel}[${COMPANION_MOTION_STATE_ATTR}="PROMPT_READY"] [data-safi-live-role="ready-label"],
${panel}[${COMPANION_MOTION_STATE_ATTR}="PROMPT_READY"] [data-safi-live-role="translated"] {
  animation: safi-motion-card-in var(--safi-motion-slow) var(--safi-ease-out) 1 both;
}
${panel}[${COMPANION_MOTION_STATE_ATTR}="PROMPT_READY"] [data-safi-live-role="translated"] {
  position: relative;
}
${panel}[${COMPANION_MOTION_STATE_ATTR}="PROMPT_READY"] [data-safi-live-role="translated"]::after {
  content: "";
  position: absolute;
  top: 6px;
  left: 8px;
  width: 22px;
  height: 2px;
  border-radius: 1px;
  background: linear-gradient(90deg, rgba(59, 130, 246, 0), rgba(59, 130, 246, .9));
  pointer-events: none;
  animation: safi-motion-card-spark 320ms var(--safi-ease-out) 1 both;
}

/* ── RESPONSE_OBSERVER_ARMED · the one repeating animation in the layer ────
   A ring around the figure, pulsing between .35 and .7 over 2.1s. */
@keyframes safi-motion-armed-ring {
  0%, 100% { opacity: .35; }
  50%      { opacity: .7; }
}
${panel}[${COMPANION_MOTION_STATE_ATTR}="RESPONSE_OBSERVER_ARMED"] [${COMPANION_MOTION_MASCOT_ATTR}] {
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgba(59, 130, 246, .55);
  animation: safi-motion-armed-ring 2.1s var(--safi-ease-soft) infinite;
}

/* ── STREAMING · deliberately still ────────────────────────────────────────
   A pulsing indicator would compete with the answer being generated, and no
   state other than ARMED may loop.  Three low-contrast dots, fading in once. */
@keyframes safi-motion-stream-in {
  0%   { opacity: 0; transform: translateX(-2px); }
  100% { opacity: .45; transform: translateX(0); }
}
[${COMPANION_MOTION_STREAM_ATTR}] {
  position: absolute;
  top: 8px;
  left: 26px;
  display: flex;
  gap: 3px;
  pointer-events: none;
}
[${COMPANION_MOTION_STREAM_ATTR}] > i {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #6b7280;
}
${panel}[${COMPANION_MOTION_STATE_ATTR}="STREAMING"] [${COMPANION_MOTION_STREAM_ATTR}] {
  animation: safi-motion-stream-in var(--safi-motion-slow) var(--safi-ease-out) 1 both;
}

/* ── VERIFIED · one green arrival, ≤300ms ────────────────────────────────── */
@keyframes safi-motion-verified {
  0%   { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0);   transform: scale(1); }
  45%  { box-shadow: 0 0 10px 1px rgba(22, 163, 74, .75); transform: scale(1.025); }
  100% { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0);   transform: scale(1); }
}
${panel}[${COMPANION_MOTION_STATE_ATTR}="VERIFIED"] [${COMPANION_MOTION_MASCOT_ATTR}] {
  animation: safi-motion-verified 280ms var(--safi-ease-out) 1 both;
}

/* ── UNCERTAIN · one amber arrival, a barely perceptible tilt ────────────── */
@keyframes safi-motion-uncertain {
  0%   { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0);   transform: rotate(0deg); }
  50%  { box-shadow: 0 0 10px 1px rgba(217, 119, 6, .7); transform: rotate(1.5deg); }
  100% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0);   transform: rotate(0deg); }
}
${panel}[${COMPANION_MOTION_STATE_ATTR}="UNCERTAIN"] [${COMPANION_MOTION_MASCOT_ATTR}] {
  animation: safi-motion-uncertain 300ms var(--safi-ease-soft) 1 both;
}

/* ── FAILED · one two-pixel acknowledgement, never a shake ───────────────── */
@keyframes safi-motion-failed {
  0%   { transform: translateX(0); }
  30%  { transform: translateX(-2px); }
  60%  { transform: translateX(2px); }
  100% { transform: translateX(0); }
}
${panel}[${COMPANION_MOTION_STATE_ATTR}="FAILED"] [${COMPANION_MOTION_MASCOT_ATTR}] {
  animation: safi-motion-failed 260ms var(--safi-ease-soft) 1 both;
}

/* ── Projection beside the provider answer ─────────────────────────────────
   The projection may only fade and slide.  It must not push the provider's
   own content, so no box, position or size property is touched here. */
@keyframes safi-motion-projection-in {
  0%   { opacity: 0; transform: translateY(3px); }
  100% { opacity: 1; transform: translateY(0); }
}
${projection} {
  animation: safi-motion-projection-in var(--safi-motion-normal) var(--safi-ease-out) 1 both;
}

/* ── Reduced motion ────────────────────────────────────────────────────────
   Translation, scale, rotation, shake and every continuous animation stop.
   A very short opacity fade is kept, and a state change stays instant. */
@media (prefers-reduced-motion: reduce) {
  ${panel},
  ${panel}[${COMPANION_MOTION_MOUNTED_ATTR}="true"] {
    opacity: 1;
    transition: opacity 80ms linear;
  }
  [${COMPANION_MOTION_SURFACE_ATTR}],
  ${panel}[${COMPANION_MOTION_MOUNTED_ATTR}="true"] [${COMPANION_MOTION_SURFACE_ATTR}] {
    transform: none;
    transition: none;
    will-change: auto;
  }
  [${COMPANION_MOTION_MASCOT_ATTR}],
  ${projection} {
    animation: none;
    will-change: auto;
  }
  ${panel}[${COMPANION_MOTION_STATE_ATTR}]:is(
      [data-safi-state="UNDERSTANDING"],
      [data-safi-state="TRANSLATING"],
      [data-safi-state="PROMPT_READY"],
      [data-safi-state="RESPONSE_OBSERVER_ARMED"],
      [data-safi-state="STREAMING"],
      [data-safi-state="VERIFIED"],
      [data-safi-state="UNCERTAIN"],
      [data-safi-state="FAILED"]
    ) [${COMPANION_MOTION_MASCOT_ATTR}],
  ${panel}[${COMPANION_MOTION_STATE_ATTR}="PROMPT_READY"] [data-safi-live-role="ready-label"],
  ${panel}[${COMPANION_MOTION_STATE_ATTR}="PROMPT_READY"] [data-safi-live-role="translated"],
  ${panel}[${COMPANION_MOTION_STATE_ATTR}="PROMPT_READY"] [data-safi-live-role="translated"]::after,
  ${panel}[${COMPANION_MOTION_STATE_ATTR}="STREAMING"] [${COMPANION_MOTION_STREAM_ATTR}] {
    animation: none;
    opacity: 1;
    transform: none;
  }
  [${COMPANION_MOTION_SPARKLE_ATTR}] { display: none; }
}
`.trim();
}

/**
 * Install the stylesheet exactly once per document.  It lives in `<head>` so
 * it is outside the `<body>` subtree the existing anchor MutationObserver
 * watches, and it carries `data-safi-ignore` so the provider's own tooling
 * treats it as ours.
 */
export function installCompanionMotionStylesheet({ document: doc = globalThis.document } = {}) {
  if (!doc?.head?.appendChild || !doc?.createElement) return null;
  const existing = doc.getElementById?.(COMPANION_MOTION_STYLE_ID);
  if (existing) return existing;
  const style = doc.createElement("style");
  style.setAttribute("id", COMPANION_MOTION_STYLE_ID);
  style.setAttribute("data-safi-ignore", "true");
  style.textContent = buildCompanionMotionStylesheet();
  doc.head.appendChild(style);
  return style;
}

/**
 * Build the decorative parts of the panel.  Both nodes are absolutely
 * positioned and pointer-transparent, and neither is announced to assistive
 * technology: they are echoes of a state that is already reported in text.
 */
export function createCompanionMotionDecoration({ document: doc = globalThis.document } = {}) {
  if (!doc?.createElement) return null;
  const mascot = doc.createElement("span");
  mascot.setAttribute(COMPANION_MOTION_MASCOT_ATTR, "");
  mascot.setAttribute("aria-hidden", "true");
  mascot.setAttribute("data-safi-mascot-state", "idle");
  const image = doc.createElement("img");
  image.setAttribute("alt", "");
  image.setAttribute("decoding", "async");
  image.src = SAFI_COMPANION_MASCOT_ASSETS.idle;
  mascot.appendChild(image);

  const sparkle = doc.createElement("span");
  sparkle.setAttribute(COMPANION_MOTION_SPARKLE_ATTR, "");
  sparkle.setAttribute("aria-hidden", "true");

  const stream = doc.createElement("span");
  stream.setAttribute(COMPANION_MOTION_STREAM_ATTR, "");
  stream.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index += 1) stream.appendChild(doc.createElement("i"));

  return Object.freeze({ mascot, sparkle, stream });
}

/**
 * The presentation controller.  `setState` is the whole contract: it maps a
 * phase onto a `data-*` attribute and swaps artwork, and the stylesheet does
 * the rest.  It returns false when nothing changed, so callers can stay
 * quiet and the panel is never needlessly mutated.
 *
 * A phase with no motion mapping is *not* coerced into a known one: it is
 * recorded verbatim for diagnostics and simply matches no rule, so an
 * unfamiliar state shows a still panel rather than a wrong animation.
 */
export function createCompanionMotionController({ panel: panelEl, decoration } = {}) {
  let current = null;
  let currentArt = null;

  function setState(state) {
    const next = typeof state === "string" && state ? state : "IDLE";
    if (next === current) return false;
    current = next;
    panelEl?.setAttribute?.(COMPANION_MOTION_STATE_ATTR, next);
    panelEl?.setAttribute?.("data-safi-motion", COMPANION_MOTION_MASCOT_STATES[next] ? "mapped" : "unknown");
    const art = COMPANION_MOTION_MASCOT_STATES[next] ?? "idle";
    if (art !== currentArt) {
      currentArt = art;
      decoration?.mascot?.setAttribute?.("data-safi-mascot-state", art);
      const image = decoration?.mascot?.firstChild;
      if (image && SAFI_COMPANION_MASCOT_ASSETS[art]) image.src = SAFI_COMPANION_MASCOT_ASSETS[art];
    }
    return true;
  }

  function mount() {
    if (!panelEl?.setAttribute) return false;
    // A frame later, so the browser has a "before" value to transition from.
    const raf = globalThis.requestAnimationFrame ?? ((fn) => setTimeout(fn, 0));
    raf(() => panelEl.setAttribute(COMPANION_MOTION_MOUNTED_ATTR, "true"));
    return true;
  }

  /**
   * Would a phase on the figure actually be seen?  The panel scrolls its own
   * body when it grows, and a long panel can leave the figure outside the
   * visible box — motion nobody can see is not a cue, it is just a delay, so
   * the caller uses this to choose between playing a missed phase back and
   * landing on the truth at once.  Only the panel's own box and its own
   * figure are measured: nothing outside the Companion is read.
   */
  function isFigureVisible() {
    const mascot = panelEl?.querySelector?.(`[${COMPANION_MOTION_MASCOT_ATTR}]`);
    if (!mascot || !panelEl?.getBoundingClientRect) return false;
    const rect = mascot.getBoundingClientRect?.();
    if (!rect) return false;
    const top = panelEl.getBoundingClientRect().top + (panelEl.clientTop || 0);
    return rect.bottom > top && rect.top < top + (panelEl.clientHeight || 0);
  }

  return Object.freeze({
    setState,
    mount,
    isFigureVisible,
    getState: () => current,
    getMascotState: () => currentArt,
  });
}

export const COMPANION_MOTION_LAYER_STATUS = "PHASE 8B COMPANION MOTION — AWAITING MOTION APPROVAL";
