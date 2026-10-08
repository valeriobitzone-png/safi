/**
 * Source verifier — OUTSIDE the core.
 *
 * Verifies factual claims against external sources. Adapter-based:
 * the core knows nothing about browsers, search engines, APIs or
 * knowledge bases. This implementation:
 *
 *  - queries Wikipedia's keyless search API (no credentials) by default;
 *  - accepts an injected fetchFn for tests and alternative sources;
 *  - returns ONLY VerificationResult objects.
 *
 * A second LLM alone is NOT sufficient to turn a claim into VERIFIED:
 * this verifier requires corroborating external sources.
 */

const DEFAULTS = {
  endpoint: "https://it.wikipedia.org/w/api.php",
  minSources: 1,
  minTermLength: 4,
  requestTimeoutMs: 8000,
};

function termsFrom(claim) {
  return claim
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= DEFAULTS.minTermLength)
    .filter((t) => !["questa", "quello", "nella", "delle", "perché", "come", "cosa"].includes(t));
}

/**
 * Builds the search query from the claim: the longest meaningful terms.
 */
export function buildQuery(claim) {
  const terms = termsFrom(claim);
  terms.sort((a, b) => b.length - a.length);
  return terms.slice(0, 6).join(" ");
}

/**
 * A source corroborates a claim when at least two meaningful terms of
 * the claim appear in the source snippet.
 */
export function corroborates(claim, snippet) {
  const terms = termsFrom(claim);
  if (terms.length === 0) return false;
  const hay = snippet.toLowerCase();
  const hits = terms.filter((t) => hay.includes(t)).length;
  return hits >= Math.min(2, terms.length);
}

/** Extracts numeric figures from text. */
export function extractFigures(text) {
  return [...String(text).matchAll(/\d+/g)].map((m) => Number(m[0]));
}

/**
 * A source contradicts a claim when the source states a figure that the
 * claim does not contain. Direct contradiction is FAIL material; mere
 * lack of corroboration stays INCONCLUSIVE (uncertainty, not failure).
 */
export function contradicts(claim, snippet) {
  const claimFigures = extractFigures(claim);
  if (claimFigures.length === 0) return false;
  const sourceFigures = extractFigures(snippet);
  return sourceFigures.some((s) => !claimFigures.some((c) => c === s));
}

async function fetchWithTimeout(fetchFn, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Source verifier factory.
 *
 * @param {object} options
 * @param {string} options.checkId             verification check id
 * @param {string} options.claim               the factual claim to verify
 * @param {typeof fetch} [options.fetchFn]     injectable fetch (tests / other sources)
 * @param {string} [options.endpoint]          MediaWiki API endpoint
 * @param {number} [options.minSources]        corroborating sources required for PASS
 */
export function createSourceVerifier(options = {}) {
  const config = { ...DEFAULTS, ...options };
  const {
    checkId = "sources",
    claim,
    fetchFn = globalThis.fetch,
  } = config;
  if (!claim || typeof claim !== "string") {
    throw new Error("createSourceVerifier requires the factual claim to verify");
  }

  return {
    checkId,
    async verify() {
      try {
        const query = buildQuery(claim);
        if (!query) {
          return {
            checkId,
            outcome: "INCONCLUSIVE",
            detail: "Nessun termine utile per cercare fonti sull'affermazione.",
            verifierId: "verifier-source",
          };
        }
        const url = `${config.endpoint}?${new URLSearchParams({
          action: "query",
          list: "search",
          srsearch: query,
          srlimit: "5",
          format: "json",
          origin: "*",
        })}`;
        const response = await fetchWithTimeout(fetchFn, url, config.requestTimeoutMs);
        if (!response.ok) {
          return {
            checkId,
            outcome: "INCONCLUSIVE",
            detail: `Fonti non raggiungibili (HTTP ${response.status}): impossibile confermare o smentire.`,
            verifierId: "verifier-source",
          };
        }
        const payload = await response.json();
        const hits = (payload?.query?.search ?? []).map((h) => ({
          title: h.title,
          snippet: String(h.snippet ?? "").replace(/<[^>]+>/g, ""),
        }));
        // Direct contradiction wins over corroboration: a source stating
        // a different figure makes the claim FAIL, not PASS.
        const contradiction = hits.find((h) => contradicts(claim, `${h.title}. ${h.snippet}`));
        if (contradiction) {
          return {
            checkId,
            outcome: "FAIL",
            detail: `La fonte "${contradiction.title}" contraddice la cifra dichiarata: affermazione non sostenibile.`,
            verifierId: "verifier-source",
            evidence: { query, contradictingSource: contradiction.title },
          };
        }
        const supporting = hits.filter((h) => corroborates(claim, `${h.title}. ${h.snippet}`));
        if (supporting.length >= config.minSources) {
          return {
            checkId,
            outcome: "PASS",
            detail: `Fonte esterna concordante: ${supporting.map((s) => s.title).join(", ")}.`,
            verifierId: "verifier-source",
            evidence: { query, sources: supporting.slice(0, config.minSources) },
          };
        }
        if (hits.length === 0) {
          return {
            checkId,
            outcome: "INCONCLUSIVE",
            detail: "Nessuna fonte trovata: evidenza insufficiente.",
            verifierId: "verifier-source",
          };
        }
        return {
          checkId,
          outcome: "INCONCLUSIVE",
          detail: `Fonti trovate ma non sufficientemente concordanti (${hits.length} esaminate): evidenza insufficiente.`,
          verifierId: "verifier-source",
          evidence: { query, examined: hits.slice(0, 3).map((h) => h.title) },
        };
      } catch (error) {
        // Network failures are uncertainty, never a PASS.
        return {
          checkId,
          outcome: "INCONCLUSIVE",
          detail: `Ricerca fonti non disponibile: ${error instanceof Error ? error.message : String(error)}`,
          verifierId: "verifier-source",
        };
      }
    },
  };
}
