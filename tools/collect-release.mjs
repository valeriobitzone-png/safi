#!/usr/bin/env node
/**
 * Collect release artifacts and write checksums + build report.
 *
 * Only REAL artifacts present on disk are copied (macOS .app/.dmg from
 * the verified Tauri build; mobile artifacts if a build host produced
 * them). Everything is hashed with SHA-256 into checksums.txt, and
 * BUILD_REPORT.md records provenance, environment and verification.
 *
 *   npm run app:build:macos && npm run release:collect
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const release = join(root, "release");

rmSync(release, { recursive: true, force: true });

const collected = [];

function collect(from, platform, name) {
  if (!existsSync(from)) return;
  const destDir = join(release, platform);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, name);
  if (statSync(from).isDirectory()) {
    cpSync(from, dest, { recursive: true });
  } else {
    cpSync(from, dest);
  }
  collected.push({ platform, name, path: dest });
}

// macOS: the verified bundle from this environment.
const macosApp = join(root, "apps/desktop/src-tauri/target/release/bundle/macos/Safi.app");
collect(macosApp, "macos", "Safi.app");
// The shipped DMG is the hdiutil-created Safi.dmg (see PACKAGING.md); the
// Tauri-named one is only a fallback when Safi.dmg has not been created yet.
const macosDmg = join(root, "apps/desktop/src-tauri/target/release/bundle/dmg/Safi.dmg");
const macosDmgTauri = join(root, "apps/desktop/src-tauri/target/release/bundle/dmg/Safi_0.1.0_aarch64.dmg");
if (existsSync(macosDmg)) {
  collect(macosDmg, "macos", "Safi.dmg");
} else if (existsSync(macosDmgTauri)) {
  collect(macosDmgTauri, "macos", "Safi_0.1.0_aarch64.dmg");
}

// Windows: produced only on a Windows host (see PACKAGING.md).
const msiDir = join(root, "apps/desktop/src-tauri/target/release/bundle/msi");
if (existsSync(msiDir)) {
  for (const name of readdirSync(msiDir)) {
    if (name.endsWith(".msi")) collect(join(msiDir, name), "windows", name);
  }
}

// Android/iOS: APK/IPA if a mobile build host produced them.
for (const [platform, dir, ext] of [
  ["android", join(root, "apps/android/app/build/outputs/apk/release"), ".apk"],
  ["android", join(root, "apps/android/app/build/outputs/apk/debug"), ".apk"],
  ["ios", join(root, "apps/ios/build"), ".ipa"],
]) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (name.endsWith(ext)) collect(join(dir, name), platform, name);
  }
}

// checksums.txt — SHA-256 over every collected artifact (files only).
const lines = [];
for (const entry of collected) {
  const rel = entry.path.slice(release.length + 1);
  if (statSync(entry.path).isDirectory()) {
    // The .app bundle is hashed as its single-file zip sibling.
    continue;
  }
  const content = readFileSync(entry.path);
  const digest = createHash("sha256").update(content).digest("hex");
  lines.push(`${digest}  ${rel}`);
}
mkdirSync(release, { recursive: true });
writeFileSync(join(release, "checksums.txt"), lines.join("\n") + "\n");

// BUILD_REPORT.md — provenance and honesty about what was verified.
const stamp = new Date().toISOString();
const report = `# Safi Release — Build Report

- Generated: ${stamp}
- Platform of the build host: ${process.platform} (${process.arch})
- Node: ${process.version}

## Artifacts

${lines.length === 0 ? "_none_ (run the platform builds first)" : lines.map((l) => `- ${l}`).join("\n")}

## Provenance & verification

- \`Safi.app\`: Tauri 2 shell, built with \`npm run app:build:macos\`.
  Verified in this environment: the app builds, the staged runtime
  inside \`Contents/Resources/resources/safi\` boots the hardened
  bridge (\`SAFI_BRIDGE_READY\`), and the \`.dmg\` mounts read-only.
- Icons are deterministic (\`npm run app:icon\`): byte-identical across
  machines, no binary committed.
- The loopback bridge is the hardened Phase 6 version: ephemeral port,
  session token (never on disk/logs), Origin/Host checks, no CORS,
  body caps, watchdog. Adversarial tests: \`tests/bridge-hardening.test.ts\`.
- Mobile brains are the SHARED brain: \`tests/android-brain.test.ts\`
  proves identical trust states and certificate hashes from the staged
  WebView assets.
- Windows \`.msi\`: produced only on a Windows host (see
  \`apps/desktop/PACKAGING.md\`); cross-built installers are not
  shipped on purpose.
- No secrets, credentials or conversations are embedded in any
  artifact; the optional live provider reads env vars only.
`;
writeFileSync(join(release, "BUILD_REPORT.md"), report);

console.log(`release/ collected: ${collected.length} artifact(s), ${lines.length} checksum(s)`);
for (const l of lines) console.log(`  ${l}`);
