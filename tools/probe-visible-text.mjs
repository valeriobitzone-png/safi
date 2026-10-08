#!/usr/bin/env node
/**
 * One-off probe: visible TEXT on the COMPACT surface of the release bundle.
 * Spawns the bundle bridge, drives the widget via the CDP harness and dumps
 * innerText of every candidate surface. Absolute paths only.
 */
import { spawn, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";

const ROOT = process.cwd();
const BUNDLE = resolve(process.argv[2] ?? "apps/desktop/src-tauri/target/release/bundle/macos/Safi.app/Contents/Resources/resources/safi");
mkdirSync("/tmp/safi-txt-probe", { recursive: true });

const b = spawn("node", [resolve(BUNDLE, "apps/desktop/bridge.js")], {
  cwd: BUNDLE,
  env: { ...process.env, SAFI_BRIDGE_STATE_DIR: "/tmp/safi-txt-probe" },
  stdio: ["ignore", "pipe", "pipe"],
});
let buf = "";
let harnessRan = false;
b.stderr.on("data", (d) => { buf += d; });
b.stdout.on("data", (d) => {
  buf += d;
  if (harnessRan) return;
  const m = buf.match(/SAFI_BRIDGE_READY port=(\d+) token=([A-Za-z0-9_-]+)/);
  if (!m) return;
  harnessRan = true;
  const url = `http://127.0.0.1:${m[1]}/#t=${m[2]}`;
  const expr =
    'JSON.stringify({mode:window.__SAFI_UI__&&window.__SAFI_UI__.mode,' +
    'collapsed:(document.getElementById("collapsed")?document.getElementById("collapsed").innerText:"NO-EL").trim(),' +
    'boot:(document.getElementById("boot")?document.getElementById("boot").innerText:"NO-EL").trim(),' +
    'body:(document.body.innerText||"").trim().slice(0,300)})';
  try {
    const out = execFileSync(
      "node",
      [resolve(ROOT, "tools/visual-harness.mjs"), "--url", url, "--wait", "window.__SAFI_UI__ && window.__SAFI_UI__.mode === \"COMPACT\"", "--eval", expr, "--out", "/tmp/compact-txt.png"],
      { encoding: "utf8", timeout: 90000 },
    );
    const j = JSON.parse(out.slice(out.indexOf("{")));
    console.log("EVAL:", j.eval);
  } catch (e) {
    console.log("HARNESS-FAIL:", String(e).slice(0, 300), "| BUF:", buf.slice(0, 300));
  }
  b.kill();
  process.exit(0);
});
b.on("exit", (c) => {
  if (!harnessRan) { console.log("BRIDGE-EXIT", c, "| BUF:", buf.slice(0, 400)); process.exit(1); }
});
