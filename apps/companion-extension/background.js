/**
 * Minimal MV3 service worker.
 *
 * It performs no DOM work and no network work: it exists so the real MV3
 * lifecycle is observable on the dedicated live host (a service worker target
 * appears only when the unpacked extension is actually loaded), and so the
 * browser keeps the extension installed across page loads.
 */
const INSTALL_MARKER = "safi-companion-mv3/phase8-live";

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[Safi Companion] installed (${details.reason})`);
});

chrome.runtime.onStartup?.addListener(() => {
  console.log("[Safi Companion] browser started");
});

console.log(`[Safi Companion] service worker alive — ${INSTALL_MARKER}`);
