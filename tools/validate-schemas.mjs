#!/usr/bin/env node
/**
 * Schema validation for Safi JSON Schemas and example payloads.
 * Zero runtime dependencies outside devDependencies (ajv, ajv-formats).
 *
 * Run: node tools/validate-schemas.mjs   (after `npm install`)
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(here, "..", "schemas");
const examplesDir = join(here, "..", "examples");

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);

const schemaFiles = readdirSync(schemasDir).filter((f) => f.endsWith(".json"));
for (const file of schemaFiles) {
  const schema = JSON.parse(readFileSync(join(schemasDir, file), "utf8"));
  ajv.addSchema(schema);
}
console.log(`Loaded ${schemaFiles.length} schemas (Draft 2020-12).`);

const exampleSchemas = {
  "verified-result.json": "https://safi.dev/schemas/v0.1/safi-result.json",
  "uncertain-result.json": "https://safi.dev/schemas/v0.1/safi-result.json",
  "clarification.json": "https://safi.dev/schemas/v0.1/safi-outcome.json",
  "safi-stamp.json": "https://safi.dev/schemas/v0.1/safi-stamp.json"
};

let failures = 0;
for (const [file, schemaId] of Object.entries(exampleSchemas)) {
  const data = JSON.parse(readFileSync(join(examplesDir, file), "utf8"));
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    console.log(`FAIL missing schema ${schemaId}`);
    failures += 1;
    continue;
  }
  const ok = validate(data);
  if (ok) {
    console.log(`PASS ${file}`);
  } else {
    failures += 1;
    console.log(`FAIL ${file}`);
    console.log(JSON.stringify(validate.errors, null, 2));
  }
}

if (failures > 0) {
  process.exit(1);
}
console.log("All example payloads validated.");
