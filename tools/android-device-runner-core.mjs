import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ANDROID_PACKAGE = "dev.safi.app";
export const ANDROID_ACTIVITY = `${ANDROID_PACKAGE}/.MainActivity`;
export const SAFI_TARGET_URL = "https://appassets.androidplatform.net/assets/index.html";
export const RUNNER_TIMEOUTS = Object.freeze({
  adb: 10_000,
  appBoot: 20_000,
  webviewTarget: 20_000,
  ask: 15_000,
  verify: 15_000,
  cdpCommand: 5_000,
});

export class SkipError extends Error {}
export class TestFailure extends Error {}

export function createSystemAdapter({
  exec,
  fetch,
  connectWebSocket,
  env,
  now = Date.now,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  allocatePort,
}) {
  return Object.freeze({
    exec,
    fetch,
    connectWebSocket,
    env,
    now,
    sleep,
    allocatePort,
  });
}

export function parseAdbDevices(output) {
  return String(output ?? "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2)
    .map(([serial, state]) => ({ serial, state }));
}

export function selectAndroidDevice(devices, requestedSerial) {
  const requested = requestedSerial?.trim();
  if (requested) {
    const match = devices.find((device) => device.serial === requested);
    if (!match) throw new SkipError(`Requested Android device ${requested} not found`);
    if (match.state === "unauthorized") {
      throw new SkipError(`Requested device is not authorized: ${requested}`);
    }
    if (match.state !== "device") {
      throw new SkipError(`Requested device is not available: ${requested} (${match.state})`);
    }
    return requested;
  }

  const authorized = devices.filter((device) => device.state === "device");
  if (authorized.length === 0) {
    const diagnostics = devices
      .filter((device) => device.state !== "device")
      .map((device) => `${device.state}: ${device.serial}`)
      .join(", ");
    throw new SkipError(
      `No authorized Android device${diagnostics ? ` (${diagnostics})` : ""}`,
    );
  }
  if (authorized.length > 1) {
    throw new SkipError("Multiple Android devices detected. Set SAFI_ANDROID_SERIAL.");
  }
  return authorized[0].serial;
}

export function parseWebViewSockets(procNetUnix) {
  return [
    ...new Set(
      [...String(procNetUnix ?? "").matchAll(/@(webview_devtools_remote_[A-Za-z0-9_.-]+)/g)]
        .map((match) => match[1]),
    ),
  ];
}

export function selectWebViewSocket(sockets, packagePid) {
  const unique = [...new Set(sockets)];
  if (unique.length === 0) {
    throw new SkipError("WebView debugging endpoint not available");
  }
  if (packagePid) {
    const safiSocket = `webview_devtools_remote_${packagePid}`;
    if (unique.includes(safiSocket)) return safiSocket;
    throw new SkipError("Safi WebView debugging endpoint not available");
  }
  if (unique.length === 1) return unique[0];
  throw new TestFailure(
    "Multiple WebView debugging endpoints detected. Unable to correlate one with dev.safi.app.",
  );
}

export function selectCdpTarget(targets, expectedUrl = SAFI_TARGET_URL) {
  const matches = targets.filter(
    (target) =>
      target?.url === expectedUrl &&
      (target.type === undefined || target.type === "page"),
  );
  if (matches.length > 1) {
    throw new TestFailure("Ambiguous Safi CDP target: multiple matching pages");
  }
  return matches[0];
}

export function classifyPrerequisiteFailure(error, binary) {
  if (binary === "adb" && error?.code === "ENOENT") {
    return new SkipError("adb not available");
  }
  return error;
}

async function command(adapter, binary, args, timeout = RUNNER_TIMEOUTS.adb) {
  let result;
  try {
    result = await adapter.exec(binary, args, timeout);
  } catch (error) {
    throw classifyPrerequisiteFailure(error, binary);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new Error(`${binary} ${args.join(" ")} failed: ${detail}`);
  }
  return String(result.stdout ?? "").trim();
}

async function selectDevice(adapter) {
  try {
    await command(adapter, "adb", ["version"]);
  } catch (error) {
    if (error instanceof SkipError) throw error;
    throw new SkipError(`adb not available: ${error.message}`);
  }
  let output;
  try {
    output = await command(adapter, "adb", ["devices"]);
  } catch (error) {
    if (error instanceof SkipError) throw error;
    throw new SkipError(`Unable to list Android devices: ${error.message}`);
  }
  return selectAndroidDevice(parseAdbDevices(output), adapter.env.SAFI_ANDROID_SERIAL);
}

async function adbFor(adapter, serial, args, timeout = RUNNER_TIMEOUTS.adb) {
  return command(adapter, "adb", ["-s", serial, ...args], timeout);
}

async function currentWebViewSocket(adapter, serial) {
  const procNetUnix = await adbFor(adapter, serial, ["shell", "cat", "/proc/net/unix"]);
  let packagePid;
  try {
    packagePid = await adbFor(adapter, serial, ["shell", "pidof", ANDROID_PACKAGE], 2_000);
  } catch {
    // The socket selector remains deterministic without a PID.
  }
  return selectWebViewSocket(parseWebViewSockets(procNetUnix), packagePid);
}

async function listTargets(adapter, port) {
  const response = await adapter.fetch(`http://127.0.0.1:${port}/json`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`CDP target list returned HTTP ${response.status}`);
  return response.json();
}

export async function discoverSafiTarget(adapter, serial, forwards) {
  const deadline = adapter.now() + RUNNER_TIMEOUTS.webviewTarget;
  let sawSocket = false;
  let lastCdpError;

  while (adapter.now() < deadline) {
    let socket;
    try {
      socket = await currentWebViewSocket(adapter, serial);
      sawSocket = true;
    } catch (error) {
      if (!(error instanceof SkipError)) throw error;
      await adapter.sleep(300);
      continue;
    }

    const port = await adapter.allocatePort();
    try {
      await adbFor(adapter, serial, ["forward", `tcp:${port}`, `localabstract:${socket}`]);
    } catch (error) {
      throw new TestFailure(`Safi WebView socket became unavailable: ${error.message}`);
    }
    forwards.add(port);
    let keepForward = false;
    try {
      let targets;
      try {
        targets = await listTargets(adapter, port);
        lastCdpError = undefined;
      } catch (error) {
        lastCdpError = error;
      }
      if (targets) {
        const target = selectCdpTarget(targets);
        if (target) {
          keepForward = true;
          return { port, socket, target };
        }
      }
    } finally {
      if (!keepForward) {
        let removed = false;
        try {
          await adbFor(adapter, serial, ["forward", "--remove", `tcp:${port}`], 2_000);
          removed = true;
        } catch {
          // Keep the port tracked so the final cleanup can retry it.
        }
        if (removed) forwards.delete(port);
      }
    }
    await adapter.sleep(300);
  }

  if (lastCdpError) {
    throw new TestFailure(`Safi WebView CDP endpoint unreachable: ${lastCdpError.message}`);
  }
  throw new SkipError(
    sawSocket
      ? `Expected Safi WebView target not found: ${SAFI_TARGET_URL}`
      : "WebView debugging endpoint not available",
  );
}

export class CdpClient extends EventEmitter {
  constructor(webSocketDebuggerUrl, connectWebSocket) {
    super();
    this.sequence = 0;
    this.pending = new Map();
    this.disconnectError = null;
    this.socket = connectWebSocket(webSocketDebuggerUrl);
    this.socket.addEventListener("message", (event) => this.onMessage(event));
    this.socket.addEventListener("error", (event) => this.emit("socketError", event));
    this.socket.addEventListener("close", (event) => this.onClose(event));
  }

  async ready() {
    if (this.socket.readyState === 1) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.removeEventListener("open", onOpen);
        this.socket.removeEventListener("error", onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("CDP WebSocket connection failed"));
      };
      const timer = setTimeout(onError, RUNNER_TIMEOUTS.cdpCommand);
      this.socket.addEventListener("open", onOpen, { once: true });
      this.socket.addEventListener("error", onError, { once: true });
    });
  }

  onClose() {
    if (this.disconnectError) return;
    this.disconnectError = new Error("CDP WebSocket disconnected");
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(this.disconnectError);
    }
    this.pending.clear();
    this.emit("disconnect", this.disconnectError);
  }

  onMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch (error) {
      this.emit("protocolError", error);
      return;
    }
    if (message.id !== undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    this.emit(message.method, message.params ?? {});
  }

  send(method, params = {}, timeoutMs = RUNNER_TIMEOUTS.cdpCommand) {
    if (this.disconnectError || this.socket.readyState !== 1) {
      return Promise.reject(this.disconnectError ?? new Error("CDP WebSocket is not connected"));
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("CDP connection closed"));
    }
    this.pending.clear();
    if (this.socket.readyState === 3) return true;
    if (this.socket.readyState !== 0 && this.socket.readyState !== 1) return false;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 1_000);
      this.socket.addEventListener("close", () => {
        clearTimeout(timer);
        resolve(true);
      }, { once: true });
      try {
        this.socket.close();
      } catch {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }
}

export async function evaluate(cdp, expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "Runtime.evaluate failed",
    );
  }
  return response.result?.value;
}

export async function waitForValue(
  adapter,
  cdp,
  expression,
  ready,
  timeoutMs,
  label,
) {
  const deadline = adapter.now() + timeoutMs;
  let lastError;
  while (adapter.now() < deadline) {
    if (cdp.disconnectError) throw cdp.disconnectError;
    try {
      const value = await evaluate(cdp, expression);
      if (ready(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await adapter.sleep(150);
  }
  const suffix = lastError ? `; last error: ${lastError.message}` : "";
  throw new Error(`${label} timed out after ${timeoutMs}ms${suffix}`);
}

function setInputAndClick(selector, value, buttonSelector) {
  return `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const button = document.querySelector(${JSON.stringify(buttonSelector)});
    if (!input || !button) return false;
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: ${JSON.stringify(value)} }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    button.click();
    return true;
  })()`;
}

function assert(condition, message) {
  if (!condition) throw new TestFailure(message);
}

const STYLE_PROPERTIES = [
  "color",
  "backgroundColor",
  "borderColor",
  "outlineColor",
  "boxShadow",
  "opacity",
  "fontSize",
  "fontWeight",
];

function colorChannels(value) {
  return [...String(value ?? "").matchAll(/rgba?[(][ \t\r\n]*([0-9.]+)[ \t\r\n]*,[ \t\r\n]*([0-9.]+)[ \t\r\n]*,[ \t\r\n]*([0-9.]+)(?:[ \t\r\n]*,[ \t\r\n]*([0-9.]+))?[ \t\r\n]*[)]/g)]
    .map((match) => [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      match[4] === undefined ? 1 : Number(match[4]),
    ]);
}

function styleHasGreen(value) {
  return colorChannels(value).some(([r, g, b, a]) => a > 0 && g > r + 12 && g > b + 12);
}

function styleHasBlue(value) {
  return colorChannels(value).some(([r, g, b, a]) => a > 0 && b > r + 30 && b > g + 20);
}

function styleHasRed(value) {
  return colorChannels(value).some(([r, g, b, a]) => a > 0 && r > g + 45 && r > b + 45);
}

function assertStyleSnapshot(snapshot, label) {
  for (const property of STYLE_PROPERTIES) {
    assert(typeof snapshot?.[property] === "string", `${label} computed ${property} is missing`);
  }
}

function assertNoGreenStyles(styles, selectors, label) {
  for (const selector of selectors) {
    const snapshot = styles?.[selector];
    assertStyleSnapshot(snapshot, `${label}.${selector}`);
    for (const property of STYLE_PROPERTIES) {
      assert(
        !styleHasGreen(snapshot[property]),
        `${label}.${selector}.${property} contains a non-semantic green: ${snapshot[property]}`,
      );
    }
  }
}

async function capture(cdp, artifactsDir, filename, report) {
  try {
    const { data } = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    writeFileSync(join(artifactsDir, filename), Buffer.from(data, "base64"));
    report.screenshots[filename] = "saved";
  } catch (error) {
    report.screenshots[filename] = `skipped: ${error.message}`;
  }
}

function printReport(report, logger) {
  logger.log("SAFI Android Device Runtime Test\n");
  if (report.device) logger.log(`Device: ${report.device.model} / Android ${report.device.android}`);
  logger.log(`Package: ${report.package}`);
  if (report.webViewSocket) logger.log(`WebView: connected (${report.webViewSocket})`);
  logger.log("");
  for (const item of report.checks) {
    logger.log(`${item.label.padEnd(30)} ${item.value}`);
  }
  if (report.reason) {
    logger.log(`\n${report.result === "FAIL" ? "Primary failure" : "Reason"}: ${report.reason}`);
  }
  for (const error of report.cleanup.errors) {
    logger.log(`Cleanup warning: ${error}`);
  }
  if (report.runtimeErrors.length > 0) {
    logger.log("\nRuntime errors:");
    for (const error of report.runtimeErrors) logger.log(`- ${error}`);
  }
  logger.log(`\nRESULT: ${report.result}`);
}

export async function runAndroidDeviceTest({
  adapter,
  artifactsDir,
  logger = console,
}) {
  mkdirSync(artifactsDir, { recursive: true });
  const report = {
    schema: "safi-android-device-runtime/v1",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: "FAIL",
    reason: null,
    package: ANDROID_PACKAGE,
    device: null,
    webViewSocket: null,
    checks: [],
    runtimeErrors: [],
    lifecycle: [],
    screenshots: {},
    visualStates: {},
    cleanup: {
      websocketClosed: false,
      forwardsRemoved: false,
      appStopped: false,
      errors: [],
    },
  };
  const forwards = new Set();
  let serial;
  let cdp;
  let appLaunchAttempted = false;

  const check = (label, value, details) => {
    report.checks.push({ label, value, ...(details === undefined ? {} : { details }) });
  };
  const recordError = (source, value) => {
    const message = `${source}: ${String(value).trim()}`;
    if (!report.runtimeErrors.includes(message)) report.runtimeErrors.push(message);
  };
  const drainRejections = async () => {
    const rejections = await evaluate(
      cdp,
      "globalThis.__safiAndroidDeviceTestRejections.splice(0)",
    );
    for (const rejection of rejections ?? []) recordError("unhandledrejection", rejection);
  };

  try {
    serial = await selectDevice(adapter);
    const model = await adbFor(adapter, serial, ["shell", "getprop", "ro.product.model"]);
    const android = await adbFor(adapter, serial, ["shell", "getprop", "ro.build.version.release"]);
    report.device = { serial, model, android };

    const packagePath = await adbFor(adapter, serial, ["shell", "pm", "path", ANDROID_PACKAGE], 2_000);
    if (!packagePath.startsWith("package:")) {
      throw new SkipError(`Package ${ANDROID_PACKAGE} is not installed`);
    }

    await adbFor(adapter, serial, ["shell", "am", "force-stop", ANDROID_PACKAGE]);
    appLaunchAttempted = true;
    await adbFor(
      adapter,
      serial,
      ["shell", "am", "start", "-W", "-n", ANDROID_ACTIVITY],
      RUNNER_TIMEOUTS.appBoot,
    );

    const discovered = await discoverSafiTarget(adapter, serial, forwards);
    report.webViewSocket = discovered.socket;
    cdp = new CdpClient(discovered.target.webSocketDebuggerUrl, adapter.connectWebSocket);
    await cdp.ready();

    cdp.on("Runtime.exceptionThrown", (params) => {
      const details = params.exceptionDetails;
      recordError("exception", details.exception?.description ?? details.text ?? "unknown exception");
    });
    cdp.on("Runtime.consoleAPICalled", (params) => {
      if (params.type !== "error") return;
      const text = (params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue ?? "")
        .join(" ");
      recordError("console.error", text || "empty console.error");
    });
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await evaluate(
      cdp,
      `(() => {
        globalThis.__safiAndroidDeviceTestRejections = [];
        globalThis.addEventListener("unhandledrejection", (event) => {
          const reason = event.reason;
          __safiAndroidDeviceTestRejections.push(
            reason instanceof Error ? reason.stack || reason.message : String(reason)
          );
        });
        return true;
      })()`,
    );

    const boot = await waitForValue(
      adapter,
      cdp,
      `({
        brain: typeof window.SafiBrain === "object",
        send: Boolean(document.querySelector("#send")),
        verify: Boolean(document.querySelector("#verify")),
        stamp: Boolean(customElements.get("safi-stamp"))
      })`,
      (value) => value?.brain && value?.send && value?.verify && value?.stamp,
      RUNNER_TIMEOUTS.appBoot,
      "WebView boot",
    );
    check("Boot", "PASS");
    check("SafiBrain", boot.brain ? "PASS" : "FAIL");
    check("#send", boot.send ? "PASS" : "FAIL");
    check("#verify", boot.verify ? "PASS" : "FAIL");
    check("safi-stamp", boot.stamp ? "PASS" : "FAIL");

    const firstMessage = "come creo un app con una bella grafica?";
    assert(
      await evaluate(cdp, setInputAndClick("#speak", firstMessage, "#send")),
      "Ask input or #send was not available",
    );
    check("Ask DOM click", "PASS");
    const firstAsk = await waitForValue(
      adapter,
      cdp,
      `(() => {
        const answer = document.querySelector("#answer");
        const stamp = document.querySelector("#stamp");
        const text = answer?.textContent ?? "";
        const marker = "Tradotto da Safi\\n\\n";
        const styleOf = (element) => {
          if (!element) return null;
          const style = getComputedStyle(element);
          return {
            color: style.color,
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
            outlineColor: style.outlineColor,
            boxShadow: style.boxShadow,
            opacity: style.opacity,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight
          };
        };
        return {
          ready: answer?.getAttribute("aria-label") === "Prompt pronto" && !answer.hidden,
          promptReadyVisible: text.includes("✦ Prompt pronto"),
          attributionVisible: text.includes("Tradotto da Safi"),
          promptText: text.includes(marker) ? text.slice(text.indexOf(marker) + marker.length).trim() : "",
          trustVerdict: /VERIFIED|UNCERTAIN|FAILED|trustStatus|certificate/i.test(text),
          hasCertificate: Boolean(stamp?._source),
          stampHidden: stamp?.hidden !== false,
          styles: {
            send: styleOf(document.querySelector("#send")),
            answer: styleOf(answer),
            microstate: styleOf(document.querySelector("#microstate"))
          }
        };
      })()`,
      (value) => value?.ready,
      RUNNER_TIMEOUTS.ask,
      "Ask result",
    );
    assert(firstAsk.promptReadyVisible, "Ask prompt heading is not visible");
    assert(firstAsk.attributionVisible, "Ask attribution is not visible");
    assert(firstAsk.promptText.length > 0, "Ask prompt text is empty");
    assert(!firstAsk.trustVerdict, "Ask exposes a trust verdict or certificate text");
    assert(!firstAsk.hasCertificate, "Ask loaded a certificate into the stamp");
    assert(firstAsk.stampHidden, "Ask left the verification stamp visible");
    assertNoGreenStyles(firstAsk.styles, ["send", "answer", "microstate"], "Ask");
    assert(
      styleHasBlue(firstAsk.styles.send.backgroundColor) || styleHasBlue(firstAsk.styles.send.boxShadow),
      "Ask CTA does not use the blue brand accent",
    );
    check("Prompt Ready", "PASS");
    check("Ask has no trust verdict", "PASS");
    check("Ask computed styles", "PASS");
    report.lifecycle.push({ step: "ask", message: firstMessage, promptChars: firstAsk.promptText.length });
    await capture(cdp, artifactsDir, "ask-prompt-ready.png", report);
    report.visualStates.ask = {
      state: "PROMPT_READY",
      screenshot: "ask-prompt-ready.png",
      source: "real installed Android WebView",
      styles: firstAsk.styles,
      promptChars: firstAsk.promptText.length,
      runtimeErrors: [...report.runtimeErrors],
    };
    await drainRejections();

    const goodAnswer = "237 × 14 = 3318";
    assert(
      await evaluate(cdp, setInputAndClick("#paste-answer", goodAnswer, "#verify")),
      "Verify input or #verify was not available",
    );
    const verified = await waitForValue(
      adapter,
      cdp,
      `(() => {
        const answer = document.querySelector("#answer");
        const stamp = document.querySelector("#stamp");
        const styleOf = (element) => {
          if (!element) return null;
          const style = getComputedStyle(element);
          return {
            color: style.color,
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
            outlineColor: style.outlineColor,
            boxShadow: style.boxShadow,
            opacity: style.opacity,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight
          };
        };
        return {
          ready: answer?.getAttribute("aria-label") === "VERIFIED" && stamp && !stamp.hidden,
          trustStatus: stamp?._source?.trustStatus,
          certificateSchema: stamp?._source?.schema,
          stampVisible: Boolean(stamp && !stamp.hidden && stamp.getClientRects().length > 0),
          stampAria: stamp?.shadowRoot?.querySelector("button")?.getAttribute("aria-label") ?? "",
          styles: {
            stampGlyph: styleOf(stamp?.shadowRoot?.querySelector(".safi-glyph"))
          }
        };
      })()`,
      (value) => value?.ready,
      RUNNER_TIMEOUTS.verify,
      "Verify good result",
    );
    assert(verified.trustStatus === "VERIFIED", `Expected VERIFIED, got ${verified.trustStatus}`);
    assert(verified.certificateSchema === "safi-certificate/v0.1", "Verified result has no v0.1 certificate");
    assert(verified.stampVisible, "Verified stamp is not visible");
    assert(verified.stampAria.includes("Verificato"), "Verified stamp does not say Verificato");
    assertStyleSnapshot(verified.styles?.stampGlyph, "VERIFIED stamp");
    assert(styleHasGreen(verified.styles.stampGlyph.color), "VERIFIED stamp is not green");
    check("Verify correct", verified.trustStatus);
    check("Verify computed styles", "PASS");
    check("Verify certificate", "PASS");
    check("Verify stamp", "PASS");
    report.lifecycle.push({ step: "verify-good", answer: goodAnswer, trustStatus: verified.trustStatus });
    await capture(cdp, artifactsDir, "verify-good.png", report);
    report.visualStates.verified = {
      state: "VERIFIED",
      screenshot: "verify-good.png",
      source: "real installed Android WebView",
      styles: verified.styles,
      trustStatus: verified.trustStatus,
      runtimeErrors: [...report.runtimeErrors],
    };
    await drainRejections();

    const secondMessage = "spiegami semplicemente il moto perpetuo";
    assert(
      await evaluate(cdp, setInputAndClick("#speak", secondMessage, "#send")),
      "Second Ask input or #send was not available",
    );
    const secondAsk = await waitForValue(
      adapter,
      cdp,
      `(() => {
        const answer = document.querySelector("#answer");
        const stamp = document.querySelector("#stamp");
        const text = answer?.textContent ?? "";
        return {
          ready: answer?.getAttribute("aria-label") === "Prompt pronto" && !answer.hidden,
          originalMessage: text.includes("spiegami semplicemente il moto perpetuo"),
          promptTextLength: text.split("Tradotto da Safi\\n\\n")[1]?.trim().length ?? 0,
          trustVerdict: /VERIFIED|UNCERTAIN|FAILED|trustStatus|certificate/i.test(text),
          stampHidden: stamp?.hidden !== false,
          hasCertificate: Boolean(stamp?._source)
        };
      })()`,
      (value) => value?.ready,
      RUNNER_TIMEOUTS.ask,
      "Second Ask result",
    );
    assert(secondAsk.originalMessage, "Second Ask did not render the new human message");
    assert(secondAsk.promptTextLength > 0, "Second Ask prompt is empty");
    assert(!secondAsk.trustVerdict, "Second Ask exposes a trust verdict");
    assert(secondAsk.stampHidden && !secondAsk.hasCertificate, "Old Verify stamp survived Ask");
    check("Ask again", "PASS");
    report.lifecycle.push({ step: "ask-again", message: secondMessage, promptChars: secondAsk.promptTextLength });
    await drainRejections();

    const badAnswer = "237 × 14 = 9999";
    assert(
      await evaluate(cdp, setInputAndClick("#paste-answer", badAnswer, "#verify")),
      "Bad Verify input or #verify was not available",
    );
    const failed = await waitForValue(
      adapter,
      cdp,
      `(() => {
        const answer = document.querySelector("#answer");
        const stamp = document.querySelector("#stamp");
        const styleOf = (element) => {
          if (!element) return null;
          const style = getComputedStyle(element);
          return {
            color: style.color,
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
            outlineColor: style.outlineColor,
            boxShadow: style.boxShadow,
            opacity: style.opacity,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight
          };
        };
        return {
          ready: answer?.getAttribute("aria-label") === "FAILED" && stamp && !stamp.hidden,
          trustStatus: stamp?._source?.trustStatus,
          certificateSchema: stamp?._source?.schema,
          stampVisible: Boolean(stamp && !stamp.hidden && stamp.getClientRects().length > 0),
          stampAria: stamp?.shadowRoot?.querySelector("button")?.getAttribute("aria-label") ?? "",
          answerText: answer?.textContent ?? "",
          styles: {
            stampGlyph: styleOf(stamp?.shadowRoot?.querySelector(".safi-glyph"))
          }
        };
      })()`,
      (value) => value?.ready,
      RUNNER_TIMEOUTS.verify,
      "Verify bad result",
    );
    assert(failed.trustStatus === "FAILED", `Expected FAILED, got ${failed.trustStatus}`);
    assert(failed.certificateSchema === "safi-certificate/v0.1", "Failed result has no v0.1 certificate");
    assert(failed.stampVisible, "Failed stamp is not visible");
    assert(failed.stampAria.includes("Non verificato"), "Failed stamp does not say Non verificato");
    assert(failed.answerText === badAnswer, "Verify used the previous Ask prompt instead of its input");
    assertStyleSnapshot(failed.styles?.stampGlyph, "FAILED stamp");
    assert(styleHasRed(failed.styles.stampGlyph.color), "FAILED stamp is not red");
    check("Verify wrong", failed.trustStatus);
    check("Verify certificate", "PASS");
    check("Verify stamp", "PASS");
    check("Ask ↔ Verify isolation", "PASS");
    report.lifecycle.push({ step: "verify-bad", answer: badAnswer, trustStatus: failed.trustStatus });
    await capture(cdp, artifactsDir, "verify-bad.png", report);
    report.visualStates.failed = {
      state: "FAILED",
      screenshot: "verify-bad.png",
      source: "real installed Android WebView",
      styles: failed.styles,
      trustStatus: failed.trustStatus,
      runtimeErrors: [...report.runtimeErrors],
    };
    await drainRejections();

    if (report.runtimeErrors.length > 0) {
      throw new TestFailure(`${report.runtimeErrors.length} JavaScript runtime error(s)`);
    }
    check("JS runtime errors", report.runtimeErrors.length);
    report.result = "PASS";
  } catch (error) {
    report.result = error instanceof SkipError ? "SKIPPED" : "FAIL";
    report.reason = error.message;
  } finally {
    if (cdp) {
      try {
        report.cleanup.websocketClosed = await cdp.close();
        if (!report.cleanup.websocketClosed) {
          report.cleanup.errors.push("CDP WebSocket did not close within 1000ms");
        }
      } catch (error) {
        report.cleanup.errors.push(`WebSocket close failed: ${error.message}`);
      }
    } else {
      report.cleanup.websocketClosed = true;
    }

    for (const port of [...forwards]) {
      try {
        if (serial) {
          await adbFor(adapter, serial, ["forward", "--remove", `tcp:${port}`], 2_000);
        }
        forwards.delete(port);
      } catch (error) {
        report.cleanup.errors.push(`Forward ${port} removal failed: ${error.message}`);
      }
    }
    report.cleanup.forwardsRemoved = forwards.size === 0;

    if (serial && appLaunchAttempted) {
      try {
        await adbFor(adapter, serial, ["shell", "am", "force-stop", ANDROID_PACKAGE], 2_000);
        report.cleanup.appStopped = true;
      } catch (error) {
        report.cleanup.errors.push(`App force-stop failed: ${error.message}`);
      }
    }

    if (report.cleanup.errors.length > 0) {
      report.result = "FAIL";
      report.reason ??= "One or more cleanup operations failed";
    }
    report.finishedAt = new Date().toISOString();
    writeFileSync(join(artifactsDir, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
  }

  printReport(report, logger);
  return { exitCode: report.result === "FAIL" ? 1 : 0, report };
}
