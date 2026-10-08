import type {
  HumanRequest,
  SafiCertificate,
  SafiOutcome,
  SafiStamp,
  TransportAdapter,
  TransportCapability,
  TransportDelivery,
  TransportIngress,
  TransportMode,
} from "./types.js";
import type { SafiEngine } from "./engine.js";

/**
 * Transport layer (RFC 0001).
 *
 * Transports move human input in and certified outcomes out. They never
 * alter certified outcomes, certificates, hashes or trust states:
 * outcomes are handed to transports deep-frozen, so any mutation attempt
 * throws in strict mode.
 */

/** Recursively freezes a value. Frozen objects throw on mutation. */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value as Readonly<T>;
}

/** Projects a certificate into the minimal user-facing Safi Stamp. */
export function projectStamp(certificate: SafiCertificate): SafiStamp {
  const stamp: SafiStamp = {
    schema: "safi-stamp/v0.1",
    trustStatus: certificate.trustStatus,
    createdAt: certificate.createdAt,
    policyId: certificate.policyId,
    responseSha256: certificate.responseSha256,
    requiredChecks: [...certificate.verificationScope.requiredChecks],
    attempt: certificate.attempt,
    maxAttempts: certificate.maxAttempts,
    provider: certificate.provider,
  };
  return deepFreeze(stamp);
}

export interface SafiLoopOptions {
  engine: SafiEngine;
  transport: TransportAdapter;
  /** Raw human message. Ignored when humanRequest is provided. */
  message?: string;
  /** Pre-built human request; takes precedence over message. */
  humanRequest?: HumanRequest;
  now?: () => Date;
}

export interface SafiLoopResult {
  readonly ingress: TransportIngress;
  readonly delivery: TransportDelivery;
}

/**
 * One end-to-end Safi loop through a transport:
 *
 *   Human natural input → Transport → Intent Interpreter →
 *   Human-to-AI Translator → SafiRequest → Provider Adapter → AI →
 *   CandidateResponse → Humanizer → Verifiers → bounded correction →
 *   SafiCertificate → Transport → Human + Safi Stamp
 */
export async function safiLoop(options: SafiLoopOptions): Promise<SafiLoopResult> {
  const { engine, transport } = options;
  const now = options.now ?? (() => new Date());

  const humanRequest: HumanRequest =
    options.humanRequest ?? { message: options.message ?? "" };
  const ingress = await transport.deliver(humanRequest);
  if (ingress.mode !== transport.mode) {
    return Promise.reject(
      new Error(`Transport mode mismatch: declared ${transport.mode}, ingress ${ingress.mode}`),
    );
  }

  const outcome = await engine.process(ingress.humanRequest);

  const stamp = outcome.kind === "result" ? projectStamp(outcome.certificate) : undefined;
  const frozenOutcome = deepFreeze(outcome);
  const delivery = await transport.deliverOutcome(frozenOutcome, stamp);

  if (delivery.mode !== transport.mode) {
    return Promise.reject(
      new Error(`Transport mode mismatch: declared ${transport.mode}, delivery ${delivery.mode}`),
    );
  }
  return { ingress, delivery };
}

/* ------------------------------------------------------------------ */
/* Reference fake transports (test/demo doubles, zero dependencies).   */
/* ------------------------------------------------------------------ */

/** A captured event on either side of the loop. */
export interface TransportCapture {
  readonly direction: "input" | "output";
  readonly at: string;
  readonly summary: string;
}

function baseCapabilities(mode: TransportMode, autoCapture: boolean): TransportCapability {
  return {
    supportedModes: [mode],
    autoCapture: { input: autoCapture, output: autoCapture },
    integrationFree: mode === "MANUAL",
  };
}

/**
 * EMBEDDED: Safi runs inside the host application; input and output are
 * captured automatically through the host's own channels.
 */
export class EmbeddedTransport implements TransportAdapter {
  readonly id: string;
  readonly mode: TransportMode = "EMBEDDED";
  readonly capabilities: TransportCapability = baseCapabilities("EMBEDDED", true);
  readonly captures: TransportCapture[] = [];

  constructor(id = "embedded-transport") {
    this.id = id;
  }

  deliver(humanRequest: HumanRequest): TransportIngress {
    const receivedAt = new Date().toISOString();
    this.captures.push({ direction: "input", at: receivedAt, summary: humanRequest.message });
    return { humanRequest, receivedAt, transportId: this.id, mode: this.mode };
  }

  deliverOutcome(outcome: Readonly<SafiOutcome>, stamp: SafiStamp | undefined): TransportDelivery {
    const deliveredAt = new Date().toISOString();
    this.captures.push({
      direction: "output",
      at: deliveredAt,
      summary: outcome.kind === "result" ? outcome.certificate.trustStatus : outcome.kind,
    });
    return { transportId: this.id, mode: this.mode, deliveredAt, ...(stamp ? { stamp } : {}), outcome };
  }
}

/**
 * COMPANION: a browser extension, desktop overlay or host adapter that
 * intercepts conversations with external AI systems where technically and
 * legally permitted. Legality is declared by the deployer; Safi only
 * records the declaration.
 */
export class CompanionTransport implements TransportAdapter {
  readonly id: string;
  readonly mode: TransportMode = "COMPANION";
  readonly capabilities: TransportCapability;
  readonly captures: TransportCapture[] = [];

  constructor(id = "companion-transport", legalityBasis = "declared by deployer") {
    this.id = id;
    this.capabilities = {
      ...baseCapabilities("COMPANION", true),
      interceptionLegality: { declared: true, basis: legalityBasis },
    };
  }

  deliver(humanRequest: HumanRequest): TransportIngress {
    const receivedAt = new Date().toISOString();
    this.captures.push({ direction: "input", at: receivedAt, summary: humanRequest.message });
    return { humanRequest, receivedAt, transportId: this.id, mode: this.mode };
  }

  deliverOutcome(outcome: Readonly<SafiOutcome>, stamp: SafiStamp | undefined): TransportDelivery {
    const deliveredAt = new Date().toISOString();
    this.captures.push({
      direction: "output",
      at: deliveredAt,
      summary: outcome.kind === "result" ? outcome.certificate.trustStatus : outcome.kind,
    });
    return { transportId: this.id, mode: this.mode, deliveredAt, ...(stamp ? { stamp } : {}), outcome };
  }
}

/**
 * MANUAL: universal copy/paste fallback. No integration, no capture:
 * a person pastes text in and receives the certified outcome out.
 */
export class ManualTransport implements TransportAdapter {
  readonly id: string;
  readonly mode: TransportMode = "MANUAL";
  readonly capabilities: TransportCapability = baseCapabilities("MANUAL", false);
  readonly captures: TransportCapture[] = [];

  constructor(id = "manual-transport") {
    this.id = id;
  }

  deliver(humanRequest: HumanRequest): TransportIngress {
    const receivedAt = new Date().toISOString();
    this.captures.push({ direction: "input", at: receivedAt, summary: humanRequest.message });
    return { humanRequest, receivedAt, transportId: this.id, mode: this.mode };
  }

  deliverOutcome(outcome: Readonly<SafiOutcome>, stamp: SafiStamp | undefined): TransportDelivery {
    const deliveredAt = new Date().toISOString();
    this.captures.push({
      direction: "output",
      at: deliveredAt,
      summary: outcome.kind === "result" ? outcome.certificate.trustStatus : outcome.kind,
    });
    return { transportId: this.id, mode: this.mode, deliveredAt, ...(stamp ? { stamp } : {}), outcome };
  }
}
