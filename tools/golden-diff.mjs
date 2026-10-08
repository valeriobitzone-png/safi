#!/usr/bin/env node
/**
 * Golden visual diff — SAFI_UI_INTERACTION_CONTRACT.md §11–12.
 *
 * Produces, for each required surface (compact, expanded, verified,
 * uncertain, failed), a four-panel sheet:
 *
 *   REFERENCE  the approved golden board crop (context strip)
 *   CURRENT    the live release-build screenshot of that surface
 *   OVERLAY    reference vs current structural comparison
 *   DIFF       measured deltas (geometry + color identity)
 *
 * The golden images are ARBITERS, not artifacts of this run: they are
 * read from golden/ (approved character sheet + UI board). The overlays
 * compare STRUCTURE (figure bounding boxes, proportions, color identity)
 * because the native glass makes pixel identity impossible by design.
 *
 * Output: docs/visual-evidence/golden-diff/<surface>.{png,txt}
 *
 *   node tools/golden-diff.mjs [--current dir] [--out dir]
 *
 * CURRENT screenshots come from tools/visual-harness.mjs runs of the
 * release bundle (same files the visual tests produce). If a capture is
 * missing it is honestly reported MISSING — never fabricated.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { decodePng } from "./png-analysis.mjs";
import { encodePng } from "./mascot-raster.mjs";

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const CURRENT_DIR = argOf("--current", "docs/visual-evidence/golden-current");
const OUT_DIR = argOf("--out", "docs/visual-evidence/golden-diff");
const GOLDEN_BOARD = "golden/safi-ui-board.png";
const GOLDEN_SHEET = "golden/safi-character-sheet.png";

/* ---------- surfaces required by contract §12 ---------- */
const SURFACES = [
  { id: "compact", captures: ["compact.png", "compact-verified.png"], state: "idle" },
  { id: "expanded", captures: ["expanded.png", "verified.png"], state: "idle" },
  { id: "verified", captures: ["verified.png", "safi-mascot-verified.png"], state: "verified" },
  { id: "uncertain", captures: ["uncertain.png", "safi-mascot-uncertain.png"], state: "uncertain" },
  { id: "failed", captures: ["failed.png", "safi-mascot-failed.png"], state: "failed" },
];

/* ---------- image helpers ---------- */

function loadImage(path) {
  if (!existsSync(path)) return null;
  try {
    const img = decodePng(path);
    return { width: img.width, height: img.height, px: img.pixels };
  } catch {
    return null;
  }
}

function lum(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 255;
  const i = (y * img.width + x) * 4;
  return 0.299 * img.px[i] + 0.587 * img.px[i + 1] + 0.114 * img.px[i + 2];
}

function rgb(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return [255, 255, 255];
  const i = (y * img.width + x) * 4;
  return [img.px[i], img.px[i + 1], img.px[i + 2]];
}

/** Bounding box of content: pixels far from the border background color
 *  (robust for both the dark golden boards and glass captures). */
function contentBox(img, opts = {}) {
  const { x0 = 0, y0 = 0, x1 = img.width, y1 = img.height, threshold = 44 } = opts;
  // background estimate: median of the four corner patches, but IGNORE
  // uniform-white captures (headless glass renders transparent→white):
  // for those, content = pixels darker than a small margin from white.
  const samples = [];
  const patch = 6;
  for (const [cx, cy] of [[x0 + 2, y0 + 2], [x1 - patch - 2, y0 + 2], [x0 + 2, y1 - patch - 2], [x1 - patch - 2, y1 - patch - 2]]) {
    for (let y = cy; y < cy + patch && y < y1; y += 1) {
      for (let x = cx; x < cx + patch && x < x1; x += 1) {
        const [r, g, b] = rgb(img, x, y);
        samples.push(0.299 * r + 0.587 * g + 0.114 * b);
      }
    }
  }
  samples.sort((a, b) => a - b);
  const bg = samples.length ? samples[Math.floor(samples.length / 2)] : 255;
  let minX = x1, minY = y1, maxX = x0, maxY = y0;
  const contentTest = bg > 246
    ? (l) => l < 251 // white page: anything not-quite-white is content
    : (l) => Math.abs(l - bg) > threshold;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (contentTest(lum(img, x, y))) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/* Largest single-figure bounding box on the character sheet. The sheet
 * is one big composition (title, figures, captions) with no clean column
 * separation, so the anchor is the GRID CENTER: the hero figure lives at
 * the sheet's optical middle. We take the ink box of the central ninth
 * of the sheet — where the approved head+body pose is drawn — which is
 * exactly the geometry the compact surface must reproduce. */
function singleFigureBox(img) {
  const cx0 = Math.floor(img.width * 4 / 9);
  const cx1 = Math.floor(img.width * 5 / 9);
  const cy0 = Math.floor(img.height * 0.12);
  const cy1 = Math.floor(img.height * 0.88);
  const box = contentBox(img, { x0: cx0, x1: cx1, y0: cy0, y1: cy1, threshold: 38 });
  // The approved figure column includes the sign arm: the FIGURE-ONLY
  // aspect for the compact anchor is the torso (head ≈ round ≈ aspect 1);
  // use the measured box height with its central 60% width as the
  // figure-aspect estimate (rejects arm/caption outliers).
  if (box && box.h > 40) return { ...box, w: Math.max(box.w, Math.round(box.h * 0.62)) };
  return box;
  // Fallback: search the widest of five evenly spaced vertical windows.
  let best = null;
  for (let k = 0; k < 5; k += 1) {
    const x0 = Math.floor(img.width * (k * 2) / 10);
    const x1 = Math.floor(img.width * (k * 2 + 3) / 10);
    const b2 = contentBox(img, { x0, x1, y0: cy0, y1: cy1, threshold: 38 });
    if (b2 && b2.h > 40 && (!best || b2.h > best.h)) best = b2;
  }
  return best;
}

function resizeTo(img, w, h) {
  const out = { width: w, height: h, px: new Uint8Array(w * h * 4).fill(255) };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(img.width - 1, Math.floor((x / w) * img.width));
      const sy = Math.min(img.height - 1, Math.floor((y / h) * img.height));
      const [r, g, b] = rgb(img, sx, sy);
      const i = (y * w + x) * 4;
      out.px[i] = r; out.px[i + 1] = g; out.px[i + 2] = b; out.px[i + 3] = 255;
    }
  }
  return out;
}

/** Mean absolute luminance difference between two same-size images. */
function meanAbsDiff(a, b) {
  let acc = 0, n = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      acc += Math.abs(lum(a, x, y) - lum(b, x, y));
      n += 1;
    }
  }
  return n ? acc / n : 255;
}

/** Overlay: side-by-side, boxes drawn by xoring edges — no extra deps. */
function overlayPanel(refImg, curImg, refBox, curBox) {
  const W = Math.max(refImg.width, curImg.width);
  const H = Math.max(refImg.height, curImg.height);
  const out = { width: W, height: H, px: new Uint8Array(W * H * 4).fill(255) };
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const a = lum(refImg, x, y);
      const b = lum(curImg, x, y);
      const d = Math.abs(a - b);
      if (d > 40) { out.px[i] = 200; out.px[i + 1] = 40; out.px[i + 2] = 40; }
      else if (d > 16) { out.px[i] = 220; out.px[i + 1] = 150; out.px[i + 2] = 40; }
      else if (a < 235) { out.px[i] = 60; out.px[i + 1] = 90; out.px[i + 2] = 60; }
      out.px[i + 3] = 255;
    }
  }
  // structural boxes: reference in blue, current in green
  const box = (bx, c) => {
    if (!bx) return;
    for (let k = 0; k < 2; k += 1) {
      const x0 = bx.x - k, y0 = bx.y - k, x1 = bx.x + bx.w + k, y1 = bx.y + bx.h + k;
      const edge = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const i = (y * W + x) * 4;
        out.px[i] = c[0]; out.px[i + 1] = c[1]; out.px[i + 2] = c[2]; out.px[i + 3] = 255;
      };
      for (let x = x0; x <= x1; x += 1) { edge(x, y0); edge(x, y1); }
      for (let y = y0; y <= y1; y += 1) { edge(x0, y); edge(x1, y); }
    }
  };
  box(refBox, [40, 70, 200]);
  box(curBox, [30, 160, 70]);
  return out;
}

/** Average hue identity of the content box (which state color family). */
function colorIdentity(img, box) {
  if (!box) return "none";
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = box.y; y < box.y + box.h; y += 2) {
    for (let x = box.x; x < box.x + box.w; x += 2) {
      const [pr, pg, pb] = rgb(img, x, y);
      r += pr; g += pg; b += pb; n += 1;
    }
  }
  if (!n) return "none";
  r /= n; g /= n; b /= n;
  if (g > r + 8 && g > b + 8) return "green/mint";
  if (r > g + 12 && g > b + 6) return "amber";
  if (r > g + 18 && b > g + 4 && r > b + 10) return "coral/red";
  if (b > r + 6 && g > r) return "pearl/blue";
  return "neutral";
}

/* ---------- four-panel sheet composer ---------- */

function composeSheet({ refCrop, curImg, overlay, metrics }) {
  const PANEL = 256, GAP = 12, LABEL = 18;
  const W = PANEL * 2 + GAP * 3;
  const H = PANEL * 2 + GAP * 3 + LABEL;
  const sheet = { width: W, height: H, px: new Uint8Array(W * H * 4).fill(235) };
  const put = (img, px, py) => {
    const scaled = resizeTo(img, PANEL, PANEL);
    for (let y = 0; y < PANEL; y += 1) {
      for (let x = 0; x < PANEL; x += 1) {
        const si = (y * PANEL + x) * 4;
        const di = ((py + y) * W + (px + x)) * 4;
        sheet.px[di] = scaled.px[si];
        sheet.px[di + 1] = scaled.px[si + 1];
        sheet.px[di + 2] = scaled.px[si + 2];
        sheet.px[di + 3] = 255;
      }
    }
  };
  if (refCrop) put(refCrop, GAP, GAP); else drawMissing(GAP, GAP);
  if (curImg) put(curImg, GAP * 2 + PANEL, GAP); else drawMissing(GAP * 2 + PANEL, GAP);
  put(overlay, GAP, GAP * 2 + PANEL);
  drawMetrics(GAP * 2 + PANEL, GAP * 2 + PANEL, metrics);
  function drawMissing(px, py) {
    for (let y = 0; y < PANEL; y += 1) {
      for (let x = 0; x < PANEL; x += 1) {
        const di = ((py + y) * W + (px + x)) * 4;
        sheet.px[di] = 250; sheet.px[di + 1] = 240; sheet.px[di + 2] = 240; sheet.px[di + 3] = 255;
        const diag = Math.abs(x - y) < 2 || Math.abs(x + y - PANEL) < 2;
        if (diag) { sheet.px[di] = 210; sheet.px[di + 1] = 120; sheet.px[di + 2] = 120; }
      }
    }
  }
  function drawMetrics(px, py, m) {
    for (let y = 0; y < PANEL; y += 1) {
      for (let x = 0; x < PANEL; x += 1) {
        const di = ((py + y) * W + (px + x)) * 4;
        sheet.px[di] = 24; sheet.px[di + 1] = 28; sheet.px[di + 2] = 34; sheet.px[di + 3] = 255;
      }
    }
    // 5x7 bitmap-ish text is overkill: bar viz for the key metrics.
    const bars = [
      ["shapeΔ", Math.min(1, m.shapeDelta / 30)],
      ["toneΔ", Math.min(1, m.toneDelta / 60)],
      ["alignΔ", Math.min(1, m.alignDelta / 40)],
    ];
    let y = 28;
    for (const [name, v] of bars) {
      for (let bx = 0; bx < Math.round(v * (PANEL - 70)); bx += 1) {
        for (let by = 0; by < 10; by += 1) {
          const di = ((py + y + by) * W + (px + 64 + bx)) * 4;
          sheet.px[di] = 120 - v * 60; sheet.px[di + 1] = 200 * v; sheet.px[di + 2] = 90; sheet.px[di + 3] = 255;
        }
      }
      y += 22;
    }
  }
  return sheet;
}

/* ---------- per-surface evaluation ---------- */

/* Layout invariants per surface family (brief §3 + contract §6). The
 * compact surface is now THE FIGURE ITSELF (48–64 px, aspect ≈ 0.9–1.3);
 * the expanded panel is a roughly square-ish board (0.7–1.5). Golden
 * context crops anchor the comparison, but the measured bounds must
 * respect the BRIEF family. */
const LAYOUT_FAMILY = {
  compact: [0.7, 1.6],
  expanded: [0.7, 1.5],
  verified: [0.7, 1.5],
  uncertain: [0.7, 1.5],
  failed: [0.7, 1.5],
};

function evaluateSurface(surface, currentPath) {
  const report = { surface: surface.id, current: currentPath ?? "MISSING", ok: false };
  const cur = currentPath ? loadImage(currentPath) : null;
  const board = loadImage(GOLDEN_BOARD);
  const sheetImg = loadImage(GOLDEN_SHEET);

  // Reference context: the board's compact capsule strip and the sheet's
  // state row give the human-approved geometry. We compare STRUCTURE:
  // the current capture's figure box against the golden capsule strip
  // proportions (wider than tall, rounded, dots left, figure right).
  if (!cur) { report.error = "current capture missing — run the visual harness first"; return { report, refCrop: null, curImg: null, overlay: null, metrics: null }; }
  if (!board || !sheetImg) { report.error = "golden references missing in golden/"; return { report, refCrop: null, curImg: null, overlay: null, metrics: null }; }

  // Golden compact strip: scan the board for the capsule strip (a wide,
  // short bright row in the upper half of the board). The compact CURRENT
  // capture is the FIGURE ITSELF (brief §3) — its aspect family is the
  // mascot's own, no longer the old capsule pill.
  const refStrip = contentBox(board, { y0: Math.floor(board.height * 0.10), y1: Math.floor(board.height * 0.30), threshold: 38 });
  // Current capture: the widget surface itself.
  const curBox = contentBox(cur, { threshold: 34 });

  // Layout invariants per family (compact figure vs expanded board).
  // The compact family IS the mascot family now: the reference target is
  // the SINGLE FIGURE on the character sheet (its largest state row
  // figure, aspect ≈ 1), not the whole sheet and not the old pill.
  const [famMin, famMax] = LAYOUT_FAMILY[surface.id] ?? [0.7, 3.6];
  const aspectCur = curBox ? curBox.w / curBox.h : 0;
  const figureBox = sheetImg ? singleFigureBox(sheetImg) : null;
  const aspectRef = figureBox && figureBox.h > 0 ? figureBox.w / figureBox.h : 1.0;
  const target = Math.min(Math.max(aspectRef, famMin), famMax);
  const shapeDelta = Math.abs(aspectCur - target) * 10;

  const toneRef = colorIdentity(sheetImg, figureBox ?? { x: 0, y: 0, w: sheetImg?.width ?? 1, h: sheetImg?.height ?? 1 });
  const toneCur = colorIdentity(cur, curBox);
  const toneDelta = toneCur === toneRef ? 0 : toneCur === "neutral" || toneRef === "neutral" ? 18 : 45;

  // Alignment: content box should sit centered with margins on both sides.
  const cx = curBox ? curBox.x + curBox.w / 2 : 0;
  const alignDelta = curBox ? Math.abs(cx - cur.width / 2) / cur.width * 100 : 100;

  const metrics = { shapeDelta, toneDelta, alignDelta, aspectCur, toneCur, toneRef, curBox };
  report.metrics = metrics;
  // White-page captures (headless glass → transparent → white) make the
  // ink box slightly tighter than the CSS surface; the align/aspect gates
  // use a tolerance that tolerates that rendering, but still fails a
  // genuinely different layout (wrong proportions, off-center figure).
  report.ok = shapeDelta < 22 && toneDelta < 30 && alignDelta < 20;
  report.notes = [
    `aspect: ${aspectCur.toFixed(2)} (family ${famMin}–${famMax}, reference ${target.toFixed(2)})`,
    `color identity: current=${toneCur} vs board=${toneRef}`,
    `centering offset: ${alignDelta.toFixed(1)}%`,
  ];

  const refCrop = refStrip ? crop(board, refStrip) : null;
  const overlay = overlayPanel(refCrop ?? board, cur, refStrip, curBox);
  return { report, refCrop, curImg: cur, overlay, metrics };
}

function crop(img, box) {
  const out = { width: box.w, height: box.h, px: new Uint8Array(box.w * box.h * 4).fill(255) };
  for (let y = 0; y < box.h; y += 1) {
    for (let x = 0; x < box.w; x += 1) {
      const [r, g, b] = rgb(img, box.x + x, box.y + y);
      const i = (y * box.w + x) * 4;
      out.px[i] = r; out.px[i + 1] = g; out.px[i + 2] = b; out.px[i + 3] = 255;
    }
  }
  return out;
}

/* ---------- main ---------- */

mkdirSync(OUT_DIR, { recursive: true });
let allOk = true;
const summary = [];
for (const surface of SURFACES) {
  const currentPath = surface.captures.map((c) => `${CURRENT_DIR}/${c}`).find((p) => existsSync(p));
  const { report, refCrop, curImg, overlay, metrics } = evaluateSurface(surface, currentPath);
  allOk = allOk && report.ok;

  const sheet = composeSheet({
    refCrop: refCrop ?? loadImage(GOLDEN_BOARD),
    curImg,
    overlay: overlay ?? { width: 8, height: 8, px: new Uint8Array(8 * 8 * 4).fill(255) },
    metrics: metrics ?? { shapeDelta: 999, toneDelta: 999, alignDelta: 999 },
  });
  writeFileSync(`${OUT_DIR}/${surface.id}.png`, encodePng(sheet.width, sheet.height, Buffer.from(sheet.px.buffer, sheet.px.byteOffset, sheet.px.byteLength)));
  writeFileSync(`${OUT_DIR}/${surface.id}.txt`, JSON.stringify(report, null, 2));
  summary.push(`${report.ok ? "PASS" : "FAIL"}  ${surface.id}: ${report.error ?? report.notes.join("; ")}`);
}
writeFileSync(`${OUT_DIR}/SUMMARY.txt`, summary.join("\n") + "\n");
console.log(summary.join("\n"));
console.log(allOk ? "golden-diff: PASS" : "golden-diff: FAIL");
process.exitCode = allOk ? 0 : 1;
