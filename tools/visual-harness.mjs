#!/usr/bin/env node
/**
 * Real visual test harness for the Safi widget — drives headless Chrome
 * through the DevTools protocol. Zero npm dependencies: Node ≥ 22 ships
 * a WebSocket client, Chrome is discovered on disk.
 *
 * The difference from `chrome --screenshot`: this harness WAITS until
 * the widget page reaches the requested state (boot completed, trust
 * stamp shown, …) before capturing, and dumps the page's own
 * diagnostics next to the screenshot. `chrome --screenshot` cannot do
 * this: it fires at page load, before the async boot finishes.
 *
 *   node tools/visual-harness.mjs --url "http://127.0.0.1:P/#t=TOK" \
 *        --wait "window.__SAFI_DIAG__?.bootCompleted === true" \
 *        --out /tmp/shot.png --diag /tmp/shot.json [--vw 420] [--vh 620]
 *
 * Exit codes: 0 = state reached and captured, 3 = wait timeout.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  throw new Error("No Chrome/Chromium binary found");
}

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const url = argValue("--url");
if (!url) {
  console.error("usage: visual-harness.mjs --url URL --wait EXPR --out FILE.png [--diag FILE.json] [--vw N] [--vh N] [--timeout MS]");
  process.exit(2);
}
const waitExpr = argValue("--wait", "window.__SAFI_DIAG__?.bootCompleted === true");
const outPath = argValue("--out", "/tmp/safi-visual.png");
const diagPath = argValue("--diag", "");
const vw = Number(argValue("--vw", "420"));
const vh = Number(argValue("--vh", "620"));
const waitMs = Number(argValue("--timeout", "15000"));
// Optional synthetic click after the first wait, e.g. --click 30,30 or
// --click green|amber|red (traffic-light semantic names).
const clickArg = argValue("--click", "");
// Optional second state to reach after the click.
const wait2 = argValue("--wait2", "");
// Optional arbitrary page evaluation after the state is reached; its JSON
// result is reported under "eval" (used by visual tests to inspect DOM/CSS).
const evalExpr = argValue("--eval", "");
const focusSelector = argValue("--focus", "");
/* Optional EXACT page viewport override, e.g. `--viewport 396,268`.
   A native window is a precise frame, so measuring the 3:2 shell in a
   browser means forcing the same inner size the shell would give it:
   headless Chrome's own window is never a substitute for the contract. */
const viewportArg = argValue("--viewport", "");

const chrome = findChrome();
const profile = mkdtempSync(join(tmpdir(), "safi-visual-"));
// Optional step trace for hang diagnosis: SAFI_HARNESS_TRACE=1
const TRACE = process.env.SAFI_HARNESS_TRACE === "1";
const trace = (step) => { if (TRACE) console.error(`[harness] ${step}`); };
const chromeProc = spawn(
  chrome,
  [
    // "old" headless: the 153 "new" headless stopped answering
    // Page.captureScreenshot (compositor never returns a frame). The old
    // engine still composites reliably and supports CDP fully.
    "--headless=old",
    "--disable-gpu",
    "--disable-extensions",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=0`,
    `--user-data-dir=${profile}`,
    `--window-size=${vw},${vh}`,
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"], detached: true },
);

/* Teardown: Chrome is spawned in its OWN process group, so the browser
   AND every renderer/zygote child die together. `chromeProc.kill()` alone
   leaves the helpers behind: after a few captures the machine is full of
   zombie renderers and later captures stall on timer throttling. */
function stopChrome() {
  try {
    process.kill(-chromeProc.pid, "SIGKILL");
  } catch {
    try { chromeProc.kill("SIGKILL"); } catch { /* already gone */ }
  }
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best-effort */ }
}

/* Chrome's own stderr is captured: renderer crashes ("Aw, Snap") and
   navigation errors are the difference between "the page is stuck" and
   "the page reloaded under us". Reported in the diagnostics. */
const chromeStderr = [];
chromeProc.stderr?.on("data", (d) => {
  const text = String(d);
  if (text.trim()) chromeStderr.push(text.trim().slice(0, 300));
});

let cdpPort = 0;
try {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && cdpPort === 0) {
    const portFile = join(profile, "DevToolsActivePort");
    if (existsSync(portFile)) {
      cdpPort = Number(readFileSync(portFile, "utf8").split("\n")[0]);
      break;
    }
    await sleep(100);
  }
  if (!cdpPort) throw new Error("Chrome did not open a DevTools port");

  // Deterministic navigation: Chrome opens a stable about:blank tab and
  // we drive Page.navigate over CDP. (Letting Chrome open the URL itself
  // proved flaky: with 40+ concurrent runs it sometimes stays on
  // chrome://new-tab-page and the harness waits on the wrong tab.)
  let target = null;
  const listDeadline = Date.now() + 15000;
  while (Date.now() < listDeadline && !target) {
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
    const tabs = await res.json();
    target = tabs.find((t) => t.type === "page" && (t.url ?? "").startsWith("about:blank"));
    if (!target) await sleep(150);
  }
  if (!target) throw new Error("No about:blank target found");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let seq = 0;
  const pending = new Map();
  const consoleMessages = [];
  const runtimeExceptions = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      consoleMessages.push(`[console.${msg.params.type}] ${text}`);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      runtimeExceptions.push(d.exception?.description ?? d.text ?? "exception");
    }
  });

  function send(method, params = {}) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send("Runtime.enable");
  trace("target acquired, ws open");
  await send("Page.enable");
  await send("Log.enable").catch(() => {});
  if (/^\d+,\d+$/.test(viewportArg)) {
    const [ovw, ovh] = viewportArg.split(",").map(Number);
    await send("Emulation.setDeviceMetricsOverride", { width: ovw, height: ovh, deviceScaleFactor: 1, mobile: false }).catch(() => {});
    trace(`viewport override ${ovw}x${ovh}`);
  }
  // Drive the real navigation over CDP (deterministic target).
  trace("navigating");
  await send("Page.navigate", { url });
  trace("navigate returned");

  // Wait for the requested state by evaluating the predicate in the page.
  const stateDeadline = Date.now() + waitMs;
  let reached = false;
  let lastValue = null;
  while (Date.now() < stateDeadline) {
    try {
      const r = await send("Runtime.evaluate", {
        expression: `(${waitExpr})`,
        awaitPromise: true,
        returnByValue: true,
      });
      lastValue = r.result?.value;
      if (lastValue === true) {
        reached = true;
        break;
      }
    } catch {
      /* page still navigating: keep waiting */
    }
    await sleep(200);
  }

  if (!reached) {
    // Dump the page's own diagnostics to explain the failure.
    let diag = null;
    try {
      const r = await send("Runtime.evaluate", {
        expression: "JSON.stringify({href:location.href, rs:document.readyState, hasDiag:typeof window.__SAFI_DIAG__, scripts:document.scripts.length, title:document.title, diag: window.__SAFI_DIAG__ ?? null, boot: document.getElementById('boot')?.hidden ?? null, fatal: document.getElementById('fatal')?.hidden ?? null, errcode: document.getElementById('errcode')?.textContent ?? null})",
        returnByValue: true,
      });
      diag = JSON.parse(r.result?.value ?? "null");
    } catch { /* ignore */ }
    console.error(JSON.stringify({ error: "wait-timeout", waitExpr, lastValue, diag, runtimeExceptions, chromeStderr: chromeStderr.slice(-5) }, null, 2));
    ws.close();
    stopChrome();
    await sleep(300);
    process.exit(3);
  }

  // Input driver: `--click green|amber|red` (repeatable) and `--press NAME`
  // activate the REAL page handlers through standard DOM events
  // (element.click() / KeyboardEvent) — the identical listener chain a
  // physical mouse or keyboard uses. Raw CDP Input.dispatchMouseEvent
  // proved unreliable in headless against the animated capsule; the
  // physical hit-path is separately covered by the DEVICE test.
  const LIGHT_IDS = { mascot: "collapsed", collapse: "collapse", green: "tl-max", amber: "tl-min", yellow: "tl-min", red: "tl-close" };
  const clicks = [];
  const presses = [];
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--click") clicks.push(process.argv[i + 1]);
    if (process.argv[i] === "--press") presses.push(process.argv[i + 1]);
  }
  for (const name of clicks) {
    const id = LIGHT_IDS[name];
    if (!id) throw new Error(`unknown click target: ${name}`);
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = await send("Runtime.evaluate", {
        expression: `window.__SAFI_UI__?.mode ?? null`,
        returnByValue: true,
      }).catch(() => ({ result: { value: null } }));
      await sleep(300); // let the entrance animation settle
      await send("Runtime.evaluate", {
        expression: `document.getElementById(${JSON.stringify(id)})?.click()`,
        returnByValue: true,
      }).catch(() => {});
      await sleep(250);
      const after = await send("Runtime.evaluate", {
        expression: `window.__SAFI_UI__?.mode ?? null`,
        returnByValue: true,
      }).catch(() => ({ result: { value: null } }));
      // The click counts only when it actually moved the machine.
      if (after.result?.value && after.result.value !== before.result?.value) break;
    }
  }
  /* `cycles=N` URL driver (brief §7): N real COMPACT → click →
     EXPANDED FULL → Escape → COMPACT cycles, measured IN THE PAGE.
     Acceptance per cycle: the FIRST click opens the full panel (zero
     second clicks), no clipping, no mid-open paint, no late resize, no
     ghost panel in compact, and — where a native shell really resizes
     — the compact window is EXACTLY the canonical 88×88. */
  const cyclesMatch = (url.split("#")[1] ?? "").match(/(?:^|&)cycles=(\d+)/);
  if (cyclesMatch) {
    const n = Math.min(60, Math.max(1, Number(cyclesMatch[1])));
    trace(`cycle driver: ${n} cycles`);
    await send("Runtime.evaluate", {
      expression: `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const d = document, w = window;
        const target = { w: 396, h: 268 };
        const compactTarget = { w: 88, h: 88 };
        const out = { total: ${n}, fullOpen: 0, clipped: 0, midOpen: 0, lateResize: 0, secondClick: 0, ghostPanel: 0, compactWrongSize: 0, shellResizes: false };
        const w0 = [w.innerWidth, w.innerHeight];
        const waitMode = async (mode, ms) => { const dl = Date.now() + ms; while (Date.now() < dl && w.__SAFI_UI__?.mode !== mode) await sleep(20); return w.__SAFI_UI__?.mode === mode; };
        if (w.__SAFI_UI__?.mode === "EXPANDED") { w.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await waitMode("COMPACT", 3000); }
        const panelClipped = () => { const el = d.getElementById("widget"); if (!el || el.hidden) return false; /* the 3:2 shell is FIXED: only a horizontal overflow or a shell that grew is clipping. Internal vertical scroll is the designed behaviour. */ return el.scrollWidth > el.clientWidth + 2 || el.clientHeight > target.h; };
        const ghostPanel = () => { const el = d.getElementById("widget"); const cp = d.getElementById("collapsed"); return Boolean(el && !el.hidden) || Boolean(cp && cp.classList.contains("hidden")); };
        const mo = new MutationObserver(() => { if (w.__SAFI_UI__?.mode === "EXPANDED" && panelClipped()) w.__CYCLE_MID__ = true; });
        mo.observe(d.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "class"] });
        for (let i = 0; i < ${n}; i++) {
          w.__CYCLE_MID__ = false;
          d.getElementById("collapsed")?.click();
          if (!await waitMode("EXPANDED", 3000)) {
            // The FIRST click did not open the panel: a retry would be
            // required in the app, which is an acceptance failure.
            out.secondClick += 1; out.clipped += 1;
            w.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await waitMode("COMPACT", 3000); continue;
          }
          /* Shell awareness: the late-resize and compact-size checks are
             meaningful only where a native shell really resizes. In a
             plain browser the hint POST works, the OS does not. */
          if (Math.abs(w.innerWidth - w0[0]) > 10 || Math.abs(w.innerHeight - w0[1]) > 10) out.shellResizes = true;
          if (out.shellResizes && (Math.abs(w.innerWidth - target.w) > 10 || Math.abs(w.innerHeight - target.h) > 10)) out.lateResize += 1;
          await sleep(80);
          if (panelClipped()) out.clipped += 1; else out.fullOpen += 1;
          if (w.__CYCLE_MID__) out.midOpen += 1;
          w.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
          if (!await waitMode("COMPACT", 3000)) out.clipped += 1;
          await sleep(60);
          if (ghostPanel()) out.ghostPanel += 1;
          if (out.shellResizes && (Math.abs(w.innerWidth - compactTarget.w) > 1 || Math.abs(w.innerHeight - compactTarget.h) > 1)) out.compactWrongSize += 1;
        }
        mo.disconnect();
        w.__CYCLE_RESULT__ = out;
        return out;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    trace("cycle driver done");
  }
  for (const key of presses) {
    trace(`press ${key}`);
    if (!["Escape", "Enter"].includes(key)) throw new Error(`unsupported key: ${key}`);
    /* Dispatch the REAL key event and verify it actually CHANGED the
       machine. A single dispatch is racy (the key can land before the
       page finished its boot task, or while a transition is in flight),
       so we retry until the UI mode moves — the event itself is never
       simulated or faked. */
    for (let attempt = 0; attempt < 6; attempt++) {
      const before = await send("Runtime.evaluate", {
        expression: `window.__SAFI_UI__?.mode ?? null`,
        returnByValue: true,
      }).catch(() => ({ result: { value: null } }));
      await send("Runtime.evaluate", {
        expression: `window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)} }))`,
        returnByValue: true,
      }).catch(() => {});
      await sleep(400);
      const after = await send("Runtime.evaluate", {
        expression: `window.__SAFI_UI__?.mode ?? null`,
        returnByValue: true,
      }).catch(() => ({ result: { value: null } }));
      if (after.result?.value && after.result.value !== before.result?.value) break;
      trace(`press ${key} attempt ${attempt} mode ${before.result?.value} -> ${after.result?.value}`);
    }
  }
  if (wait2) {
    // A bare mode name (EXPANDED / COMPACT) becomes a UI predicate;
    // anything else is evaluated as a page expression.
    const wait2Expr = /^(EXPANDED|COMPACT)$/.test(wait2)
      ? `window.__SAFI_UI__?.mode === '${wait2}'`
      : wait2;
    const clickDeadline = Date.now() + waitMs;
    let reached2 = false;
    while (Date.now() < clickDeadline) {
      try {
        const r2 = await send("Runtime.evaluate", { expression: `(${wait2Expr})`, returnByValue: true });
        if (r2.result?.value === true) {
          reached2 = true;
          break;
        }
      } catch { /* keep waiting */ }
      await sleep(200);
    }
    if (!reached2) {
      console.error(JSON.stringify({ error: "wait2-timeout", wait2, consoleMessages, runtimeExceptions, chromeStderr: chromeStderr.slice(-5) }, null, 2));
      ws.close();
      stopChrome();
      await sleep(300);
      process.exit(3);
    }
  }

  trace(`wait done (reached=${reached})`);
  // Optional introspection of the reached state.
  let evalResult = null;
  if (!evalExpr) {
    trace("introspection start");
    try {
      const r0 = await send("Runtime.evaluate", {
        expression: `JSON.stringify({ trust: window.__SAFI_DIAG__?.trust ?? null, spark: window.__SAFI_DIAG__?.spark ?? null, uiMode: window.__SAFI_UI__?.mode ?? null, mascot: window.__SAFI_DIAG__?.mascot ?? null, mascotLine: window.__SAFI_DIAG__?.mascotLine ?? null, compactInnerText: (function(){ const el = document.getElementById('collapsed'); return el && !el.classList.contains('hidden') ? (el.innerText||'').trim() : null; })(), compactMascotRect: (function(){ const el = document.querySelector('#collapsed img[data-mascot]'); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; })(), headerMascotRect: (function(){ const el = document.querySelector('#safi-mascot-header[data-mascot]'); if (!el || el.closest('#widget')?.hidden) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; })(), footerMascotRect: (function(){ const el = document.querySelector('#safi-mascot-footer[data-mascot]'); if (!el || el.closest('#widget')?.hidden) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) }; })(), compactMascot: (function(){ const s = document.querySelector('#collapsed img[data-mascot]'); return s ? s.getAttribute('data-state') : null; })(), headerMascot: (function(){ const s = document.querySelector('#safi-mascot-header[data-mascot]'); return s ? s.getAttribute('data-state') : null; })(), mascotSrc: (function(){ const s = document.querySelector('#collapsed img[data-mascot]'); return s ? s.getAttribute('src') : null; })(), compactActual: window.__SAFI_DIAG__?.compactActual ?? null, collapseConfirmed: window.__SAFI_DIAG__?.collapseConfirmed ?? null, mascotTierAudit: window.__SAFI_DIAG__?.mascotTierAudit ?? null, widgetTint: (function(){ const el = document.getElementById('widget'); if (!el) return null; const s = getComputedStyle(el, '::before'); return { background: s.backgroundImage.slice(0, 200), hasImage: s.backgroundImage !== 'none' }; })(), fieldTint: (function(){ const el = document.querySelector('.field'); return el ? getComputedStyle(el).backgroundColor : null; })(), mascotSharp: (function(){ const el = document.querySelector('#collapsed img[data-mascot]'); if (!el) return null; const s = getComputedStyle(el); const chain = []; let p = el.parentElement; while (p && p !== document.documentElement) { const cs = getComputedStyle(p); chain.push({ filter: cs.filter, opacity: cs.opacity, backdropFilter: cs.backdropFilter }); p = p.parentElement; } return { filter: s.filter, opacity: s.opacity, mixBlendMode: s.mixBlendMode, ancestors: chain }; })(), expandedText: (function(){ const el = document.getElementById('widget'); return el && !el.hidden ? (el.innerText||'').trim() : null; })(), prompt: window.__SAFI_DIAG__?.prompt ?? null, promptCardHidden: document.getElementById('prompt-card')?.hidden ?? null, promptCardText: (function(){ const el = document.getElementById('prompt-card'); return el && !el.hidden ? (el.innerText||'').trim() : null; })(), surfaceVerified: window.__SAFI_DIAG__?.surfaceVerified ?? null, transition: window.__SAFI_DIAG__?.transition ?? null, compactRect: (function(){ const el = document.getElementById('collapsed'); if (!el || el.classList.contains('hidden')) return null; const r = el.getBoundingClientRect(); return { w: Math.round(el.offsetWidth), h: Math.round(el.offsetHeight), x: Math.round(r.x), y: Math.round(r.y) }; })(), expandedRect: (function(){ const el = document.getElementById('widget'); if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return { w: Math.round(el.offsetWidth), h: Math.round(el.offsetHeight), x: Math.round(r.x), y: Math.round(r.y) }; })(), windowSize: { w: window.innerWidth, h: window.innerHeight }, hasHorizontalClip: (function(){ const el = document.getElementById('widget'); if (!el || el.hidden) return false; return el.scrollWidth > el.clientWidth + 2; })(),
 inputView: (function(){
  const w = document.getElementById('widget');
  if (!w || w.hidden) return null;
  const card = document.getElementById('prompt-card');
  const isInput = document.getElementById('result').classList.contains('hidden') && (card ? card.hidden === true : true);
  const required = { header: 'header', modes: '#modes', speak: '#speak', chiedi: '#send', chips: '.chip-row', verifyField: '#paste-answer', verifica: '#verify' };
  const rows = {};
  for (const key in required) {
    const el = document.querySelector(required[key]);
    if (!el) { rows[key] = null; continue; }
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    rows[key] = { visible: s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0, bottom: Math.round(r.bottom), right: Math.round(r.right) };
  }
  const frame = w.getBoundingClientRect();
  const contentBottom = frame.top + w.clientHeight - parseFloat(getComputedStyle(w).paddingBottom);
  return {
    isInput: isInput,
    client: { w: w.clientWidth, h: w.clientHeight },
    scroll: { w: w.scrollWidth, h: w.scrollHeight },
    verticalOverflow: w.scrollHeight > w.clientHeight + 1,
    contentBottom: Math.round(contentBottom),
    rows: rows,
    missing: Object.keys(rows).filter((k) => !(rows[k] && rows[k].visible)),
    belowFrame: Object.keys(rows).filter((k) => rows[k] && rows[k].visible && rows[k].bottom > contentBottom + 1),
  };
 })(),
 windowDrag: window.__SAFI_DIAG__?.windowDrag ?? null,
 cycles: window.__CYCLE_RESULT__ ?? null,
 windowState: window.__SAFI_DIAG__?.window ?? null,
 gesture: window.__SAFI_DIAG__?.gesture ?? null,
 drag: window.__SAFI_DIAG__?.drag ?? null,
 dragContract: (function(){
  const regions = Array.from(document.querySelectorAll('[data-safi-drag]')).map((el) => el.dataset.safiDrag);
  return { regions: regions, blockers: window.__SAFI_DIAG__?.dragBlockers ?? null };
 })(),
 anyVisibleDebug: (function(){ const pat = /(EXPANDED|COMPACT|toggle|escape|debug|fixture|developer|state machine|resize)/i; return Array.from(document.querySelectorAll('body, body *')).some(function(el){ const s = getComputedStyle(el); if (s.display==='none'||s.visibility==='hidden') return false; const r = el.getBoundingClientRect(); if (r.width<2||r.height<2) return false; const own = Array.from(el.childNodes).some(function(n){ return n.nodeType===3 && n.textContent.trim().length>0; }); if (!own) return false; return pat.test(el.innerText||''); }); })() })`,
        returnByValue: true,
      });
      evalResult = JSON.parse(r0.result?.value ?? "{}");
      trace("introspection done");
    } catch { evalResult = {}; }
  }
  if (evalExpr) {
    try {
      const r = await send("Runtime.evaluate", {
        expression: `(${evalExpr})`,
        awaitPromise: true,
        returnByValue: true,
      });
      evalResult = r.result?.value ?? null;
    } catch (e) {
      evalResult = { evalError: String(e) };
    }
  }

  if (focusSelector) {
    await send("Page.bringToFront").catch(() => {});
    await send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(focusSelector)})?.focus()`,
      returnByValue: true,
    });
  }

  // Computed-style evidence is collected separately for every visual
  // assertion. Keeping the five paint properties explicit prevents a
  // screenshot-only check from mistaking a green glyph or glow for a
  // green brand accent (and vice versa).
  try {
    const styleResult = await send("Runtime.evaluate", {
      expression: `(() => {
        const properties = ["color", "backgroundColor", "borderColor", "outlineColor", "boxShadow", "opacity", "fontSize", "fontWeight"];
        const read = (element) => {
          if (!element) return null;
          const style = getComputedStyle(element);
          return Object.fromEntries(properties.map((property) => [property, style[property]]));
        };
        const byId = (id) => read(document.getElementById(id));
        const bySelector = (selector) => read(document.querySelector(selector));
        const stamp = document.getElementById("stamp");
        return {
          askAction: byId("send"),
          askTab: byId("mode-ask"),
          promptTitle: bySelector(".prompt-title"),
          promptSubtitle: bySelector(".prompt-subtitle"),
          promptSignal: bySelector(".prompt-signal"),
          signalSpark: bySelector(".signal-spark"),
          promptCard: byId("prompt-card"),
          promptPrimary: byId("prompt-original"),
          promptText: byId("prompt-text"),
          field: byId("speak"),
          trustLine: byId("trust-line"),
          stateChip: byId("statechip"),
          microstate: byId("microstate"),
          compact: byId("collapsed"),
          stampGlyph: read(stamp?.shadowRoot?.querySelector(".safi-glyph")),
        };
      })()`,
      returnByValue: true,
    });
    const computedStyles = styleResult.result?.value ?? null;
    if (evalResult && typeof evalResult === "object" && computedStyles) {
      evalResult.computedStyles = computedStyles;
    }
  } catch { /* optional visual evidence */ }

  // Let the compositor actually paint the state we just asserted:
  // two animation frames after the predicate became true.
  trace("paint wait start");
  await Promise.race([
    send("Runtime.evaluate", {
      expression: "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
      awaitPromise: true,
    }),
    new Promise((r) => setTimeout(() => r(undefined), 3000)),
  ]).catch(() => { /* headless quirk: paint wait is best-effort */ });
  trace("paint wait done");

  // Screenshot of the actual viewport. Some headless sessions (notably
  // after prior SIGKILLed Chrome instances) stop compositing new frames:
  // captureScreenshot then never answers. Retry once, then fall back to
  // a FRESH Chrome instance for the capture only.
  trace("capturing screenshot");
  let shotResult = await Promise.race([
    send("Page.captureScreenshot", { format: "png" }),
    new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
  ]);
  if (!shotResult?.data) {
    trace("first capture timed out — retrying");
    shotResult = await Promise.race([
      send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }),
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
  }
  if (!shotResult?.data) throw new Error("Page.captureScreenshot timed out twice");
  writeFileSync(outPath, Buffer.from(shotResult.data, "base64"));
  trace("screenshot written");

  // Diagnostics: the page's own DIAG plus the dev dump when present.
  const diagResult = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      diag: window.__SAFI_DIAG__ ?? null,
      chip: document.getElementById('statechip')?.textContent ?? null,
      chipTrust: document.getElementById('statechip')?.dataset?.trust ?? null,
      chipRect: (() => {
        const el = document.getElementById('statechip');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })(),
      stampHidden: document.getElementById('stamp')?.hidden ?? null,
      answer: document.getElementById('answer')?.textContent ?? null,
      microstate: document.getElementById('microstate')?.textContent ?? null,
      uiMode: window.__SAFI_UI__?.mode ?? null,
      glass: window.__SAFI_DIAG__?.glass ?? null,
      spark: window.__SAFI_DIAG__?.spark ?? null,
      trust: window.__SAFI_DIAG__?.trust ?? null,
      devdump: document.getElementById('devdump')?.textContent ?? null,
    })`,
    returnByValue: true,
  }).catch(() => ({ result: { value: "{}" } }));
  const diagJson = JSON.parse(diagResult.result?.value ?? "{}");

  ws.close();
  stopChrome();
  await sleep(150);

  const report = {
    url: url.replace(/#.*$/, "#[redacted-fragment]"),
    waitedFor: waitExpr,
    screenshot: outPath,
    eval: evalResult,
    ...diagJson,
    consoleMessages,
    runtimeExceptions,
  };
  if (diagPath) writeFileSync(diagPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
} catch (error) {
  stopChrome();
  console.error(JSON.stringify({ error: String(error) }));
  process.exit(1);
}
