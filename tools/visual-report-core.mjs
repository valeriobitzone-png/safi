const REQUIRED_STYLE_KEYS = [
  "color",
  "background-color",
  "border-color",
  "outline-color",
  "box-shadow",
  "opacity",
  "font-size",
  "font-weight",
];

const STYLE_KEYS = Object.freeze({
  color: "color",
  backgroundColor: "background-color",
  borderColor: "border-color",
  outlineColor: "outline-color",
  boxShadow: "box-shadow",
  opacity: "opacity",
  fontSize: "font-size",
  fontWeight: "font-weight",
});

const COLOR_PROPERTIES = [
  "color",
  "background-color",
  "border-color",
  "outline-color",
  "box-shadow",
];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function asStyleString(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function normalizeStyleSnapshot(snapshot) {
  const result = {};
  for (const [inputKey, outputKey] of Object.entries(STYLE_KEYS)) {
    result[outputKey] = asStyleString(snapshot?.[inputKey] ?? snapshot?.[outputKey]);
  }
  return result;
}

export function normalizeComputedStyles(styles) {
  return Object.fromEntries(
    Object.entries(styles ?? {})
      .filter(([, value]) => value && typeof value === "object")
      .map(([name, value]) => [name, normalizeStyleSnapshot(value)]),
  );
}

function parseHexColor(value) {
  const match = /^#([0-9a-f]{3,8})$/i.exec(String(value).trim());
  if (!match) return null;
  let digits = match[1];
  if (digits.length === 3 || digits.length === 4) {
    digits = [...digits].map((digit) => digit + digit).join("");
  }
  if (digits.length !== 6 && digits.length !== 8) return null;
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
    digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1,
  ];
}

function parseRgbColor(value) {
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
    String(value).trim(),
  );
  if (!match) return null;
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] === undefined ? 1 : Number(match[4]),
  ];
}

export function parseVisualColor(value) {
  return parseHexColor(value) ?? parseRgbColor(value);
}

function composite(foreground, background) {
  const alpha = foreground[3];
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
    1,
  ];
}

function relativeLuminance(color) {
  const linear = color.slice(0, 3).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(foregroundValue, backgroundValue) {
  const rawForeground = parseVisualColor(foregroundValue);
  const rawBackground = parseVisualColor(backgroundValue);
  if (!rawForeground || !rawBackground) return null;
  const background =
    rawBackground[3] < 1
      ? composite(rawBackground, [255, 255, 255, 1])
      : rawBackground;
  const foreground =
    rawForeground[3] < 1
      ? composite(rawForeground, background)
      : rawForeground;
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

function colorFamily(color) {
  const [red, green, blue, alpha] = color;
  if (alpha <= 0) return null;
  if (green > red + 12 && green > blue + 12) return "green";
  if (red > green + 45 && red > blue + 45) return "red";
  if (red > blue + 30 && green > blue + 30) return "amber";
  if (blue > red + 30 && blue > green + 20) return "blue";
  return "neutral";
}

export function colorsInValue(value) {
  const colors = [];
  for (const token of String(value ?? "").matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)) {
    const parsed = parseVisualColor(token[0]);
    if (parsed) colors.push({ raw: token[0], color: parsed, family: colorFamily(parsed) });
  }
  return colors;
}

function styleHasFamily(snapshot, family) {
  return COLOR_PROPERTIES.some((property) =>
    colorsInValue(snapshot?.[property] ?? "").some((entry) => entry.family === family),
  );
}

function stylesHaveFamily(styles, selectors, family) {
  return selectors.some((selector) => styleHasFamily(styles?.[selector], family));
}

function hasCompleteStyle(snapshot) {
  return REQUIRED_STYLE_KEYS.every((key) => typeof snapshot?.[key] === "string");
}

function check(id, label, passed, details, { optional = false } = {}) {
  return {
    id,
    label,
    status: passed ? "PASS" : optional ? "N/A" : "FAIL",
    details,
  };
}

function contrastCheck(styles, selectors) {
  const evidence = [];
  for (const selector of selectors) {
    const snapshot = styles?.[selector];
    if (!snapshot) {
      evidence.push({ selector, ratio: null, error: "computed style missing" });
      continue;
    }
    const ratio = contrastRatio(snapshot.color, snapshot["background-color"]);
    evidence.push({
      selector,
      ratio: ratio === null ? null : Number(ratio.toFixed(2)),
      threshold: 4.5,
    });
  }
  const passed = evidence.length > 0 && evidence.every((entry) => (entry.ratio ?? 0) >= 4.5);
  return { passed, evidence };
}

function opacityCheck(styles, selectors) {
  const evidence = selectors.map((selector) => ({
    selector,
    opacity: Number(styles?.[selector]?.opacity),
  }));
  const passed = evidence.every((entry) => Number.isFinite(entry.opacity) && entry.opacity >= 0.95);
  return { passed, evidence };
}

function mascotCheck(mascotSharp) {
  if (!mascotSharp) {
    return {
      passed: true,
      evidence: { applicable: false, reason: "no production mascot on this surface" },
    };
  }
  const ancestors = mascotSharp.ancestors ?? [];
  const passed =
    mascotSharp.filter === "none" &&
    Number(mascotSharp.opacity) === 1 &&
    ancestors.every(
      (entry) =>
        entry.filter === "none" &&
        Number(entry.opacity) === 1 &&
        (entry.backdropFilter ?? "none") === "none",
    );
  return { passed, evidence: mascotSharp };
}

const SELECTORS = {
  ask: {
    macos: ["askAction", "askTab", "promptTitle", "promptSubtitle", "promptSignal", "signalSpark", "promptCard", "promptPrimary", "promptText", "field", "trustLine", "stateChip", "compact"],
    android: ["send", "answer", "microstate"],
  },
  compact: {
    macos: ["compact", "askAction", "askTab"],
    android: [],
  },
  expanded: {
    macos: ["trustLine", "field", "microstate", "askAction", "askTab"],
    android: [],
  },
  verified: {
    macos: ["trustLine", "stateChip", "compact"],
    android: ["stampGlyph"],
  },
  uncertain: {
    macos: ["trustLine", "stateChip", "compact"],
    android: ["stampGlyph"],
  },
  failed: {
    macos: ["trustLine", "stateChip", "compact"],
    android: ["stampGlyph"],
  },
};

const FUNCTIONAL_TEXT = {
  ask: {
    macos: ["promptTitle", "promptText", "promptPrimary", "field"],
    android: ["send", "answer"],
  },
  compact: { macos: [], android: [] },
  expanded: { macos: ["trustLine", "field", "microstate"], android: [] },
  verified: { macos: ["trustLine", "stateChip"], android: ["stampGlyph"] },
  uncertain: { macos: ["trustLine", "stateChip"], android: ["stampGlyph"] },
  failed: { macos: ["trustLine", "stateChip"], android: ["stampGlyph"] },
};

export function evaluateVisualState({
  platform,
  id,
  styles,
  screenshot,
  screenshotExists,
  source,
  mascotSharp = null,
  golden = { status: "AWAITING HUMAN GOLDEN APPROVAL", reference: null, metrics: null },
  runtimeErrors = [],
}) {
  const normalizedStyles = normalizeComputedStyles(styles);
  const selectors = SELECTORS[id]?.[platform] ?? [];
  const missingStyles = selectors.filter((selector) => !hasCompleteStyle(normalizedStyles[selector]));
  const checks = [];

  checks.push(
    check(
      "real-screenshot",
      "Real screenshot captured",
      Boolean(screenshotExists && source && !/mock/i.test(source)),
      { screenshot, source },
    ),
  );
  checks.push(
    check(
      "computed-styles",
      "Required computed styles captured",
      missingStyles.length === 0,
      { required: REQUIRED_STYLE_KEYS, missingStyles },
    ),
  );
  checks.push(
    check(
      "runtime-errors",
      "No JavaScript runtime errors",
      runtimeErrors.length === 0,
      { runtimeErrors },
    ),
  );

  if (id === "ask") {
    const green = stylesHaveFamily(normalizedStyles, selectors, "green");
    checks.push(
      check("no-nonsemantic-green", "No non-semantic green", !green, {
        selectors,
      }),
    );
    checks.push(
      check(
        "brand-blue",
        "Brand/accent is blue",
        stylesHaveFamily(normalizedStyles, selectors, "blue"),
        { selectors },
      ),
    );
  }

  if (id === "verified") {
    checks.push(
      check(
        "verified-green",
        "VERIFIED uses semantic green",
        stylesHaveFamily(normalizedStyles, selectors, "green"),
        { selectors },
      ),
    );
  }
  if (id === "uncertain") {
    checks.push(
      check(
        "uncertain-amber",
        "UNCERTAIN uses semantic amber",
        stylesHaveFamily(normalizedStyles, selectors, "amber"),
        { selectors },
      ),
    );
    checks.push(
      check(
        "no-green-glow",
        "UNCERTAIN has no green glow",
        !stylesHaveFamily(normalizedStyles, selectors, "green"),
        { selectors },
      ),
    );
  }
  if (id === "failed") {
    checks.push(
      check(
        "failed-red",
        "FAILED uses semantic red",
        stylesHaveFamily(normalizedStyles, selectors, "red"),
        { selectors },
      ),
    );
    checks.push(
      check(
        "no-green-glow",
        "FAILED has no green glow",
        !stylesHaveFamily(normalizedStyles, selectors, "green"),
        { selectors },
      ),
    );
  }

  if (id === "compact" || id === "expanded") {
    checks.push(
      check(
        "brand-blue",
        "Brand/accent is blue",
        stylesHaveFamily(normalizedStyles, selectors, "blue"),
        { selectors },
      ),
    );
  }

  const functionalSelectors = FUNCTIONAL_TEXT[id]?.[platform] ?? [];
  if (functionalSelectors.length > 0) {
    const contrast = contrastCheck(normalizedStyles, functionalSelectors);
    checks.push(
      check("functional-contrast", "Functional text contrast ≥ 4.5:1", contrast.passed, contrast.evidence),
    );
    const opacity = opacityCheck(normalizedStyles, functionalSelectors);
    checks.push(check("functional-opacity", "Functional text is opaque", opacity.passed, opacity.evidence));
  }

  if (platform === "macos") {
    const mascot = mascotCheck(mascotSharp);
    checks.push(check("mascot-sharp", "Production mascot is sharp", mascot.passed, mascot.evidence));
  }

  if (golden.status === "FAIL") {
    checks.push(check("golden-diff", "Golden/reference diff", false, golden));
  } else {
    checks.push(
      check(
        "golden-diff",
        "Golden/reference diff",
        golden.status === "PASS",
        golden,
        { optional: golden.status === "AWAITING HUMAN GOLDEN APPROVAL" },
      ),
    );
  }

  const result = checks.every((entry) => entry.status !== "FAIL") ? "PASS" : "FAIL";
  return {
    platform,
    id,
    source,
    screenshot,
    screenshotExists: Boolean(screenshotExists),
    styles: normalizedStyles,
    mascotSharp,
    golden,
    checks,
    result,
  };
}

export function assembleVisualReport({
  startedAt,
  finishedAt = new Date().toISOString(),
  states,
  environment = {},
  baseline = null,
}) {
  const macosRequired = ["ask", "compact", "expanded", "verified", "uncertain", "failed"];
  const androidRequired = ["ask", "verified", "failed"];
  const macosSeen = new Set(states.filter((entry) => entry.platform === "macos").map((entry) => entry.id));
  const androidSeen = new Set(states.filter((entry) => entry.platform === "android").map((entry) => entry.id));
  const missing = [
    ...(macosSeen.size > 0 ? macosRequired.filter((id) => !macosSeen.has(id)) : []),
    ...(androidSeen.size > 0 ? androidRequired.filter((id) => !androidSeen.has(id)) : []),
  ];
  const awaitingGolden = states.some(
    (entry) => entry.golden?.status === "AWAITING HUMAN GOLDEN APPROVAL",
  );
  const result = states.length > 0 &&
    states.every((entry) => entry.result === "PASS") &&
    missing.length === 0 &&
    baseline?.status !== "INVALID"
    ? "PASS"
    : "FAIL";
  let approvalStatus;
  if (awaitingGolden) {
    approvalStatus = "AWAITING HUMAN GOLDEN APPROVAL";
  } else if (baseline) {
    approvalStatus = baseline.status === "VISUAL BASELINE APPROVED"
      ? "VISUAL BASELINE APPROVED"
      : "VISUAL BASELINE NOT APPROVED";
  } else {
    // Preserve the pure helper's historical behavior for callers that do
    // not provide baseline metadata; the real report always supplies it.
    approvalStatus = "APPROVED";
  }
  return {
    schema: "safi-visual-state-report/v1",
    startedAt,
    finishedAt,
    result,
    approvalStatus,
    goldenPolicy: "CURRENT captures are never promoted automatically to golden references; promotion requires an explicit human-confirmed allowlisted operation.",
    missingRequiredStates: missing,
    environment,
    baseline,
    states,
  };
}

function stateLabel(state) {
  const platform = state.platform === "macos" ? "macOS" : "Android";
  const id = state.id === "ask" ? "Ask" : state.id.toUpperCase();
  return `${platform} ${id}`;
}

export function formatVisualReportConsole(report) {
  const stateOrder = ["ask", "verified", "uncertain", "failed", "compact", "expanded"];
  const platformOrder = { macos: 0, android: 1 };
  const states = [...report.states].sort((left, right) =>
    platformOrder[left.platform] - platformOrder[right.platform] ||
    stateOrder.indexOf(left.id) - stateOrder.indexOf(right.id),
  );
  const lines = ["SAFI VISUAL REPORT", ""];
  for (const state of states) {
    lines.push(`${stateLabel(state).padEnd(25)} ${state.result}`);
  }
  lines.push("", `RESULT: ${report.result}`);
  if (report.approvalStatus === "AWAITING HUMAN GOLDEN APPROVAL") {
    lines.push("GOLDEN: AWAITING HUMAN GOLDEN APPROVAL");
  } else if (report.approvalStatus === "VISUAL BASELINE APPROVED") {
    lines.push("GOLDEN: VISUAL BASELINE APPROVED");
  } else if (report.approvalStatus === "VISUAL BASELINE NOT APPROVED") {
    lines.push("GOLDEN: VISUAL BASELINE NOT APPROVED");
  }
  return lines.join("\n");
}

function renderStyleTable(styles) {
  const selectors = Object.keys(styles ?? {});
  if (selectors.length === 0) return "<p>No computed styles captured.</p>";
  const headers = ["selector", ...REQUIRED_STYLE_KEYS];
  const rows = selectors.map((selector) => {
    const snapshot = styles[selector];
    return `<tr><th>${escapeHtml(selector)}</th>${headers.slice(1).map((key) => `<td><code>${escapeHtml(snapshot[key])}</code></td>`).join("")}</tr>`;
  });
  return `<div class="scroll"><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function renderCheck(checkEntry) {
  return `<li class="${escapeHtml(checkEntry.status.toLowerCase())}"><strong>${escapeHtml(checkEntry.label)}</strong><span>${escapeHtml(checkEntry.status)}</span><small>${escapeHtml(JSON.stringify(checkEntry.details))}</small></li>`;
}

export function renderVisualReportHtml(report) {
  const cards = report.states.map((state) => {
    const screenshot = state.screenshot
      ? `<img src="${escapeHtml(state.screenshot)}" alt="${escapeHtml(stateLabel(state))} real screenshot">`
      : '<div class="missing">Screenshot unavailable</div>';
    return `<article class="state ${state.result.toLowerCase()}">
      <header><h2>${escapeHtml(stateLabel(state))}</h2><span class="badge">${state.result}</span></header>
      <p class="source">${escapeHtml(state.source)}</p>
      ${screenshot}
      <h3>Checks</h3><ul class="checks">${state.checks.map(renderCheck).join("")}</ul>
      <h3>Computed styles</h3>${renderStyleTable(state.styles)}
      <h3>Golden/reference</h3><pre>${escapeHtml(JSON.stringify(state.golden, null, 2))}</pre>
    </article>`;
  }).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAFI Visual State Report</title>
<style>
:root{color-scheme:light;--blue:#2563eb;--ink:#0f172a;--muted:#475569;--line:#cbd5e1;--surface:#f8fafc;--pass:#166534;--fail:#991b1b}*{box-sizing:border-box}body{margin:0;padding:2rem;background:var(--surface);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1200px;margin:auto}h1{margin-bottom:.25rem;color:var(--blue)}header.summary{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;margin:1rem 0 2rem}.badge{padding:.25rem .6rem;border-radius:999px;background:#dcfce7;color:var(--pass);font-weight:800}.fail .badge,.badge.fail{background:#fee2e2;color:var(--fail)}.state{background:white;border:1px solid var(--line);border-radius:18px;padding:1.2rem;margin:1.2rem 0;box-shadow:0 8px 28px rgba(15,23,42,.08)}.state header{display:flex;justify-content:space-between;align-items:center}.state h2{margin:0}.source{color:var(--muted)}img{display:block;max-width:100%;max-height:620px;object-fit:contain;background:#eef2f7;border:1px solid var(--line);border-radius:12px}.checks{list-style:none;padding:0;display:grid;gap:.5rem}.checks li{display:grid;grid-template-columns:1fr auto;gap:.3rem 1rem;padding:.55rem .7rem;border-left:4px solid var(--pass);background:#f0fdf4}.checks li.fail{border-color:var(--fail);background:#fef2f2}.checks small{grid-column:1/-1;color:var(--muted);overflow-wrap:anywhere}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid var(--line);padding:.35rem;text-align:left;white-space:nowrap}th{background:#eef2ff}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:10px}.missing{padding:2rem;background:#fee2e2;color:var(--fail)}@media(max-width:700px){body{padding:1rem}.state{padding:.8rem}}
</style></head><body><main>
<h1>SAFI Visual State Report</h1><p>Generated ${escapeHtml(report.finishedAt)}</p>
<header class="summary"><span class="badge ${report.result.toLowerCase()}">${report.result}</span><strong>${escapeHtml(report.approvalStatus)}</strong><span>${escapeHtml(report.goldenPolicy)}</span></header>
${cards}
</main></body></html>`;
}

export const VISUAL_STYLE_REQUIREMENTS = Object.freeze([...REQUIRED_STYLE_KEYS]);
