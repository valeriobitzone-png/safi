#!/usr/bin/env node
/**
 * Golden capture: screenshots of the canonical surfaces from the RELEASE
 * bundle (SAFI_UI_INTERACTION_CONTRACT.md §12). Drives the bundle bridge
 * with the CDP harness and writes one PNG per surface to
 * docs/visual-evidence/golden-current/ plus a diag JSON per capture.
 *
 *   node tools/capture-golden.mjs
 *
 * Surfaces: compact, expanded, verified, uncertain, failed (contract),
 * plus idle for the character comparison.
 */
import { spawn, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { decodePng } from "./png-analysis.mjs";
import { encodePng } from "./mascot-raster.mjs";

const ROOT = process.cwd();
const BUNDLE = resolve(
  process.env.SAFI_BUNDLE ??
    "apps/desktop/src-tauri/target/release/bundle/macos/Safi.app/Contents/Resources/resources/safi",
);
const OUT = resolve("docs/visual-evidence/golden-current");
mkdirSync(OUT, { recursive: true });
mkdirSync("/tmp/safi-golden", { recursive: true });

/* Viewport NOTE: Chrome headless wedges its compositor below ≈ 90 px of
 * window height and never answers captureScreenshot. The compact capsule
 * is captured in a normal viewport and CROPPED to the #collapsed element
 * rect afterwards (crop-compact below). Chrome ALSO enforces a ~500px
 * minimum window width and ignores tiny requested heights, so we request
 * 500x220 explicitly: the 80x76 capsule fits whole and the crop is never
 * clamped (a clamped crop would fake the capsule's aspect ratio). */
const CAPTURES = [
  { id: "compact", hash: "", wait: 'window.__SAFI_UI__ && window.__SAFI_UI__.mode === "COMPACT"', vw: 500, vh: 220, crop: "collapsed", mascot: "compactMascotRect", mascotId: "compact-idle-mascot-4x" },
  { id: "expanded", hash: "open=1", wait: 'window.__SAFI_UI__ && window.__SAFI_UI__.mode === "EXPANDED"', vw: 560, vh: 620, crop: "widget", mascot: "headerMascotRect", mascotId: "expanded-idle-mascot-4x" },
  /* Brief §12: the expanded → compact TRANSITION frame, captured while
     the machine is COLLAPSING (resize in flight, no compact mascot yet). */
  { id: "expanded-to-compact", hash: "open=1&transitionHold=1", click: "collapse", wait: "window.__SAFI_DIAG__?.bootCompleted === true", wait2: "window.__SAFI_DIAG__?.sawCollapsing === true", vw: 560, vh: 620, crop: null },
  { id: "verified", hash: "open=1&demo=verify-right", wait: "window.__SAFI_DIAG__ && window.__SAFI_DIAG__.trust === 'VERIFIED' && window.__SAFI_UI__?.mode === 'EXPANDED'", vw: 560, vh: 620, crop: "widget", mascot: "headerMascotRect", mascotId: "verified-mascot-4x" },
  { id: "uncertain", hash: "open=1&demo=verify-uncertain", wait: "window.__SAFI_DIAG__ && window.__SAFI_DIAG__.trust === 'UNCERTAIN' && window.__SAFI_UI__?.mode === 'EXPANDED'", vw: 560, vh: 620, crop: "widget", mascot: "headerMascotRect", mascotId: "uncertain-mascot-4x" },
  { id: "failed", hash: "open=1&demo=verify-wrong", wait: "window.__SAFI_DIAG__ && window.__SAFI_DIAG__.trust === 'FAILED' && window.__SAFI_UI__?.mode === 'EXPANDED'", vw: 560, vh: 620, crop: "widget", mascot: "headerMascotRect", mascotId: "failed-mascot-4x" },
  /* §11 compact trust states — the REAL renderTrust path, on the capsule. */
  { id: "compact-verified", hash: "compactState=VERIFIED", wait: "window.__SAFI_DIAG__ && window.__SAFI_DIAG__.trust === 'VERIFIED'", vw: 500, vh: 220, crop: "collapsed", mascot: "compactMascotRect", mascotId: "compact-verified-mascot-4x" },
  { id: "compact-uncertain", hash: "compactState=UNCERTAIN", wait: "window.__SAFI_DIAG__ && window.__SAFI_DIAG__.trust === 'UNCERTAIN'", vw: 500, vh: 220, crop: "collapsed", mascot: "compactMascotRect", mascotId: "compact-uncertain-mascot-4x" },
  { id: "compact-failed", hash: "compactState=FAILED", wait: "window.__SAFI_DIAG__ && window.__SAFI_DIAG__.trust === 'FAILED'", vw: 500, vh: 220, crop: "collapsed", mascot: "compactMascotRect", mascotId: "compact-failed-mascot-4x" },
];

const b = spawn("node", [resolve(BUNDLE, "apps/desktop/bridge.js")], {
  cwd: BUNDLE,
  env: { ...process.env, SAFI_BRIDGE_STATE_DIR: "/tmp/safi-golden" },
  stdio: ["ignore", "pipe", "pipe"],
});
let buf = "";
let started = false;
const timer = setTimeout(() => {
  if (!started) { console.error("bridge never became ready:", buf.slice(0, 400)); b.kill(); process.exit(1); }
}, 20000);

b.stderr.on("data", (d) => { buf += d; });
b.stdout.on("data", (d) => {
  buf += d;
  if (started) return;
  const m = buf.match(/SAFI_BRIDGE_READY port=(\d+) token=([A-Za-z0-9_-]+)/);
  if (!m) return;
  started = true;
  clearTimeout(timer);
  let failures = 0;
  for (const cap of CAPTURES) {
    const png = resolve(OUT, `${cap.id}.png`);
    const diag = resolve(OUT, `${cap.id}.diag.json`);
    const url = `http://127.0.0.1:${m[1]}/#t=${m[2]}${cap.hash ? "&" + cap.hash : ""}`;
    const args = [
      resolve(ROOT, "tools/visual-harness.mjs"),
      "--url", url,
      "--wait", cap.wait,
      "--out", png,
      "--diag", diag,
      "--vw", String(cap.vw),
      "--vh", String(cap.vh),
      "--timeout", "20000",
    ];
    try {
      const argsForCap = [...args];
      if (cap.click) argsForCap.push("--click", cap.click);
      if (cap.wait2) argsForCap.push("--wait2", cap.wait2);
      execFileSync("node", argsForCap, { encoding: "utf8", timeout: 120000 });
      // Brief §12: a 4x crop of the delivered mascot, so eyes, mouth,
      // cheeks, star and sharpness can actually be inspected.
      if (cap.mascot) {
        const rect = mascotRectOf(diag, cap.mascot);
        if (rect) {
          const out = resolve(OUT, `${cap.mascotId}.png`);
          cropPng(png, rect, out, 4);
          console.log(`captured ${cap.mascotId} -> ${out}`);
        } else {
          console.warn(`no mascot rect for ${cap.id} (${cap.mascot})`);
        }
      }
      // Crop to the real surface element when the viewport is larger
      // than it (compact capsule; keeps the golden images canonical).
      if (cap.crop) {
        const rect = cropRectOf(diag, cap.crop);
        if (rect) cropPng(png, rect, png);
      }
      console.log(`captured ${cap.id} -> ${png}`);
    } catch (e) {
      failures += 1;
      console.error(`FAILED ${cap.id}: ${String(e.stdout ?? e).slice(0, 240)}`);
    }
  }
  b.kill();
  process.exit(failures ? 1 : 0);
});

/** Surface rect: harness writes the surface bounding boxes only for the
 *  statechip; for #collapsed/#widget we re-ask via a tiny CDP probe is
 *  overkill — the widget CSS places both surfaces at the body origin,
 *  so measure the DOM once through the diag eval hook instead. */
function cropRectOf(diagPath, elementId) {
  try {
    const d = JSON.parse(readFileSync(diagPath, "utf8"));
    const rect = d?.eval?.[elementId === "collapsed" ? "compactRect" : "expandedRect"] ?? d?.surfaceRects?.[elementId];
    if (rect && rect.w > 0) {
      // Page rects are relative to the viewport the harness captured:
      // return them directly (cropPng works in screenshot pixels).
      return { x: Math.round(rect.x ?? 0), y: Math.round(rect.y ?? 0), w: rect.w, h: rect.h };
    }
  } catch { /* fall through to default */ }
  // Compact fallback: the mascot capsule sits top-left inside the
  // canonical 88×88 window (76×76 surface).
  if (elementId === "collapsed") return { x: 0, y: 0, w: 76, h: 76 };
  return null;
}

/** Mascot element rect reported by the page (the delivered asset box). */
function mascotRectOf(diagPath, key) {
  try {
    const d = JSON.parse(readFileSync(diagPath, "utf8"));
    const rect = d?.eval?.[key];
    if (rect && rect.w > 0) return { x: Math.round(rect.x ?? 0), y: Math.round(rect.y ?? 0), w: rect.w, h: rect.h };
  } catch { /* no mascot crop */ }
  return null;
}

/** PNG crop (optional integer zoom) via the analysis decoder + encoder. */
function cropPng(src, rect, dst, zoom = 1) {
  const img = decodePng(src);
  const x0 = Math.max(0, Math.min(img.width - 1, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.round(rect.y)));
  const w = Math.max(1, Math.min(img.width - x0, Math.round(rect.w)));
  const h = Math.max(1, Math.min(img.height - y0, Math.round(rect.h)));
  const ow = w * zoom;
  const oh = h * zoom;
  const out = new Uint8Array(ow * oh * 4).fill(255);
  for (let y = 0; y < oh; y += 1) {
    for (let x = 0; x < ow; x += 1) {
      // Nearest neighbour: the 4x crop must show the DELIVERED pixels
      // as they are, never an interpolated/recoloured version.
      const si = ((y0 + Math.floor(y / zoom)) * img.width + (x0 + Math.floor(x / zoom))) * 4;
      const di = (y * ow + x) * 4;
      out[di] = img.pixels[si];
      out[di + 1] = img.pixels[si + 1];
      out[di + 2] = img.pixels[si + 2];
      out[di + 3] = 255;
    }
  }
  writeFileSync(dst, encodePng(ow, oh, Buffer.from(out.buffer, out.byteOffset, out.byteLength)));
}
b.on("exit", (c) => {
  if (!started) { console.error("bridge exited early:", c, buf.slice(0, 400)); process.exit(1); }
});
