#!/usr/bin/env node
/**
 * Build a SELF-CONTAINED evidence page from a folder of PNGs.
 *
 *   node tools/png-contact-sheet.mjs <out.html> <img1.png> [img2.png ...]
 *
 * The HTML inlines every image as a data URI, so it opens and renders
 * anywhere — no server, no relative paths, nothing to go stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [out, ...imgs] = process.argv.slice(2);
if (!out || imgs.length === 0) {
  console.error("usage: png-contact-sheet.mjs out.html img1.png [img2.png ...]");
  process.exit(2);
}
const figures = imgs
  .map((p) => {
    const b64 = readFileSync(p).toString("base64");
    const name = basename(p);
    return `<figure><img src="data:image/png;base64,${b64}" alt="${name}" /><figcaption>${name}</figcaption></figure>`;
  })
  .join("\n");

writeFileSync(
  out,
  `<!doctype html>
<meta charset="utf-8" />
<title>Safi 3:2 evidence</title>
<style>
  body { margin: 0; background: #14181d; color: #cfd6de; font: 13px/1.5 system-ui, -apple-system, sans-serif; }
  header { padding: 16px 20px 6px; }
  h1 { font-size: 15px; margin: 0 0 4px; font-weight: 650; }
  header p { margin: 0; color: #8b95a1; font-size: 12px; }
  main { display: flex; flex-wrap: wrap; gap: 18px; padding: 14px 20px 28px; }
  figure { margin: 0; }
  img { display: block; background: repeating-conic-gradient(#2a3038 0 25%, #22272e 0 50%) 0 0 / 16px 16px; border-radius: 4px; }
  figcaption { padding-top: 5px; color: #8b95a1; font-size: 11px; }
</style>
<header>
  <h1>Safi TRUE 3:2 — real evidence</h1>
  <p>Native pixel size, unscaled. Checkerboard = transparency: the widget paints no opaque fill, the native glass supplies the material.</p>
</header>
<main>
${figures}
</main>
`,
);
console.log(out);
