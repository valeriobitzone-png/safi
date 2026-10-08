#!/usr/bin/env node
/**
 * Deterministic app-icon generator — PRODUCTION SAFI ON THE DOCK TILE.
 *
 * The 21 production masters (golden/production-mascot) have been
 * delivered and are the ONLY source of Safi pixels. This pipeline
 * composites the delivered IDLE master onto the soft daylight tile
 * using the same optical mapping as the runtime:
 *
 *     rendered icon size   <= 72px -> MICRO  (64px master)
 *     rendered icon size  73–180px -> UI    (128px master)
 *     rendered icon size   > 180px -> HERO  (512px master)
 *
 * The delivered PNG is NEVER redrawn, recolored or procedurally
 * reconstructed: it is decoded, box-filtered to the slot size and
 * alpha-composited over the tile ground. The procedural figure
 * (FACE, smilePath, browArc, generated eyes/mouth, mascot-raster
 * drawing) is archived and produces ZERO pixels here: only the
 * container encoders (writeIcns/writeIco) are reused.
 *
 *   npm run app:icon
 *
 * Deterministic: same repo state → byte-identical PNGs. The tile embeds
 * the UTF-8 hex of the project name in the LSBs of the first pixels —
 * invisible provenance, same as the previous generator.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePng } from "./png-analysis.mjs";

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

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Invisible provenance: write hex nibbles of `message` into LSBs. */
function embedProvenance(rgba, message) {
  const hex = Buffer.from(message, "utf8").toString("hex");
  let bitIndex = 0;
  for (const char of hex) {
    const value = parseInt(char, 16);
    for (const shift of [4, 0]) {
      if (bitIndex >= rgba.length) return;
      const bit = (value >> shift) & 0x1;
      rgba[bitIndex] = (rgba[bitIndex] & 0xfe) | bit;
      bitIndex += 1;
    }
  }
}

/**
 * Round-rect squircle ground with the soft perla gradient, macOS-like.
 */
function appIconGround(size) {
  const rgba = Buffer.alloc(size * size * 4, 0x00);
  const s = size;
  const radius = s * 0.225;
  const inset = s * 0.045;
  const rr = radius;
  const x0 = inset, y0 = inset, x1 = s - inset, y1 = s - inset;

  const inGround = (px, py) => {
    const cx = Math.min(Math.max(px, x0 + rr), x1 - rr);
    const cy = Math.min(Math.max(py, y0 + rr), y1 - rr);
    const d = Math.hypot(px - cx, py - cy);
    if (px >= x0 && px <= x1 && py >= y0 && py <= y1) {
      if (px >= x0 + rr && px <= x1 - rr) return true;
      if (py >= y0 + rr && py <= y1 - rr) return true;
      return d <= rr;
    }
    return false;
  };

  for (let y = 0; y < s; y += 1) {
    for (let x = 0; x < s; x += 1) {
      if (!inGround(x + 0.5, y + 0.5)) continue;
      const i = (y * s + x) * 4;
      const t = y / s;
      // soft daylight gradient: #f7fbff → #dce9fb
      rgba[i] = Math.round(247 - t * 26);
      rgba[i + 1] = Math.round(251 - t * 18);
      rgba[i + 2] = Math.round(255 - t * 4);
      rgba[i + 3] = 255;
    }
  }
  return { rgba, inset };
}

/* ---------- production masters: the only source of Safi pixels ---------- */
const MASTERS = {
  hero: resolve("golden/production-mascot/hero/safi-hero-idle.png"),
  ui: resolve("golden/production-mascot/ui/safi-ui-idle.png"),
  micro: resolve("golden/production-mascot/micro/safi-micro-idle.png"),
};
const masterCache = new Map();
function loadMaster(tier) {
  if (!masterCache.has(tier)) {
    const img = decodePng(readFileSync(MASTERS[tier]));
    masterCache.set(tier, img);
  }
  return masterCache.get(tier);
}
/** Optical mapping: which delivered master serves a given icon slot. */
function tierForSize(size) {
  if (size <= 72) return "micro";
  if (size <= 180) return "ui";
  return "hero";
}
/** Box-filter downscale of a delivered master (no redraw, no recolor). */
function scaleMaster(tier, size) {
  const src = loadMaster(tier);
  if (src.width === size) return { width: size, height: size, pixels: src.pixels };
  const out = new Uint8Array(size * size * 4);
  const ratio = src.width / size;
  for (let y = 0; y < size; y += 1) {
    const y0 = Math.floor(y * ratio);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * ratio));
    for (let x = 0; x < size; x += 1) {
      const x0 = Math.floor(x * ratio);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * ratio));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1 && sy < src.height; sy += 1) {
        for (let sx = x0; sx < x1 && sx < src.width; sx += 1) {
          const i = (sy * src.width + sx) * 4;
          const al = src.pixels[i + 3] / 255;
          r += src.pixels[i] * al; g += src.pixels[i + 1] * al; b += src.pixels[i + 2] * al;
          a += src.pixels[i + 3]; n += 1;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / (a / 255));
        out[o + 1] = Math.round(g / (a / 255));
        out[o + 2] = Math.round(b / (a / 255));
      }
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: size, height: size, pixels: out };
}
/** Alpha-composite the delivered IDLE master onto the tile ground. */
function buildAppIcon(size) {
  const { rgba } = appIconGround(size);
  const tier = tierForSize(size);
  const fig = scaleMaster(tier, size);
  // Optical inset: small tiles need more relative breathing room.
  const inset = size * (size <= 72 ? 0.06 : size <= 180 ? 0.09 : 0.12);
  const draw = Math.max(1, Math.round(size - inset * 2));
  const scaled = scaleMaster(tier, draw);
  const ox = Math.round((size - draw) / 2);
  const oy = Math.round((size - draw) / 2);
  for (let y = 0; y < draw; y += 1) {
    for (let x = 0; x < draw; x += 1) {
      const si = (y * draw + x) * 4;
      const alpha = scaled.pixels[si + 3] / 255;
      if (alpha <= 0) continue;
      const di = ((y + oy) * size + (x + ox)) * 4;
      rgba[di] = Math.round(scaled.pixels[si] * alpha + rgba[di] * (1 - alpha));
      rgba[di + 1] = Math.round(scaled.pixels[si + 1] * alpha + rgba[di + 1] * (1 - alpha));
      rgba[di + 2] = Math.round(scaled.pixels[si + 2] * alpha + rgba[di + 2] * (1 - alpha));
      rgba[di + 3] = Math.max(rgba[di + 3], scaled.pixels[si + 3]);
    }
  }
  embedProvenance(rgba, "safi");
  return encodePng(size, size, rgba);
}

const OUT_DIR = "apps/desktop/src-tauri/icons";
mkdirSync(OUT_DIR, { recursive: true });

const png256 = buildAppIcon(256);
for (const size of [32, 128, 256, 512, 1024]) {
  const png = size === 256 ? png256 : buildAppIcon(size);
  writeFileSync(`${OUT_DIR}/icon-${size}.png`, png);
  console.log(`icon-${size}.png  ${png.length} bytes`);
}

// tauri icon set names
writeFileSync(`${OUT_DIR}/icon.png`, buildAppIcon(512));
writeFileSync(`${OUT_DIR}/32x32.png`, buildAppIcon(32));
writeFileSync(`${OUT_DIR}/128x128.png`, buildAppIcon(128));
writeFileSync(`${OUT_DIR}/128x128@2x.png`, buildAppIcon(256));
writeFileSync(`${OUT_DIR}/64x64.png`, buildAppIcon(64));
// Mobile launcher/asset-catalog slots: the same production IDLE master
// through the same optical mapping, so no procedural mascot survives
// anywhere in the repo.
const MOBILE_SIZES = [
  ["Square30x30Logo", 30], ["Square44x44Logo", 44], ["Square71x71Logo", 71],
  ["Square89x89Logo", 89], ["Square107x107Logo", 107], ["Square142x142Logo", 142],
  ["Square150x150Logo", 150], ["Square284x284Logo", 284], ["Square310x310Logo", 310],
  ["StoreLogo", 50],
];
for (const [name, size] of MOBILE_SIZES) {
  writeFileSync(`${OUT_DIR}/${name}.png`, buildAppIcon(size));
}
for (const [dir, files] of [
  ["android", [[36, "mipmap-mdpi/ic_launcher.png"], [36, "mipmap-mdpi/ic_launcher_round.png"], [36, "mipmap-mdpi/ic_launcher_foreground.png"],
               [48, "mipmap-hdpi/ic_launcher.png"], [48, "mipmap-hdpi/ic_launcher_round.png"], [48, "mipmap-hdpi/ic_launcher_foreground.png"],
               [72, "mipmap-xhdpi/ic_launcher.png"], [72, "mipmap-xhdpi/ic_launcher_round.png"], [72, "mipmap-xhdpi/ic_launcher_foreground.png"],
               [96, "mipmap-xxhdpi/ic_launcher.png"], [96, "mipmap-xxhdpi/ic_launcher_round.png"], [96, "mipmap-xxhdpi/ic_launcher_foreground.png"],
               [144, "mipmap-xxxhdpi/ic_launcher.png"], [144, "mipmap-xxxhdpi/ic_launcher_round.png"], [144, "mipmap-xxxhdpi/ic_launcher_foreground.png"]]],
  ["ios", [[20, "AppIcon-20x20@1x.png"], [40, "AppIcon-20x20@2x.png"], [40, "AppIcon-20x20@2x-1.png"], [60, "AppIcon-20x20@3x.png"],
           [29, "AppIcon-29x29@1x.png"], [58, "AppIcon-29x29@2x.png"], [58, "AppIcon-29x29@2x-1.png"], [87, "AppIcon-29x29@3x.png"],
           [40, "AppIcon-40x40@1x.png"], [80, "AppIcon-40x40@2x.png"], [80, "AppIcon-40x40@2x-1.png"], [120, "AppIcon-40x40@3x.png"],
           [60, "AppIcon-60x60@2x.png"], [120, "AppIcon-60x60@3x.png"], [76, "AppIcon-76x76@1x.png"], [152, "AppIcon-76x76@2x.png"],
           [167, "AppIcon-83.5x83.5@2x.png"], [1024, "AppIcon-512@2x.png"]]],
]) {
  mkdirSync(`${OUT_DIR}/${dir}`, { recursive: true });
  for (const [size, name] of files) {
    writeFileSync(`${OUT_DIR}/${dir}/${name}`, buildAppIcon(size));
  }
}
console.log("mobile icon slots regenerated from the production masters");

// .icns / .ico written DIRECTLY (no external tool): the icns container
// embeds PNG-encoded pages (valid since macOS 10.7), the ico embeds the
// PNG-compressed entries. Byte-deterministic, sandbox-proof, works on
// every host — no sips dependency anywhere in the chain.
import { writeIcns, writeIco } from "./mascot-raster.mjs";
// ^ container writers ONLY (ICNS/ICO format plumbing). The procedural
// figure drawing in that module is archived and never invoked.
writeIcns(
  [
    { type: "ic07", png: buildAppIcon(128) },
    { type: "ic09", png: buildAppIcon(256) },
    { type: "ic10", png: buildAppIcon(512) },
    { type: "ic12", png: buildAppIcon(32) },
  ],
  `${OUT_DIR}/icon.icns`,
);
writeIco(
  [
    { width: 32, png: buildAppIcon(32) },
    { width: 128, png: buildAppIcon(128) },
    { width: 256, png: buildAppIcon(256) },
  ],
  `${OUT_DIR}/icon.ico`,
);
console.log("icon.icns + icon.ico written (deterministic, no sips).");

console.log(
  "Safi app icon written to apps/desktop/src-tauri/icons from the production masters.",
);
console.log(
  "Optical mapping: <=72px MICRO, 73-180px UI, >180px HERO. The delivered assets are never modified.",
);
