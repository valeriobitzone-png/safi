/**
 * Safi UX Visual Spec v0.1 — reference Web Component.
 *
 * Zero dependencies, no framework, no build step. Load directly:
 *
 *   <script type="module" src="ui/safi-stamp.js"></script>
 *   <safi-stamp></safi-stamp>
 *
 * The component renders a frozen projection of a certificate/stamp and
 * holds no setter: no graphic component can modify a SafiCertificate,
 * a trust status or a semantic request (spec §9).
 */
import {
  projectForDisplay,
  projectSummary,
  projectDetails,
  microstateLabel,
  CONTEXT_ARIA_LABELS,
} from "./projection.js";

const LEVELS = { CLOSED: 0, SUMMARY: 1, DETAILS: 2 };

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: inline-block;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #1c2b24;
      --safi-radius: 14px;
    }
    button.safi-trigger {
      all: unset;
      display: inline-flex;
      align-items: center;
      gap: 0.45em;
      cursor: pointer;
      border-radius: 999px;
      padding: 0.35rem 0.7rem;
      min-height: 24px;
      min-width: 24px;
    }
    button.safi-trigger:focus-visible {
      outline: 2px solid #2e7d32;
      outline-offset: 2px;
    }
    .safi-dot {
      display: inline-block;
      line-height: 0;
      font-size: 1rem;
    }
    .safi-label {
      font-weight: 600;
      font-size: 0.9rem;
    }
    .safi-ratio {
      font-size: 0.8rem;
      color: #56665e;
    }
    .safi-panel {
      margin-top: 0.35rem;
      background: #ffffff;
      border: 1px solid #d9e2dc;
      border-radius: var(--safi-radius);
      box-shadow: 0 6px 18px rgba(28, 43, 36, 0.08);
      padding: 0.75rem 0.9rem;
      max-width: 26rem;
    }
    .safi-panel dl {
      margin: 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.3rem 0.9rem;
      font-size: 0.82rem;
    }
    .safi-panel dt {
      font-weight: 600;
      color: #56665e;
    }
    .safi-panel dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .safi-micro {
      display: inline-flex;
      align-items: center;
      gap: 0.4em;
      font-size: 0.85rem;
      color: #56665e;
      font-style: italic;
    }
    .safi-micro::before {
      content: "";
      width: 0.6em;
      height: 0.6em;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.55;
    }
    @media (prefers-reduced-motion: reduce) {
      .safi-panel { transition: none; }
    }
    .safi-dev {
      margin-top: 0.5rem;
      border-top: 1px dashed #d9e2dc;
      padding-top: 0.5rem;
      font-size: 0.78rem;
    }
    .safi-dev code {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    [hidden] { display: none !important; }
  </style>
  <button class="safi-trigger" part="trigger" aria-expanded="false">
    <span class="safi-dot" role="img"><span class="safi-glyph">●</span></span>
    <span class="safi-text" hidden>
      <span class="safi-label"></span>
      <span class="safi-ratio"></span>
    </span>
  </button>
  <div class="safi-micro" aria-live="polite" hidden></div>
  <div class="safi-panel" hidden>
    <dl></dl>
    <div class="safi-dev" hidden></div>
  </div>
`;

export class SafiStampElement extends HTMLElement {
  static get observedAttributes() {
    return ["context", "developer-mode", "show-label"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this._level = LEVELS.CLOSED;
    this._source = null;
    this._micro = null;

    this._trigger = this.shadowRoot.querySelector(".safi-trigger");
    this._dot = this.shadowRoot.querySelector(".safi-dot");
    this._glyph = this.shadowRoot.querySelector(".safi-glyph");
    this._text = this.shadowRoot.querySelector(".safi-text");
    this._label = this.shadowRoot.querySelector(".safi-label");
    this._ratio = this.shadowRoot.querySelector(".safi-ratio");
    this._microEl = this.shadowRoot.querySelector(".safi-micro");
    this._panel = this.shadowRoot.querySelector(".safi-panel");
    this._dl = this.shadowRoot.querySelector("dl");
    this._dev = this.shadowRoot.querySelector(".safi-dev");

    this._trigger.addEventListener("click", () => this._advance());
    this._trigger.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this._level !== LEVELS.CLOSED) {
        event.stopPropagation();
        this._level = LEVELS.CLOSED;
        this._render();
      }
    });
  }

  /**
   * Sets the certificate/stamp to project. The source is never mutated:
   * a frozen projection is rendered.
   */
  set source(value) {
    this._source = value; // kept read-only; projections freeze their output
    this._render();
  }

  /** Presentation-only pipeline state (e.g. "TRANSLATING"). */
  set pipelineState(state) {
    this._micro = microstateLabel(state);
    this._render();
  }

  _advance() {
    if (!this._source) return;
    this._level = this._level === LEVELS.DETAILS ? LEVELS.CLOSED : this._level + 1;
    this._render();
  }

  _context() {
    const value = (this.getAttribute("context") || "EMBEDDED").toUpperCase();
    return CONTEXT_ARIA_LABELS[value] ? value : "EMBEDDED";
  }

  _render() {
    const context = this._context();
    const devMode = this.hasAttribute("developer-mode");
    const showLabel = this.hasAttribute("show-label") || this._level >= LEVELS.SUMMARY;

    if (!this._source) {
      this._trigger.setAttribute("aria-label", "Safi: nessun certificato disponibile");
      this._glyph.textContent = "·";
      this._text.hidden = true;
      this._panel.hidden = true;
      return;
    }

    let summary;
    try {
      summary = projectSummary(this._source);
    } catch {
      this._trigger.setAttribute("aria-label", "Safi: sorgente non valida");
      return;
    }
    const display = projectForDisplay(this._source);

    this._glyph.textContent = summary.glyph;
    this._glyph.style.color = summary.color;
    this._label.textContent = summary.labelLong;
    this._ratio.textContent = `Controlli superati: ${summary.checksRatio}`;
    this._text.hidden = !showLabel;

    const contextLabel = CONTEXT_ARIA_LABELS[context];
    this._trigger.setAttribute(
      "aria-label",
      `${contextLabel}. ${summary.labelLong}. Controlli superati ${summary.checksRatio}. Premere per dettagli.`,
    );
    this._trigger.setAttribute("aria-expanded", String(this._level >= LEVELS.SUMMARY));

    if (this._micro) {
      this._microEl.hidden = false;
      this._microEl.textContent = this._micro;
    } else {
      this._microEl.hidden = true;
      this._microEl.textContent = "";
    }

    if (this._level >= LEVELS.DETAILS) {
      const details = projectDetails(this._source);
      this._dl.innerHTML = "";
      for (const row of details) {
        const dt = document.createElement("dt");
        dt.textContent = row.term;
        const dd = document.createElement("dd");
        dd.textContent = row.description;
        this._dl.append(dt, dd);
      }
      this._panel.hidden = false;
      if (devMode) {
        this._dev.hidden = false;
        this._dev.innerHTML = "";
        const title = document.createElement("strong");
        title.textContent = "Developer mode (read-only)";
        const pre = document.createElement("code");
        pre.textContent = this._developerDump();
        this._dev.append(title, document.createElement("br"), pre);
      } else {
        this._dev.hidden = true;
        this._dev.innerHTML = "";
      }
    } else {
      this._panel.hidden = true;
      this._dl.innerHTML = "";
      this._dev.hidden = true;
    }
  }

  _developerDump() {
    const raw = this._developerSource;
    if (!raw) return "Nessun contesto developer fornito (set developerSource).";
    const keys = ["humanRequest", "intentFrame", "semantic", "safiRequest"];
    return keys
      .filter((k) => raw[k])
      .map((k) => `${k}:\n${JSON.stringify(raw[k], null, 2)}`)
      .join("\n\n");
  }

  /**
   * Read-only developer context: HumanRequest, IntentFrame,
   * SemanticRepresentation, SafiRequest. Rendered as text; never parsed
   * back into protocol objects.
   */
  set developerSource(value) {
    this._developerSource = value;
    this._render();
  }
}

if (!customElements.get("safi-stamp")) {
  customElements.define("safi-stamp", SafiStampElement);
}
