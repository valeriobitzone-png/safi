/**
 * Manual transport — OUTSIDE the core.
 *
 * Universal copy/paste fallback (RFC 0001, MANUAL mode): no capture, no
 * integration. Structural package mirroring the Phase 2 reference
 * implementation; the demo-web package mounts the Phase 3 Web Component
 * on top of the deliveries produced here.
 *
 * Outcome objects are deep-frozen before delivery: no transport can
 * alter a certified outcome.
 */
import { deepFreeze, projectStamp } from "../../dist/src/transport.js";

/** Deep-freezes a value (shared with the runtime transport layer). */
export { deepFreeze };

/** Minimal user-facing projection of a certificate (spec UX §4). */
export { projectStamp };

/** Creates a MANUAL-mode transport adapter. */
export function createManualTransport({ id = "manual-transport" } = {}) {
  const captures = [];
  return {
    id,
    mode: "MANUAL",
    capabilities: {
      supportedModes: ["MANUAL"],
      autoCapture: { input: false, output: false },
      integrationFree: true,
    },
    /** Receives the person's natural-language message. */
    deliver(humanRequest) {
      const receivedAt = new Date().toISOString();
      captures.push({ direction: "input", at: receivedAt, summary: humanRequest.message });
      return { humanRequest, receivedAt, transportId: id, mode: "MANUAL" };
    },
    /** Delivers the certified outcome; mutates nothing, exposes frozen state. */
    deliverOutcome(outcome, stamp) {
      const deliveredAt = new Date().toISOString();
      const frozen = deepFreeze(outcome);
      captures.push({
        direction: "output",
        at: deliveredAt,
        summary: outcome.kind === "result" ? outcome.certificate.trustStatus : outcome.kind,
      });
      return {
        transportId: id,
        mode: "MANUAL",
        deliveredAt,
        outcome: frozen,
        ...(stamp ? { stamp } : {}),
      };
    },
    captures,
  };
}

/**
 * Runs one end-to-end loop through a manual transport:
 * human input → engine → certified outcome → frozen delivery.
 */
export async function runManualLoop({ engine, transport, message }) {
  const ingress = transport.deliver({ message });
  const outcome = await engine.process(ingress.humanRequest);
  const stamp = outcome.kind === "result" ? projectStamp(outcome.certificate) : undefined;
  const delivery = transport.deliverOutcome(outcome, stamp);
  return { ingress, delivery };
}
