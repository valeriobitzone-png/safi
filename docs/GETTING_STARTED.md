# Getting Started

This guide gets an engineer from a fresh clone to a working SAFI preview.

## 1. Install

```bash
npm ci
```

`npm ci` is preferred over `npm install` because it uses the locked
dependency tree.

## 2. Build

```bash
npm run build
```

This runs `tsc -p tsconfig.json`.

## 3. Verify the basics

```bash
npm run typecheck
node tests/run-conformance.mjs
npm run lint:ui-colors
```

Conformance runs the zero-dependency protocol vectors and prints one line
per vector.

## 4. Run the test suite

```bash
npm test
```

This runs the UI color semantics check first, then the vitest suite.

If you only want the package-level hygiene tests, run:

```bash
npm test -- tests/packages.test.ts
```

## 5. Try the demo

```bash
npm run demo
```

This starts a local demo server. `npm run demo:check` verifies the demo
scenarios and their certificates without opening a browser.

## 6. Smoke the reference flow

```bash
npm run smoke
```

This builds and runs `dist/examples/basic-flow.js`.

If you want the OpenAI-compatible wire shape against a local stub, run:

```bash
npm run smoke:wire
```

## 7. Validate example payloads

```bash
npm run validate
```

This validates the example payloads against the JSON Schemas.

## 8. Open the static reference states

The UX projection ships as a zero-dependency Web Component. The static
reference states can be opened directly in a browser:

```text
ui/mocks/desktop.html
ui/mocks/mobile.html
ui/mocks/companion.html
ui/mocks/manual.html
```

## 9. Desktop Alpha

The Desktop Alpha lives in `apps/desktop/`. It uses a Tauri 2 thin shell.

Relevant commands are documented in `apps/desktop/PACKAGING.md` and in
`package.json`. For public distribution, read the signing and packaging
notes there before publishing binaries.

## 10. Android

Android is a real Gradle project with a working mock and an optional
overlay bubble behind an explicit permission.

For day-to-day Android work, use the Android Studio emulator. Do not treat
a physical device as required for routine development.

## 11. iOS

iOS is a real XcodeGen project with a working mock. A global overlay is
platform-forbidden on iOS, so the iOS surface model is different from
Android by design.

## 12. Companion

Companion work lives in `packages/companion/`. Provider-specific DOM logic
is kept inside the site adapters. Companion acceptance can require a host
browser profile and is therefore opt-in, not a default CI gate.

## 13. What is intentionally opt-in

Some acceptance paths require a physical device, an authenticated browser
profile, or a local GUI. Those are real acceptance, but they are not
required to make the repository build, typecheck and test from a clean
environment.

## 14. If something feels broken

First check:

- `npm ci`
- `npm run build`
- `npm run typecheck`
- `node tests/run-conformance.mjs`
- `npm run lint:ui-colors`

If those pass and the behavior still looks wrong, read
`docs/ARCHITECTURE.md` and the relevant test file before changing code.

## 15. Clean-room sanity

Before publishing, the repo should be cloneable into a fresh directory and
pass the above commands without any `/Users/...` paths, without secrets, and
without depending on files outside the repository.
