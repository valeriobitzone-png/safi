# Safi v0.1 — Validation Report

Validation run: 2026-09-17

Phase 2 re-validation (Transport + Human→AI Translation): 2026-09-18.
See the end of this report.

## TypeScript reference core

Command:

```text
tsc -p tsconfig.json
```

Result:

```text
PASS
```

The current reference TypeScript core and example compile cleanly with the available TypeScript compiler.

## Zero-dependency conformance vectors

Command:

```text
node tests/run-conformance.mjs
```

Result:

```text
PASS 001-no-checks-uncertain.json: UNCERTAIN
PASS 002-pass-verified.json: VERIFIED
PASS 003-fail-failed.json: FAILED
PASS 004-inconclusive-uncertain.json: UNCERTAIN
PASS 005-missing-required-uncertain.json: UNCERTAIN
PASS 006-optional-failure-ignored-by-scope.json: VERIFIED
PASS 007-conflicting-pass-fail-uncertain.json: UNCERTAIN
PASS 008-pass-plus-inconclusive-uncertain.json: UNCERTAIN
PASS 009-fail-plus-inconclusive-failed.json: FAILED

9 conformance vectors passed.
```

## Runtime smoke test

Command:

```text
node dist/examples/basic-flow.js
```

Result:

```text
PASS
```

The runtime produced a `RESULT` with:
- status `VERIFIED`;
- policy identifier;
- explicit verification scope;
- check results;
- SHA-256 hash of the exact human-facing response;
- attempt history.

## JSON Schema definitions

All current JSON Schemas pass Draft 2020-12 schema validation.

Result:

```text
PASS
```

Schemas checked:
- candidate-response
- human-request
- intent-frame
- safi-certificate
- safi-outcome
- safi-request
- safi-result
- verification-attempt
- verification-policy
- verification-result

## Example payload validation

Validated against the Safi schemas:

- `examples/verified-result.json`
- `examples/clarification.json`
- `examples/uncertain-result.json`

Result:

```text
PASS
```

## Architectural safety checks now encoded

- no verification scope -> never VERIFIED;
- missing required check -> UNCERTAIN;
- verifier exception -> never PASS;
- conflicting PASS/FAIL -> UNCERTAIN;
- bounded correction;
- correction cannot weaken verification scope;
- correction cannot replace original human message, goal or task;
- humanization occurs before final verification;
- certificate hash binds the exact human-facing answer;
- no semantic rewrite after certification.

## Remaining local implementation work

Resolved locally on 2026-09-18. The implementation agent ran:

```text
npm install
npm run build      (tsc -p tsconfig.json)
npm run check      (vitest: 35/35 passed)
npm run conformance (node tests/run-conformance.mjs: 9/9 passed)
npm run smoke      (node dist/examples/basic-flow.js: RESULT, VERIFIED)
npm run validate   (ajv: all example payloads valid)
```

All checks pass. The implementation handoff now lives in
`handoff/IMPLEMENTATION_PROMPT.md`; extend the integration tests from there.

## Phase 2 re-validation — Transport + Human→AI Translation (2026-09-18)

Protocol extension documented in `rfcs/0001-transport-and-translation.md`.
No v0.1 semantic changed; all original conformance vectors pass unchanged.

Commands and results:

```text
npm run typecheck    PASS
npm test             PASS (translation + transport suites added)
npm run conformance  PASS (9/9 vectors, unchanged)
npm run smoke        PASS (node dist/examples/basic-flow.js)
node dist/examples/transport-loop.js  PASS (EMBEDDED, COMPANION, MANUAL)
npm run validate     PASS (2 new schemas: semantic-representation, safi-stamp)
```

Newly encoded properties:

- informal human phrases translated without changing their purpose;
- provider-neutrality guard on semantic representations;
- changing provider does not change the interpreted intent;
- EMBEDDED, COMPANION and MANUAL produce the same SAFI meaning;
- input and output captured automatically through a transport adapter;
- manual transport works with no integration;
- no transport can alter the certificate (deep-frozen outcomes; stamp is
  a read-only projection).

## Phase 3 re-validation — UX / Visual Contract (2026-09-18)

Presentation-only addition governed by `UX_VISUAL_SPEC_v0.1.md`.
Core untouched: no protocol type, engine, transport or schema changed.

Artifacts:

```text
ui/projection.js    pure projection logic (frozen display data)
ui/safi-stamp.js    reference Web Component (zero dependencies)
ui/mocks/           desktop, mobile, companion, manual reference states
```

Commands and results:

```text
npm run typecheck    PASS (src/ unchanged)
npm test             PASS (projection suite added; 61/61 total)
npm run conformance  PASS (9/9 vectors, unchanged)
npm run smoke        PASS
```

Encoded UX properties:

- three disclosure levels (● → one-line trust → scope/evidenze/
  tentativi/timestamp/provider/hash);
- final states VERIFIED / UNCERTAIN / FAILED with distinct glyph, label
  and ARIA name: color never the only signal;
- pipeline micro-states ("Safi sta capendo…", "Safi sta traducendo…")
  for the Human→AI direction; technical prompt never shown by default;
- developer-mode inspection of HumanRequest, IntentFrame,
  SemanticRepresentation, SafiRequest (read-only);
- no graphic component can modify a SafiCertificate, trust status or
  semantic request (projections frozen; component has no setter).

## Phase 4 re-validation — Real end-to-end proof (2026-09-18)

Adapter packages added OUTSIDE the core (`packages/`): the core, trust
states, normative schemas and the UX spec are unchanged.

```text
packages/core/                  structural boundary over the unchanged core
packages/adapter-provider-demo/ env-only real provider + deterministic demo provider
packages/verifier-calculation/  model-independent arithmetic verifier
packages/verifier-source/       external-source verifier (keyless, fetchFn injectable)
packages/transport-manual/      MANUAL transport with frozen outcomes
packages/demo-web/              five scenarios + zero-dep local server + manual page
```

Commands and results:

```text
npm run demo:check  PASS (6 checks across the five scenarios)
npm test            PASS (package suite added; 80/80 total)
npm run conformance PASS (9/9 vectors, unchanged)
npm run typecheck   PASS (src/ unchanged)
npm run demo        local server at http://127.0.0.1:4173
```

Demonstrated properties:

- colloquial input ("sta cosa dei buchi neri semplice semplice")
  translated with intent preserved; the person never writes a prompt;
- a really VERIFIED answer: the arithmetic verifier is independent of
  any model and agrees with the provider only when the math is right;
- a really UNCERTAIN answer: insufficient external evidence is never
  forced to VERIFIED;
- a really FAILED answer: a directly contradicted claim fails against
  its source;
- a planted error corrected at the second attempt, with the certificate
  keeping the history of both attempts;
- the certificate hash equals the SHA-256 of the exact shown answer in
  every scenario;
- no provider, browser, search engine or API dependency inside the core
  (structural test over src/);
- credentials come exclusively from environment variables; no key or
  secret exists in the repository (structural test + no .env);
- the demo starts with a single command (npm run demo).

## Phase 5 validation — Official app + Cross-Platform Companion (2026-09-19)

App packages added OUTSIDE the core (`packages/`, `apps/`): the core,
trust states, normative schemas, conformance suite and UX spec are
unchanged.

```text
packages/safi-client/  the ONE protocol consumer (submit, translate,
                       execute, verify, getCertificate)
packages/safi-widget/  one widget brain: 6 pipeline states + 3 trust
                       states, per UX_VISUAL_SPEC_v0.1
packages/host-contract/ consent-first capabilities; nothing sensitive
                       granted by default
apps/desktop/          Desktop Alpha (macOS + Windows): floating widget,
                       loopback bridge, Tauri 2 thin shell, packaging
apps/android/          architecture + working mock (bubble behind explicit
                       overlay permission)
apps/ios/              architecture + working mock (no global overlay:
                       app, Share/Safari extensions, Shortcuts)
```

Commands and results:

```text
npm test             PASS (103/103; app suite: consent, client, widget,
                     cross-host, no-secret, core-untouched)
npm run conformance  PASS (9/9 vectors, unchanged)
npm run typecheck    PASS (src/ unchanged)
npm run smoke:wire   PASS (real provider speaks the OpenAI-compatible
                     wire shape against a local stub; no key, no network)
npm run smoke:live   SKIPPED honestly: SAFI_DEMO_API_KEY not set in this
                     environment (env-only credentials; wire smoke covers
                     the shape). Re-runnable with env vars only.
npm run app:icon     PASS (deterministic PNG icons; repeated runs are
                     byte-identical — reproducible packaging)
npm run app          PASS (loopback bridge smoke: widget page 200,
                     /api/host/ask VERIFIED, pasted wrong math FAILED,
                     empty input clean error, 127.0.0.1 bind only)
```

Demonstrated properties:

- one brain, four hosts: the SAME certificate projects identically on
  macOS, Windows, Android and iOS (test: equal stamp, glyph, label,
  ARIA and trust state);
- hosts are consumers only: no trust semantics duplicated in any host;
  a missing required check correctly certifies UNCERTAIN (found and
  fixed: the mobile adapters did not register their coherence
  verifier, so every run was honestly UNCERTAIN — the certificate was
  right about its host);
- consent-first: clipboard, overlay bubble, companion interception and
  telemetry start denied; granting and revoking are explicit; no hidden
  polling or screen capture anywhere;
- desktop alpha: floating frameless widget collapsing to the single
  dot, manual Human→AI, verify pasted answers (arithmetic failures
  certify FAILED), dev inspection, tray Show/Quit via Tauri 2;
- packaging: reproducible icons (no binary assets in git), loopback
  binding, minimal webview capability, no secrets in the bundle;
- Android and iOS: architecture, host contracts and executable mocks;
  every permission requested only when needed and explained.

## Phase 6 validation — Hardening + Installable Alpha (2026-09-19)

The core, trust states, normative schemas, conformance suite and UX
spec remain untouched (byte-for-byte). All Phase 6 work is outside:
`apps/`, `tools/`, `tests/`.

### 1. Loopback bridge hardening (real, tested)

`apps/desktop/bridge.js` now binds `127.0.0.1` only on an OS-assigned
ephemeral port; every launch generates a 256-bit session token handed
to the widget via the URL fragment (erased by the page immediately);
all `/api/*` endpoints require it (constant-time compare); unexpected
Origins (any other website) and unexpected Host headers (DNS
rebinding) are refused with 403; there are NO CORS headers at all;
methods are allow-listed per route (405), content-type is enforced
(415), bodies are capped at 32 KB (413); a watchdog exits the bridge
when reparented; clean shutdown on SIGINT/SIGTERM.

No secrets on disk or in logs: the tmpdir status file carries only
`pid` + `port`; stderr prints the port, never the token; the token
appears exactly once, on the machine-readable stdout handshake.

`tests/bridge-hardening.test.ts` — 11 adversarial tests where a
"malicious website" attacks the running bridge: no token, brute-forced
token, forged cross-site Origin, DNS-rebinding Host, GET on sensitive
routes, wrong content-type, oversized body, CORS preflight probing —
every attack refused with the right status, while legitimate loopback
traffic still certifies VERIFIED end-to-end. Two further tests prove
the token is cryptographically random per launch and never lands on
disk or logs.

### 2. Live provider proof

`npm run smoke:live` — honestly SKIPPED in this environment
(`SAFI_DEMO_API_KEY` not set); never a fake-PASS. Re-runnable with env
vars only; the full chain (translator → real provider → verifiers →
certificate → exact displayed hash) is proven by the wire smoke and
the deterministic end-to-end demos.

### 3. Desktop packaging (real)

- `npm run app:build:macos` → **Safi.app built and verified**:
  - the staged runtime inside
    `Contents/Resources/resources/safi/` boots the hardened bridge
    (`SAFI_BRIDGE_READY` from inside the bundle — self-sufficiency
    proof);
  - shell (`main.rs`) resolves the staged runtime, cascades node
    lookup for GUI PATH, parses the handshake, navigates the widget to
    `http://127.0.0.1:<ephemeral>/#t=<token>`, exits when the bridge
    dies; the token never touches disk;
  - `.dmg` produced with `hdiutil` and verified to mount read-only.
- Windows: `npm run app:build:windows` is ready for a Windows host;
  cross-built installers are not shipped on purpose (see
  `apps/desktop/PACKAGING.md`, including signing/notarization steps
  for public distribution).
- Icons remain deterministic (`npm run app:icon`); the runtime staging
  is regenerated by `npm run app:stage` and gitignored.

### 4. Widget (real experience)

`apps/desktop/widget.html`: draggable compact dot mirroring the last
trust state (glyph + label + color, never color alone), explicit
pipeline state chip, automatic return to the compact dot after a
terminal state, session token consumed from the fragment and erased,
tray Show/Quit unchanged.

### 5. Companion hooks (consensual only)

Clipboard stays read-by-the-person-only over the bridge (the
`/api/host/clipboard` HTTP surface was removed); on-demand clipboard
hooks belong to the native shell behind explicit consent; no screen,
keyboard or clipboard watching anywhere.

### 6–7. Android / iOS alphas (real shells)

- `apps/android/`: real Gradle project (min SDK 26, appcompat +
  webkit only) — WebView shell over `appassets.androidplatform.net`
  (in-process asset loader, ES modules working), Share-to-Safi via
  `ACTION_SEND`, optional bubble behind `canDrawOverlays` with a plain
  language consent screen, NO INTERNET permission in manual mode.
  The shared brain is staged into assets by
  `tools/stage-mobile-assets.mjs`, which rewrites `node:crypto` to a
  pure-JS SHA-256 shim **in the staged copies only** (repository core
  untouched).
- `apps/ios/`: real XcodeGen project — SwiftUI app hosting a WKWebView
  with a custom in-process `safiweb://` scheme handler (no local HTTP
  server), Share Extension ("Verifica con Safi") handing text to the
  main app via app group + `safi://` deep link, deep link registered,
  Safari Web Extension prepared (see ARCHITECTURE.md).

### 8. Cross-platform invariant (tested)

`tests/android-brain.test.ts` proves from the STAGED WebView assets:
the pure-JS SHA-256 matches Node's crypto byte-for-byte (including
multi-block inputs), and the mobile brain certifies like the desktop
host — informal Human→AI ask VERIFIED, right math VERIFIED, wrong math
FAILED — with `responseSha256` equal to the exact displayed answer
hashed by Node.

### 9. Release artifacts

`npm run release:collect` → `release/macos/Safi.app` +
`release/macos/Safi_0.1.0_aarch64.dmg` + SHA-256 `checksums.txt` +
`BUILD_REPORT.md` (provenance, verification, honesty about what was
built where). `release/` is gitignored: no binaries in the repository.

Commands and results:

```text
npm test                              PASS (116/116; 11 bridge-adversarial,
                                      2 mobile-brain)
npm run conformance                   PASS (9/9 vectors, unchanged)
npm run typecheck                     PASS (src/ unchanged)
npm run smoke:live                    SKIPPED honestly (no key in env)
npm run app:build:macos               PASS (Safi.app + resources staged;
                                      in-bundle bridge boots)
hdiutil verify (dmg mount)            PASS
cargo tauri build --bundles app       PASS (release, arm64)
```

## Phase 6.1 validation — Desktop UI repair (2026-09-19)

Report: `docs/PHASE_6_1_UI_REPAIR.md`. Root cause of the reported
"white square" reproduced from the installed bundle before fixing:
`/ui/projection.js` returned 404 from the hardened bridge (the stamp
module graph failed, so no page JavaScript ran) and the shell window
booted on the hard-coded dev port instead of the ephemeral one.

Repairs (presentation/shell only — protocol untouched): fully embedded
widget CSS with a visible boot state and a visual error boundary, boot
page transparent, bridge serves `/ui/projection.js` and a token-gated
`/api/host/surface` size relay (`SAFI_SURFACE` machine line), shell
navigates only after READY + ephemeral port + token, stamp modules
staged into the bundle.

New real visual tests (`tests/visual.test.ts`, `npm run test:visual`):
a zero-dependency CDP harness (tools/visual-harness.mjs) drives headless
Chrome against the bridge from the INSTALLED bundle, waits for the real
page state, captures screenshots and asserts on pixels — including a
synthetic real click opening the panel. Verified: collapsed dot shows
real ink (never a blank frame), expanded panel drawn, wrong answer →
FAILED red chip (no green), correct answer → VERIFIED green chip (no
red). Before/after evidence: `docs/visual-evidence/`.

Commands and results:

```text
npm test                              PASS (122/122; +6 visual)
npm run test:visual                   PASS (6/6, from the installed bundle)
npm run conformance                   PASS (9/9 vectors, unchanged)
npm run typecheck                     PASS (src/ unchanged)
open Safi.app (repaired build)        PASS (app + child bridge, ephemeral
                                      port, 401 without token, restart OK)
hdiutil verify (dmg, rebuilt)         PASS (release/ refreshed + checksum)
```


## Phase 6.2 validation — Liquid Glass redesign (2026-09-19)

Report: `docs/PHASE_6_2_LIQUID_GLASS.md`. Presentation-only redesign: one
glass material (blur + saturation, top sheen, inner glow, hairline edge,
native soft shadow), compact capsule with tiny macOS traffic lights and a
separate Safi sparkle carrying the trust state, fluid expansion into a
floating glass panel, satin fields, light `✦ Ask` / `✓ Verify` modes, soft
tinted trust pill, microanimations with `prefers-reduced-motion`. The
window is transparent; the desktop shows through (verified with a test
wallpaper bleeding through the glass in screenshots).

One honesty fix surfaced by the new UNCERTAIN test: non-arithmetic
factual answers now go through the existing source verifier
(`requiredChecks: ["coherence", "sources"]`) — no corroboration stays
UNCERTAIN, contradiction is FAILED. Certifying VERIFIED from coherence
alone was too permissive and is gone.

Acceptance screenshots (all from the installed bundle, real CDP
captures, 0.0% white in every state): `docs/visual-evidence/lg-*.png` —
compact, expanded, translating, verifying, verified, uncertain, failed.

Commands and results:

```text
npm test                              PASS (124/124; visual 8/8)
npm run test:visual                   PASS (8/8, from the installed bundle)
npm run conformance                   PASS (9/9 vectors, unchanged)
npm run typecheck                     PASS (src/ unchanged)
open Safi.app (Liquid Glass build)    PASS (capsule visible, hardened
                                      bridge child of the app, 401
                                      without token)
hdiutil verify (dmg, rebuilt)         PASS (release/ + fresh checksum)
```

## Phase 6.2.1 validation — Real native Liquid Glass + collapse fix (2026-09-20)

Root cause 6.2 accettata: glass solo CSS (nessun desktop che traspare) e
nessun ritorno esplicito expanded→compact. Correzione puramente shell:

| Prova | Risultato |
| --- | --- |
| Native glass (macOS 26+) | PASS — apply_liquid_glass + content_view: WKWebView dentro NSGlassEffectView; `nativeGlass:true` via /api/host/info |
| Catena trasparenza (window→webview→html→body) | PASS — tutte trasparenti; nessun bianco/opaco sulle superfici |
| Desktop dietro il vetro (headless, bundle) | PASS — bande blu/viola visibili attraverso Safi, 0,0% bianco |
| Desktop dietro il vetro (app reale) | PASS — pattern attraverso capsula (≈15,5% blu+viola, A/B) e pannello (≈12,9%), bianco ≈2,4% (testo) |
| Macchina UI COMPACT ⇅ EXPANDED | PASS — rosso=close, giallo=collapse, verde=toggle, Escape, Enter/Space (WCAG) |
| Resize fisico reale | PASS — bounds timeline 226×193 → 114×60 → 226×193 → 114×60 |
| White-flash (launch/expand/collapse) | PASS — nessun frame bianco |
| npm test (unit + visual) | 128 passed | 1 skipped (skip onesto: blur nativo richiede app+permessi schermo) |
| Conformance | 9/9 PASS · tsc --noEmit PASS · anti-parola CLEAN |
| Bundle = sorgenti | PASS — SHA-256 widget identico (src / resources / .app) |
| release/ | Safi.app + Safi.dmg (hdiutil verify VALID, checksums aggiornati) |

Accettazione visiva finale: umana (app di release avviata per ispezione).

## Phase 6.2.2 validation — Release UI cleanup (2026-09-20)

Root cause del testo tecnico: un commento HTML d'intestazione conteneva la
sequenza di chiusura `-->` nel diagramma della macchina a stati — il commento
terminava al primo `-->` e il resto diventava testo di pagina, visibile
attraverso il vetro. Secondo difetto: il pannello espanso nascosto via classe
CSS senza regola display restava renderizzato dietro la capsula.

| Prova | Risultato |
| --- | --- |
| Commento riparato + guard statico (1 closer per opener, zero testo macchina a stati) | PASS |
| COMPACT: `document.body.innerText === "✦"` (bundle release) | PASS — zero testo tecnico |
| Pannello espanso nascosto via attributo `[hidden] !important` | PASS — non più renderizzato in COMPACT |
| EXPANDED senza vocabolario sviluppatore (8 stringhe vietate) | PASS |
| Developer View gated (SAFI_DEV solo debug_assertions; backdoor esplicita browser) | PASS — mai in release |
| Screenshot release COMPACT / EXPANDED / COLLAPSED AGAIN | PASS — docs/visual-evidence/lg622-*.png |
| npm test | 131 passed \| 1 skipped (onesto) |
| Conformance · tsc · anti-parola · segreti | 9/9 · OK · CLEAN · nessuno |
| release/ | Safi.app + Safi.dmg (VALID, checksum aggiornato) |

**Nuova regola di governance:** una suite di test verde non equivale ad
approvazione estetica. Ogni modifica della shell Safi richiede screenshot
della vera build release e approvazione visiva umana prima di dichiarare
la fase completata.

## Safi Visual System v0.2 validation (2026-09-20)

Un personaggio, tutti gli stati. Pico eliminato (guard automatico). La
figura vive in ui/safi-mascot.js e alimenta widget, asset e icone dalla stessa
geometria. Impatto protocollo: nessuno.

| Prova | Risultato |
| --- | --- |
| 7 stati Safi (idle, understanding, translating, verifying, verified, uncertain, failed) con espressione+colore+cartello | PASS — sincroni capsula/header, verificati su bundle |
| Compact zero-testo con Safi ~30px come indicatore | PASS — innerText "" |
| Pannello con corpo (tinta perla su frosto nativo) + tagline | PASS — leggibilità migliorata |
| Icona app = testa Safi + stellina; icns/ico rigenerate | PASS — deterministica |
| Asset ufficiali (7 SVG + 35 PNG + favicon/toolbar/menubar) | PASS — tools/mascot-raster.mjs dalla geometria del widget |
| Repo Pico-free (guard nel test Safi) | PASS |
| Glifi segno come path (niente leak innerText SVG) | PASS — quirk Chromium corretto |
| npm test | 142 passed \| 1 skipped (onesto) |
| Conformance · tsc · anti-parola · segreti | 9/9 · OK · CLEAN · nessuno |
| Screenshot accettazione (10/10 su wallpaper, bundle release) | PASS — docs/visual-evidence/safi-mascot-*.png |
| release/ | Safi.app + Safi.dmg (VALID, checksum aggiornato) |

Accettazione estetica finale: umana (app avviata per ispezione).

## Golden Reference Contract v1 — 2026-09-21

Status: **IMPLEMENTED** (non "completata": l'accettazione visiva è umana, §10).

- Fonti canoniche archiviate: `golden/safi-character-sheet.png`,
  `golden/safi-ui-board.png`, `SAFI_UI_INTERACTION_CONTRACT.md`,
  `DESIGN_FREEZE.md`.
- `safi-mascot-master.svg` + `ui/safi-mascot.js` ricostruiti dal character sheet
  (anatomia 68.6/31.4 ≈ 70/30, stellina al petto, occhi semplici,
  braccia morbide); 7 stati derivati dal master; asset + icone
  rigenerati dalla stessa geometria.
- Widget: capsula ~128×52 con Safi 32 px zero-testo; pallini reali
  (rosso=close, giallo=compact, verde=toggle, Escape=compact); pannello
  sulla struttura del board con footer Safi; glass con corpo (§7).
- Golden diff obbligatorio (§12): `tools/capture-golden.mjs` +
  `tools/golden-diff.mjs` → REFERENCE/CURRENT/OVERLAY/DIFF per
  compact/expanded/verified/uncertain/failed — **PASS** su tutte.
- 146 test ✓ | 1 skip onesto · conformance 9/9 · tsc OK ·
  anti-parola CLEAN · bundle = sorgenti (SHA-256) ·
  release/macos/Safi.app + Safi.dmg VALID.
- Report: `docs/GOLDEN_REFERENCE_IMPLEMENTATION.md`.

## SAFI Visual Rebuild — Golden UI + Safi Mascot

Stato: **IMPLEMENTED — AWAITING VISUAL APPROVAL** (promozione a VISUALLY ACCEPTED solo dopo conferma umana; §14).

| Requisito | Esito |
| --- | --- |
| Rinomina totale mascotte (Lumo→Safi, tecnica `safi-mascot`) | PASS — `grep -ri lumo` repo = 0 |
| Compact = SOLO la mascotte (niente traffic light), 48–64 px | PASS — click→expand; test zero-testo verde |
| Ritorno a compact: Escape + controllo ambra + click esterno | PASS — macchina verificata da test reali |
| Pannello con corpo (tint perla densa, controlli più opachi, testo alto contrasto) | PASS |
| Microcopy "Safi sta verificando… / non è ancora sicuro. / ha trovato un problema." | PASS — solo Developer Inspector (§10) |
| Asset + icone dalla geometria unica (icns/ico deterministici, no sips) | PASS |
| Golden captures §11 (8 catture dal bundle release) + golden-diff §12 | PASS 5/5 superfici |
| Batteria completa | 146 ✓ + 1 skip onesto, conformance 9/9, TSC OK |
| Anti-parola (nome client) + segreti | CLEAN |
| Release: Safi.app + Safi.dmg (VALID) + checksums | AGGIORNATI |

## Visual Fix 6.3 — Face Fidelity + Atomic Expand + Frosted Readability

Data: 2026-09-22 · Impatto protocollo: **nessuno** · Core: **intatto**

- **Face master** (`FACE` in `ui/safi-mascot.js`): occhi tondi luminosi
  in IDLE (zero archi pendenti), sorriso con punte rialzate (verificato
  numericamente: punte a −5.2 unità rispetto al centro), stati derivati
  da un'unica geometria.
- **Espansione atomica**: COMPACT → EXPANDING → verifica reale della
  finestra (396×442) → EXPANDED; pannello a dimensione fissa 384×430,
  mai visibile durante il resize; COLLAPSING speculari verso 92×88.
  `main.rs` gestisce gli hint EXPANDING/COLLAPSING.
- **Frosting**: tinta 0.88, campi 0.68/0.8, chips 0.62, testo scurito —
  wallpaper percepibile ma non leggibile (§9: influenza ≈10–15%).
- **Acceptance §14**: 20/20 cicli espandi/collassa con zero clipping,
  zero mid-open, zero late-resize (driver `cycles=20` misurato in
  pagina).
- Comando: `npx vitest run` → 149 PASS + 1 SKIP onesto; conformance
  9/9; golden-diff PASS 5/5 dal bundle release.
- Report completo: `docs/VISUAL_FIX_6_3.md`.

## MASCOT LOCK — neutral app icon (2026-09-22)

Per PRODUCTION ASSET LOCK: la mascotte Safi ha come unica source of truth
i master production (SAFI_HERO / SAFI_UI / SAFI_MICRO) consegnabili in
`golden/production-mascot/`. Il sistema procedurale di volto è congelato
(MASCOT_LOCK.md), non source of truth.

- Icona app sostituita su TUTTI gli slot (icns/ico, PNG desktop, launcher
  Android, asset catalog iOS) con un tile perla deterministico senza
  personaggio; la figura errata non è più propagata nel Dock.
- `tests/mascot.test.ts`: guard MASCOT LOCK (pixel-scan icona: zero inchiostro
  figura, zero colori di stato saturi; pipeline icone senza figure drawing).
- Procedure system intatto altrove; golden-diff 5/5 PASS dal bundle;
  catture compatte ora geometria reale 80×76 (crop non più clamped).
- Batteria: 151 test ✓ + 1 skip onesto, conformance 9/9, tsc OK;
  bundle = sorgenti (SHA-256), release/macos aggiornata (DMG VALID).

Status: **MASCOT LOCKED — WAITING FOR PRODUCTION ASSETS**

## Reference board ufficiale ricevuta (2026-09-22)

Archiviata `golden/safi-mascot-reference-board.png` (1536×1024): fissa
proporzioni, volto, occhi, bocca, stella, i sette stati e la distinzione
HERO 512 / UI 128 / MICRO 64, con palette glow per stato (Idle #EAF0FF,
Understanding #A5C8FF, Translating #7DD3FC, Verifying #C4B5FD,
Verified #34D399, Uncertain #FBBF24, Failed #F87171).

Per esplicita istruzione: NON usata nell'app, NON ritagliata, NON
ridisegnata. Nessun codice o asset modificato in conseguenza della tavola
(anche la palette glow resta quella v0.2 in codice: la riconciliazione con
i valori della tavola avverrà solo nell'integrazione degli asset).

Status invariato: **MASCOT LOCKED — WAITING FOR PRODUCTION ASSETS**

---

# SAFI — PRODUCTION ASSET INTEGRATION + COLLAPSE FIX + READABILITY

Run: 2026-09-24 · Status: **IMPLEMENTED — AWAITING VISUAL APPROVAL**
Protocollo: **invariato** · Core: **intatto**

## 1. Import dei 21 production asset

Pack: `safi-production-mascot-pack.zip`
SHA-256: `1fc849033ab661c95ab7e47cd919b3217cb24f5c518ec9d61e2f6336939b6850`

Verifica automatica (sha256 + byte count contro `MANIFEST.json`, dimensioni
e formato PNG):

```text
21/21 file OK  —  hero 7×512²  ui 7×128²  micro 7×64²  (RGBA 8-bit)
MANIFEST: 21/21 checksum OK, 21/21 byte count OK
unexpected png: none
```

Percorsi usati dalla runtime (serviti da `GET /mascot/{tier}/{file}`):

```text
golden/production-mascot/hero/safi-hero-{idle,understanding,translating,verifying,verified,uncertain,failed}.png
golden/production-mascot/ui/safi-ui-{...}.png
golden/production-mascot/micro/safi-micro-{...}.png
```

Nel bundle: `Safi.app/Contents/Resources/resources/safi/golden/production-mascot/`
byte-identico (sha256 verificato sul file campione).

## 2. Mascotte procedurale fuori dalla runtime

```text
widget.html: nessun import di ui/safi-mascot.js, nessun <svg> procedurale,
             nessun riferimento a FACE / smilePath / browArc
bridge.js:   /ui/safi-mascot.js non è più servito
staging:     il modulo procedurale non entra nel bundle;
             golden/production-mascot/ sì
archivi su disco (non referenziati): ui/safi-mascot.js, tools/mascot-raster.mjs,
             tools/gen-mascot-assets.mjs, assets/safi-mascot/*
```

`tools/mascot-raster.mjs` è riusato solo per gli encoder di formato
(`encodePng`, `writeIcns`, `writeIco`).

## 3. Mapping ottico (obbligatorio, verificato)

| resa | master | uso |
|---|---|---|
| 0–72 px | MICRO 64² | compact 60 px, header 44 px, footer 26 px, boot 38 px, fatal 36 px |
| 73–180 px | UI 128² | (nessun host oggi in banda; la regola resta applicata) |
| > 180 px | HERO 512² | icona Dock 256/512/1024 |

`DIAG.mascotTierAudit` = [] a runtime; i test statici fanno fallire la build
se un host dichiara un tier incoerente con la sua dimensione resa. Nessun
HERO viene mai ridotto per un widget piccolo.

## 4. IDLE a occhi aperti

Sonde pixel sul master MICRO consegnato (`tests/mascot.test.ts`):
due masse scure distinte nella banda occhi (sx + dx), inchiostro sotto gli
occhi (sorriso), guance calde su entrambi i lati, cluster oro (stellina).
Crop 4× della release: `docs/visual-evidence/golden-current/*-mascot-4x.png`
— inchiostro occhi/bocca, oro e guance presenti in tutti e 7 gli stati.

## 5–6. Collapse simmetrico e dimensione canonica

Sequenza implementata in `apps/desktop/widget.html`:

```text
EXPANDED → COLLAPSING → notifySize() (resize nativo avviato)
          → widget hidden → attesa conferma dimensione nativa
          → reveal mascotte compact → setMode("COMPACT") → notifySize()
```

- la dimensione compact è **unica**: surface 76×76, finestra nativa **88×88**
  (`SURFACE_SIZES.compactWindow`, `tauri.conf.json`, costanti
  `COMPACT_WINDOW_W/H` in `main.rs`);
- `state = COMPACT` viene impostato solo dopo la misura reale
  (`DIAG.compactActual`, tolleranza 1 px per il rounding del SO);
- `surfaceRect()` non misura più elementi nascosti: durante COLLAPSING il
  pannello nascosto misurava 0×0 e la shell riduceva la finestra a 12×12 —
  era la causa radice di "expanded → compact si rompe/taglia";
- input durante la transizione non viene più scartato: Escape / click
  esterno durante EXPANDING vengono messi in coda ed eseguiti.

## 7. 30 cicli reali

Cicli nel browser (bundle, CDP):

```text
total 30 · fullOpen 30 · clipped 0 · midOpen 0 · lateResize 0
secondClick 0 · ghostPanel 0
```

Cicli **dentro la .app installata** (driver in-page, misure native, relay
dal bridge su stdout):

```text
SAFI_SELFTEST {"total":30,"fullOpen":30,"clipped":0,"secondClick":0,
 "ghostPanel":0,"wrongCompactSize":0,"wrongExpandedSize":0,
 "nativeResizes":true}
```

`wrongCompactSize = 0` significa che in ognuna delle 30 chiusure la
finestra era esattamente 88×88 prima di entrare in COMPACT;
`wrongExpandedSize = 0` che le aperture erano esattamente 396×442.

## 8–10. Frosting, contrasto, input

Causa radice del "troppo trasparente" trovata e corretta:
`background: <color>, <gradient>, …` è **CSS non valido** (il colore deve
essere l'ultimo layer), quindi l'intera dichiarazione del tint veniva
scartata e il pannello rendeva senza tint. Ora il tint chiude lo stack.

```text
--glass-tint: rgba(226, 235, 248, 0.94)     superficie ~90–95%
--field-tint: rgba(248, 251, 255, 0.90)    input più denso del pannello
--field-tint-focus: rgba(255, 255, 255, 0.96)
```

Misure sul wallpaper di test (area inscritta della superficie):

```text
compact : influence wallpaper 0.0%   · luma media > 170
expanded: influence wallpaper ≤ 18%  · luma media > 170 · ink contenuto > 0
```

Testo: nessuna opacità 0.3–0.4 su testo funzionale; `Safi`, la tagline,
`Ask`, `Verify`, il placeholder, `chiedi`, `verifica`, `Pronto ad aiutarti`
e il footer sono a contrasto pieno (colori scuri espliciti, `opacity: 1`).

## 11. Mascotte sharp

```text
filter: none · opacity: 1 · mix-blend-mode: normal
antenitori: filter none · opacity 1 · backdrop-filter none
glow di stato sul box-shadow dell'host, mai sull'asset
```

## 12. Screenshot di accettazione (release)

`docs/visual-evidence/golden-current/`

```text
compact.png  expanded.png  expanded-to-compact.png
verified.png uncertain.png failed.png
compact-verified.png compact-uncertain.png compact-failed.png
compact-idle-mascot-4x.png   expanded-idle-mascot-4x.png
verified-mascot-4x.png      uncertain-mascot-4x.png
failed-mascot-4x.png
compact-verified-mascot-4x.png compact-uncertain-mascot-4x.png compact-failed-mascot-4x.png
acceptance-sheet.html  (contact sheet di tutte le evidenze)
```

Il frame `expanded-to-compact` è catturato **durante** COLLAPSING: pannello
già nascosto, mascotte compact **non ancora** rivelata, hint di superficie
già 76×76 — nessun pannello tagliato, nessuna mascotte prematura.

Golden diff: **PASS 5/5** (compact, expanded, verified, uncertain, failed).

## Batteria completa

```text
npx vitest run            156 passed · 1 skipped (permesso screen recording) · 11 files
tests/visual.test.ts      25 passed · 1 skipped
tests/mascot.test.ts      15 passed
tsc --noEmit              PASS
conformance               9/9 PASS
scan nomi vietati         0 occorrenze
```

## Stato

**IMPLEMENTED — AWAITING VISUAL APPROVAL**
