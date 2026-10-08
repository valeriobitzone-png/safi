#!/usr/bin/env node
/**
 * SAFI ANDROID — TRUE SYSTEM OVERLAY ACCEPTANCE.
 *
 * Everything here happens on a real `TYPE_APPLICATION_OVERLAY` window on
 * a physical device, floating over REAL apps. There is no Activity host,
 * no page background and no crop: every frame is a FULL-SCREEN capture of
 * the phone, wide enough that the underlying app is unmistakable.
 *
 * The overlay window is read the way the platform sees it, from
 * `dumpsys window windows` — the WindowManager token type is how we prove
 * it is a real overlay (2038) and not an Activity window.
 *
 * Touch is `adb shell input swipe`: a real system-level gesture on the
 * real overlay window, never a synthesised DOM event.
 *
 *   node tools/overlay-acceptance.mjs [outDir]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(process.argv[2] ?? join(repo, "artifacts/three-by-two/overlay"));
const PKG = "dev.safi.app";
const PORT = 9422;
const WIDGET_URL = "https://appassets.androidplatform.net/apps/desktop/widget.html";

mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ adb */

function adb(args) {
  const r = spawnSync("adb", args, { encoding: "utf8", timeout: 120000 });
  if (r.status !== 0) throw new Error(`adb ${args.join(" ")}: ${((r.stdout || "") + (r.stderr || "")).trim()}`);
  return (r.stdout || "") + (r.stderr || "");
}
const sh = (cmd) => spawnSync("adb", ["shell", cmd], { encoding: "utf8", timeout: 60000 }).stdout || "";

/* -------------------------------------------------------------- window */

/** The overlay window exactly as the platform reports it. */
function overlayWindow() {
  const dump = sh("dumpsys window windows");
  // The line reads `Window{<id> u0 dev.safi.app}:` — a `}` sits between the
  // package and the colon, so match on the package alone.
  const at = dump.indexOf(`u0 ${PKG}`);
  if (at < 0) return null;
  const block = dump.slice(at, at + 3000);
  const type = Number(/mToken=WindowToken\{[^}]*type=(\d+)/.exec(block)?.[1] ?? NaN);
  const frames = /Frames:.*?frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(block);
  if (!frames) return null;
  const x = Number(frames[1]), y = Number(frames[2]), r = Number(frames[3]), b = Number(frames[4]);
  return {
    tokenType: type,
    isApplicationOverlay: type === 2038,
    appop: /appop=(\w+)/.exec(block)?.[1] ?? null,
    flags: /^\s*fl=(.*)$/m.exec(block)?.[1]?.trim() ?? null,
    requested: (() => { const m = /Requested w=(\d+) h=(\d+)/.exec(block); return m ? { w: +m[1], h: +m[2] } : null; })(),
    x, y, w: r - x, h: b - y,
  };
}
const topActivity = () => {
  const dump = sh("dumpsys activity activities");
  return /ResumedActivity: ActivityRecord\{[^}]* u0 (\S+?)[/ ]/.exec(dump)?.[1]
    ?? /topResumedActivity=ActivityRecord\{[^}]* u0 (\S+?)[/ ]/.exec(dump)?.[1]
    ?? null;
};

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

async function connect() {
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

/* ------------------------------------------------------------- capture */

function screencap(file) {
  const r = spawnSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 96 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout?.length) throw new Error("screencap failed");
  writeFileSync(file, r.stdout);
  return file;
}

/** Minimal PNG reader — enough to compare pixels, nothing more. */
function decodePng(path) {
  const buf = readFileSync(path);
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const row = raw.subarray(rp, rp + stride); rp += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= ch ? prev[x - ch] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, data: out };
}
const rgb = (img, x, y) => {
  const i = y * img.w * img.ch + x * img.ch;
  return [img.data[i], img.data[i + 1] ?? img.data[i], img.data[i + 2] ?? img.data[i]];
};

/* ------------------------------------------------------ liveness guard */

/**
 * A frame of a real app is never flat. These are the LOWEST bounds a live
 * full-screen capture of a real app on this device could take — the
 * darkest app measured here still sits near mean 60 / sd 56, and a locked
 * or dozing display measures mean 0.1 / sd 5. The bar is deliberately far
 * below the real thing: its only job is to tell "a screen with an app on
 * it" apart from "a black rectangle".
 */
const FRAME_MIN_MEAN = 6;
const FRAME_MIN_SD = 10;

/** Mean luma and standard deviation of a capture, sampled coarsely. */
function lumaStats(file) {
  const img = decodePng(file);
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 0; y < img.h; y += 3) {
    for (let x = 0; x < img.w; x += 3) {
      const p = rgb(img, x, y);
      const l = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
      sum += l; sum2 += l * l; n++;
    }
  }
  const mean = sum / n;
  return { mean, sd: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), w: img.w, h: img.h };
}
const frameIsLive = (s) => s.mean >= FRAME_MIN_MEAN && s.sd >= FRAME_MIN_SD;

/**
 * A capture that is refused as evidence when the display is not showing
 * anything.
 *
 * This is not paranoia: a previous run recorded mean 0.11 for both halves
 * of the transparency proof — the display had gone to sleep at the `wm
 * size` reconfiguration and never woke — and "0 differing pixels" between
 * two black rectangles looked exactly like a pass. Every frame now has to
 * prove it contains an app.
 */
async function liveCap(file, tries = 4) {
  let stats = null, why = "blank";
  for (let i = 0; i < tries; i++) {
    screencap(file);
    stats = lumaStats(file);
    const locked = await keyguardShowing();
    if (frameIsLive(stats) && !locked) return { file, ...stats, retried: i };
    why = locked ? "the lock screen is showing" : "the display shows nothing";
    process.stderr.write(`[overlay] ${file.split("/").pop()} is not usable — ${why} (mean=${stats.mean.toFixed(2)} sd=${stats.sd.toFixed(2)}), waking and recapturing (${i + 1}/${tries})\n`);
    // A dozing or locked display is woken the way a person would: tap,
    // then let the window manager take the keyguard down.
    adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
    await sleep(900);
    adb(["shell", "wm", "dismiss-keyguard"]);
    await sleep(1400);
    if (await keyguardShowing()) { adb(["shell", "input", "keyevent", "KEYCODE_MENU"]); await sleep(900); }
  }
  throw new Error(
    `refusing to record ${file}: ${why} (mean=${stats.mean.toFixed(2)} sd=${stats.sd.toFixed(2)}). ` +
    "A black or locked frame is not evidence — unlock the phone and re-run.",
  );
}
const keyguardShowing = () => Promise.resolve(/isKeyguardShowing=true/.test(sh("dumpsys window | grep -m1 isKeyguardShowing")));

/**
 * The decisive transparency proof.
 *
 * Capture the same underlying app twice — once with Safi on screen, once
 * with Safi stopped — and compare EVERY pixel outside the widget rect the
 * platform reported. If the exterior is truly transparent there is no
 * page, no dim and no canvas behind it, so those pixels must be
 * byte-identical. Any difference means something of Safi's is showing.
 */
function exteriorTransparent(withSafi, withoutSafi, rect) {
  const la = lumaStats(withSafi), lb = lumaStats(withoutSafi);
  // Two black rectangles are trivially identical. A blank frame on EITHER
  // side would turn this proof into a tautology, so it is refused outright
  // rather than reported as a pass.
  if (!frameIsLive(la) || !frameIsLive(lb)) {
    return {
      identical: false,
      reason: "blank frame — the comparison would be vacuous",
      luma: { withSafi: la, safiStopped: lb },
    };
  }
  const a = decodePng(withSafi), b = decodePng(withoutSafi);
  if (a.w !== b.w || a.h !== b.h) return { identical: false, reason: "size mismatch" };
  const pad = 10;
  const x0 = Math.max(0, rect.x - pad), y0 = Math.max(0, rect.y - pad);
  const x1 = Math.min(a.w, rect.x + rect.w + pad), y1 = Math.min(a.h, rect.y + rect.h + pad);
  /* The system bars are NOT part of the claim: the clock ticks and a
     status icon can appear between two captures, and that is the OS, not
     Safi. They are excluded so the comparison measures what it is meant
     to measure — the app underneath, everywhere outside the widget. */
  const statusH = 162, navH = 72;
  let compared = 0, differing = 0, maxDelta = 0, firstDiff = null, barsSkipped = 0;
  for (let y = 0; y < a.h; y++) {
    const inBand = y >= y0 && y < y1;
    const inSystemBar = y < statusH || y >= a.h - navH;
    for (let x = 0; x < a.w; x++) {
      if (inBand && x >= x0 && x < x1) continue;
      if (inSystemBar) { barsSkipped++; continue; }
      const p = rgb(a, x, y), q = rgb(b, x, y);
      const d = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
      compared++;
      if (d > 0) {
        differing++; maxDelta = Math.max(maxDelta, d);
        if (!firstDiff) firstDiff = { x, y, withSafi: p, withoutSafi: q };
      }
    }
  }
  return {
    identical: differing === 0,
    compared, differing, differingPct: +((differing / Math.max(1, compared)) * 100).toFixed(4),
    systemBarPixelsSkipped: barsSkipped,
    maxDelta, firstDiff,
    // Recorded so the report can show the frames were REAL: both sides
    // carry a real app, so "identical" is a fact about transparency rather
    // than an artefact of two black rectangles.
    luma: {
      withSafi: { mean: +la.mean.toFixed(2), sd: +la.sd.toFixed(2) },
      safiStopped: { mean: +lb.mean.toFixed(2), sd: +lb.sd.toFixed(2) },
    },
  };
}

/** (Re)attach to the overlay's WebView: the pid changes on every restart. */
async function attach() {
  const pid = sh(`pidof ${PKG}`).trim().split(/\s+/)[0];
  if (!pid) throw new Error("app not running");
  spawnSync("adb", ["forward", "--remove-all"], { encoding: "utf8" });
  adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
  await sleep(1000);
  return connect();
}

async function restartOverlay() {
  adb(["shell", "am", "force-stop", PKG]);
  await sleep(1500);
  adb(["shell", "am", "start", "-n", `${PKG}/.BubbleActivity`]);
  await sleep(4500);
  return attach();
}

/* ----------------------------------------------------------------- main */

const steps = [];
let navSeq = 0;

async function setState(hash, settle = 3000) {
  await send("Page.navigate", { url: `${WIDGET_URL}?o=${++navSeq}#${hash}` });
  await sleep(settle);
  return evaluate(`(() => {
    const w = document.getElementById("widget");
    const su = w && !w.hidden ? w : null;
    const broken = [...document.querySelectorAll("img[data-mascot]")].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.id);
    return {
      mode: window.__SAFI_UI__?.mode ?? null,
      client: su ? { w: su.clientWidth, h: su.clientHeight } : null,
      scroll: su ? { w: su.scrollWidth, h: su.scrollHeight } : null,
      scrollTop: su ? su.scrollTop : 0,
      dpr: devicePixelRatio,
      brokenMascots: broken,
    };
  })()`);
}

async function shot(name, note, extra = {}) {
  const file = join(OUT, `${name}.png`);
  const cap = await liveCap(file);
  const win = overlayWindow();
  const panel = panelSize();
  const entry = {
    name, note, frame: file,
    luma: { mean: +cap.mean.toFixed(2), sd: +cap.sd.toFixed(2) },
    // The panel's own size, so every frame states the orientation it was
    // taken in rather than leaving it to be inferred.
    panel,
    underlyingApp: topActivity(), window: win, ...extra,
  };
  steps.push(entry);
  process.stderr.write(`[overlay] ${name.padEnd(26)} app=${String(entry.underlyingApp).padEnd(34)} panel=${panel.w}x${panel.h} window=${win ? `${win.w}x${win.h}@${win.x},${win.y} token=${win.tokenType}` : "ABSENT"}\n`);
  return entry;
}

async function launchUnder(pkg) {
  if (pkg === "home") {
    sh("input keyevent KEYCODE_HOME");
  } else {
    // `monkey` is NOT used to launch: it injects a rotation event of its
    // own (visible in `dumpsys window displays` as
    // `caller=MonkeyRotationEven#injectEvent`) which silently turned the
    // display landscape before every Chrome and Maps launch. The widget
    // then scaled itself to a 186dp-tall work area and rendered CROPPED,
    // while the ratio-only assertion still called it a pass. The launcher
    // activity is resolved directly instead.
    const resolved = sh(`cmd package resolve-activity --brief -c android.intent.category.LAUNCHER ${pkg}`)
      .trim().split(/\r?\n/).map((l) => l.trim()).filter((l) => l.includes("/")).pop();
    if (!resolved) throw new Error(`no LAUNCHER activity for ${pkg}`);
    sh(`am start -n ${resolved}`);
  }
  await sleep(3200);
  await ensurePortrait();
}

/**
 * Portrait is the baseline for every row in this run.
 *
 * Anything that quietly turns the display sideways — a launcher that
 * injects a rotation event, a sensor-driven auto-rotate — changes what the
 * 3:2 shell has to fit into, and turns "384×256 in a 3:2 window" into
 * "384×256 cropped down to 239×162". The check is on the PANEL, read from
 * a capture, not on the page, which only repeats what WMS told it.
 */
async function ensurePortrait() {
  if (panelSize().w < panelSize().h) return true;
  adb(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
  adb(["shell", "settings", "put", "system", "user_rotation", "0"]);
  for (let i = 0; i < 12; i++) {
    await sleep(1000);
    const p = panelSize();
    if (p.w < p.h) {
      process.stderr.write(`[overlay] the display had gone landscape; forced back to portrait (${p.w}x${p.h})\n`);
      return true;
    }
  }
  throw new Error("the display would not return to portrait — every state would be captured against the wrong viewport");
}

const device = {
  model: sh("getprop ro.product.model").trim(),
  release: sh("getprop ro.build.version.release").trim(),
  sdk: sh("getprop ro.build.version.sdk").trim(),
  physicalSize: (/Physical size:\s*(\d+x\d+)/.exec(sh("wm size"))?.[1] ?? "?"),
  density: (/Physical density:\s*(\d+)/.exec(sh("wm density"))?.[1] ?? "?"),
};

process.stderr.write(`[overlay] device ${device.model} android ${device.release} (sdk ${device.sdk}) ${device.physicalSize}@${device.density}\n`);

/**
 * A locked device swallows every touch and refuses to rotate, so the whole
 * capture would silently produce frames of a keyguard. The screen is held
 * awake for the run and the keyguard is checked up front; if it cannot be
 * dismissed the run stops instead of writing misleading evidence.
 */
async function wake() {
  // The display idles within ~30s on this device even while charging, and
  // an idle display takes no focus and refuses to rotate. Both are pinned
  // for the length of the capture.
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
    adb(["shell", "input", "swipe", "630", "2300", "630", "300", "200"]);
    await sleep(1500);
    locked = /isKeyguardShowing=true/.test(sh("dumpsys window | grep -m1 isKeyguardShowing"));
  }
  return { keyguard: locked ? "showing" : "dismissed" };
}
const AWAKE = await wake();
process.stderr.write(`[overlay] wake before capture: keyguard=${AWAKE.keyguard}\n`);
if (AWAKE.keyguard === "showing") {
  console.error("[overlay] the device keyguard will not dismiss; touches would be swallowed by the lock screen. Unlock the phone and re-run.");
  process.exit(2);
}
// A run must not inherit a rotation state left behind by an earlier one.
// A failed rotation leaves the window server and the panel disagreeing
// about which way is up, and the page then lays out against a viewport it
// is never shown in — the difference between a 3:2 window showing its
// whole surface and a 3:2 window cropping most of it.
const resync = await resyncDisplay();
if (!resync.inSync) {
  console.error(`[overlay] the display and the window server disagree (wms ${resync.after.cfg.w}x${resync.after.cfg.h}, panel ${resync.after.panel.w}x${resync.after.panel.h}). Every measurement would be taken against the wrong viewport — reboot the phone and re-run.`);
  process.exit(2);
}
if (!(resync.after.panel.w < resync.after.panel.h)) {
  console.error(`[overlay] the run did not settle into portrait (panel ${resync.after.panel.w}x${resync.after.panel.h}). Portrait is the baseline for every row — re-run with the phone upright.`);
  process.exit(2);
}

/** The current display, in device px, for keeping gestures on screen. */
const SCREEN = {
  w: Number((/Physical size:\s*(\d+)x/.exec(sh("wm size"))?.[1]) ?? 1260),
  h: Number((/Physical size:\s*\d+x(\d+)/.exec(sh("wm size"))?.[1]) ?? 2800),
};

/**
 * The phone is a shared, physical device: whatever happens, this run hands
 * it back the way it found it — real display size, auto-rotation, normal
 * screen timeout. A crashed capture must never leave a 1260×2800 phone
 * pinned at 720×1280.
 */
const ORIGINAL_SIZE = (/Physical size:\s*(\d+x\d+)/.exec(sh("wm size"))?.[1] ?? null);
let deviceRestored = false;
function restoreDevice() {
  if (deviceRestored) return;
  deviceRestored = true;
  spawnSync("adb", ["shell", "wm", "size", "reset"], { encoding: "utf8", timeout: 30000 });
  spawnSync("adb", ["shell", "settings", "put", "system", "user_rotation", "0"], { encoding: "utf8", timeout: 30000 });
  spawnSync("adb", ["shell", "settings", "put", "system", "accelerometer_rotation", "1"], { encoding: "utf8", timeout: 30000 });
  spawnSync("adb", ["shell", "settings", "put", "system", "screen_off_timeout", "30000"], { encoding: "utf8", timeout: 30000 });
}
process.on("exit", restoreDevice);
process.on("SIGINT", () => { restoreDevice(); process.exit(130); });

// Start clean: no Activity host, no leftover page.
adb(["shell", "am", "force-stop", PKG]);
await sleep(1200);
adb(["shell", "am", "start", "-n", `${PKG}/.BubbleActivity`]);
await sleep(4500);

const win0 = overlayWindow();
const noSafiActivity = !sh("dumpsys activity activities").includes(`${PKG}/.BubbleActivity`);
process.stderr.write(`[overlay] overlay window: ${JSON.stringify(win0)}\n`);
if (!win0) throw new Error("no overlay window — permission not granted, acceptance BLOCKED");

const pid = sh(`pidof ${PKG}`).trim().split(/\s+/)[0];
spawnSync("adb", ["forward", "--remove-all"], { encoding: "utf8" });
adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
await sleep(900);
await connect();
await setState("open=1", 2600);

/* 1) Chrome underneath, with a baseline capture with Safi stopped. */
await launchUnder("com.android.chrome");
const baselineChrome = (await liveCap(join(OUT, "00-baseline-chrome-safi-stopped.png"))).file;

/* 2) Every state, on the real overlay. */
const STATES = [
  { hash: "", name: "01-compact-over-chrome", note: "COMPACT 88×88 floating over Chrome" },
  { hash: "open=1", name: "02-expanded-over-chrome", note: "EXPANDED 384×256 floating over Chrome" },
  { hash: "demo=ask-prompt", name: "03-prompt-ready-over-chrome", note: "PROMPT_READY over Chrome" },
  { hash: "demo=verify-right", name: "04-verify-result-over-chrome", note: "VERIFY_RESULT over Chrome" },
];
const stateResults = [];
for (const s of STATES) {
  await ensurePortrait();
  const probe = await setState(s.hash, s.hash === "" ? 2600 : 3400);
  const e = await shot(s.name, s.note, { probe });
  stateResults.push({ state: s.name, probe, window: e.window });
}

/* 3) DETAILS: the result view scrolled to its end, still the same 3:2. */
await evaluate(`(() => { const su = document.getElementById("widget"); if (su) su.scrollTop = su.scrollHeight; })()`);
await sleep(1000);
const detailsProbe = await evaluate(`(() => { const su = document.getElementById("widget");
  return { client: { w: su.clientWidth, h: su.clientHeight }, scroll: { w: su.scrollWidth, h: su.scrollHeight },
           scrollTop: su.scrollTop, atEnd: su.scrollTop + su.clientHeight >= su.scrollHeight - 2 }; })()`);
const details = await shot("05-details-scrolled-over-chrome", "DETAILS: result view scrolled to its end, shell still 384×256", { probe: detailsProbe });

/* 4) Other real apps underneath. */
await launchUnder("com.google.android.apps.maps");
await setState("demo=ask-prompt", 3200);
await shot("06-prompt-ready-over-maps", "PROMPT_READY floating over Google Maps");

await launchUnder("home");
await setState("demo=verify-right", 3200);
const homeShot = await shot("07-verify-result-over-home", "VERIFY_RESULT floating over the home screen");
await setState("", 2600);
await shot("08-compact-over-home", "COMPACT floating over the home screen");

/* 5) REAL system touch drag of the overlay window, in three places. */
/**
 * A REAL system touch drag of the overlay window.
 *
 * The press must land on a drag REGION, so the start point is not guessed:
 * the page itself is asked which `[data-safi-drag]` region is exposed and
 * which point on it is not a control — the same rule the pointer
 * controller applies — and that CSS point is converted to screen pixels
 * through the window rect the platform reported.
 */
async function dragTo(name, note, targetX, targetY, { settle = 1300, expect = "target" } = {}) {
  const before = overlayWindow();
  const dpr = await evaluate("window.devicePixelRatio");
  const candidates = await evaluate(`(() => {
    const BLOCK = "[data-no-drag], #prompt-text, .prompt-actions, .stamp-row, .chip-row, .actions-row, .field, button, textarea, input, select, a, summary, details";
    const out = [];
    for (const m of document.querySelectorAll("[data-safi-drag]")) {
      const r = m.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      // Sample a grid rather than only the centre: the centre of the whole
      // glass panel is usually over a control, and taking the centre-only
      // answer leaves the header as the only option — a 30px-tall strip
      // from which an upward swipe can travel almost nowhere.
      for (let fy = 1; fy <= 7; fy++) {
        for (let fx = 1; fx <= 7; fx++) {
          const x = r.x + (r.width * fx) / 8;
          const y = r.y + (r.height * fy) / 8;
          const hit = document.elementFromPoint(x, y);
          if (!hit || hit.closest(BLOCK)) continue;
          if (!m.contains(hit) && !hit.contains(m)) continue;
          out.push({ x, y, region: m.dataset.safiDrag });
        }
      }
    }
    return out;
  })()`);
  if (!candidates?.length) throw new Error(`no safe drag point for ${name}`);

  /**
   * Where the finger has to start is not free.
   *
   * Two things limit it. `input swipe` is a SAMPLED injection that stops
   * delivering the tail of the path as soon as the finger walks out of the
   * widget's own rectangle, so a gesture can never ask for more travel
   * than the start point has room for. And not every `[data-safi-drag]`
   * surface actually drags: the glass panel is the scroll container, so a
   * touch there scrolls instead, and only the header takes the drag.
   *
   * Rather than hard-coding which is which, the candidates are ordered by
   * how much room they leave in the direction of travel and the loop
   * DISCOVERS the working one: a gesture that moves nothing moves on to
   * the next candidate.
   */
  const roomFor = (p, dx, dy) => Math.min(
    dx !== 0 ? (dx > 0 ? before.w - p.x * dpr - 6 : p.x * dpr - 6) : Infinity,
    dy !== 0 ? (dy > 0 ? before.h - p.y * dpr - 6 : p.y * dpr - 6) : Infinity,
  );
  const firstDx = targetX - before.x, firstDy = targetY - before.y;
  const ordered = candidates
    .slice()
    .sort((a, b) => roomFor(b, firstDx, firstDy) - roomFor(a, firstDx, firstDy));
  process.stderr.write(`[overlay] drag ${name}: ${ordered.length} candidate points, want ${targetX},${targetY} (from ${before.x},${before.y})\n`);

  /**
   * The gesture is driven in real steps and each step is read back from
   * the window server, exactly as a person would drag and correct.
   *
   * Every step below is still a genuine system-level touch on the real
   * overlay window; only the number of gestures changes.
   */
  const gestures = [];
  let cur = before;
  let stuck = 0;
  let candIdx = 0;
  let usedRegion = ordered[0].region;
  for (let attempt = 0; attempt < 20; attempt++) {
    const dx = targetX - cur.x;
    const dy = targetY - cur.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 24) break;
    const point = ordered[candIdx % ordered.length];
    const sx = cur.x + Math.round(point.x * dpr);
    const sy = cur.y + Math.round(point.y * dpr);
    // Never ask for more travel than the finger has room for inside the
    // widget: overshooting is what makes the injector abandon the path.
    const room = Math.max(24, roomFor(point, dx, dy));
    const scale = room < dist ? room / dist : 1;
    // Keep each step inside the screen so the injector never clamps it.
    const ex = Math.max(1, Math.min(SCREEN.w - 1, Math.round(sx + dx * scale)));
    const ey = Math.max(1, Math.min(SCREEN.h - 1, Math.round(sy + dy * scale)));
    // A short step needs a LONG gesture: the injector samples the path, so
    // a fast short swipe can deliver too few MOVEs to clear the 4px start
    // threshold at all. Repeating a stuck step slowly gets it moving.
    const slow = stuck > 0 ? 2.2 : 1;
    const duration = Math.min(2400, Math.max(stuck > 0 ? 1400 : 700, Math.round(Math.hypot(ex - sx, ey - sy) * slow * 1.6)));
    adb(["shell", "input", "swipe", String(sx), String(sy), String(ex), String(ey), String(duration)]);
    await sleep(settle);
    const next = overlayWindow();
    gestures.push({ from: { x: cur.x, y: cur.y }, to: next ? { x: next.x, y: next.y } : null, region: point.region, duration });
    if (!next) break;
    if (next.x === cur.x && next.y === cur.y) {
      stuck++;
      // This surface does not drag (it scrolls, or something is on top of
      // it). Try the next candidate rather than repeating forever.
      if (stuck >= 2) { candIdx++; stuck = 0; }
      continue;
    }
    stuck = 0;
    usedRegion = point.region;
    cur = next;
  }
  const after = overlayWindow();
  return {
    name, note, expect, wanted: { x: targetX, y: targetY }, before, after, startRegion: usedRegion,
    gestures,
    snapped: (await evaluate("String(window.SafiOverlay?.state?.() ?? '{}')")).includes('"snapped":true')
      || (await evaluate("window.__SAFI_DIAG__?.drag?.snapped === true")) === true,
    gesture: await evaluate("window.__SAFI_DIAG__?.gesture ?? null"),
  };
}
await setState("open=1", 3200);
const drags = [];
const screen = overlayWindow();
/**
 * The three target positions are computed from the band the host will
 * actually accept, not from raw screen arithmetic.
 *
 * A 396dp-wide 3:2 surface on a 420dp-wide phone leaves only a few dp of
 * horizontal freedom, so on THIS device the three positions are mostly
 * vertical. Asking for an unreachable point would only prove the clamp.
 */
const native = JSON.parse((await evaluate("String(window.SafiOverlay?.state?.() ?? '{}')")) || "{}");
const DPR = Number(await evaluate("devicePixelRatio")) || 3;
const waCss = native.workArea ?? { x: 0, y: 0, w: screen.w / DPR, h: screen.h / DPR };
const winCss = { w: native.w ?? Math.round(screen.w / DPR), h: native.h ?? Math.round(screen.h / DPR) };
const PAD = 8;
const band = {
  minX: Math.round(waCss.x + PAD), maxX: Math.round(waCss.x + waCss.w - winCss.w - PAD),
  minY: Math.round(waCss.y + PAD), maxY: Math.round(waCss.y + waCss.h - winCss.h - PAD),
};

/**
 * CSS px -> window-server px is NOT just a multiply by the density.
 *
 * The host works in the window manager's child space, which already
 * begins below the status bar, so the frame the window server reports is
 * offset by exactly the top inset — measured here, 162px on this phone.
 * Aiming a drag at `css * dpr` therefore aims 162px above where the window
 * can actually be, which is how "top-left" used to be unreachable. The
 * offset is CALIBRATED against the real window server rather than
 * assumed, so the targets are stated in the same coordinates every
 * assertion reads back.
 */
const calX = Math.max(0, band.minX), calY = Math.max(0, band.minY);
await evaluate(`window.SafiOverlay?.place?.(${calX}, ${calY}, false)`).catch(() => {});
await sleep(1400);
const calWin = overlayWindow();
const FRAME_ORIGIN = {
  x: calWin ? calWin.x - calX * DPR : 0,
  y: calWin ? calWin.y - calY * DPR : 0,
};
const at = (fx, fy) => ({
  x: Math.round(band.minX + (band.maxX - band.minX) * fx) * DPR + FRAME_ORIGIN.x,
  y: Math.round(band.minY + (band.maxY - band.minY) * fy) * DPR + FRAME_ORIGIN.y,
});
const TOP_LEFT = at(0, 0);
const CENTRE = at(0.5, 0.5);
const BOTTOM_RIGHT = at(1, 1);
process.stderr.write(`[overlay] reachable band (css): ${JSON.stringify(band)} window ${JSON.stringify(winCss)} frame-origin=${JSON.stringify(FRAME_ORIGIN)} (calibrated at ${calX},${calY} -> ${calWin?.x},${calWin?.y})\n`);

// The order matters: the widget is already near the middle when the
// sequence starts, so a "centre" drag run first would find the window
// already on its target and deliver NO touch at all — which is not a
// drag. The window is therefore walked to the far corner FIRST and every
// position after that is reached by a real gesture. `everyDragUsedRealTouch`
// below fails the run if any of them is a no-op.
drags.push(await dragTo("09-drag-bottom-right", "dragged to the bottom-right", BOTTOM_RIGHT.x, BOTTOM_RIGHT.y));
await shot("09-drag-bottom-right", "the real overlay window dragged to the bottom-right", { drag: drags.at(-1) });
drags.push(await dragTo("10-drag-centre", "dragged to the centre", CENTRE.x, CENTRE.y));
await shot("10-drag-centre", "the real overlay window dragged to the centre of the screen", { drag: drags.at(-1) });
drags.push(await dragTo("11-drag-top-left", "dragged to the top-left", TOP_LEFT.x, TOP_LEFT.y));
await shot("11-drag-top-left", "the real overlay window dragged to the top-left", { drag: drags.at(-1) });
// Released just inside the LEFT edge band: the window must NOT stay where
// it was released, it must ease the last of the distance out and stop.
drags.push(await dragTo("12-edge-snap", "released just inside the left edge band", (band.minX * DPR + FRAME_ORIGIN.x) + 40, CENTRE.y, { expect: "snapped" }));
const snapShot = await shot("12-edge-snap", "release-only edge snap: released 40px in, the window eases to the edge", { drag: drags.at(-1) });

/* 6) Landscape — rotated for REAL and verified before anything is shot. */
/**
 * What the window server currently believes the display is.
 *
 * `cur=` is the configuration WMS is handing to apps, which is NOT always
 * the panel: a failed rotation can leave the two desynchronised (the panel
 * photographed at 1260×2800 while WMS still reports 2800×1260), and the
 * page then lays out against a landscape viewport it is not being shown in.
 */
function displayConfig() {
  const cur = /cur=(\d+)x(\d+)/.exec(sh("dumpsys window displays")) ?? [];
  return { w: Number(cur[1] ?? 0), h: Number(cur[2] ?? 0) };
}

/** The panel's real pixel size, straight from a capture. */
function panelSize() {
  const buf = spawnSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 96 * 1024 * 1024, encoding: "buffer" }).stdout;
  const b = Buffer.from(buf);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/**
 * Force the window server and the panel back into agreement.
 *
 * Without this, a run inherits whatever rotation state the phone was left
 * in, and every measurement after that is taken against the wrong
 * viewport. Rotating away and back is the only thing that makes WMS
 * recompute `cur=`; a plain `user_rotation 0` does not, because WMS
 * already believes it is at ROTATION_0.
 */
async function resyncDisplay() {
  const before = { cfg: displayConfig(), panel: panelSize() };
  // Auto-rotate is locked OFF for the whole run and restored on exit.
  // This phone is physically lying on a desk, and with the sensor in
  // charge the display keeps snapping back to whatever way the handset is
  // tilted — which silently turns the portrait baseline into a landscape
  // one and makes the whole 3:2 shell render cropped.
  adb(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
  for (const r of [1, 0]) {
    adb(["shell", "settings", "put", "system", "user_rotation", String(r)]);
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const p = panelSize();
      const wantLandscape = r === 1;
      if (wantLandscape === (p.w > p.h)) break;
    }
  }
  await sleep(2000);
  const after = { cfg: displayConfig(), panel: panelSize() };
  process.stderr.write(`[overlay] display resync: wms ${before.cfg.w}x${before.cfg.h} panel ${before.panel.w}x${before.panel.h} -> wms ${after.cfg.w}x${after.cfg.h} panel ${after.panel.w}x${after.panel.h}\n`);
  return { before, after, inSync: after.cfg.w === after.panel.w && after.cfg.h === after.panel.h };
}

/**
 * Rotate for real and verify BOTH the window server and the panel.
 *
 * Verifying only the page is not enough: the page reads its metrics from
 * WMS, so a desynchronised display happily reports `landscape-primary`
 * while the photo is still portrait. The panel's own capture is the
 * independent witness.
 */
async function rotate(rotation) {
  const awake = await wake();
  process.stderr.write(`[overlay] wake: keyguard=${awake.keyguard}\n`);
  // A foreground activity that pins its orientation stops the DISPLAY
  // from rotating. This launcher does exactly that: with
  // SearchLauncher in front, `user_rotation 1` is accepted by settings
  // and then silently ignored by the window manager, which is what made
  // landscape look impossible. A normal rotatable app is parked in front
  // instead — the overlay floats over it, so the frame still shows a real
  // app underneath.
  await launchUnder("com.android.chrome");
  await sleep(2500);
  adb(["shell", "settings", "put", "system", "accelerometer_rotation", "0"]);
  await sleep(1200);
  adb(["shell", "settings", "put", "system", "user_rotation", String(rotation)]);
  const wantLandscape = rotation === 1;
  for (let i = 0; i < 24; i++) {
    await sleep(1000);
    const panel = panelSize(), cfg = displayConfig();
    if (wantLandscape === (panel.w > panel.h) && cfg.w === panel.w && cfg.h === panel.h) {
      const t = await evaluate("window.screen?.orientation?.type ?? ''");
      return { orientation: String(t), panel, cfg, synced: true };
    }
  }
  return {
    orientation: String(await evaluate("window.screen?.orientation?.type ?? ''")),
    panel: panelSize(), cfg: displayConfig(), synced: false,
  };
}
const rotated = await rotate(1);
process.stderr.write(`[overlay] orientation after rotate(1): ${JSON.stringify(rotated)}\n`);
await setState("open=1", 3600);
const landscape = await shot("13-landscape-expanded", "EXPANDED 3:2 floating over a real app in landscape, scaled to fit");
landscape.orientation = rotated.orientation;
landscape.panel = rotated.panel;
landscape.displayConfig = rotated.cfg;
landscape.probe = await evaluate(`(() => { const w = document.getElementById("widget");
  return { client: w ? { w: w.clientWidth, h: w.clientHeight } : null, inner: { w: innerWidth, h: innerHeight } }; })()`);
process.stderr.write(`[overlay] landscape: orientation=${landscape.orientation} panel=${JSON.stringify(landscape.panel)} inner=${JSON.stringify(landscape.probe.inner)}\n`);
const backToPortrait = await rotate(0);
process.stderr.write(`[overlay] back to portrait: ${JSON.stringify(backToPortrait)}\n`);
await sleep(2500);

const originalSize = (/Physical size:\s*(\d+x\d+)/.exec(sh("wm size"))?.[1] ?? null);
/**
 * The small display is 1008×2240, not 720×1280.
 *
 * 720×1280 is a drastic enough reconfiguration that this device powers its
 * panel off and never brings it back: the keyguard comes up, the frame is
 * black, and the phone needs a reboot to recover. 1008×2240 is proven to
 * survive the same change and the same reset, and it is the more honest
 * test anyway — at density 480 it is 336dp wide, so the 396dp 3:2 shell
 * genuinely does NOT fit and one scale factor has to be applied. The claim
 * under test is "384 CSS px do not always fit, scale while preserving
 * 3:2", not "survive the most violent resize this hardware can do".
 */
const SMALL = "1008x2240";

/* 7) Off-screen recovery.
 *
 * The window cannot be pushed off the display through the bridge — every
 * `place()` runs through the clamp, so asking for -2000,-2000 simply comes
 * back as the nearest reachable point. That makes "request something wild
 * and see it come back" prove nothing.
 *
 * The real off-screen case is a display that gets SMALLER under a saved
 * position: the widget is parked at the bottom-right of the full-size
 * display, the display is then genuinely shrunk, and that position no
 * longer fits. The clamp has to catch it, and a restart on the smaller
 * display has to leave the widget reachable. The position is read from the
 * window server before and after, so the recovery is observed rather than
 * assumed. */
await setState("open=1", 3200);
await evaluate(`window.SafiOverlay?.place?.(${Math.round(band.maxX)}, ${Math.round(band.maxY)}, false)`).catch(() => {});
await sleep(1500);
const beforeOff = overlayWindow();
process.stderr.write(`[overlay] off-screen: parked at ${beforeOff?.x},${beforeOff?.y} on a ${SCREEN.w}x${SCREEN.h} display\n`);

adb(["shell", "wm", "size", SMALL]);
await sleep(4000);
await setState("open=1", 3400);
const smallPanel = panelSize();
const drivenOffScreen = overlayWindow();
// Would the position it had on the big display have fitted on this one?
const wouldNotFit = !!beforeOff
  && (beforeOff.x + beforeOff.w > smallPanel.w || beforeOff.y + beforeOff.h > smallPanel.h);
const insideSmall = (w) => !!w && w.x >= 0 && w.y >= 0
  && w.x + w.w <= smallPanel.w && w.y + w.h <= smallPanel.h;
process.stderr.write(`[overlay] off-screen: display now ${smallPanel.w}x${smallPanel.h}; the old position would not fit=${wouldNotFit}; clamped to ${drivenOffScreen?.x},${drivenOffScreen?.y} inside=${insideSmall(drivenOffScreen)}\n`);

// A restart on the smaller display must still leave it reachable.
await restartOverlay();
await setState("open=1", 3200);
const afterOff = overlayWindow();
const onScreen = insideSmall(afterOff);
process.stderr.write(`[overlay] off-screen recovery after restart: ${afterOff?.x},${afterOff?.y} onScreen=${onScreen}\n`);
adb(["shell", "wm", "size", "reset"]);
await sleep(4000);
await setState("open=1", 3200);
const afterRestore = overlayWindow();
process.stderr.write(`[overlay] display restored: ${afterRestore?.x},${afterRestore?.y} ${afterRestore?.w}x${afterRestore?.h}\n`);

/* 8) The transparency proof: same app, Safi present vs stopped. */
await launchUnder("com.android.chrome");
await setState("open=1", 3400);
const withSafi = (await liveCap(join(OUT, "16-transparency-with-safi.png"))).file;
const winFinal = overlayWindow();
adb(["shell", "am", "force-stop", PKG]);
await sleep(2000);
const withoutSafi = (await liveCap(join(OUT, "17-transparency-safi-stopped.png"))).file;
const transparency = exteriorTransparent(withSafi, withoutSafi, winFinal);

// Bring the companion back for the record.
adb(["shell", "am", "start", "-n", `${PKG}/.BubbleActivity`]);
await sleep(3000);
await attach();

/* 9) A smaller display: 3:2 must hold, scaled, with no host page.
 *
 * This runs LAST, deliberately. Changing the display size re-configures
 * the display, and on this device that leaves it OFF with the keyguard up
 * — which is why an earlier run recorded four consecutive black frames
 * from this point on, and why one of them nearly passed a transparency
 * proof by comparing black to black. Nothing that has to be seen can come
 * after it, and the real display size is restored in a `finally` so a
 * failure here can never leave the phone at 720×1280. */
let small = null, restored = null, smallDisplayError = null;
try {
  adb(["shell", "wm", "size", SMALL]);
  await sleep(3500);
  await setState("open=1", 3600);
  small = await shot(`14-small-display-${SMALL}`, `EXPANDED on a ${SMALL} display: one scale factor, 3:2 preserved`);
  small.probe = await evaluate(`(() => { const w = document.getElementById("widget");
    return { client: w ? { w: w.clientWidth, h: w.clientHeight } : null, inner: { w: innerWidth, h: innerHeight } }; })()`);
} catch (e) {
  smallDisplayError = String(e.message ?? e);
  process.stderr.write(`[overlay] small display: BLOCKED — ${smallDisplayError}\n`);
} finally {
  adb(["shell", "wm", "size", "reset"]);
  await sleep(3000);
}
try {
  await setState("open=1", 3400);
  restored = await shot("15-display-restored", "the real display size restored");
} catch (e) {
  process.stderr.write(`[overlay] display restore frame: ${String(e.message ?? e)}\n`);
}

/* -------------------------------------------------------------- report */

/**
 * Does the window actually SHOW the whole surface?
 *
 * The 384×256 shell is the content's size, not the window's: on a short
 * work area the host scales it down, and the window frame is the
 * proportional frame around whatever fits. A frame that is 3:2 but SMALLER
 * than the content it is supposed to be showing means the widget is being
 * cropped, and that must never read as a pass — a desynchronised display
 * once produced exactly that, with a 384px surface inside a 239px
 * viewport, and the ratio-only check waved it through.
 */
function showsWholeSurface(entry) {
  if (!entry?.window || !entry?.probe?.client) return null;
  const dpr = entry.probe.dpr ?? 3;
  const fits = entry.window.w >= entry.probe.client.w * dpr
    && entry.window.h >= entry.probe.client.h * dpr;
  return {
    windowPx: { w: entry.window.w, h: entry.window.h },
    contentPx: { w: Math.round(entry.probe.client.w * dpr), h: Math.round(entry.probe.client.h * dpr) },
    viewportCss: entry.probe.inner ?? null,
    unclipped: fits,
  };
}

const compact = stateResults.find((s) => s.state.startsWith("01-compact"));
const expanded = stateResults.find((s) => s.state.startsWith("02-expanded"));
const prompt = stateResults.find((s) => s.state.startsWith("03-prompt"));
const verify = stateResults.find((s) => s.state.startsWith("04-verify"));
// The unscaled 3:2 shell is 396dp wide. On the small display there is
// physically less room than that, so a scale factor is not optional — this
// is what makes the row a real test rather than a formality.
const smallDisplayNeededScaling = !!expanded?.window
  && Number((/(\d+)x(\d+)/.exec(SMALL)?.[1]) ?? 0) < expanded.window.w;

const report = {
  capturedAt: new Date().toISOString(),
  device,
  permission: {
    appop: winFinal?.appop ?? null,
    canDrawOverlaysWindowAppOp: winFinal?.appop === "SYSTEM_ALERT_WINDOW",
    grantedVia: "Settings → Display over other apps → Safi → Allow (ACTION_MANAGE_OVERLAY_PERMISSION)",
  },
  overlay: {
    windowTokenType: winFinal?.tokenType ?? null,
    isTypeApplicationOverlay: winFinal?.isApplicationOverlay ?? false,
    flags: winFinal?.flags ?? null,
    requestedSize: winFinal?.requested ?? null,
    noSafiActivityOnScreen: noSafiActivity,
  },
  states: stateResults.map((s) => ({ ...s, surface: showsWholeSurface(s) })),
  details: { ...detailsProbe, surface: showsWholeSurface(details) },
  drags: drags.map((d) => {
    const travel = d.wanted && d.before
      ? Math.hypot(d.wanted.x - d.before.x, d.wanted.y - d.before.y) : 0;
    const want = d.wanted ?? { x: 0, y: 0 };
    // `input swipe` is a sampled injection: the window lands close to, not
    // exactly on, the target. The tolerance scales with the distance
    // travelled so a long drag is not judged by a short drag's rule.
    const tol = Math.max(48, Math.round(travel * 0.15));
    const went = d.before && d.after ? Math.hypot(d.after.x - d.before.x, d.after.y - d.before.y) : 0;
    return {
      name: d.name,
      before: d.before ? { x: d.before.x, y: d.before.y, w: d.before.w, h: d.before.h } : null,
      after: d.after ? { x: d.after.x, y: d.after.y, w: d.after.w, h: d.after.h } : null,
      gesture: d.gesture ?? null,
      gestures: d.gestures ?? [],
      snapped: d.snapped ?? false,
      startRegion: d.startRegion ?? null,
      wanted: d.wanted ?? null,
      tolerance: tol,
      travelledFraction: travel > 0 ? Math.round((went / travel) * 100) / 100 : null,
      reachedTarget: !d.after || !d.wanted
        ? null
        : d.expect === "snapped"
          // The release lands ON the edge, and the vertical part of the
          // drag still arrives: a snap that also swallowed the drag would
          // be a different failure.
          ? d.snapped === true && Math.abs(d.after.y - want.y) <= tol && d.after.x <= band.minX * DPR + FRAME_ORIGIN.x + 48
          : Math.abs(d.after.x - want.x) <= tol && Math.abs(d.after.y - want.y) <= tol,
      moved: d.before && d.after ? (d.before.x !== d.after.x || d.before.y !== d.after.y) : null,
    };
  }),
  offScreenRecovery: {
    parkedOnFullDisplay: beforeOff ? { x: beforeOff.x, y: beforeOff.y, w: beforeOff.w, h: beforeOff.h } : null,
    displayShrunkTo: smallPanel,
    // The point of the test: this position genuinely did not fit the
    // smaller display, so the clamp had something real to catch.
    oldPositionWouldNotHaveFit: wouldNotFit,
    clampedTo: drivenOffScreen ? { x: drivenOffScreen.x, y: drivenOffScreen.y, w: drivenOffScreen.w, h: drivenOffScreen.h } : null,
    insideDisplayAfterClamp: insideSmall(drivenOffScreen) === true,
    afterRestart: afterOff ? { x: afterOff.x, y: afterOff.y, w: afterOff.w, h: afterOff.h } : null,
    visibleOnScreen: onScreen === true,
    displayRestoredTo: originalSize,
    afterRestore: afterRestore ? { x: afterRestore.x, y: afterRestore.y, w: afterRestore.w, h: afterRestore.h } : null,
  },
  landscape: {
    probe: landscape.probe ?? null,
    orientation: landscape.orientation ?? null,
    panel: landscape.panel ?? null,
    displayConfig: landscape.displayConfig ?? null,
    window: landscape.window ?? null,
  },
  smallDisplay: {
    size: SMALL,
    error: smallDisplayError,
    probe: small?.probe ?? null,
    window: small?.window ?? null,
    restoredTo: originalSize,
    restoredWindow: restored?.window ?? null,
    unscaledShellWouldNotFit: smallDisplayNeededScaling,
  },
  transparency,
  steps,
  summary: {},
};

const isThreeByTwo = (c) => !!c && c.w === 384 && c.h === 256;
/** A state passes only if the window actually shows the whole surface. */
const unclipped = (s) => showsWholeSurface(s)?.unclipped === true;

report.summary = {
  systemAlertWindowGranted: report.permission.canDrawOverlaysWindowAppOp,
  realApplicationOverlay: report.overlay.isTypeApplicationOverlay,
  noActivityWindowBehind: noSafiActivity,
  compactOverlay: !!compact?.window && compact.window.w === 264 && compact.window.h === 264,
  // The window is the proportional FRAME around the 384×256 content, so
  // the assertion is the ratio, not the content size — AND the frame has
  // to be big enough to actually contain the surface it claims to show.
  expandedThreeByTwoOverlay: isThreeByTwo(expanded?.probe.client)
    && !!expanded.window
    && Math.abs(expanded.window.w / expanded.window.h - 1.5) < 0.03
    && unclipped(expanded),
  promptReadyThreeByTwo: isThreeByTwo(prompt?.probe.client)
    && prompt.probe.scroll.h > prompt.probe.client.h && unclipped(prompt),
  verifyResultThreeByTwo: isThreeByTwo(verify?.probe.client) && unclipped(verify),
  detailsThreeByTwoWithInternalScroll: isThreeByTwo(detailsProbe.client)
    && detailsProbe.scroll.h > detailsProbe.client.h && detailsProbe.atEnd === true
    && showsWholeSurface(details)?.unclipped === true,
  noBrokenMascots: stateResults.every((s) => s.probe.brokenMascots.length === 0),
  // A drag only counts if the window LANDED where it was told to go. A few
  // pixels of jitter used to satisfy a weaker check and hide a broken drag.
  // This reads the REPORTED drags, which is where reachedTarget and the
  // travelled fraction are actually computed.
  // A drag that needed NO gesture because the window was already sitting
  // on the target is a pass; otherwise the window must have travelled most
  // of the way. "Moved by a few pixels" no longer satisfies this.
  realTouchDragMovedWindow: report.drags.length > 0
    && report.drags.every((d) => d.reachedTarget === true
      && ((d.gestures ?? []).length === 0 || (d.travelledFraction ?? 0) >= 0.6)),
  // Reaching a target is not the same as touching it: a drag that found
  // the window already there delivered no gesture at all. Every position
  // in this run has to have been reached by real system touches.
  everyDragUsedRealTouch: report.drags.length > 0
    && report.drags.every((d) => (d.gestures ?? []).length > 0),
  appUnderneathRemainsVisible: transparency.identical === true
    // "Identical" between two black rectangles is not transparency, so
    // both halves of the comparison have to carry a real app.
    && frameIsLive(transparency.luma?.withSafi ?? {})
    && frameIsLive(transparency.luma?.safiStopped ?? {}),
  // The 3:2 shell alone does not prove a rotation happened: it is 3:2 in
  // portrait too. The PANEL has to be physically landscape — the panel is
  // the independent witness, read from a capture rather than from the
  // page, which merely repeats what the window server told it.
  portraitAndLandscape: landscape.panel?.w > landscape.panel?.h
    && landscape.displayConfig?.w === landscape.panel?.w
    && landscape.displayConfig?.h === landscape.panel?.h
    && String(landscape.orientation ?? "").startsWith("landscape"),
  // A 3:2 shell on the small display is not enough on its own: the FRAME
  // the window manager reports has to be 3:2 too, it has to be smaller
  // than the full-size frame, and the small display has to be too narrow to
  // have fitted the unscaled shell at all — otherwise this row would pass
  // without any scaling ever being necessary.
  responsiveSmallDisplay: !!small?.probe?.client
    && Math.abs(small.probe.client.w / small.probe.client.h - 1.5) < 0.03
    && !!small.window
    && Math.abs(small.window.w / small.window.h - 1.5) < 0.03
    && small.window.w > 0
    && small.window.w < (expanded.window?.w ?? Infinity)
    && smallDisplayNeededScaling,
  // The window must be reachable after a restart, AND the clamp must have
  // actually caught something: the position has to have been one that
  // genuinely did not fit the smaller display, and it has to have been
  // brought back inside it. A clamp that never had work to do proves
  // nothing.
  offScreenRecovery: wouldNotFit === true
    && insideSmall(drivenOffScreen) === true
    && !!afterOff && afterOff.w > 0 && afterOff.h > 0 && onScreen === true
    && !!afterRestore && afterRestore.w > 0,
};

writeFileSync(join(OUT, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
process.stderr.write(`\n[overlay] wrote ${join(OUT, "evidence.json")}\n`);
console.log(JSON.stringify(report.summary, null, 2));
process.exit(0);
