# Safi Release — Build Report

- Generated: 2026-09-24T16:12:16.495Z
- Platform of the build host: darwin (arm64)
- Node: v26.7.0

## Artifacts

- 318e2ef8eae42cc91d765c3dcbdf535a13239881cd43f51400e63482e6180873  macos/Safi.dmg

## Provenance & verification

- `Safi.app`: Tauri 2 shell, built with `npm run app:build:macos`.
  Verified in this environment: the app builds, the staged runtime
  inside `Contents/Resources/resources/safi` boots the hardened
  bridge (`SAFI_BRIDGE_READY`), and the `.dmg` mounts read-only.
- Icons are deterministic (`npm run app:icon`): byte-identical across
  machines, no binary committed.
- The loopback bridge is the hardened Phase 6 version: ephemeral port,
  session token (never on disk/logs), Origin/Host checks, no CORS,
  body caps, watchdog. Adversarial tests: `tests/bridge-hardening.test.ts`.
- Mobile brains are the SHARED brain: `tests/android-brain.test.ts`
  proves identical trust states and certificate hashes from the staged
  WebView assets.
- Windows `.msi`: produced only on a Windows host (see
  `apps/desktop/PACKAGING.md`); cross-built installers are not
  shipped on purpose.
- No secrets, credentials or conversations are embedded in any
  artifact; the optional live provider reads env vars only.
