#!/usr/bin/env node
/**
 * Safi Desktop bridge — hardened loopback-only host server (Phase 6).
 *
 * Security model:
 *   - binds EXCLUSIVELY to 127.0.0.1;
 *   - listens on an OS-assigned ephemeral port by default (--port 0),
 *     so the address is not predictable; --port N stays for dev;
 *   - generates a random session token at startup. The token is handed
 *     to the embedding shell ONCE on stdout (`SAFI_BRIDGE_READY ...`),
 *     which injects it into the widget webview. It is never written to
 *     disk, never printed in logs and redacted from any error text;
 *   - every /api/* endpoint requires the token (constant-time compare);
 *   - requests with an unexpected Origin (any other website) or an
 *     unexpected Host header (DNS-rebinding) are refused: this is what
 *     stops a malicious web page from talking to the local bridge;
 *   - NO CORS headers at all: same-origin only, no preflight support;
 *   - only expected methods and content types are accepted;
 *   - request bodies are capped;
 *   - exits with its parent (watchdog) and on SIGINT/SIGTERM;
 *   - writes nothing to disk: no conversations, no tokens, no logs.
 *
 *   node apps/desktop/bridge.js [--port 0] [--platform macos|windows]
 *
 * Endpoints (all loopback, token-gated where marked):
 *   GET  /                     floating widget page (static, no secrets)
 *   GET  /mascot/{tier}/{file}  production mascot masters (21 PNG, static)
 *   GET  /ui/safi-stamp.js     Phase 3 reference stamp component (static)
 *   GET  /api/host/info        TOKEN — platform, consent, widget snapshot
 *   POST /api/host/ask         TOKEN — Human→AI: { message }
 *   POST /api/host/verify      TOKEN — AI→Human: { answer }
 *   POST /api/host/consent     TOKEN — { capability, grant } explicit toggle
 *   POST /api/host/selftest    TOKEN — cycle acceptance counters (relayed)
 *   POST /api/host/surface     TOKEN — { width, height } widget size hint
 *
 * Window sizing: the widget reports its content size through
 * /api/host/surface (token-gated, size-only integers); the bridge
 * relays a machine line on stdout (`SAFI_SURFACE ...`) that the native
 * shell parses to fit the window between compact dot and full panel.
 * The page itself exposes NO native API surface.
 *
 * Pasted text arrives through the widget's own textarea (the person
 * pastes it); the system clipboard is never read over HTTP.
 */
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

import { createDesktopHost } from "./host.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const platform = argValue("--platform", process.platform === "win32" ? "windows" : "macos");
const port = Number(argValue("--port", "0")); // 0 = OS-assigned ephemeral port
const MAX_BODY_BYTES = 32 * 1024; // messages and answers stay well under this

const host = createDesktopHost({ platform });
const sessionToken = randomBytes(32).toString("base64url");

// Discovery file for embedders/tests/orphan detection: pid and port only.
// The session token NEVER goes here, to disk or to the human-readable log.
const statusPath = join(tmpdir(), `safi-bridge-${process.pid}.json`);
function removeStatusFile() {
  try { rmSync(statusPath, { force: true }); } catch { /* nothing to clean */ }
}
process.on("exit", removeStatusFile);

/** Redacts the session token from anything that might reach output. */
function redact(text) {
  return String(text).replaceAll(sessionToken, "[redacted]");
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    // Deliberately NO Access-Control-* headers: the bridge is same-origin
    // only. Cross-origin browser callers are stopped earlier by the
    // Origin check anyway.
  });
  res.end(JSON.stringify(body, null, 2));
}

function serveStatic(res, relPath, contentType = "text/javascript; charset=utf-8") {
  const safe = normalize(relPath).replace(/^(\.[/\\])+/, "");
  const full = join(root, safe);
  if (!full.startsWith(root) || !existsSync(full)) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }
  res.writeHead(200, { "content-type": contentType, "cache-control": "no-store" });
  res.end(readFileSync(full));
}

function tokenMatches(headerValue) {
  if (typeof headerValue !== "string" || headerValue.length === 0) return false;
  const provided = Buffer.from(headerValue);
  const expected = Buffer.from(sessionToken);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Refuses cross-site callers. A malicious web page can send fetch() to
 * http://127.0.0.1:* but it CANNOT fake these two things:
 *   - its requests carry an Origin header of its own site;
 *   - a DNS-rebinding attack produces a Host header that is not ours.
 */
function rejectUnexpectedCaller(req, res, actualPort) {
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://127.0.0.1:${actualPort}`) {
    sendJson(res, 403, { error: "Unexpected origin: this API serves the local Safi widget only." });
    return true;
  }
  const hostHeader = req.headers.host;
  if (hostHeader !== `127.0.0.1:${actualPort}` && hostHeader !== `localhost:${actualPort}`) {
    sendJson(res, 403, { error: "Unexpected Host header." });
    return true;
  }
  return false;
}

function requireToken(req, res) {
  const provided =
    req.headers["x-safi-session"] ??
    (typeof req.headers.authorization === "string" &&
    req.headers.authorization.startsWith("Bearer ")
      ? req.headers.authorization.slice("Bearer ".length)
      : undefined);
  if (!tokenMatches(provided)) {
    sendJson(res, 401, { error: "Missing or invalid session token." });
    return false;
  }
  return true;
}

function requireJsonContentType(req, res) {
  const contentType = String(req.headers["content-type"] ?? "");
  if (!/^application\/json\b/.test(contentType)) {
    sendJson(res, 415, { error: "Expected application/json." });
    return false;
  }
  return true;
}

async function readBody(req, res) {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    sendJson(res, 413, { error: "Request body too large." });
    return undefined;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      sendJson(res, 413, { error: "Request body too large." });
      req.destroy();
      return undefined;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return undefined;
  }
}

const server = createServer(async (req, res) => {
  try {
    // Base without the port: only pathname matching matters here.
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const actualPort = server.address()?.port ?? port;

    // Static assets: same-origin only, no secrets inside.
    if (req.method === "GET" && url.pathname === "/") {
      if (rejectUnexpectedCaller(req, res, actualPort)) return;
      return serveStatic(res, "apps/desktop/widget.html", "text/html; charset=utf-8");
    }
    if (req.method === "GET" && url.pathname === "/ui/safi-stamp.js") {
      if (rejectUnexpectedCaller(req, res, actualPort)) return;
      return serveStatic(res, "ui/safi-stamp.js");
    }
    if (req.method === "GET" && url.pathname === "/ui/projection.js") {
      // Second module of the Phase 3 stamp component: it must be
      // reachable from the bundled runtime too (Phase 6.1 root cause).
      if (rejectUnexpectedCaller(req, res, actualPort)) return;
      return serveStatic(res, "ui/projection.js");
    }
    /* Production mascot assets (golden/production-mascot): the single
       source of truth for every visible Safi pixel. ONLY the 21 delivered
       masters are reachable, by exact name: no directory listing, no
       traversal, no procedural fallback. The procedural figure is NOT
       served anymore (MASCOT_LOCK.md: archived, zero runtime pixels). */
    const mascotAsset = /^\/mascot\/(hero|ui|micro)\/safi-(hero|ui|micro)-(idle|understanding|translating|verifying|verified|uncertain|failed)\.png$/.exec(url.pathname);
    if (req.method === "GET" && mascotAsset) {
      if (rejectUnexpectedCaller(req, res, actualPort)) return;
      const [, tier, tierAgain, state] = mascotAsset;
      if (tier !== tierAgain) { sendJson(res, 404, { error: "Not found" }); return; }
      return serveStatic(res, `golden/production-mascot/${tier}/safi-${tier}-${state}.png`, "image/png");
    }

    // Every API route: strict caller checks, token, then routing.
    if (url.pathname.startsWith("/api/")) {
      const ROUTE_METHODS = {
        "/api/host/info": ["GET"],
        "/api/host/ask": ["POST"],
        "/api/host/verify": ["POST"],
        "/api/host/consent": ["POST"],
        "/api/host/selftest": ["POST"],
      };
      const allowed = ROUTE_METHODS[url.pathname];
      if (allowed !== undefined && !allowed.includes(req.method ?? "")) {
        return sendJson(res, 405, { error: "Method not allowed." });
      }
      if (req.method !== "GET" && req.method !== "POST") {
        return sendJson(res, 405, { error: "Method not allowed." });
      }
      if (rejectUnexpectedCaller(req, res, actualPort)) return;
      if (!requireToken(req, res)) return;
      if (req.method === "POST" && !requireJsonContentType(req, res)) return;

      if (req.method === "GET" && url.pathname === "/api/host/info") {
        return sendJson(res, 200, {
          hostId: host.hostId,
          platform: host.platform,
          bridge: host.bridge,
          consent: host.consent.snapshot(),
          widget: host.widgetSnapshot(),
          host: {
            // Set by the native shell when the REAL Liquid Glass material
            // (window-vibrancy apply_liquid_glass) was applied to the
            // window. Honest signal for the widget's dev diagnostics.
            nativeGlass: process.env.SAFI_NATIVE_GLASS === "1",
            // TRUE only when a real window manager is resizing this
            // window for the surface hints. In a plain browser (visual
            // harness) the hints are relayed but no OS resizes anything,
            // so the widget does not wait for a confirmation that can
            // never arrive.
            nativeShell: process.env.SAFI_NATIVE_SHELL === "1",
            // Release shells never set this: developer inspection surfaces
            // stay out of the production UI. Dev builds may set it.
            devMode: process.env.SAFI_DEV === "1",
          },
        });
      }
      if (req.method === "POST" && url.pathname === "/api/host/selftest") {
        // Acceptance relay (brief §7): the page runs the REAL cycle
        // driver in the installed app and reports its own measurements
        // (native window sizes included). The bridge only forwards a
        // size/counter summary on stdout so the shell log can prove the
        // 30/30 run happened in the real .app — no secrets, no content.
        const body = await readBody(req, res);
        if (body === undefined) return;
        const n = Math.max(0, Math.min(60, Math.round(Number(body.total ?? 0))));
        const ints = (v) => Math.max(0, Math.round(Number(v ?? 0)));
        const summary = {
          total: n,
          fullOpen: ints(body.fullOpen),
          clipped: ints(body.clipped),
          secondClick: ints(body.secondClick),
          ghostPanel: ints(body.ghostPanel),
          wrongCompactSize: ints(body.wrongCompactSize),
          wrongExpandedSize: ints(body.wrongExpandedSize),
          nativeResizes: body.nativeResizes === true,
        };
        process.stdout.write(`SAFI_SELFTEST ${JSON.stringify(summary)}\n`);
        return sendJson(res, 200, { ok: true, summary });
      }
      if (req.method === "POST" && url.pathname === "/api/host/ask") {
        const body = await readBody(req, res);
        if (body === undefined) return;
        const loop = await host.runPipeline(String(body.message ?? ""));
        const outcome = loop.delivery.outcome;
        return sendJson(res, 200, {
          kind: outcome.kind,
          answer: outcome.kind === "result" ? outcome.answer : outcome.questions ?? outcome.reason ?? outcome.message,
          certificate: outcome.kind === "result" ? outcome.certificate : null,
          stamp: loop.delivery.stamp ?? null,
          widget: host.widgetSnapshot(),
          translation: host.lastTranslation(),
        });
      }
      if (req.method === "POST" && url.pathname === "/api/host/verify") {
        const body = await readBody(req, res);
        if (body === undefined) return;
        const outcome = await host.verifyExternalAnswer(String(body.answer ?? ""));
        return sendJson(res, 200, {
          kind: outcome.kind,
          certificate: outcome.kind === "result" ? outcome.certificate : null,
          widget: host.widgetSnapshot(),
        });
      }
      if (req.method === "POST" && url.pathname === "/api/host/consent") {
        const body = await readBody(req, res);
        if (body === undefined) return;
        const capability = String(body.capability ?? "");
        if (!body.grant) {
          host.consent.revoke(capability);
        } else {
          host.consent.grant(capability);
        }
        return sendJson(res, 200, { consent: host.consent.snapshot() });
      }
      if (req.method === "POST" && url.pathname === "/api/host/surface") {
        // Size-only relay for the native shell. Integers, clamped; the
        // optional mode is a fixed enum, never free-form data.
        const body = await readBody(req, res);
        if (body === undefined) return;
        const width = Math.max(48, Math.min(480, Math.round(Number(body.width ?? 0))));
        const height = Math.max(48, Math.min(640, Math.round(Number(body.height ?? 0))));
        const allowedModes = new Set(["BOOT", "COMPACT", "EXPANDED", "CLOSE", "EXPANDING", "COLLAPSING"]);
        const mode = allowedModes.has(String(body.mode)) ? String(body.mode) : "COMPACT";
        process.stdout.write(`SAFI_SURFACE width=${width} height=${height} mode=${mode}\n`);
        return sendJson(res, 200, { width, height, mode });
      }
      // NOTE: there is deliberately NO /api/host/clipboard route. Text
      // enters through the widget's "Verifica questa risposta" field,
      // pasted by the person themselves. No code path reads the system
      // clipboard over HTTP; on-demand clipboard hooks belong to the
      // native shell (Tauri), behind explicit consent, never to a local
      // HTTP surface.

      return sendJson(res, 404, { error: "Not found" });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    return sendJson(res, 400, { error: redact(error instanceof Error ? error.message : String(error)) });
  }
});

// Hardened server timeouts.
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

server.listen(port, "127.0.0.1", () => {
  const actualPort = server.address()?.port ?? port;
  try {
    writeFileSync(statusPath, JSON.stringify({ pid: process.pid, port: actualPort }));
  } catch { /* tmpdir unavailable: tests then discover via stdout handshake */ }
  // Machine handshake: the ONLY place the token appears, on stdout, once.
  // stderr is the human-readable log and NEVER contains the token.
  process.stdout.write(`SAFI_BRIDGE_READY port=${actualPort} token=${sessionToken}\n`);
  console.error(`Safi desktop host (${platform}) on http://127.0.0.1:${actualPort} — token handed to the embedder only`);
});

// Die with the parent app: orphan detection (reparented to init/launchd).
setInterval(() => {
  if (process.ppid === 1) process.exit(0);
}, 4000).unref();

// Clean shutdown on signals; nothing to flush anywhere (no disk writes).
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    removeStatusFile();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
