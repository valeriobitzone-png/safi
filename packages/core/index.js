/**
 * Structural package boundary: the existing v0.1 core, unchanged.
 *
 * This package re-exports the compiled core from the repository root
 * (`npm run build` produces dist/). It exists so that adapters and demos
 * depend on a named package boundary instead of reaching into root paths.
 *
 * The core must remain free of any provider, browser, search engine,
 * API or knowledge-base dependency (Phase 4 acceptance criterion).
 */
export * from "../../dist/src/index.js";
