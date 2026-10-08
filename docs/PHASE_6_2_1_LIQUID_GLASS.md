# Phase 6.2.1 — Real Native Liquid Glass + Collapse Fix

Data: 2026-09-20 · Impatto protocollo: **nessuno** · Core: **intatto** ·
Bridge security (127.0.0.1, porta effimera, token, limiti): **invariata**

## Root cause dell'accettazione fallita (6.2)

1. **Il glass era solo CSS.** `backdrop-filter` su una WebView dentro una
   finestra opaca non è Liquid Glass: è un pannello semitrasparente piatto.
   Il test "0% bianco" passava comunque — un riquadro grigio opaco passa
   quello test. Da qui la riprogettazione.
2. **Nessun percorso di ritorno evidente** expanded → compact: la macchina
   UI non era implementata come contratto.
3. **Il resize non era fisico**: il pannello cresceva dentro una finestra
   grande, senza `set_size` nativo.

## Cosa è stato cambiato (solo shell, zero protocollo)

| Livello | Cambiamento |
| --- | --- |
| `Cargo.toml` | `window-vibrancy = "0.8"` + `objc2-web-kit` (tipi unificati con wry) + feature `macOSPrivateApi` |
| `src-tauri/src/main.rs` | `apply_liquid_glass(..., LiquidGlassOptions::content_view(...))` su macOS 26+: la WKWebView viene **reparentata dentro `NSGlassEffectView`** — il materiale lo fa macOS. Fallback `apply_vibrancy` per macOS precedenti; log onesto `[glass] …` |
| `tauri.conf.json` | `"transparent": true`, `macOSPrivateApi: true` |
| `widget.html` | `html,body{background:transparent !important}` su ogni superficie principale; **underlay dimostrativo** `wp=1` (bande blu/viola hard-edged) prependato a z-index sotto le superfici; macchina UI COMPACT ⇅ EXPANDED con **resize nativo reale** (compactSize/compactPosition salvate), rosso=close, giallo=collapse, verde=toggle, `Escape`→compact, `Enter/Space`=toggle (WCAG); `DIAG` esteso (`mode`, `glass`, `spark`, `trust`) |
| `bridge.js` | `/api/host/info` espone `host.nativeGlass` (dalla shell via env), pass-through `mode` |
| `visual-harness.mjs` | **Determinismo**: Chrome parte su `about:blank`, l'harness naviga via CDP `Page.navigate` (niente più New Tab race); click/keyboard driver = attivazione DOM reale (stessa catena listener di mouse/tastiera fisiche); `--eval` per introspezione |

## Trasparenza: prova con ciò che sta dietro (non più "% bianco")

Screenshot reali con pattern blu/viola hard-edged **dietro** Safi:

- **Headless (bundle, CDP):** bande blu/viola che trasparono dalla pagina,
  **0,0% bianco**; il gradient interno della cattura è coerente con
  pattern smussato, non con una tinta piatta opaca.
- **App reale (vetro nativo), capsula compatta:** pattern visibile
  **attraverso il vetro** — A/B alla stessa posizione e stesso desktop:
  con `wp=1` blu+viola ≈ 15,5% dei pixel della finestra; senza, la stessa
  area mostra il desktop scuro. Il vetro mostra davvero ciò che sta dietro.
- **App reale, pannello espanso:** pattern attraverso il vetro ≈ 12,9%,
  bianco ≈ 2,4% (solo testo/controlli).
- **`nativeGlass:true`** confermato via `/api/host/info` + log shell
  `[glass] native liquid glass applied (WKWebView inside NSGlassEffectView)`,
  e riprovato sul build di release.

## Macchina UI e resize fisico (Definition of Done E–F)

Timeline reale dei bounds della finestra con `autocycle=1` (CGWindowList):

```
226×193 → 114×60 → 226×193 → 114×60   (expand → collapse → expand → collapse)
```

La finestra nativa **cambia davvero dimensione** e torna esattamente
compatta; posizione ripristinata. `Escape`, giallo e verde sono tre vie
indipendenti di ritorno alla capsula.

## White-flash (G)

Frame iniziali al boot confrontati col baseline del desktop: la regione
finestra è **identica al desktop** (≈2,7% bianco = contenuto del desktop,
non della finestra). Nessun rettangolo bianco a launch, expand, collapse.

## Bug trovati e corretti in questa fase (tutti shell/test, nessun protocollo)

- Token troncato nel test (`[A-Za-z0-9]+` vs base64url) → 401 fantasma.
- Underlay su `body` (altezza 0 con overlay fixed) → underlay reale prependato.
- Harness che si agganciava alla New Tab di Chrome → navigazione CDP esplicita.
- `beforeAll` del test che usciva silenziosamente (probe screencapture a
  regione fallito su questa macchina) + `spawn` non importato → ReferenceError
  silenzioso; + `require()` di un `.mjs` in ESM; + decoder PNG inline che
  leggeva PNG RGB (color type 02) come RGBA ("87% bianco" falso).
- `screenPermOk()` ora usa la cattura a schermo intero (che funziona) e i
  test rispettano lo skip a runtime.

## Batteria finale

- `npm test` → **128 passed | 1 skipped (129)**, 10 file (include i 13 visual).
- Visual 6.2.1: 12 ✓, 1 skip **onesto** — i test "blur nativo" girano solo
  con permessi schermo + app avviata (in headless il vetro nativo non può
  esistere; mai fake-PASS).
- Conformance: 9/9. `tsc --noEmit`: pulito.
- Anti-parola: CLEAN su tutto il repo (esclusi build artifact).
- Segreti: nessuno; il token di sessione **non** è su disco né nei log
  ("handed to the embedder only"), verificato sul run finale.
- Build release: `npm run app:build:macos` → OK; bundle = sorgenti
  (SHA-256 del widget identico in `src`, `resources/`, `.app`).
- `release/`: `macos/Safi.app` + `macos/Safi.dmg` (`hdiutil verify` →
  **VALID**, SHA-256 `6febfe80…` in `checksums.txt`) + `BUILD_REPORT.md`.

## Definition of Done — stato

- **A/B** (wallpaper attraverso capsula e pannello): provato in headless e
  **sul desktop reale** con vetro nativo (cifre sopra + screenshot in
  `docs/visual-evidence/lg-*`).
- **C** nessun bianco nelle superfici principali: 0,0% headless, 2,4% reale
  (testo).
- **D** materiale realmente frosted: `NSGlassEffectView` con WebView dentro
  (non imitazione CSS).
- **E/F** ritorno compatto + resize fisico reale: timeline bounds sopra.
- **G** niente white flash: provato.
- **Accettazione visiva finale: umana.** L'app è lasciata in esecuzione con
  il bundle di release per l'ispezione diretta.
