# DESIGN FREEZE

**DESIGN FREEZE:**
**No visual reinterpretation is permitted without explicit human approval.**

The implementation agent may **implement**, not **redesign**. It is
expressly forbidden to autonomously:

- change Safi's shape or proportions;
- add characters (there is exactly one: Safi);
- change the state palette;
- move or restructure components;
- change interactions (traffic lights, state machine, shortcuts);
- change the copy;
- change proportions, spacing or sizes outside the approved references.

The implementation agent implements the canonical sources — `golden/safi-character-sheet.png`,
`golden/safi-ui-board.png` and `SAFI_UI_INTERACTION_CONTRACT.md` — it does
not reinvent them. Any deviation is a defect to fix in the code, never a
"creative improvement".

Implementation agent attribution is a process note. For the public release,
this document does not name, imply, or rely on any external assistant, IDE,
or agent product. That concern is handled at repository scrub level, not in
functional or visual-process language.

Golden references are the arbiter: if the implementation and the golden
reference disagree, the implementation fails, regardless of test results.

## MASCOT LOCK (2026-09-22)

The procedural figure system is **FROZEN** and is NOT the character's
source of truth. Safi's only source of truth will be the production
masters (`SAFI_HERO` / `SAFI_UI` / `SAFI_MICRO`) delivered to
`golden/production-mascot/` — see `MASCOT_LOCK.md`. Until then: no mascot
redesign, no procedural regeneration, no mascot golden refresh, and the
app icon stays a character-free neutral tile.

Closing rule (binding for every report):

> Do not describe what you think you built. Show what you built.
> Do not report "Liquid Glass", "Safi v0.2", "faithful implementation" or
> "visual system complete" unless the actual release screenshot visually
> matches the provided golden references.
> Automated tests validate behavior.
> The supplied images validate appearance.
> If implementation and golden reference disagree, implementation fails.
