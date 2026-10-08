#!/usr/bin/env node
/** Debug: one compact capture with full harness stderr passthrough. */
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync, readFileSync, existsSync } from "node:fs";

const BUNDLE = resolve(
  "apps/desktop/src-tauri/target/release/bundle/macos/Safi.app/Contents/Resources/resources/safi",
);
mkdirSync("/tmp/safi-golden-dbg", { recursive: true });
const b = spawn("node", [resolve(BUNDLE, "apps/desktop/bridge.js")], {
  cwd: BUNDLE,
  env: { ...process.env, SAFI_BRIDGE_STATE_DIR: "/tmp/safi-golden-dbg" },
  stdio: ["ignore", "pipe", "pipe"],
});
let buf = "";
b.stdout.on("data", (d) => { buf += d; });
b.stderr.on("data", (d) => { buf += d; });
async function main() {
  await new Promise((r) => setTimeout(r, 3000));
  const m = buf.match(/SAFI_BRIDGE_READY port=(\d+) token=([A-Za-z0-9_-]+)/);
  if (!m) { console.log("NO READY:", buf.slice(0, 400)); b.kill(); process.exit(1); }
  const url = `http://127.0.0.1:${m[1]}/#t=${m[2]}`;
  console.log("URL:", url.replace(/t=[^&]+/, "t=***"));
  // STEP A: does the harness work at all against this bridge URL (bare
  // wait=true)? This isolates bridge-URL hangs from predicate waits.
  const child = spawn("node", [
    resolve("tools/visual-harness.mjs"),
    "--url", url,
    "--wait", "true",
    "--out", "/tmp/compact-probe.png",
    "--vw", "170", "--vh", "70", "--timeout", "5000",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  child.on("exit", (code, signal) => { console.log("[child exit]", code, signal); });
  child.on("error", (e) => { console.log("[child error]", e.message); });
  // Watchdog: the PNG is written before any late hang point; the moment
  // it exists the capture is DONE, whatever the harness process does after.
  const pngPath = "/tmp/compact-probe.png";
  const started = Date.now();
  const havePng = () => { try { return readFileSync(pngPath).length > 500; } catch { return false; } };
  while (Date.now() - started < 30000 && !havePng()) await new Promise((r) => setTimeout(r, 250));
  const ok = havePng();
  child.kill("SIGKILL");
  await new Promise((r) => setTimeout(r, 300));
  console.log("PNG:", ok ? "captured" : "MISSING", "| stdout len:", out.length, "| stderr:", err.slice(0, 300));
  b.kill();
  process.exit(ok ? 0 : 1);
}
main();
