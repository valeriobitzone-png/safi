# Safi Desktop Alpha — Packaging (Phase 6)

Status: **real, reproducible build** for macOS (`.app` + `.dmg` built and
verified); Windows build ready on a Windows host (script provided; a
Mac cannot produce an honest `.msi` — see below).

## What ships

- **Tauri 2 thin shell** (`src-tauri/`): a frameless always-on-top
  widget window (the dot), a tray/menu-bar icon with Show/Quit, and the
  spawned hardened loopback bridge. No protocol logic — Safi is a
  consumer of the protocol, never its definition.
- **Hardened loopback bridge** (`../bridge.js`): zero-dependency Node
  server bound to `127.0.0.1` on an OS-assigned ephemeral port,
  session-token gated, Origin/Host checked, no CORS, size-capped,
  watch-dogged, and silent (no secrets on disk or in logs).
- **Staged runtime** (`src-tauri/resources/safi/`, gitignored): the
  bridge, host, `ui/safi-stamp.js`, the compiled core (`dist/`) and the
  shared packages — copied at build time by `npm run app:stage`, so the
  installed app is self-sufficient.
- **Icons**: generated deterministically by `npm run app:icon`
  (byte-identical across machines; no binary in the repository).

## macOS — verified build

```bash
npm run app:build:macos
# → apps/desktop/src-tauri/target/release/bundle/macos/Safi.app
```

The `.dmg` is produced with `hdiutil` (the AppleScript DMG script is
fragile in headless environments):

```bash
hdiutil create -volname Safi \
  -srcfolder apps/desktop/src-tauri/target/release/bundle/macos/Safi.app \
  -ov -format UDZO \
  apps/desktop/src-tauri/target/release/bundle/dmg/Safi_0.1.0_aarch64.dmg
```

Verified in this repository state:

- `Safi.app` builds (universal arm64 slice) with the staged runtime
  inside `Contents/Resources/resources/safi/`;
- the staged bridge runs from *inside* the bundle (self-sufficiency
  proof: `node …/Resources/resources/safi/apps/desktop/bridge.js`
  reaches `SAFI_BRIDGE_READY`);
- the `.dmg` mounts read-only and contains `Safi.app`.

## Windows

From a **Windows machine** (Rust + MSVC + WebView2):

```bash
npm run app:build:windows
# → apps/desktop/src-tauri/target/release/bundle/msi/Safi_0.1.0_x64_en-US.msi
```

Cross-compiling an `.msi` from macOS is possible in theory (WiX under
Wine) but produces unverifiable installers: **not done on purpose**.
The Tauri `msi` target and the staged-runtime layout are already
platform-neutral; the same shell code builds on Windows unchanged.

## Prerequisites

- Node ≥ 20 (bridge and shared client)
- Rust toolchain (stable) with the Tauri 2 prerequisites:
  - macOS: Xcode command line tools
  - Windows: WebView2 (preinstalled on Windows 11) + MSVC build tools
  - Linux: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`

## Commands

```bash
npm run app:icon          # deterministic icons (idempotent)
npm run app:stage         # build core + stage runtime into the bundle
npm run app               # dev reference: build core + run bridge
npm run app:build:macos   # full macOS bundle (this repo: verified)
npm run app:build:windows # full Windows bundle (on a Windows host)
```

## Security model of the installed app

- The bridge binds `127.0.0.1` only, on an ephemeral port; a session
  token (256-bit, random at every launch) is handed to the widget via
  the URL fragment and erased from the address bar by the page itself.
- No CORS, strict Origin/Host checks, method and content-type
  allow-lists, 32 KB body cap. Adversarial tests:
  `tests/bridge-hardening.test.ts`.
- The token never touches disk or logs: the tmpdir status file carries
  only `pid` and `port`; the human log prints the port only.
- When the bridge dies, the shell exits (never a zombie widget).
- Pasted text enters through the widget textarea (the person pastes it);
  the system clipboard is never read over HTTP. On-demand clipboard
  hooks belong to the native shell, behind explicit consent.

## Public distribution (when certificates exist)

Not done yet, on purpose — no certificates are available in this
environment. For a public release you need:

1. **macOS**: Developer ID Application certificate + `codesign
   --deep --options runtime` + notarization (`notarytool`), then
   staple. Without it, Gatekeeper requires a right-click override on
   first launch.
2. **Windows**: code-signing certificate (EV/OV) for the `.msi`;
   unsigned installers trigger SmartScreen warnings.
3. **Updates**: a signed update manifest (Tauri updater) before any
   public channel.
