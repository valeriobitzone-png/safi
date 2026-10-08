#!/usr/bin/env node
/**
 * Static color-semantics guard for authored Safi UI surfaces.
 *
 * This lint is intentionally read-only. It follows green-family color values
 * through CSS custom properties, inline styles, JavaScript style assignments,
 * and authored SVG, then permits them only when their context is VERIFIED.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_SCOPE_ROOTS = [
  "packages/mobile-consumer",
  "apps/desktop",
  "ui",
];

const AUTHORED_EXTENSIONS = new Set([
  ".css",
  ".htm",
  ".html",
  ".js",
  ".jsx",
  ".cjs",
  ".mjs",
  ".svelte",
  ".svg",
  ".ts",
  ".tsx",
  ".vue",
]);

const EXCLUDED_DIRECTORY_SEGMENTS = new Set([
  ".git",
  "artifacts",
  "coverage",
  "dist",
  "generated",
  "golden",
  "node_modules",
  "release",
  "target",
]);

const EXACT_EXCLUDED_PREFIXES = [
  "apps/android/app/src/main/assets",
  "apps/desktop/src-tauri/resources/safi",
  "apps/ios/Safi/WebResources",
];

const COLOR_BEARING_PROPERTY = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline))?(?:-(?:color|width|style))?|outline(?:-offset)?|box-shadow|text-shadow|text-decoration-color|fill|stroke|stop-color|flood-color|lighting-color|accent-color|caret-color|filter|column-rule(?:-color)?|-webkit-text-fill-color|-webkit-text-stroke-color)$/i;

const FUNCTIONAL_COLOR_PATTERN = /\b(?:rgba?|hsla?)\(\s*[^)]*\)/gi;
const HEX_COLOR_PATTERN = /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{4}\b|#[0-9a-f]{3}\b/gi;
const CSS_NAMED_GREEN_PATTERN = /\b(?:darkgreen|forestgreen|green|greenyellow|lawngreen|lightgreen|lime|limegreen|mediumseagreen|mediumspringgreen|olivedrab|palegreen|seagreen|springgreen|yellowgreen)\b/gi;
const COLOR_TOKEN_PATTERN = new RegExp(
  `${HEX_COLOR_PATTERN.source}|${FUNCTIONAL_COLOR_PATTERN.source}`,
  "gi",
);

const NAMED_GREEN_RGB = new Map([
  ["darkgreen", [0, 100, 0]],
  ["forestgreen", [34, 139, 34]],
  ["green", [0, 128, 0]],
  ["greenyellow", [173, 255, 47]],
  ["lawngreen", [124, 252, 0]],
  ["lightgreen", [144, 238, 144]],
  ["lime", [0, 255, 0]],
  ["limegreen", [50, 205, 50]],
  ["mediumseagreen", [60, 179, 113]],
  ["mediumspringgreen", [0, 250, 154]],
  ["olivedrab", [107, 142, 35]],
  ["palegreen", [152, 251, 152]],
  ["seagreen", [46, 139, 87]],
  ["springgreen", [0, 255, 127]],
  ["yellowgreen", [154, 205, 50]],
]);

/** @param {string} value */
function normalizeContext(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*([>+~])\s*/g, " $1 ")
    .replace(/;+\s*$/, "")
    .trim();
}

/**
 * VERIFIED is the only trust state whose palette may contain green.
 * Keep this intentionally narrower than generic "success" or "positive".
 */
export function isVerifiedSemanticContext(value) {
  const context = String(value ?? "");
  if (/\b(?:un|non|not)[-_ ]?verified\b/i.test(context)) return false;
  if (/\bverified\b/i.test(context)) return true;
  if (/\btrust[-_ ]?verified\b/i.test(context)) return true;
  if (/\bsign[-_ ]?check\b/i.test(context)) return true;
  if (/\bsigncheck\b/i.test(context)) return true;
  if (/\bverified(?:[_ -]?(?:color|colour|glow|badge|glyph|check|shadow|tint|token))\b/i.test(context)) {
    return true;
  }
  if (/\b(?:projection|summary\.color|safi[-_ ]?stamp|stamp(?:el|element)?|trustline|trust[-_ ]?(?:line|badge|chip|glyph))\b/i.test(context)) {
    return true;
  }
  return false;
}

function isSemanticVariableName(name) {
  return isVerifiedSemanticContext(String(name));
}

/** Remove comments while preserving byte offsets and line numbers. */
export function maskComments(source) {
  const input = String(source);
  const output = [];
  let state = "code";

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    const next = input[index + 1] ?? "";

    if (state === "line-comment") {
      if (char === "\n" || char === "\r") {
        state = "code";
        output.push(char);
      } else {
        output.push(" ");
      }
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        output.push("  ");
        index += 1;
      } else {
        output.push(char === "\n" || char === "\r" ? char : " ");
      }
      continue;
    }

    if (state === "html-comment") {
      if (char === "-" && next === "-" && input[index + 2] === ">") {
        output.push("   ");
        index += 2;
        state = "code";
      } else {
        output.push(char === "\n" || char === "\r" ? char : " ");
      }
      continue;
    }

    if (state === "single" || state === "double" || state === "template") {
      output.push(char);
      if (char === "\\" && next) {
        output.push(next);
        index += 1;
      } else if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      output.push("  ");
      index += 1;
      state = "line-comment";
    } else if (char === "/" && next === "*") {
      output.push("  ");
      index += 1;
      state = "block-comment";
    } else if (char === "<" && input.slice(index, index + 4) === "<!--") {
      output.push("    ");
      index += 3;
      state = "html-comment";
    } else if (char === "'") {
      output.push(char);
      state = "single";
    } else if (char === '"') {
      output.push(char);
      state = "double";
    } else if (char === "`") {
      output.push(char);
      state = "template";
    } else {
      output.push(char);
    }
  }

  return output.join("");
}

function parseNumber(token) {
  const text = String(token ?? "").trim();
  if (!text || text === "none") return null;
  if (text.endsWith("%")) {
    const value = Number.parseFloat(text.slice(0, -1));
    return Number.isFinite(value) ? value / 100 : null;
  }
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

function splitFunctionalArguments(body) {
  const slash = body.split(/\s*\/\s*/, 2);
  const head = slash[0] ?? "";
  const parts = head.includes(",") ? head.split(",") : head.trim().split(/\s+/);
  return [parts[0], parts[1], parts[2]];
}

function hslToRgb(hue, saturation, lightness) {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map((channel) => (channel + m) * 255);
}

function rgbToHsl(red, green, blue) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, lightness];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  if (hue < 0) hue += 360;
  return [hue, saturation, lightness];
}

function parseHexColor(token) {
  const digits = token.slice(1);
  const expanded = digits.length <= 4
    ? [...digits].map((digit) => digit + digit).join("")
    : digits;
  if (expanded.length !== 6 && expanded.length !== 8) return null;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function parseColorFunction(token) {
  const match = /^(rgba?|hsla?)\(\s*([\s\S]*?)\s*\)$/i.exec(token);
  if (!match) return null;
  const kind = match[1]?.toLowerCase() ?? "";
  const rawArgs = splitFunctionalArguments(match[2] ?? "");
  if (rawArgs.some((value) => value === undefined)) return null;
  if (kind.startsWith("rgb")) {
    return rawArgs.slice(0, 3).map((raw) => {
      const text = String(raw).trim();
      if (text === "none") return null;
      const value = Number.parseFloat(text);
      if (!Number.isFinite(value)) return null;
      return text.endsWith("%") ? (value / 100) * 255 : value;
    });
  }
  const [hue, saturation, lightness] = rawArgs.map(parseNumber);
  if ([hue, saturation, lightness].some((value) => value === null || value === undefined)) return null;
  return hslToRgb(hue, saturation, lightness);
}

/** @returns {{ start: number, end: number, raw: string, green: boolean }} */
function colorAt(text, start, end, includeNamed = false) {
  const raw = text.slice(start, end);
  let rgb = null;
  if (raw.startsWith("#")) rgb = parseHexColor(raw);
  else if (/^(?:rgba?|hsla?)\(/i.test(raw)) rgb = parseColorFunction(raw);
  else if (includeNamed) rgb = NAMED_GREEN_RGB.get(raw.toLowerCase()) ?? null;
  if (!rgb) return { start, end, raw, green: false };

  const [hue, saturation, lightness] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const green =
    saturation >= 0.2 &&
    lightness > 0.03 &&
    lightness < 0.95 &&
    hue >= 75 &&
    hue <= 168;
  return { start, end, raw, green };
}

export function extractColors(value, { includeNamed = false } = {}) {
  const text = String(value ?? "");
  const matches = [];
  for (const match of text.matchAll(COLOR_TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    matches.push(colorAt(text, start, start + match[0].length, false));
  }
  if (includeNamed) {
    for (const match of text.matchAll(CSS_NAMED_GREEN_PATTERN)) {
      const start = match.index ?? 0;
      matches.push(colorAt(text, start, start + match[0].length, true));
    }
  }
  return matches
    .filter((match) => match.green)
    .sort((left, right) => left.start - right.start);
}

function toPosix(path) {
  return sep === "/" ? path : path.replaceAll("\\", "/");
}

export function isSupportedUiSource(path) {
  return AUTHORED_EXTENSIONS.has(extname(path).toLowerCase());
}

export function isExcludedUiPath(relativePath) {
  const path = toPosix(relativePath).replace(/^\.\//, "");
  const lower = path.toLowerCase();
  const segments = lower.split("/");
  if (EXCLUDED_DIRECTORY_SEGMENTS.has(segments.at(-1) ?? "")) return true;
  if (segments.some((segment) => EXCLUDED_DIRECTORY_SEGMENTS.has(segment))) return true;
  if (EXACT_EXCLUDED_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`))) {
    return true;
  }
  if (lower === "apps/ios/safi/webresources" || lower.startsWith("apps/ios/safi/webresources/")) {
    return true;
  }
  const basename = segments.at(-1) ?? "";
  if (/\.(?:avif|bmp|gif|ico|icns|jpe?g|png|webp)$/i.test(basename)) return true;
  if (/\.(?:generated|staged|min)\.[^.]+$/i.test(basename)) return true;
  if (/(?:^|[.-])(generated|staged)(?:[.-]|$)/i.test(basename)) return true;
  return false;
}

export function collectAuthoredUiFiles(
  root,
  scopeRoots = DEFAULT_SCOPE_ROOTS,
) {
  const files = [];
  const visit = (absolute) => {
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(absolute, entry.name);
      const childRelative = toPosix(relative(root, child));
      if (isExcludedUiPath(childRelative)) continue;
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && isSupportedUiSource(entry.name)) files.push(childRelative);
    }
  };

  for (const scopeRoot of scopeRoots) visit(resolve(root, scopeRoot));
  return [...new Set(files)].sort();
}

function collectVariableDefinitions(sources) {
  const definitions = new Map();
  for (const source of sources) {
    const text = maskComments(source.text);
    const pattern = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}\n]+)/g;
    for (const match of text.matchAll(pattern)) {
      const name = match[1];
      if (!name) continue;
      const entries = definitions.get(name) ?? [];
      entries.push({
        value: match[2] ?? "",
        filePath: source.filePath,
        index: match.index ?? 0,
      });
      definitions.set(name, entries);
    }
  }
  return definitions;
}

function variableIsGreen(name, localDefinitions, globalDefinitions, stack = new Set()) {
  if (isSemanticVariableName(name)) return true;
  if (stack.has(name)) return false;
  const entries = localDefinitions.get(name) ?? globalDefinitions.get(name) ?? [];
  const nextStack = new Set(stack);
  nextStack.add(name);
  return entries.some((entry) =>
    extractColors(entry.value, { includeNamed: true }).length > 0 ||
    [...entry.value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].some((match) =>
      variableIsGreen(match[1] ?? "", localDefinitions, globalDefinitions, nextStack),
    ),
  );
}

function lineAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index && cursor < text.length; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function selectorBefore(text, declarationIndex, analysisStart = 0) {
  const blockStart = text.lastIndexOf("{", declarationIndex);
  if (blockStart < analysisStart) return "CSS declaration";
  const previousEnd = Math.max(
    text.lastIndexOf("}", blockStart),
    text.lastIndexOf(";", blockStart),
    text.lastIndexOf("{", blockStart - 1),
    analysisStart - 1,
  );
  const selector = text.slice(previousEnd + 1, blockStart).trim();
  return normalizeContext(selector || "CSS declaration");
}

function tagContext(tagName, attributes) {
  const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
  const classNames = [...attributes.matchAll(/\bclass\s*=\s*["']([^"']+)["']/gi)]
    .flatMap((match) => (match[1] ?? "").split(/\s+/))
    .filter(Boolean);
  const state = /\bdata-(?:state|trust|status)\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
  let context = tagName.toLowerCase();
  if (id) context += `#${id}`;
  for (const className of classNames) context += `.${className}`;
  if (state) context += `[data-state="${state}"]`;
  return normalizeContext(context);
}

function finding(filePath, line, context, raw, via) {
  return { filePath, line, context: normalizeContext(context), raw, via };
}

function analyzeCssValue(value, valueOffset, context, semanticContext, add) {
  for (const color of extractColors(value, { includeNamed: true })) {
    if (!semanticContext) add(valueOffset + color.start, context, color.raw, "literal");
  }
}

function analyzeVariableReference(
  value,
  valueOffset,
  context,
  semanticContext,
  localDefinitions,
  globalDefinitions,
  add,
) {
  const pattern = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,([\s\S]*?))?\)/g;
  for (const match of value.matchAll(pattern)) {
    const name = match[1] ?? "";
    const start = match.index ?? 0;
    if (
      !semanticContext &&
      variableIsGreen(name, localDefinitions, globalDefinitions)
    ) {
      add(valueOffset + start, context, `var(${name})`, "CSS variable");
    }
    const fallback = match[2];
    if (fallback && !semanticContext) {
      for (const color of extractColors(fallback, { includeNamed: true })) {
        add(
          valueOffset + start + match[0].indexOf(fallback) + color.start,
          context,
          color.raw,
          "CSS variable fallback",
        );
      }
    }
  }
}

function analyzeCss(
  text,
  fullText,
  start,
  end,
  localDefinitions,
  globalDefinitions,
  add,
  explicitContext,
  explicitSemanticContext,
) {
  const slice = fullText.slice(start, end);
  const customProperties = new Set();
  const customPattern = /--[A-Za-z0-9_-]+\s*:\s*[^;}\n]+/g;

  for (const customMatch of slice.matchAll(customPattern)) {
    const customStart = start + (customMatch.index ?? 0);
    const propertyMatch = /^(--[A-Za-z0-9_-]+)\s*:\s*([\s\S]*)$/.exec(customMatch[0]);
    if (!propertyMatch) continue;
    const name = propertyMatch[1] ?? "";
    const value = propertyMatch[2] ?? "";
    const valueOffset = customStart + customMatch[0].indexOf(value);
    const semantic = isSemanticVariableName(name);
    customProperties.add(name);
    analyzeCssValue(value, valueOffset, `CSS custom property ${name}`, semantic, add);
    analyzeVariableReference(
      value,
      valueOffset,
      `CSS custom property ${name}`,
      semantic,
      localDefinitions,
      globalDefinitions,
      add,
    );
  }

  const declarationPattern = /([-*A-Za-z_][A-Za-z0-9_-]*)\s*:\s*([^;{}]+)/g;
  for (const match of slice.matchAll(declarationPattern)) {
    const property = match[1] ?? "";
    const value = match[2] ?? "";
    if (customProperties.has(property)) continue;
    if (!COLOR_BEARING_PROPERTY.test(property)) continue;
    const declarationStart = start + (match.index ?? 0);
    const valueOffset = declarationStart + match[0].indexOf(value);
    const selector = explicitContext ?? selectorBefore(slice, match.index ?? 0, 0);
    const semantic = explicitSemanticContext ?? isVerifiedSemanticContext(selector);
    analyzeCssValue(value, valueOffset, selector, semantic, add);
    analyzeVariableReference(
      value,
      valueOffset,
      selector,
      semantic,
      localDefinitions,
      globalDefinitions,
      add,
    );
  }
}

function analyzeMarkup(text, start, end, localDefinitions, globalDefinitions, add) {
  const slice = text.slice(start, end);
  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  for (const match of slice.matchAll(stylePattern)) {
    const contentStart = start + (match.index ?? 0) + match[0].indexOf(match[1] ?? "");
    analyzeCss(
      text,
      text,
      contentStart,
      contentStart + (match[1]?.length ?? 0),
      localDefinitions,
      globalDefinitions,
      add,
    );
  }

  const tagPattern = /<([A-Za-z][\w:-]*)\b([^>]*)>/g;
  for (const match of slice.matchAll(tagPattern)) {
    const tagStart = start + (match.index ?? 0);
    const tagName = match[1] ?? "element";
    const attributes = match[2] ?? "";
    const context = tagContext(tagName, attributes);
    const semantic = isVerifiedSemanticContext(context);
    const styleAttribute = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/i.exec(attributes);
    if (styleAttribute) {
      const value = styleAttribute[2] ?? "";
      const valueOffset = tagStart + match[0].indexOf(value);
      analyzeCss(
        text,
        text,
        valueOffset,
        valueOffset + value.length,
        localDefinitions,
        globalDefinitions,
        add,
        context,
        semantic,
      );
    }

    for (const attribute of attributes.matchAll(
      /\b(fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*(["'])([\s\S]*?)\2/gi,
    )) {
      const property = attribute[1] ?? "color";
      const value = attribute[3] ?? "";
      const valueStart = attribute.index ?? 0;
      const valueOffset = tagStart + valueStart + attribute[0].indexOf(value);
      const valueSemantic = semantic || isVerifiedSemanticContext(`${context} ${property}`);
      analyzeCssValue(value, valueOffset, context, valueSemantic, add);
    }
  }
}

function collectJsDefinitions(text, start = 0, end = text.length) {
  const definitions = new Map();
  const pattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([\s\S]*?);/g;
  for (const match of text.slice(start, end).matchAll(pattern)) {
    const name = match[1] ?? "";
    const value = match[2] ?? "";
    const valueStart = start + (match.index ?? 0) + match[0].indexOf(value);
    definitions.set(name, { name, value, start: valueStart, end: valueStart + value.length });
  }
  return definitions;
}

function jsExpressionIsGreen(value, definitions, stack = new Set()) {
  if (extractColors(value, { includeNamed: false }).length > 0) return true;
  for (const match of value.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const name = match[0];
    if (!definitions.has(name) || stack.has(name)) continue;
    const entry = definitions.get(name);
    const nextStack = new Set(stack);
    nextStack.add(name);
    if (jsExpressionIsGreen(entry?.value ?? "", definitions, nextStack)) return true;
  }
  return false;
}

function collectJsStatements(text, start, end) {
  const statements = [];
  let statementStart = start;
  let state = "code";
  let escaped = false;

  for (let index = start; index < end; index += 1) {
    const char = text[index] ?? "";
    if (state !== "code") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) state = "code";
      continue;
    }
    if (char === "'") state = "single";
    else if (char === '"') state = "double";
    else if (char === "`") state = "template";
    else if (char === ";") {
      statements.push({ start: statementStart, end: index, text: text.slice(statementStart, index) });
      statementStart = index + 1;
    }
  }
  if (statementStart < end) {
    statements.push({ start: statementStart, end, text: text.slice(statementStart, end) });
  }
  return statements;
}

function jsColorIsSemantic(statement, color, definition) {
  if (definition && isSemanticVariableName(definition.name)) return true;
  const source = typeof statement === "string" ? statement : statement.text;
  const lineStart = source.lastIndexOf("\n", Math.max(0, color.start - 1)) + 1;
  const lineEnd = source.indexOf("\n", color.start);
  const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
  const prefix = line.slice(0, Math.max(0, color.start));
  const objectKey = /(?:^|[,{])\s*([A-Za-z_$][\w$]*)\s*:\s*[^,{}]*$/i.exec(prefix)?.[1];
  if (objectKey && isVerifiedSemanticContext(objectKey)) return true;
  return isVerifiedSemanticContext(line);
}

function analyzeJs(text, start, end, add) {
  const definitions = collectJsDefinitions(text, start, end);
  const handledRanges = [];
  const jsText = text.slice(start, end);

  for (const definition of definitions.values()) {
    for (const color of extractColors(definition.value, { includeNamed: false })) {
      if (!jsColorIsSemantic(definition.value, color, definition)) {
        add(
          definition.start + color.start,
          `JS ${definition.name}`,
          color.raw,
          "JavaScript value",
        );
      }
    }
    handledRanges.push([definition.start, definition.end]);
    if (
      extractColors(definition.value, { includeNamed: false }).length === 0 &&
      !isSemanticVariableName(definition.name) &&
      /\bverified\s*:/i.test(definition.value) === false &&
      jsExpressionIsGreen(definition.value, definitions)
    ) {
      const reference = definition.value.match(/[A-Za-z_$][\w$]*/)?.[0] ?? definition.value.trim();
      add(definition.start, `JS ${definition.name}`, reference, "JavaScript value alias");
    }
  }

  const stylePatterns = [
    {
      pattern: /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.style\.([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g,
      property: 2,
      value: 3,
    },
    {
      pattern: /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.style\[\s*["']([^"']+)["']\s*\]\s*=\s*([^;\n]+)/g,
      property: 2,
      value: 3,
    },
    {
      pattern: /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.style\.setProperty\(\s*["']([^"']+)["']\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)\s*\)/g,
      property: 2,
      value: 3,
    },
  ];
  for (const { pattern, property: propertyGroup, value: valueGroup } of stylePatterns) {
    for (const match of jsText.matchAll(pattern)) {
      const wholeStart = start + (match.index ?? 0);
      const target = match[1] ?? "element";
      const property = match[propertyGroup] ?? "style";
      const value = String(match[valueGroup] ?? "").trim();
      const valueOffset = wholeStart + match[0].lastIndexOf(value);
      const context = `JS .style.${property} on ${target}`;
      handledRanges.push([wholeStart, wholeStart + match[0].length]);
      if (property === "textContent") continue;
      if (isVerifiedSemanticContext(context)) continue;
      if (jsExpressionIsGreen(value, definitions)) {
        const direct = extractColors(value, { includeNamed: false })[0];
        add(valueOffset, context, direct?.raw ?? value, direct ? "literal" : "JavaScript style alias");
      }
    }
  }

  const styleContentPattern = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.style\.textContent\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g;
  for (const match of jsText.matchAll(styleContentPattern)) {
    const wholeStart = start + (match.index ?? 0);
    const quotedValue = match[2] ?? '""';
    const contentStart = wholeStart + match[0].lastIndexOf(quotedValue) + 1;
    handledRanges.push([wholeStart, wholeStart + match[0].length]);
    analyzeCss(
      text,
      text,
      contentStart,
      contentStart + quotedValue.length - 2,
      collectVariableDefinitions([{ text: jsText, filePath: "" }]),
      new Map(),
      add,
    );
  }

  const setAttributePattern = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.setAttribute\(\s*["'](style|fill|stroke|color|stop-color)["']\s*,\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)\)/g;
  for (const match of jsText.matchAll(setAttributePattern)) {
    const wholeStart = start + (match.index ?? 0);
    const target = match[1] ?? "element";
    const property = match[2] ?? "style";
    const value = String(match[3] ?? "").trim();
    const valueOffset = wholeStart + match[0].lastIndexOf(value);
    const context = `JS .setAttribute(${property}) on ${target}`;
    handledRanges.push([wholeStart, wholeStart + match[0].length]);
    if (isVerifiedSemanticContext(context)) continue;
    if (jsExpressionIsGreen(value, definitions)) {
      const direct = extractColors(value, { includeNamed: false })[0];
      add(valueOffset, context, direct?.raw ?? value, direct ? "literal" : "JavaScript style alias");
    }
  }

  for (const statement of collectJsStatements(text, start, end)) {
    const definition = [...definitions.values()].find(
      (entry) => statement.start <= entry.start && entry.end <= statement.end,
    );
    for (const color of extractColors(statement.text, { includeNamed: false })) {
      const absolute = statement.start + color.start;
      if (handledRanges.some(([rangeStart, rangeEnd]) => absolute >= rangeStart && absolute <= rangeEnd)) {
        continue;
      }
      if (!jsColorIsSemantic(statement.text, color, definition)) {
        add(absolute, normalizeContext(statement.text), color.raw, "authored JavaScript/SVG");
      }
    }
  }
}

export function analyzeUiColorSource(source, filePath, globalDefinitions = new Map()) {
  const text = maskComments(source);
  const localDefinitions = collectVariableDefinitions([{ text, filePath }]);
  const violations = [];
  const seen = new Set();
  const add = (index, context, raw, via) => {
    const line = lineAt(text, index);
    const violation = finding(filePath, line, context, raw, via);
    const key = `${line}\u0000${violation.context}\u0000${raw}\u0000${via}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push(violation);
  };

  const lower = filePath.toLowerCase();
  if (lower.endsWith(".css")) {
    analyzeCss(text, text, 0, text.length, localDefinitions, globalDefinitions, add);
  } else if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    analyzeMarkup(text, 0, text.length, localDefinitions, globalDefinitions, add);
    const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    for (const match of text.matchAll(scriptPattern)) {
      const attributes = match[1] ?? "";
      const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]?.toLowerCase();
      if (type && !["module", "text/javascript", "application/javascript"].includes(type)) continue;
      const body = match[2] ?? "";
      const bodyStart = (match.index ?? 0) + match[0].indexOf(body);
      analyzeJs(text, bodyStart, bodyStart + body.length, add);
    }
  } else if (lower.endsWith(".svg")) {
    analyzeMarkup(text, 0, text.length, localDefinitions, globalDefinitions, add);
  } else {
    analyzeJs(text, 0, text.length, add);
  }

  return violations.sort((left, right) =>
    left.line - right.line || left.context.localeCompare(right.context) || left.raw.localeCompare(right.raw),
  );
}

export function lintUiColors({
  root = process.cwd(),
  scopeRoots = DEFAULT_SCOPE_ROOTS,
} = {}) {
  const absoluteRoot = resolve(root);
  const files = collectAuthoredUiFiles(absoluteRoot, scopeRoots);
  const sources = files.map((filePath) => ({
    filePath,
    text: readFileSync(join(absoluteRoot, filePath), "utf8"),
  }));
  const variableDefinitions = collectVariableDefinitions(sources);
  const violations = sources
    .flatMap((source) =>
      analyzeUiColorSource(source.text, source.filePath, variableDefinitions),
    )
    .sort((left, right) =>
      left.filePath.localeCompare(right.filePath) || left.line - right.line,
    );
  return { filesScanned: files.length, violations };
}

const FAILURE_REASON = "Non-semantic green detected.";
const EXPECTED_SEMANTIC_FAMILY = "Safi blue/neutral token";
const GREEN_RESERVED_FOR = "VERIFIED";

export function formatUiColorReport({ filesScanned, violations }) {
  const failed = violations.length > 0;
  const lines = [
    failed
      ? "SAFI UI COLOR SEMANTICS — FAIL"
      : "SAFI UI COLOR SEMANTICS — PASS",
    "",
  ];

  if (!failed) {
    lines.push(`Scanned ${filesScanned} authored files`);
    lines.push("No non-semantic green detected.");
    return lines.join("\n");
  }

  for (const [index, violation] of violations.entries()) {
    if (index > 0) lines.push("—".repeat(48), "");
    lines.push(`${violation.filePath}:${violation.line}`);
    lines.push(violation.context || "authored UI");
    lines.push(violation.raw);
    lines.push("");
    lines.push(FAILURE_REASON);
    lines.push(`Use ${EXPECTED_SEMANTIC_FAMILY}.`);
    lines.push(`Green is reserved for ${GREEN_RESERVED_FOR}.`);
  }
  return lines.join("\n");
}

export function formatUiColorJsonReport({ filesScanned, violations }) {
  return JSON.stringify(
    {
      schema: "safi-ui-color-semantics/v1",
      result: violations.length === 0 ? "pass" : "fail",
      filesScanned,
      violations: violations.map((violation) => ({
        file: violation.filePath,
        line: violation.line,
        context: violation.context || "authored UI",
        colorOrToken: violation.raw,
        detectedVia: violation.via,
        reason: FAILURE_REASON,
        expectedSemanticFamily: EXPECTED_SEMANTIC_FAMILY,
        greenReservedFor: GREEN_RESERVED_FOR,
      })),
    },
    null,
    2,
  );
}

export function parseUiColorCliArgs(args) {
  const positional = [];
  let json = false;
  for (const arg of args) {
    if (arg === "--json") json = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 1) {
    throw new Error("Expected at most one project root argument");
  }
  return { json, root: positional[0] };
}

function main(args = process.argv.slice(2)) {
  const options = parseUiColorCliArgs(args);
  const projectRoot = options.root
    ? resolve(process.cwd(), options.root)
    : dirname(dirname(fileURLToPath(import.meta.url)));
  const result = lintUiColors({ root: projectRoot });
  console.log(
    options.json
      ? formatUiColorJsonReport(result)
      : formatUiColorReport(result),
  );
  if (result.violations.length > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();
