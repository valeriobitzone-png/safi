/**
 * Minimal PNG analysis — zero dependencies (Node built-ins only).
 *
 * Used by the visual tests (tests/visual.test.ts) and by manual
 * screenshot verification. Supports the color types headless Chrome
 * emits for --screenshot (RGB / RGBA, 8-bit, non-interlaced).
 *
 *   node tools/png-analysis.mjs <file.png>   (CLI: prints stats)
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/** Parses a PNG into { width, height, pixels: Uint8Array RGBA } and filters. */
export function decodePng(pathOrBuffer) {
  const buf = typeof pathOrBuffer === "string" ? readFileSync(pathOrBuffer) : pathOrBuffer;
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("Not a PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`Unsupported bit depth ${bitDepth}`);
  const channels = { 2: 3, 6: 4 }[colorType];
  if (channels === undefined) throw new Error(`Unsupported color type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * 4);

  // Undo PNG per-scanline filters (types 0..4), byte-wise per channel.
  let inPos = 0;
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    line.set(raw.subarray(inPos, inPos + stride));
    inPos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      switch (filter) {
        case 1: line[x] = (line[x] + a) & 0xff; break;
        case 2: line[x] = (line[x] + b) & 0xff; break;
        case 3: line[x] = (line[x] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          line[x] = (line[x] + pr) & 0xff;
          break;
        }
      }
    }
    for (let x = 0; x < width; x++) {
      const o = y * width * 4 + x * 4;
      pixels[o] = line[x * channels];
      pixels[o + 1] = line[x * channels + 1];
      pixels[o + 2] = line[x * channels + 2];
      pixels[o + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    prev.set(line);
  }
  return { width, height, pixels };
}

export function isNearWhite(pixels, o) {
  // Fully transparent pixels render as the white surface behind the
  // window: they count as white, exactly like the user sees them.
  if (pixels[o + 3] < 8) return true;
  return pixels[o] > 245 && pixels[o + 1] > 245 && pixels[o + 2] > 245;
}

/** Fraction of pixels matching an arbitrary channel predicate. */
export function colorFraction(png, matches) {
  let hit = 0;
  const total = png.width * png.height;
  for (let o = 0; o < total * 4; o += 4) {
    if (matches(png.pixels[o], png.pixels[o + 1], png.pixels[o + 2], png.pixels[o + 3])) hit += 1;
  }
  return total === 0 ? 0 : hit / total;
}

/** Fraction of the image (optionally a rect) that is near-white. */
export function whiteFraction(png, rect) {
  const { x = 0, y = 0, w = png.width, h = png.height } = rect ?? {};
  let white = 0;
  let total = 0;
  for (let py = y; py < y + h && py < png.height; py++) {
    for (let px = x; px < x + w && px < png.width; px++) {
      const o = (py * png.width + px) * 4;
      total += 1;
      if (isNearWhite(png.pixels, o)) white += 1;
    }
  }
  return total === 0 ? 1 : white / total;
}

/** Fraction of non-white pixels — "is anything visibly drawn at all". */
export function inkFraction(png, rect) {
  return 1 - whiteFraction(png, rect);
}

export function describe(path) {
  const png = decodePng(path);
  return {
    file: path,
    width: png.width,
    height: png.height,
    white: (whiteFraction(png) * 100).toFixed(1) + "% white",
    ink: (inkFraction(png) * 100).toFixed(1) + "% ink",
  };
}

if (process.argv[1]?.endsWith("png-analysis.mjs")) {
  for (const file of process.argv.slice(2)) console.log(describe(file));
}
