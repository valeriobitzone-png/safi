#!/usr/bin/env node
/**
 * Deterministic test wallpaper — the Phase 6.2.1 acceptance pattern.
 *
 * Half blue / half purple, 520x560, hard-edged (a rectangle and a
 * checkerboard of 40px squares). Used BEHIND the Safi glass: the visual
 * tests assert the pattern is visible AND blurred through the native
 * Liquid Glass material. Zero dependencies: PNG = zlib + CRC32, and Node
 * ships zlib.
 *
 *   node tools/make-wallpaper.mjs /tmp/safi-wallpaper.png
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

// Usage: node tools/make-wallpaper.mjs <out.png> [width] [height]
// Defaults keep the original deterministic acceptance pattern.
const args = process.argv.slice(2);
const W = Math.max(80, Number(args[1]) || 520);
const H = Math.max(80, Number(args[2]) || 560);
const CHECK = Math.max(8, Math.round(Math.min(W, H) / 14)); // checkerboard square size

// sRGB palette — saturated enough to survive blurring and be classified
// by the pixel tests: blue channel-dominant left, purple right.
const BLUE = [30, 60, 220];
const BLUE2 = [70, 110, 240];
const PURPLE = [150, 40, 200];
const PURPLE2 = [185, 90, 225];

const outPath = args[0] ?? "/tmp/safi-wallpaper.png";

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Raw RGBA pixel data, one filter byte (0) per scanline.
const raw = Buffer.alloc(H * (1 + W * 4));
for (let y = 0; y < H; y++) {
  const row = y * (1 + W * 4);
  raw[row] = 0;
  for (let x = 0; x < W; x++) {
    const i = row + 1 + x * 4;
    let r; let g; let b;
    if (x < W / 2) {
      // Blue half: hard-edged 40px vertical stripes (strong edges to
      // prove the glass really blurs).
      [r, g, b] = Math.floor(x / CHECK) % 2 === 0 ? BLUE : BLUE2;
    } else {
      // Purple half: 40px checkerboard.
      const cell = (Math.floor(x / CHECK) + Math.floor(y / CHECK)) % 2 === 0;
      [r, g, b] = cell ? PURPLE : PURPLE2;
    }
    raw[i] = r;
    raw[i + 1] = g;
    raw[i + 2] = b;
    raw[i + 3] = 255;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = outPath;
if (!out) {
  console.error("usage: node tools/make-wallpaper.mjs <out.png>");
  process.exit(1);
}
writeFileSync(out, png);
console.log(`wallpaper ${W}x${H} written: ${out} (${png.length} bytes)`);
