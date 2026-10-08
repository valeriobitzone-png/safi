import { createHash } from "node:crypto";

/** SHA-256 (hex) of the exact human-facing text. */
export function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
