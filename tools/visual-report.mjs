#!/usr/bin/env node
/**
 * Repeatable local visual-state report for the real Safi release surfaces.
 *
 * macOS: the installed Safi.app release bundle, rendered by the existing CDP
 *        visual harness. Android: the installed APK's real WebView through
 *        the hardened ADB/CDP runner. No mock surface is used as fallback.
 *
 * CURRENT captures are written only under artifacts/visual-report and are
 * never promoted to golden references.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { decodePng } from "./png-analysis.mjs";
import { encodePng } from "./mascot-raster.mjs";
import {
  assembleVisualReport,
  evaluateVisualState,
  formatVisualReportConsole,
  renderVisualReportHtml,
} from "./visual-report-core.mjs";
import {
  VISUAL_BASELINE_ALLOWLIST,
  VISUAL_BASELINE_APPROVAL_STATUS,
  VISUAL_BASELINE_PENDING_STATUS,
  comparePngFiles,
  loadVisualBaseline,
} from "./visual-baseline.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(ROOT, "artifacts/visual-report");
const DEFAULT_BUNDLE = resolve(
  process.env.SAFI_BUNDLE ??
    "apps/desktop/src-tauri/target/release/bundle/macos/Safi.app/Contents/Resources/resources/safi",
);

function parseArgs(args) {
  let platform = "all";
  let out = DEFAULT_OUT;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--platform") platform = args[++index] ?? "";
    else if (arg === "--out") out = resolve(process.cwd(), args[++index] ?? "");
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: npm run visual:report -- [--platform all|macos|android] [--out DIR]");
      process.exit(0);
    } else throw new Error(`Unknown visual report option: ${arg}`);
  }
  if (!new Set(["all", "macos", "android"]).has(platform)) {
    throw new Error(`Unknown platform: ${platform}`);
  }
  return { platform, out };
}

function runNode(args, timeout = 120_000) {
  return spawnSync("node", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function cropPng(sourcePath, rect, destinationPath) {
  if (!rect || rect.w <= 0 || rect.h <= 0) return false;
  const image = decodePng(sourcePath);
  const x0 = Math.max(0, Math.min(image.width - 1, Math.round(rect.x ?? 0)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.round(rect.y ?? 0)));
  const width = Math.max(1, Math.min(image.width - x0, Math.round(rect.w)));
  const height = Math.max(1, Math.min(image.height - y0, Math.round(rect.h)));
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = ((y0 + y) * image.width + (x0 + x)) * 4;
      const destination = (y * width + x) * 4;
      pixels[destination] = image.pixels[source];
      pixels[destination + 1] = image.pixels[source + 1];
      pixels[destination + 2] = image.pixels[source + 2];
      pixels[destination + 3] = 255;
    }
  }
  writeFileSync(
    destinationPath,
    encodePng(width, height, Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)),
  );
  return true;
}

async function startBundleBridge(bundle, stateDir) {
  const bridgePath = join(bundle, "apps/desktop/bridge.js");
  if (!existsSync(bridgePath)) {
    throw new Error(`Release bundle missing or stale: ${bridgePath}`);
  }
  const child = spawn("node", [bridgePath], {
    cwd: bundle,
    env: { ...process.env, SAFI_BRIDGE_STATE_DIR: stateDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  return new Promise((resolveBridge, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Release bridge handshake timeout: ${output.slice(-400)}`));
    }, 15_000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      const match = output.match(/SAFI_BRIDGE_READY port=(\d+) token=([A-Za-z0-9_-]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolveBridge({
        child,
        baseUrl: `http://127.0.0.1:${match[1]}/`,
        token: match[2],
      });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      if (!output.includes("SAFI_BRIDGE_READY")) {
        clearTimeout(timer);
        reject(new Error(`Release bridge exited early (${code}): ${output.slice(-400)}`));
      }
    });
  });
}

const MAC_CAPTURES = [
  {
    id: "compact",
    hash: "",
    wait: "window.__SAFI_UI__?.mode === 'COMPACT'",
    viewport: [500, 220],
    crop: "compactRect",
  },
  {
    id: "expanded",
    hash: "open=1",
    wait: "window.__SAFI_UI__?.mode === 'EXPANDED'",
    viewport: [560, 620],
    crop: "expandedRect",
  },
  {
    id: "ask",
    hash: "open=1&demo=ask-prompt",
    wait: "window.__SAFI_DIAG__?.prompt?.delivered === true && window.__SAFI_UI__?.mode === 'EXPANDED'",
    viewport: [560, 620],
    crop: "expandedRect",
    focus: "#speak",
  },
  {
    id: "verified",
    hash: "open=1&demo=verify-right",
    wait: "window.__SAFI_DIAG__?.trust === 'VERIFIED' && window.__SAFI_UI__?.mode === 'EXPANDED' && getComputedStyle(document.getElementById('trust-line')).color === 'rgb(15, 107, 63)'",
    viewport: [560, 620],
    crop: "expandedRect",
  },
  {
    id: "uncertain",
    hash: "open=1&demo=verify-uncertain",
    wait: "window.__SAFI_DIAG__?.trust === 'UNCERTAIN' && window.__SAFI_UI__?.mode === 'EXPANDED' && getComputedStyle(document.getElementById('trust-line')).color === 'rgb(122, 77, 0)'",
    viewport: [560, 620],
    crop: "expandedRect",
  },
  {
    id: "failed",
    hash: "open=1&demo=verify-wrong",
    wait: "window.__SAFI_DIAG__?.trust === 'FAILED' && window.__SAFI_UI__?.mode === 'EXPANDED' && getComputedStyle(document.getElementById('trust-line')).color === 'rgb(151, 40, 31)'",
    viewport: [560, 620],
    crop: "expandedRect",
  },
];

async function captureMacStates(outputDir) {
  const screenshotDir = join(outputDir, "macos");
  const diagnosticDir = join(outputDir, "diagnostics/macos");
  mkdirSync(screenshotDir, { recursive: true });
  mkdirSync(diagnosticDir, { recursive: true });
  const bridgeStateDir = mkdtempSync(join(tmpdir(), "safi-visual-report-"));
  let bridge;
  const states = [];

  try {
    bridge = await startBundleBridge(DEFAULT_BUNDLE, bridgeStateDir);
    for (const capture of MAC_CAPTURES) {
      const screenshot = join(screenshotDir, `${capture.id}.png`);
      const diagnostic = join(diagnosticDir, `${capture.id}.json`);
      const pageHash = capture.hash ? `&${capture.hash}` : "";
      const args = [
        join(ROOT, "tools/visual-harness.mjs"),
        "--url",
        `${bridge.baseUrl}#t=${bridge.token}${pageHash}`,
        "--wait",
        capture.wait,
        "--out",
        screenshot,
        "--diag",
        diagnostic,
        "--vw",
        String(capture.viewport[0]),
        "--vh",
        String(capture.viewport[1]),
        "--timeout",
        "30000",
      ];
      if (capture.focus) args.push("--focus", capture.focus);
      const run = runNode(args);
      let diag = null;
      try {
        diag = JSON.parse(readFileSync(diagnostic, "utf8"));
      } catch {
        diag = null;
      }
      if (run.status === 0 && diag && capture.crop) {
        cropPng(screenshot, diag.eval?.[capture.crop], screenshot);
      }
      states.push({
        id: capture.id,
        source: "macOS release-bundle WebView from installed Safi.app resources",
        screenshot: `macos/${capture.id}.png`,
        screenshotExists: existsSync(screenshot),
        styles: diag?.eval?.computedStyles ?? {},
        mascotSharp: diag?.eval?.mascotSharp ?? null,
        runtimeErrors: [
          ...(diag?.runtimeExceptions ?? []),
          ...(diag?.consoleMessages ?? []).filter((message) => message.startsWith("[console.error]")),
        ],
        captureError: run.status === 0 ? null : String(run.stderr || run.stdout || `exit ${run.status}`).slice(-500),
      });
    }
  } catch (error) {
    for (const capture of MAC_CAPTURES) {
      states.push({
        id: capture.id,
        source: "macOS release-bundle WebView from installed Safi.app resources",
        screenshot: `macos/${capture.id}.png`,
        screenshotExists: existsSync(join(screenshotDir, `${capture.id}.png`)),
        styles: {},
        mascotSharp: null,
        runtimeErrors: [error.message],
        captureError: error.message,
      });
    }
  } finally {
    bridge?.child.kill();
    await sleep(150);
    rmSync(bridgeStateDir, { recursive: true, force: true });
  }
  return states;
}

function evaluateMacGolden(states, outputDir) {
  const currentDir = join(outputDir, "macos");
  const diffDir = join(outputDir, "diffs/macos");
  const required = ["compact", "expanded", "verified", "uncertain", "failed"];
  const available = required.every((id) => existsSync(join(currentDir, `${id}.png`)));
  let run = null;
  if (available) {
    run = runNode([
      join(ROOT, "tools/golden-diff.mjs"),
      "--current",
      currentDir,
      "--out",
      diffDir,
    ], 180_000);
  }

  const byId = new Map();
  for (const id of required) {
    const reportPath = join(diffDir, `${id}.txt`);
    let report = null;
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
    } catch {
      report = null;
    }
    byId.set(id, {
      status: report?.ok ? "PASS" : "FAIL",
      reference: "golden/safi-ui-board.png + golden/safi-character-sheet.png",
      diffImage: `diffs/macos/${id}.png`,
      metrics: report?.metrics ?? null,
      error: report?.error ?? (available ? String(run?.stderr ?? run?.stdout ?? "golden diff missing").slice(-400) : "current capture missing"),
    });
  }
  byId.set("ask", {
    status: "AWAITING HUMAN GOLDEN APPROVAL",
    reference: null,
    diffImage: null,
    metrics: null,
    error: null,
  });
  return byId;
}

function evaluateApprovedBaseline(state, outputDir, baseline) {
  const key = `${state.platform}/${state.id}`;
  const entry = baseline.entries.get(key);
  if (!entry) {
    if (baseline.status === "INVALID" && VISUAL_BASELINE_ALLOWLIST.some((candidate) => candidate.key === key)) {
      return {
        status: "FAIL",
        reference: null,
        diffImage: null,
        metrics: null,
        error: `visual baseline manifest invalid: ${baseline.errors.join("; ")}`,
        approval: null,
      };
    }
    return null;
  }

  const currentPath = join(outputDir, state.screenshot);
  const diffRelative = `diffs/baseline/${state.platform}-${state.id}.png`;
  const comparison = comparePngFiles(
    currentPath,
    entry.goldenPath,
    join(outputDir, diffRelative),
    { allowRenderTolerance: key === "macos/ask" },
  );
  return {
    status: comparison.pass ? "PASS" : "FAIL",
    reference: entry.golden,
    diffImage: diffRelative,
    comparisonMode: comparison.comparisonMode,
    metrics: {
      ...comparison.metrics,
      currentSha256: comparison.currentSha256,
      goldenSha256: entry.sha256,
      sourceSha256: entry.sourceSha256,
      approvedAt: entry.approvedAt,
      approvedBy: entry.approvedBy,
      width: entry.width,
      height: entry.height,
      bytes: entry.bytes,
    },
    error: comparison.error,
    approval: {
      status: entry.approvalStatus,
      approvedAt: entry.approvedAt,
      approvedBy: entry.approvedBy,
      provenance: entry.provenance,
    },
  };
}

function captureAndroidStates(outputDir) {
  const androidArtifacts = join(ROOT, "artifacts/android-device");
  const screenshotDir = join(outputDir, "android");
  mkdirSync(screenshotDir, { recursive: true });
  const run = runNode([join(ROOT, "tools/android-device-cdp-test.mjs")], 240_000);
  let result = null;
  try {
    result = JSON.parse(readFileSync(join(androidArtifacts, "result.json"), "utf8"));
  } catch {
    result = null;
  }
  const mappings = [
    { id: "ask", source: "ask-prompt-ready.png" },
    { id: "verified", source: "verify-good.png" },
    { id: "failed", source: "verify-bad.png" },
  ];
  return mappings.map(({ id, source }) => {
    const sourcePath = join(androidArtifacts, source);
    const destinationName = `${id}.png`;
    if (existsSync(sourcePath)) {
      copyFileSync(sourcePath, join(screenshotDir, destinationName));
    }
    const captured = result?.visualStates?.[id];
    return {
      id,
      source: "real installed Android WebView (dev.safi.app)",
      screenshot: `android/${destinationName}`,
      screenshotExists: existsSync(join(screenshotDir, destinationName)),
      styles: captured?.styles ?? {},
      mascotSharp: null,
      runtimeErrors: result?.runtimeErrors ?? [],
      captureError: result?.result === "PASS" ? null : String(result?.reason ?? run.stderr ?? run.stdout ?? "Android capture failed").slice(-500),
      androidState: captured ?? null,
    };
  });
}

async function main() {
  const startedAt = new Date().toISOString();
  const { platform, out } = parseArgs(process.argv.slice(2));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // The report is a reader of the approved manifest.  It never invokes the
  // promotion command and never copies CURRENT into golden/.
  const baseline = loadVisualBaseline(ROOT);

  const rawStates = [];
  let macGolden = new Map();
  let androidResult = null;
  if (platform === "all" || platform === "macos") {
    const macStates = await captureMacStates(out);
    rawStates.push(...macStates.map((state) => ({ platform: "macos", ...state })));
    macGolden = evaluateMacGolden(macStates, out);
  }
  if (platform === "all" || platform === "android") {
    const androidStates = captureAndroidStates(out);
    rawStates.push(...androidStates.map((state) => ({ platform: "android", ...state })));
    try {
      androidResult = JSON.parse(readFileSync(join(ROOT, "artifacts/android-device/result.json"), "utf8"));
    } catch {
      androidResult = null;
    }
  }

  const states = rawStates.map((state) => {
    const fallbackGolden = state.platform === "macos"
      ? macGolden.get(state.id) ?? { status: "FAIL", reference: null, metrics: null, error: "golden result missing" }
      : {
          status: VISUAL_BASELINE_PENDING_STATUS,
          reference: null,
          diffImage: null,
          metrics: null,
          error: null,
        };
    const golden = evaluateApprovedBaseline(state, out, baseline) ?? fallbackGolden;
    const evaluated = evaluateVisualState({
      platform: state.platform,
      id: state.id,
      styles: state.styles,
      screenshot: state.screenshot,
      screenshotExists: state.screenshotExists,
      source: state.source,
      mascotSharp: state.mascotSharp,
      golden,
      runtimeErrors: state.captureError ? [...state.runtimeErrors, state.captureError] : state.runtimeErrors,
    });
    return { ...evaluated, androidState: state.androidState ?? null };
  });

  const report = assembleVisualReport({
    startedAt,
    states,
    environment: {
      hostPlatform: process.platform,
      node: process.version,
      requestedPlatforms: platform,
      macosSurface: "installed Safi.app release-bundle WebView",
      macosBundle: DEFAULT_BUNDLE,
      androidDevice: androidResult?.device ?? null,
      androidRunnerResult: androidResult?.result ?? null,
    },
    baseline: {
      status: baseline.status,
      manifest: baseline.manifestPath,
      approvedAt: baseline.manifest?.approvedAt ?? null,
      approvedBy: baseline.manifest?.approvedBy ?? null,
      autoPromotion: false,
      approvedSurfaces: [...baseline.entries.keys()],
      errors: baseline.errors,
    },
  });
  writeFileSync(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, "report.html"), renderVisualReportHtml(report));
  console.log(formatVisualReportConsole(report));
  process.exitCode = report.result === "PASS" ? 0 : 1;
}

await main();
