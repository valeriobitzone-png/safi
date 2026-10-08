// Temporary probe: why does the long press arm in one step of the run and
// not in another, when the widget is in the same place?
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PKG = "dev.safi.app";
const PORT = 9433;
const sh = (cmd) => spawnSync("adb", ["shell", cmd], { encoding: "utf8", timeout: 60000 }).stdout || "";
const adb = (args) => spawnSync("adb", args, { encoding: "utf8", timeout: 60000 });

let ws, seq = 0;
const pending = new Map();
const send = (method, params) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return `ERR ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`;
  return r.result?.value;
}
async function attach() {
  const pid = sh(`pidof ${PKG}`).trim().split(/\s+/)[0];
  adb(["forward", "--remove-all"]);
  adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
  await sleep(1500);
  const list = JSON.parse(spawnSync("curl", ["-s", `http://127.0.0.1:${PORT}/json/list`], { encoding: "utf8" }).stdout || "[]");
  const t = list.find((x) => x.type === "page" && (x.url ?? "").includes("widget.html"));
  if (!t) throw new Error(`no target ${JSON.stringify(list.map((x) => x.url))}`);
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
  ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data); if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } });
}
function widgetWindow() {
  return sh("dumpsys window windows").split(/\n\s*Window #\d+ Window\{/)
    .filter((b) => b.includes(`u0 ${PKG}`) && /mToken=WindowToken\{[^}]*type=2038/.test(b))
    .map((b) => { const f = /frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(b); const rq = /Requested w=(\d+) h=(\d+)/.exec(b); if (!f || !rq) return null; const [x, y] = [Number(f[1]), Number(f[2])]; return { req: [Number(rq[1]), Number(rq[2])], x, y, w: Number(f[3]) - x, h: Number(f[4]) - y }; })
    .filter(Boolean).sort((a, b) => b.w * b.h - a.w * a.h)[0] || null;
}

async function startSafi() {
  adb(["shell", "am", "force-stop", PKG]); await sleep(1500);
  adb(["shell", "am", "start", "-n", `${PKG}/.BubbleActivity`]); await sleep(6000);
  await attach();
}
async function press(label) {
  const w = widgetWindow();
  const cx = Math.round(w.x + w.w / 2), cy = Math.round(w.y + w.h / 2);
  const info = await evaluate(`(() => {
    const el = document.getElementById("collapsed");
    const r = el ? el.getBoundingClientRect() : null;
    const cx2 = r ? r.x + r.width / 2 : -1, cy2 = r ? r.y + r.height / 2 : -1;
    const hit = r ? document.elementFromPoint(cx2, cy2) : null;
    return JSON.stringify({ ready: document.readyState, rect: r ? [r.x, r.y, r.width, r.height] : null, hit: hit ? (hit.id || hit.className || hit.tagName) : null, menuHidden: document.getElementById("safi-menu")?.hidden, dismiss: window.__SAFI_DIAG__?.dismiss ?? null });
  })()`);
  console.log(`${label} press at ${cx},${cy} window ${w.w}x${w.h} @${w.x},${w.y} | ${info}`);
  adb(["shell", "input", "swipe", String(cx), String(cy), String(cx), String(cy), "900"]);
  await sleep(2600);
  const after = await evaluate(`JSON.stringify({ menuHidden: document.getElementById("safi-menu")?.hidden, dismiss: window.__SAFI_DIAG__?.dismiss ?? null, win: (() => { const r = document.getElementById("collapsed"); return r ? r.getBoundingClientRect().height : null; })() })`);
  console.log(`${label} after: ${after}`);
  return after;
}

sh("input keyevent KEYCODE_WAKEUP"); await sleep(1000);
await startSafi();
await sleep(1500);
await evaluate(`(() => {
  window.__EV = [];
  for (const t of ["pointerdown","pointerup","pointercancel","pointermove","contextmenu","touchstart","touchend","touchcancel","dragstart","selectstart"]) {
    document.addEventListener(t, (e) => {
      if (window.__EV.filter((x) => x.t === t).length > 3) return;
      window.__EV.push({ t, target: (e.target && (e.target.id || e.target.className)) || String(e.target), trusted: e.isTrusted, at: Date.now() % 100000 });
    }, { capture: true, passive: true });
  }
  return 1;
})()`);
await press("[instrumented]");
console.log("events:", await evaluate(`JSON.stringify(window.__EV)`));
// (the tap path is covered by the run itself)
