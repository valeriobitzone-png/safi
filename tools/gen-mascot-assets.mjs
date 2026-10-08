#!/usr/bin/env node
/**
 * Official Safi asset set (visual system v0.2) — deterministic, zero deps.
 *
 *   npm run mascot:assets
 *
 * Writes to assets/safi-mascot/:
 *   safi-mascot-<state>.svg            vector, full figure, one state each
 *   safi-mascot-<state>-{22,32,64,256,1024}.png   rasterized head (legibility set)
 *   favicon.ico / favicon.png   browser
 *   toolbar.png / menubar.png   64/22 px template-ready heads
 *
 * Geometry comes from ui/safi-mascot.js (SAFI_MASCOT_LAYOUT) — one source of truth,
 * same figure the widget renders. Regenerating is byte-stable.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { SAFI_MASCOT_STATES, safiMascotMarkup, SAFI_MASCOT_CSS } from "../ui/safi-mascot.js";
import { renderMascotHead, encodePng, writeIco } from "./mascot-raster.mjs";

const OUT = "assets/safi-mascot";
mkdirSync(OUT, { recursive: true });

for (const state of SAFI_MASCOT_STATES) {
  // Vector asset: full figure locked to its state (CSS inlined so the
  // file is standalone), animations kept except the reduced-motion case.
  const svg = safiMascotMarkup({ headOnly: false }).replace(
    'data-state="idle"',
    `data-state="${state}"`,
  );
  writeFileSync(`${OUT}/safi-mascot-${state}.svg`, `<style>${SAFI_MASCOT_CSS}</style>\n${svg}\n`);

  // Legibility set: head-only raster at every mandated size.
  for (const size of [22, 32, 64, 256, 1024]) {
    const img = renderMascotHead(size, state);
    writeFileSync(`${OUT}/safi-mascot-${state}-${size}.png`, encodePng(img.width, img.height, img.rgba));
  }
  console.log(`safi-mascot-${state}: svg + 5 png`);
}

// Browser + toolbar/menubar assets (idle figure = the brand mark).
const fav32 = renderMascotHead(32, "idle");
const fav16 = renderMascotHead(16, "idle");
const fav48 = renderMascotHead(48, "idle");
writeIco(
  [
    { width: 16, png: encodePng(fav16.width, fav16.height, fav16.rgba) },
    { width: 32, png: encodePng(fav32.width, fav32.height, fav32.rgba) },
    { width: 48, png: encodePng(fav48.width, fav48.height, fav48.rgba) },
  ],
  `${OUT}/favicon.ico`,
);
const favPng = renderMascotHead(64, "idle");
writeFileSync(`${OUT}/favicon.png`, encodePng(favPng.width, favPng.height, favPng.rgba));

const toolbar = renderMascotHead(64, "idle");
writeFileSync(`${OUT}/toolbar.png`, encodePng(toolbar.width, toolbar.height, toolbar.rgba));
const menubar = renderMascotHead(22, "idle");
writeFileSync(`${OUT}/menubar.png`, encodePng(menubar.width, menubar.height, menubar.rgba));

console.log("assets/safi-mascot ready (deterministic).");
