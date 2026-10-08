#!/usr/bin/env node
/**
 * Deterministic Safi brand toolkit (visual system v0.2) — zero deps.
 *
 * Rasterizes the Safi figure head into raw RGBA at any size from the SAME
 * geometry the widget SVG uses (ui/safi-mascot.js SAFI_MASCOT_LAYOUT): one geometry
 * source for every asset. Pure math — no SVG parser involved.
 *
 * Exports:
 *   renderMascotHead(size, state) -> { width, height, rgba:Buffer }
 *   encodePng(width, height, rgba) -> Buffer
 *   writeIcns(png1024, outPath) / writeIco(pngs, outPath)
 *
 * Supersampling (3×3) keeps edges smooth from 22 px to 1024 px.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { SAFI_MASCOT_LAYOUT, SAFI_MASCOT_COLORS } from "../ui/safi-mascot.js";

const { HEAD, EYE, STAR, MOUTH, CHEEK } = SAFI_MASCOT_LAYOUT;
const LAYOUT_MOUTH_Y = MOUTH.y;
const CHEEK_Y = CHEEK.y;
const CHEEK_DX = CHEEK.dx;

/* ---------- PNG encoding (same format as gen-icon.mjs) ---------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------- color helpers ---------- */
function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mix(base, tint, k) {
  return [
    Math.round(base[0] * (1 - k) + tint[0] * k),
    Math.round(base[1] * (1 - k) + tint[1] * k),
    Math.round(base[2] * (1 - k) + tint[2] * k),
  ];
}

/** Per-state glow tint over the perla body (soft, never opaque).
 *  Strong enough that the state reads at a glance (§regola finale),
 *  gentle enough to keep the pearl/glass material. */
export function stateTint(state) {
  const body = [238, 246, 255];
  if (state === "verified") return mix(body, hexToRgb(SAFI_MASCOT_COLORS.verified), 0.62);
  if (state === "uncertain") return mix(body, hexToRgb(SAFI_MASCOT_COLORS.uncertain), 0.66);
  if (state === "failed") return mix(body, hexToRgb(SAFI_MASCOT_COLORS.failed), 0.66);
  return mix(body, hexToRgb(SAFI_MASCOT_COLORS.neutral), 0.35);
}

function glowColor(state) {
  if (state === "verified") return hexToRgb(SAFI_MASCOT_COLORS.verified);
  if (state === "uncertain") return hexToRgb(SAFI_MASCOT_COLORS.uncertain);
  if (state === "failed") return hexToRgb(SAFI_MASCOT_COLORS.failed);
  return hexToRgb(SAFI_MASCOT_COLORS.neutral);
}

/* ---------- geometry (mirrors ui/safi-mascot.js markup, head-only) ---------- */
const VIEW = 120;
const HEAD_RIM = [116, 148, 188]; // rgba(116,148,188,*)
const INK = [44, 62, 80];

function headField(x, y) {
  // 1 inside the head circle, 0 outside, smooth 1.5px edge.
  const d = Math.hypot(x - HEAD.cx, y - HEAD.cy);
  return clamp01((HEAD.r + 0.75 - d) / 1.5);
}

let starVertsCache = null;
function starVertices() {
  if (starVertsCache) return starVertsCache;
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? STAR.rOut : STAR.rIn;
    const deg = -90 + i * 36;
    pts.push([STAR.cx + r * Math.cos(deg * Math.PI / 180), STAR.cy + r * Math.sin(deg * Math.PI / 180)]);
  }
  starVertsCache = pts;
  return pts;
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function aaCircleCoverage(px, py, cx, cy, r) {
  // 3×3 supersampled coverage of one disc.
  let acc = 0;
  for (let sy = 0; sy < 3; sy += 1) {
    for (let sx = 0; sx < 3; sx += 1) {
      const x = px + (sx + 0.5) / 3;
      const y = py + (sy + 0.5) / 3;
      if (Math.hypot(x - cx, y - cy) <= r) acc += 1;
    }
  }
  return acc / 9;
}

/**
 * Render the Safi HEAD (head + star badge + soft state glow) at any size.
 * This is the canonical figure for icons, dock, toolbar, menu bar and
 * favicon (visual system v0.2 §16–17): recognizable, no sign, no text.
 */
export function renderMascotHead(size, state = "idle") {
  const rgba = Buffer.alloc(size * size * 4, 0x00);
  const scale = size / VIEW;
  const tint = stateTint(state);
  const glow = glowColor(state);
  const glowStrength = state === "idle" ? 0.16 : 0.30;

  const headCx = HEAD.cx * scale;
  const headCy = HEAD.cy * scale;
  const headR = HEAD.r * scale;
  // The canonical icon is the HEAD with the sheriff star at its base
  // (contract §17): group = head + star, centered as one unit.
  const headTop = HEAD.cy - HEAD.r;
  const groupBottom = STAR.cy + STAR.rOut;
  const groupH = groupBottom - headTop;
  const offX = (size - headR * 2) / 2 - (headCx - headR);
  const offY = (size - groupH * scale) / 2 - headTop * scale;

  const eyeY = (EYE.y) * scale + offY;
  const eyeDx = EYE.dx * scale;
  const eyeR = Math.max(1.1, EYE.r * scale);
  const mouthY = MOUTH.y * scale + offY;
  const starCx = STAR.cx * scale + offX;
  const starCy = STAR.cy * scale + offY;
  const starScale = scale;
  const cheekY = CHEEK.y * scale + offY;
  const cheekDx = CHEEK.dx * scale;

  // Precompute star vertices at target scale/offset.
  const verts = starVertices().map(([x, y]) => [x * starScale + offX, y * starScale + offY]);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = px + 0.5 - offX;
      const y = py + 0.5 - offY;
      const i = (py * size + px) * 4;

      // soft glow behind everything (radial falloff from head center)
      const gd = Math.hypot(px + 0.5 - (headCx + offX), py + 0.5 - (headCy + offY)) / (headR * 1.55);
      const gA = clamp01(1 - gd) ** 2 * glowStrength;

      const cov = aaCircleCoverage(x + offX, y + offY, headCx + offX, headCy + offY, headR);
      const starCov = pointInPolygon(x + offX, y + offY, verts) ? 1 : 0;

      if (cov <= 0 && starCov <= 0 && gA <= 0.01) continue;

      // base fill
      let rC = 255, gC = 255, bC = 255;
      // vertical perla gradient (head)
      if (cov > 0) {
        const gy = clamp01((y / scale - (HEAD.cy - HEAD.r)) / (HEAD.r * 2));
        rC = mix([255, 255, 255], tint, 0.18 + gy * 0.5)[0];
        gC = mix([255, 255, 255], tint, 0.18 + gy * 0.5)[1];
        bC = mix([255, 255, 255], tint, 0.18 + gy * 0.5)[2];
        // rim shading
        const d = Math.hypot(x - HEAD.cx, y - HEAD.cy) / HEAD.r;
        const rim = clamp01((d - 0.82) / 0.18) * 0.35;
        [rC, gC, bC] = mix([rC, gC, bC], HEAD_RIM, rim);
      }

      // face (only inside head)
      if (cov > 0.5) {
        const exL = (HEAD.cx - EYE.dx) * scale + offX;
        const exR = (HEAD.cx + EYE.dx) * scale + offX;
        for (const ex of [exL, exR]) {
          const eCov = aaCircleCoverage(px + 0.5, py + 0.5, ex, eyeY, eyeR);
          if (eCov > 0) {
            const k = eCov * 0.92;
            [rC, gC, bC] = mix([rC, gC, bC], INK, k);
          }
          // single highlight per eye
          const hCov = aaCircleCoverage(px + 0.5, py + 0.5, ex + eyeR * 0.32, eyeY - eyeR * 0.38, eyeR * 0.3);
          if (hCov > 0) {
            const k = hCov * 0.9;
            [rC, gC, bC] = mix([rC, gC, bC], [255, 255, 255], k);
          }
        }
        // smile — FACE MASTER (fix 6.3 §1): upturned ∪ whose ENDS sit
        // visibly HIGHER than the center (width 17, lift 5.2 in layout
        // units, exactly like the SVG master). The old parabola had
        // hidden ends and read as a sad droop at small sizes.
        const sMid = HEAD.cx * scale + offX;
        const smileW = 17 * scale;
        const smileLift = 5.2 * scale;
        const sdx = Math.abs(px + 0.5 - sMid);
        const t = Math.min(1, sdx / (smileW / 2));
        // Quadratic Bézier y along the master path (x0,y0)→(cx,cy)→(x1,y1):
        const sy = (mouthY - smileLift) * (1 - t) ** 2 +
                   2 * (1 - t) * t * (mouthY + smileLift * 0.62) +
                   (mouthY - smileLift) * t ** 2;
        const smileCov = aaCircleCoverage(px + 0.5, py + 0.5, px + 0.5, sy, Math.max(0.9, 1.4 * scale));
        if (smileCov > 0 && Math.abs(py + 0.5 - sy) < 2.4 * scale) {
          [rC, gC, bC] = mix([rC, gC, bC], INK, 0.66 * smileCov);
        }
        // cheeks
        for (const sgn of [-1, 1]) {
          const cCov = aaCircleCoverage(px + 0.5, py + 0.5, sMid + sgn * cheekDx, cheekY, 5.2 * scale);
          if (cCov > 0) [rC, gC, bC] = mix([rC, gC, bC], [255, 179, 186], 0.5 * cCov);
        }
      }

      // star badge on the chest/head bottom
      if (starCov > 0) {
        [rC, gC, bC] = mix([rC, gC, bC], [255, 201, 77], 0.92);
      }

      // compose: glow under, figure over
      const alpha = Math.max(cov, starCov * 0.96);
      const outA = Math.min(1, alpha + gA);
      if (outA <= 0.004) continue;
      const fgA = alpha;
      const blendedR = rC * fgA + glow[0] * gA * (1 - fgA);
      const blendedG = gC * fgA + glow[1] * gA * (1 - fgA);
      const blendedB = bC * fgA + glow[2] * gA * (1 - fgA);
      rgba[i] = Math.round(blendedR);
      rgba[i + 1] = Math.round(blendedG);
      rgba[i + 2] = Math.round(blendedB);
      rgba[i + 3] = Math.round(outA * 255);
    }
  }

  return { width: size, height: size, rgba };
}

/* ---------- Apple/Windows containers ---------- */

/** icns writer: entries are { type: "ic07"|"ic09"|"ic10"|"ic12", png }. */
export function writeIcns(entries, outPath) {
  let body = Buffer.alloc(0);
  for (const { type, png } of entries) {
    const tag = Buffer.from(type, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(8 + png.length, 0);
    body = Buffer.concat([body, tag, len, png]);
  }
  const head = Buffer.alloc(4);
  head.writeUInt32BE(8 + body.length, 0);
  writeFileSync(outPath, Buffer.concat([Buffer.from("icns"), head, body]));
}

/** ico writer: entries are { width, png } (PNG-compressed, width<=256). */
export function writeIco(entries, outPath) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const dirs = [];
  let offset = 6 + count * 16;
  for (const { width, png } of entries) {
    const e = Buffer.alloc(16);
    e[0] = width >= 256 ? 0 : width;
    e[1] = width >= 256 ? 0 : width;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    dirs.push(e);
    offset += png.length;
  }
  writeFileSync(outPath, Buffer.concat([header, ...dirs, ...entries.map((e) => e.png)]));
}
