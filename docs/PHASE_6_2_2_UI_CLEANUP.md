# Phase 6.2.2 — Release UI Cleanup

Data: 2026-09-20 · Impatto protocollo: **nessuno** · Core: **intatto** ·
Glass nativo, bridge security, token, porta effimera: **invariati**

## Root cause del testo tecnico nel widget release

**Un bug di commento HTML.** Il commento d'intestazione del widget conteneva
il diagramma della macchina a stati con le frecce `-->` (es.
`COMPACT --green--> EXPANDED`). In HTML **il primo `-->` chiude il
commento**: tutto il resto del blocco (stati, Escape, resize, note shell)
diventava testo del body — e nel vetro trasparente traspariva sopra il
desktop. I test 6.2.1 non lo vedevano perché nessuno misurava il **testo
visibile**, solo i pixel.

Secondo difetto trovato indagando: il pannello espanso veniva nascosto con
la **classe** `hidden`, che non ha regola CSS → l'intero pannello restava
renderizzato dietro la capsula (innerText di Ask/Verify/chiedi/verifica
presente in COMPACT). Ora l'occultamento usa l'**attributo** `hidden`,
coperto dalla nuova regola globale `[hidden]{display:none !important}`.

## Correzioni (solo shell)

| File | Correzione |
| --- | --- |
| `widget.html` (commento) | Diagramma riscritto senza sequenze di terminazione; aggiunta nota che vieta `-->` nei corpi dei commenti |
| `widget.html` (CSS) | `[hidden] { display: none !important; }` — hard guard globale |
| `widget.html` (markup) | `#widget` parte `hidden` (attributo); riga "Modalità developer" `id="devrow"` con `hidden` di default |
| `widget.html` (JS) | `setMode` usa `widgetEl.hidden`; `showFatal` idem; Developer View gated: `devAllowed()` = host `devMode` **o** backdoor esplicita `window.__SAFI_DIAG_DEV__=true` da console browser; `dumpDev()` non monta mai testo in release |
| `bridge.js` | `/api/host/info` espone `host.devMode` |
| `main.rs` | `SAFI_DEV=1` impostato **solo** con `#[cfg(debug_assertions)]` — le shell release non lo abilitano mai |

## Diagnostica solo in development (come richiesto)

- `window.__SAFI_DIAG__` e log console restano il canale tecnico (mai DOM).
- Dev Inspector visibile solo con dev build (`SAFI_DEV=1` → `host.devMode`)
  o backdoor esplicita in sessione browser; in release la riga developer è
  rimossa dal DOM visibile e `dumpDev()` è no-op.
- In COMPACT l'unico contenuto della pagina è il glyph `✦` (verificato:
  `document.body.innerText === "✦"`).

## Test nuovi obbligatori (tutti verdi sul bundle release)

1. **Statico** — i commenti del markup sono bilanciati (un `-->` per ogni
   `<!--`) e nessun testo della macchina a stati sopravvive allo stripping:
   previene per sempre la classe di bug 6.2.1.
2. **COMPACT zero-testo** — `compactInnerText === "✦"` e nessun nodo con
   testo proprio visibile matcha il vocabolario tecnico
   (EXPANDED/COMPACT/toggle/Escape/debug/fixture/developer/state machine/resize).
3. **EXPANDED senza lessico da sviluppatore** — l'innerText del pannello
   espanso non contiene le stringhe vietate
   (EXPANDED, COMPACT, toggle, Escape, debug, test, fixture, dev).

Batteria: **131 passed | 1 skipped (132)** in 10 file (skip onesto:
blur nativo richiede app+permessi schermo) · conformance 9/9 · `tsc` OK ·
anti-parola CLEAN · nessun segreto.

## Screenshot acceptance (bundle release, CDP dal bundle)

`docs/visual-evidence/lg622-*.png`:

- **COMPACT** — solo vetro + ● ● ● + ✦; `body.innerText === "✦"`;
  0,0% bianco.
- **EXPANDED** — interfaccia pulita (✦ Safi, Ask/Verify, campo, azioni);
  nessuna istruzione da sviluppatore.
- **COLLAPSED AGAIN** — dopo click veri su verde poi giallo:
  `uiMode:"COMPACT"`, pannello `hidden:true`, superficie nativa 105×30,
  `compactText:"✦"`.
- **Probe testo pagina in COMPACT: `"✦"` — nessuna altra scritta.**

## Release

`npm run app:build:macos` → OK; DMG `Safi.dmg` ricreato dal bundle fresco
(`hdiutil verify` VALID) e raccolto in `release/macos/` con checksum
aggiornato.

## Nuova regola di governance (anti-regressione estetica)

> **Una suite di test verde non equivale ad approvazione estetica.**
> Ogni modifica della shell Safi richiede screenshot della vera build
> release (headless CDP dal bundle + cattura sul desktop reale quando
> tocca il vetro/le finestre) e approvazione visiva umana prima di
> dichiarare la fase completata.

La regola è registrata in questa sezione della VALIDATION_REPORT e vale
da ora per ogni fase shell/UI futura (inclusa la Fase 7).
