#!/usr/bin/env node
/**
 * Stage the SHARED widget into the Android app assets.
 *
 * Android is not a second UI: it is the same `apps/desktop/widget.html`,
 * the same 3:2 shell, the same states and controls, served from the app
 * assets through the same WebViewAssetLoader origin the reference host
 * already uses. Only the host adapter differs, and that is the in-page
 * `host-web.js`.
 *
 * It lands in its OWN assets source directory, not in `src/main/assets`.
 * That directory is the mobile CONSUMER's declared, auditable runtime
 * graph (tools/mobile-runtime-manifest.json) and must contain nothing
 * else. Gradle merges both source directories into the one APK assets
 * root, so the page still resolves every relative import exactly as it
 * does on desktop:
 *
 *   assets/apps/desktop/widget.html   ← the same file
 *   assets/apps/desktop/host-web.js   ← the in-page host adapter
 *   assets/apps/android/host-adapter.js
 *   assets/packages/…                 ← the shared client/renderer
 *   assets/ui/safi-stamp.js           ← served at /ui/… by the page
 *   assets/mascot/<tier>/…            ← served at /mascot/… by the page
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(repo, "apps/android/widget-runtime-assets");

/** Copies a file or a whole directory, creating the parent when needed. */
function stage(from, to) {
  if (!existsSync(from)) throw new Error(`missing source: ${from}`);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  return to;
}

function countFiles(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce(
    (n, entry) => n + (statSync(join(dir, entry)).isDirectory() ? countFiles(join(dir, entry)) : 1),
    0,
  );
}

/* The consumer already ships part of the widget's dependency graph
   (`packages/safi-client`, `ui/safi-stamp.js`, …) as its declared,
   auditable runtime bundles. Shipping a second copy would collide in the
   merged APK assets root, so those files are REUSED: if the consumer
   already has the route, the bytes must be identical and nothing is
   staged. Only what the consumer does not ship is added here. */
const consumer = join(repo, "apps/android/app/src/main/assets");
const reused = [];
let stagedCount = 0;

function stageOne(from, to) {
  if (!existsSync(from)) throw new Error(`missing source: ${from}`);
  const rel = to.slice(assets.length + 1);
  const consumerFile = join(consumer, rel);
  if (existsSync(consumerFile)) {
    if (!readFileSync(from).equals(readFileSync(consumerFile))) {
      throw new Error(`divergent duplicate: ${rel} differs from the consumer's shipped bundle`);
    }
    reused.push(rel);
    return consumerFile;
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  stagedCount += 1;
  return to;
}

function stageTree(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const childFrom = join(from, entry.name);
    const childTo = join(to, entry.name);
    if (entry.isDirectory()) stageTree(childFrom, childTo);
    else if (entry.isFile()) stageOne(childFrom, childTo);
  }
}

// The page itself and its in-page host: the widget is NOT a consumer file.
stageOne(join(repo, "apps/desktop/widget.html"), join(assets, "apps/desktop/widget.html"));
stageOne(join(repo, "apps/desktop/host-web.js"), join(assets, "apps/desktop/host-web.js"));
stageOne(join(repo, "apps/android/host-adapter.js"), join(assets, "apps/android/host-adapter.js"));

// The shared protocol brain: no second implementation, ever. Whatever the
// consumer already ships is reused byte-for-byte.
for (const pkg of readdirSync(join(repo, "packages"))) {
  const from = join(repo, "packages", pkg);
  if (statSync(from).isDirectory()) stageTree(from, join(assets, "packages", pkg));
}

// The reference stamp component and the production mascot masters: the
// exact same bytes the desktop serves.
for (const file of readdirSync(join(repo, "ui"))) {
  const from = join(repo, "ui", file);
  // `ui/` holds a mocks directory that is not part of any runtime.
  if (!statSync(from).isFile()) continue;
  stageOne(from, join(assets, "ui", file));
}
const mascotFrom = join(repo, "golden/production-mascot");
if (!existsSync(mascotFrom)) throw new Error(`missing production mascot masters: ${mascotFrom}`);
rmSync(join(assets, "mascot"), { recursive: true, force: true });
for (const tier of readdirSync(mascotFrom)) {
  const from = join(mascotFrom, tier);
  if (!statSync(from).isDirectory()) continue;
  mkdirSync(join(assets, "mascot", tier), { recursive: true });
  for (const file of readdirSync(from)) {
    if (/^safi-(hero|ui|micro)-(idle|understanding|translating|verifying|verified|uncertain|failed)\.png$/.test(file)) {
      stageOne(join(from, file), join(assets, "mascot", tier, file));
    }
  }
}

const sameWidget = readFileSync(join(repo, "apps/desktop/widget.html")).equals(
  readFileSync(join(assets, "apps/desktop/widget.html")),
);
console.log(
  JSON.stringify({
    assets,
    widgetIsTheSameFile: sameWidget,
    mascotFiles: countFiles(join(assets, "mascot")),
    stagedHere: stagedCount,
    reusedFromConsumer: reused.sort(),
  }, null, 2),
);
if (!sameWidget) process.exit(1);
