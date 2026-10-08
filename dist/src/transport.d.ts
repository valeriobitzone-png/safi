import type { HumanRequest, SafiCertificate, SafiOutcome, SafiStamp, TransportAdapter, TransportCapability, TransportDelivery, TransportIngress, TransportMode } from "./types.js";
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
export declare function deepFreeze<T>(value: T): Readonly<T>;
/** Projects a certificate into the minimal user-facing Safi Stamp. */
export declare function projectStamp(certificate: SafiCertificate): SafiStamp;
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
export declare function safiLoop(options: SafiLoopOptions): Promise<SafiLoopResult>;
/** A captured event on either side of the loop. */
export interface TransportCapture {
    readonly direction: "input" | "output";
    readonly at: string;
    readonly summary: string;
}
/**
 * EMBEDDED: Safi runs inside the host application; input and output are
 * captured automatically through the host's own channels.
 */
export declare class EmbeddedTransport implements TransportAdapter {
    readonly id: string;
    readonly mode: TransportMode;
    readonly capabilities: TransportCapability;
    readonly captures: TransportCapture[];
    constructor(id?: string);
    deliver(humanRequest: HumanRequest): TransportIngress;
    deliverOutcome(outcome: Readonly<SafiOutcome>, stamp: SafiStamp | undefined): TransportDelivery;
}
/**
 * COMPANION: a browser extension, desktop overlay or host adapter that
 * intercepts conversations with external AI systems where technically and
 * legally permitted. Legality is declared by the deployer; Safi only
 * records the declaration.
 */
export declare class CompanionTransport implements TransportAdapter {
    readonly id: string;
    readonly mode: TransportMode;
    readonly capabilities: TransportCapability;
    readonly captures: TransportCapture[];
    constructor(id?: string, legalityBasis?: string);
    deliver(humanRequest: HumanRequest): TransportIngress;
    deliverOutcome(outcome: Readonly<SafiOutcome>, stamp: SafiStamp | undefined): TransportDelivery;
}
/**
 * MANUAL: universal copy/paste fallback. No integration, no capture:
 * a person pastes text in and receives the certified outcome out.
 */
export declare class ManualTransport implements TransportAdapter {
    readonly id: string;
    readonly mode: TransportMode;
    readonly capabilities: TransportCapability;
    readonly captures: TransportCapture[];
    constructor(id?: string);
    deliver(humanRequest: HumanRequest): TransportIngress;
    deliverOutcome(outcome: Readonly<SafiOutcome>, stamp: SafiStamp | undefined): TransportDelivery;
}
//# sourceMappingURL=transport.d.ts.map