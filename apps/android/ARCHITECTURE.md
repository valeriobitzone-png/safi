# Safi Android Host — architecture (Phase 5)

Status: ARCHITECTURE + working mock (`host-adapter.js`). Not store-ready.

## Shape

Safi on Android is a small bubble above other apps — the original idea,
kept intact — plus explicit-permission ingress points:

```
┌──────────────────────────────────────────────┐
│ SAFI APP (full manual mode)                  │
│   "Parla normalmente" + "Verifica risposta"  │
├──────────────────────────────────────────────┤
│ FLOATING BUBBLE  ●  (overlay permission,     │
│   granted explicitly; tap opens the widget)  │
├──────────────────────────────────────────────┤
│ SHARE SHEET target "Verify with Safi"        │
│   (text the person explicitly shares)        │
├──────────────────────────────────────────────┤
│ BROWSER INTEGRATION (optional, later phase)  │
└──────────────────────────────────────────────┘
```

## Host adapter contract

`host-adapter.js` is the executable mock. The real Android shell
(Kotlin + WebView, or Capacitor) implements the same interface:

| capability           | Android power                       | consent             |
| -------------------- | ----------------------------------- | ------------------- |
| `overlayBubble`      | `SYSTEM_ALERT_WINDOW`               | explicit, revocable |
| `verifySelection`    | share-sheet text                    | per-share, explicit |
| `clipboardPaste`     | paste action only, never monitoring | explicit, per-use   |
| `companionInterception` | accessibility-service capture    | explicit + Play policy review; OFF by default |
| `globalShortcut`     | quick-settings tile                 | default on          |
| `telemetry`          | —                                   | does not exist      |

## Rules

- The bubble is a shortcut to the widget, never a capture surface.
- Every permission request is preceded by a plain-language explanation
  of exactly what will and will not be read.
- MANUAL mode is complete and works with zero permissions granted.
- The shared Safi client and widget brain do all protocol work; the
  Kotlin shell renders states only.
