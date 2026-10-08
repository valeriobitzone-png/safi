#!/usr/bin/env node
/**
 * §10 — REAL macOS evidence for the 3:2 pass.
 *
 * Every frame here is the INSTALLED Safi.app on the real desktop. For
 * each step the app is launched, the widget performs ONE real native
 * placement through the loopback channel it owns, the shell reports what
 * it actually did (SAFI_WINDOW_TRACE), and the screen is captured at the
 * exact rect the real window occupies.
 *
 * No browser, no mock, no card-review page.
 *
 *   node tools/3x2-macos-evidence.mjs [outDir]
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, openSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXE = join(repo, "apps/desktop/src-tauri/target/release/bundle/macos/Safi.app/Contents/MacOS/safi-desktop");
const OUT = resolve(process.argv[2] ?? join(repo, "artifacts/three-by-two/macos"));
const PLACEMENT_FILE = join(process.env.HOME, "Library/Application Support/dev.safi.desktop/window-placement.json");
const PAD = 26;

mkdirSync(OUT, { recursive: true });

/** The real window rect, as the shell itself reported it. */
function lastWindowState(log) {
  let found = null;
  for (const line of log.split("\n")) {
    const m = /\[window\] (\{.*\})/.exec(line);
    if (!m) continue;
    try {
      const s = JSON.parse(m[1]);
      if (Number.isFinite(s.x) && Number.isFinite(s.w) && s.w > 0) found = s;
    } catch { /* partial line */ }
  }
  return found;
}

function selftestReport(log) {
  const m = /SAFI_SELFTEST (\{[^\n]*\})/.exec(log);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function screencapture(out, rect) {
  const args = ["-x"];
  if (rect) args.push("-R", `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)}`);
  args.push(out);
  const r = spawnSync("screencapture", args, { timeout: 20000 });
  return { ok: r.status === 0 && existsSync(out), full: !rect };
}

/** One launch of the real app, one real state, one real screenshot. */
async function run(name, hook, { settleMs = 6500, rectFromWindow = true, pos = null } = {}) {
  process.stderr.write(`[evidence] ${name}  (${hook})\n`);
  const logPath = join(OUT, `app-${name}.log`);
  const fd = openSync(logPath, "w");
  const env = { ...process.env, SAFI_WIDGET_HASH: hook, SAFI_WINDOW_TRACE: "1" };
  if (pos) env.SAFI_WINDOW_POS = pos;
  const proc = spawn(EXE, [], { env, stdio: ["ignore", fd, fd] });
  await sleep(settleMs);
  const log = readFileSync(logPath, "utf8");
  const state = lastWindowState(log);
  const selftest = selftestReport(log);
  const rect = rectFromWindow && state
    ? { x: state.x - PAD, y: state.y - PAD, w: state.w + PAD * 2, h: state.h + PAD * 2 }
    : null;
  const file = join(OUT, `${name}.png`);
  let shot = rect ? screencapture(file, rect) : { ok: false, full: false };
  if (!shot.ok) shot = screencapture(file, null);
  proc.kill();
  await sleep(350);
  try { fd.closeSync(); } catch { /* already closed */ }
  const entry = {
    name,
    hook,
    window: state ? { x: state.x, y: state.y, w: state.w, h: state.h } : null,
    workArea: state?.workArea ?? null,
    placement: selftest?.placement ?? null,
    screenshot: existsSync(file) ? file : null,
    fullScreen: shot.full,
  };
  return entry;
}

if (!existsSync(EXE)) {
  console.error(`Safi.app missing: ${EXE} — run: npm run app:build:macos`);
  process.exit(2);
}

// A clean memory, so "restored after relaunch" is proven and not
// accidentally true because a previous session left the same file.
rmSync(PLACEMENT_FILE, { force: true });

const steps = [];

// 1) The real surfaces: INPUT 3:2, PROMPT_READY, VERIFY_RESULT, compact.
//    Placed in a clear region of the desktop so the capture shows Safi
//    and not whatever else happens to be behind it.
const CLEAR = "600,200";
steps.push(await run("01-macos-input-3x2", "open=1", { pos: CLEAR }));
steps.push(await run("02-macos-prompt-ready", "demo=ask-prompt", { pos: CLEAR }));
steps.push(await run("03-macos-verify-result", "demo=verify-right", { pos: CLEAR }));
steps.push(await run("04-macos-compact", "compactState=verified", { pos: CLEAR }));

// 2) The four placement proofs, each a real launch of the real app.
steps.push(await run("05-macos-widget-top-left", "placeTopLeft=1"));
steps.push(await run("06-macos-widget-center", "placeCenter=1"));
steps.push(await run("07-macos-widget-bottom-right", "placeBottomRight=1"));
steps.push(await run("08-macos-edge-snap", "placeSnapEdge=1"));

// 3) OFF-SCREEN RECOVERY: ask for a position no display can show, then
//    relaunch and prove the window is back inside the work area.
steps.push(await run("09-macos-offscreen-recovery", "placeOffScreen=1"));
steps.push(await run("10-macos-restored-after-relaunch", "restoreOnly=1"));

const byName = Object.fromEntries(steps.map((s) => [s.name, s]));
const offscreen = byName["09-macos-offscreen-recovery"];
const restored = byName["10-macos-restored-after-relaunch"];

const summary = {
  generatedAt: new Date().toISOString(),
  app: EXE,
  placementFile: PLACEMENT_FILE,
  checks: {
    "native collapse 30/30": "see tests/visual.test.ts — DEVICE: 30/30 compact<->expanded cycles",
    "off-screen recovery": offscreen?.placement
      ? { requested: offscreen.placement.requested, landedAt: offscreen.placement.after, clamped: offscreen.placement.clamped, visible: offscreen.placement.visible }
      : null,
    "position persistence": restored?.placement
      ? { window: restored.placement.after, workArea: restored.placement.workArea, visible: restored.placement.visible }
      : null,
  },
  steps,
};
writeFileSync(join(OUT, "evidence.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary.checks, null, 2));
for (const s of steps) {
  console.log(`${s.name.padEnd(34)} window=${s.window ? `${s.window.x},${s.window.y} ${s.window.w}x${s.window.h}` : "?"} shot=${s.screenshot ? "yes" : "NO"}`);
}
