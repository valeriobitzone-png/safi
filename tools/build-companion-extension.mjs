#!/usr/bin/env node
import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cryptoShim = join(root, "packages/mobile-consumer/node-crypto-shim.js");
const bundlePath = join(root, "apps/companion-extension/dist/content.js");

await build({
  entryPoints: [join(root, "apps/companion-extension/content.js")],
  outfile: bundlePath,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120"],
  sourcemap: false,
  legalComments: "none",
  plugins: [{
    name: "safi-browser-crypto",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^node:crypto$/ }, () => ({ path: cryptoShim }));
    },
  }],
});

console.log("Built apps/companion-extension/dist/content.js");

// Self-contained harness: the preview server that hosts the harness exposes a
// single file, so the bundle is inlined and the page can hand its own source
// back over postMessage. That is only a loading transport for the very same
// content-script bundle; it never changes Companion behavior.
const bundle = await readFile(bundlePath, "utf8");
const harness = await readFile(join(root, "apps/companion-extension/harness.html"), "utf8");
const inlined = harness.replace(
  /<script src="\.\/dist\/content\.js"><\/script>/,
  [
    '<script id="safi-bundle">',
    bundle.replace(/<\/script/gi, "<\\/script"),
    "</script>",
    "<script>",
    `(function () {
  var source = document.getElementById("safi-bundle").textContent;
  function reply(target) {
    target.postMessage({ type: "safi-bundle-source", source: source }, "*");
  }
  if (window.parent && window.parent !== window) { reply(window.parent); }
  window.addEventListener("message", function (event) {
    if (event.data && event.data.type === "safi-request") { reply(event.source || window.parent); }
  });
})();`,
    "</script>",
  ].join("\n"),
);
if (inlined === harness) {
  throw new Error("harness.html no longer references ./dist/content.js");
}
const inlinePath = join(root, "apps/companion-extension/dist/harness-inline.html");
await writeFile(inlinePath, inlined, "utf8");
console.log("Built apps/companion-extension/dist/harness-inline.html");
