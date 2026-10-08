// @vitest-environment node
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  VISUAL_STYLE_REQUIREMENTS,
  assembleVisualReport,
  contrastRatio,
  evaluateVisualState,
  formatVisualReportConsole,
  normalizeStyleSnapshot,
  renderVisualReportHtml,
} from "../tools/visual-report-core.mjs";
import {
  VISUAL_BASELINE_ALLOWLIST,
  VISUAL_BASELINE_APPROVAL_STATUS,
  comparePngFiles,
  loadVisualBaseline,
  promoteVisualBaseline,
  sha256File,
} from "../tools/visual-baseline.mjs";

const ROOT = resolve(".");

const mascotSharp = {
  filter: "none",
  opacity: "1",
  mixBlendMode: "normal",
  ancestors: [
    { filter: "none", opacity: "1", backdropFilter: "none" },
  ],
};

function style(overrides: Record<string, string> = {}) {
  return {
    color: "rgb(15, 23, 42)",
    "background-color": "rgb(255, 255, 255)",
    "border-color": "rgb(203, 213, 225)",
    "outline-color": "rgb(37, 99, 235)",
    "box-shadow": "none",
    opacity: "1",
    "font-size": "14px",
    "font-weight": "500",
    ...overrides,
  };
}

const askStyles = Object.fromEntries(
  [
    "askAction",
    "askTab",
    "promptTitle",
    "promptSubtitle",
    "promptSignal",
    "signalSpark",
    "promptCard",
    "promptPrimary",
    "promptText",
    "field",
    "trustLine",
    "stateChip",
    "compact",
  ].map((selector) => [selector, style()]),
);
askStyles.signalSpark = style({ color: "rgb(37, 99, 235)" });
askStyles.promptTitle = style({ color: "rgb(30, 58, 138)" });
askStyles.promptPrimary = style({
  color: "rgb(255, 255, 255)",
  "background-color": "rgb(37, 99, 235)",
  "font-weight": "700",
});

const passingGolden = {
  status: "PASS",
  reference: "golden/safi-ui-board.png",
  diffImage: "diffs/macos/verified.png",
  metrics: { shapeDelta: 1, toneDelta: 0, alignDelta: 0 },
};

const awaitingGolden = {
  status: "AWAITING HUMAN GOLDEN APPROVAL",
  reference: null,
  diffImage: null,
  metrics: null,
};

function checkById(result: { checks: Array<{ id: string; status: string }> }, id: string) {
  return result.checks.find((entry) => entry.id === id);
}

describe("automated visual state report", () => {
  it("normalizes all required computed-style properties", () => {
    const normalized = normalizeStyleSnapshot({
      color: "rgb(1, 2, 3)",
      backgroundColor: "rgb(4, 5, 6)",
      borderColor: "rgb(7, 8, 9)",
      outlineColor: "rgb(10, 11, 12)",
      boxShadow: "none",
      opacity: "0.99",
      fontSize: "15px",
      fontWeight: "600",
    });

    expect(Object.keys(normalized)).toEqual(VISUAL_STYLE_REQUIREMENTS);
    expect(normalized["background-color"]).toBe("rgb(4, 5, 6)");
    expect(normalized["font-weight"]).toBe("600");
  });

  it("computes WCAG contrast for composited computed colors", () => {
    expect(contrastRatio("rgb(255, 255, 255)", "rgb(37, 99, 235)")).toBeGreaterThan(4.5);
    expect(contrastRatio("rgb(15, 23, 42)", "rgba(255, 255, 255, 0.78)")).toBeGreaterThan(10);
    expect(contrastRatio("not-a-color", "rgb(255, 255, 255)")).toBeNull();
  });

  it("passes a real Ask/PROMPT_READY surface with blue accents and no green", () => {
    const result = evaluateVisualState({
      platform: "macos",
      id: "ask",
      styles: askStyles,
      screenshot: "macos/ask.png",
      screenshotExists: true,
      source: "installed release bundle WebView",
      mascotSharp,
      golden: awaitingGolden,
    });

    expect(result.result).toBe("PASS");
    expect(checkById(result, "computed-styles")?.status).toBe("PASS");
    expect(checkById(result, "no-nonsemantic-green")?.status).toBe("PASS");
    expect(checkById(result, "brand-blue")?.status).toBe("PASS");
    expect(checkById(result, "functional-contrast")?.status).toBe("PASS");
    expect(checkById(result, "functional-opacity")?.status).toBe("PASS");
    expect(checkById(result, "mascot-sharp")?.status).toBe("PASS");
    expect(checkById(result, "golden-diff")?.status).toBe("N/A");
  });

  it.each([
    ["VERIFIED", "rgb(15, 107, 63)", "rgba(134, 247, 193, 0.62)"],
    ["UNCERTAIN", "rgb(122, 77, 0)", "rgba(255, 224, 138, 0.7)"],
    ["FAILED", "rgb(151, 40, 31)", "rgba(255, 139, 139, 0.62)"],
  ])("enforces the %s semantic color family", (trust, color, background) => {
    const id = trust.toLowerCase();
    const styles = {
      trustLine: style({ color, "background-color": "rgba(0, 0, 0, 0)" }),
      stateChip: style({ color, "background-color": background, "font-weight": "700" }),
      compact: style({ color, "background-color": background }),
    };
    const result = evaluateVisualState({
      platform: "macos",
      id,
      styles,
      screenshot: `macos/${id}.png`,
      screenshotExists: true,
      source: "installed release bundle WebView",
      mascotSharp,
      golden: passingGolden,
    });

    expect(result.result).toBe("PASS");
    if (id === "verified") expect(checkById(result, "verified-green")?.status).toBe("PASS");
    if (id === "uncertain") expect(checkById(result, "uncertain-amber")?.status).toBe("PASS");
    if (id === "failed") expect(checkById(result, "failed-red")?.status).toBe("PASS");
  });

  it("fails incomplete styles and an available golden diff", () => {
    const result = evaluateVisualState({
      platform: "android",
      id: "verified",
      styles: { stampGlyph: style({ color: "rgb(46, 125, 50)" }) },
      screenshot: "android/verified.png",
      screenshotExists: false,
      source: "mock verified surface",
      golden: { status: "FAIL", reference: "golden/verified.png", metrics: { shapeDelta: 99 } },
    });

    expect(result.result).toBe("FAIL");
    expect(checkById(result, "real-screenshot")?.status).toBe("FAIL");
    expect(checkById(result, "computed-styles")?.status).toBe("PASS");
    expect(checkById(result, "verified-green")?.status).toBe("PASS");
    expect(checkById(result, "golden-diff")?.status).toBe("FAIL");
  });

  it("marks missing human goldens without failing or promoting CURRENT", () => {
    const report = assembleVisualReport({
      startedAt: "2026-09-25T00:00:00.000Z",
      states: [
        evaluateVisualState({
          platform: "android",
          id: "ask",
          styles: {
            send: style({
              color: "rgb(255, 255, 255)",
              "background-color": "rgb(37, 99, 235)",
            }),
            answer: style(),
            microstate: style(),
          },
          screenshot: "android/ask.png",
          screenshotExists: true,
          source: "real installed Android WebView",
          golden: awaitingGolden,
        }),
      ],
    });

    expect(report.result).toBe("FAIL");
    expect(report.missingRequiredStates).toEqual(["verified", "failed"]);
    expect(report.approvalStatus).toBe("AWAITING HUMAN GOLDEN APPROVAL");
    expect(report.goldenPolicy).toContain("never promoted automatically");
  });

  it("renders escaped, self-contained HTML and the expected console order", () => {
    const state = evaluateVisualState({
      platform: "macos",
      id: "ask",
      styles: askStyles,
      screenshot: "macos/ask.png",
      screenshotExists: true,
      source: "real <script>alert(1)</script> surface",
      mascotSharp,
      golden: awaitingGolden,
    });
    const report = assembleVisualReport({
      startedAt: "2026-09-25T00:00:00.000Z",
      states: [state],
    });
    const html = renderVisualReportHtml(report);
    const consoleOutput = formatVisualReportConsole(report);

    expect(html).toContain("SAFI Visual State Report");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("background-color");
    expect(consoleOutput).toContain("SAFI VISUAL REPORT");
    expect(consoleOutput).toContain("macOS Ask");
    expect(consoleOutput).toContain("RESULT: FAIL");
  });

  it("keeps visual:report opt-in and out of the standard test command", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    expect(packageJson.scripts["visual:report"]).toBe("node tools/visual-report.mjs");
    expect(packageJson.scripts["visual:promote"]).toBe("node tools/promote-visual-baseline.mjs");
    expect(packageJson.scripts.test).not.toContain("visual:report");
    expect(packageJson.scripts.test).not.toContain("visual:promote");
    expect(packageJson.scripts["test:android:device"]).not.toContain("visual:report");
  });

  it("exposes exactly four allowlisted visual approvals", () => {
    expect(VISUAL_BASELINE_ALLOWLIST.map((entry) => entry.key)).toEqual([
      "macos/ask",
      "android/ask",
      "android/verified",
      "android/failed",
    ]);
    expect(VISUAL_BASELINE_ALLOWLIST).toHaveLength(4);
    expect(VISUAL_BASELINE_ALLOWLIST.some((entry) => entry.key === "macos/verified")).toBe(false);
    expect(VISUAL_BASELINE_ALLOWLIST.some((entry) => entry.key === "android/uncertain")).toBe(false);
  });

  it("validates the approved manifest, provenance, dimensions, and checksums", () => {
    const baseline = loadVisualBaseline(ROOT);
    expect(baseline.errors).toEqual([]);
    expect(baseline.status).toBe(VISUAL_BASELINE_APPROVAL_STATUS);
    expect(baseline.manifest?.autoPromotion).toBe(false);
    expect(baseline.manifest?.allowlist).toEqual(VISUAL_BASELINE_ALLOWLIST.map((entry) => entry.key));
    expect(baseline.manifest?.sourceReport?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(baseline.manifest?.approvedAt).toBeTruthy();
    expect(baseline.entries.size).toBe(4);

    for (const entry of baseline.entries.values()) {
      const goldenPath = resolve(ROOT, entry.golden);
      expect(existsSync(goldenPath), `${entry.key} golden`).toBe(true);
      expect(statSync(goldenPath).size).toBe(entry.bytes);
      expect(sha256File(goldenPath)).toBe(entry.sha256);
      expect(entry.provenance.sourceReportSha256).toBe(baseline.manifest.sourceReport.sha256);
      expect(entry.provenance.sourceRunId).toBe(baseline.manifest.sourceReport.runId);
      expect(entry.width).toBeGreaterThan(0);
      expect(entry.height).toBeGreaterThan(0);
    }
  });

  it("does not promote an unallowlisted state and requires explicit confirmation", () => {
    const baseline = loadVisualBaseline(ROOT);
    expect(baseline.entries.has("android/uncertain")).toBe(false);
    expect(() => promoteVisualBaseline({ root: ROOT, confirmed: false })).toThrow(
      "explicit confirmation",
    );

    const pending = evaluateVisualState({
      platform: "android",
      id: "ask",
      styles: { send: style(), answer: style(), microstate: style() },
      screenshot: "android/ask.png",
      screenshotExists: true,
      source: "real installed Android WebView",
      golden: awaitingGolden,
    });
    const report = assembleVisualReport({
      startedAt: "2026-09-25T00:00:00.000Z",
      states: [pending],
      baseline: { status: VISUAL_BASELINE_APPROVAL_STATUS, errors: [] },
    });
    expect(report.approvalStatus).toBe("AWAITING HUMAN GOLDEN APPROVAL");
  });

  it("compares an approved baseline exactly without promoting CURRENT", () => {
    const baseline = loadVisualBaseline(ROOT);
    const entry = baseline.entries.get("android/verified");
    expect(entry).toBeDefined();
    const comparison = comparePngFiles(
      resolve(ROOT, "artifacts/visual-report/android/verified.png"),
      entry.goldenPath,
    );
    expect(comparison.pass).toBe(true);
    expect(comparison.metrics?.pixelExact).toBe(true);
    expect(comparison.metrics?.differingPixels).toBe(0);

    const reportSource = readFileSync("tools/visual-report.mjs", "utf8");
    expect(reportSource).toContain("loadVisualBaseline");
    expect(reportSource).not.toContain("promoteVisualBaseline(");
    expect(reportSource).not.toContain("copyFileSync(source, destination)");
  });
});
