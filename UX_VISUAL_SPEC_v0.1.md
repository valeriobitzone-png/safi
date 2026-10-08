# UX_VISUAL_SPEC_v0.1 — Human projection of Safi

- Status: REFERENCE (implemented by `ui/safi-stamp.js`)
- Date: 2026-09-18
- Protocol changes: **none**. This document governs presentation only.
- Core impact: **none**. No UI dependency enters the protocol or the Core.

## 1. First principle

> Safi appears as a minimal presence beside the existing AI. It is not a
> new chatbot.

Safi never replaces the AI interface. It adds one small, calm, inspectable
signal: the Safi Stamp. The conversation keeps belonging to the person and
to the AI they chose; Safi only makes trust visible.

## 2. Pipeline states (activity)

Safi's activity is projected through a fixed sequence of states. They are
presentation-only labels over the existing protocol flow (RFC 0001); they
do not add, remove or rename any protocol state.

```text
IDLE          Safi is present, quiet, doing nothing.
UNDERSTANDING Safi sta capendo…      (interpreting the human intent)
TRANSLATING   Safi sta traducendo…   (Human→AI translation in progress)
WAITING_AI    Safi attende la risposta dell'AI…  (provider at work)
HUMANIZING    Safi sta semplificando il linguaggio…
VERIFYING     Safi sta verificando…
CORRECTING    Safi sta chiedendo una correzione…  (bounded correction)
RESULT        The Safi Stamp is shown with its final trust status.
```

Rules:

- Micro-states for the Human→AI direction are shown sparingly and only
  while work is happening: "Safi sta capendo…", "Safi sta traducendo…".
- The technical prompt is NEVER shown by default. The person asked a
  question in their own words; the semantic representation stays behind
  progressive disclosure (developer level).
- CORRECTING must always communicate that the number of attempts is
  bounded ("tentativo 2 di 2").
- States are transitory; RESULT is the only persistent one.

## 3. Final trust states (Safi Stamp)

The final states of the Safi Stamp remain exactly the protocol trust
states:

```text
VERIFIED
UNCERTAIN
FAILED
```

They are projected by `ui/projection.js` from a `SafiCertificate` or a
`SafiStamp`. Nothing else may produce a stamp.

### Recommended visual mapping

```text
VERIFIED   → verde   (calm, reassuring green)
UNCERTAIN  → ambra/arancio
FAILED     → rosso
```

The mapping is a reference, not a protocol requirement. **Color must never
be the only signal.** Every state is communicated by at least three
channels simultaneously (see §8):

1. a distinct shape/glyph (● / ◐ / ○ outline);
2. an explicit text label ("Verificato" / "Non certo" / "Non verificato");
3. an accessible name for screen readers (ARIA).

## 4. Progressive disclosure (three levels)

### Level 0 — minimal presence (default)

```text
●
```

A single small dot beside the AI's answer. No chrome, no banner, no
paragraph. Safi is a presence, not an interface.

### Level 1 — click/tap

```text
● Verified

Controlli superati: 3/3
```

One line of trust, one count. Human words first ("Verified"), protocol
term second.

### Level 2 — expansion (developer / "why?")

```text
Verification scope   coherence, meaning-preservation
Evidenze             one independent source found; dates consistent
Tentativi            1 di 1
Timestamp            2026-09-18T08:30:00.000Z
Provider             example-provider
Response hash        b6a3f2e3…7c6d5e4f
```

Level 2 exposes certificate facts read-only. It never exposes anything the
certificate does not contain, and it never offers mutation controls.

### Disclosure contract

- Level 0 → 1 requires an explicit user action (click, tap, Enter, Space).
- Level 1 → 2 likewise.
- Escape or a second activation collapses back.
- Every level must be reachable by keyboard and announced to screen
  readers.

## 5. Three UX contexts

### EMBEDDED — Safi Stamp beside the answer

Safi lives inside the host application next to the AI response.

```text
┌──────────────────────────────────────────────┐
│ AI: Ecco la spiegazione…                     │
│                                 ● Verified   │
└──────────────────────────────────────────────┘
```

The stamp is small (≈16–20 px), aligned to the answer, never between the
person and the AI's text.

### COMPANION — small overlay anchored to the AI's answer

A browser extension / overlay floats a compact anchor beside an external
AI's answer.

```text
┌─ AI esterna ────────────────────────────────┐
│ Risposta dell'AI…                           │
│                    ┌───┐                    │
│                    │ ● │  ← overlay Safi     │
│                    └───┘                    │
└─────────────────────────────────────────────┘
```

The overlay is dismissible, never covers the answer text, and states in
its accessible label that it is an independent verification signal.

### MANUAL — copy/paste, no integration

Two plain fields, no capture:

```text
┌──────────────────────────────────────────────┐
│ Parla normalmente                            │
│ ┌──────────────────────────────────────────┐ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Verifica questa risposta                     │
│ ┌──────────────────────────────────────────┐ │
│ └──────────────────────────────────────────┘ │
│                        [ Verifica con Safi ] │
└──────────────────────────────────────────────┘
```

- "Parla normalmente": the person writes in natural language. The
  technical prompt produced from it is never shown by default.
- "Verifica questa risposta": paste an answer to have it certified.
- Both fields are ordinary inputs; nothing is intercepted.

## 6. Developer inspection

In developer mode the projection can expose, read-only and in this order:

```text
HumanRequest              the person's words, verbatim
IntentFrame               goal, task, constraints, needsClarification
SemanticRepresentation    WHAT the person wants, provider-neutral
SafiRequest               the neutral request sent to the provider
```

The provider-specific prompt built by the Provider Adapter is NOT part of
these objects and is never displayed by Safi UI. Developer mode is opt-in
per surface; it never changes trust semantics and never renders inside the
default Level 0–1 view.

## 7. Brand direction

The existing banner (`assets/safi-github-banner.png`) is the brand
reference. Safi's aesthetic is:

- **luminoso** — light backgrounds, generous whitespace, soft shadows;
- **rassicurante** — rounded shapes, calm greens for trust, no alarm
  aesthetics for UNCERTAIN (amber, not sirens);
- **umano** — human words first ("Verificato", "Non certo"), jargon only
  on demand;
- **pulito** — one dot, one line, one panel: no dashboards, no badges
  walls, no cyber-security visual tropes (no padlocks, no hacker green,
  no warning triangles unless FAILED).

No aggressive security aesthetics: Safi is trust made visible, not
surveillance made loud.

## 8. Accessibility requirements (WCAG 2.2 AA)

- **Non-color signals**: every trust state carries a distinct glyph, a
  text label and an accessible name. Color alone never encodes state.
- **Contrast**: stamp label and text meet 4.5:1 (normal text) on their
  background; the dot glyph meets 3:1 as a graphical object.
- **Text alternative**: the dot is a `role="img"` element with an `aria-label`
  describing the state in human words ("Verificato da Safi: controlli
  superati 3 su 3").
- **Keyboard**: the stamp is focusable (tabindex), activates with Enter
  and Space, collapses with Escape; focus is always visible.
- **Screen reader**: disclosure updates are announced with
  `aria-expanded` on the trigger and an `aria-live="polite"` region for
  state changes; micro-states are announced politely, never assertively.
- **Motion**: any state pulse respects `prefers-reduced-motion`.
- **Target size**: the interactive target is at least 24×24 px
  (WCAG 2.5.8), recommended 44×44 on touch surfaces.

## 9. Immutability rule

No graphic component can modify a `SafiCertificate`, a trust status or a
semantic request. The reference implementation enforces this structurally:

- `projection.js` only reads; it deep-freezes any object it returns;
- the Web Component renders a frozen clone and holds no setter;
- certificate data is presented, never parsed back into protocol objects;
- the certificate hash is displayed truncated, never recomputed or edited.

Any UI that offers a way to alter certified state violates this spec and
the protocol.

## 10. Reference states artifacts

Static, dependency-free mock/reference pages under `ui/mocks/`:

```text
ui/mocks/desktop.html    EMBEDDED context on desktop
ui/mocks/mobile.html     EMBEDDED context on a narrow screen
ui/mocks/companion.html  COMPANION overlay beside an external AI answer
ui/mocks/manual.html     MANUAL copy/paste fields
```

Each mock is plain HTML + the single Web Component file: no framework, no
build step, no network. Open them directly in a browser.

## 11. Explicitly out of scope

Dashboards, accounts, login, databases, a full application, analytics,
telemetry UI. The stamp stays a presence beside the AI. Nothing here may
pull UI dependencies into the protocol or the Core.
