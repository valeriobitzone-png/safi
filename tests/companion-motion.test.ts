// @vitest-environment node
/**
 * Phase 8B — the Companion motion layer.
 *
 * Motion is presentation only, so these tests are mostly about what the
 * stylesheet must NOT do: it must not animate a layout property, it must not
 * introduce a second continuous animation, and it must not be able to change
 * the panel box the collision engine measures.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  COMPANION_MOTION_LAYER_STATUS,
  COMPANION_MOTION_MASCOT_ATTR,
  COMPANION_MOTION_MASCOT_STATES,
  COMPANION_MOTION_SPARKLE_ATTR,
  COMPANION_MOTION_STATE_ATTR,
  COMPANION_MOTION_STREAM_ATTR,
  COMPANION_MOTION_SURFACE_ATTR,
  COMPANION_MOTION_TOKENS,
  SAFI_COMPANION_MASCOT_ASSETS,
  buildCompanionMotionStylesheet,
  createCompanionMotionController,
  createCompanionMotionDecoration,
  installCompanionMotionStylesheet,
} from "../packages/companion/index.js";

const CSS = buildCompanionMotionStylesheet();

/** every `@keyframes` body, so a layout property cannot hide in one */
function keyframeBodies(css: string): string[] {
  return [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)].map((match) => match[1]);
}

function selectorBlock(css: string, selector: string): string {
  const index = css.indexOf(selector);
  if (index === -1) return "";
  const open = css.indexOf("{", index);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  return "";
}

/** A document just rich enough for the stylesheet and decoration factories. */
function tinyDocument() {
  const made: any[] = [];
  const make = (tag: string) => {
    const node: any = {
      tagName: tag.toUpperCase(),
      attributes: {} as Record<string, string>,
      children: [] as any[],
      textContent: "",
      src: "",
      firstChild: null as any,
      setAttribute(key: string, value: string) {
        this.attributes[key] = String(value);
      },
      getAttribute(key: string) {
        return key in this.attributes ? this.attributes[key] : null;
      },
      appendChild(child: any) {
        child.parentNode = this;
        if (!this.firstChild) this.firstChild = child;
        this.children.push(child);
        return child;
      },
    };
    made.push(node);
    return node;
  };
  const head = make("head");
  const doc: any = {
    created: made,
    createElement: make,
    getElementById: (id: string) => made.find((node) => node.getAttribute("id") === id) ?? null,
  };
  head.appendChild = head.appendChild.bind(head);
  doc.head = head;
  return doc;
}

describe("Phase 8B — motion tokens", () => {
  it("freezes the tokens the brief specifies", () => {
    expect(COMPANION_MOTION_TOKENS).toEqual({
      "--safi-motion-fast": "140ms",
      "--safi-motion-normal": "200ms",
      "--safi-motion-slow": "320ms",
      "--safi-ease-out": "cubic-bezier(.2,.8,.2,1)",
      "--safi-ease-soft": "cubic-bezier(.22,.61,.36,1)",
    });
  });

  it("declares every token in the stylesheet", () => {
    for (const [name, value] of Object.entries(COMPANION_MOTION_TOKENS)) {
      expect(CSS).toContain(`${name}: ${value};`);
    }
  });

  it("scopes the tokens to Safi's own surfaces so the provider page is untouched", () => {
    const block = selectorBlock(CSS, ":where(#safi-companion-live-panel, [data-safi-companion-projection])");
    expect(block).toContain("--safi-motion-normal");
    expect(CSS).not.toMatch(/^\s*:root/m);
  });
});

describe("Phase 8B — layout is never animated", () => {
  it("animates no layout property inside any keyframe", () => {
    for (const body of keyframeBodies(CSS)) {
      expect(body).not.toMatch(/\b(width|height|top|left|right|bottom|margin|padding|inset)\s*:/);
    }
  });

  it("transitions no layout property on any selector", () => {
    for (const line of CSS.split("\n")) {
      if (!/transition|animation/.test(line)) continue;
      expect(line).not.toMatch(/\b(all|width|height|top|left|right|bottom|margin|padding|inset)\b/);
    }
  });

  it("keeps the lift on the inner surface, never on the anchored panel", () => {
    // A transform on the `aside` would move the rect `applyPanelAnchor` reads.
    const panelBlock = selectorBlock(CSS, `#safi-companion-live-panel { opacity: 0; }`);
    expect(panelBlock).not.toContain("transform");
    expect(panelBlock).not.toContain("translate");
    const surfaceBlock = selectorBlock(CSS, `[${COMPANION_MOTION_SURFACE_ATTR}] {`);
    expect(surfaceBlock).toContain("transform: translateY(6px)");
    // `position: relative` on a plain block wrapper changes no box of its own.
    expect(surfaceBlock).not.toMatch(/\b(padding|margin|border|width|height|display|box-sizing)\s*:/);
  });

  it("keeps every decoration out of flow and out of the hit area", () => {
    for (const attr of [COMPANION_MOTION_MASCOT_ATTR, COMPANION_MOTION_SPARKLE_ATTR, COMPANION_MOTION_STREAM_ATTR]) {
      const block = selectorBlock(CSS, `[${attr}] {`);
      expect(block).toContain("position: absolute");
      expect(block).toContain("pointer-events: none");
    }
  });

  it("gives the projection only an opacity and a transform entrance", () => {
    const block = selectorBlock(CSS, '[data-safi-companion-projection] {\n  animation: safi-motion-projection-in');
    expect(block).toContain("animation: safi-motion-projection-in");
    const body = keyframeBodies(CSS).find((text) => text.includes("safi-motion-projection-in") || text.includes("translateY(3px)")) ?? "";
    expect(body).toContain("opacity");
    expect(body).toContain("translateY");
    expect(body).not.toMatch(/\b(width|height|top|left|margin|padding)\s*:/);
  });
});

describe("Phase 8B — calm, not decorative", () => {
  it("allows exactly one repeating animation, and only for the armed state", () => {
    const infinite = CSS.match(/infinite/g) ?? [];
    expect(infinite).toHaveLength(1);
    const armed = CSS.slice(CSS.indexOf("safi-motion-armed-ring"));
    expect(armed.indexOf("infinite")).toBeGreaterThan(0);
  });

  it("pulsing on the ARMED ring stays between .35 and .7 over ~2s", () => {
    const body = keyframeBodies(CSS).find((text) => text.includes("opacity: .35")) ?? "";
    expect(body).toContain("0%, 100% { opacity: .35; }");
    expect(body).toContain("50%      { opacity: .7; }");
    const armed = CSS.slice(CSS.indexOf('[data-safi-state="RESPONSE_OBSERVER_ARMED"]'));
    expect(armed).toContain("2.1s");
  });

  it("gives STREAMING a still, low-contrast indicator that never loops", () => {
    const streaming = CSS.slice(CSS.indexOf('[data-safi-state="STREAMING"]'));
    expect(streaming).not.toContain("infinite");
    expect(CSS).toContain("safi-motion-stream-in");
    // three dots, never a strong pulse
    const dots = selectorBlock(CSS, `[${COMPANION_MOTION_STREAM_ATTR}] > i {`);
    expect(dots).toContain("background: #6b7280");
  });

  it("keeps every trust animation to a single pass", () => {
    for (const state of ["VERIFIED", "UNCERTAIN", "FAILED"]) {
      const block = CSS.slice(CSS.indexOf(`[data-safi-state="${state}"]`));
      const line = block.slice(0, block.indexOf("}") + 1);
      expect(line).toContain("1 both");
      expect(line).not.toContain("infinite");
    }
  });

  it("stays inside the brief's durations", () => {
    // The brief caps the translating spark at 450ms; every other pass is
    // expressed through a token, and the slowest token is 320ms.
    const durations = [...CSS.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)m?s/g)].map((match) => parseFloat(match[1]));
    expect(Math.max(...durations)).toBeLessThanOrEqual(450);
    const tokenTimes = Object.entries(COMPANION_MOTION_TOKENS)
      .filter(([name]) => name.startsWith("--safi-motion-"))
      .map(([, value]) => parseFloat(value));
    expect(Math.max(...tokenTimes)).toBeLessThanOrEqual(320);
  });

  it("never shakes harder than two pixels", () => {
    const failed = keyframeBodies(CSS).find((text) => text.includes("translateX(2px)")) ?? "";
    expect(failed).toContain("translateX(-2px)");
    expect(failed).not.toMatch(/translateX\(-?[3-9]/);
  });
});

describe("Phase 8B — reduced motion", () => {
  const reduced = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));

  it("exists and covers the whole layer", () => {
    expect(reduced.length).toBeGreaterThan(0);
    for (const attr of [COMPANION_MOTION_MASCOT_ATTR, COMPANION_MOTION_SPARKLE_ATTR, COMPANION_MOTION_SURFACE_ATTR]) {
      expect(reduced).toContain(attr);
    }
  });

  it("disables translation, scale, rotation, shake and every continuous animation", () => {
    expect(reduced).toContain("animation: none");
    expect(reduced).toContain("transform: none");
    expect(reduced).toContain("will-change: auto");
    expect(reduced).not.toContain("infinite");
  });

  it("keeps the panel visible and the state change instant", () => {
    expect(reduced).toContain("opacity: 1");
    // a very short fade, well under the fastest token
    expect(reduced).toMatch(/transition: opacity (?:[0-9]|[1-9][0-9])ms linear/);
  });
});

describe("Phase 8B — the decoration nodes", () => {
  it("builds an aria-hidden, inert mascot that draws approved artwork", () => {
    const decoration = createCompanionMotionDecoration({ document: tinyDocument() as never });
    expect(decoration!.mascot.getAttribute(COMPANION_MOTION_MASCOT_ATTR)).toBe("");
    expect(decoration!.mascot.getAttribute("aria-hidden")).toBe("true");
    expect(decoration!.mascot.getAttribute("data-safi-mascot-state")).toBe("idle");
    expect(decoration!.mascot.firstChild.src).toBe(SAFI_COMPANION_MASCOT_ASSETS.idle);
    expect(decoration!.sparkle.getAttribute("aria-hidden")).toBe("true");
    expect(decoration!.stream.children).toHaveLength(3);
  });

  it("uses the approved translating artwork for the translating figure", () => {
    expect(SAFI_COMPANION_MASCOT_ASSETS.translating).toMatch(/^data:image\/png;base64,/);
    expect(SAFI_COMPANION_MASCOT_ASSETS.idle).toMatch(/^data:image\/png;base64,/);
    expect(SAFI_COMPANION_MASCOT_ASSETS.translating).not.toBe(SAFI_COMPANION_MASCOT_ASSETS.idle);
  });

  it("never reuses a verdict picture — trust states share the calm idle figure", () => {
    for (const state of ["VERIFIED", "UNCERTAIN", "FAILED"]) {
      expect(COMPANION_MOTION_MASCOT_STATES[state]).toBe("idle");
    }
    expect(COMPANION_MOTION_MASCOT_STATES.TRANSLATING).toBe("translating");
  });
});

describe("Phase 8B — the motion controller", () => {
  function controller(decoration?: unknown) {
    const attrs: Record<string, string> = {};
    const panelEl: any = {
      setAttribute: (key: string, value: string) => {
        attrs[key] = String(value);
      },
      getAttribute: (key: string) => attrs[key] ?? null,
    };
    return { panelEl, attrs, motion: createCompanionMotionController({ panel: panelEl, decoration: decoration as never }) };
  }

  it("mirrors a phase onto the panel attribute", () => {
    const { attrs, motion } = controller();
    expect(motion.setState("PROMPT_READY")).toBe(true);
    expect(attrs[COMPANION_MOTION_STATE_ATTR]).toBe("PROMPT_READY");
    expect(motion.getState()).toBe("PROMPT_READY");
  });

  it("reports no change when the phase has not moved, so the panel is not churned", () => {
    const { motion } = controller();
    motion.setState("STREAMING");
    expect(motion.setState("STREAMING")).toBe(false);
  });

  it("shows a still panel for an unfamiliar phase rather than a wrong animation", () => {
    const { attrs, motion } = controller();
    motion.setState("NOT_A_PHASE");
    expect(attrs[COMPANION_MOTION_STATE_ATTR]).toBe("NOT_A_PHASE");
    expect(attrs["data-safi-motion"]).toBe("unknown");
    // an unmapped state matches no rule in the stylesheet
    expect(CSS).not.toContain('[data-safi-state="NOT_A_PHASE"]');
    expect(motion.getMascotState()).toBe("idle");
  });

  it("treats a missing phase as IDLE", () => {
    const { attrs, motion } = controller();
    motion.setState(undefined);
    expect(attrs[COMPANION_MOTION_STATE_ATTR]).toBe("IDLE");
    expect(motion.setState(undefined)).toBe(false);
  });

  it("swaps artwork on TRANSLATING and swaps back afterwards", () => {
    const decoration = createCompanionMotionDecoration({ document: tinyDocument() as never });
    const { motion } = controller(decoration);
    motion.setState("TRANSLATING");
    expect(motion.getMascotState()).toBe("translating");
    expect(decoration!.mascot.getAttribute("data-safi-mascot-state")).toBe("translating");
    expect(decoration!.mascot.firstChild.src).toBe(SAFI_COMPANION_MASCOT_ASSETS.translating);
    motion.setState("VERIFIED");
    expect(motion.getMascotState()).toBe("idle");
    expect(decoration!.mascot.firstChild.src).toBe(SAFI_COMPANION_MASCOT_ASSETS.idle);
  });

  it("tracks the intended artwork even before a decoration node exists", () => {
    const { motion } = controller();
    motion.setState("TRANSLATING");
    expect(motion.getMascotState()).toBe("translating");
  });

  it("replays the one-shot animation when a state is genuinely re-entered", () => {
    const { motion } = controller();
    motion.setState("VERIFIED");
    motion.setState("STABILIZING");
    expect(motion.setState("VERIFIED")).toBe(true);
  });

  it("answers whether the figure is on screen, using only the panel's own box", () => {
    const mascot: any = { getBoundingClientRect: () => ({ top: 40, bottom: 72 }) };
    const panelEl: any = {
      clientTop: 0,
      clientHeight: 400,
      getBoundingClientRect: () => ({ top: 20 }),
      querySelector: (selector: string) => (selector.includes(COMPANION_MOTION_MASCOT_ATTR) ? mascot : null),
    };
    const motion = createCompanionMotionController({ panel: panelEl });
    // the panel box is 20 → 420, the figure sits at 40 → 72: visible
    expect(motion.isFigureVisible()).toBe(true);

    // a long panel scrolls its body, and the figure can end up above the box
    mascot.getBoundingClientRect = () => ({ top: -80, bottom: -48 });
    expect(motion.isFigureVisible()).toBe(false);
    mascot.getBoundingClientRect = () => ({ top: 430, bottom: 462 });
    expect(motion.isFigureVisible()).toBe(false);

    // no decoration in the panel at all: nothing to show, so nothing is shown
    panelEl.querySelector = () => null;
    expect(motion.isFigureVisible()).toBe(false);
  });

  it("reads nothing from the document: the controller touches only its panel", () => {
    const doc = tinyDocument();
    doc.querySelector = vi.fn(() => {
      throw new Error("the motion layer must never query the document");
    });
    const decoration = createCompanionMotionDecoration({ document: doc as never });
    const { motion } = controller();
    motion.setState("STREAMING");
    motion.setState("VERIFIED");
    motion.mount();
    expect(doc.querySelector).not.toHaveBeenCalled();
    expect(decoration).not.toBeNull();
  });
});

describe("Phase 8B — stylesheet installation", () => {
  it("installs once per document and is idempotent", () => {
    const doc = tinyDocument();
    const first = installCompanionMotionStylesheet({ document: doc as never });
    const second = installCompanionMotionStylesheet({ document: doc as never });
    expect(first).toBe(second);
    expect(doc.head.children).toHaveLength(1);
    expect(first.textContent).toContain("--safi-motion-normal");
  });

  it("marks itself as Safi-owned and lives in head, outside the anchored subtree", () => {
    const doc = tinyDocument();
    const style = installCompanionMotionStylesheet({ document: doc as never });
    expect(style.getAttribute("data-safi-ignore")).toBe("true");
    expect(doc.head.children).toContain(style);
  });

  it("declares its status honestly", () => {
    expect(COMPANION_MOTION_LAYER_STATUS).toBe("PHASE 8B COMPANION MOTION — AWAITING MOTION APPROVAL");
  });
});

describe("Phase 8B — the layer cannot change Companion behaviour", () => {
  const bridge = readFileSync(new URL("../packages/companion/browser-bridge.js", import.meta.url), "utf8");
  const slice = readFileSync(new URL("../packages/companion/vertical-slice.js", import.meta.url), "utf8");
  const layer = readFileSync(new URL("../packages/companion/motion-layer.js", import.meta.url), "utf8");

  it("leaves the vertical slice untouched — no motion import, no motion state", () => {
    expect(slice).not.toMatch(/motion/i);
    expect(slice).not.toMatch(/@keyframes|[{;]\s*animation\s*:|[{;]\s*transition\s*:|\.style\./i);
  });

  it("leaves the frozen trust surfaces untouched", () => {
    for (const file of [
      new URL("../src/index.ts", import.meta.url),
      new URL("../packages/verifier-source/index.js", import.meta.url),
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/safi-motion|motion-layer|keyframes/i);
    }
  });

  it("never grants itself a permission", () => {
    expect(bridge).not.toMatch(/permissions\.grant\([^)]*motion/i);
    // the layer must not even name a permission constant it could reach for
    expect(layer).not.toMatch(/COMPANION_PERMISSIONS|\.grant\(|\.revoke\(|composer:(read|write)|response:read/);
  });

  it("reads the phase, it does not decide it", () => {
    // the only thing the bridge hands the motion layer is the slice's own phase
    expect(bridge).toMatch(/setMotionState\(slice\.getState\(\)\)/);
    expect(bridge).not.toMatch(/setMotionState\("(?!IDLE)/);
  });

  it("holds a phase for one motion token so a sub-frame leg still reads", () => {
    expect(bridge).toMatch(/MOTION_MIN_HOLD_MS = 140/);
    const mirror = bridge.slice(bridge.indexOf("async function withMotionMirror"), bridge.indexOf("function recordError"));
    expect(mirror).toMatch(/nowMs\(\) - motionAppliedAt >= MOTION_MIN_HOLD_MS/);
    // the outcome is applied at once, whatever the hold
    const tail = mirror.slice(mirror.indexOf("finally"));
    expect(tail).not.toMatch(/MOTION_MIN_HOLD_MS/);
  });

  it("never lets the hold delay the operation itself", () => {
    const mirror = bridge.slice(bridge.indexOf("async function withMotionMirror"), bridge.indexOf("function recordError"));
    expect(mirror).toMatch(/return await run\(\)/);
    // the hold is enforced by skipping a frame, never by waiting on a timer
    expect(mirror).not.toMatch(/setTimeout|setInterval|await new Promise/);
  });

  it("runs no timer once the user action settles", () => {
    const body = bridge.slice(bridge.indexOf("async function withMotionMirror"), bridge.indexOf("function recordError"));
    expect(body).toContain("stopped = true");
    expect(body).toContain("finally");
    expect(body).not.toMatch(/setInterval/);
  });

  it("plays back a leg that ran faster than one frame", () => {
    // the phases come from the slice's own record, never from the motion layer
    expect(bridge).toMatch(/function phasesMissedSince\(startIndex, shown\)/);
    expect(bridge).toMatch(/slice\.getHistory\?\.\(\) \?\? \[\]/);
    // only a phase that arrived faster than a single motion token is missing
    expect(bridge).toMatch(/entry\.at - previous\.at >= MOTION_MIN_HOLD_MS/);
    // and one already on screen is never shown twice
    expect(bridge).toMatch(/if \(!shown\.has\(entry\.state\)\) missed\.push\(entry\.state\)/);
  });

  it("never shows a phase twice — the replay ends on the phase the slice ended on", () => {
    // the last replayed phase IS the slice's final phase, so confirming it
    // afterwards changes nothing instead of replaying an entrance
    const mirror = bridge.slice(bridge.indexOf("async function withMotionMirror"), bridge.indexOf("function recordError"));
    expect(mirror).toMatch(/replayMotion\(raf, missed, \(\) => setMotionState\(slice\.getState\(\)\)\)/);
    // and when there is nothing to replay the truth lands at once
    expect(mirror).toMatch(/else setMotionState\(slice\.getState\(\)\)/);
  });

  it("plays a missed phase back only when the figure is on screen to play it", () => {
    const mirror = bridge.slice(bridge.indexOf("async function withMotionMirror"), bridge.indexOf("function recordError"));
    expect(mirror).toMatch(/if \(raf && missed\.length && motion\.isFigureVisible\?\.\(\)\)/);
  });

  it("replays on frames, never on a timer, and only the list it is given", () => {
    const helper = bridge.slice(bridge.indexOf("function phasesMissedSince"), bridge.indexOf("async function withMotionMirror"));
    expect(helper).not.toMatch(/setTimeout|setInterval|await new Promise/);
    expect(helper).toMatch(/if \(nowMs\(\) - since < MOTION_MIN_HOLD_MS\) \{\s*raf\(step\);/);
    expect(helper).toMatch(/setMotionState\(phases\[index\]\)/);
  });

  it("keeps the anchor engine independent of the motion surface", () => {
    const anchor = bridge.slice(bridge.indexOf("function applyPanelAnchor"), bridge.indexOf("async function withMotionMirror"));
    expect(anchor).not.toMatch(/motion/i);
  });
});
