# MASCOT LOCK — PRODUCTION ASSETS INTEGRATED

**Status: MASCOT LOCKED — PRODUCTION ASSETS INTEGRATED (2026-09-24)**
Impatto protocollo: **nessuno** · Core: **intatto**

## Cosa è successo

Il brief PRODUCTION ASSET INTEGRATION ha stabilito che i **production
asset forniti dall'utente** sono l'unica source of truth della mascotte
Safi. Il pacchetto `safi-production-mascot-pack.zip` (SHA-256
`1fc849033ab661c95ab7e47cd919b3217cb24f5c518ec9d61e2f6336939b6850`) è
stato importato verbatim in `golden/production-mascot/` e verificato:

- **21/21 file** presenti: 7 HERO (512×512), 7 UI (128×128), 7 MICRO (64×64);
  stati `idle, understanding, translating, verifying, verified, uncertain,
  failed`;
- **21/21 checksum SHA-256 e byte count** conformi a
  `golden/production-mascot/MANIFEST.json`;
- PNG 8-bit RGBA (trasparenza), nessun file inatteso nella tree.

Gli asset **non sono stati modificati**: nessun ritaglio, nessuna
ricolorazione, nessuna ricostruzione, nessun ridimensionamento salvato.

## Sorgente di verità e mapping ottico

Ogni pixel visibile di Safi viene da un `<img>` che punta a uno dei 21
master serviti dal bridge (`GET /mascot/{tier}/safi-{tier}-{state}.png`).

| dimensione resa | master |
|---|---|
| 0–72 px | MICRO (64×64) |
| 73–180 px | UI (128×128) |
| > 180 px | HERO (512×512) |

- compact: capsula 76×76, finestra nativa **88×88**, visual 60×60 → MICRO;
- pannello espanso: header 44 px e footer 26 px → MICRO; la sola eccezione
  documentata è che **nessun master viene mai ridotto da HERO** per fare un
  widget piccolo;
- Dock / icona app: composizione del master consegnato secondo la stessa
  tabella (≤72 MICRO, 73–180 UI, >180 HERO).

La pagina esegue un audit a runtime (`DIAG.mascotTierAudit`): se la
dimensione resa di un host e il tier dichiarato non coincidono, registra un
errore. I test bloccano la stessa regola a build time.

## IDLE — acceptance condition

Nel master IDLE consegnato sono distinguibili, a colpo d'occhio e a 4×:
occhio sinistro, occhio destro, highlight degli occhi, piccolo sorriso,
guance e stella dorata. `tests/mascot.test.ts` lo verifica con sonde
pixel sui due lati della banda occhi, sul sorriso sotto gli occhi, sulle
guance calde bilateral e sul cluster oro della stella.

## Procedurale: archiviato, zero pixel

Il sistema procedurale non produce più nulla a runtime:

- `apps/desktop/widget.html` non importa più `ui/safi-mascot.js`, non
  contiene markup SVG, `FACE`, `smilePath`, `browArc`, occhi o bocca
  generati (guard statici in `tests/mascot.test.ts`);
- il bridge non serve più `ui/safi-mascot.js` e la pagina non lo richiede;
- `tools/stage-desktop-runtime.mjs` non mette più il modulo procedurale nel
  bundle, ma copia `golden/production-mascot/` byte-identico;
- `ui/safi-mascot.js`, `tools/mascot-raster.mjs`,
  `tools/gen-mascot-assets.mjs` e `assets/safi-mascot/*` restano su disco
  come **archivio storico** ( congelati, non referenziati dalla runtime).
  Da `mascot-raster.mjs` si riusano **solo** gli encoder di formato
  (`encodePng`, `writeIcns`, `writeIco`), mai il disegno.

## Mascotte nitida (brief §11)

La catena di rendering è: wallpaper → blur nativo → tint → superficie UI →
**asset sharp** → testo sharp. L'asset non ha mai `filter`, `opacity < 1`,
`mix-blend-mode` o antenitori che lo facciano: il glow di stato vive sul
**host** (`box-shadow`), mai sull'asset. Il test visuale verifica la catena
di antenitori a runtime.

## Icona app (2026-09-24)

L'icona dell'app è generata da `tools/gen-icon.mjs` componendo il master
IDLE consegnato sul tile perla, con lo stesso mapping ottico. La pipeline
non contiene più codice di disegno della figura: il generatore importa solo
gli encoder di formato. I test verificano che l'icona contenga davvero
l'inchiostro della mascotte (occhi/bocca) e gli accenti caldi (stellina,
guance) a 32, 128 e 512 px.

## Reference board

`golden/safi-mascot-reference-board.png` resta **solo reference, non
operativa**: non è usata, ritagliata o ridisegnata. La palette glow della
tavola (Idle #EAF0FF, Understanding #A5C8FF, Translating #7DD3FC,
Verifying #C4B5FD, Verified #34D399, Uncertain #FBBF24, Failed #F87171) è
stata riconciliata durante l'integrazione: vive nei token
`--safi-glow-*` e nel glow del **surface**, non sugli asset.

Lo status corrente è:

**MASCOT LOCKED — PRODUCTION ASSETS INTEGRATED**
