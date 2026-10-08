/**
 * Card UI evidence: the Companion panel only, with the consumer card scrolled
 * into view, captured collapsed and expanded.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "artifacts/companion-live/gemini");
const targetId = process.argv[2];
const PORT = Number(process.env.SAFI_LIVE_PORT || 9333);

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: done, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else done(message.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.next++;
    this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((done, reject) => this.pending.set(id, { resolve: done, reject }));
  }
}

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const browser = new Cdp(new WebSocket(version.webSocketDebuggerUrl));
await new Promise((done) => browser.ws.addEventListener("open", done, { once: true }));
const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
const send = (method, params) => browser.send(method, params, sessionId);
await send("Page.enable");
await send("Page.bringToFront");

const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.value;

const shoot = async (name) => {
  const clip = await evaluate(`(() => {
    const panel = document.getElementById('safi-companion-live-panel');
    const card = panel.querySelector('[data-safi-live-role="human-card"]');
    card?.scrollIntoView({ block: 'center' });
    const r = panel.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, 720), scale: 1 };
  })()`);
  await new Promise((done) => setTimeout(done, 400));
  const { data } = await send("Page.captureScreenshot", { format: "png", clip });
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, name), Buffer.from(data, "base64"));
  return { name, clip };
};

const results = [];
results.push(await shoot("card-collapsed.png"));
await evaluate(`document.querySelector('#safi-companion-live-panel [data-safi-live-role="details"]').open = true`);
results.push(await shoot("card-expanded.png"));
await evaluate(`document.querySelector('#safi-companion-live-panel [data-safi-live-role="details"]').open = false`);
console.log(JSON.stringify({ results, card: await evaluate(`document.querySelector('#safi-companion-live-panel [data-safi-live-role="human-card"]').textContent`) }, null, 2));
process.exit(0);
