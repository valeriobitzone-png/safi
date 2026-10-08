/**
 * The five Phase 4 demo scenarios, shared by CLI, HTTP API and web page.
 *
 * Every scenario runs the REAL core pipeline (intent interpretation,
 * Human→AI translation, provider adapter, verifiers, bounded correction,
 * certification) through a MANUAL transport. All integrations stay
 * outside the core.
 */
import { SafiEngine } from "../../dist/src/engine.js";
import { PlainLanguageTranslator } from "../../dist/src/translate.js";
import { createManualTransport, runManualLoop } from "../transport-manual/index.js";
import { RetryOnceStrategy, ScriptedDemoProvider } from "../adapter-provider-demo/index.js";
import { createCalculationVerifier } from "../verifier-calculation/index.js";
import { createSourceVerifier } from "../verifier-source/index.js";
import { createDemoInterpreter } from "./interpreter.js";
import { sha256Text } from "./hashing.js";

export { sha256Text };

const BLACK_HOLES_TASK =
  "spiegami in modo semplice cosa sono i buchi neri, senza dare per scontata la fisica";

const DEMO_CONSTRAINTS = { depth: "beginner", language: "italian", tone: "reassuring" };

/** Demo 1 — colloquial Human→AI translation, intent preserved. */
export function demo1Translation() {
  const humanMessage =
    "Oh, mi spieghi sta cosa dei buchi neri semplice semplice?\nNon sono bravo con la fisica.";
  let providerRequest;
  const provider = {
    id: "demo-translation-provider",
    execute: async (request) => {
      providerRequest = request;
      return {
        text:
          "Immagina lo spazio come un lenzuolo teso. Un buco nero è una sfera così pesante che il lenzuolo si incurva moltissimo: tutto ciò che passa vicino cade dentro, perfino la luce. Non è un buco 'fatto di nulla': è materia concentrata in uno spazio piccolissimo.",
        provider: "demo-translation-provider",
        attempt: request.attempt,
      };
    },
  };
  const engine = new SafiEngine({
    provider,
    verifiers: [
      {
        checkId: "coherence",
        verify: async () => ({
          checkId: "coherence",
          outcome: "PASS",
          detail: "La risposta affronta la richiesta dichiarata.",
          verifierId: "coherence-demo",
        }),
      },
    ],
    policy: { id: "demo-translation", scope: { requiredChecks: ["coherence"] }, maxCorrectionAttempts: 0 },
    interpreter: createDemoInterpreter(BLACK_HOLES_TASK, DEMO_CONSTRAINTS),
    translator: new PlainLanguageTranslator(),
  });
  const run = () => runManualLoop({ engine, transport: createManualTransport(), message: humanMessage });

  return {
    humanMessage,
    expectedTrust: "VERIFIED",
    run: async () => {
      const result = await run();
      return {
        ...result,
        providerRequest,
        steps: {
          humanRequest: { message: humanMessage },
          intentFrame: providerRequest
            ? {
                goal: "answer the person's request",
                task: providerRequest.task,
                constraints: providerRequest.constraints,
                needsClarification: false,
              }
            : undefined,
          semantic: providerRequest?.semantic,
          safiRequest: providerRequest,
        },
      };
    },
  };
}

/** Demo 2 — deterministic arithmetic verification (VERIFIED or FAILED). */
export function demo2Calculation() {
  const humanMessage = "Quanto fa 237 × 14?";
  const provider = new ScriptedDemoProvider({
    answers: { "calcola 237 × 14 e dai solo il risultato": "Il risultato di 237 × 14 è 3318." },
  });
  const engine = new SafiEngine({
    provider,
    verifiers: [createCalculationVerifier({ checkId: "calculation" })],
    policy: {
      id: "demo-calculation",
      scope: { requiredChecks: ["calculation"] },
      maxCorrectionAttempts: 0,
    },
    interpreter: createDemoInterpreter("calcola 237 × 14 e dai solo il risultato", {
      language: "italian",
    }),
    translator: new PlainLanguageTranslator(),
  });
  const run = () => runManualLoop({ engine, transport: createManualTransport(), message: humanMessage });
  return { humanMessage, expectedTrust: "VERIFIED", run };
}

/** Demo 3 — verified error, bounded correction, history of both attempts. */
export function demo3Correction() {
  const humanMessage = "Quanto fa 237 × 14? (demo con errore iniziale)";
  const task = "calcola 237 × 14 e dai solo il risultato";
  const provider = new ScriptedDemoProvider({
    answers: { [task]: "Il risultato di 237 × 14 è 3318." },
    wrongFirstFor: [task],
  });
  const engine = new SafiEngine({
    provider,
    verifiers: [createCalculationVerifier({ checkId: "calculation" })],
    policy: {
      id: "demo-correction",
      scope: { requiredChecks: ["calculation"] },
      maxCorrectionAttempts: 1,
    },
    correctionStrategy: new RetryOnceStrategy(),
    interpreter: createDemoInterpreter(task, { language: "italian" }),
    translator: new PlainLanguageTranslator(),
  });
  const run = () => runManualLoop({ engine, transport: createManualTransport(), message: humanMessage });
  return { humanMessage, expectedTrust: "VERIFIED", run };
}

/** Demo 4 — insufficient evidence stays UNCERTAIN, never forced to VERIFIED. */
export function demo4Uncertainty() {
  const humanMessage =
    "Quanti abitanti aveva il borgo di Vallarsa nel 1361 secondo i registri catastali?";
  const task = "rispondi con i dati richiesti se disponibili, altrimenti dichiara l'incertezza";
  const provider = {
    id: "demo-uncertainty-provider",
    execute: async (request) => ({
      text:
        "Non dispongo di una fonte affidabile sui registri catastali di Vallarsa del 1361: qualsiasi cifra sarebbe un'invenzione. La risposta onesta è che non posso confermarla.",
      provider: "demo-uncertainty-provider",
      attempt: request.attempt,
    }),
  };
  // No source corroborates such an obscure 1361 record: the real source
  // verifier (or its injected double) yields insufficient evidence.
  const sourceVerifier = createSourceVerifier({
    checkId: "sources",
    claim: "registri catastali abitanti Vallarsa 1361",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ query: { search: [] } }),
    }),
  });
  const engine = new SafiEngine({
    provider,
    verifiers: [sourceVerifier],
    policy: { id: "demo-uncertainty", scope: { requiredChecks: ["sources"] }, maxCorrectionAttempts: 0 },
    interpreter: createDemoInterpreter(task, { language: "italian" }),
    translator: new PlainLanguageTranslator(),
  });
  const run = () => runManualLoop({ engine, transport: createManualTransport(), message: humanMessage });
  return { humanMessage, expectedTrust: "UNCERTAIN", run };
}

/**
 * Demo 4b — a really FAILED run: the provider insists on an unverifiable
 * claim, correction declines, and Safi certifies FAILED honestly.
 */
export function demo4bFailed() {
  const humanMessage = "Quanti abitanti aveva il borgo di Vallarsa nel 1361? (demo fallimento)";
  const task = "rispondi con i dati richiesti se disponibili, altrimenti dichiara l'incertezza";
  const provider = {
    id: "demo-failed-provider",
    execute: async (request) => ({
      text: "Secondo i registri catastali, Vallarsa aveva esattamente 342 abitanti nel 1361.",
      provider: "demo-failed-provider",
      attempt: request.attempt,
    }),
  };
  const sourceVerifier = createSourceVerifier({
    checkId: "sources",
    claim: "registri catastali abitanti Vallarsa 1361 esattamente 342 abitanti",
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        query: {
          search: [
            {
              title: "Vallarsa",
              snippet:
                "Secondo le stime storiche, nel 1361 Vallarsa contava 210 abitanti: i registri catastali dell'epoca non riportano cifre esatte.",
            },
          ],
        },
      }),
    }),
  });
  const engine = new SafiEngine({
    provider,
    verifiers: [sourceVerifier],
    policy: { id: "demo-failed", scope: { requiredChecks: ["sources"] }, maxCorrectionAttempts: 0 },
    interpreter: createDemoInterpreter(task, { language: "italian" }),
    translator: new PlainLanguageTranslator(),
  });
  const run = () => runManualLoop({ engine, transport: createManualTransport(), message: humanMessage });
  return { humanMessage, expectedTrust: "FAILED", run };
}

/** Demo 5 is the MANUAL transport itself; see demo-web/server.js and index.html. */
export const demo5Manual = { note: " MANUAL transport demo: see packages/demo-web/server.js" };
