#!/usr/bin/env node
/**
 * Phase 7 live acceptance transport.
 *
 * The Preview browser cannot load an unpacked MV3 extension, so the very same
 * content-script bundle is served from loopback with CORS enabled. The
 * authorized page fetches those exact bytes and evaluates them; the transport
 * only moves bytes, it never changes Companion behavior.
 *
 * Usage: node tools/companion-live-transport.mjs [port]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = join(root, "apps/companion-extension/dist/content.js");
const port = Number(process.argv[2] || 8788);

const bundle = await readFile(bundlePath);
const digest = createHash("sha256").update(bundle).digest("hex");

const server = createServer((request, response) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Cache-Control": "no-store",
  };
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  if (request.url?.split("?")[0] !== "/content.js") {
    response.writeHead(404, headers);
    response.end("not found");
    return;
  }
  response.writeHead(200, {
    ...headers,
    "Content-Type": "text/javascript; charset=utf-8",
    "Content-Length": String(bundle.length),
    "X-Safi-Bundle-Sha256": digest,
  });
  response.end(request.method === "HEAD" ? undefined : bundle);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`companion-live-transport http://127.0.0.1:${port}/content.js sha256=${digest}`);
});
