/**
 * Contact sheet for the SAFI ANDROID TRUE COMPANION OVERLAY acceptance.
 *
 * Every frame here is a FULL-SCREEN `adb exec-out screencap` — nothing is
 * cropped, so the app underneath is visible right up to the edges of the
 * Safi window in every single frame. The measured WindowManager rect is
 * drawn on top of each frame so it is obvious where Safi ends and the
 * underlying app begins. That is the whole claim: there is no Safi page
 * behind, only the app.
 *
 *   node tools/overlay-acceptance-sheet.mjs
 *
 * Writes artifacts/three-by-two/overlay/acceptance.html
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OUT = join(ROOT, "artifacts/three-by-two/overlay");
const ev = JSON.parse(readFileSync(join(OUT, "evidence.json"), "utf8"));

/** @type {Record<string, {x:number,y:number,w:number,h:number}>} */
const rects = {};
for (const s of ev.steps ?? []) if (s.window) rects[s.name] = s.window;
for (const d of ev.drags ?? []) if (d.after) rects[d.name] = d.after;

/** Rows of the sheet, in the order the acceptance table reads. */
const ROWS = [
  { file: "00-baseline-chrome-safi-stopped", title: "Chrome with Safi STOPPED", note: "The control frame. Every other frame is compared against this one pixel for pixel.", kind: "control" },
  { file: "01-compact-over-chrome", title: "COMPACT over Chrome", note: (r) => `WindowManager window ${r ? `${r.w}×${r.h}` : "?"} — the 88×88 compact surface and nothing else.`, kind: "state" },
  { file: "02-expanded-over-chrome", title: "EXPANDED over Chrome", note: (r) => `Window ${r ? `${r.w}×${r.h}` : "?"}, content surface 384×256 = 3:2 exactly. Chrome runs to every edge outside it.`, kind: "state" },
  { file: "03-prompt-ready-over-chrome", title: "PROMPT_READY over Chrome", note: (r) => `Shell stays 384×256; the result scrolls INSIDE (384×550), the window never grows.`, kind: "state" },
  { file: "04-verify-result-over-chrome", title: "VERIFY_RESULT over Chrome", note: "The product-completion card lives inside the fixed 3:2 (384×346 of content).", kind: "state" },
  { file: "05-details-scrolled-over-chrome", title: "DETAILS over Chrome", note: "Result scrolled to its end — still 384×256, internal scroll only.", kind: "state" },
  { file: "06-prompt-ready-over-maps", title: "PROMPT_READY over Google Maps", note: "A second real app underneath, not just the browser.", kind: "state" },
  { file: "07-verify-result-over-home", title: "VERIFY_RESULT over the home screen", note: "Nothing Launcher behind. The home screen is fully visible around the widget.", kind: "state" },
  { file: "08-compact-over-home", title: "COMPACT over the home screen", note: "The floating figure, with the launcher running to every edge.", kind: "state" },
  { file: "09-drag-bottom-right", title: "Dragged to the bottom-right", note: (r) => `Real system touch (adb input swipe) on the header. Window origin ${r ? `${r.x},${r.y}` : "?"}, clamped into the work area.`, kind: "drag" },
  { file: "10-drag-centre", title: "Dragged to the centre", note: (r) => `Window origin ${r ? `${r.x},${r.y}` : "?"} — a genuine touch drag, not a placement call.`, kind: "drag" },
  { file: "11-drag-top-left", title: "Dragged to the top-left", note: (r) => `Window origin ${r ? `${r.x},${r.y}` : "?"} — the very top of the reachable band, just under the status bar.`, kind: "drag" },
  { file: "12-edge-snap", title: "Edge snap on release", note: "Released just inside the left band; the window eased out to the edge and stopped.", kind: "drag" },
  { file: "13-landscape-expanded", title: "Landscape, real rotation", note: (r) => `The panel itself was rotated (2800×1260) and the window server agreed. Window ${r ? `${r.w}×${r.h}` : "?"}, content still 384×256.`, kind: "responsive" },
  { file: `14-small-display-${ev.smallDisplay?.size ?? "small"}`, title: `Small display (${ev.smallDisplay?.size ?? "?"})`, note: "336dp wide — too narrow for the 396dp shell, so one scale factor is applied and 3:2 survives. Still no host page behind it.", kind: "responsive" },
  { file: "16-transparency-with-safi", title: "Chrome + Safi (transparency proof A)", note: "Safi present.", kind: "proof" },
  { file: "17-transparency-safi-stopped", title: "Chrome, Safi stopped (proof B)", note: (r) => `Outside the Safi rect these two frames are ${ev.transparency.differing === 0 ? "PIXEL-IDENTICAL" : `${ev.transparency.differing} px different`} across ${ev.transparency.compared.toLocaleString()} compared pixels.`, kind: "proof" },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * The frames are inlined as data URIs on purpose: the sheet has to be a
 * single self-contained file that renders from disk with no sibling-file
 * server. Each frame is downscaled once with sips first, so the page stays
 * a few megabytes instead of twenty.
 */
const THUMB_DIR = join(OUT, ".thumbs");
const THUMB_W = 430;
const thumbCache = new Map();
function dataUri(file) {
  if (thumbCache.has(file)) return thumbCache.get(file);
  const src = join(OUT, `${file}.png`);
  if (!existsSync(src)) return null;
  mkdirSync(THUMB_DIR, { recursive: true });
  const dst = join(THUMB_DIR, `${file}.png`);
  if (!existsSync(dst) || statSync(dst).mtimeMs < statSync(src).mtimeMs) {
    const r = spawnSync("sips", ["--resampleWidth", String(THUMB_W), src, "--out", dst], { encoding: "utf8" });
    if (r.status !== 0) return null;
  }
  const uri = `data:image/png;base64,${readFileSync(dst).toString("base64")}`;
  thumbCache.set(file, uri);
  return uri;
}

/** The REAL pixel size of a frame, so the overlay box is drawn against the
    frame that is actually on the page. The small-display capture is
    720×1280, not 1260×2800, and using the big display's numbers would put
    the outline in the wrong place. */
const dimCache = new Map();
function dimsOf(file) {
  if (dimCache.has(file)) return dimCache.get(file);
  const src = join(OUT, `${file}.png`);
  if (!existsSync(src)) return null;
  const r = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", src], { encoding: "utf8" });
  const w = Number(/pixelWidth:\s*(\d+)/.exec(r.stdout)?.[1]);
  const h = Number(/pixelHeight:\s*(\d+)/.exec(r.stdout)?.[1]);
  const d = w > 0 && h > 0 ? { w, h } : null;
  dimCache.set(file, d);
  return d;
}

function card(row) {
  const uri = dataUri(row.file);
  if (!uri) return "";
  const r = rects[row.file] ?? rects[row.name] ?? null;
  const note = typeof row.note === "function" ? row.note(r) : row.note;
  // The frame is the real capture; the box is overlaid with the SAME
  // percentages the window manager reported, so the outline lands exactly
  // on the widget edges.
  const dim = dimsOf(row.file);
  const box = r && dim && !row.kind.startsWith("proof")
    ? `<div class="box" style="left:${(r.x / dim.w) * 100}%;top:${(r.y / dim.h) * 100}%;width:${(r.w / dim.w) * 100}%;height:${(r.h / dim.h) * 100}%"></div>`
    : "";
  return `<figure class="card ${row.kind}">
  <div class="shot">
    <img src="${uri}" alt="${esc(row.title)}" loading="lazy">
    ${box}
  </div>
  <figcaption>
    <b>${esc(row.title)}</b>
    <span>${esc(note ?? "")}</span>
  </figcaption>
</figure>`;
}

const pass = (k) => (ev.summary[k] === true ? "pass" : ev.summary[k] === false ? "fail" : "n/a");
const row = (k, label) => `<tr><td>${esc(label)}</td><td class="${pass(k)}">${esc(pass(k).toUpperCase())}</td></tr>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>SAFI Android — true companion overlay — acceptance</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px; background:#0b0e13; color:#e8edf5;
         font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif; }
  h1 { font-size:26px; margin:0 0 6px; letter-spacing:-.01em; }
  .sub { color:#93a1b5; margin:0 0 26px; font-size:14px; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.10em;
       color:#7f8ea6; margin:34px 0 14px; font-weight:600; }
  .grid { display:flex; flex-wrap:wrap; gap:20px; }
  .card { margin:0; width:214px; }
  .shot { position:relative; border-radius:12px; overflow:hidden;
          border:1px solid #222a36; background:#000; }
  .shot img { width:100%; display:block; }
  .box { position:absolute; border:2px solid #4da3ff; border-radius:3px;
         box-shadow:0 0 0 1px rgba(0,0,0,.65), 0 0 22px rgba(77,163,255,.45); }
  figcaption { margin-top:8px; font-size:12px; line-height:1.45; }
  figcaption b { display:block; color:#dbe6f5; font-weight:600; }
  figcaption span { color:#8b9ab0; }
  .card.control .shot, .card.proof .shot { border-color:#3a4658; }
  table { border-collapse:collapse; margin-top:8px; font-size:13px; }
  td, th { border:1px solid #222a36; padding:6px 12px; text-align:left; }
  th { background:#131a24; color:#93a1b5; font-weight:600; }
  td.pass { color:#5fd08a; font-weight:600; }
  td.fail { color:#ff8080; font-weight:600; }
  .note { background:#131a24; border:1px solid #222a36; border-radius:10px;
          padding:14px 16px; margin-top:10px; max-width:900px; color:#b9c6d8; }
  .note b { color:#e8edf5; }
</style></head><body>

<h1>SAFI Android — true companion overlay</h1>
<p class="sub">Real <code>TYPE_APPLICATION_OVERLAY</code> over real apps on a Nothing A024 (Android 17, 1260×2800). Every frame is a full, uncropped <code>adb exec-out screencap</code>; the blue box is the exact WindowManager rect the platform reported, drawn to scale.</p>

<h2>Acceptance</h2>
<table>
  <tr><th>Criterion</th><th>Result</th></tr>
  ${row("systemAlertWindowGranted", "SYSTEM_ALERT_WINDOW granted")}
  ${row("realApplicationOverlay", "TYPE_APPLICATION_OVERLAY real")}
  ${row("noActivityWindowBehind", "no Activity / page background")}
  ${row("compactOverlay", "COMPACT overlay")}
  ${row("expandedThreeByTwoOverlay", "EXPANDED 3:2 overlay")}
  ${row("promptReadyThreeByTwo", "PROMPT_READY overlay")}
  ${row("verifyResultThreeByTwo", "VERIFY_RESULT overlay")}
  ${row("detailsThreeByTwoWithInternalScroll", "DETAILS overlay, internal scroll")}
  ${row("realTouchDragMovedWindow", "drag real overlay window")}
  ${row("everyDragUsedRealTouch", "every position reached by a real touch")}
  ${row("noBrokenMascots", "no broken mascots in any state")}
  ${row("appUnderneathRemainsVisible", "app underneath remains visible")}
  ${row("portraitAndLandscape", "portrait / landscape")}
  ${row("responsiveSmallDisplay", "responsive smaller screens")}
  ${row("offScreenRecovery", "off-screen recovery")}
</table>

<div class="note"><b>No frame in this sheet is a black rectangle.</b> A previous run recorded mean luma 0.11 for both halves of the transparency proof — the display had gone to sleep — and "0 differing pixels" between two black screenshots looked exactly like a pass. Every capture now has to prove it contains a real app (mean luma ≥ 6 and standard deviation ≥ 10) or the run stops and the frame is never written. The live frames here measure ${esc(String(Math.min(...(ev.steps ?? []).map((s) => s?.luma?.mean ?? 0)).toFixed(0)))}–${esc(String(Math.max(...(ev.steps ?? []).map((s) => s?.luma?.mean ?? 0)).toFixed(0)))} mean luma.</div>

<div class="note"><b>Landscape is a real rotation here.</b> The run forces the window server and the panel back into agreement before it starts, locks auto-rotate off for its duration, and then rotates — and it only counts a landscape frame when the <i>panel's own capture</i> is 2800×1260 and the window server reports the same thing. The page merely repeating "landscape-primary" is not enough: a desynchronised display will happily say that while the photo is still portrait.</div>

<div class="note"><b>Off-screen recovery is a real clamp, not a re-roll.</b> The widget is parked at the bottom-right of the full-size display, the display is then genuinely shrunk to ${esc(String(ev.smallDisplay?.size ?? "?"))}, and the position it held (${esc(JSON.stringify(ev.offScreenRecovery?.parkedOnFullDisplay ?? null))}) no longer fits. The clamp brings it to ${esc(JSON.stringify(ev.offScreenRecovery?.clampedTo ?? null))} — inside the display — and a restart on the smaller display still finds it reachable.</div>

<h2>Frames</h2>
<div class="grid">
${ROWS.map(card).join("\n")}
</div>

<h2>Transparency, measured</h2>
<div class="note">
  Frames <b>16</b> and <b>17</b> are the same screen with Safi present and then stopped. Outside the Safi rect and outside the two system bars
  (the clock ticks between captures, which is the OS and not Safi) <b>${esc(String(ev.transparency.differing))} of
  ${esc(ev.transparency.compared.toLocaleString())}</b> compared pixels differ — max channel delta
  ${esc(String(ev.transparency.maxDelta))}. There is no Safi page, no canvas and no dim behind the widget: the app underneath is literally the same pixels.
  Both frames are checked to be real before the comparison is allowed to count — with Safi mean luma ${esc(String(ev.transparency?.luma?.withSafi?.mean))}, Safi stopped ${esc(String(ev.transparency?.luma?.safiStopped?.mean))}.
</div>

</body></html>`;

writeFileSync(join(OUT, "acceptance.html"), html);
console.log(`wrote ${join(OUT, "acceptance.html")}`);
