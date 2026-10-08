# Safi Visual System v0.2 — Release

Data: 2026-09-20 · Impatto protocollo: **nessuno** · Core, trust semantics,
certificate, transport, verifier: **intatti** · Glass nativo, bridge
security, state machine COMPACT⇅EXPANDED: **invariati**

## Un personaggio, tutti gli stati

Safi — *il guardiano della chiarezza* — è l'unica mascotte Safi. La figura
vive in `ui/safi-mascot.js`: markup SVG parametrico con **ogni stato presente**,
mostrato via `data-state` + CSS condiviso (`SAFI_MASCOT_CSS`). La stessa geometria
(`SAFI_MASCOT_LAYOUT`) alimenta i generatori deterministici: widget, asset e icone
sono **una sola figura**.

| Stato | Colore (glow/tinta) | Occhi | Bocca | Extra | Cartello |
| --- | --- | --- | --- | --- | --- |
| idle | perla #DCEBFF | dolci (pupilla+1 highlight) | sorriso | respiro, stellina che luccica | — |
| understanding | perla | attenti | sorriso | head-tilt + micro-dots "…" | — |
| translating | perla | occhiata sx↔dx | sorriso | scintille; occhi che scorrono | — |
| verifying | perla | attenti | sorriso | lente con micro-scan, micro-tilt | — |
| verified | mint #86F7C1 | felici ad arco | sorriso | glow→cartello→bounce (≈380ms, non loop) | ✓ verde |
| uncertain | ambra #FFE08A | strizzati (uno più stretto) | piccola | head-tilt hold | ? ambra |
| failed | corallo #FF8B8B | stretti + sopracciglia | contrariata | guance puff, micro-puff laterale | ! rosso |

Il colore non è mai l'unico segnale: espressione + cartello + label
accessibile accompagnano sempre (il glow perla di idle resta il riposo).

## Icona e asset ufficiali (deterministici, zero-dep)

- `npm run mascot:assets` → `assets/safi-mascot/`: `safi-mascot-<state>.svg` (vettoriale,
  standalone) + `safi-mascot-<state>-{22,32,64,256,1024}.png` per ogni stato +
  `favicon.{ico,png}`, `toolbar.png` (64), `menubar.png` (22).
- `npm run app:icon` → **l'icona app è la testa di Safi + stellina** su
  fondo perla squircle (§17: niente cartello, riconoscibile senza testo);
  icns/ico rigenerabili (sips su host macOS).
- `tools/mascot-raster.mjs`: rasterizza **la stessa geometria** del widget
  (SAFI_MASCOT_LAYOUT) con anti-alias 3×3; provato a 22/32/64/256/1024 px.

## Widget

- **COMPACT**: `● ● ●` + **Safi ~30px** — è lui l'indicatore Safi;
  viso e colore cambiano col trust state. **Zero testo** (test 6.2.2
  aggiornato: `compactInnerText === ""`).
- **EXPANDED**: header `Safi + ✦ Safi` + tagline **"Capisce. Traduce.
  Verifica."**; pannello con **corpo** (tinta perla `rgba(232,242,255,.47)`
  sopra il frosto nativo) per contrasto e leggibilità (§13); Safi header
  cambia colore/espressione col risultato.
- La logica Safi è gated: se `window.SAFI_MASCOT_*` manca, il widget carica
  `/ui/safi-mascot.js` dal bridge (aggiunto a staging + routing); errori precoci
  degradano in `showFatal` senza rompere il boot.
- Label trust aggiornate nel widget: VERIFIED "Verificato", UNCERTAIN
  "Non certo", FAILED **"Problema rilevato"** (più chiara di "Non
  verificato"). Le proiezioni cross-host del Core (projection.js,
  safi-widget) restano **invariate** — contratto già approvato.
- Glifi dei cartelli come **tratti vettoriali** (niente `<text>`): font-
  independent e senza leak di innerText da SVG display:none (quirk Chromium
  trovato e corretto in questa fase).
- Microanimazioni: un'azione dominante per stato; `prefers-reduced-motion`
  rispettato su ogni keyframe aggiunto.

## Screenshot di accettazione (§20) — bundle release, wallpaper blu/viola dietro

`docs/visual-evidence/`: **safi-mascot-idle, safi-mascot-understanding, safi-mascot-translating,
safi-mascot-verifying, safi-mascot-verified, safi-mascot-uncertain, safi-mascot-failed, compact,
expanded, expanded-to-compact** — 10/10 catture CDP dal bundle installato,
con verifica DOM (`safi-mascot`/`headerMascot` sincroni) per i sei stati.

## Qualità

- **142 passed | 1 skipped (143)** in 11 file (nuovi: `tests/safi-mascot.test.ts`
  — 10 test: vocabolario stati, palette, espressioni per stato, falci
  gentili del failed, leggibilità raster 22→1024, tinte di stato distinte,
  asset set completo, PNG validi, **repo privo di riferimenti al vecchio
  personaggio**).
- Conformance 9/9 · `tsc --noEmit` pulito · anti-parola CLEAN.
- Guard automatico nel test Safi: il repo resta privo di riferimenti
  al vecchio personaggio pre-Safi (zero corrispondenze in
  UI/app/packages/docs/assets).
- Release ricostruita: Safi.app + Safi.dmg (`hdiutil verify` VALID),
  `release/` aggiornata, bundle = sorgenti (SHA-256 verificato).

## Regola ricordata

Una suite di test verde **non** è approvazione estetica: l'accettazione
finale di Safi è umana, guardando le catture e l'app avviata.
