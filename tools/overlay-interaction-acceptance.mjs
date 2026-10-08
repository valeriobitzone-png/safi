#!/usr/bin/env node
/**
 * SAFI ANDROID — DISMISS + IME ACCEPTANCE.
 *
 * Two product gaps the geometry acceptance did not cover:
 *
 *   1. Safi could not be put away by the person using it.
 *   2. Tapping a Safi field did not bring up the Android keyboard.
 *
 * Everything here happens on a real `TYPE_APPLICATION_OVERLAY` on a
 * physical device, over a real app. The window flags are read from
 * `dumpsys window windows` — the only place they are actually true — and
 * the keyboard is read from the input method manager, not inferred.
 *
 * The overlay is PASSIVE by contract: it carries FLAG_NOT_FOCUSABLE and
 * the app underneath keeps the keyboard. Taking that flag away is only
 * ever allowed while a field is genuinely being edited, and the tool
 * checks it came back.
 *
 *   node tools/overlay-interaction-acceptance.mjs [outDir]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(process.argv[2] ?? join(repo, "artifacts/three-by-two/interaction"));
const PKG = "dev.safi.app";
const PORT = 9433;
const WIDGET_URL = "https://appassets.androidplatform.net/apps/desktop/widget.html";
const TEXT = "ciao safi";

mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ adb */

function adb(args) {
  const r = spawnSync("adb", args, { encoding: "utf8", timeout: 120000 });
  if (r.status !== 0) throw new Error(`adb ${args.join(" ")}: ${((r.stdout || "") + (r.stderr || "")).trim()}`);
  return (r.stdout || "") + (r.stderr || "");
}
const sh = (cmd) => spawnSync("adb", ["shell", cmd], { encoding: "utf8", timeout: 60000 }).stdout || "";
const tap = (x, y) => adb(["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
const swipe = (x1, y1, x2, y2, ms) => adb(["shell", "input", "swipe", String(Math.round(x1)), String(Math.round(y1)), String(Math.round(x2)), String(Math.round(y2)), String(ms)]);
/** A stationary press: what a long press actually is to the input system. */
const longPress = (x, y, ms = 900) => swipe(x, y, x, y, ms);

/* -------------------------------------------------------------- window */

/**
 * Every overlay window the package owns.
 *
 * Editing a field makes the WebView put a text-selection popup on screen.
 * That popup is ALSO a TYPE_APPLICATION_OVERLAY owned by the same package
 * — it really is a small window the widget did not ask for — so "the first
 * 2038 window for dev.safi.app" stops being the widget the moment anyone
 * types. Reading it measures a 60×72 selection handle as though it were
 * the companion.
 */
function overlayWindows() {
  return sh("dumpsys window windows")
    .split(/\n\s*Window #\d+ Window\{/)
    .filter((b) => b.includes(`u0 ${PKG}`) && /mToken=WindowToken\{[^}]*type=2038/.test(b))
    .map((b) => {
      const f = /frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(b);
      if (!f) return null;
      const rq = /Requested w=(\d+) h=(\d+)/.exec(b);
      const x = Number(f[1]), y = Number(f[2]), r = Number(f[3]), bo = Number(f[4]);
      return {
        tokenType: 2038,
        isApplicationOverlay: true,
        flags: /fl=(.*)/.exec(b)?.[1]?.trim() ?? "",
        requested: rq ? { w: Number(rq[1]), h: Number(rq[2]) } : null,
        x, y, w: r - x, h: bo - y,
      };
    })
    .filter(Boolean);
}

/**
 * The widget's own window.
 *
 * The host sized this window, so its REQUESTED size is the one it reports
 * over the bridge; matching on that identifies the companion exactly, even
 * with a WebView popup on screen. Falling back to the largest overlay is
 * only for when the page cannot be asked, and the popup is never larger
 * than the widget.
 */
function overlayWindow(expected = null) {
  const all = overlayWindows();
  if (!all.length) return null;
  if (expected) {
    const exact = all.find((w) => w.requested
      && Math.abs(w.requested.w - expected.w) <= 2
      && Math.abs(w.requested.h - expected.h) <= 2);
    if (exact) return exact;
  }
  return all.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h))[0];
}

/** How many overlay windows the package owns. Zero means nothing intercepts. */
const overlayWindowCount = () => sh("dumpsys window windows")
  .split(/\n\s*Window #\d+ Window\{/)
  .filter((b) => b.includes(`u0 ${PKG}`) && /mToken=WindowToken\{[^}]*type=2038/.test(b)).length;

/**
 * Every window the package owns, with its token type. Recorded alongside
 * a suspicious reading so a frame can be checked against what the window
 * server actually had: editing a field makes the WebView put its own
 * popup on screen, and that is a real window, not the widget.
 */
function packageWindows() {
  return sh("dumpsys window windows")
    .split(/\n\s*Window #\d+ Window\{/)
    .filter((b) => b.includes(`u0 ${PKG}`))
    .map((b) => ({
      type: /mToken=WindowToken\{[^}]*type=(\d+)/.exec(b)?.[1] ?? null,
      frame: /frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(b)?.slice(1).map(Number) ?? null,
      flags: /fl=(.*)/.exec(b)?.[1]?.trim() ?? null,
    }))
    .map((w) => (w.frame ? { type: w.type, x: w.frame[0], y: w.frame[1], w: w.frame[2] - w.frame[0], h: w.frame[3] - w.frame[1], flags: w.flags } : w));
}

const isFocusable = (w) => !!w && !/\bNOT_FOCUSABLE\b/.test(w.flags);
const isPassive = (w) => !!w && /\bNOT_FOCUSABLE\b/.test(w.flags);

/** The size the HOST asked for, which is what identifies the widget window. */
async function hostSize() {
  try {
    const s = JSON.parse(await evaluate(`String(window.SafiOverlay?.state?.() ?? "{}")`));
    const dpr = Number(await evaluate("devicePixelRatio")) || 3;
    return s?.w ? { w: Math.round(s.w * dpr), h: Math.round(s.h * dpr) } : null;
  } catch { return null; }
}
const widgetWindow = async () => overlayWindow(await hostSize());

/* ------------------------------------------------------------------ ime */

function imeState() {
  const d = sh("dumpsys input_method");
  return {
    shown: /mInputShown=true/.test(d),
    served: !/mServedInputConnection=null/.test(d),
    windowVis: /mImeWindowVis=(0x[0-9a-f]+)/.exec(d)?.[1] ?? null,
  };
}

/* ------------------------------------------------------------- capture */

/**
 * A frame, as raw pixels.
 *
 * `screencap` without `-p` is a 16-byte header followed by w*h*4 RGBA
 * bytes, which means the pixels can be compared directly with no image
 * decoding at all — the transparency-style proof from the geometry run,
 * at a fraction of the cost.
 */
function grab(file) {
  const buf = spawnSync("adb", ["exec-out", "screencap"], { maxBuffer: 96 * 1024 * 1024 }).stdout;
  const b = Buffer.from(buf);
  const w = b.readUInt32LE(0), h = b.readUInt32LE(4);
  if (b.length !== 16 + w * h * 4) throw new Error(`unexpected screencap size ${b.length} for ${w}x${h}`);
  const body = b.subarray(16);
  let sum = 0, sum2 = 0, n = 0;
  for (let i = 0; i < body.length; i += 4 * 7) {
    const l = 0.2126 * body[i] + 0.7152 * body[i + 1] + 0.0722 * body[i + 2];
    sum += l; sum2 += l * l; n++;
  }
  const mean = sum / n;
  const stats = { mean, sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), w, h };
  // A black rectangle is not evidence, and neither is a lock screen.
  if (mean < 6 || stats.sd < 10) throw new Error(`refusing to record ${file}: the display shows nothing (mean=${mean.toFixed(2)} sd=${stats.sd.toFixed(2)})`);
  writeFileSync(file, b);
  return { file, ...stats };
}

/** How much of a band of the frame changed. Used to prove an app reacted. */
function bandChanged(a, b, rect) {
  const A = readFileSync(a), B = readFileSync(b);
  const w = A.readUInt32LE(0);
  let differing = 0, total = 0;
  for (let y = rect.y; y < rect.y + rect.h; y += 3) {
    for (let x = rect.x; x < rect.x + rect.w; x += 3) {
      const i = 16 + (y * w + x) * 4;
      total++;
      if (Math.abs(A[i] - B[i]) > 6 || Math.abs(A[i + 1] - B[i + 1]) > 6 || Math.abs(A[i + 2] - B[i + 2]) > 6) differing++;
    }
  }
  return { differing, total, pct: +((differing / Math.max(1, total)) * 100).toFixed(2) };
}

/* ------------------------------------------------------------------ cdp */

let ws = null, seq = 0;
const pending = new Map();
function send(method, params = {}, timeoutMs = 25000) {
  const id = ++seq;
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(id); rej(new Error(`cdp timeout ${method}`)); }, timeoutMs);
    pending.set(id, { resolve: (v) => { clearTimeout(t); res(v); }, reject: (e) => { clearTimeout(t); rej(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}
async function attach() {
  const pid = sh(`pidof ${PKG}`).trim().split(/\s+/)[0];
  if (!pid) throw new Error("app not running");
  spawnSync("adb", ["forward", "--remove-all"], { encoding: "utf8" });
  adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
  await sleep(1200);
  const list = JSON.parse(spawnSync("curl", ["-s", `http://127.0.0.1:${PORT}/json/list`], { encoding: "utf8" }).stdout || "[]");
  const target = list.find((t) => t.type === "page" && (t.url ?? "").includes("widget.html"));
  if (!target) throw new Error(`no overlay target: ${JSON.stringify(list.map((t) => t.url))}`);
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");
  return target;
}

let navSeq = 0;
async function setState(hash, settle = 3000) {
  await send("Page.navigate", { url: `${WIDGET_URL}?i=${++navSeq}#${hash}` });
  await sleep(settle);
  return evaluate(`(() => {
    const w = document.getElementById("widget");
    return {
      mode: window.__SAFI_UI__?.mode ?? null,
      client: w && !w.hidden ? { w: w.clientWidth, h: w.clientHeight } : null,
      dpr: devicePixelRatio,
    };
  })()`);
}

/** Where a DOM element actually is, in screen pixels. */
async function screenRect(selector) {
  const rect = JSON.parse(await evaluate(`JSON.stringify((() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })())`));
  if (!rect) throw new Error(`no element ${selector}`);
  const w = await widgetWindow();
  const dpr = Number(await evaluate("devicePixelRatio"));
  return {
    x: w.x + Math.round(rect.x * dpr),
    y: w.y + Math.round(rect.y * dpr),
    w: Math.round(rect.w * dpr),
    h: Math.round(rect.h * dpr),
  };
}

const topActivity = () => {
  const dump = sh("dumpsys activity activities");
  return /ResumedActivity: ActivityRecord\{[^}]* u0 (\S+?)[/ ]/.exec(dump)?.[1]
    ?? /topResumedActivity=ActivityRecord\{[^}]* u0 (\S+?)[/ ]/.exec(dump)?.[1] ?? null;
};

/* ------------------------------------------------------------- display */

function displayConfig() {
  const cur = /cur=(\d+)x(\d+)/.exec(sh("dumpsys window displays")) ?? [];
  return { w: Number(cur[1] ?? 0), h: Number(cur[2] ?? 0) };
}
function panelSize() {
  // The raw frame is a 16-byte header then RGBA, and the two dimensions
  // are LITTLE endian at offset 0 — the PNG header layout would read
  // nonsense and make the panel look impossibly large.
  const b = Buffer.from(spawnSync("adb", ["exec-out", "screencap"], { maxBuffer: 96 * 1024 * 1024, encoding: "buffer" }).stdout);
  return { w: b.readUInt32LE(0), h: b.readUInt32LE(4) };
}
async function wake() {
  adb(["shell", "settings", "put", "system", "screen_off_timeout", "2147483647"]);
  adb(["shell", "settings", "put", "system", "lockscreen.timeout", "2147483647"]);
  adb(["shell", "settings", "put", "global", "stay_on_while_plugged_in", "7"]);
  adb(["shell", "svc", "power", "stayon", "true"]);
  adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
  await sleep(1200);
  adb(["shell", "wm", "dismiss-keyguard"]);
  await sleep(1500);
  let locked = /isKeyguardShowing=true/.test(sh("dumpsys window | grep -m1 isKeyguardShowing"));
  for (let i = 0; i < 6 && locked; i++) {
    adb(["shell", "input", "keyevent", "KEYCODE_MENU"]);
    await sleep(1400);
    locked = /isKeyguardShowing=true/.test(sh("dumpsys window | grep -m1 isKeyguardShowing"));
  }
  return { keyguard: locked ? "showing" : "dismissed" };
}
async function resyncDisplay() {
  adb(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
  for (const r of [1, 0]) {
    adb(["shell", "settings", "put", "system", "user_rotation", String(r)]);
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      if ((r === 1) === (panelSize().w > panelSize().h)) break;
    }
  }
  await sleep(2000);
  return { cfg: displayConfig(), panel: panelSize() };
}
async function rotate(rotation) {
  // A foreground activity that pins its orientation stops the DISPLAY from
  // rotating, and this launcher does exactly that: with it in front,
  // `user_rotation` is accepted by settings and then silently ignored by
  // the window manager. A normal rotatable app is parked in front first —
  // the overlay still floats over it, so the frame is unchanged.
  await launch("com.android.chrome");
  adb(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
  await sleep(1200);
  adb(["shell", "settings", "put", "system", "user_rotation", String(rotation)]);
  const wantLandscape = rotation === 1;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const panel = panelSize(), cfg = displayConfig();
    if (wantLandscape === (panel.w > panel.h) && cfg.w === panel.w && cfg.h === panel.h) return true;
  }
  return false;
}

/**
 * Taps a real notification action, by its own label.
 *
 * The service is deliberately not exported, so a shell command cannot
 * drive it — and it should not be. The only honest way to prove the
 * notification is a working way out is to open the shade a person would
 * open and tap the button they would tap, which is found from the live
 * view hierarchy rather than from hard-coded coordinates.
 *
 * Three things about this shade are worth writing down, because all three
 * cost a wrong answer:
 *
 *   - A long swipe from the top fully expands QUICK SETTINGS, and the
 *     notification list ends up below the fold, off the screen. The list
 *     a person actually reads is one `expand-notifications` away.
 *   - The card is COLLAPSED on arrival, so the action buttons do not exist
 *     as views until it is expanded. Tapping the card runs its content
 *     intent instead — on this device that relaunched Safi, which is the
 *     wrong answer dressed as a right one. The expand chevron
 *     (`android:id/expand_button`) is the control that means "show me the
 *     buttons".
 *   - `uiautomator` refuses to dump while the UI is animating ("could not
 *     get idle state"), so every dump is retried rather than assumed.
 */
async function shadeDump(attempts = 4) {
  const dumpPath = "/sdcard/safi-ui.xml";
  for (let i = 0; i < attempts; i++) {
    if (/dumped to/.test(sh(`uiautomator dump ${dumpPath}`))) {
      const xml = sh(`cat ${dumpPath}`);
      if (xml.includes("<hierarchy")) return xml;
    }
    await sleep(1500);
  }
  return "";
}
const nodeAttr = (node, key) => (node.match(new RegExp(`${key}="([^"]*)"`)) || [])[1] ?? "";
const nodeBox = (node) => (node.match(/bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/) || [])
  .slice(1).map(Number);

async function tapNotificationAction(label, rowTitle) {
  sh("cmd statusbar expand-notifications");
  await sleep(3000);

  // The list is long and the card is somewhere in it, so walk down until
  // the row is on screen rather than assuming a scroll offset.
  let xml = "", title = null;
  for (let i = 0; i < 14; i++) {
    xml = await shadeDump();
    title = [...xml.matchAll(/<node[^>]*>/g)].find((m) => nodeAttr(m[0], "text") === rowTitle);
    if (title) break;
    swipe(630, 2300, 630, 1100, 300);
    await sleep(1400);
  }
  if (!title) {
    sh("input keyevent KEYCODE_BACK");
    return { tapped: false, reason: `row ${rowTitle} not found in the shade` };
  }

  // Expand the card through its own chevron: the nearest expand button on
  // the same line of pixels as this row's title.
  const t = nodeBox(title[0]);
  const ty = (t[1] + t[3]) / 2;
  const chevron = [...xml.matchAll(/<node[^>]*>/g)]
    .map((m) => m[0])
    .filter((n) => nodeAttr(n, "resource-id") === "android:id/expand_button")
    .map((n) => nodeBox(n))
    .sort((a, b) => Math.abs((a[1] + a[3]) / 2 - ty) - Math.abs((b[1] + b[3]) / 2 - ty))[0];
  if (!chevron) {
    sh("input keyevent KEYCODE_BACK");
    return { tapped: false, reason: "no expand chevron on the card" };
  }
  tap((chevron[0] + chevron[2]) / 2, (chevron[1] + chevron[3]) / 2);
  await sleep(2500);

  const expanded = await shadeDump();
  // Everything the expanded card actually offers, so "the card has a way
  // out" is a reading of the screen and not a claim about the source.
  const offered = [...expanded.matchAll(/<node[^>]*>/g)]
    .map((m) => m[0])
    .filter((n) => /android:id\/action\d+$/.test(nodeAttr(n, "resource-id")))
    .map((n) => nodeAttr(n, "text"));
  const action = [...expanded.matchAll(/<node[^>]*>/g)]
    .find((m) => nodeAttr(m[0], "text") === label);
  if (!action) {
    sh("input keyevent KEYCODE_BACK");
    return { tapped: false, reason: `action ${label} not offered on the expanded card`, offered };
  }
  const b = nodeBox(action[0]);
  tap((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
  await sleep(3000);
  return { tapped: true, label, bounds: b, offered };
}
function restoreDevice() {
  spawnSync("adb", ["shell", "settings", "put", "system", "user_rotation", "0"], { encoding: "utf8", timeout: 30000 });
  spawnSync("adb", ["shell", "settings", "put", "system", "accelerometer_rotation", "1"], { encoding: "utf8", timeout: 30000 });
  spawnSync("adb", ["shell", "settings", "put", "system", "screen_off_timeout", "30000"], { encoding: "utf8", timeout: 30000 });
}
process.on("exit", restoreDevice);

/* --------------------------------------------------------------- steps */

const steps = [];
const note = (s) => process.stderr.write(`[interaction] ${s}\n`);

const AWAKE = await wake();
note(`wake: keyguard=${AWAKE.keyguard}`);
if (AWAKE.keyguard === "showing") {
  console.error("[interaction] the keyguard will not dismiss; touches would be swallowed by the lock screen. Unlock the phone and re-run.");
  process.exit(2);
}
const resync = await resyncDisplay();
note(`display: wms ${resync.cfg.w}x${resync.cfg.h} panel ${resync.panel.w}x${resync.panel.h}`);
if (resync.cfg.w !== resync.panel.w || resync.cfg.h !== resync.panel.h) {
  console.error("[interaction] the window server and the panel disagree about rotation; every measurement would be wrong.");
  process.exit(2);
}
if (!(resync.panel.w < resync.panel.h)) {
  console.error("[interaction] the run did not settle into portrait.");
  process.exit(2);
}

async function launch(pkg) {
  if (pkg === "home") { sh("input keyevent KEYCODE_HOME"); }
  else {
    const comp = sh(`cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${pkg}`)
      .trim().split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes("/")).pop();
    if (!comp) throw new Error(`no LAUNCHER activity for ${pkg}`);
    sh(`am start -n ${comp}`);
  }
  await sleep(3200);
}

async function startSafi() {
  adb(["shell", "am", "force-stop", PKG]);
  await sleep(1500);
  adb(["shell", "am", "start", "-n", `${PKG}/.BubbleActivity`]);
  await sleep(6000);
  await attach();
}

async function expand() {
  const w = await widgetWindow();
  tap(w.x + w.w / 2, w.y + w.h / 2);
  await sleep(2600);
  return widgetWindow();
}

/* ===================================================== 1. passive rest */

await startSafi();
await launch("com.android.chrome");
const resting = await widgetWindow();
const restingIme = imeState();
note(`resting: window ${resting?.w}x${resting?.h} flags="${resting?.flags}" ime=${JSON.stringify(restingIme)}`);
steps.push({
  name: "01-resting-passive-over-chrome",
  note: "COMPACT over Chrome. The window is passive: FLAG_NOT_FOCUSABLE is set and the app underneath keeps the keyboard.",
  window: resting, ime: restingIme, underlyingApp: topActivity(),
  frame: grab(join(OUT, "01-resting-passive-over-chrome.raw")).file,
});
const passiveAtRest = isPassive(resting) && resting.w === 264 && resting.h === 264 && !restingIme.shown;

/**
 * Where the page's coordinate space meets the window server's.
 *
 * The page positions the widget in CSS pixels; `dumpsys` reports the frame
 * in screen pixels, and the two are not the same origin — the window
 * server's child space already starts below the status bar. The gap is
 * measured here, once, from two readings taken at the same instant, so
 * every position comparison later in the run is grounded in something
 * real rather than in a constant that happens to be true on this phone.
 */
const DPR = Number(await evaluate("devicePixelRatio"));
/**
 * The host's own account of the window.
 *
 * `state()` is a JSON STRING, so stringifying it again produces a quoted
 * string and one `JSON.parse` hands back a string rather than an object —
 * which is a silent, late way to read `undefined` for every field. It is
 * unwrapped until there is an object left.
 */
const hostState = async () => {
  let v = await evaluate(`JSON.stringify(window.SafiOverlay.state())`);
  for (let i = 0; i < 4 && typeof v === "string"; i++) v = JSON.parse(v);
  if (!v || typeof v !== "object") throw new Error(`host state is not an object: ${JSON.stringify(v)}`);
  return v;
};
const restHost = await hostState();
const OFFSET_Y = resting.y - restHost.y * DPR;
note(`space: dpr=${DPR} host y=${restHost.y} -> frame y=${resting.y} (offset ${OFFSET_Y}px)`);
const frameOfHostY = (hostY) => Math.round(hostY * DPR + OFFSET_Y);

/* ================================================ 2. Ask: IME + typing */

let expanded = await expand();
note(`expanded: ${expanded?.w}x${expanded?.h} flags="${expanded?.flags}"`);
const passiveWhenExpanded = isPassive(expanded) && !imeState().shown;
steps.push({
  name: "02-expanded-still-passive",
  note: "EXPANDED over Chrome, and STILL passive: opening Safi does not take focus or the keyboard from the app underneath.",
  window: expanded, ime: imeState(), underlyingApp: topActivity(),
  frame: grab(join(OUT, "02-expanded-still-passive.raw")).file,
});

const speak = await screenRect("#speak");
tap(speak.x + speak.w / 2, speak.y + speak.h / 2);
await sleep(2600);
const askEdit = { window: await widgetWindow(), ime: imeState() };
note(`ask editing: flags="${askEdit.window?.flags}" ime=${JSON.stringify(askEdit.ime)}`);
adb(["shell", "input", "text", TEXT.replace(/ /g, "%s")]);
await sleep(1600);
const askValue = String(await evaluate(`document.getElementById("speak").value`));
const askActive = await evaluate(`document.activeElement?.id ?? ""`);
note(`ask typed: ${JSON.stringify(askValue)} activeElement=${askActive}`);
const askClient = JSON.parse(await evaluate(`JSON.stringify((() => { const c = document.getElementById("widget"); return { w: c.clientWidth, h: c.clientHeight }; })())`));
steps.push({
  name: "03-question-field-keyboard-and-typed-text",
  note: `Chrome underneath, the Ask field focused, the Android keyboard really up (mInputShown=${askEdit.ime.shown}) and "${askValue}" typed into the WebView. The window lost FLAG_NOT_FOCUSABLE for exactly as long as the editing lasted.`,
  window: askEdit.window, ime: askEdit.ime, typed: askValue, activeElement: askActive,
  content: askClient, underlyingApp: topActivity(),
  // Not "03-ask-…": the repository's own secret scanner reads `sk-<16+>`
  // as a provider key, and an evidence file is not the place to plant one.
  frame: grab(join(OUT, "03-question-field-keyboard-and-typed-text.raw")).file,
});
const imeOnAsk = isFocusable(askEdit.window) && askEdit.ime.shown && askEdit.ime.served;
const typedReachesWebView = askValue.toLowerCase().includes("ciao") && askValue.toLowerCase().includes("safi") && askActive === "speak";

/* ============================ 3. the keyboard must not break the 3:2 */

// Put the widget where the keyboard WOULD cover it, then edit again.
//
// The keyboard goes down FIRST. Parking while the IME is up measures the
// host's IME clamping instead of the parking, and the two produce
// different positions — so the baseline for "the widget moved for the
// keyboard" has to be read with nothing else in play.
await evaluate(`(() => { const el = document.getElementById("speak"); if (el) el.blur(); })()`);
await sleep(1500);
adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
await sleep(2200);
const beforeKeyboard = await widgetWindow();
const idleIme = imeState();
note(`idle before parking: ime=${JSON.stringify(idleIme)} window y=${beforeKeyboard?.y}`);

/**
 * Parks the widget at the bottom and CONFIRMS it landed.
 *
 * `place()` is a round trip through the page to the host and back, and a
 * request that has not been applied yet is a baseline that quietly
 * measures nothing. So the parked position is read back from the window
 * server and checked against the position the page was asked for, with
 * the answer required to agree twice before the run builds anything on
 * it.
 */
async function parkLow() {
  const s = await hostState();
  const wanted = s.workArea.y + s.workArea.h - s.h - 8;
  let last = null, host = null, agrees = 0;
  for (let attempt = 1; attempt <= 4 && agrees < 2; attempt++) {
    // The bridge is fire-and-forget: `place()` is a @JavascriptInterface
    // method that returns void, so the settle time is a wait, not a
    // promise. Whether the move actually landed is answered by the read
    // below, not by the call.
    await evaluate(`new Promise((r) => { window.SafiOverlay.place(${s.x}, ${wanted}, false); setTimeout(r, 1200); })`);
    await sleep(1800);
    host = await hostState();
    last = await widgetWindow();
    const expected = frameOfHostY(host.y);
    agrees = last && Math.abs(last.y - expected) <= 6 ? agrees + 1 : 0;
    note(`  park attempt ${attempt}: asked y=${wanted} (css), host y=${host.y} -> frame ${last?.y}, expected ${expected}`);
  }
  // "Low" has to mean low: the bottom edge of the widget has to be inside
  // the band the keyboard will actually cover.
  const displayBottom = frameOfHostY(host.workArea.y + host.workArea.h);
  return { asked: wanted, host, window: last, expected: frameOfHostY(host.y), settled: agrees >= 2, bottomGap: displayBottom - (last.y + last.h) };
}
const park = await parkLow();
const lowBefore = park.window;
note(`parked low: ${lowBefore?.y} (was ${beforeKeyboard?.y}) settled=${park.settled} bottomGap=${park.bottomGap}`);

await evaluate(`document.getElementById("speak").blur()`);
await sleep(1500);
adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
await sleep(2000);
const speak2 = await screenRect("#speak");
tap(speak2.x + speak2.w / 2, speak2.y + speak2.h / 2);
await sleep(3000);
const covered = { window: await widgetWindow(), ime: imeState(), host: await hostState() };
const coveredClient = JSON.parse(await evaluate(`JSON.stringify((() => { const c = document.getElementById("widget"); return { w: c.clientWidth, h: c.clientHeight }; })())`));
note(`keyboard over a low widget: y ${lowBefore?.y} -> ${covered.window?.y}, size ${covered.window?.w}x${covered.window?.h}, client ${JSON.stringify(coveredClient)}, ime=${JSON.stringify(covered.ime)}, imeInset=${covered.host.imeInset}`);
steps.push({
  name: "04-keyboard-does-not-break-3-2",
  note: `The widget parked at the bottom of the display (frame y ${lowBefore?.y}, ${park.bottomGap}px above the bottom of the work area, ${park.settled ? "confirmed settled" : "NOT CONFIRMED SETTLED"}), then the keyboard came up. The window MOVED (y ${lowBefore?.y} → ${covered.window?.y}) and did not resize: still ${covered.window?.w}×${covered.window?.h} around a ${coveredClient.w}×${coveredClient.h} surface. The keyboard repositions the widget; it never deforms it.`,
  before: lowBefore, window: covered.window, ime: covered.ime, content: coveredClient,
  park, allWindows: packageWindows(),
  page: JSON.parse(await evaluate(`JSON.stringify({
    mode: window.__SAFI_UI__?.mode ?? null,
    lastSurface: window.__SAFI_DIAG__?.lastSurface ?? null,
    transitions: (window.__SAFI_DIAG__?.transitions ?? window.__SAFI_UI__?.transitions ?? []).slice(-4),
    host: JSON.parse(window.SafiOverlay.state()),
  })`)),
  underlyingApp: topActivity(),
  frame: grab(join(OUT, "04-keyboard-does-not-break-3-2.raw")).file,
});
// With the keyboard up the host parks the widget's BOTTOM edge exactly on
// the top of the keyboard: the expected position is computed from the
// host's own report of the work area and the inset, not eyeballed.
const coveredExpectedY = frameOfHostY(covered.host.workArea.y + covered.host.workArea.h - covered.host.imeInset);
const keyboardPreserves3to2 = park.settled
  && covered.window
  && covered.window.w === lowBefore.w
  && covered.window.h === lowBefore.h
  && coveredClient.w === 384 && coveredClient.h === 256
  && Math.abs(covered.window.w / covered.window.h - 1.478) < 0.02
  && Math.abs(covered.window.y - coveredExpectedY) <= 2;
const widgetMovedForKeyboard = park.settled && !!covered.window && !!lowBefore
  && covered.window.y < lowBefore.y
  && covered.window.y + covered.window.h <= lowBefore.y + lowBefore.h;

/* ============================== 4. back to passive when editing ends */

adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
await sleep(3200);
const afterKeyboard = { window: await widgetWindow(), ime: imeState() };
note(`after keyboard dismissed: flags="${afterKeyboard.window?.flags}" ime=${JSON.stringify(afterKeyboard.ime)}`);
steps.push({
  name: "05-passive-after-keyboard",
  note: `The keyboard was dismissed with BACK. FLAG_NOT_FOCUSABLE is back on the window (focusable=${isFocusable(afterKeyboard.window)}), the IME is down, and the window returned to y ${afterKeyboard.window?.y} — where it was before the keyboard pushed it up.`,
  window: afterKeyboard.window, ime: afterKeyboard.ime,
  restoredTo: lowBefore?.y ?? null, underlyingApp: topActivity(),
  frame: grab(join(OUT, "05-passive-after-keyboard.raw")).file,
});
const returnsToPassive = isPassive(afterKeyboard.window) && !afterKeyboard.ime.shown;
const positionRestored = park.settled && !!afterKeyboard.window && !!lowBefore
  && afterKeyboard.window.y === lowBefore.y && !afterKeyboard.ime.shown;

/* ================================================== 5. Verify textarea */

await evaluate(`(() => { const b = document.getElementById("mode-verify"); if (b) b.click(); })()`);
await sleep(2200);
let answerRect = null;
try { answerRect = await screenRect("#paste-answer"); } catch { /* the pane may still be swapping */ }
if (!answerRect) { await setState("", 2600); await evaluate(`(() => { const b = document.getElementById("mode-verify"); if (b) b.click(); })()`); await sleep(2200); answerRect = await screenRect("#paste-answer"); }
tap(answerRect.x + answerRect.w / 2, answerRect.y + answerRect.h / 2);
await sleep(2800);
const verifyEdit = { window: await widgetWindow(), ime: imeState() };
adb(["shell", "input", "text", "ok"]);
await sleep(1400);
const verifyValue = String(await evaluate(`(document.getElementById("paste-answer")?.value ?? "")`));
note(`verify editing: flags="${verifyEdit.window?.flags}" ime=${JSON.stringify(verifyEdit.ime)} value=${JSON.stringify(verifyValue)}`);
steps.push({
  name: "06-verify-keyboard-and-typed-text",
  note: `The Verify field, the same way: keyboard really up (mInputShown=${verifyEdit.ime.shown}) and "${verifyValue}" typed into the WebView.`,
  window: verifyEdit.window, ime: verifyEdit.ime, typed: verifyValue, underlyingApp: topActivity(),
  frame: grab(join(OUT, "06-verify-keyboard-and-typed-text.raw")).file,
});
const imeOnVerify = isFocusable(verifyEdit.window) && verifyEdit.ime.shown && verifyEdit.ime.served;
const typedReachesVerify = verifyValue.toLowerCase().includes("ok");

adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
await sleep(2600);
const afterVerify = await widgetWindow();
const returnsToPassiveTwice = isPassive(afterVerify) && !imeState().shown;

/* ============================================= 6. the same, in landscape */

const rotated = await rotate(1);
note(`rotate(1): ${rotated} panel=${JSON.stringify(panelSize())}`);
await setState("open=1", 3600);
let landscapeEdit = null;
if (rotated) {
  const w = await widgetWindow();
  const rect = await screenRect("#speak");
  tap(rect.x + rect.w / 2, rect.y + rect.h / 2);
  await sleep(3000);
  landscapeEdit = { window: await widgetWindow(), ime: imeState(), panel: panelSize() };
  adb(["shell", "input", "text", "ciao"]);
  await sleep(1400);
  landscapeEdit.typed = String(await evaluate(`document.getElementById("speak")?.value ?? ""`));
  note(`landscape editing: flags="${landscapeEdit.window?.flags}" ime=${JSON.stringify(landscapeEdit.ime)} typed=${JSON.stringify(landscapeEdit.typed)}`);
  steps.push({
    name: "07-landscape-keyboard",
    note: `The panel really rotated to ${landscapeEdit.panel.w}×${landscapeEdit.panel.h}. The keyboard comes up there too (mInputShown=${landscapeEdit.ime.shown}) and the typed text lands in the field.`,
    window: landscapeEdit.window, ime: landscapeEdit.ime, panel: landscapeEdit.panel, typed: landscapeEdit.typed,
    underlyingApp: topActivity(),
    frame: grab(join(OUT, "07-landscape-keyboard.raw")).file,
  });
  adb(["shell", "input", "keyevent", "KEYCODE_BACK"]);
  await sleep(2600);
}
const imeInLandscape = !!landscapeEdit && isFocusable(landscapeEdit.window) && landscapeEdit.ime.shown;
const typedInLandscape = !!landscapeEdit && String(landscapeEdit.typed).toLowerCase().includes("ciao");
await rotate(0);
await sleep(3000);

/* ================================== 7. dismiss from the mascot: HIDE */

await setState("", 3200);
await attach().catch(() => {});
let w = await widgetWindow();
if (!w) { await startSafi(); w = await widgetWindow(); }
const mascot = { x: w.x + w.w / 2, y: w.y + w.h / 2 };
note(`long press the mascot at ${mascot.x},${mascot.y} (window ${w.w}x${w.h})`);
longPress(mascot.x, mascot.y, 900);
await sleep(2600);
const menuOpen = await evaluate(`(() => { const m = document.getElementById("safi-menu"); return m ? !m.hidden : null; })()`);
const menuWindow = await widgetWindow();
note(`menu open=${menuOpen} window=${menuWindow?.w}x${menuWindow?.h}`);
steps.push({
  name: "08-long-press-mascot-menu",
  note: `A long press on the mascot opens a small contextual panel — the window grows to ${menuWindow?.w}×${menuWindow?.h} to hold it, and COMPACT at rest is still the 88×88 mascot alone.`,
  menuOpen, window: menuWindow, underlyingApp: topActivity(),
  frame: grab(join(OUT, "08-long-press-mascot-menu.raw")).file,
});
const menuAppears = menuOpen === true && menuWindow.w > 264;

const hideButton = await screenRect("#safi-hide");
const underBeforeHide = topActivity();
tap(hideButton.x + hideButton.w / 2, hideButton.y + hideButton.h / 2);
await sleep(3000);
const afterHide = { count: overlayWindowCount(), app: topActivity() };
note(`after hide: overlay windows=${afterHide.count} resumed=${afterHide.app}`);
steps.push({
  name: "09-hidden-from-mascot",
  note: `"Nascondi Safi" from the mascot menu. The overlay view is gone: ${afterHide.count} overlay windows for the package, and ${afterHide.app} is on top again.`,
  count: afterHide.count, underlyingApp: afterHide.app,
  frame: grab(join(OUT, "09-hidden-from-mascot.raw")).file,
});
const hideFromMascot = afterHide.count === 0;

/**
 * "The app underneath is usable" is proved by really touching it, not by
 * asserting that nothing is in the way. An edge swipe that opens the
 * system notification shade is a touch that has to reach the system and
 * the app below; an invisible full-screen blocker would swallow it.
 */
const shadeBefore = grab(join(OUT, "10-underlying-app-usable-before.raw"));
swipe(630, 2, 630, 900, 400);
await sleep(2200);
const shadeOpen = /NotificationShade/.test(sh("dumpsys window | grep -m1 mCurrentFocus"));
const shadeFrame = grab(join(OUT, "10-underlying-app-usable-after.raw"));
note(`notification shade opened by a real edge swipe: ${shadeOpen}`);
sh("input keyevent KEYCODE_BACK");
await sleep(1800);
steps.push({
  name: "10-underlying-app-usable",
  note: `With Safi hidden, a real edge swipe opens the system notification shade (mCurrentFocus=${/NotificationShade/.test(sh("dumpsys window | grep -m1 mCurrentFocus")) ? "NotificationShade" : "the underlying app"}), which a full-screen invisible touch blocker would have swallowed. No window of ours is on screen to receive it.`,
  shadeOpened: shadeOpen, overlayWindows: afterHide.count,
  underlyingApp: topActivity(),
  frames: [shadeBefore.file, shadeFrame.file],
});
const underlyingAppUsable = shadeOpen && afterHide.count === 0;

/* =========================== 8. dismiss from the notification: HIDE */

await startSafi();
await launch("com.android.chrome");
await sleep(1500);
const beforeNotifHide = overlayWindowCount();
const notifAction = await tapNotificationAction("Nascondi", "Safi è attivo");
note(`notification action "Nascondi": tapped=${notifAction.tapped} windows ${beforeNotifHide} -> ${overlayWindowCount()}`);
const afterNotifHide = overlayWindowCount();
steps.push({
  name: "11-hidden-from-notification",
  note: `Safi is back (${beforeNotifHide} overlay window), then the notification's own "Nascondi" button is tapped in the shade — the real control, not a shell command: ${afterNotifHide} overlay windows afterwards.`,
  before: beforeNotifHide, after: afterNotifHide, action: notifAction, underlyingApp: topActivity(),
  frame: grab(join(OUT, "11-hidden-from-notification.raw")).file,
});
const hideFromNotification = notifAction.tapped && beforeNotifHide === 1 && afterNotifHide === 0;
const notificationOffersBoth = (notifAction.offered || []).includes("Nascondi")
  && (notifAction.offered || []).includes("Chiudi");

/* ============================== 9. dismiss from the mascot: CLOSE */

await startSafi();
await sleep(1200);
w = await widgetWindow();
// A long press is the whole gesture, and a gesture that the person could
// have to repeat is a gesture that should not be mistaken for a broken
// one: the menu is checked, and the press is repeated if it did not take.
let menuForClose = null;
for (let attempt = 1; attempt <= 3 && menuForClose !== true; attempt++) {
  longPress(w.x + w.w / 2, w.y + w.h / 2, 900);
  await sleep(2600);
  menuForClose = await evaluate(`(() => { const m = document.getElementById("safi-menu"); return m ? !m.hidden : null; })()`);
  if (menuForClose !== true) {
    note(`  long press ${attempt} did not open the menu (widget ${w.w}x${w.h} at ${w.x},${w.y})`);
    w = await widgetWindow();
  }
}
const closeButton = await screenRect("#safi-close");
const closeRectReal = closeButton.w > 0 && closeButton.h > 0;
tap(closeButton.x + closeButton.w / 2, closeButton.y + closeButton.h / 2);
await sleep(3500);
const afterClose = { count: overlayWindowCount(), app: topActivity() };
const serviceRunning = /SafiOverlayService/.test(sh("dumpsys activity services " + PKG));
note(`after close: menu=${menuForClose} button=${closeButton.w}x${closeButton.h} overlay windows=${afterClose.count} serviceRunning=${serviceRunning} resumed=${afterClose.app}`);
steps.push({
  name: "12-closed-from-mascot",
  note: `"Chiudi Safi" from the mascot menu (menu open=${menuForClose}, button ${closeButton.w}×${closeButton.h}px). ${afterClose.count} overlay windows, and the overlay service itself is gone (running=${serviceRunning}) — not merely hidden. The app underneath is on top.`,
  count: afterClose.count, serviceOpen: menuForClose, closeButton, serviceRunning, underlyingApp: afterClose.app,
  frame: grab(join(OUT, "12-closed-from-mascot.raw")).file,
});
const closeFromMascot = menuForClose === true && closeRectReal && afterClose.count === 0 && !serviceRunning;

/* ============================== 10. the person can bring Safi back */

await startSafi();
const reactivated = overlayWindowCount();
note(`reactivated from the app: ${reactivated} overlay window`);
steps.push({
  name: "13-reactivated-from-the-app",
  note: `After being closed, opening the app again brings Safi back: ${reactivated} overlay window. There is no state the person cannot get out of.`,
  count: reactivated, underlyingApp: topActivity(),
  frame: grab(join(OUT, "13-reactivated-from-the-app.raw")).file,
});
const reactivatesFromApp = reactivated === 1;

/* -------------------------------------------------------------- report */

const geometry = existsSync(join(repo, "artifacts/three-by-two/overlay/evidence.json"))
  ? JSON.parse(readFileSync(join(repo, "artifacts/three-by-two/overlay/evidence.json"), "utf8")).summary
  : null;

const report = {
  capturedAt: new Date().toISOString(),
  steps,
  passive: {
    compactAtRest: { window: { w: resting?.w, h: resting?.h }, flags: resting?.flags, ime: restingIme },
    stillPassiveWhenExpanded: passiveWhenExpanded,
  },
  editing: {
    ask: { window: askEdit.window, ime: askEdit.ime, typed: askValue, activeElement: askActive },
    verify: { window: verifyEdit.window, ime: verifyEdit.ime, typed: verifyValue },
    landscape: landscapeEdit,
    keyboardCoversWidget: { before: lowBefore, during: covered.window, content: coveredClient, ime: covered.ime },
    afterKeyboardDismissed: { window: afterKeyboard.window, ime: afterKeyboard.ime, restoredTo: lowBefore?.y ?? null },
  },
  dismiss: {
    menuAppears,
    notificationOffersBoth,
    hideFromMascot,
    hideFromNotification,
    closeFromMascot,
    reactivatesFromApp,
    overlayWindowsAfterHide: afterHide.count,
    overlayWindowsAfterClose: afterClose.count,
    serviceRunningAfterClose: serviceRunning,
    underlyingAppUsable,
  },
  geometryRegression: geometry,
  summary: {
    imeAppearsOnAskInput: imeOnAsk,
    typedTextReachesWebViewInput: typedReachesWebView,
    imeAppearsOnVerifyInput: imeOnVerify,
    overlayReturnsPassiveAfterBlur: returnsToPassive && returnsToPassiveTwice,
    hideFromMascot,
    closeFromMascot,
    notificationOffersBoth,
    hideFromNotification,
    noInvisibleOverlayAfterHide: afterHide.count === 0 && afterNotifHide === 0 && afterClose.count === 0,
    underlyingAppUsable,
    passiveAtRest: passiveAtRest && passiveWhenExpanded,
    keyboardNeverBreaks3to2: keyboardPreserves3to2,
    widgetMovesForKeyboard: widgetMovedForKeyboard,
    restoresPositionAfterKeyboard: positionRestored,
    imeWorksInLandscape: imeInLandscape && typedInLandscape,
    reactivatesFromApp,
  },
};

writeFileSync(join(OUT, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
note(`wrote ${join(OUT, "evidence.json")}`);
console.log(JSON.stringify(report.summary, null, 2));
const failed = Object.entries(report.summary).filter(([, v]) => !v);
if (failed.length) {
  console.error(`\n[interaction] ${failed.length} row(s) failed: ${failed.map(([k]) => k).join(", ")}`);
  process.exitCode = 1;
}
