/**
 * Safi PRODUCTION ASSETS — unit tests.
 *
 * The 21 delivered masters in golden/production-mascot are the ONLY
 * source of visible Safi pixels. These tests lock:
 *   - the delivered set (7 states × 3 tiers, exact sizes, MANIFEST
 *     checksums byte-for-byte),
 *   - the optical mapping (0–72px MICRO, 73–180px UI, >180px HERO),
 *   - the runtime contract: the widget renders <img> from the masters
 *     and contains ZERO procedural figure code,
 *   - the icon pipeline composites the delivered masters and never
 *     draws a figure.
 *
 * The archived procedural module (ui/safi-mascot.js) is still importable
 * for historical reference, but nothing may render it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "../tools/png-analysis.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATES = ["idle", "understanding", "translating", "verifying", "verified", "uncertain", "failed"] as const;
const TIERS = { hero: 512, ui: 128, micro: 64 } as const;

describe("Safi PRODUCTION ASSETS — the 21 delivered masters", () => {
  it("delivers exactly 7 HERO (512²), 7 UI (128²), 7 MICRO (64²)", () => {
    let total = 0;
    for (const [tier, size] of Object.entries(TIERS)) {
      for (const state of STATES) {
        const p = join(repo, "golden", "production-mascot", tier, `safi-${tier}-${state}.png`);
        expect(existsSync(p), `${tier}/${state}`).toBe(true);
        const img = decodePng(p);
        expect([img.width, img.height], `${tier}/${state} size`).toEqual([size, size]);
        // Real content: the master is not a blank canvas.
        let painted = 0;
        for (let i = 3; i < img.pixels.length; i += 4) if (img.pixels[i] > 0) painted++;
        expect(painted, `${tier}/${state} has pixels`).toBeGreaterThan(size);
        total += 1;
      }
    }
    expect(total).toBe(21);
  });

  it("MANIFEST.json exists and every checksum matches byte-for-byte", () => {
    const manifestPath = join(repo, "golden", "production-mascot", "MANIFEST.json");
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const tier of Object.keys(TIERS)) {
      expect(Object.keys(manifest.tiers[tier]).length, `${tier} manifest entries`).toBe(7);
      for (const [file, expected] of Object.entries<{ sha256: string; bytes: number }>(manifest.tiers[tier])) {
        const bytes = readFileSync(join(repo, "golden", "production-mascot", tier, file));
        expect(bytes.length, `${file} bytes`).toBe(expected.bytes);
        expect(createHash("sha256").update(bytes).digest("hex"), `${file} sha256`).toBe(expected.sha256);
      }
    }
  });

  it("IDLE is an OPEN-EYES face (acceptance §4): two eyes + smile + cheeks + gold star", () => {
    // Feature probes on the delivered MICRO master: dark ink in BOTH
    // halves of the eye band (two open eyes), ink below them (the
    // smile), warm cheeks on both sides and a gold star cluster.
    const img = decodePng(join(repo, "golden", "production-mascot", "micro", "safi-micro-idle.png"));
    const W = img.width, px = img.pixels;
    const at = (x: number, y: number) => {
      const i = (y * W + x) * 4;
      return [px[i], px[i + 1], px[i + 2], px[i + 3]];
    };
    const isInk = (x: number, y: number) => {
      const [r, g, b, a] = at(x, y);
      return a > 128 && r < 130 && g < 130 && b < 150;
    };
    const isWarm = (x: number, y: number) => {
      const [r, g, b, a] = at(x, y);
      return a > 64 && r > 175 && r > g + 15 && r > b + 5;
    };
    const band = (y0: number, y1: number, x0: number, x1: number, test: (x: number, y: number) => boolean) => {
      let n = 0;
      for (let y = Math.round(W * y0); y < Math.round(W * y1); y += 1)
        for (let x = Math.round(W * x0); x < Math.round(W * x1); x += 1) if (test(x, y)) n += 1;
      return n;
    };
    // 1) TWO OPEN EYES: the eye band carries dark ink on the left AND
    //    on the right of the vertical axis (two-line sad faces fail it).
    const leftEye = band(0.28, 0.50, 0.10, 0.48, isInk);
    const rightEye = band(0.28, 0.50, 0.52, 0.90, isInk);
    expect(leftEye, "left eye open in IDLE").toBeGreaterThan(8);
    expect(rightEye, "right eye open in IDLE").toBeGreaterThan(8);
    // 2) SMILE: dark ink in the band below the eyes, centered.
    expect(band(0.50, 0.64, 0.30, 0.70, isInk), "smile in IDLE").toBeGreaterThan(4);
    // 3) GOLD STAR: saturated warm pixels somewhere in the master.
    expect(band(0, 1, 0, 1, (x, y) => isWarm(x, y)), "gold star in IDLE").toBeGreaterThan(20);
    // 4) CHEEKS: warm pixels on BOTH sides of the face.
    expect(band(0.40, 0.60, 0.05, 0.30, isWarm), "left cheek").toBeGreaterThan(3);
    expect(band(0.40, 0.60, 0.70, 0.95, isWarm), "right cheek").toBeGreaterThan(3);
  });
});

describe("Optical mapping — 0–72 MICRO, 73–180 UI, >180 HERO", () => {
  const widget = readFileSync(join(repo, "apps", "desktop", "widget.html"), "utf8");

  it("the widget maps tiers by rendered size and audits itself", () => {
    expect(widget).toContain("function tierForSize(px)");
    expect(widget).toMatch(/px <= 72[\s\S]{0,80}"micro"/);
    expect(widget).toMatch(/px <= 180[\s\S]{0,80}"ui"/);
    expect(widget).toContain('return "hero"');
  });

  it("every declared host tier matches the optical band of its rendered size", () => {
    // Parse the CSS-declared size of every mascot host.
    const hosts = [...widget.matchAll(/<img([^>]*data-mascot[^>]*)>/g)].map((m) => m[1]);
    expect(hosts.length, "mascot hosts in the markup").toBeGreaterThanOrEqual(5);
    for (const attrs of hosts) {
      const tier = /data-mascot-tier="(\w+)"/.exec(attrs)?.[1];
      const w = Number(/width="(\d+)"/.exec(attrs)?.[1]);
      expect(tier, attrs).toBeTruthy();
      expect(w, attrs).toBeGreaterThan(0);
      const wanted = w <= 72 ? "micro" : w <= 180 ? "ui" : "hero";
      expect(tier, `${attrs.trim().slice(0, 90)}: ${w}px must use ${wanted}`).toBe(wanted);
    }
  });

  it("compact uses MICRO (never a downscaled HERO) and the panel uses UI-tier sizes", () => {
    expect(widget).toMatch(/#collapsed img\[data-mascot\] \{ width: 60px; height: 60px/);
    // 3:2 pass: the header mark is 30px, not 44px. The INPUT view must fit
    // 384×256 with NO internal scroll, and on the real surfaces a 44px
    // mark pushed "✓ verifica" 11px below the lower functional edge. The
    // optical BAND is untouched — 30 is still 0–72 MICRO, exactly as 44
    // was — so only the rendered size changed, never the tier contract.
    expect(widget).toMatch(/#safi-mascot-header \{ width: 30px; height: 30px/);
  });
});

describe("PROCEDURAL MASCOT IS GONE FROM THE RUNTIME", () => {
  const widget = readFileSync(join(repo, "apps", "desktop", "widget.html"), "utf8");
  const bridge = readFileSync(join(repo, "apps", "desktop", "bridge.js"), "utf8");
  const stage = readFileSync(join(repo, "tools", "stage-desktop-runtime.mjs"), "utf8");

  it("the widget never imports or renders the archived procedural module", () => {
    expect(widget).not.toMatch(/safi-mascot\.js/);
    expect(widget).not.toMatch(/safiMascotMarkup/);
    expect(widget).not.toMatch(/SAFI_MASCOT_(CSS|LAYOUT|STATES|COLORS)/);
    // No procedural face geometry identifiers and no inline figure.
    expect(widget).not.toMatch(/smilePath|browArc|\bFACE\b/);
    expect(widget).not.toMatch(/<svg[^>]*data-mascot/);
    expect(widget).not.toMatch(/<path|<ellipse|<circle/);
  });

  it("the bridge does not serve the procedural mascot and serves the 21 masters", () => {
    expect(bridge).not.toMatch(/ui\/safi-mascot\.js/);
    expect(bridge).toContain("/mascot/");
    expect(bridge).toContain("golden/production-mascot/");
    // Only the exact delivered names are reachable.
    expect(bridge).toMatch(/hero\|ui\|micro/);
  });

  it("the staged runtime ships the production masters, not the procedural module", () => {
    expect(stage).toContain('["golden/production-mascot", "golden/production-mascot"]');
    expect(stage).not.toMatch(/\["ui\/safi-mascot\.js"/);
  });

  it("the satin tint is a VALID background layer (regression: colour first = dropped)", () => {
    // In the `background` shorthand a <color> is only legal as the LAST
    // layer. Listing the tint before a gradient invalidates the whole
    // declaration, and the surface silently renders fully transparent.
    const style = /<style>([\s\S]*?)<\/style>/.exec(widget)?.[1] ?? "";
    for (const [selector, body] of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/background:\s*var\(--glass-tint\)|background:\s*rgba\(/.test(body)) continue;
      const layers = body.replace(/background:[^;]+;/, "").length;
      void layers;
      const shorthand = /background:([^;]+);/.exec(body)?.[1] ?? "";
      const colorFirst = /^\s*(var\(--glass-tint\)|rgba?\([^)]*\))\s*,/.test(shorthand);
      expect(colorFirst, `${selector.trim()}: tint must close the background stack`).toBe(false);
    }
  });

  it("the mascot is never blurred, filtered or faded (brief §11)", () => {
    // Parse the stylesheet rule by rule: any rule whose selector
    // targets the delivered asset may never blur it or fade it.
    const style = /<style>([\s\S]*?)<\/style>/.exec(widget)?.[1] ?? "";
    const rules = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const assetRules = rules.filter(([, selector]) => selector.includes("img[data-mascot]"));
    expect(assetRules.length, "asset rules found").toBeGreaterThan(0);
    for (const [, selector, body] of assetRules) {
      const filter = /filter:\s*([^;]+)/.exec(body)?.[1]?.trim();
      const opacity = /opacity:\s*([^;]+)/.exec(body)?.[1]?.trim();
      expect(filter ?? "none", `${selector.trim()} filter`).toBe("none");
      expect(opacity ?? "1", `${selector.trim()} opacity`).toBe("1");
    }
    // The glow lives on the HOST, not on the asset.
    expect(widget).toMatch(/#collapsed\[data-state="verified"\] \{ box-shadow/);
    // No ancestor of the asset carries a blur/opacity fade either.
    expect(widget).not.toMatch(/#collapsed[^{}]*\{[^}]*opacity:\s*0?\.[0-8]/);
  });
});

describe("Icon pipeline — production masters, zero procedural figure", () => {
  it("composites the delivered masters through the optical mapping", () => {
    const src = readFileSync(join(repo, "tools", "gen-icon.mjs"), "utf8");
    expect(src).not.toMatch(/renderMascotHead|safiMascotMarkup|SAFI_MASCOT_LAYOUT/);
    expect(src).toContain("golden/production-mascot/hero/safi-hero-idle.png");
    expect(src).toContain("golden/production-mascot/ui/safi-ui-idle.png");
    expect(src).toContain("golden/production-mascot/micro/safi-micro-idle.png");
    expect(src).toMatch(/size <= 72[\s\S]{0,60}micro/);
  });

  it("the generated Dock icon really contains the mascot (ink + warm accents)", () => {
    for (const size of [32, 128, 512]) {
      const img = decodePng(join(repo, "apps", "desktop", "src-tauri", "icons", `icon-${size}.png`));
      let ink = 0, warm = 0;
      for (let i = 0; i < img.width * img.height; i += 1) {
        const [r, g, b, a] = [img.pixels[i * 4], img.pixels[i * 4 + 1], img.pixels[i * 4 + 2], img.pixels[i * 4 + 3]];
        if (a < 200) continue;
        if (r < 120 && g < 120 && b < 140) ink += 1;
        if (r > 170 && r > b + 50) warm += 1;
      }
      expect(ink, `icon-${size}: mascot ink (eyes/mouth)`).toBeGreaterThan(0);
      expect(warm, `icon-${size}: mascot star/cheeks`).toBeGreaterThan(0);
    }
  });
});
describe("Brand: Pico is gone, Safi is the only mascot", () => {
  it("no Pico references in UI, app, docs or assets sources", () => {
    const offenders: string[] = [];
    const scan = ["ui", "apps/desktop", "packages", "docs", "assets", "handoff"];
    for (const dir of scan) {
      const { readdirSync, statSync } = require("node:fs");
      const walk = (p: string) => {
        let entries: string[] = [];
        try { entries = readdirSync(join(repo, p)); } catch { return; }
        for (const e of entries) {
          if (["node_modules", "target", "resources", "dist"].includes(e)) continue;
          const full = join(repo, p, e);
          if (statSync(full).isDirectory()) { walk(join(p, e)); continue; }
          if (!/\.(md|ts|js|mjs|html|css|svg|json)$/.test(e)) continue;
          const text = readFileSync(full, "utf8");
          if (/\bpico\b/i.test(text)) offenders.push(full);
        }
      };
      walk(dir);
    }
    // picocolors (a transitive dep name) is not a mascot reference; the
    // check above never matches it because it scans our sources only.
    expect(offenders, `Pico references remain: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("APP ICON ground — the delivered master rides the perla tile", () => {
  it("keeps the macOS squircle ground: opaque perla, transparent outside", () => {
    const img = decodePng(join(repo, "apps", "desktop", "src-tauri", "icons", "icon-128.png"));
    expect([img.width, img.height]).toEqual([128, 128]);
    const px = (x: number, y: number) => {
      const i = (y * img.width + x) * 4;
      return [img.pixels[i], img.pixels[i + 1], img.pixels[i + 2], img.pixels[i + 3]];
    };
    // Ground sample: the tile is a rounded squircle (inset ~5.8), so
    // (64, 8) is safely inside the perla gradient above the figure.
    const ground = px(64, 8);
    expect(ground[3]).toBe(255);
    expect(ground[0]).toBeGreaterThan(200);
    expect(ground[1]).toBeGreaterThan(210);
    // Outside the squircle stays transparent (no white box).
    expect(px(1, 1)[3]).toBeLessThan(40);
  });
});
