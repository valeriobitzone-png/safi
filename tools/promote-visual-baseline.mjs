#!/usr/bin/env node
/**
 * Explicitly promote the four human-approved visual CURRENT surfaces.
 *
 * This command is intentionally separate from `npm run visual:report`.
 * The report is read-only with respect to golden/ and can never invoke this
 * promotion path.  A human must pass --confirm after reviewing the CURRENT
 * captures.
 */
import { resolve } from "node:path";
import {
  ROOT,
  VISUAL_BASELINE_APPROVAL_STATUS,
  promoteVisualBaseline,
} from "./visual-baseline.mjs";

function parseArgs(args) {
  const options = {
    confirmed: false,
    approvedAt: new Date().toISOString(),
    approvedBy: "user",
    approvalText: "APPROVA LE NUOVE GOLDEN: macOS Ask / PROMPT_READY; Android Ask / PROMPT_READY; Android VERIFIED; Android FAILED.",
    reportPath: resolve(ROOT, "artifacts/visual-report/report.json"),
    manifestPath: resolve(ROOT, "golden/visual-baseline/manifest.json"),
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--confirm") options.confirmed = true;
    else if (arg === "--approved-at") options.approvedAt = args[++index] ?? "";
    else if (arg === "--approved-by") options.approvedBy = args[++index] ?? "";
    else if (arg === "--approval-text") options.approvalText = args[++index] ?? "";
    else if (arg === "--report") options.reportPath = resolve(ROOT, args[++index] ?? "");
    else if (arg === "--manifest") options.manifestPath = resolve(ROOT, args[++index] ?? "");
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: node tools/promote-visual-baseline.mjs --confirm [--approved-at ISO] [--approved-by NAME] [--report FILE] [--manifest FILE]");
      process.exit(0);
    } else {
      throw new Error(`Unknown promotion option: ${arg}`);
    }
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (!options.confirmed) {
    throw new Error("Refusing promotion: pass --confirm only after human visual approval");
  }
  const manifest = promoteVisualBaseline(options);
  console.log(`${manifest.status}: promoted ${manifest.surfaces.length} explicitly approved surfaces`);
  for (const surface of manifest.surfaces) {
    console.log(`- ${surface.key} ${surface.width}x${surface.height} sha256=${surface.sha256}`);
  }
  if (manifest.status !== VISUAL_BASELINE_APPROVAL_STATUS) {
    throw new Error("Promotion did not produce an approved manifest");
  }
} catch (error) {
  console.error(`visual baseline promotion refused: ${error.message}`);
  process.exitCode = 1;
}
