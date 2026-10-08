import type { HumanRequest, HumanToAITranslator, IntentFrame, SemanticRepresentation } from "./types.js";
/**
 * Human→AI Translation (RFC 0001).
 *
 * The translator preserves the person's purpose and produces a
 * provider-neutral semantic representation. It is NOT a prompt improver:
 * no provider, format, model or prompt style may appear here.
 *
 * The Provider Adapter remains the only component allowed to turn a
 * semantic representation into a provider-specific prompt.
 */
/**
 * Terms that must never appear in a semantic representation.
 * Provider-specific wording belongs to the Provider Adapter only.
 */
export declare const DEFAULT_FORBIDDEN_PROVIDER_TERMS: readonly string[];
/** Deterministic default translator shipped with the Core. */
export declare class DefaultHumanToAITranslator implements HumanToAITranslator {
    readonly id = "default-translator";
    translate(input: {
        human: HumanRequest;
        frame: IntentFrame;
    }): SemanticRepresentation;
}
/**
 * Plain-language translator: normalizes informal phrasing into a neutral
 * task statement WITHOUT changing the person's purpose. Demonstrates the
 * required property: informal human phrasing in, same purpose out.
 */
export declare class PlainLanguageTranslator implements HumanToAITranslator {
    readonly id = "plain-language-translator";
    translate(input: {
        human: HumanRequest;
        frame: IntentFrame;
    }): SemanticRepresentation;
}
/** Structural guarantee: a representation must never mention providers. */
export declare function assertProviderNeutral(representation: SemanticRepresentation, forbidden: readonly string[]): void;
//# sourceMappingURL=translate.d.ts.map