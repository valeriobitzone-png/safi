/**
 * Provider registry — OUTSIDE the Core.
 *
 * The only thing a host needs to know about a provider is which hostnames it
 * is allowed to run on.  This module performs that one lookup and returns the
 * matching site adapter; it contains no DOM logic, no trust semantics and no
 * branch inside the controller.  The vertical slice, the permission ledger,
 * the observer lifecycle, the mutation guard, the projection contract and the
 * Manual fallback are the same code for every provider.
 *
 * An unknown host resolves to `null`: the host then installs nothing at all,
 * which is the strongest possible fail-closed outcome.
 */
import { ChatGPTSiteAdapter } from "./chatgpt-site-adapter.js";
import { GeminiSiteAdapter } from "./gemini-site-adapter.js";

/** provider id → { hosts, create } */
export const COMPANION_PROVIDERS = Object.freeze({
  chatgpt: Object.freeze({
    id: "chatgpt",
    hosts: Object.freeze(["chatgpt.com", "chat.openai.com"]),
    create: (context) => new ChatGPTSiteAdapter(context),
  }),
  gemini: Object.freeze({
    id: "gemini",
    hosts: Object.freeze(["gemini.google.com"]),
    create: (context) => new GeminiSiteAdapter(context),
  }),
});

export const COMPANION_PROVIDER_IDS = Object.freeze(Object.keys(COMPANION_PROVIDERS));

function normalizeHost(hostname) {
  return String(hostname ?? "").trim().toLowerCase();
}

/**
 * @param {string|{hostname?:string}} source current location or hostname
 * @param {{document?:Document, window?:Window, location?:Location}} context
 * @returns {import('./site-adapter.js').CompanionSiteAdapter|null}
 */
export function createAdapterForHost(source, context = {}) {
  const hostname = normalizeHost(
    typeof source === "string" ? source : source?.hostname ?? context?.location?.hostname ?? context?.document?.location?.hostname,
  );
  if (!hostname) return null;
  for (const provider of Object.values(COMPANION_PROVIDERS)) {
    if (provider.hosts.includes(hostname)) return provider.create(context);
  }
  return null;
}

/** The provider id for a host, or null. Useful for host messaging only. */
export function providerIdForHost(source) {
  const hostname = normalizeHost(
    typeof source === "string" ? source : source?.hostname ?? source?.location?.hostname,
  );
  for (const provider of Object.values(COMPANION_PROVIDERS)) {
    if (provider.hosts.includes(hostname)) return provider.id;
  }
  return null;
}
