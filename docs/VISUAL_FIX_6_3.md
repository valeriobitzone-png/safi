# SAFI VISUAL FIX 6.3 — Face Fidelity + Atomic Expand + Frosted Readability

Data: 2026-09-22 · Impatto protocollo: **nessuno** · Core: **intatto** ·
Bridge security (127.0.0.1, porta effimera, token): **invariata**

## Status: IMPLEMENTED — AWAITING VISUAL APPROVAL

Per il contratto (§10 / §14): nessuna fase visuale è "completata" finché
l'utente non guarda la build reale e approva. I test validano il
comportamento; gli screenshot validano l'aspetto.

## 1. Volto — face master, non facce indipendenti (§1–2)

`ui/safi-mascot.js` ora espone **`FACE`**, la geometria base unica:

```
eye:        { y: 46, dx: 14, r: 5.1 }   occhi tondi luminosi, SEMPRE
brow:       { lift: 8.5, r: 5.4, w: 1.8 }
smile:      { w: 17, lift: 5.2 }        sorriso aperto, punte rialzate
smallSmile: { w: 9.4, lift: 2.3 }
pursed:     { w: 12.4, dip: 3.1 }
cheek:      { y: 56.5, dx: 21, rx: 5.6, ry: 3.6 }
```

Tutti gli stati derivano da questi parametri (primitives `smilePath`,
`pursedPath`, `browArc`). Nessuna faccia è disegnata a parte.

Correzioni richieste e applicate:

- **IDLE occhi**: due pupille tonde, piene, con un solo highlight.
  Zero archi "tristi": la vecchia geometria a gocce pendenti è eliminata
  da IDLE; gli occhi ad arco restano SOLO per VERIFIED (∩ felice).
- **Sorriso**: `smilePath` disegna una ∪ larga con le **estremità più
  in alto del centro** (M y=55.3, controllo a 63.7 → punte a −5.2 unità
  sopra la pancia della curva). Verificato numericamente nel raster:
  l'inchiostro della bocca inizia alle punte (in alto) e scende al
  centro — geometria da sorriso, non da broncio.
- **Sguardo laterale (TRANSLATING)**: gli occhi scorrono dentro un
  `clipPath` (`glance-rig`): niente occhi che "escono dalla testa".

## 2. Nitidezza — Safi non viene mai sfocato (§3)

La figura vive sopra ogni blur:

- `#collapsed` e `#widget`: `isolation: isolate` + `z-index` separati —
  il vetro nativo è dietro, la mascotte è contenuto di primo piano;
- nessun `filter: blur` e nessuna `opacity < 1` sugli antenati della
  mascotte; l'unico filtro è il **glow** `drop-shadow` DI STATO, che è
  un colore attorno, non una sfocatura della figura;
- sorgente SVG vettoriale (niente upscaling di raster);
- il raster ufficiale è rigenerato dalla STESSA geometria: icone app
  (icns/ico deterministici) e asset 22→1024 px aggiornati;
- stella dorata sotto la testa, leggibile a 62 px come a 1024 px.

## 3. Espansione atomica (§5–7)

Prima: `expand()` mostrava il pannello e poi chiedeva il resize della
finestra — la finestra restava piccola finché un secondo evento non
forzava l'apertura completa.

Ora la macchina è:

```
COMPACT → EXPANDING → (resize nativo + verifica finestra) → EXPANDED
EXPANDED → COLLAPSING → (resize nativo + verifica finestra) → COMPACT
```

- **Dimensione fissa** (§7): pannello 384×430, finestra 396×442
  (+12 px di pad della shell), concordata tra widget e `main.rs`.
  La compact torna alla capsula 92×88 nativa.
- **Verifica reale** (§7): `waitForWindow()` confronta `innerWidth/
  innerHeight` col target (tolleranza 10 px) PRIMA di rivelare il
  pannello; l'esito è in `__SAFI_DIAG__.surfaceVerified`.
- `main.rs` gestisce i nuovi hint `EXPANDING`/`COLLAPSING`: ridimensiona
  la finestra mentre ENTRAMBE le superfici sono nascoste — nessun frame
  può mostrare un mezzo pannello.
- L'animazione di reveal parte solo su `EXPANDED`/`COMPACT` confermati
  (classi `glass-opening`).

## 4. Frosting con corpo (§8–12)

- Tinta di superficie 0.78 → **0.88** (`--glass-tint`), sopra il frosto
  nativo: wallpaper percepibile, non leggibile (target §9 ≈10–15% di
  influenza);
- Layer B più satinato della superficie (§11): field 0.52→**0.68**
  (focus 0.8), chips 0.52→**0.62** (hover 0.8), mode pills 0.42→**0.58**
  (attiva 0.86), tutti con hairline inset;
- Layer C (§12): ink scuriti (#243244 → family), tagline #4b5f70,
  footer-main #1e2c38, placeholder #4d6172 — nessuna opacity funzionale
  sotto 0.55;
- `#widget` ora ha `overflow: hidden auto` con scrollbar nascosta:
  nessun contenuto può sbordare dalla geometria fissa.

## 5. Compact (§13)

La struttura "solo Safi" è confermata; la figura cresce **56 → 62 px**
dentro la finestra nativa 92×88 (prima 80×80). Il lampeggio doveva
passare per `opacity` (< 1 = anti-nitidezza): ora è solo un controllo
scale della stella. Zero testo, zero traffic light, come da §3 del
brief rebuild.

## 6. Acceptance reale (§14–16)

- **20/20 cicli** `COMPACT → click → EXPANDED FULL → Escape → COMPACT`
  misurati IN PAGINA dal driver `cycles=N` (MutationObserver per i
  mid-open, verifica finestra per i late-resize):
  `fullOpen: 20/20, clipped: 0, midOpen: 0, lateResize: 0`.
- **Dimensione fissa**: `expandedRect == 384×430` (offsetWidth, immune
  dalla scala dell'animazione), `hasHorizontalClip: false`.
- **Nitidezza**: la figura non eredita blur/opacity; glow solo di stato.
- Screenshot reali dal bundle release: `docs/visual-evidence/
  golden-current/` (8 catture) + golden-diff **PASS 5/5**
  (`docs/visual-evidence/golden-diff/`).

## 7. Verifica

- 149 test ✓ + 1 skip onesto (credenziali assenti, SKIPPED onesto);
  conformance 9/9; `tsc --noEmit` pulito.
- Scan "client/environment name": CLEAN (regola permanente del repo).
- Scan nomi precedenti della mascotte: pulito su tutto il repo.
- Scan segreti: CLEAN.
- Bundle release = sorgenti (SHA-256 identici su widget + mascotte).
- Release: `release/macos/Safi.app` + `Safi.dmg` (hdiutil VALID) +
  checksums aggiornati.
