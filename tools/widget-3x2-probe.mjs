#!/usr/bin/env node
/**
 * 3:2 widget layout probe — real measurements, real bridge, real Chrome.
 *
 * Spawns the SHIPPED runtime bridge (the same one bundled in Safi.app),
 * then drives the widget page through tools/visual-harness.mjs with an
 * `--eval` expression, so every number it prints is a real layout read
 * in a real browser: never a mock, never a guess.
 *
 *   node tools/widget-3x2-probe.mjs "#wp=1&open=1" [--vw 396] [--vh 268]
 *   node tools/widget-3x2-probe.mjs "#wp=1&open=1" --json
 *
 * Zero npm dependencies, like the rest of tools/.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_RESOURCE = join(
  repo,
  "apps/desktop/src-tauri/target/release/bundle/macos/Safi.app/Contents/Resources/resources/safi",
);
const bridgePath = join(APP_RESOURCE, "apps/desktop/bridge.js");
if (!existsSync(bridgePath)) {
  console.error(`Safi.app bundle missing or stale: ${bridgePath}`);
  process.exit(2);
}
const harness = join(repo, "tools", "visual-harness.mjs");

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const pageHash = argValue("--hash", process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "#wp=1&open=1");
const wantJson = process.argv.includes("--json");
const sizeArg = argValue("--size", "396,268");
const wait2 = argValue("--wait2", "");
const [vw, vh] = sizeArg.split(",").map(Number);
/* The browser window is deliberately LARGER than the emulated viewport:
   when the window is smaller than the override, Chrome shrinks the page
   and every getBoundingClientRect comes back scaled, which would make
   the measurements a lie. The override is what defines the frame. */
const winW = Number(argValue("--ww", "1000"));
const winH = Number(argValue("--wh", "760"));
const timeoutMs = Number(argValue("--timeout", "30000"));

/* One expression, evaluated in the page: the complete 3:2 layout truth. */
const PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1), right: +r.right.toFixed(1) }; };
  const vis = (el) => { if (!el) return false; const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    return !(el.hidden || el.classList.contains("hidden")); };
  const w = q("#widget");
  const rows = {};
  // Every element that must be simultaneously visible in the INPUT view.
  const required = {
    header: "header", brand: ".brand", trustLine: "#trust-line", collapse: "#collapse",
    modes: "#modes", modeAsk: "#mode-ask", modeVerify: "#mode-verify",
    askPane: "#ask-pane", speak: "#speak", chiedi: "#send", chips: ".chip-row",
    verifyPane: "#verify-pane", verifyField: "#paste-answer", verifica: "#verify",
    micro: "#microstate", result: "#result", promptCard: "#prompt-card",
  };
  for (const [key, sel] of Object.entries(required)) {
    const el = q(sel);
    rows[key] = el ? { visible: vis(el), box: box(el), text: (el.innerText || "").trim().slice(0, 40) } : null;
  }
  const cs = w ? getComputedStyle(w) : null;
  const visibleRequired = Object.entries(rows).filter(([k]) =>
    ["header","modes","speak","chiedi","chips","verifyField","verifica"].includes(k));
  return {
    mode: window.__SAFI_UI__?.mode ?? null,
    view: { result: vis(q("#result")), prompt: vis(q("#prompt-card")) },
    window: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    widget: w ? {
      box: box(w),
      client: { w: w.clientWidth, h: w.clientHeight },
      scroll: { w: w.scrollWidth, h: w.scrollHeight },
      overflowX: w.scrollWidth > w.clientWidth + 2,
      overflowY: w.scrollHeight > w.clientHeight + 1,
      padding: cs ? { t: cs.paddingTop, r: cs.paddingRight, b: cs.paddingBottom, l: cs.paddingLeft } : null,
      radius: cs?.borderRadius,
      aspect: cs?.aspectRatio,
    } : null,
    collapsed: (() => { const c = q("#collapsed"); return c ? { visible: vis(c), box: box(c) } : null; })(),
    rows,
    // Vertical stack summary: what each band costs, top to bottom.
    bands: ["header", ".divider", "#modes", "#speak", "#microstate", "#actions-row", ".chip-row", "#verify-pane"]
      .map((sel) => { const el = q(sel); if (!el || !vis(el)) return null;
        const r = el.getBoundingClientRect();
        return { sel, top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1) }; })
      .filter(Boolean),
    requiredAllVisible: visibleRequired.every(([, v]) => v && v.visible),
    requiredMissing: visibleRequired.filter(([, v]) => !(v && v.visible)).map(([k]) => k),
    contentBottom: w ? +(w.getBoundingClientRect().bottom).toFixed(1) : null,
    lowestRequired: +Math.max(...visibleRequired.filter(([, v]) => v && v.visible).map(([, v]) => v.box.bottom)).toFixed(1),
    lifecycle: window.__SAFI_DIAG__?.lifecycle?.last ?? null,
    lifecycleTotals: (() => { const l = window.__SAFI_DIAG__?.lifecycle; return l ? { expands: l.expands, collapses: l.collapses, timeouts: l.timeouts } : null; })(),
    windowDrag: window.__SAFI_DIAG__?.windowDrag ?? null,
    nativeWindow: window.__SAFI_DIAG__?.window ?? null,
    drag: window.__SAFI_DIAG__?.drag ?? null,
    recovery: window.__SAFI_DIAG__?.recovery ?? null,
    errors: window.__SAFI_DIAG__?.errors ?? null,
    shellContract: { expanded: 384, expandedWindow: 396, ratio: 3 / 2 },
  };
})()`;

const outDir = mkdtempSync(join(tmpdir(), "safi-3x2-"));
const png = join(outDir, "probe.png");
const diag = join(outDir, "probe.json");
let bridge = null;
try {
  bridge = spawn("node", [bridgePath], {
    cwd: APP_RESOURCE,
    env: { ...process.env, SAFI_BRIDGE_STATE_DIR: outDir, SAFI_GLASS_PROBE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const { base, token } = await new Promise((done, fail) => {
    let buf = "";
    const t = setTimeout(() => fail(new Error("bridge handshake timeout")), 10000);
    bridge.stdout.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/SAFI_BRIDGE_READY port=(\d+) token=([A-Za-z0-9_-]+)/);
      if (m) { clearTimeout(t); done({ base: `http://127.0.0.1:${m[1]}/`, token: m[2] }); }
    });
    bridge.on("error", fail);
  });
  const r = spawnSync("node", [harness,
    "--url", `${base}#t=${token}&${pageHash.replace(/^#/, "")}`,
    "--wait", "window.__SAFI_DIAG__?.bootCompleted === true",
    "--out", png, "--diag", diag,
    "--vw", String(winW), "--vh", String(winH), "--timeout", String(timeoutMs),
    "--viewport", sizeArg,
    "--eval", PROBE,
    "--wait2", wait2 || "window.__SAFI_UI__?.mode === 'EXPANDED' || window.__SAFI_UI__?.mode === 'COMPACT'",
  ], { encoding: "utf8", timeout: timeoutMs + 20000 });
  let report = {};
  try { report = JSON.parse(readFileSync(diag, "utf8")); } catch { /* harness may have exited early */ }
  if (wantJson) {
    console.log(JSON.stringify({ code: r.status, eval: report.eval, diag: report.diag, screenshot: png }, null, 2));
  } else {
    if (r.status !== 0) console.error(r.stderr?.slice(-800) || r.stdout?.slice(-800) || "");
    console.log(JSON.stringify(report.eval ?? { error: "no eval result" }, null, 2));
    console.error(`screenshot: ${png}`);
  }
} finally {
  bridge?.kill();
  if (!wantJson) rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  else console.error(`kept: ${outDir}`);
}
