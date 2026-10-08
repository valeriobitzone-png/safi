#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createSystemAdapter,
  runAndroidDeviceTest,
} from "./android-device-runner-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function allocatePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!port) throw new Error("Could not allocate a local TCP port");
  return port;
}

function exec(binary, args, timeout) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const adapter = createSystemAdapter({
  exec,
  fetch: globalThis.fetch,
  connectWebSocket: (url) => new WebSocket(url),
  env: process.env,
  sleep,
  allocatePort,
  });

const { exitCode } = await runAndroidDeviceTest({
  adapter,
  artifactsDir: join(ROOT, "artifacts/android-device"),
});

process.exitCode = exitCode;
