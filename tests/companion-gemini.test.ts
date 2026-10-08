// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  COMPANION_PROVIDER_IDS,
  ChatGPTSiteAdapter,
  GeminiSiteAdapter,
  createAdapterForHost,
  createCompanionPermissions,
  createCompanionVerticalSlice,
  providerIdForHost,
  resolvePanelAnchor,
} from "../packages/companion/index.js";

/* ------------------------------------------------------------------ *
 * Gemini-shaped DOM fixture, built from the live measurements recorded
 * in artifacts/companion-live/gemini/dom-discovery.md:
 *
 *   chat-window-content
 *   └── infinite-scroller[data-test-id="chat-history-container"]
 *       ├── user-query
 *       └── model-response
 *           └── response-container
 *               ├── div[aria-live="polite"]      → "Gemini ha detto"
 *               ├── model-response-content       → the answer
 *               ├── thinking-overlay
 *               └── message-actions[footer]      → toolbar
 *
 *   rich-textarea
 *   ├── div.ql-editor[contenteditable][role=textbox]  → the composer
 *   ├── div.ql-clipboard[contenteditable]             → offscreen decoy
 *   └── div[data-test-id="send-button-container"]
 *       └── mat-icon[data-mat-icon-name="arrow_upward" | "stop"]
 * ------------------------------------------------------------------ */

const SIMPLE_SELECTOR = /^([a-z][\w-]*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/i;
const PART_SELECTOR = /([a-z][\w-]*)?((?:\[[^\]]+\]|[#.][\w-]+)*)/i;

function matchesCompound(node: Node, compound: string): boolean {
  const match = SIMPLE_SELECTOR.exec(compound.trim());
  if (!match) return false;
  const [, tag, rest = ""] = match;
  if (tag && node.tagName.toLowerCase() !== tag.toLowerCase()) return false;
  const tokens = rest.match(/\[[^\]]+\]|[#.][\w-]+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith(".")) {
      if (!(node.attrs.class ?? "").split(/\s+/).includes(token.slice(1))) return false;
    } else if (token.startsWith("#")) {
      if (node.attrs.id !== token.slice(1)) return false;
    } else {
      const inner = token.slice(1, -1);
      const eq = inner.indexOf("=");
      if (eq < 0) {
        if (!node.hasAttribute(inner)) return false;
      } else {
        const name = inner.slice(0, eq);
        const value = inner.slice(eq + 1).replace(/^["']|["']$/g, "");
        if (node.getAttribute(name) !== value) return false;
      }
    }
  }
  return true;
}

class Node {
  tagName: string;
  attrs: Record<string, string> = {};
  children: Node[] = [];
  parentNode: Node | null = null;
  ownerDocument: Doc;
  hidden = false;
  value = "";
  textValue: string | null = null;
  rect: { left: number; top: number; width: number; height: number } | null = null;
  style: Record<string, string> = {};

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
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  matches(selector: string): boolean {
    if (selector.includes(",")) {
      return selector.split(",").some((group) => this.matches(group.trim()));
    }
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    if (parts.length === 1) return matchesCompound(this, parts[0]!);
    let index = parts.length - 1;
    if (!matchesCompound(this, parts[index]!)) return false;
    let current: Node | null = this.parentNode;
    index -= 1;
    while (index >= 0) {
      if (!current) return false;
      if (matchesCompound(current, parts[index]!)) index -= 1;
      current = current.parentNode;
    }
    return true;
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
  getBoundingClientRect() { return this.rect ?? { left: 0, top: 0, width: 0, height: 0 }; }
  get textContent(): string {
    if (this.tagName === "TEXTAREA") return this.value;
    if (this.textValue !== null) return this.textValue;
    return this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) { this.children = []; this.textValue = String(value); }
}

class Doc extends Node {
  location = { hostname: "gemini.google.com", href: "https://gemini.google.com/app" };
  defaultView: any;
  body: Node;

  constructor(hostname = "gemini.google.com") {
    super("#document", undefined as never);
    this.ownerDocument = this;
    this.location = { hostname, href: `https://${hostname}/app` };
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

interface GeminiDom {
  doc: Doc;
  conversation: Node;
  composerContainer: Node;
  composer: Node;
  clipboardDecoy: Node;
  sendContainer: Node;
  sendIcon: Node;
  modelResponse?: Node;
  label?: Node;
  content?: Node;
  thinking?: Node;
  actions?: Node;
}

function liveGeminiDom({ hostname = "gemini.google.com", withTurn = true } = {}): GeminiDom {
  const doc = new Doc(hostname);
  const window = doc.createElement("chat-window-content");
  doc.body.appendChild(window);
  const chatHistory = doc.createElement("div");
  chatHistory.setAttribute("id", "chat-history");
  window.appendChild(chatHistory);
  const conversation = doc.createElement("infinite-scroller");
  conversation.setAttribute("data-test-id", "chat-history-container");
  conversation.rect = { left: 288, top: 0, width: 912, height: 700 };
  chatHistory.appendChild(conversation);

  const composerContainer = doc.createElement("rich-textarea");
  composerContainer.setAttribute("enterkeyhint", "send");
  composerContainer.rect = { left: 414, top: 375, width: 660, height: 64 };
  doc.body.appendChild(composerContainer);
  const composer = doc.createElement("div");
  composer.setAttribute("class", "ql-editor ql-blank textarea new-input-ui");
  composer.setAttribute("contenteditable", "true");
  composer.setAttribute("role", "textbox");
  composer.setAttribute("aria-multiline", "true");
  composer.setAttribute("aria-label", "Inserisci un prompt per Gemini");
  composer.setAttribute("data-placeholder", "Chiedi a Gemini");
  composer.rect = { left: 474, top: 395, width: 433, height: 24 };
  composerContainer.appendChild(composer);
  // Quill keeps a zero-area offscreen clipboard mirror in the DOM.
  const clipboardDecoy = doc.createElement("div");
  clipboardDecoy.setAttribute("class", "ql-clipboard");
  clipboardDecoy.setAttribute("contenteditable", "true");
  clipboardDecoy.setAttribute("tabindex", "-1");
  clipboardDecoy.rect = { left: -99526, top: 407, width: 0, height: 1 };
  composerContainer.appendChild(clipboardDecoy);

  const sendContainer = doc.createElement("div");
  sendContainer.setAttribute("data-test-id", "send-button-container");
  sendContainer.rect = { left: 1026, top: 410, width: 32, height: 32 };
  composerContainer.appendChild(sendContainer);
  const sendIcon = doc.createElement("mat-icon");
  sendIcon.setAttribute("data-mat-icon-name", "arrow_upward");
  sendIcon.rect = { left: 1030, top: 414, width: 24, height: 24 };
  sendContainer.appendChild(sendIcon);

  const dom: GeminiDom = { doc, conversation, composerContainer, composer, clipboardDecoy, sendContainer, sendIcon };
  if (!withTurn) return dom;

  const userQuery = doc.createElement("user-query");
  userQuery.textContent = "domanda";
  conversation.appendChild(userQuery);
  const modelResponse = doc.createElement("model-response");
  modelResponse.rect = { left: 288, top: 60, width: 900, height: 400 };
  conversation.appendChild(modelResponse);
  const responseContainer = doc.createElement("response-container");
  responseContainer.rect = { left: 288, top: 60, width: 900, height: 400 };
  modelResponse.appendChild(responseContainer);
  const label = doc.createElement("div");
  label.setAttribute("aria-live", "polite");
  label.setAttribute("aria-busy", "false");
  label.textContent = "Gemini ha detto";
  label.rect = { left: 288, top: 60, width: 900, height: 20 };
  responseContainer.appendChild(label);
  const thinking = doc.createElement("thinking-overlay");
  thinking.rect = { left: 288, top: 80, width: 708, height: 0 };
  responseContainer.appendChild(thinking);
  const content = doc.createElement("model-response-content");
  content.textContent = "Risposta del modello.";
  content.rect = { left: 288, top: 100, width: 900, height: 300 };
  responseContainer.appendChild(content);
  const actions = doc.createElement("message-actions");
  actions.setAttribute("footer", "");
  actions.rect = { left: 288, top: 420, width: 708, height: 32 };
  responseContainer.appendChild(actions);

  Object.assign(dom, { modelResponse, label, content, thinking, actions });
  return dom;
}

function setStreaming(dom: GeminiDom, streaming: boolean) {
  dom.sendIcon.setAttribute("data-mat-icon-name", streaming ? "stop" : "arrow_upward");
  dom.label?.setAttribute("aria-busy", streaming ? "true" : "false");
  if (streaming) dom.content!.textContent = "Risposta parziale";
}

/** Append a user turn and a complete model turn, as the site would. */
function addTurn(dom: GeminiDom, answer: string) {
  const doc = dom.doc;
  const userQuery = doc.createElement("user-query");
  userQuery.textContent = "domanda";
  dom.conversation.appendChild(userQuery);
  const modelResponse = doc.createElement("model-response");
  modelResponse.rect = { left: 288, top: 60, width: 900, height: 400 };
  dom.conversation.appendChild(modelResponse);
  const responseContainer = doc.createElement("response-container");
  responseContainer.rect = { left: 288, top: 60, width: 900, height: 400 };
  modelResponse.appendChild(responseContainer);
  const label = doc.createElement("div");
  label.setAttribute("aria-live", "polite");
  label.setAttribute("aria-busy", "false");
  label.textContent = "Gemini ha detto";
  responseContainer.appendChild(label);
  const content = doc.createElement("model-response-content");
  content.textContent = answer;
  content.rect = { left: 288, top: 100, width: 900, height: 300 };
  responseContainer.appendChild(content);
  const actions = doc.createElement("message-actions");
  actions.setAttribute("footer", "");
  responseContainer.appendChild(actions);
  Object.assign(dom, { modelResponse, label, content, actions });
}

function adapterFor(dom: GeminiDom) {
  return new GeminiSiteAdapter({
    document: dom.doc as never,
    window: dom.doc.defaultView,
    location: dom.doc.location as never,
  });
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
        policyId: "phase8-test",
        createdAt: "2026-09-25T00:00:00.000Z",
        responseSha256: createHash("sha256").update(answer, "utf8").digest("hex"),
      },
    })),
  };
}

function grantAll() {
  const permissions = createCompanionPermissions();
  for (const permission of ["composer:read", "composer:write", "response:read"]) {
    permissions.grant(permission as never, { userGesture: true });
  }
  return permissions;
}

const AUTH = { authorized: true, userGesture: true } as const;

describe("Phase 8A — GeminiSiteAdapter detection", () => {
  it("recognizes the live Gemini document with explicit evidence", () => {
    const dom = liveGeminiDom();
    dom.composer.textContent = "ciao";
    const detection = adapterFor(dom).detect();
    expect(detection.supported).toBe(true);
    expect(detection.status).toBe("READY");
    expect(detection.provider).toBe("gemini");
    expect(detection.signals).toEqual(expect.arrayContaining([
      "gemini-host",
      "semantic-conversation",
      "semantic-composer",
      "model-turn",
      "model-response",
      "send-control",
    ]));
    expect(detection.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("refuses any host outside the Gemini allowlist", () => {
    const dom = liveGeminiDom({ hostname: "example.com" });
    const detection = adapterFor(dom).detect();
    expect(detection.supported).toBe(false);
    expect(detection.status).toBe("COMPANION_UNAVAILABLE");
    expect(detection.signals).not.toContain("semantic-composer");
  });

  it("fails closed when the composer is not recognized", () => {
    const dom = liveGeminiDom();
    dom.composerContainer.remove();
    const adapter = adapterFor(dom);
    const detection = adapter.detect();
    expect(detection.supported).toBe(false);
    expect(detection.reason).toMatch(/composer/i);
    expect(adapter.healthCheck().ok).toBe(false);
    expect(adapter.captureComposer(AUTH).ok).toBe(false);
  });

  it("never mistakes Quill's offscreen clipboard mirror for the composer", () => {
    const dom = liveGeminiDom();
    dom.composer.remove();
    dom.clipboardDecoy.textContent = "copied text";
    const adapter = adapterFor(dom);
    const detection = adapter.detect();
    expect(detection.supported).toBe(false);
    expect(adapter.captureComposer(AUTH).ok).toBe(false);
  });

  it("declares only Gemini's own critical controls to the collision engine", () => {
    const dom = liveGeminiDom();
    const adapter = adapterFor(dom);
    expect(adapter.criticalSelectors).toContain('[data-test-id="send-button-container"]');
    expect(adapter.criticalSelectors).toContain("rich-textarea");
    expect(adapter.criticalSelectors).not.toContain('[data-testid="send-button"]');
  });
});

describe("Phase 8A — composer capture and explicit insertion", () => {
  it("captures the exact composer text", () => {
    const dom = liveGeminiDom();
    dom.composer.textContent = "mi spieghi perché il mare sembra blu?";
    const captured = adapterFor(dom).captureComposer(AUTH);
    expect(captured.ok).toBe(true);
    expect(captured.text).toBe("mi spieghi perché il mare sembra blu?");
  });

  it("refuses an empty composer instead of guessing", () => {
    const dom = liveGeminiDom();
    const captured = adapterFor(dom).captureComposer(AUTH);
    expect(captured.ok).toBe(false);
    expect(captured.status).toBe("EMPTY_COMPOSER");
  });

  it("inserts the translated prompt without touching the send control", () => {
    const dom = liveGeminiDom();
    dom.composer.textContent = "originale";
    const adapter = adapterFor(dom);
    const inserted = adapter.insertPrompt("prompt tradotto", AUTH);
    expect(inserted.ok).toBe(true);
    expect(inserted.status).toBe("PROMPT_INSERTED");
    expect(inserted.sendTriggered).toBe(false);
    expect(dom.composer.textContent).toBe("prompt tradotto");
    // The site's own send control is untouched: still the arrow, never clicked.
    expect(dom.sendIcon.getAttribute("data-mat-icon-name")).toBe("arrow_upward");
  });

  it("denies both composer operations without an explicit permission and gesture", () => {
    const dom = liveGeminiDom();
    dom.composer.textContent = "testo";
    const adapter = adapterFor(dom);
    for (const options of [{}, { authorized: true }, { userGesture: true }]) {
      expect(adapter.captureComposer(options).status).toBe("PERMISSION_REQUIRED");
      expect(adapter.insertPrompt("x", options).status).toBe("PERMISSION_REQUIRED");
    }
    expect(dom.composer.textContent).toBe("testo");
  });
});

describe("Phase 8A — streaming signals and stabilization", () => {
  it("detects streaming from the stop control that lives outside the response subtree", () => {
    const dom = liveGeminiDom();
    // Only the composer's stop control: the response subtree carries no
    // signal at all, exactly like the live site.
    dom.sendIcon.setAttribute("data-mat-icon-name", "stop");
    const observation = adapterFor(dom).observeResponse(AUTH);
    expect(observation.ok).toBe(true);
    expect(observation.streaming).toBe(true);
    expect(observation.streamingSignal).toMatch(/stop/);
    expect(dom.label!.getAttribute("aria-busy")).toBe("false");
  });

  it("reports both real signals when the site exposes both", () => {
    const dom = liveGeminiDom();
    setStreaming(dom, true);
    const observation = adapterFor(dom).observeResponse(AUTH);
    expect(observation.streaming).toBe(true);
    expect(observation.streamingSignal).toMatch(/aria-busy|stop/);
  });

  it("detects streaming from the response live region alone", () => {
    const dom = liveGeminiDom();
    dom.label!.setAttribute("aria-busy", "true");
    const observation = adapterFor(dom).observeResponse(AUTH);
    expect(observation.streaming).toBe(true);
    expect(observation.streamingSignal).toMatch(/aria-busy/);
  });

  it("never exposes partial text while streaming", () => {
    const dom = liveGeminiDom();
    setStreaming(dom, true);
    const capture = adapterFor(dom).captureFinalResponse(AUTH);
    expect(capture.ok).toBe(false);
    expect(capture.status).toBe("STREAMING");
    expect(capture.certifiable).toBe(false);
    expect(capture.text).toBeNull();
  });

  it("requires two consecutive identical snapshots with no streaming signal", () => {
    const dom = liveGeminiDom();
    const adapter = adapterFor(dom);
    const first = adapter.captureFinalResponse(AUTH);
    expect(first.status).toBe("STABILIZING");
    expect(first.text).toBeNull();
    const second = adapter.captureFinalResponse(AUTH);
    expect(second.ok).toBe(true);
    expect(second.stable).toBe(true);
    expect(second.text).toBe("Risposta del modello.");
  });

  it("resets the window when the text changes after an apparent completion", () => {
    const dom = liveGeminiDom();
    const adapter = adapterFor(dom);
    adapter.captureFinalResponse(AUTH);
    adapter.captureFinalResponse(AUTH);
    dom.content!.textContent = "Risposta del modello.Continua.";
    const third = adapter.captureFinalResponse(AUTH);
    expect(third.status).toBe("STABILIZING");
    expect(third.text).toBeNull();
  });
});

describe("Phase 8A — exact final text", () => {
  it("captures only the answer, excluding label, thinking UI and toolbar", () => {
    const dom = liveGeminiDom();
    dom.label!.textContent = "Gemini Pro 2.5";
    dom.thinking!.textContent = "Sto ragionando";
    dom.actions!.textContent = "Copia Condividi Mi piace";
    const adapter = adapterFor(dom);
    adapter.captureFinalResponse(AUTH);
    const capture = adapter.captureFinalResponse(AUTH);
    expect(capture.text).toBe("Risposta del modello.");
    expect(capture.text).not.toMatch(/Gemini Pro/);
    expect(capture.text).not.toMatch(/Copia/);
    expect(capture.text).not.toMatch(/ragionando/);
  });

  it("reads only the newest model turn", () => {
    const dom = liveGeminiDom();
    const older = dom.doc.createElement("model-response");
    const olderContainer = dom.doc.createElement("response-container");
    const olderContent = dom.doc.createElement("model-response-content");
    olderContent.textContent = "Risposta vecchia.";
    olderContainer.appendChild(olderContent);
    older.appendChild(olderContainer);
    dom.conversation.appendChild(older);
    const adapter = adapterFor(dom);
    adapter.captureFinalResponse(AUTH);
    const capture = adapter.captureFinalResponse(AUTH);
    expect(capture.text).toBe("Risposta del modello.");
  });

  it("fails closed instead of certifying a container that includes the model label", () => {
    const dom = liveGeminiDom();
    dom.content!.remove();
    const adapter = adapterFor(dom);
    const capture = adapter.captureFinalResponse(AUTH);
    // The structural fallback may not pick the live-region label or the actions.
    expect(capture.ok).toBe(false);
    expect(capture.status).toBe("NO_RESPONSE");
  });

  it("prefers the dedicated content element when two elements wrap the same text", () => {
    // Measured live: one response container holds both
    // `model-response-content` and `message-content` around the same answer.
    const dom = liveGeminiDom();
    const twin = dom.doc.createElement("message-content");
    twin.textContent = "Risposta del modello.";
    twin.rect = { left: 288, top: 100, width: 900, height: 300 };
    dom.content!.parentNode!.appendChild(twin);
    const adapter = adapterFor(dom);
    adapter.captureFinalResponse(AUTH);
    const capture = adapter.captureFinalResponse(AUTH);
    expect(capture.ok).toBe(true);
    expect(capture.text).toBe("Risposta del modello.");
  });

  it("descends past a wrapper that carries the model label instead of certifying it", () => {
    // Measured live: in some responses Gemini omits the
    // `model-response-content` element and puts the answer inside a plain div
    // that also holds the "Gemini ha detto" live region.  The fallback must
    // descend into that wrapper, never return it.
    const dom = liveGeminiDom();
    const container = dom.content!.parentNode!;
    const label = dom.label!;
    const actions = dom.actions!;
    dom.content!.remove();
    const wrapper = dom.doc.createElement("div");
    wrapper.rect = { left: 288, top: 80, width: 900, height: 320 };
    container.appendChild(wrapper);
    const answer = dom.doc.createElement("div");
    answer.textContent = "Risposta senza elemento dedicato.";
    answer.rect = { left: 288, top: 100, width: 900, height: 280 };
    wrapper.appendChild(answer);
    // Re-parent the chrome into the wrapper, in the live order.
    wrapper.appendChild(label);
    wrapper.appendChild(actions);
    const adapter = adapterFor(dom);
    adapter.captureFinalResponse(AUTH);
    const capture = adapter.captureFinalResponse(AUTH);
    expect(capture.ok).toBe(true);
    expect(capture.text).toBe("Risposta senza elemento dedicato.");
    expect(capture.text).not.toMatch(/Gemini ha detto/);
  });
});

describe("Phase 8A — projection", () => {
  const projection = {
    schema: "safi-companion-projection/v0.1",
    trustStatus: "VERIFIED",
    label: "Verificato",
    ariaLabel: "Safi: Verificato",
    responseSha256: "a".repeat(64),
    separate: true,
  };

  it("mounts beside the model turn and never inside the hashed text", () => {
    const dom = liveGeminiDom();
    const adapter = adapterFor(dom);
    const before = dom.content!.textContent;
    const attached = adapter.attachProjection(projection as never, {
      ...AUTH,
      expectedResponseText: before,
    });
    expect(attached.ok).toBe(true);
    expect(attached.responseUnchanged).toBe(true);
    const mount = dom.modelResponse!.parentNode!;
    const node = mount.children.find((child) => child.getAttribute("data-safi-companion-projection") === "gemini")!;
    expect(node.tagName).toBe("ASIDE");
    expect(mount.children).toContain(dom.modelResponse!);
    expect(dom.content!.textContent).toBe(before);
    expect(dom.content!.children).toHaveLength(0);
  });

  it("refuses to project when the response changed first", () => {
    const dom = liveGeminiDom();
    const attached = adapterFor(dom).attachProjection(projection as never, {
      ...AUTH,
      expectedResponseText: "testo precedente",
    });
    expect(attached.ok).toBe(false);
    expect(attached.reason).toMatch(/changed/i);
    expect(dom.doc.querySelectorAll("[data-safi-companion-projection]")).toHaveLength(0);
  });
});

describe("Phase 8A — provider-neutral vertical slice", () => {
  function clock() {
    let t = 0;
    return { nowMs: () => t, sleep: async (ms: number) => { t += Math.max(1, ms); } };
  }

  async function runFlow(adapter: never, dom: GeminiDom, mutateBeforeProjection = false) {
    const safiClient = client();
    const k = clock();
    const slice = createCompanionVerticalSlice({
      adapter,
      safiClient: safiClient as never,
      permissions: grantAll(),
      nowMs: k.nowMs,
      sleep: k.sleep,
      pollMs: 10,
      stableMs: 10,
      requiredStableWindows: 2,
      observeTimeoutMs: 5_000,
      maxObserverTicks: 200,
    });
    const prepared = await slice.preparePrompt({ userGesture: true });
    expect(prepared.kind).toBe("PROMPT_READY");
    const inserted = await slice.usePreparedPrompt({ userGesture: true, promptId: prepared.promptId });
    expect(inserted.kind).toBe("PROMPT_INSERTED");
    expect(inserted.sent).toBe(false);
    // The observer is armed *before* the user sends anything.
    expect(inserted.observer.phase).toBe("RESPONSE_OBSERVER_ARMED");
    expect(inserted.observer.baselineTurns).toEqual([]);
    // The user then presses the site's own send control: the turn appears.
    addTurn(dom, "Risposta del modello.");
    if (mutateBeforeProjection) {
      // Let the observer reach its own final capture first, then move the DOM
      // underneath it: this is the window the pre-projection recapture exists
      // for.
      for (let i = 0; i < 50 && slice.getObservation()?.phase !== "FINAL_RESPONSE_READY"; i += 1) {
        await Promise.resolve();
        await k.sleep(10);
      }
      expect(slice.getObservation()?.phase).toBe("FINAL_RESPONSE_READY");
      dom.content!.textContent = "Risposta cambiata dopo la cattura.";
    }
    const verified = await slice.observeAndVerify({ userGesture: true, timeoutMs: 2_000 });
    return { slice, prepared, inserted, verified };
  }

  it("drives the Gemini adapter through the same controller as ChatGPT", async () => {
    const dom = liveGeminiDom({ withTurn: false });
    dom.composer.textContent = "perché il mare sembra blu?";
    const { slice, verified } = await runFlow(adapterFor(dom) as never, dom);
    expect(verified.kind).toBe("VERIFIED");
    expect(verified.certified).toBe(true);
    expect(verified.streamingCertified).toBe(false);
    expect(verified.exactFinalText).toBe("Risposta del modello.");
    expect(verified.certificate.responseSha256).toBe(
      createHash("sha256").update("Risposta del modello.", "utf8").digest("hex"),
    );
    expect(verified.exactFinalTextSha256).toBe(verified.certificate.responseSha256);
    expect(verified.responseUnchanged).toBe(true);
    expect(slice.adapterId).toBe("gemini-site-adapter");
    expect(slice.getHistory().map((h: { state: string }) => h.state)).toEqual(expect.arrayContaining([
      "UNDERSTANDING",
      "TRANSLATING",
      "PROMPT_READY",
      "RESPONSE_OBSERVER_ARMED",
      "NEW_ASSISTANT_TURN_DETECTED",
      "STABILIZING",
      "FINAL_RESPONSE_READY",
      "VERIFYING",
      "VERIFIED",
    ]));
  });

  it("aborts certification and leaves no projection when the DOM mutates", async () => {
    const dom = liveGeminiDom({ withTurn: false });
    dom.composer.textContent = "domanda";
    const { verified, slice } = await runFlow(adapterFor(dom) as never, dom, true);
    expect(verified.kind).toBe("STABILIZING");
    expect(verified.certified).toBe(false);
    expect(verified.aborted).toBe(true);
    expect(verified.partialTextExposed).toBe(false);
    expect(slice.getObservation()?.aborted).toBe(1);
    expect(dom.doc.querySelectorAll("[data-safi-companion-projection]")).toHaveLength(0);
  });

  it("exposes the same contract surface for both providers", () => {
    const dom = liveGeminiDom();
    const gemini = adapterFor(dom);
    const chatgpt = new ChatGPTSiteAdapter({ document: undefined as never, location: { hostname: "chatgpt.com" } as never });
    const contract = [
      "detect",
      "captureComposer",
      "insertPrompt",
      "observeResponse",
      "isResponseStreaming",
      "captureFinalResponse",
      "attachProjection",
      "healthCheck",
    ];
    for (const method of contract) {
      expect(typeof (gemini as never as Record<string, unknown>)[method]).toBe("function");
      expect(typeof (chatgpt as never as Record<string, unknown>)[method]).toBe("function");
    }
    // The shared convenience surface the controller relies on is identical.
    const shared = ["waitForFinalResponse", "resetStability", "hostname"];
    for (const method of shared) {
      expect(typeof (gemini as never as Record<string, unknown>)[method]).toBe("function");
      expect(typeof (chatgpt as never as Record<string, unknown>)[method]).toBe("function");
    }
    // The only intentional difference is the provider-declared critical
    // control list, which parameterizes the shared collision engine.
    expect(typeof (gemini as never as Record<string, unknown>).criticalSelectors).toBe("object");
  });

  it("keeps the controller free of any provider branch", () => {
    const source = readFileSync(new URL("../packages/companion/vertical-slice.js", import.meta.url), "utf8");
    expect(source).not.toMatch(/gemini/i);
    expect(source).not.toMatch(/chatgpt/i);
    expect(source).not.toMatch(/provider\s*===/);
    expect(source).not.toMatch(/if\s*\(\s*adapter\.provider/);
  });

  it("resolves adapters from the host alone", () => {
    expect(COMPANION_PROVIDER_IDS).toEqual(["chatgpt", "gemini"]);
    expect(providerIdForHost("gemini.google.com")).toBe("gemini");
    expect(providerIdForHost("chatgpt.com")).toBe("chatgpt");
    expect(providerIdForHost("example.com")).toBeNull();
    expect(createAdapterForHost("example.com")).toBeNull();
    expect(createAdapterForHost("gemini.google.com", { document: liveGeminiDom().doc as never })?.provider).toBe("gemini");
    expect(createAdapterForHost("chat.openai.com")?.provider).toBe("chatgpt");
  });
});

describe("Phase 8A — panel collision with Gemini controls", () => {
  const critical = [
    { id: '[data-test-id="send-button-container"]', box: { left: 1026, top: 700, right: 1058, bottom: 732, width: 32, height: 32 } },
    { id: "rich-textarea", box: { left: 414, top: 660, right: 1074, bottom: 724, width: 660, height: 64 } },
  ];

  it("keeps the panel clear of the composer and the send control on a normal desktop", () => {
    const decision = resolvePanelAnchor({
      panel: { width: 390, height: 720 },
      viewport: { width: 1200, height: 800 },
      critical,
    });
    expect(decision.collisions).toEqual([]);
    expect(decision.overlapArea).toBe(0);
  });

  it("keeps the panel clear in a narrow window", () => {
    const decision = resolvePanelAnchor({
      panel: { width: 390, height: 600 },
      viewport: { width: 500, height: 613 },
      critical: [
        { id: "rich-textarea", box: { left: 14, top: 500, right: 486, bottom: 590, width: 472, height: 90 } },
        { id: '[data-test-id="send-button-container"]', box: { left: 440, top: 540, right: 472, bottom: 572, width: 32, height: 32 } },
      ],
    });
    expect(decision.collisions).toEqual([]);
    expect(decision.overlapArea).toBe(0);
  });

  it("keeps the panel clear while the stop control replaces the send control", () => {
    const decision = resolvePanelAnchor({
      panel: { width: 390, height: 720 },
      viewport: { width: 1280, height: 900 },
      critical: [
        { id: '[data-test-id="send-button-container"]', box: { left: 1026, top: 800, right: 1058, bottom: 832, width: 32, height: 32 } },
        { id: "rich-textarea", box: { left: 414, top: 760, right: 1074, bottom: 824, width: 660, height: 64 } },
      ],
    });
    expect(decision.collisions).toEqual([]);
  });

  it("caps the panel above the Gemini composer instead of covering the send control", () => {
    // Live geometry, measured on gemini.google.com: the conversation surface
    // spans the whole centre, the composer sits low and wide, and the send
    // container is inside the composer's right edge.  A full-height panel must
    // shrink rather than land on the send button.
    const decision = resolvePanelAnchor({
      panel: { width: 424, height: 815 },
      viewport: { width: 1200, height: 813 },
      critical: [
        { id: '[data-test-id="send-button-container"]', box: { left: 1026, top: 482, right: 1058, bottom: 514, width: 32, height: 32 } },
        { id: "rich-textarea", box: { left: 414, top: 482, right: 1074, bottom: 546, width: 660, height: 64 } },
      ],
    });
    expect(decision.collisions).toEqual([]);
    expect(decision.overlapArea).toBe(0);
    expect(decision.box.bottom).toBeLessThanOrEqual(482);
  });

  it("never declares the conversation surface a critical control", () => {
    const dom = liveGeminiDom();
    expect(adapterFor(dom).criticalSelectors).not.toContain('[data-test-id="chat-history-container"]');
  });
});
