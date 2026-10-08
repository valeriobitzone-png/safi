# Phase 6.1 — Desktop UI Repair Report

Data: 2026-09-19 · Impatto protocollo: **nessuno** · Core: **intatto**

## Root cause (dimostrata, non ipotizzata)

Il "quadrato bianco" era la combinazione di due difetti indipendenti:

1. **`ui/projection.js` non raggiungibile.** Il bridge hardenato serviva solo
   `/ui/safi-stamp.js`; lo stamp importa `./projection.js` → 404 → il grafio
   moduli della pagina falliva → **nessun JavaScript girava**. Restava l'HTML
   nudo: un pallino non stilizzato (glifo nero, larghezza di bottone) dentro
   una finestra 96×96 senza sfondo = un quadratino bianco. E `projection.js`
   non era nemmeno nello staging del bundle.
2. **La finestra navigava sulla porta di sviluppo hard-coded (`4180`)**, dove
   nell'app installata non c'è nulla (la porta reale è effimera): la webview
   partiva su una pagina inesistente prima ancora del redirect.

Riproduzione dalla build installata (punto 1 del mandato): bridge del bundle
avviato → pagina 200 ma `/ui/projection.js` = **404**; screenshot Chrome della
pagina esatta che vede la finestra: **100.0% bianco, 0.0% inchiostro**
(`docs/visual-evidence/before-white-square.png`).

## File corretti

| File | Cambiamento |
| --- | --- |
| `apps/desktop/widget.html` | Riscritto: CSS **tutto embedded**, boot state `● Safi / avvio…` visibile dal primo frame, **error boundary** (`Safi non è riuscito ad avviarsi` + Riprova + codice dev), pannello espandibile con drag, diagnostica (`__SAFI_DIAG__`: URL, readyState, moduli, customElements, bridge, errori, unhandledrejection). Mai bianco. |
| `apps/desktop/web/index.html` | Boot page del bundle: trasparente, pallino che respira; niente bianco né probe fittizi. |
| `apps/desktop/bridge.js` | Servita anche `/ui/projection.js`; nuova route token-gated `/api/host/surface` (solo interi clampati) → riga macchina `SAFI_SURFACE` su stdout per il ridimensionamento della finestra. |
| `apps/desktop/src-tauri/src/main.rs` | Navigazione reale solo dopo handshake (READY + porta effimera + token); parsing `SAFI_SURFACE` → `set_size`; window senza eventi inutili. |
| `apps/desktop/src-tauri/tauri.conf.json` | Finestra punta alla boot page del bundle (`index.html`), non alla porta dev. |
| `tools/stage-desktop-runtime.mjs` | Stagia `ui/safi-stamp.js` **e** `ui/projection.js`. |
| `tools/visual-harness.mjs` (nuovo) | Client CDP zero-dipendenze: attende lo stato reale della pagina, click sintetico via input pipeline, doppio rAF, screenshot + diagnostica. |
| `tools/png-analysis.mjs` (nuovo) | Decoder PNG + filtri (0–4), whiteFraction/colorFraction; validato su pagina di controllo rossa. |
| `tests/visual.test.ts` (nuovo) | 6 test visivi reali (sotto). |
| `package.json` | Script `test:visual`. |

## Screenshot (before / after)

- `docs/visual-evidence/before-white-square.png` — la pagina del bundle PRIMA: 100% bianco.
- `docs/visual-evidence/after-collapsed.png` — pallino compatto visibile con inchiostro reale.
- `docs/visual-evidence/after-expanded.png` — pannello aperto (Parla normalmente / Verifica una risposta).
- `docs/visual-evidence/after-failed.png` — verifica di `237 × 14 = 3218` → **FAILED**, chip rosso.
- `docs/visual-evidence/after-verified.png` — verifica di `237 × 14 = 3318` → **VERIFIED**, chip verde.

## Test eseguiti

`tests/visual.test.ts` — 6/6 PASS, tutti dal **bridge del bundle installato**
(`Safi.app/Contents/Resources/resources/safi`), con screenshot reali e assert
sui pixel:

1. bridge del bundle raggiungibile;
2. pallino compatto: inchiostro visibile nell'area del dot, mai frame vuoto;
3. pannello espanso: disegnato, non bianco;
4. risposta sbagliata → stamp FAILED renderizzato, chip rosso presente e verde assente;
5. risposta giusta → stamp VERIFIED, chip verde presente e rossa assente;
6. **click reale** (input pipeline CDP) sul pallino → il pannello si apre.

Suite completa dopo la riparazione: **122/122 test** · conformance **9/9** ·
typecheck pulito · demo:check PASS.

## Bundle macOS verificato

- `npm run app:build:macos` ricostruito con tutti i fix; hook e moduli UI
  verificati DENTRO il bundle (`grep` nel widget servito dal bundle).
- Prova d'avvio reale: `open Safi.app` → processo `safi-desktop` vivo, bridge
  Node **figlio dell'app**, porta effimera nuova, `/api/host/info` senza
  token → **401** (hardening attivo anche installato).
- **Riavvio**: kill + `open` → nuovo pid app + nuovo bridge + nuova porta,
  stesso risultato.
- `.dmg` rigenerato e verificato (`hdiutil verify`: VALID) e raccolto in
  `release/` con checksum aggiornato.

## Diagnostica WebView (punto 2 del mandato)

`window.__SAFI_DIAG__` raccoglie per ogni avvio: page URL (token escluso),
`document.readyState`, moduli caricati (ok/errore), `customElements.get("safi-stamp")`,
stato del bridge, errori e `unhandledrejection`. In `#dev=1` (o checkbox
developer) viene mostrata nella pagina; l'harness la esporta in JSON accanto
a ogni screenshot. Nessun secret nei log: il token non è mai registrato.
