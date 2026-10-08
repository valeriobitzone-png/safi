# Safi iOS Alpha — Architecture & Build

Status: **real, buildable shell** (XcodeGen project, share extension,
custom-scheme webview). Not store-ready: signing team and App Store
metadata are intentionally out of scope for Phase 6.

## Single brain, iOS shape

The experience is the SAME packaged consumer as Android:

```
Safi.app (WKWebView)
  └── safiweb:///index.html
        └── runtime-manifest.json → 13 reachable resources
```

- `packages/mobile-consumer/{brain.js,index.html}` is the only editable
  mobile consumer. `WebResources` is generated output.
- `tools/mobile-runtime-manifest.json` declares every reachable URL and
  its exact iOS bundle resource; `App.swift` performs only that lookup.
  There are no nested/flattened duplicates, declaration files or source
  maps in the iOS runtime.
- The `safiweb://` scheme is served **in-process** by
  `WKURLSchemeHandler`: no local HTTP server on iOS, no network.
- `node:crypto` is rewritten only in staged output to the pure-JS shim;
  the repository Core is untouched.
- Share-to-Safi flows through the Share Extension → app group →
  `safi://verify?text=…` deep link → verification in the main app.
- No global overlay is attempted (impossible on iOS); the manual mode
  and the share sheet are the sanctioned surfaces, exactly as decided
  in Phase 5.

## Build

```bash
# prerequisites: Xcode 15+, XcodeGen (brew install xcodegen)
cd apps/ios
xcodegen generate
open Safi.xcodeproj        # set your signing team, run on a device/simulator
```

The staged web brain is required before opening Xcode:

```bash
node tools/stage-mobile-assets.mjs   # from the repo root
```

## What remains for store readiness (out of Phase 6 scope)

- Signing team, provisioning profiles, App Store screenshots/metadata.
- App group entitlement wiring in XcodeGen targets (the code reads
  `group.dev.safi.app`; the entitlement needs adding with a team).
- Safari Web Extension (the structure is prepared: the same brain
  could serve a background page; the extension shell is not included).
