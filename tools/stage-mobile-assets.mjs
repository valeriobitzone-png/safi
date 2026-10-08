#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(join(root, "tools/mobile-runtime-manifest.json"), "utf8"),
);

if (manifest.schema !== "safi-mobile-runtime/v1" || !Array.isArray(manifest.resources)) {
  throw new Error("Invalid mobile runtime manifest");
}

const destinations = {
  Android: join(root, "apps/android/app/src/main/assets"),
  iOS: join(root, "apps/ios/Safi/WebResources"),
};

function assertUniqueResources() {
  const routes = new Set();
  const bundles = new Set();
  for (const resource of manifest.resources) {
    if (!resource.route?.startsWith("/") || !resource.bundle || !resource.mimeType || !resource.source) {
      throw new Error("Every runtime resource needs route, source, bundle and mimeType");
    }
    if (routes.has(resource.route) || bundles.has(resource.bundle)) {
      throw new Error(`Duplicate runtime resource: ${resource.route} / ${resource.bundle}`);
    }
    routes.add(resource.route);
    bundles.add(resource.bundle);
  }
}

function shimImport(route) {
  const relative = posix.relative(posix.dirname(route), "/node-crypto-shim.js");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

function stage(platform) {
  const destination = destinations[platform];
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  const staged = [];

  for (const resource of manifest.resources) {
    const source = join(root, resource.source);
    if (!existsSync(source)) {
      throw new Error(`Missing runtime source ${resource.source}; run npm run build first`);
    }
    const target = join(
      destination,
      platform === "Android" ? resource.route.slice(1) : resource.bundle,
    );
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);

    if (resource.route.endsWith(".js")) {
      const text = readFileSync(target, "utf8");
      const browserText = text.replace(
        /import\s*\{[^}]*\}\s*from\s*["']node:crypto["'];/g,
        `import { createHash } from "${shimImport(resource.route)}";`,
      );
      if (browserText !== text) writeFileSync(target, browserText);
    }
    staged.push({ ...resource, text: readFileSync(target, "utf8") });
  }

  assertReachableGraph(staged);
  if (platform === "iOS") {
    const runtimeManifest = {
      schema: "safi-ios-runtime/v1",
      resources: Object.fromEntries(
        manifest.resources.map((resource) => [
          resource.route,
          { bundle: resource.bundle, mimeType: resource.mimeType },
        ]),
      ),
    };
    writeFileSync(
      join(destination, "runtime-manifest.json"),
      `${JSON.stringify(runtimeManifest, null, 2)}\n`,
    );
  }

  console.log(
    `Staged ${platform}: ${manifest.resources.length} reachable files → ${destination.slice(root.length + 1)}`,
  );
}

function assertReachableGraph(resources) {
  const byRoute = new Map(resources.map((resource) => [resource.route, resource]));
  const pending = ["/index.html"];
  const reachable = new Set();

  while (pending.length > 0) {
    const route = pending.pop();
    if (reachable.has(route)) continue;
    const resource = byRoute.get(route);
    if (!resource) throw new Error(`Runtime import is absent from the manifest: ${route}`);
    reachable.add(route);

    const imports = resource.text.matchAll(
      /\b(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/g,
    );
    for (const match of imports) {
      const specifier = match[1];
      if (specifier.startsWith("node:")) {
        throw new Error(`Unrewritten Node import in ${route}: ${specifier}`);
      }
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
        throw new Error(`Unresolved runtime import in ${route}: ${specifier}`);
      }
      pending.push(posix.resolve(posix.dirname(route), specifier));
    }
  }

  const unreachable = resources.filter((resource) => !reachable.has(resource.route));
  if (unreachable.length > 0) {
    throw new Error(`Unreachable runtime resources: ${unreachable.map((entry) => entry.route).join(", ")}`);
  }
}

assertUniqueResources();
stage("Android");
stage("iOS");
