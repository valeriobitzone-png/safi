#!/usr/bin/env node
/**
 * Real macOS .app control for the 3:2 pass.
 *
 * Launches the INSTALLED bundle, reads the bridge handshake out of the
 * app's own log, and then talks to the SAME loopback channel the widget
 * uses — so every position this tool moves is a real native window move,
 * performed by the shipped shell, and every answer is the shell's own
 * truth about the real NSWindow.
 *
 *   node tools/3x2-app-control.mjs place 40 40
 *   node tools/3x2-app-control.mjs read
 *   node tools/3x2-app-control.mjs shot out.png
 *
 * With SAFI_APP_HOLD=1 the app is left running (for screenshot work);
 * otherwise it is quit when the command finishes.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(repo, "apps/desktop/src-tauri/target/release/bundle/macos/Safi.app");
const EXE = join(APP, "Contents/MacOS/safi-desktop");

/** Launches the real app and waits for the bridge handshake. */
export async function launchApp({ logPath, env = {}, timeoutMs = 30000 } = {}) {
  if (!existsSync(EXE)) throw new Error(`Safi.app missing: ${EXE}`);
  const fd = openSync(logPath, "w");
  const proc = spawn(EXE, [], { env: { ...process.env, ...env }, stdio: ["ignore", fd, fd] });
  const deadline = Date.now() + timeoutMs;
  let handshake = null;
  while (Date.now() < deadline && !handshake) {
    await sleep(200);
    const text = readFileSync(logPath, "utf8");
    // The bridge handshake is relayed by the shell onto its own stderr.
    const m = /SAFI_BRIDGE_READY port=(\d+) token=([A-Za-z0-9_-]+)/.exec(text);
    if (m) handshake = { base: `http://127.0.0.1:${m[1]}/`, token: m[2], port: Number(m[1]) };
  }
  if (!handshake) {
    proc.kill();
    throw new Error(`app did not hand over the bridge: ${readFileSync(logPath, "utf8").slice(-600)}`);
  }
  return { proc, fd, logPath, ...handshake };
}

/** The window channel, spoken exactly as the widget speaks it. */
export async function windowCall(app, path, body) {
  const res = await fetch(`${app.base}api/host/window`, {
    method: body ? "POST" : "GET",
    headers: {
      "x-safi-session": app.token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) return { error: `http-${res.status}` };
  return res.json();
}

export async function readWindow(app) {
  const data = await windowCall(app, null, null);
  return data.window ?? null;
}

/** Screenshot of the whole display, or of one rect when it works. */
export function captureScreen(out, rect) {
  const args = ["-x"];
  if (rect) args.push("-R", `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)}`);
  args.push(out);
  let r = spawnSync("screencapture", args, { timeout: 15000 });
  if ((r.status !== 0 || !existsSync(out)) && rect) {
    // A region capture can be refused by the display state; the full
    // screen always works and still proves the real window moved.
    r = spawnSync("screencapture", ["-x", out], { timeout: 15000 });
    return { ok: r.status === 0, full: true };
  }
  return { ok: r.status === 0, full: !rect };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const logPath = "/tmp/safi-3x2-app.log";
  const app = await launchApp({ logPath });
  let out;
  if (cmd === "read") out = await readWindow(app);
  else if (cmd === "place") out = await windowCall(app, null, { action: "place", x: Number(rest[0]), y: Number(rest[1]), snap: rest[2] === "snap" });
  else if (cmd === "move") out = await windowCall(app, null, { action: "move", dx: Number(rest[0]), dy: Number(rest[1]) });
  else if (cmd === "sync") out = await windowCall(app, null, { action: "sync" });
  else if (cmd === "drag") out = await windowCall(app, null, { action: "drag" });
  else if (cmd === "shot") {
    const state = await readWindow(app);
    out = { state, shot: captureScreen(rest[0] || "/tmp/safi-shot.png", state ? { x: state.x, y: state.y, w: state.w, h: state.h } : null) };
  } else out = { usage: "read | place X Y [snap] | move DX DY | sync | drag | shot FILE" };
  console.log(JSON.stringify(out, null, 2));
  if (process.env.SAFI_APP_HOLD !== "1") {
    app.proc.kill();
    await sleep(300);
  }
  writeFileSync("/tmp/safi-3x2-last.json", JSON.stringify(out, null, 2));
}
