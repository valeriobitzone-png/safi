# Safi Production Mascot Assets

Canonical production assets. Do not redraw, trace, regenerate, recolor, or procedurally reconstruct the mascot.

## Optical masters
- `hero/`: 512×512 PNG, transparent, for store/marketing/presentation surfaces.
- `ui/`: 128×128 PNG, transparent, optically tuned for in-app UI.
- `micro/`: 64×64 PNG, transparent, optically tuned for compact widget/menu/dock-like surfaces.

## States
`idle`, `understanding`, `translating`, `verifying`, `verified`, `uncertain`, `failed`.

Use the closest optical master to the actual rendered size. Never use HERO as a universal source and simply downscale it for micro UI.

## Delivered · 2026-09-24

Source pack: `safi-production-mascot-pack.zip`
SHA-256: `1fc849033ab661c95ab7e47cd919b3217cb24f5c518ec9d61e2f6336939b6850`

`MANIFEST.json` is the checksum authority: 21/21 SHA-256 and byte counts
verified against the delivered files. `tests/mascot.test.ts` fails the build
if any master is missing, resized, recolored or modified.

These files are served verbatim to the runtime (`GET /mascot/{tier}/{state}.png`)
and are the ONLY source of visible Safi pixels. The archived procedural mascot
produces nothing at runtime — see `MASCOT_LOCK.md`.
