import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SAFI_TARGET_URL,
  SkipError,
  TestFailure,
  classifyPrerequisiteFailure,
  createSystemAdapter,
  parseAdbDevices,
  parseWebViewSockets,
  runAndroidDeviceTest,
  selectAndroidDevice,
  selectCdpTarget,
  selectWebViewSocket,
} from "../tools/android-device-runner-core.mjs";

class FakeSocket {
  readyState = 0;
  closed = false;
  private readonly behavior: FakeBehavior;
  private verifyCalls = 0;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }

  disconnect(): void {
    this.readyState = 3;
    this.closed = true;
    this.emit("close", {});
  }

  send(data: string): void {
    const message = JSON.parse(data) as {
      id: number;
      method: string;
      params: { expression?: string };
    };
    const expression = message.params.expression ?? "";
    if (expression.includes("brain: typeof window.SafiBrain") && this.disconnectOn === "boot") {
      queueMicrotask(() => this.disconnect());
      return;
    }

    let result: unknown = {};
    if (message.method === "Runtime.evaluate") {
      result = this.evaluate(expression);
    } else if (message.method === "Page.captureScreenshot") {
      result = { data: "" };
    }
    queueMicrotask(() => {
      this.emit("message", {
        data: JSON.stringify({ id: message.id, result }),
      });
    });
  }

  close(): void {
    if (this.readyState === 3) return;
    this.closed = true;
    this.readyState = 3;
    this.emit("close", {});
  }

  constructor(behavior: FakeBehavior) {
    this.behavior = behavior;
  }

  private get disconnectOn() {
    return this.behavior.disconnectOn;
  }

  private evaluate(expression: string): { result: { value: unknown } } {
    let value: unknown = true;
    if (expression.includes("brain: typeof window.SafiBrain")) {
      value = { brain: this.behavior.bootReady, send: this.behavior.bootReady, verify: this.behavior.bootReady, stamp: this.behavior.bootReady };
    } else if (expression.includes("__safiAndroidDeviceTestRejections.splice")) {
      value = [];
    } else if (expression.includes("promptReadyVisible")) {
      value = {
        ready: true,
        promptReadyVisible: !this.behavior.failAskAssertion,
        attributionVisible: true,
        promptText: "prompt",
        trustVerdict: false,
        hasCertificate: false,
        stampHidden: true,
        styles: {
          send: {
            color: "rgb(255, 255, 255)",
            backgroundColor: "rgb(37, 99, 235)",
            borderColor: "rgb(37, 99, 235)",
            outlineColor: "rgb(37, 99, 235)",
            boxShadow: "rgba(37, 99, 235, 0.24)",
            opacity: "1",
            fontSize: "14px",
            fontWeight: "600",
          },
          answer: {
            color: "rgb(15, 23, 42)",
            backgroundColor: "rgb(255, 255, 255)",
            borderColor: "rgb(203, 213, 225)",
            outlineColor: "rgb(15, 23, 42)",
            boxShadow: "none",
            opacity: "1",
            fontSize: "14px",
            fontWeight: "400",
          },
          microstate: {
            color: "rgb(51, 65, 85)",
            backgroundColor: "rgba(0, 0, 0, 0)",
            borderColor: "rgb(51, 65, 85)",
            outlineColor: "rgb(51, 65, 85)",
            boxShadow: "none",
            opacity: "1",
            fontSize: "12px",
            fontWeight: "400",
          },
        },
      };
    } else if (expression.includes("promptTextLength")) {
      value = {
        ready: true,
        originalMessage: true,
        promptTextLength: 10,
        trustVerdict: false,
        stampHidden: true,
        hasCertificate: false,
      };
    } else if (expression.includes("certificateSchema") && expression.includes("trustStatus")) {
      const failed = this.verifyCalls++ > 0 || this.behavior.failVerifyAssertion;
      value = {
        ready: true,
        trustStatus: failed ? "FAILED" : "VERIFIED",
        certificateSchema: "safi-certificate/v0.1",
        stampVisible: true,
        stampAria: failed ? "Non verificato" : "Verificato",
        answerText: failed ? "237 × 14 = 9999" : "237 × 14 = 3318",
        styles: {
          stampGlyph: {
            color: failed ? "rgb(198, 40, 40)" : "rgb(46, 125, 50)",
            backgroundColor: "rgba(0, 0, 0, 0)",
            borderColor: "rgb(46, 125, 50)",
            outlineColor: "rgb(46, 125, 50)",
            boxShadow: failed ? "rgba(198, 40, 40, 0.24)" : "rgba(46, 125, 50, 0.24)",
            opacity: "1",
            fontSize: "16px",
            fontWeight: "400",
          },
        },
      };
    }
    return { result: { value } };
  }
}

type CommandFault = {
  command: string;
  call: number;
  status?: number;
  stderr?: string;
  throws?: string;
  code?: string;
};

type FakeBehavior = {
  devices?: string;
  packagePath?: string;
  procNetUnix?: string;
  packagePid?: string | null;
  targets?: Array<{ type?: string; url: string; webSocketDebuggerUrl?: string }>;
  env?: Record<string, string | undefined>;
  adbMissing?: boolean;
  socketMode?: "open" | "error";
  fetchError?: string;
  bootReady?: boolean;
  failAskAssertion?: boolean;
  failVerifyAssertion?: boolean;
  disconnectOn?: "boot" | "ask" | "verify";
  faults?: CommandFault[];
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function artifactsDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "safi-android-runner-"));
  temporaryDirectories.push(directory);
  return directory;
}

function adbOutput(devices: Array<[string, string]>) {
  return `List of devices attached\n${devices.map(([serial, state]) => `${serial}\t${state}`).join("\n")}`;
}

function commandKey(args: string[]): string {
  if (args[0] === "version") return "version";
  if (args[0] === "devices") return "devices";
  const rest = args[0] === "-s" ? args.slice(2) : args;
  if (rest[0] === "shell" && rest[1] === "pm") return "pm";
  if (rest[0] === "shell" && rest[1] === "cat") return "cat";
  if (rest[0] === "shell" && rest[1] === "pidof") return "pidof";
  if (rest[0] === "shell" && rest[1] === "am" && rest[2] === "force-stop") return "force-stop";
  if (rest[0] === "shell" && rest[1] === "am" && rest[2] === "start") return "start";
  if (rest[0] === "forward" && rest[1] === "--remove") return "forward-remove";
  if (rest[0] === "forward") return "forward";
  return "other";
}

function ok(stdout: string) {
  return { status: 0, stdout, stderr: "" };
}

function fakeRunner(config: FakeBehavior = {}) {
  const behavior: FakeBehavior = { bootReady: true, ...config };
  const calls: string[][] = [];
  const commandCalls = new Map<string, number>();
  const logs: string[] = [];
  let now = 0;
  let socket: FakeSocket | undefined;

  const exec = vi.fn(async (binary: string, args: string[]) => {
    calls.push([binary, ...args]);
    const key = commandKey(args);
    const call = (commandCalls.get(key) ?? 0) + 1;
    commandCalls.set(key, call);
    const fault = behavior.faults?.find((entry) => entry.command === key && entry.call === call);
    if (fault?.throws) throw Object.assign(new Error(fault.throws), { code: fault.code });
    if (fault) {
      return { status: fault.status ?? 1, stdout: "", stderr: fault.stderr ?? `${key} failed` };
    }
    if (binary !== "adb") return ok("");
    if (behavior.adbMissing && key === "version") {
      throw Object.assign(new Error("spawnSync adb ENOENT"), { code: "ENOENT" });
    }
    if (key === "version") return ok("Android Debug Bridge");
    if (key === "devices") return ok(behavior.devices ?? adbOutput([["A024", "device"]]));
    if (key === "pm") return ok(behavior.packagePath ?? "package:/data/app/dev.safi.app/base.apk");
    if (key === "cat") return ok(behavior.procNetUnix ?? "@webview_devtools_remote_123");
    if (key === "pidof") {
      return behavior.packagePid === null
        ? { status: 1, stdout: "", stderr: "not found" }
        : ok(behavior.packagePid ?? "123");
    }
    return ok("");
  });

  const fetch = vi.fn(async () => {
    if (behavior.fetchError) throw new Error(behavior.fetchError);
    return {
      ok: true,
      status: 200,
      json: async () => behavior.targets ?? [{
        type: "page",
        url: SAFI_TARGET_URL,
        webSocketDebuggerUrl: "ws://127.0.0.1:45678/devtools/page/safi",
      }],
    };
  });

  const connectWebSocket = vi.fn(() => {
    socket = new FakeSocket(behavior);
    queueMicrotask(() => {
      if (behavior.socketMode === "error") {
        socket!.readyState = 3;
        socket!.emit("error", new Error("connect failed"));
      } else {
        socket!.readyState = 1;
        socket!.emit("open", {});
      }
    });
    return socket;
  });

  const adapter = createSystemAdapter({
    exec,
    fetch,
    connectWebSocket,
    env: behavior.env ?? {},
    now: () => now,
    sleep: async (milliseconds: number) => {
      now += milliseconds;
    },
    allocatePort: async () => 45_678,
  });

  return {
    adapter,
    calls,
    commandCalls,
    logs,
    logger: { log: (line: string) => logs.push(line), error: (line: string) => logs.push(line) },
    getSocket: () => socket,
  };
}

async function runFake(config: FakeBehavior = {}) {
  const fake = fakeRunner(config);
  const result = await runAndroidDeviceTest({
    adapter: fake.adapter,
    artifactsDir: artifactsDir(),
    logger: fake.logger,
  });
  return { ...fake, result };
}

const deviceMatrix = [
  { name: "zero devices", devices: [], serial: undefined, outcome: "SKIPPED", message: "No authorized Android device" },
  { name: "one device", devices: [["A", "device"]], serial: undefined, outcome: "A" },
  { name: "unauthorized only", devices: [["A", "unauthorized"]], serial: undefined, outcome: "SKIPPED", message: "No authorized Android device" },
  { name: "offline only", devices: [["A", "offline"]], serial: undefined, outcome: "SKIPPED", message: "No authorized Android device" },
  { name: "multiple without serial", devices: [["A", "device"], ["B", "device"]], serial: undefined, outcome: "AMBIGUOUS", message: "Multiple Android devices detected" },
  { name: "multiple select A", devices: [["A", "device"], ["B", "device"]], serial: "A", outcome: "A" },
  { name: "multiple select B", devices: [["A", "device"], ["B", "device"]], serial: "B", outcome: "B" },
  { name: "unknown serial", devices: [["A", "device"], ["B", "device"]], serial: "X", outcome: "NOT FOUND", message: "Requested Android device X not found" },
  { name: "authorized B fallback is explicit only", devices: [["A", "unauthorized"], ["B", "device"]], serial: undefined, outcome: "B" },
  { name: "requested unauthorized", devices: [["A", "unauthorized"], ["B", "device"]], serial: "A", outcome: "NOT AUTHORIZED", message: "Requested device is not authorized: A" },
  { name: "requested offline", devices: [["A", "offline"], ["B", "device"]], serial: "A", outcome: "NOT AVAILABLE", message: "Requested device is not available: A (offline)" },
] as const;

describe("deterministic ADB device matrix", () => {
  for (const scenario of deviceMatrix) {
    it(scenario.name, () => {
      let outcome = scenario.outcome;
      let actualMessage = "";
      try {
        outcome = selectAndroidDevice(
          parseAdbDevices(adbOutput(scenario.devices as Array<[string, string]>)),
          scenario.serial,
        ) as typeof outcome;
      } catch (error) {
        if (!(error instanceof SkipError)) throw error;
        actualMessage = error.message;
        if (scenario.outcome === "SKIPPED") outcome = "SKIPPED";
        else if (scenario.outcome === "AMBIGUOUS") outcome = "AMBIGUOUS";
        else if (scenario.outcome === "NOT FOUND") outcome = "NOT FOUND";
        else if (scenario.outcome === "NOT AUTHORIZED") outcome = "NOT AUTHORIZED";
        else if (scenario.outcome === "NOT AVAILABLE") outcome = "NOT AVAILABLE";
        else throw error;
      }
      expect(outcome).toBe(scenario.outcome);
      if ("message" in scenario) expect(actualMessage).toContain(scenario.message);
    });
  }

  it("classifies missing adb as a prerequisite skip", () => {
    const classified = classifyPrerequisiteFailure(
      Object.assign(new Error("spawnSync adb ENOENT"), { code: "ENOENT" }),
      "adb",
    );
    expect(classified).toBeInstanceOf(SkipError);
    expect((classified as Error).message).toBe("adb not available");
  });
});

const socketMatrix = [
  { name: "zero sockets", input: "", pid: "123", outcome: "SKIP", message: "WebView debugging endpoint not available" },
  { name: "one Safi socket", input: "@webview_devtools_remote_123", pid: "123", outcome: "webview_devtools_remote_123" },
  { name: "multiple with Safi PID", input: "@webview_devtools_remote_101\n@webview_devtools_remote_202", pid: "202", outcome: "webview_devtools_remote_202" },
  { name: "multiple without PID", input: "@webview_devtools_remote_101\n@webview_devtools_remote_202", pid: "", outcome: "FAIL", message: "Multiple WebView debugging endpoints" },
  { name: "other app only", input: "@webview_devtools_remote_101", pid: "202", outcome: "SKIP", message: "Safi WebView debugging endpoint not available" },
  { name: "other app plus Safi", input: "@webview_devtools_remote_101\n@webview_devtools_remote_202", pid: "202", outcome: "webview_devtools_remote_202" },
] as const;

describe("deterministic WebView socket matrix", () => {
  for (const scenario of socketMatrix) {
    it(scenario.name, () => {
      if (scenario.outcome === "webview_devtools_remote_123" || scenario.outcome === "webview_devtools_remote_202") {
        expect(selectWebViewSocket(parseWebViewSockets(scenario.input), scenario.pid)).toBe(scenario.outcome);
      } else {
        expect(() => selectWebViewSocket(parseWebViewSockets(scenario.input), scenario.pid)).toThrow(scenario.message);
      }
    });
  }
});

const safiTarget = { type: "page", url: SAFI_TARGET_URL, id: "safi" };
const targetMatrix = [
  { name: "exact Safi target", targets: [safiTarget], outcome: "safi" },
  { name: "mixed irrelevant targets", targets: [{ type: "page", url: "about:blank" }, { type: "page", url: "chrome://inspect" }, { type: "page", url: "https://other.example/" }, safiTarget], outcome: "safi" },
  { name: "non-page Safi URL", targets: [{ type: "worker", url: SAFI_TARGET_URL }], outcome: undefined },
  { name: "no Safi target", targets: [{ type: "page", url: "about:blank" }, { type: "page", url: "chrome://inspect" }], outcome: undefined },
] as const;

describe("deterministic CDP target matrix", () => {
  for (const scenario of targetMatrix) {
    it(scenario.name, () => {
      const selected = selectCdpTarget(scenario.targets as unknown[]);
      expect(selected?.id).toBe(scenario.outcome);
    });
  }

  it("fails on duplicate equivalent Safi targets", () => {
    expect(() => selectCdpTarget([
      safiTarget,
      { ...safiTarget, id: "duplicate" },
    ])).toThrow("Ambiguous Safi CDP target");
  });
});

type FaultScenario = {
  name: string;
  config: FakeBehavior;
  result: "PASS" | "SKIPPED" | "FAIL";
  reason?: string;
  assert?: (fake: Awaited<ReturnType<typeof runFake>>) => void;
};

const faultScenarios: FaultScenario[] = [
  {
    name: "missing package is prerequisite skip",
    config: { packagePath: "" },
    result: "SKIPPED",
    reason: "Package dev.safi.app is not installed",
  },
  {
    name: "adb devices failure is prerequisite skip",
    config: { faults: [{ command: "devices", call: 1, stderr: "daemon unavailable" }] },
    result: "SKIPPED",
    reason: "Unable to list Android devices",
    assert: ({ calls }) => expect(calls.some((call) => call.includes("start"))).toBe(false),
  },
  {
    name: "package command failure does not launch",
    config: { faults: [{ command: "pm", call: 1, stderr: "pm unavailable" }] },
    result: "FAIL",
    reason: "pm unavailable",
    assert: ({ calls }) => expect(calls.some((call) => call.includes("start"))).toBe(false),
  },
  {
    name: "pre-launch force-stop failure is not masked",
    config: { faults: [{ command: "force-stop", call: 1, stderr: "permission denied" }] },
    result: "FAIL",
    reason: "permission denied",
    assert: ({ calls }) => expect(calls.some((call) => call.includes("start"))).toBe(false),
  },
  {
    name: "launch failure still runs app cleanup",
    config: { faults: [{ command: "start", call: 1, stderr: "activity missing" }] },
    result: "FAIL",
    reason: "activity missing",
    assert: ({ commandCalls }) => expect(commandCalls.get("force-stop")).toBe(2),
  },
  {
    name: "stale socket fails without stale forward",
    config: { faults: [{ command: "forward", call: 1, stderr: "socket vanished" }] },
    result: "FAIL",
    reason: "Safi WebView socket became unavailable",
    assert: ({ commandCalls, calls }) => {
      expect(commandCalls.get("forward-remove") ?? 0).toBe(0);
      expect(calls.some((call) => call.includes("force-stop"))).toBe(true);
    },
  },
  {
    name: "missing WebView socket is bounded prerequisite skip",
    config: { procNetUnix: "", packagePid: "123" },
    result: "SKIPPED",
    reason: "WebView debugging endpoint not available",
  },
  {
    name: "missing CDP target is bounded prerequisite skip",
    config: { targets: [] },
    result: "SKIPPED",
    reason: "Expected Safi WebView target not found",
  },
  {
    name: "unreachable CDP times out with forward cleanup",
    config: { fetchError: "connection refused" },
    result: "FAIL",
    reason: "Safi WebView CDP endpoint unreachable",
    assert: ({ commandCalls }) => expect(commandCalls.get("forward-remove") ?? 0).toBeGreaterThan(0),
  },
  {
    name: "boot timeout fails with cleanup",
    config: { bootReady: false },
    result: "FAIL",
    reason: "WebView boot timed out after 20000ms",
  },
  {
    name: "WebSocket disconnect during boot fails fast",
    config: { disconnectOn: "boot" },
    result: "FAIL",
    reason: "CDP WebSocket disconnected",
    assert: ({ getSocket }) => expect(getSocket()?.closed).toBe(true),
  },
  {
    name: "Ask assertion failure preserves cleanup",
    config: { failAskAssertion: true },
    result: "FAIL",
    reason: "Ask prompt heading is not visible",
  },
  {
    name: "Verify assertion failure preserves cleanup",
    config: { failVerifyAssertion: true },
    result: "FAIL",
    reason: "Expected VERIFIED, got FAILED",
  },
  {
    name: "forward cleanup failure is reported after otherwise successful test",
    config: { faults: [{ command: "forward-remove", call: 1, stderr: "remove denied" }] },
    result: "FAIL",
    reason: "One or more cleanup operations failed",
  },
  {
    name: "app cleanup failure does not stop forward cleanup",
    config: { faults: [{ command: "force-stop", call: 2, stderr: "stop denied" }] },
    result: "FAIL",
    reason: "One or more cleanup operations failed",
  },
  {
    name: "primary failure survives partial cleanup failure",
    config: {
      failAskAssertion: true,
      faults: [{ command: "forward-remove", call: 1, stderr: "remove denied" }],
    },
    result: "FAIL",
    reason: "Ask prompt heading is not visible",
  },
];

describe("deterministic ADB and CDP fault matrix", () => {
  for (const scenario of faultScenarios) {
    it(scenario.name, async () => {
      const fake = await runFake(scenario.config);
      expect(fake.result.report.result).toBe(scenario.result);
      expect(fake.result.report.reason).toContain(scenario.reason!);
      expect(fake.result.report.cleanup.websocketClosed).toBe(true);
      const forwardCleanupFailed = fake.result.report.cleanup.errors.some((error) => error.startsWith("Forward "));
      expect(fake.result.report.cleanup.forwardsRemoved).toBe(!forwardCleanupFailed);
      scenario.assert?.(fake);
    });
  }

  it("records every cleanup error while preserving the primary failure", async () => {
    const { result } = await runFake({
      failAskAssertion: true,
      faults: [
        { command: "forward-remove", call: 1, stderr: "remove denied" },
        { command: "force-stop", call: 2, stderr: "stop denied" },
      ],
    });
    expect(result.report.reason).toBe("Ask prompt heading is not visible");
    expect(result.report.cleanup.errors).toHaveLength(2);
    expect(result.report.cleanup.forwardsRemoved).toBe(false);
    expect(result.report.cleanup.appStopped).toBe(false);
  });

  it("keeps missing adb human-readable without a stack trace", async () => {
    const { result, logs } = await runFake({ adbMissing: true });
    expect(result.exitCode).toBe(0);
    expect(result.report.reason).toBe("adb not available");
    expect(logs.join("\n")).not.toContain("ENOENT");
  });
});
