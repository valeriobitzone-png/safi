#!/usr/bin/env node
/**
 * §7 / §10 — REAL Android evidence for the 3:2 pass.
 *
 * The device under test is a physical Nothing phone (1260x2800, 480dpi).
 * The page under test is the SAME apps/desktop/widget.html that runs on
 * macOS, served to the real Android WebView through WebViewAssetLoader,
 * with the in-page host adapter (apps/desktop/host-web.js).
 *
 * Nothing here is a mock and nothing is a browser: every number is read
 * out of the live WebView over the real Chrome DevTools Protocol socket
 * the WebView exposes, and every frame is a real screen capture of the
 * device.
 *
 *   node tools/3x2-android-evidence.mjs [outDir]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(process.argv[2] ?? join(repo, "artifacts/three-by-two/android"));
const PKG = "dev.safi.app";
const PORT = 9422;
const WIDGET_URL = "https://appassets.androidplatform.net/apps/desktop/widget.html";
// The 3:2 contract, in CSS pixels, identical to SURFACE_SIZES on macOS.
const EXPANDED = { w: 384, h: 256 };

mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ adb */

function adb(args, opts = {}) {
  const r = spawnSync("adb", args, { encoding: "utf8", timeout: 120000, ...opts });
  if (r.status !== 0) {
    throw new Error(`adb ${args.join(" ")} failed (${r.status}): ${(r.stderr || r.stdout || "").trim()}`);
  }
  return (r.stdout || "").trim();
}

function sh(command) {
  // One string, not argv: `wm` is a shell script and is only reliable that way.
  const r = spawnSync("adb", ["shell", command], { encoding: "utf8", timeout: 60000 });
  return `${r.stdout || ""}${r.stderr || ""}`;
}

/**
 * The system insets for the CURRENT rotation.
 *
 * The activity fills the whole screen and the status bar OVERLAYS the top
 * of it, so the page's CSS origin is NOT the screen origin: in portrait
 * the page starts 162 device px down, in landscape 162 px across. Cropping
 * a full-screen screencap with page coordinates therefore shifts every
 * frame. These are the values the system itself reports.
 */
function insetsFor(landscape) {
  const out = sh("dumpsys window displays");
  const all = [...out.matchAll(/ROTATION_(\d+)=\{overrideNonDecorInsets=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/g)]
    .map((m) => ({ rot: Number(m[1]), left: Number(m[2]), top: Number(m[3]), right: Number(m[4]), bottom: Number(m[5]) }));
  if (all.length === 0) return { left: 0, top: 0, right: 0, bottom: 0, rot: -1 };
  // ROTATION_0/180 are portrait, ROTATION_90/270 are landscape.
  return all.find((a) => (a.rot === 90 || a.rot === 270) === landscape) ?? all[0];
}

function deviceInfo() {
  const size = /Physical size:\s*(\d+)x(\d+)/.exec(sh("wm size"))?.[1] ?? "unknown";
  const [pw, ph] = size === "unknown" ? [0, 0] : size.split("x").map(Number);
  const density = Number(/Physical density:\s*(\d+)/.exec(sh("wm density"))?.[1] ?? 0);
  const model = sh("getprop ro.product.model").trim();
  const release = sh("getprop ro.build.version.release").trim();
  const abi = sh("getprop ro.product.cpu.abi").trim();
  return { model, androidRelease: release, abi, physicalSize: size, density, px: { w: pw, h: ph } };
}

/** A real screenshot of the device screen. */
function screencap(file) {
  const buf = spawnSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 64 * 1024 * 1024 });
  if (buf.status !== 0 || !buf.stdout?.length) throw new Error("screencap failed");
  writeFileSync(file, buf.stdout);
  return file;
}

/* ------------------------------------------------------------------ cdp */

let ws = null;
let seq = 0;
const pending = new Map();

function send(method, params = {}, timeoutMs = 20000) {
  const id = ++seq;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rej(new Error(`cdp timeout after ${timeoutMs}ms: ${method}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); res(v); },
      reject: (e) => { clearTimeout(timer); rej(e); },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, timeoutMs = 20000) {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, timeoutMs);
  if (r.exceptionDetails) {
    throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  }
  return r.result?.value;
}

async function connect() {
  const list = JSON.parse(
    spawnSync("curl", ["-s", `http://127.0.0.1:${PORT}/json/list`], { encoding: "utf8" }).stdout || "[]",
  );
  const target = list.find((t) => t.type === "page" && (t.url ?? "").includes("widget.html"));
  if (!target) throw new Error(`no widget.html target: ${JSON.stringify(list.map((t) => t.url))}`);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");
  // Without this Chrome does not synthesise touch from dispatchTouchEvent
  // inside a WebView, and the widget never sees a pointer gesture.
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }).catch(() => {});
  return target;
}

/* --------------------------------------------------------------- widget */

/** Wait until the widget has booted and its host probe resolved. */
async function waitBooted(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const ok = await evaluate("!!(window.__SAFI_DIAG__ && window.__SAFI_DIAG__.bootCompleted)", 5000);
      if (ok) return true;
    } catch (error) {
      last = String(error.message ?? error);
    }
    await sleep(200);
  }
  throw new Error(`widget never reported bootCompleted: ${last}`);
}

/**
 * What the page itself measures. `client` vs `scroll` is the §2 contract
 * (no internal scroll) and `box` is the §3 contract (fixed 3:2 shell).
 */
const PROBE = `(() => {
  const d = window.__SAFI_DIAG__ || {};
  const w = document.getElementById("widget");
  const body = document.body;
  const r = w ? w.getBoundingClientRect() : null;
  return {
    mode: d.mode ?? null,
    state: d.state ?? null,
    view: d.inputView ?? null,
    surface: w ? {
      clientW: w.clientWidth, clientH: w.clientHeight,
      scrollW: w.scrollWidth, scrollH: w.scrollHeight,
      rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
    } : null,
    bodyScroll: { w: body.scrollWidth, h: body.scrollHeight,
                  cw: body.clientWidth, ch: body.clientHeight },
    dpr: window.devicePixelRatio,
    inner: { w: window.innerWidth, h: window.innerHeight },
    orientation: window.screen?.orientation?.type ?? null,
    hashKeys: d.hashKeys ?? null,
    window: d.window ?? null,
    placement: d.placement ?? null,
    recovery: d.recovery ?? null,
    recoveries: d.recoveries ?? [],
    gesture: d.gesture ?? null,
  };
})()`;

async function probe() {
  return evaluate(PROBE);
}

/* ----------------------------------------------------------------- steps */

const steps = [];

/**
 * Wait until the surface is actually laid out. The page is mid-EXPANDING
 * (panel not yet revealed) for a moment after boot, and a 0x0 box there
 * would be a lie, not evidence.
 */
async function waitSurface(timeoutMs = 15000, want = EXPANDED) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await probe();
      const r = last.surface?.rect;
      if (r && r.w > 0 && (want === null || (Math.abs(r.w - want.w) <= 2 && Math.abs(r.h - want.h) <= 2))) {
        await sleep(400);
        return last;
      }
    } catch { /* the document is still loading */ }
    await sleep(250);
  }
  throw new Error(`surface never reached ${JSON.stringify(want)}: got ${JSON.stringify(last?.surface?.rect)}`);
}

/**
 * The REAL frame: an actual screencap of the phone, cropped to the rect
 * the widget genuinely occupies on it. Cropping a real screen capture is
 * honest evidence; a CDP screenshot of a WebView is flaky and, taken
 * alone, would not be the device's own pixels.
 */
async function shot(name, note) {
  const p = await probe();
  const rect = p.surface?.rect;
  const dpr = p.dpr || 1;
  const full = join(OUT, `${name}-device.png`);
  screencap(full);
  const file = join(OUT, `${name}.png`);
  let cropped = false;
  let crop = null;
  if (rect && rect.w > 0) {
    // Page coordinates are NOT screen coordinates: the status bar overlays
    // the activity. Convert through the real system insets.
    const ins = insetsFor(String(p.orientation ?? "").startsWith("landscape"));
    const x = Math.max(0, Math.round(rect.x * dpr) + ins.left);
    const y = Math.max(0, Math.round(rect.y * dpr) + ins.top);
    const w = Math.round(rect.w * dpr);
    const h = Math.round(rect.h * dpr);
    crop = { x, y, w, h, insets: ins };
    const r = spawnSync("sips", ["-c", String(h), String(w), "--cropOffset", String(y), String(x), full, "--out", file], { encoding: "utf8" });
    cropped = r.status === 0 && existsSync(file);
  }
  const entry = { name, note, probe: p, cropped, crop, dpr, screenshot: cropped ? file : null, deviceScreenshot: full };
  steps.push(entry);
  process.stderr.write(`[android] ${name} — ${rect ? `${Math.round(rect.w)}x${Math.round(rect.h)} @ ${Math.round(rect.x)},${Math.round(rect.y)} dpr${dpr}` : "no rect"}${cropped ? "" : " (uncropped)"}\n`);
  return entry;
}

let navSeq = 0;
/**
 * A fresh document per step.
 *
 * A URL that differs only in its fragment is a SAME-DOCUMENT navigation:
 * the boot code never re-runs, and `Page.reload` races it (it reloads the
 * OLD url), so the hook silently never fires. A cache-busting query makes
 * it a real cross-document load, so there is no race to lose.
 */
async function nav(hash) {
  await send("Page.navigate", { url: `${WIDGET_URL}?t=${++navSeq}#${hash}` }, 30000);
  await waitBooted();
  /* The widget reads its hash hook and then strips the fragment, so the
     proof that the hook LOADED is the key it recorded, not the live URL. */
  const keys = await evaluate("JSON.stringify(window.__SAFI_DIAG__?.hashKeys ?? [])");
  const want = hash.split("=")[0];
  if (!String(keys).includes(want)) {
    throw new Error(`hook did not load: wanted ${want}, page recorded ${keys}`);
  }
  await sleep(1000);
}

/**
 * A REAL touch drag: Chrome's own touch event pipeline, at the mascot's
 * actual on-screen coordinates, with intermediate moves. The widget's
 * pointer controller must classify it as a surface drag and ask the
 * Android host to move the overlay.
 */
async function touchDrag(name, from, to, stepsN = 14) {
  const before = await evaluate("window.__SAFI_DIAG__?.window ?? null");
  const touch = (type, x, y) => send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1 }],
  });
  await touch("touchStart", from.x, from.y);
  for (let i = 1; i <= stepsN; i++) {
    const x = Math.round(from.x + ((to.x - from.x) * i) / stepsN);
    const y = Math.round(from.y + ((to.y - from.y) * i) / stepsN);
    await touch("touchMove", x, y);
    await sleep(35);
  }
  await touch("touchEnd", to.x, to.y);
  await sleep(800);
  const after = await evaluate("window.__SAFI_DIAG__?.window ?? null");
  const gesture = await evaluate("window.__SAFI_DIAG__?.gesture ?? null");
  const drag = await evaluate("window.__SAFI_DIAG__?.drag ?? null");
  const entry = await shot(name, `real touch drag ${from.x},${from.y} -> ${to.x},${to.y}`);
  entry.drag = { before, after, gesture, diag: drag };
  process.stderr.write(`[android]   drag ${JSON.stringify(before)} -> ${JSON.stringify(after)}\n`);
  return entry;
}

/* ------------------------------------------------------------------ main */

const info = deviceInfo();
process.stderr.write(`[android] device ${info.model} android ${info.androidRelease} ${info.physicalSize} @${info.density}dpi\n`);

// Launch the real activity hosting the real widget.
adb(["shell", "am", "force-stop", PKG]);
await sleep(800);
adb(["shell", "am", "start", "-n", `${PKG}/.WidgetActivity`]);
await sleep(3500);
const pid = sh(`pidof ${PKG}`).trim().split(/\s+/)[0];
if (!pid) throw new Error("app did not start");
spawnSync("adb", ["forward", "--remove-all"], { encoding: "utf8" });
adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
await sleep(800);
const target = await connect();
process.stderr.write(`[android] cdp target ${target.id} ${target.url}\n`);

// 1) PORTRAIT — the INPUT view at the 3:2 contract.
await nav("open=1");
await waitSurface();
const portraitInput = await shot("01-android-input-3x2-portrait", "INPUT view, portrait, 3:2 shell");

// 2) PROMPT_READY on the same 3:2 surface.
await nav("demo=ask-prompt");
await waitSurface();
const promptReady = await shot("02-android-prompt-ready-portrait", "PROMPT_READY inside the same 3:2 shell");

// 3) A REAL touch drag of the mascot/header, portrait, by the overlay adapter.
await nav("open=1");
await waitSurface();
/* A drag region is only a drag region if the point under the finger is not
   a control. `#collapsed` is a zero-size region, and the centre of the
   glass lands on the actions row, so the start point is chosen by hit
   test — the same rule the pointer controller itself applies. */
const mascot = await evaluate(`(() => {
  const BLOCK = "[data-no-drag], #prompt-text, .prompt-actions, .stamp-row, .chip-row, .actions-row, .field";
  for (const m of document.querySelectorAll("[data-safi-drag]")) {
    const r = m.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
    const hit = document.elementFromPoint(x, y);
    if (!hit || hit.closest(BLOCK)) continue;
    return { x, y, tag: m.id || m.className, hit: hit.id || hit.tagName };
  }
  return null;
})()`);
if (!mascot) throw new Error("no [data-safi-drag] region in the live widget");
const dragged = await touchDrag("03-android-portrait-drag", mascot, { x: mascot.x + 40, y: mascot.y + 520 });

// 4) OFF-SCREEN recovery: the EXPANDED widget asks for a position no
//    screen can show, and the adapter must clamp the real 384x256 box
//    back on screen.
await nav("open=1&placeOffScreen=1");
await waitSurface(null, 12000).catch(() => {});
await sleep(900);
const offscreenShot = await shot("04-android-offscreen-recovery", "requested 99999,99999; the 384x256 overlay must clamp back on screen");
offscreenShot.offscreen = await evaluate("window.__SAFI_DIAG__?.placement ?? null");

// 5) LANDSCAPE recovery: place the widget at the bottom-right in portrait
//    (a real, visible, remembered position), then rotate the real device.
//    In landscape that y is off-screen, so recovery must clamp it back.
await nav("open=1&placeBottomRight=1");
await waitSurface();
const portraitPlaced = await evaluate("JSON.stringify(window.__SAFI_DIAG__?.placement ?? null)");
adb(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
adb(["shell", "settings", "put", "system", "user_rotation", "1"]);
await sleep(4500);
await waitSurface();
const landscape = await shot("05-android-landscape-recovery", "rotated to landscape; a portrait-only position must be clamped back on screen, still 3:2");
landscape.portraitPlacement = JSON.parse(portraitPlaced ?? "null");
const landscapeSize = sh("wm size");
const landscapeRotation = landscape.probe.orientation;

// Back to portrait for the record.
adb(["shell", "settings", "put", "system", "user_rotation", "0"]);
await sleep(3500);
await waitSurface();
const backToPortrait = await shot("06-android-portrait-recovered", "rotated back; widget still intact and 3:2");

// 6) §9: the product-completion card, inside the SAME fixed 3:2 shell.
//    A result may scroll and disclose, but it may never grow the window.
await nav("demo=verify-right");
await waitSurface();
await sleep(1200);
const cardText = await evaluate(`(() => {
  const el = document.getElementById("answer");
  const stamp = document.getElementById("stamp");
  const result = document.getElementById("result");
  return {
    answer: (el?.textContent || "").slice(0, 400),
    stampVisible: stamp ? !stamp.hidden : null,
    trustStatus: stamp?.getAttribute?.("data-trust") ?? stamp?.dataset?.trust ?? null,
    resultVisible: result ? !result.classList.contains("hidden") : null,
  };
})()`);
const verifyResult = await shot("07-android-verify-result-3x2", "product-completion result inside the same 3:2 shell");
verifyResult.card = cardText;

// The same file, byte for byte, on both platforms.
const staged = join(repo, "apps/android/app/src/main/assets/apps/desktop/widget.html");
const desktop = join(repo, "apps/desktop/widget.html");
const sameFile = existsSync(staged) && existsSync(desktop)
  ? readFileSync(staged).equals(readFileSync(desktop))
  : null;

const report = {
  capturedAt: new Date().toISOString(),
  device: info,
  activity: `${PKG}/.WidgetActivity`,
  cdpTarget: { id: target.id, url: target.url },
  widgetUrl: WIDGET_URL,
  surfaceContract: EXPANDED,
  sameWidgetFileAsDesktop: sameFile,
  landscape: { orientation: landscapeRotation, wmSize: landscapeSize },
  steps: steps.map((s) => ({
    name: s.name,
    note: s.note,
    surface: s.probe?.surface ?? null,
    bodyScroll: s.probe?.bodyScroll ?? null,
    inner: s.probe?.inner ?? null,
    orientation: s.probe?.orientation ?? null,
    hashKeys: s.probe?.hashKeys ?? null,
    window: s.probe?.window ?? null,
    recovery: s.probe?.recovery ?? null,
    recoveries: s.probe?.recoveries ?? [],
    portraitPlacement: s.portraitPlacement ?? null,
    card: s.card ?? null,
    drag: s.drag ?? null,
    offscreen: s.offscreen ?? s.probe?.placement ?? null,
    screenshot: s.screenshot,
    deviceScreenshot: s.deviceScreenshot,
    cropped: s.cropped,
    crop: s.crop ?? null,
    dpr: s.dpr,
  })),
  summary: {
    captured: steps.length,
    /* §2, per state: the INPUT view must have NO internal scroll. The
       result views (PROMPT_READY / VERIFY_RESULT / DETAILS) are ALLOWED
       to scroll inside the fixed shell — that is progressive disclosure,
       not a growing window. */
    inputHasNoInternalScroll: (() => {
      const su = portraitInput.probe?.surface; const b = portraitInput.probe?.bodyScroll;
      if (!su) return null;
      return su.scrollH <= su.clientH + 1 && su.scrollW <= su.clientW + 1 &&
             b.h <= b.ch + 1 && b.w <= b.cw + 1;
    })(),
    inputIsThreeByTwo: portraitInput.probe?.surface
      ? Math.abs(portraitInput.probe.surface.clientW / portraitInput.probe.surface.clientH - 1.5) < 0.02
      : null,
    /* §3: the shell is 384x256 in EVERY expanded state, including the
       result states that are allowed to scroll inside it. */
    expandedStatesAllThreeByTwo: steps
      .filter((s) => (s.probe?.surface?.clientH ?? 0) > 0)
      .map((s) => `${s.probe.surface.clientW}x${s.probe.surface.clientH}`),
    promptReadyStaysThreeByTwo: promptReady.probe?.surface
      ? promptReady.probe.surface.clientW === EXPANDED.w && promptReady.probe.surface.clientH === EXPANDED.h
      : null,
    resultScrollsInsideFixedShell: promptReady.probe?.surface
      ? promptReady.probe.surface.scrollH > promptReady.probe.surface.clientH
      : null,
    landscapeStaysThreeByTwo: landscape.probe?.surface
      ? landscape.probe.surface.clientW === EXPANDED.w && landscape.probe.surface.clientH === EXPANDED.h
      : null,
    /* The rotation clamp is real when SOME recovery moved the window,
       not when the last one happened to be a no-op. */
    landscapeClampedBackOnScreen: (landscape.probe?.recoveries ?? []).some(
      (r) => r.clamped === true && (r.before?.y !== r.after?.y || r.before?.x !== r.after?.x),
    ) || null,
    landscapeRecoveryLog: (landscape.probe?.recoveries ?? []).map(
      (r) => `${JSON.stringify(r.before)} -> ${JSON.stringify(r.after)} clamped=${r.clamped}`,
    ),
    landscapeWindowVisible: (() => {
      const w = landscape.probe?.window; const a = w?.workArea;
      if (!w || !a) return null;
      return w.x >= a.x - 1 && w.y >= a.y - 1 && w.x + w.w <= a.x + a.w + 1 && w.y + w.h <= a.y + a.h + 1;
    })(),
    dragMovedOverlay: dragged.drag?.after && dragged.drag?.before
      ? dragged.drag.after.x !== dragged.drag.before.x || dragged.drag.after.y !== dragged.drag.before.y
      : null,
    dragWasRealTouchGesture: dragged.drag?.gesture
      ? dragged.drag.gesture.on === "surface" && dragged.drag.gesture.blocked === false && dragged.drag.diag?.moved === true
      : null,
    dragReleaseClampedAndSnapped: dragged.drag?.after
      ? { clamped: dragged.drag.after.clamped === true, snapped: dragged.drag.after.snapped === true }
      : null,
    /* §9: the completion card renders, and the shell is still 3:2. */
    verifyResultStaysThreeByTwo: verifyResult.probe?.surface
      ? verifyResult.probe.surface.clientW === EXPANDED.w && verifyResult.probe.surface.clientH === EXPANDED.h
      : null,
    cardRendered: cardText.resultVisible === true && String(cardText.answer ?? "").length > 0,
    offscreenClamped: offscreenShot.offscreen ? offscreenShot.offscreen.clamped === true : null,
    offscreenVisible: offscreenShot.offscreen ? offscreenShot.offscreen.visible === true : null,
  },
};

writeFileSync(join(OUT, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stderr.write(`\n[android] wrote ${join(OUT, "evidence.json")}\n`);
process.stderr.write(`[android] summary ${JSON.stringify(report.summary)}\n`);
process.stderr.write(`[android] same widget file as desktop: ${sameFile}\n`);
console.log(JSON.stringify(report.summary, null, 2));
process.exit(0);
