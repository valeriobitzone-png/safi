#!/usr/bin/env node
/**
 * P7-LIVE-2 — real MV3 extension host for the live acceptance.
 *
 * Launches a dedicated Google Chrome instance with its own `--user-data-dir`
 * and the unpacked Companion extension via `--load-extension`, then drives it
 * over the DevTools protocol.  This is the *only* host that counts for the live
 * acceptance: the browser reinjects the content script on every document load.
 *
 * Commands:
 *   launch                       start the dedicated browser (survives the shell)
 *   targets                      list pages / service workers
 *   open <url>                   open a tab
 *   use <targetId>               select the active tab for later commands
 *   eval <script.js|->           run a script in the active tab
 *   shot <file.png>              capture a real PNG screenshot
 *   reload                       reload the active tab (proves reinjection)
 *   quit                         close the dedicated browser
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = process.argv.slice(2);
const command = args[0];
const port = Number(process.env.SAFI_LIVE_PORT || 9333);
const profileDir = process.env.SAFI_LIVE_PROFILE || resolve(root, ".safi-live-profile");
const extensionDir = resolve(root, "apps/companion-extension");

const endpoint = `http://127.0.0.1:${port}`;

async function targets() {
  const response = await fetch(`${endpoint}/json/list`);
  return response.json();
}

async function browserWsUrl() {
  const response = await fetch(`${endpoint}/json/version`);
  const info = await response.json();
  return info.webSocketDebuggerUrl;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: done, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else done(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.next++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout after 20s: ${method}`));
      }, 20_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); done(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((done, fail) => {
    ws.addEventListener("open", done, { once: true });
    ws.addEventListener("error", () => fail(new Error("cannot connect to the dedicated browser")), { once: true });
  });
  return new Cdp(ws);
}

async function browserConnect() {
  return connect(await browserWsUrl());
}

async function activePage(cdp, explicit) {
  let pages = [];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    pages = (await targets()).filter((t) => t.type === "page");
    if (pages.length > 0) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (explicit) {
    const found = pages.find((t) => t.id === explicit || t.id.startsWith(explicit));
    if (!found) throw new Error(`no page target matching ${explicit}; open pages: ${pages.map((t) => t.id).join(", ")}`);
    return found;
  }
  const remembered = process.env.SAFI_LIVE_TARGET;
  if (remembered) {
    const found = pages.find((t) => t.id === remembered);
    if (found) return found;
  }
  const preferred = pages.find((t) => /chatgpt\.com/.test(t.url)) ?? pages[0];
  if (!preferred) throw new Error("no page target is open");
  return preferred;
}

// `Emulation.setEmulatedMedia` is scoped to the CDP session that sends it, and
// each CLI invocation is its own process with its own session.  The requested
// preference is therefore stored next to the live profile and re-applied on
// every attach, so `motion reduce` keeps working across later commands.
const motionStatePath = join(root, ".safi-live-profile", "emulated-motion.json");

async function readEmulatedMotion() {
  try {
    const saved = JSON.parse(await readFile(motionStatePath, "utf8"));
    return saved.prefersReducedMotion === "reduce" ? "reduce" : "no-preference";
  } catch {
    return "no-preference";
  }
}

async function writeEmulatedMotion(value) {
  await mkdir(dirname(motionStatePath), { recursive: true });
  await writeFile(motionStatePath, JSON.stringify({ prefersReducedMotion: value }, null, 2));
}

async function withPage(handler, explicit) {
  // Attach directly to the page target socket: a flat session survives a
  // navigation without being invalidated by the browser target.
  const page = await activePage(null, explicit);
  if (!page.webSocketDebuggerUrl) throw new Error("the page target exposes no debugger url");
  const cdp = await connect(page.webSocketDebuggerUrl);
  activeCdp = cdp;
  try {
    await sendRaw("Emulation.setEmulatedMedia", {
      media: "screen",
      features: [{ name: "prefers-reduced-motion", value: await readEmulatedMotion() }],
    });
    return await handler({ cdp, page });
  } finally {
    activeCdp = null;
    try {
      cdp.ws.close();
    } catch {
      // already closed
    }
  }
}

async function launch() {
  await mkdir(profileDir, { recursive: true });
  const chromeArgs = [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${extensionDir}`,
    `--enable-unsafe-extension-debugging`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    "https://chatgpt.com/",
  ];
  // `open -na` hands the process to launchd, so the browser keeps running
  // after this shell exits; the acceptance needs a long-lived host.
  const child = spawn("open", ["-na", "Google Chrome", "--args", ...chromeArgs], { stdio: "ignore", detached: true });
  child.unref();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const list = await targets();
      const workers = list.filter((t) => t.type === "service_worker" || /companion-extension/.test(t.url));
      return { ok: true, port, profile: profileDir, extension: extensionDir, targets: list.length, extensionTargets: workers.map((t) => t.url) };
    } catch {
      // not up yet
    }
  }
  throw new Error("the dedicated browser did not expose a DevTools endpoint");
}

const commands = {
  async launch() {
    return launch();
  },  async targets() {
    const list = await targets();
    return {
      port,
      targets: list.map((t) => ({ id: t.id, type: t.type, url: t.url, title: t.title })),
    };
  },
  async loadUnpacked() {
    // Branded Chrome (>=137) refuses `--load-extension`, so the unpacked
    // extension is installed over the DevTools protocol instead. The browser is
    // still a real extension host: the content script is injected natively and
    // re-injected on every navigation.
    const cdp = await browserConnect();
    try {
      const result = await cdp.send("Extensions.loadUnpacked", { path: extensionDir });
      return { ok: true, extension: extensionDir, ...result };
    } finally {
      cdp.ws.close();
    }
  },
  async open() {
    const url = args[1];
    if (!url) throw new Error("usage: open <url>");
    const cdp = await browserConnect();
    try {
      const { targetId } = await cdp.send("Target.createTarget", { url });
      process.env.SAFI_LIVE_TARGET = targetId;
      return { targetId };
    } finally {
      cdp.ws.close();
    }
  },
  async use() {
    const list = await targets();
    const page = await activePage(null, args[1]);
    process.env.SAFI_LIVE_TARGET = page.id;
    return { targetId: page.id, url: page.url, count: list.length };
  },
  async eval() {
    const file = args[1];
    if (!file) throw new Error("usage: eval <script.js|->");
    const source = file === "-" ? await readStdin() : await readFile(resolve(root, file), "utf8");
    return withPage(async ({ page }) => {
      const result = await send(source);
      return { url: page.url, result };
    }, args[2]);
  },
  async isolated() {
    // A content script lives in its own isolated world, so its globals are
    // invisible to the page. `eval` drives the page; this drives the extension
    // exactly as the panel buttons do, without touching production code.
    const file = args[1];
    if (!file) throw new Error("usage: isolated <script.js|->");
    const source = file === "-" ? await readStdin() : await readFile(resolve(root, file), "utf8");
    return withPage(async ({ page, cdp }) => {
      const contexts = [];
      cdp.listeners.add((message) => {
        if (message.method === "Runtime.executionContextCreated") {
          contexts.push(message.params.context);
        }
      });
      await cdp.send("Runtime.enable");
      await new Promise((r) => setTimeout(r, 300));
      // ChatGPT runs an anti-abuse iframe and other extensions run their own
      // isolated worlds, so the Companion world is identified by the main frame
      // *and* by the bridge the content script actually published there.
      const tree = await cdp.send("Page.getFrameTree");
      const mainFrameId = tree.frameTree.frame.id;
      const candidates = contexts.filter((c) => c.auxData?.isDefault === false && c.auxData?.frameId === mainFrameId);
      let world = null;
      for (const candidate of candidates) {
        const probe = await cdp.send("Runtime.evaluate", {
          expression: "typeof globalThis.__SAFI_COMPANION_LIVE__",
          contextId: candidate.id,
          returnByValue: true,
        });
        if (probe.result?.value === "object") {
          world = candidate;
          break;
        }
      }
      if (!world) throw new Error(`no Companion world attached; candidates: ${JSON.stringify(candidates.map((c) => ({ id: c.id, origin: c.origin, name: c.name })))}`);
      const result = await cdp.send("Runtime.evaluate", {
        expression: `(async () => { ${source} })()`,
        contextId: world.id,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      }
      return { url: page.url, world: { id: world.id, origin: world.origin, name: world.name }, result: result.result?.value ?? null };
    }, args[2]);
  },
  async click() {
    // Trusted input: the click is produced by the browser input pipeline, so
    // the page and the content script see a real user gesture.
    const selector = args[1];
    if (!selector) throw new Error("usage: click <css-selector>");
    return withPage(async ({ page, cdp }) => {
      const box = await cdp.send("Runtime.evaluate", {
        expression: `(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null; n.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); return true; })()`,
        returnByValue: true,
      });
      if (box.result?.value !== true) throw new Error(`no element matches ${selector}`);
      // The site scrolls smoothly: measure only once the layout has settled.
      await new Promise((r) => setTimeout(r, 400));
      const measured = await cdp.send("Runtime.evaluate", {
        expression: `(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, text: (n.innerText || n.value || "").slice(0, 60) }; })()`,
        returnByValue: true,
      });
      const point = measured.result?.value;
      if (!point) throw new Error(`no element matches ${selector}`);
      // Input is delivered to the focused window: make the tab active first.
      await cdp.send("Page.bringToFront").catch(() => {});
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await cdp.send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
      }
      await new Promise((r) => setTimeout(r, 250));
      return { clicked: selector, at: { x: Math.round(point.x), y: Math.round(point.y) }, text: point.text, url: page.url };
    }, args[2]);
  },
  async type() {
    const text = args[1];
    if (!text) throw new Error("usage: type <text>");
    return withPage(async ({ page, cdp }) => {
      await cdp.send("Input.insertText", { text });
      await new Promise((r) => setTimeout(r, 200));
      const value = await cdp.send("Runtime.evaluate", {
        expression: `(() => { const n = document.querySelector('textarea[data-testid="prompt-textarea"], [data-testid="prompt-textarea"], [contenteditable="true"][role="textbox"]'); return n ? (n.value ?? n.innerText ?? "") : null; })()`,
        returnByValue: true,
      });
      return { typed: text.length, composer: value.result?.value ?? null, url: page.url };
    }, args[2]);
  },
  async resize() {
    const width = Number(args[1]);
    const height = Number(args[2]);
    if (!width || !height) throw new Error("usage: resize <width> <height>");
    const browser = await browserConnect();
    try {
      const page = await activePage(null, args[3]);
      const { windowId } = await browser.send("Browser.getWindowForTarget", { targetId: page.id });
      await browser.send("Browser.setWindowBounds", { windowId, bounds: { width, height } });
      return { windowId, width, height };
    } finally {
      browser.ws.close();
    }
  },
  async console() {
    // Collect page console output for a while, without touching the page.
    const seconds = Number(args[1] || 5);
    return withPage(async ({ cdp }) => {
      const lines = [];
      cdp.listeners.add((message) => {
        if (message.method === "Runtime.consoleAPICalled") {
          const text = (message.params.args ?? []).map((a) => String(a.value ?? a.description ?? "")).join(" ");
          lines.push(`console.${message.params.type}: ${text.slice(0, 300)}`);
        }
        if (message.method === "Runtime.exceptionThrown") {
          const details = message.params.exceptionDetails;
          lines.push(`exception: ${String(details?.exception?.description ?? details?.text).slice(0, 300)}`);
        }
      });
      await cdp.send("Runtime.enable");
      await new Promise((r) => setTimeout(r, seconds * 1000));
      return { lines };
    }, args[2]);
  },
  async key() {
    // A real key event through the input pipeline, used when a site overlay
    // covers the pointer target. The Companion is not involved.
    const key = args[1] ?? "Enter";
    const spec = { Enter: { windowsVirtualKeyCode: 13, code: "Enter", key: "Enter", text: "\r" } }[key];
    if (!spec) throw new Error(`usage: key Enter (unsupported key: ${key})`);
    return withPage(async ({ page, cdp }) => {
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...spec });
      await cdp.send("Input.dispatchKeyEvent", { type: "char", ...spec });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...spec });
      await new Promise((r) => setTimeout(r, 500));
      return { key, url: page.url };
    }, args[2]);
  },
  async motion() {
    // Emulate the OS "reduce motion" setting so the Companion stylesheet's
    // media query can be exercised against the real page.  Harness only.
    const mode = args[1] === "reduce" ? "reduce" : "no-preference";
    await writeEmulatedMotion(mode);
    return withPage(async ({ page }) => {
      const active = await sendRaw("Runtime.evaluate", {
        expression: "matchMedia('(prefers-reduced-motion: reduce)').matches",
        returnByValue: true,
      });
      return { prefersReducedMotion: mode, matched: active.result?.value ?? null, url: page.url };
    }, args[2]);
  },
  async shot() {
    const file = args[1];
    if (!file) throw new Error("usage: shot <file.png>");
    const target = resolve(root, file);
    return withPage(async ({ page, cdp }) => {
      const { data } = await sendRaw("Page.captureScreenshot", { format: "png" });
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(data, "base64"));
      return { file: target, url: page.url };
    }, args[2]);
  },
  async trace() {
    const seconds = Number(args[1] || 8);
    const page = await activePage(null, args[2]);
    const cdp = await connect(page.webSocketDebuggerUrl);
    activeCdp = cdp;
    const lines = [];
    const sessions = new Set();
    const record = (text) => { if (lines.length < 60) lines.push(text); };
    cdp.listeners.add((message) => {
      if (message.method === "Target.attachedToTarget") {
        const sessionId = message.params.sessionId;
        sessions.add(sessionId);
        cdp.send("Runtime.enable", {}, sessionId).catch(() => {});
        cdp.send("Log.enable", {}, sessionId).catch(() => {});
        cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
      }
      if (message.method === "Runtime.consoleAPICalled") {
        const text = (message.params.args ?? []).map((a) => String(a.value ?? a.description ?? "")).join(" ");
        record(`console.${message.params.type}: ${text.slice(0, 240)}`);
      }
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        record(`exception: ${String(details?.exception?.description ?? details?.text).slice(0, 300)}`);
      }
      if (message.method === "Log.entryAdded") {
        record(`log[${message.params.entry.level}] ${String(message.params.entry.text).slice(0, 240)}`);
      }
    });
    await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    // This socket *is* the page session: enable the domains here so the main
    // frame is instrumented from document start.
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.reload", { ignoreCache: false });
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const probe = await cdp.send("Runtime.evaluate", {
      expression: "JSON.stringify({ bridge: typeof globalThis.__SAFI_COMPANION_LIVE__, panel: !!document.getElementById('safi-companion-live-panel'), url: location.href })",
      returnByValue: true,
    });
    activeCdp = null;
    try {
      cdp.ws.close();
    } catch {
      // ignore
    }
    return { probe: probe.result?.value ?? null, log: lines };
  },
  async reload() {
    return withPage(async ({ page }) => {
      await sendRaw("Page.reload", { ignoreCache: false });
      await new Promise((r) => setTimeout(r, 2500));
      return { reloaded: true, url: page.url };
    }, args[1]);
  },
  async quit() {
    const cdp = await browserConnect();
    try {
      await cdp.send("Browser.close");
    } finally {
      cdp.ws.close();
    }
    return { closed: true };
  },
};

let activeCdp = null;
async function sendRaw(method, params) {
  if (!activeCdp) throw new Error("internal: no connection");
  return activeCdp.send(method, params);
}
async function send(source) {
  if (!activeCdp) throw new Error("internal: no connection");
  const result = await activeCdp.send("Runtime.evaluate", {
    expression: `(async () => { ${source} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result?.value ?? null;
}
async function readStdin() {
  if (process.stdin.isTTY) throw new Error("pipe the script into stdin when using '-'");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

if (!commands[command]) {
  console.error(`unknown command: ${command}`);
  process.exit(2);
}
const pageCommands = new Set(["eval", "isolated", "click", "type", "key", "console", "motion", "shot", "reload", "trace"]);
const targetArgument = pageCommands.has(command)
  ? (command === "reload" ? args[1] : command === "trace" ? args[2] : args[2])
  : undefined;
const result = await (pageCommands.has(command)
  ? withPage(commands[command], targetArgument)
  : commands[command]());
console.log(JSON.stringify(result, null, 2));
// Never let a lingering socket keep the CLI alive.
process.exit(0);
