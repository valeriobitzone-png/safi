/**
 * One-off frame grabber for the Phase 8B motion acceptance: it produces a
 * trusted click on the panel's own "Cattura e traduci" button and grabs the
 * panel region on a tight cadence in the same CDP session, so the 140ms
 * phases are photographed instead of missed between CLI invocations.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "artifacts/companion-motion/leg-frames");
const targetId = process.argv[2];
const buttonSelector = '#safi-companion-live-panel [data-safi-action="capture"]';
const FRAMES = Number(process.argv[3] || 12);
const STEP_MS = Number(process.argv[4] || 110);

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: done, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else done(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.next++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((done, reject) => this.pending.set(id, { resolve: done, reject }));
  }
}

const version = await (await fetch("http://127.0.0.1:9333/json/version")).json();
const browser = new Cdp(new WebSocket(version.webSocketDebuggerUrl));
await new Promise((done) => browser.ws.addEventListener("open", done, { once: true }));

const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
const send = (method, params) => browser.send(method, params, sessionId);
await send("Page.enable");
await send("Runtime.enable");
await send("Page.bringToFront");

// The panel scrolls its own body when it grows, so the button has to be
// brought back into view before it can be clicked like a user would.
await send("Runtime.evaluate", {
  expression: `(() => { const panel = document.getElementById('safi-companion-live-panel'); [panel, ...(panel?.querySelectorAll('*') ?? [])].forEach((n) => { if (n.scrollHeight > n.clientHeight) n.scrollTop = 0; }); document.querySelector(${JSON.stringify(buttonSelector)})?.scrollIntoView({ block: "center", inline: "center" }); })()`,
});
await new Promise((done) => setTimeout(done, 400));
const box = (
  await send("Runtime.evaluate", {
    expression: `(() => { const n = document.querySelector(${JSON.stringify(buttonSelector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    returnByValue: true,
  })
).result?.value;
if (!box) throw new Error("capture button not found");

const panel = (
  await send("Runtime.evaluate", {
    expression: `(() => { const n = document.getElementById('safi-companion-live-panel'); const r = n.getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16, height: r.height + 16, scale: 1 }; })()`,
    returnByValue: true,
  })
).result?.value;

await mkdir(outDir, { recursive: true });
for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
  await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
}
const started = Date.now();
const frames = [];
for (let index = 0; index < FRAMES; index += 1) {
  const shot = await send("Page.captureScreenshot", { format: "png", clip: panel });
  const file = resolve(outDir, `frame-${String(index).padStart(2, "0")}.png`);
  await writeFile(file, Buffer.from(shot.data, "base64"));
  frames.push({ index, at: Date.now() - started, file });
  await new Promise((done) => setTimeout(done, STEP_MS));
}
console.log(JSON.stringify({ frames }, null, 2));
process.exit(0);
