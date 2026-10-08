/**
 * Phase 6 — loopback bridge adversarial tests.
 *
 * A "malicious website" (any page in a browser) tries everything it can
 * from JavaScript alone: guess the port, call without a token, forge an
 * Origin, rebind DNS via the Host header, abuse GET, sneak past the
 * content-type check, oversize the body, and read CORS preflight leaks.
 * The bridge must refuse all of it. Legitimate calls with the session
 * token still work, and the token never reaches disk or logs.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

interface BridgeInfo {
  proc: ReturnType<typeof spawn>;
  port: number;
  token: string;
  stderr: string;
  stdout: string;
  statusPath?: string;
}

async function startBridge(): Promise<BridgeInfo> {
  const proc = spawn(process.execPath, [join(ROOT, "apps/desktop/bridge.js")], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  proc.stdout!.on("data", (chunk) => { stdout += String(chunk); });
  proc.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    // Primary handshake: the machine-readable line on stdout, exactly once.
    const ready = /SAFI_BRIDGE_READY port=(\d+) token=(\S+)/.exec(stdout);
    if (ready) return { proc, port: Number(ready[1]), token: ready[2], stderr, stdout };
    // Fallback discovery (port/pid only — never the token) via tmpdir files.
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith("safi-bridge-") || !name.endsWith(".json")) continue;
      const statusPath = join(tmpdir(), name);
      try {
        const status = JSON.parse(readFileSync(statusPath, "utf8")) as { pid: number; port: number };
        if (status.pid === proc.pid) {
          const tokenMatch = /SAFI_BRIDGE_READY port=\d+ token=(\S+)/.exec(stdout);
          if (tokenMatch) {
            return { proc, port: status.port, token: tokenMatch[1], stderr, stdout, statusPath };
          }
        }
      } catch { /* not written yet */ }
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`bridge did not start within 10s\nstdout: ${stdout}\nstderr: ${stderr}`);
}

function stopBridge(b: BridgeInfo): void {
  b.proc.kill();
  if (b.statusPath) {
    try { rmSync(b.statusPath, { force: true }); } catch { /* ignore */ }
  }
}

type AttackResponse = {
  status: number;
  acao: string | null;
  body: string;
};

async function rawFetch(port: number, headers: Record<string, string>, method = "POST", body?: string): Promise<AttackResponse> {
  const res = await fetch(`http://127.0.0.1:${port}/api/host/verify`, {
    method,
    headers,
    body: method === "GET" || method === "OPTIONS" ? undefined : (body ?? "{}"),
    signal: AbortSignal.timeout(5000),
  });
  return {
    status: res.status,
    acao: res.headers.get("access-control-allow-origin"),
    body: await res.text(),
  };
}

async function withBridge(fn: (b: BridgeInfo) => Promise<void>): Promise<void> {
  const b = await startBridge();
  try {
    await fn(b);
  } finally {
    stopBridge(b);
  }
}

const LEGIT_HEADERS = (port: number, token: string) => ({
  "content-type": "application/json",
  "x-safi-session": token,
  // The embedded widget page is served from the loopback origin itself.
  "origin": `http://127.0.0.1:${port}`,
});

describe("loopback bridge hardening (malicious-site simulation)", () => {
  it("binds to a random port and a cryptographically random session token", async () => {
    const first = await startBridge();
    try {
      expect(first.port).toBeGreaterThanOrEqual(49152);
      expect(first.port).toBeLessThanOrEqual(65535);
      // 32 random bytes, base64url-encoded: 43 chars, ~256 bits of entropy.
      expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const second = await startBridge();
      stopBridge(second);
      expect(second.token).not.toBe(first.token);
      expect(second.port).not.toBe(first.port);
    } finally {
      stopBridge(first);
    }
  });

  it("refuses requests without a session token", async () => {
    await withBridge(async (b) => {
      const res = await rawFetch(b.port, { "content-type": "application/json" });
      expect(res.status).toBe(401);
      expect(res.acao).toBeNull();
    });
  });

  it("refuses wrong or brute-forced tokens", async () => {
    await withBridge(async (b) => {
      const res = await rawFetch(b.port, LEGIT_HEADERS(b.port, "0".repeat(43)));
      expect(res.status).toBe(401);
    });
  });

  it("refuses a forged cross-site Origin (CSRF from malicious page)", async () => {
    await withBridge(async (b) => {
      const res = await rawFetch(b.port, { ...LEGIT_HEADERS(b.port, b.token), origin: "https://evil.example" });
      expect(res.status).toBe(403);
    });
  });

  it("refuses DNS-rebinding via attacker-controlled Host header", async () => {
    await withBridge(async (b) => {
      const res = await fetch(`http://127.0.0.1:${b.port}/api/host/verify`, {
        method: "POST",
        headers: { ...LEGIT_HEADERS(b.token), host: "evil.example" },
        body: JSON.stringify({ answer: "237 x 14 = 3318" }),
      }).then(async (r) => ({ status: r.status, acao: r.headers.get("access-control-allow-origin"), body: await r.text() }));
      expect(res.status).toBe(403);
    });
  });

  it("refuses GET on sensitive endpoints", async () => {
    await withBridge(async (b) => {
      const res = await rawFetch(b.port, LEGIT_HEADERS(b.port, b.token), "GET");
      expect(res.status).toBe(405);
    });
  });

  it("refuses unexpected content-types", async () => {
    await withBridge(async (b) => {
      const res = await rawFetch(b.port, { ...LEGIT_HEADERS(b.port, b.token), "content-type": "text/plain" });
      expect(res.status).toBe(415);
    });
  });

  it("enforces input size limits", async () => {
    await withBridge(async (b) => {
      const res = await rawFetch(b.port, LEGIT_HEADERS(b.port, b.token), "POST", JSON.stringify({ answer: "x".repeat(40_000) }));
      expect(res.status).toBe(413);
    });
  });

  it("does not answer CORS preflights with a permissive policy", async () => {
    await withBridge(async (b) => {
      const res = await rawFetch(
        b.port,
        {
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,x-safi-session",
          origin: "https://evil.example",
        },
        "OPTIONS",
      );
      expect(res.acao).toBeNull();
    });
  });

  it("keeps Ask completion separate from verification trust", async () => {
    await withBridge(async (b) => {
      const res = await fetch(`http://127.0.0.1:${b.port}/api/host/ask`, {
        method: "POST",
        headers: { ...LEGIT_HEADERS(b.port, b.token), host: `127.0.0.1:${b.port}` },
        body: JSON.stringify({ message: "come creo un app con una bella grafica?" }),
      });
      const data = await res.json();
      expect(data.kind).toBe("prompt_ready");
      expect(data.certificate).toBeNull();
      expect(data.stamp).toBeNull();
      expect(data.widget.state).toBe("PROMPT_READY");
      expect(data.widget.trust).toBeUndefined();
      expect(data.prompt.certificate.scope).toBe("translation-only");
      expect(data.prompt.certificate.factual).toBe(false);
    });
  });

  it("rejects empty Ask input without changing widget state", async () => {
    await withBridge(async (b) => {
      const empty = await fetch(`http://127.0.0.1:${b.port}/api/host/ask`, {
        method: "POST",
        headers: { ...LEGIT_HEADERS(b.port, b.token), host: `127.0.0.1:${b.port}` },
        body: JSON.stringify({ message: "   " }),
      });
      expect(empty.status).toBe(400);
      const data = await empty.json();
      expect(data.error).toMatch(/human message/);
      const info = await fetch(`http://127.0.0.1:${b.port}/api/host/info`, {
        headers: { ...LEGIT_HEADERS(b.port, b.token), host: `127.0.0.1:${b.port}` },
      }).then((res) => res.json());
      expect(info.widget.state).toBe("IDLE");
    });
  });

  it("rejects null JSON bodies without changing state", async () => {
    await withBridge(async (b) => {
      const ask = await fetch(`http://127.0.0.1:${b.port}/api/host/ask`, {
        method: "POST",
        headers: { ...LEGIT_HEADERS(b.port, b.token), host: `127.0.0.1:${b.port}` },
        body: "null",
      });
      expect(ask.status).toBe(400);
      expect((await ask.json()).error).toMatch(/human message/);

      const verify = await fetch(`http://127.0.0.1:${b.port}/api/host/verify`, {
        method: "POST",
        headers: { ...LEGIT_HEADERS(b.port, b.token), host: `127.0.0.1:${b.port}` },
        body: "null",
      });
      expect(verify.status).toBe(400);
      expect((await verify.json()).error).toMatch(/external answer text/);

      const info = await fetch(`http://127.0.0.1:${b.port}/api/host/info`, {
        headers: { ...LEGIT_HEADERS(b.port, b.token), host: `127.0.0.1:${b.port}` },
      }).then((res) => res.json());
      expect(info.widget.state).toBe("IDLE");
    });
  });

  it("rejects non-string Ask and Verify payloads without changing state", async () => {
    await withBridge(async (b) => {
      const ask = await fetch(`http://127.0.0.1:${b.port}/api/host/ask`, {
        method: "POST",
        headers: { ...LEGIT_HEADERS(b.port, b.token), host: `127.0.0.1:${b.port}` },
        body: JSON.stringify({ message: { text: "not a string" } }),
      });
      expect(ask.status).toBe(400);
      expect((await ask.json()).error).toMatch(/human message/);

      const verify = await fetch(`http://127.0.0.1:${b.port}/api/host/verify`, {
        method: "POST",
        headers: { ...LEGIT_HEADERS(b.port, b.token), host: `127.0.0.1:${b.port}` },
        body: JSON.stringify({ answer: 42 }),
      });
      expect(verify.status).toBe(400);
      expect((await verify.json()).error).toMatch(/external answer text/);

      const info = await fetch(`http://127.0.0.1:${b.port}/api/host/info`, {
        headers: { ...LEGIT_HEADERS(b.port, b.token), host: `127.0.0.1:${b.port}` },
      }).then((res) => res.json());
      expect(info.widget.state).toBe("IDLE");
    });
  });

  it("keeps concurrent Ask responses bound to their own input", async () => {
    await withBridge(async (b) => {
      const request = (message: string) => fetch(`http://127.0.0.1:${b.port}/api/host/ask`, {
        method: "POST",
        headers: { ...LEGIT_HEADERS(b.port, b.token), host: `127.0.0.1:${b.port}` },
        body: JSON.stringify({ message }),
      }).then((res) => res.json());
      const [first, second] = await Promise.all([
        request("prima richiesta"),
        request("seconda richiesta"),
      ]);
      expect(first.prompt.originalMessage).toBe("prima richiesta");
      expect(second.prompt.originalMessage).toBe("seconda richiesta");
    });
  });

  it("still serves legitimate loopback traffic end to end", async () => {
    await withBridge(async (b) => {
      const res = await fetch(`http://127.0.0.1:${b.port}/api/host/verify`, {
        method: "POST",
        headers: { ...LEGIT_HEADERS(b.port, b.token), host: `127.0.0.1:${b.port}` },
        body: JSON.stringify({ answer: "237 x 14 = 3318" }),
      });
      const data = await res.json();
      expect(data.certificate.trustStatus).toBe("VERIFIED");
      const calc = data.certificate.checks.find((c: { checkId: string }) => c.checkId === "calculation");
      expect(calc?.outcome).toBe("PASS"); // the independent deterministic computation agreed
    });
  });

  it("never writes the session token to disk or logs", async () => {
    const b = await startBridge();
    try {
      await fetch(`http://127.0.0.1:${b.port}/api/host/verify`, {
        method: "POST",
        headers: { ...LEGIT_HEADERS(b.port, b.token), host: `127.0.0.1:${b.port}` },
        body: JSON.stringify({ answer: "2 + 2 = 4" }),
      });
      // The human-readable log must never contain the token.
      expect(b.stderr).not.toContain(b.token);
      // The stdout handshake mentions it exactly once, by contract.
      expect(b.stdout.split(b.token).length - 1).toBe(1);
      // Scan every bridge runtime artifact for the token.
      const dir = tmpdir();
      for (const name of readdirSync(dir)) {
        if (!name.startsWith("safi-bridge-")) continue;
        const content = readFileSync(join(dir, name), "utf8");
        expect(content).not.toContain(b.token);
      }
    } finally {
      stopBridge(b);
    }
  });
});
