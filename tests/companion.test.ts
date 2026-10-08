// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { createSafiClient } from "../packages/safi-client/index.js";
import {
  ChatGPTSiteAdapter,
  COMPANION_PERMISSIONS,
  COMPANION_STATUS,
  COMPANION_VERTICAL_SLICE_STATUS,
  ScriptedCompanionAdapter,
  assertCompanionSiteAdapter,
  createCompanionPermissions,
  createCompanionVerticalSlice,
  createManualFallback,
  sha256Text,
} from "../packages/companion/index.js";

/* A deliberately tiny DOM fixture: it implements only the standard surface
 * used by the adapter, making the safety tests independent of a browser. */
class FakeNode {
  public tagName: string;
  public attrs: Record<string, string> = {};
  public children: FakeNode[] = [];
  public parentNode: FakeNode | null = null;
  public ownerDocument: FakeDocument;
  public hidden = false;
  public value = "";
  public events: unknown[] = [];
  public textValue: string | null = null;
  public textContentReads = 0;
  public nodeSelectorMap: Record<string, boolean> = {};

  constructor(tagName: string, ownerDocument: FakeDocument, text: string | null = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.textValue = text;
  }

  setAttribute(name: string, value: string) { this.attrs[name] = String(value); }
  removeAttribute(name: string) { delete this.attrs[name]; }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  hasAttribute(name: string) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  appendChild<T extends FakeNode>(child: T): T {
    child.remove();
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore<T extends FakeNode>(child: T, before: FakeNode | null): T {
    child.remove();
    child.parentNode = this;
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }
  closest(selector: string): FakeNode | null {
    let current: FakeNode | null = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parentNode;
    }
    return null;
  }
  matches(selector: string): boolean {
    if (this.nodeSelectorMap[selector]) return true;
    const tag = this.tagName.toLowerCase();
    if (selector === tag) return true;
    if (selector === "form" && tag === "form") return true;
    if (selector === "main" && tag === "main") return true;
    if (selector === "article" && tag === "article") return true;
    if (selector === ".markdown" && this.attrs.class?.split(/\s+/).includes("markdown")) return true;
    const attrExact = /^\[([^=\]]+)=["']([^"']*)["']\]$/.exec(selector);
    if (attrExact && this.getAttribute(attrExact[1]!) === attrExact[2]) return true;
    const attrPresence = /^\[([^=\]]+)\]$/.exec(selector);
    if (attrPresence && this.hasAttribute(attrPresence[1]!)) return true;
    const attrContains = /^\[([^=\]]+)\*=["']([^"']*)["']\]$/.exec(selector);
    if (attrContains && String(this.getAttribute(attrContains[1]!) ?? "").toLowerCase().includes(attrContains[2]!.toLowerCase())) return true;
    const tagAttrExact = /^([a-z][\w-]*)\[([^=\]]+)=["']([^"']*)["']\]$/.exec(selector);
    if (tagAttrExact && tag === tagAttrExact[1] && this.getAttribute(tagAttrExact[2]!) === tagAttrExact[3]) return true;
    const tagAttrPresence = /^([a-z][\w-]*)\[([^=\]]+)\]$/.exec(selector);
    if (tagAttrPresence && tag === tagAttrPresence[1] && this.hasAttribute(tagAttrPresence[2]!)) return true;
    if (selector.includes(" ") && this.querySelectorAll(selector).length > 0) return true;
    return false;
  }
  descendants(): FakeNode[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
  querySelectorAll(selector: string): FakeNode[] {
    return this.descendants().filter((node) => node.matches(selector));
  }
  querySelector(selector: string): FakeNode | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  dispatchEvent(event: unknown) { this.events.push(event); return true; }
  get textContent(): string {
    this.textContentReads += 1;
    if (this.tagName === "TEXTAREA") return this.value;
    if (this.textValue !== null) return this.textValue;
    return this.children.map((child) => child.textContent).join("");
  }
  set textContent(value: string) {
    this.children = [];
    this.textValue = String(value);
  }
}

class FakeDocument extends FakeNode {
  public location = { hostname: "chatgpt.com", href: "https://chatgpt.com/" };
  public defaultView: any;
  public createCalls = 0;

  constructor() {
    super("#document", undefined as never);
    this.ownerDocument = this;
    class TextAreaElement {}
    Object.defineProperty(TextAreaElement.prototype, "value", {
      configurable: true,
      get(this: FakeNode) { return this.value; },
      set(this: FakeNode, next: string) { this.value = next; },
    });
    this.defaultView = {
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      HTMLTextAreaElement: TextAreaElement,
      Event,
    };
  }
  createElement(tagName: string): FakeNode {
    this.createCalls += 1;
    return new FakeNode(tagName, this);
  }
}

function makeChatDom(): { document: FakeDocument; composer: FakeNode; assistant: FakeNode; content: FakeNode; secret: FakeNode } {
  const document = new FakeDocument();
  const main = document.createElement("main");
  main.setAttribute("role", "main");
  document.appendChild(main);
  const form = document.createElement("form");
  form.setAttribute("aria-label", "ChatGPT prompt");
  main.appendChild(form);
  const composer = document.createElement("textarea");
  composer.setAttribute("data-testid", "prompt-textarea");
  composer.setAttribute("aria-label", "Message ChatGPT");
  composer.setAttribute("placeholder", "Message ChatGPT");
  composer.value = "mi spieghi in modo semplice perché il cielo è blu?";
  form.appendChild(composer);

  const user = document.createElement("article");
  user.setAttribute("data-message-author-role", "user");
  main.appendChild(user);
  const assistant = document.createElement("article");
  assistant.setAttribute("data-message-author-role", "assistant");
  const content = document.createElement("div");
  content.setAttribute("class", "markdown");
  content.textContent = "Il cielo appare blu perché la luce del Sole viene dispersa in modo diverso dai colori.";
  assistant.appendChild(content);
  main.appendChild(assistant);

  // Deliberately unrelated content outside the recognized main/conversation
  // scope. No adapter operation may return it.
  const secret = document.createElement("div");
  secret.textContent = "UNRELATED PRIVATE DATA";
  document.appendChild(secret);
  return { document, composer, assistant, content, secret };
}

function makeClient() {
  const verify = vi.fn(async ({ answer, providerId }: { answer: string; providerId: string }) => {
    const certificate = {
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
    };
    return { kind: "result" as const, answer, certificate };
  });
  return {
    translate: vi.fn(({ message }: { message: string }) => ({
      semantic: {
        kind: "semantic-representation/v0.1",
        goal: "answer the person's request",
        task: message.replace(/[?.!]+$/g, "").trim(),
        originalMessage: message,
        interpretationNotes: [],
        translatedBy: "test-translator",
      },
    })),
    verify,
  };
}

/** A deterministic clock: no wall-clock timers, no leaked observer loops. */
function deterministicClock() {
  let t = 0;
  return {
    nowMs: () => t,
    sleep: async (ms: number) => { t += Math.max(1, ms); },
  };
}

function grantAll() {
  const permissions = createCompanionPermissions();
  for (const permission of Object.values(COMPANION_PERMISSIONS)) {
    permissions.grant(permission, { userGesture: true });
  }
  return permissions;
}

describe("Companion contract and permissions", () => {
  it("keeps the Phase 7 acceptance status explicit", () => {
    expect(COMPANION_VERTICAL_SLICE_STATUS).toBe("PHASE 7 VERTICAL SLICE — AWAITING HUMAN ACCEPTANCE");
  });

  it("requires the full provider-neutral site-adapter surface", () => {
    expect(() => assertCompanionSiteAdapter({ detect() {} })).toThrow(/missing captureComposer/);
    expect(SITE_ADAPTER_METHODS_FOR_TEST).toHaveLength(8);
  });

  it("starts with no sensitive permission and requires a user gesture to grant", () => {
    const permissions = createCompanionPermissions();
    expect(permissions.snapshot().granted).toEqual({
      [COMPANION_PERMISSIONS.COMPOSER_READ]: false,
      [COMPANION_PERMISSIONS.COMPOSER_WRITE]: false,
      [COMPANION_PERMISSIONS.RESPONSE_READ]: false,
    });
    expect(() => permissions.grant(COMPANION_PERMISSIONS.COMPOSER_READ)).toThrow(/explicit user gesture/);
    permissions.grant(COMPANION_PERMISSIONS.COMPOSER_READ, { userGesture: true });
    expect(permissions.isGranted(COMPANION_PERMISSIONS.COMPOSER_READ)).toBe(true);
    permissions.revoke(COMPANION_PERMISSIONS.COMPOSER_READ);
    expect(permissions.isGranted(COMPANION_PERMISSIONS.COMPOSER_READ)).toBe(false);
    expect(() => permissions.require(COMPANION_PERMISSIONS.COMPOSER_READ, { userGesture: true })).toThrow(/not been granted/);
  });

  it("manual fallback captures nothing and cannot send", () => {
    const fallback = createManualFallback("DOM changed");
    expect(fallback.mode).toBe("MANUAL");
    expect(fallback.capturesAnything).toBe(false);
    expect(fallback.automaticSend).toBe(false);
    expect(fallback.status).toBe(COMPANION_STATUS.COMPANION_UNAVAILABLE);
  });
});

// Keep the expected method count local and explicit without coupling tests to
// implementation internals.
const SITE_ADAPTER_METHODS_FOR_TEST = [
  "detect", "captureComposer", "insertPrompt", "observeResponse",
  "isResponseStreaming", "captureFinalResponse", "attachProjection", "healthCheck",
];

describe("ChatGPTSiteAdapter — DOM safety", () => {
  it("detects a supported page using semantic signals and scopes content reads", () => {
    const { document, composer, content, secret } = makeChatDom();
    const adapter = new ChatGPTSiteAdapter({ document, window: document.defaultView });
    const detection = adapter.detect();
    expect(detection.supported).toBe(true);
    expect(detection.signals).toEqual(expect.arrayContaining(["chatgpt-host", "semantic-main", "semantic-composer"]));
    const captured = adapter.captureComposer({ authorized: true, userGesture: true });
    // The first snapshot is never certifiable: the exact same text must
    // survive a second consecutive window.
    const stabilizing = adapter.captureFinalResponse({ authorized: true, userGesture: true });
    expect(stabilizing.status).toBe("STABILIZING");
    expect(stabilizing.text).toBeNull();
    expect(stabilizing.certifiable).toBe(false);
    const final = adapter.captureFinalResponse({ authorized: true, userGesture: true });
    expect(captured.text).toBe(composer.value);
    expect(final.status).toBe("FINAL");
    expect(final.text).toBe(content.textContent);
    expect(captured.text).not.toContain(secret.textContent);
    expect(final.text).not.toContain(secret.textContent);
  });

  it("fails closed when the semantic composer DOM is modified", () => {
    const { document, composer } = makeChatDom();
    composer.attrs = {};
    const adapter = new ChatGPTSiteAdapter({ document, window: document.defaultView });
    expect(adapter.detect().supported).toBe(false);
    expect(adapter.healthCheck().ok).toBe(false);
    const result = adapter.captureComposer({ authorized: true, userGesture: true });
    expect(result.status).toBe("COMPANION_UNAVAILABLE");
  });

  it("does not return partial streaming text and keeps the response unchanged when projecting", () => {
    const { document, assistant, content } = makeChatDom();
    assistant.setAttribute("data-streaming", "true");
    const adapter = new ChatGPTSiteAdapter({ document, window: document.defaultView });
    const streaming = adapter.captureFinalResponse({ authorized: true, userGesture: true });
    expect(streaming.status).toBe("STREAMING");
    expect(streaming.text).toBeNull();
    expect(streaming.certifiable).toBe(false);
    assistant.removeAttribute?.("data-streaming");

    const before = content.textContent;
    const projection = adapter.attachProjection(
      { trustStatus: "VERIFIED", label: "Verificato", responseSha256: "a".repeat(64) },
      { authorized: true, userGesture: true },
    );
    expect(projection.ok).toBe(true);
    expect(projection.responseUnchanged).toBe(true);
    expect(content.textContent).toBe(before);
  });

  it("never exposes a DOM read without explicit authorization", () => {
    const { document } = makeChatDom();
    const adapter = new ChatGPTSiteAdapter({ document, window: document.defaultView });
    expect(adapter.captureComposer().status).toBe("PERMISSION_REQUIRED");
    expect(adapter.captureFinalResponse().status).toBe("PERMISSION_REQUIRED");
    expect(adapter.insertPrompt("x").status).toBe("PERMISSION_REQUIRED");
  });

  it("writes only the authorized composer and never invokes a send control", () => {
    const { document, composer } = makeChatDom();
    const adapter = new ChatGPTSiteAdapter({ document, window: document.defaultView });
    const result = adapter.insertPrompt("Prompt tradotto", { authorized: true, userGesture: true });
    expect(result).toMatchObject({ ok: true, status: "PROMPT_INSERTED", sendTriggered: false });
    expect(composer.value).toBe("Prompt tradotto");
    expect(composer.events).toHaveLength(1);
  });

  it("supports a semantic contenteditable composer without treating its value shim as text", () => {
    const { document, composer } = makeChatDom();
    composer.tagName = "DIV";
    composer.attrs = { contenteditable: "true", role: "textbox", "aria-label": "Message ChatGPT" };
    composer.nodeSelectorMap["[contenteditable=\"true\"][role=\"textbox\"]"] = true;
    composer.value = "";
    composer.textContent = "testo originale";
    const adapter = new ChatGPTSiteAdapter({ document, window: document.defaultView });
    expect(adapter.detect().supported).toBe(true);
    const result = adapter.insertPrompt("testo tradotto", { authorized: true, userGesture: true });
    expect(result.ok).toBe(true);
    expect(composer.textContent).toBe("testo tradotto");
    expect(composer.value).toBe("");
  });

  it("fails closed for response reads on an unsupported origin without reading page text", () => {
    const { document, secret } = makeChatDom();
    document.location.hostname = "example.com";
    const adapter = new ChatGPTSiteAdapter({ document, window: document.defaultView });
    const result = adapter.captureFinalResponse({ authorized: true, userGesture: true });
    expect(result.status).toBe("COMPANION_UNAVAILABLE");
    expect(secret.textContentReads).toBe(0);
  });
});

describe("Companion vertical slice — explicit Human → AI → AI flow", () => {
  it("captures, translates, inserts only on explicit use, and never auto-sends", async () => {
    const adapter = new ScriptedCompanionAdapter({
      composerText: "mi spieghi in modo semplice perché il cielo è blu?",
      responseText: "Il cielo appare blu per la dispersione della luce.",
    });
    const client = makeClient();
    const slice = createCompanionVerticalSlice({ adapter, safiClient: client, permissions: grantAll(), hashText: async (text) => createHash("sha256").update(text).digest("hex") });

    const ready = await slice.preparePrompt({ userGesture: true });
    expect(ready.kind).toBe(COMPANION_STATUS.PROMPT_READY);
    expect(ready.original).toBe(adapter.composerText);
    expect(ready.translated).toContain("cielo");
    expect(ready.automaticSend).toBe(false);
    expect(adapter.inserted).toHaveLength(0);

    const inserted = await slice.usePreparedPrompt({ userGesture: true, promptId: ready.promptId });
    expect(inserted.kind).toBe("PROMPT_INSERTED");
    expect(adapter.inserted).toEqual([ready.translated]);
    expect(adapter.sendCount).toBe(0);
    expect(inserted.sent).toBe(false);
  });

  it("refuses to certify a streaming response, then verifies only the stable exact final text", async () => {
    const adapter = new ScriptedCompanionAdapter({
      composerText: "perché il cielo è blu?",
    });
    const client = makeClient();
    const clock = deterministicClock();
    const slice = createCompanionVerticalSlice({
      adapter,
      safiClient: client,
      permissions: grantAll(),
      hashText: async (text) => createHash("sha256").update(text).digest("hex"),
      nowMs: clock.nowMs,
      sleep: clock.sleep,
    });
    const ready = await slice.preparePrompt({ userGesture: true });
    await slice.usePreparedPrompt({ userGesture: true, promptId: ready.promptId });

    // The user presses send: the site creates the assistant turn.
    adapter.startNewTurn({ streaming: true });
    const streaming = await slice.observeAndVerify({ userGesture: true, timeoutMs: 5_000 });
    expect(streaming.kind).toBe(COMPANION_STATUS.STREAMING);
    expect(streaming.certified).toBe(false);
    expect(streaming.partialTextExposed).toBe(false);
    expect(client.verify).not.toHaveBeenCalled();

    adapter.appendChunk("Risposta finale esatta.\nSecondo paragrafo.");
    adapter.finishStreaming();
    const verified = await slice.observeAndVerify({ userGesture: true, timeoutMs: 5_000 });
    expect(verified.kind).toBe("VERIFIED");
    expect(verified.streamingCertified).toBe(false);
    expect(verified.exactFinalText).toBe(adapter.responseText);
    expect(verified.exactFinalTextSha256).toBe(createHash("sha256").update(adapter.responseText).digest("hex"));
    expect(verified.certificate.responseSha256).toBe(verified.exactFinalTextSha256);
    expect(verified.projection.separate).toBe(true);
    expect(verified.observation.sawStreaming).toBe(true);
    expect(adapter.projections).toHaveLength(1);
    expect(adapter.sendCount).toBe(0);
  });

  it("requires the explicit insertion step before observing a response", async () => {
    const adapter = new ScriptedCompanionAdapter({
      composerText: "perché il cielo è blu?",
      responseText: "Risposta finale.",
    });
    const client = makeClient();
    const slice = createCompanionVerticalSlice({ adapter, safiClient: client, permissions: grantAll(), hashText: async (text) => createHash("sha256").update(text).digest("hex") });
    const ready = await slice.preparePrompt({ userGesture: true });
    const callsBefore = adapter.calls.length;
    const result = await slice.observeAndVerify({ userGesture: true, timeoutMs: 20, stableMs: 0, pollMs: 1 });
    expect(ready.kind).toBe(COMPANION_STATUS.PROMPT_READY);
    expect(result.kind).toBe("ERROR");
    expect(adapter.calls).toHaveLength(callsBefore);
    expect(client.verify).not.toHaveBeenCalled();
  });

  it("uses the existing shared Verify path and binds its certificate to the exact final text", async () => {
    let providerCalls = 0;
    const client = createSafiClient({
      deps: {
        provider: {
          id: "phase7-test-provider",
          async execute() {
            providerCalls += 1;
            return { text: "unused", provider: "phase7-test-provider", attempt: 1 };
          },
        },
        verifiers: [{
          checkId: "coherence",
          async verify() {
            return { checkId: "coherence", outcome: "PASS" as const, detail: "ok" };
          },
        }],
      },
      policy: { id: "phase7-shared-client", scope: { requiredChecks: ["coherence"] }, maxCorrectionAttempts: 0 },
    });
    const adapter = new ScriptedCompanionAdapter({
      composerText: "mi spieghi in modo semplice perché il cielo è blu?",
      responseText: "Risposta finale esatta.\nSecondo paragrafo.",
    });
    const clock = deterministicClock();
    const slice = createCompanionVerticalSlice({
      adapter,
      safiClient: client,
      permissions: grantAll(),
      hashText: async (text) => createHash("sha256").update(text).digest("hex"),
      nowMs: clock.nowMs,
      sleep: clock.sleep,
    });

    const ready = await slice.preparePrompt({ userGesture: true });
    expect(providerCalls).toBe(0);
    const inserted = await slice.usePreparedPrompt({ userGesture: true, promptId: ready.promptId });
    expect(inserted.kind).toBe("PROMPT_INSERTED");
    adapter.startNewTurn({ streaming: false, text: "Risposta finale esatta.\nSecondo paragrafo." });
    const verified = await slice.observeAndVerify({ userGesture: true, timeoutMs: 5_000 });
    expect(verified.kind).toBe("VERIFIED");
    expect(providerCalls).toBe(0);
    expect(verified.certificate.provider).toBe(adapter.id);
    expect(verified.exactFinalText).toBe(adapter.responseText);
    expect(verified.certificate.responseSha256).toBe(createHash("sha256").update(adapter.responseText).digest("hex"));
    expect(client.getCertificate()?.responseSha256).toBe(verified.certificate.responseSha256);
    expect(adapter.sendCount).toBe(0);
    expect(adapter.projections).toHaveLength(1);
    expect(verified.privacy).toMatchObject({
      contentTelemetry: false,
      historyRead: false,
      clipboardRead: false,
      screenRead: false,
      ocr: false,
      otherTabsRead: false,
    });
  });

  it("refuses a certificate whose hash does not match the final text", async () => {
    const adapter = new ScriptedCompanionAdapter({
      composerText: "domanda",
      responseText: "Risposta esatta.",
    });
    const client = makeClient();
    const clock = deterministicClock();
    client.verify.mockImplementation(async ({ answer, providerId }: { answer: string; providerId: string }) => ({
      kind: "result" as const,
      answer,
      certificate: {
        trustStatus: "VERIFIED" as const,
        responseSha256: "f".repeat(64),
        provider: providerId,
        verificationScope: { requiredChecks: ["coherence"] },
      },
    }));
    const slice = createCompanionVerticalSlice({ adapter, safiClient: client, permissions: grantAll(), hashText: async (text) => createHash("sha256").update(text).digest("hex"), nowMs: clock.nowMs, sleep: clock.sleep });
    const ready = await slice.preparePrompt({ userGesture: true });
    await slice.usePreparedPrompt({ userGesture: true, promptId: ready.promptId });
    adapter.startNewTurn({ streaming: false, text: "Risposta esatta." });
    const result = await slice.observeAndVerify({ userGesture: true, timeoutMs: 5_000 });
    expect(result.kind).toBe("ERROR");
    expect(adapter.projections).toHaveLength(0);
  });

  it("does not certify a pre-existing final response as the new turn", async () => {
    const adapter = new ScriptedCompanionAdapter({
      composerText: "domanda",
    });
    // A completed answer from a previous turn already exists on the page.
    adapter.startNewTurn({ streaming: false, text: "Risposta vecchia." });
    const client = makeClient();
    const clock = deterministicClock();
    const slice = createCompanionVerticalSlice({ adapter, safiClient: client, permissions: grantAll(), hashText: async (text) => createHash("sha256").update(text).digest("hex"), nowMs: clock.nowMs, sleep: clock.sleep });
    const ready = await slice.preparePrompt({ userGesture: true });
    const inserted = await slice.usePreparedPrompt({ userGesture: true, promptId: ready.promptId });
    expect(inserted.observer.baselineTurns).toEqual(["scripted-response-1"]);

    const result = await slice.observeAndVerify({ userGesture: true, timeoutMs: 5_000 });
    expect(result.kind).toBe(COMPANION_STATUS.RESPONSE_OBSERVER_ARMED);
    expect(result.certified).toBe(false);
    expect(client.verify).not.toHaveBeenCalled();
    expect(adapter.projections).toHaveLength(0);

    // A genuinely new turn is still recognized afterwards.
    adapter.startNewTurn({ streaming: false, text: "Risposta nuova." });
    const verified = await slice.observeAndVerify({ userGesture: true, timeoutMs: 5_000 });
    expect(verified.kind).toBe("VERIFIED");
    expect(verified.exactFinalText).toBe("Risposta nuova.");
  });

  it("aborts back to STABILIZING when the text changes immediately before the projection", async () => {
    const adapter = new ScriptedCompanionAdapter({
      composerText: "domanda",
      responseText: "Risposta stabile.",
    });
    const client = makeClient();
    const clock = deterministicClock();
    const slice = createCompanionVerticalSlice({ adapter, safiClient: client, permissions: grantAll(), hashText: async (text) => createHash("sha256").update(text).digest("hex"), nowMs: clock.nowMs, sleep: clock.sleep });
    const ready = await slice.preparePrompt({ userGesture: true });
    await slice.usePreparedPrompt({ userGesture: true, promptId: ready.promptId });
    adapter.startNewTurn({ streaming: false, text: "Risposta stabile." });
    // The site keeps writing after the response looked complete.
    const originalVerify = client.verify.getMockImplementation()!;
    client.verify.mockImplementation(async (input: { answer: string; providerId: string }) => {
      adapter.responseText = "Risposta cambiata dopo la verifica.";
      return originalVerify(input);
    });
    const result = await slice.observeAndVerify({ userGesture: true, timeoutMs: 5_000 });
    expect(result.kind).toBe(COMPANION_STATUS.STABILIZING);
    expect(result.certified).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.observation.aborted).toBe(1);
    expect(result.partialTextExposed).toBe(false);
    expect(adapter.projections).toHaveLength(0);
  });

  it("offers Manual mode instead of touching an unrecognized DOM", async () => {
    const { document, composer } = makeChatDom();
    composer.attrs = {};
    const adapter = new ChatGPTSiteAdapter({ document, window: document.defaultView });
    const captureSpy = vi.spyOn(adapter, "captureComposer");
    const client = makeClient();
    const createCallsBefore = document.createCalls;
    const permissions = grantAll();
    const slice = createCompanionVerticalSlice({ adapter, safiClient: client, permissions, hashText: sha256Text });
    const result = await slice.preparePrompt({ userGesture: true });
    expect(result.kind).toBe(COMPANION_STATUS.COMPANION_UNAVAILABLE);
    expect(result.mode).toBe("MANUAL");
    expect(result.fallback.capturesAnything).toBe(false);
    expect(captureSpy).not.toHaveBeenCalled();
    expect(document.createCalls).toBe(createCallsBefore);
  });

  it("keeps the Companion implementation outside Core", () => {
    for (const file of [
      "packages/companion/site-adapter.js",
      "packages/companion/chatgpt-site-adapter.js",
      "packages/companion/vertical-slice.js",
      "packages/companion/scripted-adapter.js",
      "packages/companion/index.js",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/from ["']\.\.\/\.\.\/src\//);
      expect(source).not.toMatch(/\b(?:screenCapture|ocr|clipboard|tabs\.query|activeTab)\s*\(/);
      if (file === "packages/companion/site-adapter.js" || file.endsWith("vertical-slice.js")) {
        expect(source).not.toMatch(/ChatGPT|OpenAI|Gemini|Claude/);
      }
    }
  });
});
