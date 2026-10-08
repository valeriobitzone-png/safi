# Phase 6.2 — Liquid Glass Redesign Report

Data: 2026-09-19 · Impatto protocollo: **nessuno** · Core: **intatto** ·
Bridge, token, porta effimera, certificati, hash, verifier, traduzione
Human→AI e manual mode: **invariati** (stessi id, stessi hook, stesse API).

## Cosa è cambiato (solo presentazione)

| File | Cambiamento |
| --- | --- |
| `apps/desktop/widget.html` | Redesign **Liquid Glass** completo: un solo materiale (blur 22px + saturazione 1.6, riflesso superiore, luminosità interna, bordo capello, ombra nativa morbida); **capsula compatta** con i tre traffic lights minimi (chiudi/comprimi/espandi) + **✦ sparkle separato** che porta lo stato Safi; espansione fluida capsula → pannello (stessa trasformazione, nessuna "finestra bianca"); campi satinati senza bordi pesanti, divisori sottili, micro-modes `✦ Ask` / `✓ Verify`, pill di trust tinta pastello (mai badge pieno), microanimazioni morbide con `prefers-reduced-motion`. |
| `apps/desktop/web/index.html` | Boot page = stessa capsula in vetro con sparkle che respira. |
| `apps/desktop/host.js` | **Unico tocco non-puramente-CSS, e solo semantica di verifica onesta**: le risposte non-aritmetiche ora passano anche dal `verifier-source` (fonti esterne, adapter-based) con check richiesto `sources`. Nessuna corroborazione → INCONCLUSIVE → **UNCERTAIN**; contraddizione → FAIL; il vecchio comportamento (VERIFIED col solo coherence) certificava troppo: corretto. |
| `tools/visual-harness.mjs` | Esporta anche il bounding box della pill (`chipRect`) per assert pixel precisi. |
| `tests/visual.test.ts` | Aggiornati ai 7 stati di accettazione + assert su translucenza (tinta del wallpaper che traspare), traffic lights e tinte di trust; **8/8 PASS**. |
| `tools/collect-release.mjs` | Ship del DMG fresco (`Safi.dmg`); fallback al nome Tauri solo se manca. |

## Comportamento richiesto → implementato

- **Nessuna scheda bianca**: finestra trasparente, vetro frosted, bordo
  capello, glow interno, ombra nativa; il desktop traspare (testato con
  wallpaper di prova `#wp=1`: la tinta traspare dal vetro negli screenshot).
- **Capsula compatta**: `● ● ●  ✦` — i tre punti sono i controlli (11px,
  radial-gradient luminosi, coerenti coi traffic lights macOS), lo
  **stato Safi vive nello sparkle**, separato dai controlli.
- **Espansione fluida**: `glass-open` 260ms (scale+opacity dal punto della
  capsula), ritorno compatto automatico dopo lo stato terminale.
- **Trust nel vetro**: `● VERIFIED` / `◐ UNCERTAIN` / `○ FAILED` con tinte
  delicate (verde/ambra/rosso pastello) — glifo + etichetta + colore, mai
  il colore da solo.
- **Microanimazioni**: breathe, pulse sui microstati, transizioni 140–500ms;
  tutte disattivate con `prefers-reduced-motion`.

## Screenshot di accettazione (punto 10) — tutti dal bundle installato

`docs/visual-evidence/lg-*.png` (con `#wp=1`, wallpaper di prova per rendere
misurabile la translucenza; screenshot reali via CDP):

| Stato | Evidenza | Verifica pixel |
| --- | --- | --- |
| compact | `lg-compact.png` | capsula, 3 traffic lights, 0% bianco |
| expanded | `lg-expanded.png` | vetro + contenuti hairline, 0% bianco |
| translating | `lg-translating.png` | microstato "Safi sta traducendo…" |
| verifying | `lg-verifying.png` | microstato "Safi sta verificando…" |
| verified | `lg-verified.png` | pill verde, niente rossa/ambra |
| uncertain | `lg-uncertain.png` | pill ambra (UNCERTAIN **reale** via verifier) |
| failed | `lg-failed.png` | pill rossa, niente verde/ambra |

Tutti: **0.0% bianco**, tinta del vetro 35–48% (desktop che traspare).

## Non ho rotto nulla (punto 11)

- Suite completa: **124/124 test** (visual 8/8 inclusi) · conformance **9/9**
  · typecheck pulito · demo:check PASS.
- Scansione core: 0 match (nessun fetch/window/API key in `src/`).
- Anti-parola: 0 occorrenze. Nessun secret, nessun `.env`.
- Bridge: bind 127.0.0.1, porta effimera, token 401 senza credenziali
  (riverificato sull'app avviata), test avversari tutti verdi.
- App reale avviata con il nuovo design: bridge figlio dell'app, hardening
  attivo; DMG ricreato, verificato (`hdiutil verify` VALID) e rilasciato in
  `release/` con checksum aggiornato (`7a7b8f89…`).

## Bug trovato dal redesign (onesta del certificato)

Il nuovo test UNCERTAIN ha esposto che `verifyExternalAnswer` certificava
**VERIFIED** affermazioni fattuali col solo check di coherence (un "secondo
parere" senza fonti). Corretto usando il `verifier-source` esistente:
`requiredChecks: ["coherence", "sources"]`, senza correzione. Risultati
verificati via API: frase non corroborabile → `UNCERTAIN (coherence:PASS,
sources:INCONCLUSIVE)`; calcolo giusto → VERIFIED; calcolo sbagliato →
FAILED. Principio Fase 4 (mai falso VERIFIED) rafforzato, non allentato.
