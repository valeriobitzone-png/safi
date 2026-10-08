# Safi Production Mascot Assets

Canonical production assets. Do not redraw, trace, regenerate, recolor, or procedurally reconstruct the mascot.

## Optical masters
- `hero/`: 512×512 PNG, transparent, for store/marketing/presentation surfaces.
- `ui/`: 128×128 PNG, transparent, optically tuned for in-app UI.
- `micro/`: 64×64 PNG, transparent, optically tuned for compact widget/menu/dock-like surfaces.

## States
`idle`, `understanding`, `translating`, `verifying`, `verified`, `uncertain`, `failed`.

Use the closest optical master to the actual rendered size. Never use HERO as a universal source and simply downscale it for micro UI.
