#!/usr/bin/env node
/**
 * Explicit, human-approved visual baseline storage.
 *
 * CURRENT screenshots are evidence, not approvals.  This module owns the
 * small, auditable boundary between the two: only the four allowlisted
 * surfaces below can be promoted, and promotion requires an explicit
 * confirmation from the caller.  The visual report only reads and verifies
 * the resulting manifest; it never writes to golden/.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "./png-analysis.mjs";
import { encodePng } from "./mascot-raster.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const VISUAL_BASELINE_DIR = "golden/visual-baseline";
export const VISUAL_BASELINE_MANIFEST = `${VISUAL_BASELINE_DIR}/manifest.json`;
export const VISUAL_BASELINE_SCHEMA = "safi-visual-baseline/v1";
export const VISUAL_BASELINE_APPROVAL_STATUS = "VISUAL BASELINE APPROVED";
export const VISUAL_BASELINE_PENDING_STATUS = "AWAITING HUMAN GOLDEN APPROVAL";

/**
 * The archived PNG remains the exact approved artifact.  A later macOS
 * headless capture can vary by a few compositor/anti-aliased pixels even
 * when the rendered surface is unchanged, so live comparisons also have a
 * deliberately small, explicit block-level tolerance.  The strict pixel and
 * byte results remain in the report as evidence.
 */
export const VISUAL_BASELINE_COMPARISON_POLICY = Object.freeze({
  blockSize: 16,
  maxMeanBlockDelta: 6,
  maxP95BlockDelta: 18,
  maxBlockDelta: 48,
  allowRenderToleranceFor: Object.freeze(["macos/ask"]),
  toleranceReason: "native compositor and anti-aliasing variance only; layout/state changes must exceed these bounds",
});

/**
 * This is deliberately an allowlist, not a glob.  Adding a new state to
 * the report must never silently make it eligible for promotion.
 */
export const VISUAL_BASELINE_ALLOWLIST = Object.freeze([
  Object.freeze({
    key: "macos/ask",
    platform: "macos",
    state: "ask",
    semanticState: "PROMPT_READY",
    source: "artifacts/visual-report/macos/ask.png",
    golden: "golden/visual-baseline/macos-ask.png",
  }),
  Object.freeze({
    key: "android/ask",
    platform: "android",
    state: "ask",
    semanticState: "PROMPT_READY",
    source: "artifacts/visual-report/android/ask.png",
    golden: "golden/visual-baseline/android-ask.png",
  }),
  Object.freeze({
    key: "android/verified",
    platform: "android",
    state: "verified",
    semanticState: "VERIFIED",
    source: "artifacts/visual-report/android/verified.png",
    golden: "golden/visual-baseline/android-verified.png",
  }),
  Object.freeze({
    key: "android/failed",
    platform: "android",
    state: "failed",
    semanticState: "FAILED",
    source: "artifacts/visual-report/android/failed.png",
    golden: "golden/visual-baseline/android-failed.png",
  }),
]);

const ALLOWLIST_BY_KEY = new Map(VISUAL_BASELINE_ALLOWLIST.map((entry) => [entry.key, entry]));
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function projectRelative(root, value) {
  const candidate = resolve(root, value);
  const rel = relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${"/"}`) || isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${value}`);
  }
  return rel.split("\\").join("/");
}

function projectPath(root, value) {
  return resolve(root, projectRelative(root, value));
}

function sha256Buffer(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256File(path) {
  return sha256Buffer(readFileSync(path));
}

function isoDate(value, label) {
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO date string`);
  }
  return value;
}

function inspectPng(path) {
  const bytes = readFileSync(path);
  const image = decodePng(path);
  return {
    sha256: sha256Buffer(bytes),
    bytes: bytes.length,
    width: image.width,
    height: image.height,
  };
}

function validateSurfaceEntry(root, surface, errors) {
  if (!surface || typeof surface !== "object") {
    errors.push("surface entry is not an object");
    return;
  }
  const definition = ALLOWLIST_BY_KEY.get(surface.key);
  if (!definition) {
    errors.push(`surface is not allowlisted: ${surface.key ?? "<missing key>"}`);
    return;
  }
  if (surface.platform !== definition.platform || surface.state !== definition.state) {
    errors.push(`${surface.key}: platform/state does not match the allowlist`);
  }
  if (surface.semanticState !== definition.semanticState) {
    errors.push(`${surface.key}: semanticState does not match the allowlist`);
  }
  if (surface.source !== definition.source || surface.golden !== definition.golden) {
    errors.push(`${surface.key}: source/golden path is not the approved deterministic path`);
  }
  if (!SHA256_PATTERN.test(String(surface.sha256 ?? ""))) {
    errors.push(`${surface.key}: sha256 is missing or malformed`);
  }
  if (!SHA256_PATTERN.test(String(surface.sourceSha256 ?? ""))) {
    errors.push(`${surface.key}: sourceSha256 is missing or malformed`);
  }
  if (surface.goldenSha256 !== surface.sha256) {
    errors.push(`${surface.key}: goldenSha256 must equal sha256`);
  }
  if (surface.sourceSha256 !== surface.sha256) {
    errors.push(`${surface.key}: promoted source checksum must equal golden checksum`);
  }
  for (const field of ["width", "height", "bytes"]) {
    if (!Number.isInteger(surface[field]) || surface[field] <= 0) {
      errors.push(`${surface.key}: ${field} must be a positive integer`);
    }
  }
  try {
    isoDate(surface.approvedAt, `${surface.key}.approvedAt`);
  } catch (error) {
    errors.push(error.message);
  }
  if (typeof surface.approvedBy !== "string" || !surface.approvedBy.trim()) {
    errors.push(`${surface.key}: approvedBy is required`);
  }
  if (!surface.provenance || typeof surface.provenance !== "object") {
    errors.push(`${surface.key}: provenance is required`);
  }

  try {
    const absoluteGolden = projectPath(root, surface.golden);
    if (!existsSync(absoluteGolden)) throw new Error("file is missing");
    const actual = inspectPng(absoluteGolden);
    if (actual.sha256 !== surface.sha256) throw new Error(`sha256 mismatch (actual ${actual.sha256})`);
    if (actual.bytes !== surface.bytes) throw new Error(`byte count mismatch (actual ${actual.bytes})`);
    if (actual.width !== surface.width || actual.height !== surface.height) {
      throw new Error(`dimension mismatch (actual ${actual.width}x${actual.height})`);
    }
  } catch (error) {
    errors.push(`${surface.key}: ${error.message}`);
  }
}

export function validateVisualBaselineManifest(manifest, { root = ROOT, verifyFiles = true } = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return ["manifest is not an object"];
  }
  if (manifest.schema !== VISUAL_BASELINE_SCHEMA) errors.push("unexpected manifest schema");
  if (manifest.status !== VISUAL_BASELINE_APPROVAL_STATUS) errors.push("manifest is not approved");
  if (manifest.autoPromotion !== false) errors.push("autoPromotion must be false");
  try {
    isoDate(manifest.approvedAt, "manifest.approvedAt");
  } catch (error) {
    errors.push(error.message);
  }
  if (typeof manifest.approvedBy !== "string" || !manifest.approvedBy.trim()) {
    errors.push("manifest.approvedBy is required");
  }
  if (!manifest.approval || typeof manifest.approval !== "object") {
    errors.push("manifest.approval is required");
  }
  const comparisonPolicy = manifest.comparisonPolicy;
  if (!comparisonPolicy || typeof comparisonPolicy !== "object") {
    errors.push("manifest.comparisonPolicy is required");
  } else {
    for (const [field, expected] of Object.entries({
      blockSize: VISUAL_BASELINE_COMPARISON_POLICY.blockSize,
      maxMeanBlockDelta: VISUAL_BASELINE_COMPARISON_POLICY.maxMeanBlockDelta,
      maxP95BlockDelta: VISUAL_BASELINE_COMPARISON_POLICY.maxP95BlockDelta,
      maxBlockDelta: VISUAL_BASELINE_COMPARISON_POLICY.maxBlockDelta,
    })) {
      if (comparisonPolicy[field] !== expected) errors.push(`comparisonPolicy.${field} does not match the verifier policy`);
    }
    if (JSON.stringify(comparisonPolicy.allowRenderToleranceFor) !== JSON.stringify(VISUAL_BASELINE_COMPARISON_POLICY.allowRenderToleranceFor)) {
      errors.push("comparisonPolicy.allowRenderToleranceFor does not match the verifier policy");
    }
  }
  if (!manifest.sourceReport || typeof manifest.sourceReport !== "object") {
    errors.push("manifest.sourceReport is required");
  } else {
    if (!SHA256_PATTERN.test(String(manifest.sourceReport.sha256 ?? ""))) {
      errors.push("sourceReport.sha256 is missing or malformed");
    }
    try {
      isoDate(manifest.sourceReport.startedAt, "sourceReport.startedAt");
      isoDate(manifest.sourceReport.finishedAt, "sourceReport.finishedAt");
    } catch (error) {
      errors.push(error.message);
    }
  }

  const expectedKeys = VISUAL_BASELINE_ALLOWLIST.map((entry) => entry.key);
  if (!Array.isArray(manifest.allowlist) || JSON.stringify(manifest.allowlist) !== JSON.stringify(expectedKeys)) {
    errors.push("allowlist must contain exactly the four approved surface keys in order");
  }
  if (!Array.isArray(manifest.surfaces) || manifest.surfaces.length !== expectedKeys.length) {
    errors.push("manifest must contain exactly four surface records");
  } else {
    const seen = new Set();
    for (const surface of manifest.surfaces) {
      if (seen.has(surface?.key)) errors.push(`duplicate surface: ${surface?.key}`);
      seen.add(surface?.key);
      if (verifyFiles) validateSurfaceEntry(root, surface, errors);
    }
    for (const key of expectedKeys) {
      if (!seen.has(key)) errors.push(`missing allowlisted surface: ${key}`);
    }
  }
  return errors;
}

export function loadVisualBaseline(root = ROOT) {
  const manifestPath = projectPath(root, VISUAL_BASELINE_MANIFEST);
  if (!existsSync(manifestPath)) {
    return {
      status: "MISSING",
      manifest: null,
      entries: new Map(),
      errors: [],
      manifestPath: VISUAL_BASELINE_MANIFEST,
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return {
      status: "INVALID",
      manifest: null,
      entries: new Map(),
      errors: [`manifest JSON could not be read: ${error.message}`],
      manifestPath: VISUAL_BASELINE_MANIFEST,
    };
  }
  const errors = validateVisualBaselineManifest(manifest, { root, verifyFiles: true });
  const entries = new Map();
  if (Array.isArray(manifest.surfaces)) {
    for (const surface of manifest.surfaces) {
      if (surface && ALLOWLIST_BY_KEY.has(surface.key)) {
        try {
          entries.set(surface.key, {
            ...surface,
            goldenPath: projectPath(root, surface.golden),
          });
        } catch {
          // The validation error above is the reportable failure.
        }
      }
    }
  }
  return {
    status: errors.length === 0 ? VISUAL_BASELINE_APPROVAL_STATUS : "INVALID",
    manifest,
    entries,
    errors,
    manifestPath: VISUAL_BASELINE_MANIFEST,
  };
}

function writeDiffImage(destination, current, golden) {
  if (!destination) return;
  const width = Math.max(current.width, golden.width);
  const height = Math.max(current.height, golden.height);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      const inCurrent = x < current.width && y < current.height;
      const inGolden = x < golden.width && y < golden.height;
      if (!inCurrent || !inGolden) {
        pixels[out] = 255;
        pixels[out + 1] = 220;
        pixels[out + 2] = 220;
        pixels[out + 3] = 255;
        continue;
      }
      const currentOffset = (y * current.width + x) * 4;
      const goldenOffset = (y * golden.width + x) * 4;
      let different = false;
      for (let channel = 0; channel < 4; channel += 1) {
        if (current.pixels[currentOffset + channel] !== golden.pixels[goldenOffset + channel]) {
          different = true;
          break;
        }
      }
      pixels[out] = different ? 220 : 248;
      pixels[out + 1] = different ? 38 : 250;
      pixels[out + 2] = different ? 38 : 252;
      pixels[out + 3] = 255;
    }
  }
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, encodePng(width, height, Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength)));
}

function blockComparisonMetrics(current, golden) {
  const blockSize = VISUAL_BASELINE_COMPARISON_POLICY.blockSize;
  const deltas = [];
  for (let y = 0; y < current.height; y += blockSize) {
    for (let x = 0; x < current.width; x += blockSize) {
      const currentAverage = [0, 0, 0];
      const goldenAverage = [0, 0, 0];
      let samples = 0;
      const yEnd = Math.min(y + blockSize, current.height);
      const xEnd = Math.min(x + blockSize, current.width);
      for (let py = y; py < yEnd; py += 1) {
        for (let px = x; px < xEnd; px += 1) {
          const offset = (py * current.width + px) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            currentAverage[channel] += current.pixels[offset + channel];
            goldenAverage[channel] += golden.pixels[offset + channel];
          }
          samples += 1;
        }
      }
      let delta = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        delta += Math.abs(currentAverage[channel] / samples - goldenAverage[channel] / samples);
      }
      deltas.push(delta / 3);
    }
  }
  deltas.sort((left, right) => left - right);
  const p95Index = Math.min(deltas.length - 1, Math.max(0, Math.ceil(deltas.length * 0.95) - 1));
  return {
    blockSize,
    meanAbsoluteBlockDelta: Number(
      (deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length)).toFixed(6),
    ),
    p95AbsoluteBlockDelta: Number(deltas[p95Index].toFixed(6)),
    maxAbsoluteBlockDelta: Number(deltas[deltas.length - 1].toFixed(6)),
    thresholds: {
      mean: VISUAL_BASELINE_COMPARISON_POLICY.maxMeanBlockDelta,
      p95: VISUAL_BASELINE_COMPARISON_POLICY.maxP95BlockDelta,
      max: VISUAL_BASELINE_COMPARISON_POLICY.maxBlockDelta,
    },
  };
}

/**
 * Compare a CURRENT capture with an approved PNG.  Strict decoded-pixel
 * equality is always reported.  Only the explicitly allowlisted live
 * macOS Ask comparison may use the bounded block tolerance; its thresholds
 * and raw pixel/byte deltas remain visible in the report.
 */
export function comparePngFiles(currentPath, goldenPath, diffPath = null, { allowRenderTolerance = false } = {}) {
  let currentBytes;
  let goldenBytes;
  let current;
  let golden;
  try {
    currentBytes = readFileSync(currentPath);
    goldenBytes = readFileSync(goldenPath);
    current = decodePng(currentPath);
    golden = decodePng(goldenPath);
  } catch (error) {
    return {
      pass: false,
      error: error.message,
      currentSha256: null,
      goldenSha256: null,
      dimensions: null,
      metrics: null,
    };
  }

  const sameDimensions = current.width === golden.width && current.height === golden.height;
  let differingPixels = 0;
  let alphaDifferingPixels = 0;
  let maxChannelDelta = 0;
  let totalChannelDelta = 0;
  if (sameDimensions) {
    for (let offset = 0; offset < current.pixels.length; offset += 4) {
      let pixelDifferent = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(current.pixels[offset + channel] - golden.pixels[offset + channel]);
        totalChannelDelta += delta;
        if (delta > maxChannelDelta) maxChannelDelta = delta;
        if (delta !== 0) pixelDifferent = true;
      }
      if (pixelDifferent) differingPixels += 1;
      if (current.pixels[offset + 3] !== golden.pixels[offset + 3]) alphaDifferingPixels += 1;
    }
  }
  if (diffPath) writeDiffImage(diffPath, current, golden);
  const pixelCount = current.width * current.height;
  const pixelExact = sameDimensions && differingPixels === 0;
  const blockMetrics = sameDimensions ? blockComparisonMetrics(current, golden) : null;
  const withinTolerance = Boolean(
    alphaDifferingPixels === 0 &&
    blockMetrics &&
    blockMetrics.meanAbsoluteBlockDelta <= VISUAL_BASELINE_COMPARISON_POLICY.maxMeanBlockDelta &&
    blockMetrics.p95AbsoluteBlockDelta <= VISUAL_BASELINE_COMPARISON_POLICY.maxP95BlockDelta &&
    blockMetrics.maxAbsoluteBlockDelta <= VISUAL_BASELINE_COMPARISON_POLICY.maxBlockDelta,
  );
  const visualEquivalent = pixelExact || (allowRenderTolerance && withinTolerance);
  return {
    pass: visualEquivalent,
    error: null,
    currentSha256: sha256Buffer(currentBytes),
    goldenSha256: sha256Buffer(goldenBytes),
    byteIdentical: currentBytes.equals(goldenBytes),
    comparisonMode: pixelExact ? "pixel-exact" : visualEquivalent ? "approved-render-tolerance" : "fail",
    allowRenderTolerance,
    dimensions: {
      current: { width: current.width, height: current.height },
      golden: { width: golden.width, height: golden.height },
    },
    metrics: {
      pixelExact,
      visualEquivalent,
      withinTolerance,
      comparisonMode: pixelExact ? "pixel-exact" : visualEquivalent ? "approved-render-tolerance" : "fail",
      allowRenderTolerance,
      byteIdentical: currentBytes.equals(goldenBytes),
      differingPixels,
      alphaDifferingPixels,
      maxChannelDelta,
      meanAbsoluteChannelDelta: sameDimensions && pixelCount > 0
        ? Number((totalChannelDelta / (pixelCount * 4)).toFixed(6))
        : null,
      block: blockMetrics,
      tolerance: VISUAL_BASELINE_COMPARISON_POLICY,
    },
  };
}

function reportRunId(report) {
  const started = String(report.startedAt ?? "unknown-started").replace(/[^0-9A-Za-z]+/g, "-");
  const finished = String(report.finishedAt ?? "unknown-finished").replace(/[^0-9A-Za-z]+/g, "-");
  return `visual-report-${started}-${finished}`;
}

/**
 * Promote the four explicitly approved CURRENT files.  This is the only
 * function in the project that writes visual-baseline PNGs, and it refuses to
 * run without `confirmed: true` plus the fixed allowlist.
 */
export function promoteVisualBaseline({
  root = ROOT,
  reportPath = resolve(root, "artifacts/visual-report/report.json"),
  manifestPath = resolve(root, VISUAL_BASELINE_MANIFEST),
  approvedAt = new Date().toISOString(),
  approvedBy = "user",
  approvalText = "APPROVA LE NUOVE GOLDEN: macOS Ask / PROMPT_READY; Android Ask / PROMPT_READY; Android VERIFIED; Android FAILED.",
  confirmed = false,
} = {}) {
  if (confirmed !== true) {
    throw new Error("Visual baseline promotion requires explicit confirmation");
  }
  isoDate(approvedAt, "approvedAt");
  if (typeof approvedBy !== "string" || !approvedBy.trim()) throw new Error("approvedBy is required");
  if (typeof approvalText !== "string" || !approvalText.trim()) throw new Error("approvalText is required");

  const absoluteReportPath = projectPath(root, reportPath);
  const reportBytes = readFileSync(absoluteReportPath);
  const report = JSON.parse(reportBytes.toString("utf8"));
  if (report.result !== "PASS") throw new Error("Promotion requires a passing source visual report");
  const sourceReportSha256 = sha256Buffer(reportBytes);
  const sourceReportRelative = projectRelative(root, absoluteReportPath);
  const runId = reportRunId(report);
  const reportStates = new Map(
    (Array.isArray(report.states) ? report.states : []).map((state) => [`${state.platform}/${state.id}`, state]),
  );

  // Validate every source before writing any destination.  A failed approval
  // therefore cannot leave a partially promoted baseline.
  const prepared = VISUAL_BASELINE_ALLOWLIST.map((definition) => {
    const state = reportStates.get(definition.key);
    if (!state || state.result !== "PASS") {
      throw new Error(`${definition.key}: source report state is not PASS`);
    }
    if (state.screenshot !== definition.source.slice("artifacts/visual-report/".length)) {
      throw new Error(`${definition.key}: source report screenshot path is not the approved CURRENT path`);
    }
    const source = projectPath(root, definition.source);
    if (!existsSync(source)) throw new Error(`${definition.key}: CURRENT is missing: ${definition.source}`);
    const metadata = inspectPng(source);
    return { definition, source, metadata };
  });

  const absoluteManifestPath = projectPath(root, manifestPath);
  mkdirSync(dirname(absoluteManifestPath), { recursive: true });
  const temporaryCopies = [];
  try {
    for (const { definition, source } of prepared) {
      const destination = projectPath(root, definition.golden);
      mkdirSync(dirname(destination), { recursive: true });
      const temporary = `${destination}.tmp-${process.pid}`;
      copyFileSync(source, temporary);
      temporaryCopies.push({ temporary, destination });
    }
    for (const { temporary, destination } of temporaryCopies) {
      renameSync(temporary, destination);
    }
  } catch (error) {
    for (const { temporary } of temporaryCopies) rmSync(temporary, { force: true });
    throw error;
  }

  const sourceReport = {
    path: sourceReportRelative,
    sha256: sourceReportSha256,
    startedAt: report.startedAt ?? null,
    finishedAt: report.finishedAt ?? null,
    runId,
    environment: report.environment ?? null,
  };
  const surfaces = prepared.map(({ definition, metadata }) => ({
    key: definition.key,
    platform: definition.platform,
    state: definition.state,
    semanticState: definition.semanticState,
    source: definition.source,
    golden: definition.golden,
    sha256: metadata.sha256,
    sourceSha256: metadata.sha256,
    goldenSha256: metadata.sha256,
    width: metadata.width,
    height: metadata.height,
    bytes: metadata.bytes,
    approvedAt,
    approvedBy,
    approvalStatus: VISUAL_BASELINE_APPROVAL_STATUS,
    provenance: {
      source: definition.source,
      sourceReport: sourceReportRelative,
      sourceReportSha256,
      sourceRunId: runId,
      sourceRunStartedAt: report.startedAt ?? null,
      sourceRunFinishedAt: report.finishedAt ?? null,
      semanticState: definition.semanticState,
    },
  }));
  const manifest = {
    schema: VISUAL_BASELINE_SCHEMA,
    status: VISUAL_BASELINE_APPROVAL_STATUS,
    autoPromotion: false,
    approvedAt,
    approvedBy,
    approval: {
      text: approvalText,
      scope: "exactly the four allowlisted CURRENT surfaces",
    },
    checksumAlgorithm: "SHA-256",
    comparisonPolicy: {
      mode: "pixel-exact-with-approved-render-tolerance",
      blockSize: VISUAL_BASELINE_COMPARISON_POLICY.blockSize,
      maxMeanBlockDelta: VISUAL_BASELINE_COMPARISON_POLICY.maxMeanBlockDelta,
      maxP95BlockDelta: VISUAL_BASELINE_COMPARISON_POLICY.maxP95BlockDelta,
      maxBlockDelta: VISUAL_BASELINE_COMPARISON_POLICY.maxBlockDelta,
      allowRenderToleranceFor: [...VISUAL_BASELINE_COMPARISON_POLICY.allowRenderToleranceFor],
      rationale: VISUAL_BASELINE_COMPARISON_POLICY.toleranceReason,
    },
    sourceReport,
    allowlist: VISUAL_BASELINE_ALLOWLIST.map((entry) => entry.key),
    surfaces,
  };
  const errors = validateVisualBaselineManifest(manifest, { root, verifyFiles: true });
  if (errors.length) throw new Error(`Promoted baseline failed validation: ${errors.join("; ")}`);
  const temporaryManifest = `${absoluteManifestPath}.tmp-${process.pid}`;
  writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temporaryManifest, absoluteManifestPath);
  return manifest;
}
