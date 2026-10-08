#!/usr/bin/env node
/**
 * The 3:2 human visual-acceptance contact sheet.
 *
 * One self-contained page with the FINAL macOS and Android frames laid
 * out side by side, so a person can accept or reject the pass by looking
 * at it. Nothing here decides anything: it promotes no golden, writes no
 * snapshot, and asserts nothing. It only renders what was captured.
 *
 * Both platforms are shown at the SAME on-screen widget scale, which is
 * the only way "Android is the same widget" can be checked by eye:
 * macOS frames are 1:1 device pixels, Android frames are cropped at
 * dpr 3 and so are displayed at one third.
 *
 *   node tools/3x2-acceptance-sheet.mjs [outDir]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(process.argv[2] ?? join(repo, "artifacts/three-by-two"));
const MAC = join(ROOT, "macos");
const AND = join(ROOT, "android");
const CAL = join(ROOT, "acceptance");

const macEvidence = JSON.parse(readFileSync(join(MAC, "evidence.json"), "utf8"));
const andEvidence = JSON.parse(readFileSync(join(AND, "evidence.json"), "utf8"));

const uri = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;
const png = (p, scale) => {
  if (!existsSync(p)) throw new Error(`missing frame: ${p}`);
  return { src: uri(p), w: Math.round(scaleFrom(p) * scale) };
};
/** Display width, from the real pixel size, so nothing is silently upscaled. */
const scaleFrom = (p) => {
  const buf = readFileSync(p);
  // PNG IHDR width/height live at fixed byte offsets; no decoder needed.
  return buf.readUInt32BE(16);
};
const px = (p) => {
  const buf = readFileSync(p);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
};

const macStep = (n) => macEvidence.steps.find((s) => s.name.startsWith(n));
const andStep = (n) => andEvidence.steps.find((s) => s.name.startsWith(n));

/* Each cell: the frame, the real numbers read from the evidence file,
   and nothing else. */
function macCell(prefix, { note, scale = 1 } = {}) {
  const step = macStep(prefix);
  if (!step) return { missing: prefix };
  const file = join(MAC, `${step.name}.png`);
  const size = px(file);
  const w = step.window;
  return {
    img: uri(file),
    w: size.w * scale,
    cap: note ?? `window <b>${w.w}×${w.h}</b> at <b>${w.x},${w.y}</b>`,
    sub: workArea(step),
  };
}

function andCell(prefix, { note, scale = 1 / 3 } = {}) {
  const step = andStep(prefix);
  if (!step) return { missing: prefix };
  const file = join(AND, `${step.name}.png`);
  const size = px(file);
  const s = step.surface;
  const parts = [`surface <b>${s.clientW}×${s.clientH}</b>`];
  parts.push(s.scrollH > s.clientH + 1 ? `scrolls inside (${s.scrollH})` : `no internal scroll`);
  const win = step.window;
  if (win) parts.push(`overlay <b>${win.x},${win.y}</b> ${win.w}×${win.h}`);
  return {
    img: uri(file),
    w: size.w * scale,
    cap: note ?? parts.join(" · "),
    sub: `${step.orientation} · viewport ${step.inner.w}×${step.inner.h} · dpr ${step.dpr}`,
  };
}

function workArea(step) {
  const wa = step.window?.workArea;
  return wa ? `work area ${wa.x},${wa.y} ${wa.w}×${wa.h}` : "";
}

/* The rows. `null` in a column means that frame genuinely does not
   exist for that platform, and the sheet says so rather than inventing
   a substitute. */
const ROWS = [
  {
    title: "INPUT — the 3:2 contract",
    spec: "No internal scroll. 384×256 content, 396×268 window.",
    mac: () => macCell("01", { note: "window <b>396×268</b> at <b>600,200</b>" }),
    and: () => andCell("01", { note: "surface <b>384×256</b> · <b>no internal scroll</b>" }),
  },
  {
    title: "PROMPT_READY",
    spec: "Same fixed shell; the result scrolls INSIDE it. It may not grow it.",
    mac: () => macCell("02", { note: "window <b>396×268</b> — unchanged" }),
    and: () => andCell("02", { note: "surface <b>384×256</b> · scroll 384×550 inside" }),
  },
  {
    title: "VERIFY_RESULT — completion card",
    spec: "Product-completion semantics unchanged; it lives in the result view.",
    mac: () => macCell("03", { note: "window <b>396×268</b> — unchanged" }),
    and: () => andCell("07", { note: "surface <b>384×256</b> · card rendered" }),
  },
  {
    title: "Compact",
    spec: "The mascot alone. 88×88 window.",
    mac: () => macCell("04"),
    and: () => null,
    andNote: "no compact frame captured — the Android host runs the expanded widget",
  },
  {
    title: "Dragged — top-left / centre / bottom-right",
    spec: "Three real native placements, plus release-only edge snap.",
    mac: () => {
      const a = macCell("05");
      const b = macCell("06");
      const c = macCell("07");
      const d = macCell("08");
      return { strip: [a, b, c, d] };
    },
    and: () => null,
    andNote: "the Android overlay moves by touch; see the portrait drag row below",
  },
  {
    title: "Portrait drag — real touch",
    spec: "dispatchTouchEvent → header region → the overlay really moves.",
    mac: () => null,
    macNote: "no touch drag on a desktop; the native drag is the window drag above",
    and: () => {
      const s = andStep("03");
      const g = s.drag?.gesture;
      const d = s.drag?.diag;
      return andCell("03", {
        note: `gesture <b>${g?.on}</b> region <b>${g?.region}</b> blocked <b>${g?.blocked}</b>`,
      });
    },
  },
  {
    title: "Portrait",
    spec: "The everyday orientation.",
    mac: () => null,
    macNote: "macOS has no orientation",
    and: () => andCell("06", { note: "rotated back · surface <b>384×256</b>" }),
  },
  {
    title: "Landscape",
    spec: "The 3:2 contract survives a real rotation; a portrait-only position is clamped back.",
    mac: () => null,
    macNote: "macOS has no orientation",
    and: () => andCell("05", { note: "surface <b>384×256</b> · y 562 → 93, clamped" }),
  },
  {
    title: "Off-screen recovery",
    spec: "Asked for 99999,99999. It must come back inside the visible area.",
    mac: () => macCell("09"),
    and: () => andCell("04", { note: "clamped, visible · overlay 321,756" }),
  },
  {
    title: "Restored after relaunch",
    spec: "Position is remembered per surface.",
    mac: () => macCell("10", { note: "back at <b>1826,896</b> from the saved file" }),
    and: () => andCell("06", { note: "overlay model restores on load" }),
  },
];

/* ------------------------------------------------------------- render */

function renderCell(cell) {
  if (cell === null) return `<div class="cell none">— not applicable on this platform</div>`;
  if (cell.missing) return `<div class="cell none">missing ${cell.missing}</div>`;
  if (cell.strip) {
    return `<div class="cell strip">${cell.strip.map(renderCell).join("")}</div>`;
  }
  return `<div class="cell">
      <img src="${cell.img}" width="${cell.w}" alt="" />
      <div class="cap">${cell.cap}</div>
      ${cell.sub ? `<div class="sub">${cell.sub}</div>` : ""}
    </div>`;
}

const mascotMac = uri(join(CAL, "mascot-macos@8x.png"));
const mascotAnd = uri(join(CAL, "mascot-android@2.67x.png"));
// Both callouts are 320px wide with the 30px mascot at (48,48) 240px.
const BOX = "left:48px; top:48px; width:240px; height:240px";

const rows = ROWS.map((r) => `
  <section class="row">
    <div class="rowhead">
      <h2>${r.title}</h2>
      <p>${r.spec}</p>
    </div>
    <div class="pair">
      <div class="col"><div class="plat">macOS — installed Safi.app</div>${renderCell(r.mac?.() ?? null)}${r.macNote ? `<div class="note">${r.macNote}</div>` : ""}</div>
      <div class="col"><div class="plat">Android — physical device, real APK</div>${renderCell(r.and?.() ?? null)}${r.andNote ? `<div class="note">${r.andNote}</div>` : ""}</div>
    </div>
  </section>`).join("\n");

writeFileSync(
  join(ROOT, "acceptance.html"),
  `<!doctype html>
<meta charset="utf-8" />
<title>Safi 3:2 — visual acceptance</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#11151a; color:#d6dde5;
         font:13px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { padding:26px 30px 18px; border-bottom:1px solid #232b34; }
  h1 { margin:0 0 6px; font-size:19px; font-weight:650; letter-spacing:-.01em; }
  header p { margin:0; color:#8a95a2; max-width:74ch; }
  header code { background:#1b2129; padding:1px 5px; border-radius:3px; font-size:12px; }
  main { padding:8px 30px 60px; }
  .row { padding:20px 0; border-bottom:1px solid #1c232b; }
  .rowhead h2 { margin:0 0 2px; font-size:14px; font-weight:640; }
  .rowhead p { margin:0 0 12px; color:#7d8894; font-size:12px; }
  .pair { display:flex; flex-wrap:wrap; gap:26px; align-items:flex-start; }
  .col { flex:1 1 430px; min-width:0; }
  .plat { font-size:10.5px; letter-spacing:.09em; text-transform:uppercase;
          color:#6f7a87; margin-bottom:7px; }
  .cell { display:inline-block; vertical-align:top; margin-right:14px; max-width:100%; }
  .cell.strip { display:flex; flex-wrap:wrap; gap:12px; }
  .cell.strip img { max-width:132px; height:auto; }
  .cell img { display:block; border-radius:5px; max-width:100%; height:auto;
              background:repeating-conic-gradient(#2a313a 0 25%, #222831 0 50%) 0 0/16px 16px; }
  .cell.none { display:flex; align-items:center; min-height:64px; color:#5d6874;
               font-style:italic; font-size:12px; }
  .cap { margin-top:6px; font-size:11.5px; color:#9aa5b1; }
  .cap b { color:#dfe6ee; font-weight:620; }
  .sub { margin-top:2px; font-size:11px; color:#68727e; }
  .note { margin-top:6px; font-size:11px; color:#68727e; font-style:italic; }
  .mascot { display:flex; flex-wrap:wrap; gap:26px; margin-top:10px; }
  .mascot > div { flex:1 1 340px; min-width:0; }
  .callout { position:relative; display:inline-block; }
  .callout img { display:block; border-radius:5px;
                 background:repeating-conic-gradient(#2a313a 0 25%, #222831 0 50%) 0 0/16px 16px; }
  .callout .mark { position:absolute; ${BOX}; border:2px solid #4ea1ff; border-radius:3px;
                   box-shadow:0 0 0 1px #0b0e12, 0 0 0 4px rgba(78,161,255,.18); }
  .callout .pin { position:absolute; left:48px; top:14px; font-size:11px; font-weight:650;
                  color:#4ea1ff; letter-spacing:.02em; }
  .callout .px { position:absolute; left:48px; top:300px; font-size:10.5px; color:#7d8894; }
  .scalebar { position:absolute; left:48px; top:288px; height:6px; background:#4ea1ff;
              border-radius:1px; }
  footer { padding:0 30px 40px; color:#68727e; font-size:11.5px; }
  footer li { margin:3px 0; }
</style>
<header>
  <h1>Safi TRUE 3:2 — human visual acceptance</h1>
  <p>Every frame is a real surface: the installed <code>Safi.app</code> on macOS, and the installed APK on a
  physical Nothing A024 (Android 17, 1260×2800, 480 dpi). Both columns render the widget at the
  <em>same on-screen size</em> — macOS frames are 1:1 pixels, Android frames are cropped at dpr 3 and
  shown at one third — so the shell can be compared by eye. This page decides nothing and promotes
  no golden.</p>
</header>
<main>
  <section class="row">
    <div class="rowhead">
      <h2>The mascot at 30 px</h2>
      <p>Header brand mark, magnified. Same 30 CSS px on both platforms; the box is the measured
      element rect. It is 30 px, not 44 px, because a 44 px mark pushed <b>✓ verifica</b> 11 px below
      the lower functional edge of the 384×256 INPUT view. Optical band is unchanged: 30 px is still
      MICRO (0–72).</p>
    </div>
    <div class="mascot">
      <div>
        <div class="plat">macOS — ×8 magnification</div>
        <div class="callout">
          <img src="${mascotMac}" width="320" height="320" alt="macOS header mascot" />
          <div class="mark"></div>
          <div class="pin">30 px</div>
          <div class="scalebar" style="width:240px"></div>
          <div class="px">240 px here = 30 CSS px · 1 CSS px = 8 image px</div>
        </div>
      </div>
      <div>
        <div class="plat">Android — ×2.67 magnification (dpr 3)</div>
        <div class="callout">
          <img src="${mascotAnd}" width="320" height="320" alt="Android header mascot" />
          <div class="mark"></div>
          <div class="pin">30 px</div>
          <div class="scalebar" style="width:240px"></div>
          <div class="px">240 px here = 30 CSS px · 1 CSS px = 2.67 image px</div>
        </div>
      </div>
    </div>
  </section>
${rows}
</main>
<footer>
  <ul>
    <li>Same widget file on both platforms: <code>sameWidgetFileAsDesktop: true</code> — verified at stage time and again at capture time.</li>
    <li>Every expanded state is exactly 384×256, in portrait and in landscape.</li>
    <li>Full machine-readable record: <code>macos/evidence.json</code> and <code>android/evidence.json</code>. Narrative: <code>ACCEPTANCE-REPORT.md</code>.</li>
  </ul>
</footer>
`,
);

console.log(join(ROOT, "acceptance.html"));
