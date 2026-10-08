import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const ASSETS = join(ROOT, "apps/android/app/src/main/assets");
const IOS_RESOURCES = join(ROOT, "apps/ios/Safi/WebResources");
const CONSUMER = join(ROOT, "packages/mobile-consumer");

type MobileResult = {
  kind: string;
  answer?: string;
  certificate?: {
    trustStatus: string;
    responseSha256: string;
  };
};

type MobileBrain = {
  ask(message: string): Promise<{
    translation: unknown;
    prompt: { kind: string; text: string; originalMessage: string };
  }>;
  verify(answer: string): Promise<MobileResult>;
};

function filesBelow(root: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) {
      files.push(...filesBelow(full).map((child) => `${name}/${child}`));
    } else {
      files.push(name);
    }
  }
  return files.sort();
}

describe("single-source mobile consumer", () => {
  it("packages only the explicit reachable runtime graph", () => {
    const sourceManifest = JSON.parse(
      readFileSync(join(ROOT, "tools/mobile-runtime-manifest.json"), "utf8"),
    ) as {
      resources: Array<{ route: string; source: string; bundle: string; mimeType: string }>;
    };
    const iosManifest = JSON.parse(
      readFileSync(join(IOS_RESOURCES, "runtime-manifest.json"), "utf8"),
    ) as {
      resources: Record<string, { bundle: string; mimeType: string }>;
    };

    expect(Object.keys(iosManifest.resources)).toEqual(
      sourceManifest.resources.map((resource) => resource.route),
    );
    for (const resource of sourceManifest.resources) {
      expect(iosManifest.resources[resource.route]).toEqual({
        bundle: resource.bundle,
        mimeType: resource.mimeType,
      });
      expect(statSync(join(IOS_RESOURCES, resource.bundle)).isFile()).toBe(true);
    }

    const iosFiles = readdirSync(IOS_RESOURCES).sort();
    expect(iosFiles).toEqual([
      ...sourceManifest.resources.map((resource) => resource.bundle),
      "runtime-manifest.json",
    ].sort());
    expect(iosFiles.some((file) => /\.(?:d\.ts|map)$/.test(file))).toBe(false);
    expect(filesBelow(ASSETS)).toHaveLength(sourceManifest.resources.length);

    for (const file of ["brain.js", "index.html"]) {
      const source = readFileSync(join(CONSUMER, file));
      expect(readFileSync(join(ASSETS, file)).equals(source)).toBe(true);
      expect(readFileSync(join(IOS_RESOURCES, file)).equals(source)).toBe(true);
    }

    const appSwift = readFileSync(join(ROOT, "apps/ios/Safi/App.swift"), "utf8");
    expect(appSwift).toContain('Bundle.main.url(forResource: "runtime-manifest", withExtension: "json")');
    expect(appSwift).toContain("runtimeResources[url.path]");
    expect(appSwift).not.toContain("replacingOccurrences");
  });

  it("returns exactly translation and prompt, while Verify stays certified", async () => {
    await import(pathToFileURL(join(ASSETS, "brain.js")).href);
    const brain = (globalThis as { SafiBrain?: MobileBrain }).SafiBrain;
    expect(brain).toBeDefined();

    const ask = await brain!.ask("Ciao, mi spieghi i buchi neri semplice semplice?");
    expect(Object.keys(ask)).toEqual(["translation", "prompt"]);
    expect(ask.prompt.kind).toBe("prompt-ready/v0.1");
    expect(ask.prompt.text.length).toBeGreaterThan(0);
    expect(ask.prompt.originalMessage).toBe("Ciao, mi spieghi i buchi neri semplice semplice?");
    expect(ask).not.toHaveProperty("state");
    expect(ask).not.toHaveProperty("answer");
    expect(ask).not.toHaveProperty("certificate");
    expect(ask).not.toHaveProperty("stamp");
    expect(ask).not.toHaveProperty("trustStatus");

    const verified = await brain!.verify("237 x 14 = 3318");
    const failed = await brain!.verify("237 x 14 = 9999");
    expect(verified.certificate?.trustStatus).toBe("VERIFIED");
    expect(failed.certificate?.trustStatus).toBe("FAILED");
    expect(verified.certificate?.responseSha256).toBe(
      createHash("sha256").update(String(verified.answer), "utf8").digest("hex"),
    );

    delete (globalThis as { SafiBrain?: MobileBrain }).SafiBrain;
  });
});
