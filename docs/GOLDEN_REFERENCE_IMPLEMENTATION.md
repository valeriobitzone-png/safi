# SAFI UI — Golden Reference Implementation

Data: 2026-09-21 · Impatto protocollo: **nessuno** · Core: **intatto**

## Status: IMPLEMENTED — pending human visual acceptance

Per il contratto (§10): una fase visuale è **IMPLEMENTED**, non "completata".
Diventa **VISUALLY ACCEPTED** solo dopo conferma umana. Nessun test può
promuoverla.

## Fonti canoniche (§0)

Archiviate nel repo e vincolanti:

- `golden/safi-character-sheet.png` — character sheet approvato
- `golden/safi-ui-board.png` — UI board approvata
- `SAFI_UI_INTERACTION_CONTRACT.md` — questo contratto
- `DESIGN_FREEZE.md` — freeze creativo (testo §13 letterale)

Se il codice non coincide con le reference, **è il codice a essere
sbagliato, non la reference**.

## Safi ricostruito dal master (§1–3)

- `safi-mascot-master.svg` — il master canonico, ricostruito dal character sheet.
- `ui/safi-mascot.js` è ora un derivatore del master: una sola geometria
  (`SAFI_MASCOT_LAYOUT`), sette stati, mai sette Safi disegnati diversamente.
- Anatomia (misurata, non dichiarata): testa 68.6% della silhouette
  (≈ 70% del §2); stellina al petto centrata sotto la testa; occhi grandi
  semplici (pupilla + 1 highlight); braccia morbide; nessuna gamba.
- Espressioni per stato: sorriso perla (idle), tilt + attento
  (understanding), occhiata laterale + scintille (translating), lente con
  scan (verifying), occhi ad arco + ✓ + mini-bounce (verified), occhi
  strizzati asimmetrici + ? + testa inclinata (uncertain), guance gonfie +
  ! + bocca accorciata verso il basso (failed) — contrariato e buffo,
  mai aggressivo.
- Regola §8 rispettata: il corpo resta perla; il trust vive in glow,
  riflesso, guance, cartello ed espressione.

## Widget (§4–7)

- Capsula compatta ~128×52 CSS px (famiglia 120–150 × 48–58) con Safi
  32 px come unico indicatore; nessun testo (innerText della capsula: "").
- Pallini reali: rosso → close (la shell nasconde la finestra), giallo →
  EXPANDED→COMPACT (no-op distruttiva da compatto), verde → toggle,
  Escape → COMPACT. Nessun chrome nativo.
- Pannello espanso sulla struttura del board (§6): header Safi + ✦ Safi
  con tagline "Capisce. Traduce. Verifica.", modalità pill [ Chiedi ]
  [ Verifica ], campo "Parla normalmente…", action chips
  (Incolla funzionante via clipboard; Immagine/Da link dichiarano
  onestamente di non essere disponibili in alpha), footer Safi
  "Pronto ad aiutarti. / Safi è sempre con te."
- Glass con corpo (§7): tinta perla porta la percezione di opacità nella
  fascia richiesta; il contenuto vince sempre sullo sfondo.

## Asset (§16–18)

- `npm run mascot:assets`: 7 SVG di stato + set di leggibilità PNG
  22/32/64/256/1024 per stato + favicon/toolbar/menubar, deterministici,
  dalla STESSA geometria del widget (`SAFI_MASCOT_LAYOUT`).
- Icona app = testa di Safi + stellina (§17), icns/ico rigenerate.
- Palette §18 applicata (#DCEBFF / #86F7C1 / #FFE08A / #FF8B8B).

## Golden diff (§11–12)

- `tools/capture-golden.mjs` — cattura le 5 superfici contrattuali dal
  bundle release (compact crop alla capsula; expanded/verified/uncertain/
  failed dal pannello).
- `tools/golden-diff.mjs` — produce REFERENCE / CURRENT / OVERLAY / DIFF
  in `docs/visual-evidence/golden-diff/` per compact, expanded, verified,
  uncertain, failed. Le golden sono arbitri, non artefatti del run.
- Risultato corrente: **PASS** su tutte e cinque le superfici
  (geometria nella famiglia di contract, identità colore neutra/perla,
  centratura entro soglie).

Nota tecnica: Chrome headless "new" (153) non risponde più a
`Page.captureScreenshot`; l'harness usa `--headless=old` (compositore
affidabile, CDP completo) e la cattura compact usa viewport normale +
crop, perché sotto ~90 px di altezza il compositor headless si blocca.

## Verifica

- **146 test unitari+visual ✓ | 1 skip onesto** (il blur nativo reale
  richiede app installata + permesso schermo; mai fake-PASS).
- Conformance 9/9 · `tsc --noEmit` pulito.
- Bundle release = sorgenti (SHA-256 verificato su widget.html e ui/safi-mascot.js).
- Anti-parola CLEAN · nessun segreto nel repo.
- Release: `release/macos/Safi.app` + `Safi.dmg` (`hdiutil verify` VALID),
  checksum aggiornati.

## Chiusura (testo contrattuale, §13)

> Do not describe what you think you built. Show what you built.
> Do not report "Liquid Glass", "Safi v0.2", "faithful implementation" or
> "visual system complete" unless the actual release screenshot visually
> matches the provided golden references.
> Automated tests validate behavior.
> The supplied images validate appearance.
> If implementation and golden reference disagree, implementation fails.

Gli screenshot correnti del bundle release sono in
`docs/visual-evidence/golden-current/` e i fogli a quattro pannelli in
`docs/visual-evidence/golden-diff/`. L'accettazione è umana: la Fase 7
resta bloccata al segnale esplicito.
