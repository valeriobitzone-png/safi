# Safi Android Alpha — Build & Run

Status: **real, buildable app** (Gradle + Kotlin, WebView over the
shared brain). Not store-ready: signing and Play metadata are out of
Phase 6 scope.

## Prerequisites

- Android Studio (or Android SDK 34 + JDK 17)
- Node ≥ 20 (to stage the brain assets)

## Build

```bash
# from the repo root: stage the shared brain into the app assets
node tools/stage-mobile-assets.mjs

# then build from Android Studio (open apps/android/) or:
cd apps/android
./gradlew assembleDebug
# → app/build/outputs/apk/debug/app-debug.apk
```

## Opt-in device runtime test

With `dev.safi.app` installed and its WebView debuggable, run from the
repository root:

```bash
npm run test:android:device
# multiple devices: SAFI_ANDROID_SERIAL=<serial> npm run test:android:device
```

The runner uses ADB and CDP against the real page. It is not part of
`npm test`. Missing prerequisites (ADB, authorized device, package,
WebView socket, or exact CDP target) are `SKIPPED`; ambiguous endpoints,
runtime errors, and failed assertions are `FAIL`. Screenshots and
`result.json` are written under `artifacts/android-device/`.

### Runner fault policy

The device, WebView socket, and CDP target selectors are deterministic:
there is no implicit fallback when multiple authorized devices or matching
endpoints are present. `pm path dev.safi.app` is checked after device
selection; a missing package is `SKIPPED`, while a failed `pm` command is a
`FAIL` and launch/CDP are not attempted. The initial `am force-stop` is
treated as a blocking failure when ADB rejects it. A failed launch is a
`FAIL`, but cleanup still runs. A socket that disappears during `adb
forward`, an unreachable CDP endpoint, a boot timeout, a WebSocket
disconnect, or a failed Ask/Verify assertion is a controlled `FAIL`.

Cleanup always attempts WebSocket close, every tracked `adb forward
--remove`, and the final `am force-stop`; one cleanup error does not stop
the remaining operations. The result records:

```js
cleanup: {
  websocketClosed: boolean,
  forwardsRemoved: boolean,
  appStopped: boolean,
  errors: []
}
```

When the primary test and cleanup both fail, `reason` keeps the primary
failure and `cleanup.errors` records every cleanup warning. The runner
must finish with no tracked forward and with the app force-stopped.

## What the app does

- **Manual mode** (`MainActivity`): "Parla normalmente" + "Verifica
  questa risposta", the same experience as the desktop widget.
- **Share to Safi**: appears in every app's share sheet for text; the
  shared text lands in the verification field.
- **Optional bubble** (`BubbleActivity`): started only by the person;
  before the system overlay dialog, Safi explains in plain language
  what the permission means — and that without it everything else
  keeps working.
- **No network permission**: the manual brain is local; the WebView
  loads only `appassets.androidplatform.net` (in-process asset loader).

## Single brain

`MainActivity` is a thin WebView shell. The only editable mobile consumer
is `packages/mobile-consumer/{brain.js,index.html}`;
`node tools/stage-mobile-assets.mjs` generates the APK assets from that
source plus the explicitly declared runtime graph. The Android tree is
packaged output, not a second implementation. The browser SHA-256 shim is
staged alongside the Core without changing the repository Core's
`node:crypto` import.
