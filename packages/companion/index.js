/**
 * Safi Companion package entry point.
 * Provider-neutral contracts plus one adapter per supported site; the Core
 * remains unchanged and the controller stays provider-neutral.
 */
export * from "./site-adapter.js";
export * from "./chatgpt-site-adapter.js";
export * from "./gemini-site-adapter.js";
export * from "./adapter-registry.js";
export * from "./vertical-slice.js";
export * from "./motion-layer.js";
export * from "./scripted-adapter.js";
export * from "./browser-bridge.js";
