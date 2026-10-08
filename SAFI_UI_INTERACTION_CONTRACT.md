# SAFI UI — Golden Reference Contract v1

Status: **BINDING** · Ratified: 2026-09-21 · Protocol impact: none

## 0. Source of truth

From this moment there are exactly three canonical sources:

1. **Safi Character Sheet approvata** → `golden/safi-character-sheet.png`
2. **Safi/Safi UI Board approvata** → `golden/safi-ui-board.png`
3. **Questo Interaction Contract** → `SAFI_UI_INTERACTION_CONTRACT.md`

Any earlier mock, earlier SVG, self-generated design or old description is
**superseded**. If the code disagrees with these references, **the code is
wrong — not the reference**.

## 1. Safi must NOT be reinterpreted

Safi is not to be regenerated through an invented "parametric SVG figure"
that changes its shape. The approved visual reference defines proportions
(head/body), eye size and shape, mouth, cheeks, sheriff star, arms,
silhouette, colors, expressions. Safi was rebuilt faithfully into
`safi-mascot-master.svg` from the approved character sheet; every state derives
from that single master. There are never seven Safis drawn differently.

## 2. Canonical anatomy

Head ≈ 70% of the silhouette · body ≈ 30% · sheriff star centered under
the head · small soft arms · no prominent legs. Eyes: simple, sweet, very
legible — pupil/shape + at most 1 highlight; never anime, never glossy 3D.
Sweetness comes from curvature, brows, tilt, cheeks, mouth.

## 3. Exact states (idle/understanding/translating/verifying/verified/
uncertain/failed)

Per-state color/glow, eyes, mouth, cheeks, sign and animation follow the
approved character sheet exactly:

| State | Glow | Eyes | Sign | Notes |
| --- | --- | --- | --- | --- |
| IDLE | none (pearl) | relaxed | — | small smile |
| UNDERSTANDING | none | attentive | — | slight head tilt |
| TRANSLATING | none | lateral glance | — | small sparks |
| VERIFYING | none | focused | — | magnifier scan |
| VERIFIED | mint #86F7C1 | happy arcs | ✓ | mini bounce |
| UNCERTAIN | amber #FFE08A | squeezed/doubtful | ? | tilted head, doubtful mouth |
| FAILED | coral #FF8B8B | angry | ! | puffed cheeks, short downturned mouth — funny-annoyed, never aggressive |

The base body stays white/pearl in every trust state; the state is
communicated by glow, luminous rim, reflection, cheeks, ambient light,
sign and expression (§8). Safi is never fully repainted.

## 4. Compact widget — identical to the reference

Capsule `╭─ ● ● ● ────── Safi ─╮` on native Liquid Glass: frosted, satin,
semi-transparent but readable. Target size ≈ 120–150 × 48–58 px (window
surface). Safi 28–36 px. No square, no card, no white mini-window.

## 5. The three dots are real window controls

- **Red** click → closes Safi completely.
- **Yellow** click → EXPANDED → COMPACT (no destructive action when compact).
- **Green** click → toggle COMPACT ↔ EXPANDED.
- **Escape** → EXPANDED → COMPACT.

No native title bar or extra chrome appears: the dots are part of the Safi
language.

## 6. Expanded Safi — the board structure, not a reinterpretation

`● ● ● ─ Safi + ✦ Safi / Capisce. Traduce. Verifica.` header; modal row
`[ Chiedi ] [ Verifica ]`; `Parla normalmente…` input; action row
`[ Incolla ] [ Immagine ] [ Da link ] [ … ]`; footer `Safi — Pronto ad
aiutarti. / Safi è sempre con te.` No opaque white cards, no heavy grey
boxes, no thick borders, no low-contrast text.

## 7. The glass must NOT be as transparent as the wrong screenshot

Wallpaper perceivable ≠ text lost in the wallpaper. Perceived glass
opacity ≈ 70–85%, background influence ≈ 15–30% (visual criterion, not a
rigid CSS value). Content always wins over the background.

## 8. Safi color ≠ painting everything

See §3: pearl base forever; trust via glow/rim/reflection/cheeks/sign.

## 9. No second character

`grep -i pico` across the repo = 0. Safi is mascot, trust indicator,
emotion indicator and brand character.

## 10. Anti-"ho completato" rule

A visual phase is **IMPLEMENTED** until the human approves it; it becomes
**VISUALLY ACCEPTED** only after explicit human confirmation. Passing
tests never upgrades the wording. No agent may report "completata" for
visual work.

## 11. Golden screenshots

Automated screenshots compare against **our references** (`golden/`),
not against agent-generated images. Tests use overlay + pixel diff +
layout bounds. Native glass variance is allowed; geometry, proportions,
positions, spacing and sizes must respect the reference.

## 12. Mandatory visual diff

Every new build produces REFERENCE / CURRENT / OVERLAY / DIFF for:
compact, expanded, verified, uncertain, failed. If Safi's face changed,
the diff shows it — tests passing is not a defense.

## 13. Creative freeze

`DESIGN_FREEZE.md` states it verbatim and binds every future change:
implement, never redesign without explicit human approval.

## Closing rule (verbatim)

> Do not describe what you think you built. Show what you built.
> Do not report "Liquid Glass", "Safi v0.2", "faithful implementation" or
> "visual system complete" unless the actual release screenshot visually
> matches the provided golden references.
> Automated tests validate behavior.
> The supplied images validate appearance.
> If implementation and golden reference disagree, implementation fails.
