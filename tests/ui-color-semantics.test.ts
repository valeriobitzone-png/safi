// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  analyzeUiColorSource,
  collectAuthoredUiFiles,
  formatUiColorJsonReport,
  formatUiColorReport,
  isExcludedUiPath,
  lintUiColors,
  parseUiColorCliArgs,
} from "../tools/lint-ui-colors.mjs";

function analyze(source: string, filePath = "tests/fixtures/ui-colors.html") {
  return analyzeUiColorSource(source, filePath);
}

describe("UI color semantics lint", () => {
  it("rejects a generic green CTA", () => {
    const violations = analyze(`
      <style>
        .cta { background: #22c55e; color: white; }
      </style>
      <button class="cta">Continue</button>
    `);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      line: 3,
      context: ".cta",
      raw: "#22c55e",
    });
  });

  it("rejects a generic green focus treatment", () => {
    const violations = analyze(`
      <style>
        .cta:focus-visible { outline: 3px solid rgb(34 197 94); }
      </style>
    `);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      context: ".cta:focus-visible",
      raw: "rgb(34 197 94)",
    });
  });

  it("allows a green VERIFIED badge", () => {
    const violations = analyze(`
      <style>
        .trust-badge[data-trust="VERIFIED"] {
          color: #22c55e;
          border-color: hsl(142 70% 35%);
        }
      </style>
    `);

    expect(violations).toEqual([]);
  });

  it("allows a green box-shadow only in a VERIFIED state", () => {
    const violations = analyze(`
      <style>
        .trust-glow[data-state="verified"] {
          box-shadow: 0 0 14px rgb(34 197 94 / 0.55);
        }
      </style>
    `);

    expect(violations).toEqual([]);
  });

  it("allows semantic amber for UNCERTAIN", () => {
    const violations = analyze(`
      <style>
        .trust-badge[data-trust="UNCERTAIN"] { color: #b45309; }
      </style>
    `);

    expect(violations).toEqual([]);
  });

  it("allows semantic red for FAILED", () => {
    const violations = analyze(`
      <style>
        .trust-badge[data-trust="FAILED"] { color: #c62828; }
      </style>
    `);

    expect(violations).toEqual([]);
  });

  it("allows a blue CTA", () => {
    const violations = analyze(`
      <style>
        .cta { background: #2563eb; }
        .cta:focus-visible { outline: 2px solid #60a5fa; }
      </style>
    `);

    expect(violations).toEqual([]);
  });

  it("rejects green in headings, labels, sparkles, and ready-prompt surfaces", () => {
    const violations = analyze(`
      <style>
        h1 { color: #22c55e; }
        .label { background: rgb(34 197 94); }
        .sparkle { color: hsl(140 70% 35%); }
        .prompt-title { color: #2e7d32; }
      </style>
    `);

    expect(violations.map((violation) => violation.context)).toEqual([
      "h1",
      ".label",
      ".sparkle",
      ".prompt-title",
    ]);
  });

  it("does not treat generic success or inverse semantics as VERIFIED", () => {
    const violations = analyze(`
      <style>
        [data-status="PASS"] .badge { color: #22c55e; }
        .unverified-glow { box-shadow: 0 0 8px #2e7d32; }
      </style>
    `);

    expect(violations).toHaveLength(2);
    expect(violations.map((violation) => violation.context)).toEqual([
      '[data-status="PASS"] .badge',
      ".unverified-glow",
    ]);
  });

  it("rejects a verified token when a generic CTA consumes it", () => {
    const violations = analyze(`
      <style>
        :root { --safi-trust-verified: #2e7d32; }
        .cta { color: var(--safi-trust-verified); }
      </style>
    `);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      context: ".cta",
      raw: "var(--safi-trust-verified)",
      via: "CSS variable",
    });
  });

  it("rejects a generic JavaScript alias of a verified color token", () => {
    const violations = analyze(`
      const VERIFIED_COLOR = "#2e7d32";
      const CTA_COLOR = VERIFIED_COLOR;
    `, "ui/example.js");

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      context: "JS CTA_COLOR",
      via: "JavaScript value alias",
    });
  });

  it("analyzes CSS assigned through JavaScript style.textContent", () => {
    const violations = analyze(`
      const runtimeStyle = document.createElement("style");
      runtimeStyle.style.textContent = ".prompt-title { color: #22c55e; }";
    `, "ui/example.js");

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      context: ".prompt-title",
      raw: "#22c55e",
    });
  });

  it("traces green through CSS variables, inline styles, JavaScript, and SVG", () => {
    const violations = analyze(`
      <style>
        :root {
          --brand-success: hsl(140 70% 35%);
          --safi-trust-verified: #2e7d32;
        }
        .prompt-title { color: var(--brand-success); }
      </style>
      <button class="retry" style="background: rgba(34, 197, 94, 0.5)">Retry</button>
      <script>
        const runtimeAccent = "rgb(34 197 94)";
        retry.style.backgroundColor = runtimeAccent;
        retry.style.setProperty("--focus-ring", "hsl(145 60% 40%)");
      </script>
      <svg><path class="decorative-sparkle" fill="#22c55e" /></svg>
    `);

    expect(violations.map((violation) => violation.context)).toEqual(
      expect.arrayContaining([
        "CSS custom property --brand-success",
        ".prompt-title",
        "button.retry",
        "JS runtimeAccent",
        "JS .style.backgroundColor on retry",
        "JS .style.--focus-ring on retry",
        "path.decorative-sparkle",
      ]),
    );
    expect(violations.some((violation) => violation.raw.includes("hsl("))).toBe(true);
    expect(violations.some((violation) => violation.raw.includes("rgba("))).toBe(true);
    expect(violations.some((violation) => violation.raw.includes("rgb("))).toBe(true);
    expect(violations.some((violation) => violation.raw.startsWith("#"))).toBe(true);
  });

  it("allows verified projection and stamp style provenance", () => {
    const projection = analyze(`
      export const TRUST_COLORS = { VERIFIED: "#2e7d32" };
    `, "ui/projection.js");
    const stamp = analyze(`
      verifiedBadge.style.color = "#22c55e";
      stampElement.style.setProperty("--verified-glow", "rgba(34, 197, 94, 0.4)");
    `, "ui/safi-stamp.js");

    expect(projection).toEqual([]);
    expect(stamp).toEqual([]);
  });

  it("prints a readable, non-mutating failure report", () => {
    const report = formatUiColorReport({
      filesScanned: 1,
      violations: [
        {
          filePath: "packages/mobile-consumer/index.html",
          line: 142,
          context: ".prompt-title",
          raw: "#22c55e",
          via: "literal",
        },
      ],
    });

    expect(report).toBe(
      [
        "SAFI UI COLOR SEMANTICS — FAIL",
        "",
        "packages/mobile-consumer/index.html:142",
        ".prompt-title",
        "#22c55e",
        "",
        "Non-semantic green detected.",
        "Use Safi blue/neutral token.",
        "Green is reserved for VERIFIED.",
      ].join("\n"),
    );
  });

  it("emits a stable machine-readable report with --json semantics", () => {
    expect(parseUiColorCliArgs(["--json"])).toEqual({ json: true, root: undefined });
    expect(() => parseUiColorCliArgs(["--fix"])).toThrow("Unknown option: --fix");

    const report = JSON.parse(
      formatUiColorJsonReport({
        filesScanned: 1,
        violations: [
          {
            filePath: "apps/desktop/widget.html",
            line: 214,
            context: ".prompt-title",
            raw: "#34D399",
            via: "CSS variable",
          },
        ],
      }),
    );

    expect(report).toEqual({
      schema: "safi-ui-color-semantics/v1",
      result: "fail",
      filesScanned: 1,
      violations: [
        {
          file: "apps/desktop/widget.html",
          line: 214,
          context: ".prompt-title",
          colorOrToken: "#34D399",
          detectedVia: "CSS variable",
          reason: "Non-semantic green detected.",
          expectedSemanticFamily: "Safi blue/neutral token",
          greenReservedFor: "VERIFIED",
        },
      ],
    });
  });

  it("emits a passing machine-readable report for the authored checkout", () => {
    const report = JSON.parse(formatUiColorJsonReport(lintUiColors()));

    expect(report.schema).toBe("safi-ui-color-semantics/v1");
    expect(report.result).toBe("pass");
    expect(report.filesScanned).toBeGreaterThan(0);
    expect(report.violations).toEqual([]);
  });

  it("defines a dedicated device-free UI color CI job", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/ui-color-semantics.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toContain("push:");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).toContain("node-version: 20");
    expect(workflow).toContain("run: npm ci");
    expect(workflow).toContain("run: npm run lint:ui-colors");
    expect(workflow.indexOf("run: npm ci")).toBeLessThan(
      workflow.indexOf("run: npm run lint:ui-colors"),
    );
    expect(workflow).not.toMatch(/macos|android|emulator|continue-on-error|autofix/i);
  });

  it("excludes generated, staged, release, artifact, golden, and image trees", () => {
    expect(isExcludedUiPath("ui/authored.svg")).toBe(false);
    for (const path of [
      "apps/desktop/src-tauri/target/debug/resources/safi/apps/desktop/widget.html",
      "apps/desktop/src-tauri/resources/safi/apps/desktop/widget.html",
      "apps/android/app/src/main/assets/index.html",
      "apps/ios/Safi/WebResources/index.html",
      "ui/generated/widget.css",
      "ui/release/widget.css",
      "artifacts/widget.html",
      "golden/widget.html",
      "ui/widget.generated.css",
      "ui/widget.png",
    ]) {
      expect(isExcludedUiPath(path), path).toBe(true);
    }
  });

  it("keeps the current authored UI sources clean", () => {
    const result = lintUiColors();
    const files = collectAuthoredUiFiles(process.cwd());

    expect(result.violations).toEqual([]);
    expect(result.filesScanned).toBeGreaterThan(0);
    expect(files.some((file) => file.includes("/target/"))).toBe(false);
    expect(files.some((file) => file.includes("src-tauri/resources/safi/"))).toBe(false);
  });
});
