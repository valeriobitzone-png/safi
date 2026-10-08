// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  ChatGPTSiteAdapter,
  COMPANION_STATUS,
  ScriptedCompanionAdapter,
  boxesIntersect,
  createCompanionPermissions,
  createCompanionVerticalSlice,
  resolvePanelAnchor,
} from "../packages/companion/index.js";
import {
  COMPANION_GLOBAL_KEY,
  COMPANION_PERMISSION_PERSISTENCE,
  installSafiCompanionContentScript,
} from "../apps/companion-extension/content.js";

/* ------------------------------------------------------------------ *
 * A live-shaped DOM fixture: ChatGPT renders the composer in a form
 * with a footer that holds the send/stop controls, and renders the
 * assistant turn as a <div data-message-author-role>.  The stop
 * control is deliberately OUTSIDE the assistant subtree.
 * ------------------------------------------------------------------ */
class Node {
  tagName: string;
  attrs: Record<string, string> = {};
  children: Node[] = [];
  parentNode: Node | null = null;
  ownerDocument: Doc;
  hidden = false;
  value = "";
  style: Record<string, string> = {};
  textValue: string | null = null;
  rect: { left: number; top: number; width: number; height: number } | null = null;

  constructor(tagName: string, doc: Doc, text: string | null = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = doc;
    this.textValue = text;
  }
  setAttribute(name: string, value: string) { this.attrs[name] = String(value); }
  removeAttribute(name: string) { delete this.attrs[name]; }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  hasAttribute(name: string) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  appendChild<T extends Node>(child: T): T { child.remove(); child.parentNode = this; this.children.push(child); return child; }
  append(...nodes: Node[]) { for (const node of nodes) this.appendChild(node); }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  matches(selector: string): boolean {
    const tag = this.tagName.toLowerCase();
    if (selector === tag) return true;
    if (selector.startsWith("#")) return this.attrs.id === selector.slice(1);
    if (selector.startsWith(".")) return (this.attrs.class ?? "").split(/\s+/).includes(selector.slice(1));
    const attrExact = /^\[([^=\]]+)=["']([^"']*)["']\]$/.exec(selector);
    if (attrExact) return this.getAttribute(attrExact[1]!) === attrExact[2];
    const tagAttrExact = /^([a-z][\w-]*)\[([^=\]]+)=["']([^"']*)["']\]$/.exec(selector);
    if (tagAttrExact) return tag === tagAttrExact[1] && this.getAttribute(tagAttrExact[2]!) === tagAttrExact[3];
    if (selector.includes(" ")) {
      const [, ancestor, descendant] = selector.split(" ");
      return this.descendants().some((node) => node.matches(descendant) && Boolean(node.closest(ancestor)));
    }
    return false;
  }
  closest(selector: string): Node | null {
    let current: Node | null = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentNode;
    }
    return null;
  }
  descendants(): Node[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
  querySelectorAll(selector: string): Node[] { return this.descendants().filter((node) => node.matches(selector)); }
  querySelector(selector: string): Node | null { return this.querySelectorAll(selector)[0] ?? null; }
  dispatchEvent() { return true; }
  listeners: Record<string, Array<() => void>> = {};
  addEventListener(type: string, handler: () => void) { (this.listeners[type] ||= []).push(handler); }
  removeEventListener() {}
  click() { for (const handler of this.listeners.click ?? []) handler(); }
  getBoundingClientRect() { return this.rect ?? { left: 0, top: 0, width: 0, height: 0 }; }
  get textContent(): string {
    if (this.tagName === "TEXTAREA") return this.value;
    if (this.textValue !== null) return this.textValue;
    return this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) { this.children = []; this.textValue = String(value); }
}

class Doc extends Node {
  location = { hostname: "chatgpt.com", href: "https://chatgpt.com/" };
  defaultView: any;
  body: Node;

  constructor() {
    super("#document", undefined as never);
    this.ownerDocument = this;
    this.body = new Node("body", this);
    this.appendChild(this.body);
    this.defaultView = {
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      HTMLTextAreaElement: class {},
      Event,
      innerWidth: 1280,
      innerHeight: 800,
    };
  }
  createElement(tagName: string): Node { return new Node(tagName, this); }
  createTextNode(text: string): Node { return new Node("#text", this, text); }
  getElementById(id: string): Node | null { return this.querySelectorAll(`#${id}`)[0] ?? null; }
}

function liveChatDom({ composerBox, responseBox }: { composerBox?: any; responseBox?: any } = {}) {
  const doc = new Doc();
  const main = doc.createElement("main");
  doc.body.appendChild(main);
  const form = doc.createElement("form");
  main.appendChild(form);
  const composer = doc.createElement("textarea");
  composer.setAttribute("data-testid", "prompt-textarea");
  composer.setAttribute("aria-label", "Message ChatGPT");
  composer.value = "domanda";
  form.appendChild(composer);
  const footer = doc.createElement("footer");
  footer.setAttribute("id", "composer-footer");
  footer.rect = composerBox ?? null;
  form.appendChild(footer);
  const send = doc.createElement("button");
  send.setAttribute("data-testid", "send-button");
  send.setAttribute("aria-label", "Invia prompt");
  footer.appendChild(send);

  const assistant = doc.createElement("div");
  assistant.setAttribute("data-message-author-role", "assistant");
  assistant.setAttribute("data-message-id", "a-1");
  assistant.rect = responseBox ?? null;
  main.appendChild(assistant);
  const content = doc.createElement("div");
  content.setAttribute("class", "markdown prose");
  content.textContent = "Risposta completa.";
  assistant.appendChild(content);
  return { doc, main, form, composer, footer, send, assistant, content };
}

function client() {
  return {
    translate: vi.fn(({ message }: { message: string }) => ({
      semantic: {
        kind: "semantic-representation/v0.1",
        goal: "answer the person's request",
        task: message,
        originalMessage: message,
        interpretationNotes: [],
        translatedBy: "test-translator",
      },
    })),
    verify: vi.fn(async ({ answer, providerId }: { answer: string; providerId: string }) => ({
      kind: "result" as const,
      answer,
      certificate: {
        schema: "safi-certificate/v0.1" as const,
        trustStatus: "VERIFIED" as const,
        verificationScope: { requiredChecks: ["coherence"] },
        checks: [{ checkId: "coherence", outcome: "PASS" as const, detail: "ok" }],
        missingRequiredChecks: [],
        conflictingChecks: [],
        attempt: 1,
        maxAttempts: 1,
        provider: providerId,
        policyId: "phase7-test",
        createdAt: "2026-09-25T00:00:00.000Z",
        responseSha256: createHash("sha256").update(answer, "utf8").digest("hex"),
      },
    })),
  };
}

function clock() {
  let t = 0;
  return { nowMs: () => t, sleep: async (ms: number) => { t += Math.max(1, ms); } };
}

function grantAll() {
  const permissions = createCompanionPermissions();
  for (const permission of ["composer:read", "composer:write", "response:read"]) {
    permissions.grant(permission as never, { userGesture: true });
  }
  return permissions;
}

async function armed(adapter: ScriptedCompanionAdapter) {
  const c = client();
  const k = clock();
  const slice = createCompanionVerticalSlice({
    adapter,
    safiClient: c,
    permissions: grantAll(),
    hashText: async (text) => createHash("sha256").update(text, "utf8").digest("hex"),
    nowMs: k.nowMs,
    sleep: k.sleep,
  });
  const ready = await slice.preparePrompt({ userGesture: true });
  const inserted = await slice.usePreparedPrompt({ userGesture: true, promptId: ready.promptId });
  return { slice, safi: c, inserted };
}

describe("P7-LIVE-1 — the response observer is armed by the insertion, not by the click", () => {
  it("detects a turn that appears and completes before Observe is pressed", async () => {
    const adapter = new ScriptedCompanionAdapter({ composerText: "domanda" });
    const { slice, safi } = await armed(adapter);
    expect(inserted_kind(slice)).toBe("PROMPT_INSERTED");
    expect(slice.getState()).toBe(COMPANION_STATUS.RESPONSE_OBSERVER_ARMED);
    const epochAtArming = slice.getObservation()?.epoch;
    const baselineAtArming = slice.getObservation()?.baselineTurns;
    expect(baselineAtArming).toEqual([]);

    // The user presses send and the whole turn completes in well under 2 s.
    adapter.startNewTurn({ streaming: true, text: "" });
    await step(slice, 20);
    expect(slice.getState()).toBe(COMPANION_STATUS.STREAMING);
    adapter.appendChunk("Risposta ");
    adapter.appendChunk("completa.");
    adapter.finishStreaming();
    await step(slice, 20);
    expect(slice.getState()).toBe(COMPANION_STATUS.FINAL_RESPONSE_READY);
    expect(slice.getObservation()?.sawStreaming).toBe(true);
    expect(slice.getObservation()?.epoch).toBe(epochAtArming);

    // Only now the user presses Observe.
    const result = await slice.observeAndVerify({ userGesture: true, timeoutMs: 5_000 });
    expect(result.kind).toBe("VERIFIED");
    expect(result.certified).toBe(true);
    expect(result.exactFinalText).toBe("Risposta completa.");
    expect(result.streamingCertified).toBe(false);
    expect(result.certificate.responseSha256).toBe(createHash("sha256").update("Risposta completa.", "utf8").digest("hex"));
    expect(adapter.projections).toHaveLength(1);
    expect(adapter.sendCount).toBe(0);
    expect(safi.verify).toHaveBeenCalledTimes(1);
  });

  it("recognizes a turn that completes in a single poll window", async () => {
    const adapter = new ScriptedCompanionAdapter({ composerText: "domanda" });
    const { slice } = await armed(adapter);
    adapter.startNewTurn({ streaming: false, text: "Risposta già stabile." });
    const result = await slice.observeAndVerify({ userGesture: true, timeoutMs: 5_000 });
    expect(result.kind).toBe("VERIFIED");
    expect(result.exactFinalText).toBe("Risposta già stabile.");
  });

  it("never certifies a pre-existing answer and never exposes partial text", async () => {
    const adapter = new ScriptedCompanionAdapter({ composerText: "domanda" });
    adapter.startNewTurn({ streaming: false, text: "Risposta vecchia." });
    const { slice, safi } = await armed(adapter);
    const armedResult = await slice.observeAndVerify({ userGesture: true, timeoutMs: 5_000 });
    expect(armedResult.kind).toBe(COMPANION_STATUS.RESPONSE_OBSERVER_ARMED);
    expect(armedResult.certified).toBe(false);
    expect(armedResult.partialTextExposed).toBe(false);
    expect(armedResult).not.toHaveProperty("exactFinalText");
    expect(safi.verify).not.toHaveBeenCalled();
    expect(adapter.projections).toHaveLength(0);
  });
});

function inserted_kind(slice: any) {
  return slice.getState() === COMPANION_STATUS.RESPONSE_OBSERVER_ARMED ? "PROMPT_INSERTED" : slice.getState();
}

async function step(slice: any, times = 1) {
  // Yield to the armed observer loop deterministically.
  for (let i = 0; i < times; i += 1) await Promise.resolve();
  return slice.getState();
}

describe("P7-LIVE-1 — streaming signals outside the response subtree", () => {
  const auth = { authorized: true, userGesture: true } as const;

  it("treats a Stop control in the composer footer as a real streaming signal", () => {
    const { doc, footer, assistant, content } = liveChatDom();
    const stop = doc.createElement("button");
    stop.setAttribute("aria-label", "Interrompi");
    footer.appendChild(stop);
    const adapter = new ChatGPTSiteAdapter({ document: doc, window: doc.defaultView });

    expect(assistant.contains?.(stop) ?? false).toBe(false);
    const observation = adapter.observeResponse(auth);
    expect(observation.streaming).toBe(true);
    expect(observation.streamingSignal).toMatch(/^control:/);

    const capture = adapter.captureFinalResponse(auth);
    expect(capture.status).toBe("STREAMING");
    expect(capture.text).toBeNull();
    expect(capture.certifiable).toBe(false);
    expect(content.textContent).toBe("Risposta completa.");

    // Once the control disappears the same text is only certifiable after two
    // consecutive identical windows.
    stop.remove();
    expect(adapter.observeResponse(auth).streaming).toBe(false);
    const first = adapter.captureFinalResponse(auth);
    expect(first.status).toBe("STABILIZING");
    expect(first.text).toBeNull();
    const second = adapter.captureFinalResponse(auth);
    expect(second.status).toBe("FINAL");
    expect(second.text).toBe("Risposta completa.");
  });

  it("treats a global streaming marker in the conversation scope as streaming", () => {
    const { doc, main, content } = liveChatDom();
    const marker = doc.createElement("div");
    marker.setAttribute("class", "result-streaming");
    main.appendChild(marker);
    const adapter = new ChatGPTSiteAdapter({ document: doc, window: doc.defaultView });
    expect(adapter.observeResponse(auth).streaming).toBe(true);
    expect(adapter.captureFinalResponse(auth).status).toBe("STREAMING");
    marker.remove();
    adapter.captureFinalResponse(auth);
    expect(adapter.captureFinalResponse(auth).text).toBe(content.textContent);
  });

  it("does not certify text that changes after it looked complete", () => {
    const { doc, content, assistant } = liveChatDom();
    const adapter = new ChatGPTSiteAdapter({ document: doc, window: doc.defaultView });
    expect(adapter.captureFinalResponse(auth).status).toBe("STABILIZING");
    expect(adapter.captureFinalResponse(auth).status).toBe("FINAL");
    // The site keeps writing after the apparent completion.
    content.textContent = "Risposta completa. Continua.";
    const after = adapter.captureFinalResponse(auth);
    expect(after.status).toBe("STABILIZING");
    expect(after.text).toBeNull();
    expect(after.responseKey).toBe(adapter._responseKey(assistant));
  });

  it("refuses to certify when the Stop control is simply absent but the text is still growing", async () => {
    const { doc, content, main } = liveChatDom();
    const adapter = new ChatGPTSiteAdapter({ document: doc, window: doc.defaultView });
    const result = await adapter.waitForFinalResponse({
      ...auth,
      timeoutMs: 60,
      pollMs: 5,
      sleep: async () => { content.textContent += "x"; },
    });
    expect(result.ok).toBe(false);
    expect(result.certifiable).toBe(false);
    expect(result.text).toBeNull();
    expect(main.querySelectorAll(".result-streaming")).toHaveLength(0);
  });
});

describe("P7-LIVE-2 — real MV3 reload/reinjection contract", () => {
  it("is idempotent within a document and rebuilds the ledger after a reload", () => {
    expect(COMPANION_PERMISSION_PERSISTENCE.policy).toBe("document-scoped");
    expect(COMPANION_PERMISSION_PERSISTENCE.survivesReload).toBe(false);

    const { doc } = liveChatDom();
    const firstScope: any = { document: doc, [COMPANION_GLOBAL_KEY]: undefined };
    const first = installSafiCompanionContentScript({ global: firstScope, document: doc });
    expect(first).toBeTruthy();
    expect(firstScope[COMPANION_GLOBAL_KEY]).toBe(first);

    // A double injection in the same document must not create a second panel.
    const again = installSafiCompanionContentScript({ global: firstScope, document: doc });
    expect(again).toBe(first);
    expect(doc.querySelectorAll("#safi-companion-live-panel")).toHaveLength(1);

    // A reload is a brand new document and a brand new global scope.
    const reloaded = liveChatDom();
    const secondScope: any = { document: reloaded.doc, [COMPANION_GLOBAL_KEY]: undefined };
    const second = installSafiCompanionContentScript({ global: secondScope, document: reloaded.doc });
    expect(second).not.toBe(first);
    expect(reloaded.doc.querySelectorAll("#safi-companion-live-panel")).toHaveLength(1);

    // The ledger is document-scoped: nothing is silently carried over.
    expect(second.permissions.snapshot().granted).toEqual({
      "composer:read": false,
      "composer:write": false,
      "response:read": false,
    });
    second.permissions.grant("response:read" as never, { userGesture: true });
    expect(second.permissions.isGranted("response:read")).toBe(true);
    expect(first.permissions.isGranted("response:read")).toBe(false);
    expect(first.permissions.snapshot().granted["response:read"]).toBe(false);
  });
});

describe("P7-LIVE-3 — the panel never covers send, stop or the composer", () => {
  const panel = { width: 390, height: 720 };

  function controls(boxes: Record<string, any>) {
    return Object.entries(boxes).map(([id, box]) => ({ id, box }));
  }

  it("anchors top-right on a normal desktop window", () => {
    const decision = resolvePanelAnchor({
      panel,
      viewport: { width: 1280, height: 800 },
      critical: controls({
        composer: { left: 300, top: 640, width: 680, height: 150 },
        send: { left: 940, top: 750, width: 36, height: 36 },
      }),
    });
    expect(decision.collisions).toEqual([]);
    expect(decision.anchor).toBe("top-right");
    expect(boxesIntersect(decision.box, { left: 300, top: 640, right: 980, bottom: 790 })).toBe(false);
  });

  it("anchors clear of a one-line composer on a narrow window", () => {
    const decision = resolvePanelAnchor({
      panel: { width: 388, height: 547 },
      viewport: { width: 420, height: 760 },
      critical: controls({
        composer: { left: 8, top: 700, width: 404, height: 52 },
        send: { left: 380, top: 708, width: 32, height: 32 },
      }),
    });
    expect(decision.collisions).toEqual([]);
    expect(decision.box.bottom).toBeLessThanOrEqual(700);
  });

  it("shrinks and re-anchors for a tall multi-line composer", () => {
    const decision = resolvePanelAnchor({
      panel,
      viewport: { width: 1280, height: 800 },
      critical: controls({
        composer: { left: 300, top: 380, width: 680, height: 410 },
      }),
    });
    expect(decision.collisions).toEqual([]);
    expect(decision.maxHeight).toBeGreaterThan(0);
    expect(decision.maxHeight).toBeLessThan(720);
    expect(decision.box.bottom).toBeLessThanOrEqual(380);
  });

  it("keeps clear of the streaming Stop control inside the composer", () => {
    const decision = resolvePanelAnchor({
      panel,
      viewport: { width: 1280, height: 800 },
      critical: controls({
        composerFooter: { left: 300, top: 600, width: 680, height: 190 },
        stop: { left: 300, top: 600, width: 36, height: 36 },
        send: { left: 940, top: 600, width: 36, height: 36 },
      }),
    });
    expect(decision.collisions).toEqual([]);
    expect(decision.box.bottom).toBeLessThanOrEqual(600);
  });

  it("places the panel above the composer when the bottom is the only free side", () => {
    const decision = resolvePanelAnchor({
      panel: { width: 390, height: 400 },
      viewport: { width: 1280, height: 800 },
      critical: controls({
        composer: { left: 300, top: 420, width: 680, height: 370 },
      }),
    });
    expect(decision.collisions).toEqual([]);
    expect(decision.box.bottom).toBeLessThanOrEqual(420);
  });

  it("never overlaps when the site re-lays out under the panel", () => {
    const decision = resolvePanelAnchor({
      panel,
      viewport: { width: 900, height: 700 },
      critical: controls({
        composer: { left: 0, top: 16, width: 900, height: 60 },
        send: { left: 850, top: 24, width: 32, height: 32 },
      }),
    });
    expect(decision.collisions).toEqual([]);
    expect(decision.box.top).toBeGreaterThanOrEqual(76);
  });
});
