# SAFI Visual Rebuild — Golden UI + Safi Mascot

Data: 2026-09-22 · Impatto protocollo: **nessuno** · Core/conformance/bridge: **intatti**

## Status: IMPLEMENTED — AWAITING VISUAL APPROVAL

Per il brief (§14) e il contratto (§10) questa fase **non è dichiarata
completata**: diventa **VISUALLY ACCEPTED** solo dopo la conferma visiva
umana sulle catture reali del bundle release.

## 1. Naming freeze (§13) — eseguito e bloccato dai test

- La mascotte è **Safi** ovunque; il token tecnico di disambiguazione è
  `safi-mascot` (modulo `ui/safi-mascot.js`, asset `assets/safi-mascot/`,
  prefissi `data-mascot`, `sm-*`, `safi-mascot-*`).
- Rinominati file, codice, asset, CSS, keyframe, test, documenti.
  **`grep -ri lumo` sul repo = 0.**
- Il guard anti-personaggio precedente (test mascot + contratto) resta
  attivo come anti-regressione sul nome vietato.
- Master canonico: `safi-mascot-master.svg`; golden references:
  `golden/safi-character-sheet.png` + `golden/safi-ui-board.png`.

## 2. Widget compact (§3) — solo Safi

- Traffic light **rimossi** dalla modalità compatta: la superficie è
  **solo la figura** (56 px, finestra nativa 80×80).
- Click sull'oggetto → EXPANDED. Zero testo sulla superficie (i test
  6.2.2 continuano a passare); lo stato vive nel volto/glow della figura.

## 3. State machine (§9) — nessun vicolo cieco

- COMPACT → EXPANDED: click sulla mascotte (o Invio/Spazio, WCAG).
- EXPANDED → COMPACT: **Escape**, **controllo ambra** in header pannello
  (pallino satinato, mai nascosto), **click esterno** a qualsiasi
  superficie Safi.
- Il rosso come "chiudi" resta una capability della shell (tray), non
  più un controllo sulla superficie compatta.

## 4. Pannello con corpo (§4–6)

- Layer A — superficie: tint perla densa (rgba(226,238,252,0.78)) sopra
  il frosto nativo: il wallpaper resta percepibile ma il contenuto vince.
- Layer B — controlli: input/pill/chip portati a opacità superiore
  (0.42–0.72), satinati, mai bianco pieno.
- Layer C — testo: ink scurito (#243244 / #43564c), placeholder più
  leggibile (#5f7386).
- La base della mascotte resta perla in ogni stato: il trust arriva da
  glow/guance/cartello (§2/§8 del contratto).

## 5. Microcopy (§ finale)

`Safi sta verificando…` · `Safi non è ancora sicuro.` · `Safi ha trovato
un problema.` — registrati in `MASCOT_LINES`, **mai renderizzati** sulla
superficie utente: esistono per il Developer Inspector e la diagnostica.

## 6. Icone deterministiche

- Il generatore icone ora scrive **direttamente** `icon.icns` (contenitore
  icns con pagine PNG 32/128/256/512) e `icon.ico`: niente sips, catena
  sandbox-proof e byte-deterministica su ogni host.
- L'icona è la testa di Safi + stellina su fondo perla, dalla STESSA
  geometria del widget (`SAFI_MASCOT_LAYOUT`).

## 7. Visual acceptance (§11–12)

- 8 catture reali dal bundle release in `docs/visual-evidence/golden-current/`:
  compact (idle/verified/uncertain/failed), expanded (idle), verified,
  uncertain, failed.
- `tools/golden-diff.mjs` (REFERENCE/CURRENT/OVERLAY/DIFF): **PASS 5/5**.
- L'ancora di riferimento compact è ora la figura stessa del character
  sheet (famiglia aspect 0.7–1.6), non più la vecchia pillola.

## 8. Verifica

- Batteria: **146 ✓ + 1 skip onesto**, conformance 9/9, TSC OK.
- Bundle byte-identico ai sorgenti (SHA-256), nessun segreto, anti-parola
  client CLEAN.
- Release aggiornata: `release/macos/Safi.app` + `Safi.dmg` (hdiutil
  VALID) + checksums.

> Do not describe what you think you built. Show what you built.
> Automated tests validate behavior. Release screenshots validate
> appearance. If implementation and golden reference disagree,
> implementation fails.

L'app di release è avviata sul desktop per l'accettazione visiva umana.
