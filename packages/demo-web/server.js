#!/usr/bin/env node
/**
 * Phase 4 local demo server — zero dependencies (Node built-ins only).
 *
 *   node packages/demo-web/server.js [--port 4173]
 *
 * Endpoints:
 *   GET  /                       local MANUAL demo page (Phase 3 stamp)
 *   GET  /api/demos              scenario metadata
 *   POST /api/demo/:id           runs scenario, returns full outcome JSON
 *
 * Credentials: none. The deterministic demo path never touches secrets;
 * the optional real provider reads env vars only at use time.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

import {
  demo1Translation,
  demo2Calculation,
  demo3Correction,
  demo4Uncertainty,
  demo4bFailed,
} from "./scenarios.js";
import { sha256Text } from "./hashing.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const SCENARIOS = {
  "1-translation": { ...demo1Translation(), id: "1-translation", title: "Human → AI translation" },
  "2-calculation": { ...demo2Calculation(), id: "2-calculation", title: "Deterministic verification" },
  "3-correction": { ...demo3Correction(), id: "3-correction", title: "Error and bounded correction" },
  "4-uncertainty": { ...demo4Uncertainty(), id: "4-uncertainty", title: "Honest uncertainty" },
  "4b-failed": { ...demo4bFailed(), id: "4b-failed", title: "Honest failure" },
};

function serializeResult(result, scenario) {
  const { delivery } = result;
  const outcome = delivery.outcome;
  const certificate = outcome.kind === "result" ? outcome.certificate : undefined;
  const hashMatches =
    certificate !== undefined ? certificate.responseSha256 === sha256Text(outcome.answer) : undefined;
  return {
    id: scenario.id,
    title: scenario.title,
    humanMessage: scenario.humanMessage,
    kind: outcome.kind,
    trustStatus: certificate?.trustStatus ?? null,
    answer: outcome.kind === "result" ? outcome.answer : outcome.questions ?? outcome.reason ?? outcome.message,
    certificate: certificate ?? null,
    stamp: delivery.stamp ?? null,
    hashMatches: hashMatches ?? null,
    attemptHistory: certificate?.attemptHistory ?? null,
    // Demo 1 dev-mode steps (HumanRequest → IntentFrame → Semantic → SafiRequest)
    steps: result.steps ?? null,
  };
}

function json(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(data);
}

function serveStatic(res, relPath) {
  const safe = normalize(relPath).replace(/^(\.\.[/\\])+/, "");
  const full = join(root, safe);
  if (!full.startsWith(root) || !existsSync(full)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
  };
  const ext = full.slice(full.lastIndexOf("."));
  res.writeHead(200, { "content-type": types[ext] ?? "application/octet-stream" });
  res.end(readFileSync(full));
}

export function createDemoServer() {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/") {
        serveStatic(res, "packages/demo-web/index.html");
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/ui/")) {
        serveStatic(res, url.pathname.slice(1));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/demos") {
        json(res, 200, {
          scenarios: Object.values(SCENARIOS).map((s) => ({
            id: s.id,
            title: s.title,
            humanMessage: s.humanMessage,
            expectedTrust: s.expectedTrust,
          })),
        });
        return;
      }
      const demoMatch = /^\/api\/demo\/([\w-]+)$/.exec(url.pathname ?? "");
      if (req.method === "POST" && demoMatch) {
        const scenario = SCENARIOS[demoMatch[1]];
        if (!scenario) {
          json(res, 404, { error: "Unknown scenario" });
          return;
        }
        const result = await scenario.run();
        json(res, 200, serializeResult(result, scenario));
        return;
      }
      json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export { SCENARIOS };

/* CLI entry */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const portFlag = process.argv.indexOf("--port");
  const port = portFlag > -1 ? Number(process.argv[portFlag + 1]) : 4173;
  const server = createDemoServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Safi demo: http://127.0.0.1:${port}/  (no credentials required)`);
  });
}
