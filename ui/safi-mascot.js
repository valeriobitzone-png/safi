/**
 * Safi — il guardiano della chiarezza. One character, every state.
 *
 * BOUND BY DESIGN_FREEZE.md and SAFI_UI_INTERACTION_CONTRACT.md: this
 * module IMPLEMENTS the approved golden reference (safi-mascot character sheet),
 * it never redesigns it. Canonical anatomy (contract §2):
 *
 *   - head ≈ 70% of the silhouette height, body ≈ 30%;
 *   - sheriff star centered under the head, on the chest;
 *   - big, simple, sweet eyes: filled pupil + exactly one highlight;
 *   - small soft arms, no prominent legs;
 *   - sweetness comes from curvature, brows, tilt, cheeks, mouth.
 *
 * The trust state NEVER repaints the pearl body (contract §8): it is
 * communicated by glow, luminous rim, cheeks, sign and expression.
 *
 * The same markup drives the widget (state switched via [data-state] +
 * CSS) and the static official assets (gen-mascot-assets / gen-icon use
 * SAFI_MASCOT_LAYOUT). Expressivity stays legible from 22 px to 1024 px.
 */

/** All renderable Safi states (presentation names). */
export const SAFI_MASCOT_STATES = [
  "idle",
  "understanding",
  "translating",
  "verifying",
  "verified",
  "uncertain",
  "failed",
];

/** Approved state palette (contract §3; board "Colori di stato"). */
export const SAFI_MASCOT_COLORS = {
  neutral: "#DCEBFF",
  verified: "#86F7C1",
  uncertain: "#FFE08A",
  failed: "#FF8B8B",
};

/* ---------- tiny path helpers (all geometry is computed) ---------- */

const rad = (deg) => (deg * Math.PI) / 180;
const P = (cx, cy, r, deg) => [cx + r * Math.cos(rad(deg)), cy + r * Math.sin(rad(deg))];
const f = (n) => Number(n.toFixed(2));

/** Open arc from a0 to a1 degrees (y-down screen space), as a stroke path. */
function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = P(cx, cy, r, a0);
  const [x1, y1] = P(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M ${f(x0)} ${f(y0)} A ${f(r)} ${f(r)} 0 ${large} ${sweep} ${f(x1)} ${f(y1)}`;
}

/** Five-point star polygon path (point up). */
export function starPath(cx, cy, rOut, rIn, startDeg = -90) {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? rOut : rIn;
    pts.push(P(cx, cy, r, startDeg + i * 36));
  }
  return `M ${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L ")} Z`;
}

/* ---------- canonical layout (120×120 canvas, character sheet) ----------
   Head 72/105 ≈ 69% of the silhouette; star on the chest at the neck;
   big round eyes; body is a small soft bean. */
/* ---------- FACE MASTER (fix 6.3 §2) ----------
   One base geometry; every state only moves these parameters. The IDLE
   eyes are two luminous round pupils (fix 6.3 §1: never droopy arcs,
   never outer-corners-down); the smile is a wide, clearly upturned
   curve (ends visibly HIGHER than the center). No mood is ever drawn
   with corners falling. */
const FACE = {
  eye: { y: 46, dx: 14, r: 5.1 },       // round, luminous, big
  brow: { lift: 8.5, r: 5.4, w: 1.8 },  // attentive brows (gentle arcs)
  smile: { w: 17, lift: 5.2 },          // width + end lift (upturned ∪)
  smallSmile: { w: 9.4, lift: 2.3 },    // uncertain: tiny doubtful smile
  pursed: { w: 12.4, dip: 3.1 },        // failed: short pursed mouth
  cheek: { y: 56.5, dx: 21, rx: 5.6, ry: 3.6 },
};

const HEAD = { cx: 60, cy: 43, r: 36 };            // y 7..79
const BODY = { cx: 60, cy: 95, rx: 21, ry: 17 };   // y 78..112
const EYE = FACE.eye;
const MOUTH = { x: 60, y: 60.5 };                  // small smile anchor
const CHEEK = FACE.cheek;
const STAR = { cx: 60, cy: 84, rOut: 8.5, rIn: 3.6 }; // chest, centered
const SIGN = { x: 84, y: 14, s: 26 };              // trust sign (top-right)
const ARM = { y: 92, dx: 20 };                     // soft side arms

/** Shared geometry for the deterministic asset/icon generators. */
export const SAFI_MASCOT_LAYOUT = { HEAD, BODY, EYE, MOUTH, CHEEK, STAR, SIGN, ARM };

/** Body silhouette: big head blending into a small bean body, one path. */
function bodyPath() {
  const { cx, cy, r } = HEAD;
  const top = cy - r;
  const neckY = cy + r * 0.66;
  const bodyTop = BODY.cy - BODY.ry + 3;
  const bodyLeft = cx - BODY.rx;
  const bodyRight = cx + BODY.rx;
  const bodyBottom = BODY.cy + BODY.ry + 2;
  return [
    `M ${f(cx)} ${f(top)}`,
    `C ${f(cx + r * 0.55)} ${f(top)} ${f(cx + r)} ${f(cy - r * 0.5)} ${f(cx + r)} ${f(cy)}`,
    `C ${f(cx + r)} ${f(cy + r * 0.52)} ${f(cx + r * 0.58)} ${f(neckY - 3)} ${f(cx + 12)} ${f(bodyTop)}`,
    `C ${f(cx + 16)} ${f(bodyTop - 3)} ${f(bodyRight)} ${f(bodyTop + 3)} ${f(bodyRight)} ${f(BODY.cy)}`,
    `C ${f(bodyRight)} ${f(bodyBottom - 7)} ${f(cx + 12)} ${f(bodyBottom)} ${f(cx)} ${f(bodyBottom)}`,
    `C ${f(cx - 12)} ${f(bodyBottom)} ${f(bodyLeft)} ${f(bodyBottom - 7)} ${f(bodyLeft)} ${f(BODY.cy)}`,
    `C ${f(bodyLeft)} ${f(bodyTop + 3)} ${f(cx - 16)} ${f(bodyTop - 3)} ${f(cx - 12)} ${f(bodyTop)}`,
    `C ${f(cx - r * 0.58)} ${f(neckY - 3)} ${f(cx - r)} ${f(cy + r * 0.52)} ${f(cx - r)} ${f(cy)}`,
    `C ${f(cx - r)} ${f(cy - r * 0.5)} ${f(cx - r * 0.55)} ${f(top)} ${f(cx)} ${f(top)} Z`,
  ].join(" ");
}

function dotEye(x, y, r, cls) {
  return `<g class="${cls}"><circle cx="${x}" cy="${y}" r="${r}" fill="#2c3e50"/><circle cx="${f(x + r * 0.34)}" cy="${f(y - r * 0.4)}" r="${f(r * 0.32)}" fill="#ffffff" opacity="0.92"/></g>`;
}

/** Face-master primitives (all states derive from these). */
function smilePath(cx, cy, w, lift) {
  return `M ${f(cx - w / 2)} ${f(cy - lift)} Q ${f(cx)} ${f(cy + lift * 0.62)} ${f(cx + w / 2)} ${f(cy - lift)}`;
}
function pursedPath(cx, cy, w, dip) {
  // Ends DOWN relative to the middle dip — a small, disapproving pout
  // that still reads as a mouth (never a sad deep arc).
  return `M ${f(cx - w / 2)} ${f(cy)} Q ${f(cx)} ${f(cy + dip)} ${f(cx + w / 2)} ${f(cy)}`;
}
function browArc(x, y) {
  return `<path d="${arcPath(x, y, FACE.brow.r, 212, 328)}" fill="none" stroke="#2c3e50" stroke-width="${FACE.brow.w}" stroke-linecap="round"/>`;
}

/** Eye variants: happy arcs (∩), squeeze arcs, flat squint, angry brow. */
function arcEye(x, cls, opts = {}) {
  const r = opts.r ?? 6.6;
  const a0 = opts.a0 ?? 205;
  const a1 = opts.a1 ?? 335;
  return `<path class="${cls}" d="${arcPath(x, EYE.y + (opts.dy ?? 1.5), r, a0, a1)}" fill="none" stroke="#2c3e50" stroke-width="${opts.w ?? 3.2}" stroke-linecap="round"/>`;
}

/** Safi markup with EVERY state present; the host shows one via
 *  data-state + CSS. aria-hidden: the state is announced by the host
 *  element's label (never by an image). Sign glyphs are STROKED PATHS,
 *  never <text>: font-independent and immune to the Chromium innerText
 *  quirk for display:none SVG text. */
export function safiMascotMarkup(opts = {}) {
  const headOnly = opts.headOnly === true;
  const star = starPath(STAR.cx, STAR.cy, STAR.rOut, STAR.rIn);
  const starOutline = starPath(STAR.cx, STAR.cy, STAR.rOut + 1.5, STAR.rIn + 0.7);
  const eL = HEAD.cx - EYE.dx;
  const eR = HEAD.cx + EYE.dx;
  const signX = SIGN.x;
  const signY = SIGN.y;
  const signS = SIGN.s;
  const q = signX + signS / 2;

  const signBadge = (cls, fill, stroke, glyph) => `
    <g class="sign ${cls}">
      <rect x="${signX}" y="${signY}" width="${signS}" height="${signS}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>
      ${glyph}
    </g>`;
  const signCheck = signBadge(
    "sign-check", SAFI_MASCOT_COLORS.verified, "#2fbf7f",
    `<path d="M ${signX + 7} ${signY + 13.5} L ${signX + 11.5} ${signY + 18.5} L ${signX + 19.5} ${signY + 8}" fill="none" stroke="#0d5c38" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
  const signQuery = signBadge(
    "sign-query", SAFI_MASCOT_COLORS.uncertain, "#d9a13c",
    `<path d="M ${q - 5.2} ${signY + 10.5} C ${q - 5.4} ${signY + 5.5} ${q + 1} ${signY + 3.6} ${q + 3.8} ${signY + 6.8} C ${q + 5.8} ${signY + 9.2} ${q + 4.4} ${signY + 11.6} ${q + 1.6} ${signY + 13} L ${q + 1.6} ${signY + 15.2}" fill="none" stroke="#7a4d00" stroke-width="3" stroke-linecap="round"/><circle cx="${q + 1.6}" cy="${signY + 20}" r="1.9" fill="#7a4d00"/>`,
  );
  const signBang = signBadge(
    "sign-bang", SAFI_MASCOT_COLORS.failed, "#d95c5c",
    `<line x1="${q}" y1="${signY + 6}" x2="${q}" y2="${signY + 15.5}" stroke="#7e221c" stroke-width="3.4" stroke-linecap="round"/><circle cx="${q}" cy="${signY + 20.2}" r="2" fill="#7e221c"/>`,
  );

  return `<svg class="safi-mascot" data-state="idle" viewBox="0 0 120 120" aria-hidden="true" focusable="false" role="presentation">
  <defs>
    <radialGradient id="safi-mascot-body" cx="50%" cy="34%" r="80%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="66%" stop-color="#eef6ff"/>
      <stop offset="100%" stop-color="${SAFI_MASCOT_COLORS.neutral}"/>
    </radialGradient>
    <radialGradient id="safi-mascot-glow-neutral" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${SAFI_MASCOT_COLORS.neutral}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${SAFI_MASCOT_COLORS.neutral}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="safi-mascot-glow-verified" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${SAFI_MASCOT_COLORS.verified}" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="${SAFI_MASCOT_COLORS.verified}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="safi-mascot-glow-uncertain" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${SAFI_MASCOT_COLORS.uncertain}" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="${SAFI_MASCOT_COLORS.uncertain}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="safi-mascot-glow-failed" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${SAFI_MASCOT_COLORS.failed}" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="${SAFI_MASCOT_COLORS.failed}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <ellipse class="sm-shadow" cx="60" cy="114" rx="22" ry="3.6" fill="rgba(31,45,60,0.16)"/>
  <g class="sm-glows">
    <circle class="glow glow-neutral" cx="60" cy="56" r="54" fill="url(#safi-mascot-glow-neutral)"/>
    <circle class="glow glow-verified" cx="60" cy="56" r="54" fill="url(#safi-mascot-glow-verified)"/>
    <circle class="glow glow-uncertain" cx="60" cy="56" r="54" fill="url(#safi-mascot-glow-uncertain)"/>
    <circle class="glow glow-failed" cx="60" cy="56" r="54" fill="url(#safi-mascot-glow-failed)"/>
  </g>

  <g class="sm-rig">
    <path class="sm-body" d="${bodyPath()}" fill="url(#safi-mascot-body)" stroke="rgba(116,148,188,0.4)" stroke-width="1.3"/>
    <g class="sm-arms">
      <ellipse class="sm-arm-lu" cx="${HEAD.cx - ARM.dx}" cy="${ARM.y}" rx="5.4" ry="8.4" fill="url(#safi-mascot-body)" stroke="rgba(116,148,188,0.4)" stroke-width="1.2" transform="rotate(16 ${HEAD.cx - ARM.dx} ${ARM.y})"/>
      <ellipse class="sm-arm-ru" cx="${HEAD.cx + ARM.dx}" cy="${ARM.y}" rx="5.4" ry="8.4" fill="url(#safi-mascot-body)" stroke="rgba(116,148,188,0.4)" stroke-width="1.2" transform="rotate(-16 ${HEAD.cx + ARM.dx} ${ARM.y})"/>
    </g>

    <g class="sm-face">
      <g class="eyes eyes-idle">${dotEye(eL, EYE.y, EYE.r, "")}${dotEye(eR, EYE.y, EYE.r, "")}</g>
      <g class="eyes eyes-attentive">
        ${dotEye(eL, EYE.y, EYE.r + 0.2, "")}${dotEye(eR, EYE.y, EYE.r + 0.2, "")}
        ${browArc(eL, EYE.y - FACE.brow.lift)}${browArc(eR, EYE.y - FACE.brow.lift)}
      </g>
      <g class="eyes eyes-glance">
        <g class="glance-rig">${dotEye(eL, EYE.y, EYE.r, "")}${dotEye(eR, EYE.y, EYE.r, "")}</g>
        <clipPath id="safi-glance-clip"><rect x="${eL - EYE.r - 4}" y="${EYE.y - EYE.r - 4}" width="${(eR - eL) + EYE.r * 2 + 8}" height="${EYE.r * 2 + 8}"/></clipPath>
      </g>
      <g class="eyes eyes-happy">${arcEye(eL, "")}${arcEye(eR, "")}</g>
      <g class="eyes eyes-squint">
        ${arcEye(eL, "", { r: 5.4, a0: 190, a1: 350, w: 3 })}
        ${dotEye(eR, EYE.y + 0.6, EYE.r - 0.9, "")}
        <path d="${arcPath(eL, EYE.y - 8.5, 5.2, 208, 332)}" fill="none" stroke="#2c3e50" stroke-width="2" stroke-linecap="round" transform="rotate(10 ${eL} ${EYE.y - 8.5})"/>
      </g>
      <g class="eyes eyes-squeeze">
        ${arcEye(eL, "", { r: 5.2, a0: 200, a1: 340, w: 3.2 })}
        ${arcEye(eR, "", { r: 5.2, a0: 200, a1: 340, w: 3.2 })}
        <path d="${arcPath(eL, EYE.y - 8.5, 5.8, 215, 325)}" fill="none" stroke="#2c3e50" stroke-width="2.3" stroke-linecap="round" transform="rotate(12 ${eL} ${EYE.y - 8.5})"/>
        <path d="${arcPath(eR, EYE.y - 8.5, 5.8, 215, 325)}" fill="none" stroke="#2c3e50" stroke-width="2.3" stroke-linecap="round" transform="rotate(-12 ${eR} ${EYE.y - 8.5})"/>
      </g>

      <g class="sm-mouth">
        <path class="m-smile" d="${smilePath(MOUTH.x, MOUTH.y, FACE.smile.w, FACE.smile.lift)}" fill="none" stroke="#2c3e50" stroke-width="2.6" stroke-linecap="round"/>
        <path class="m-small" d="${smilePath(MOUTH.x, MOUTH.y + 1.4, FACE.smallSmile.w, FACE.smallSmile.lift)}" fill="none" stroke="#2c3e50" stroke-width="2.4" stroke-linecap="round"/>
        <path class="m-pursed" d="${pursedPath(MOUTH.x, MOUTH.y + 3, FACE.pursed.w, FACE.pursed.dip)}" fill="none" stroke="#2c3e50" stroke-width="2.8" stroke-linecap="round"/>
      </g>

      <g class="sm-cheeks">
        <ellipse class="chk" cx="${HEAD.cx - CHEEK.dx}" cy="${CHEEK.y}" rx="${CHEEK.rx}" ry="${CHEEK.ry}" fill="#ffb3ba" opacity="0.5"/>
        <ellipse class="chk" cx="${HEAD.cx + CHEEK.dx}" cy="${CHEEK.y}" rx="${CHEEK.rx}" ry="${CHEEK.ry}" fill="#ffb3ba" opacity="0.5"/>
        <ellipse class="chk chk-puff" cx="${HEAD.cx - CHEEK.dx - 1.5}" cy="${CHEEK.y + 2}" rx="${CHEEK.rx + 2.4}" ry="${CHEEK.ry + 2.4}" fill="#ffb3ba" opacity="0.75"/>
        <ellipse class="chk chk-puff" cx="${HEAD.cx + CHEEK.dx + 1.5}" cy="${CHEEK.y + 2}" rx="${CHEEK.rx + 2.4}" ry="${CHEEK.ry + 2.4}" fill="#ffb3ba" opacity="0.75"/>
      </g>
    </g>

    ${headOnly ? "" : `<path class="sm-star-outline" d="${starOutline}" fill="#e8a93c" opacity="0.55"/>
    <path class="sm-star" d="${star}" fill="#ffc94d" stroke="#e8a93c" stroke-width="1"/>`}

    <g class="sm-arm arm-sign"><path d="M ${HEAD.cx + ARM.dx + 2} ${ARM.y - 4} Q ${signX + signS / 2 - 7} ${signY + signS + 4} ${signX + signS / 2} ${signY + signS - 2}" fill="none" stroke="rgba(116,148,188,0.55)" stroke-width="4.4" stroke-linecap="round"/></g>

    ${headOnly ? "" : `${signCheck}${signQuery}${signBang}`}

    <g class="sm-magnifier">
      <circle cx="86" cy="52" r="9.5" fill="rgba(224,240,255,0.5)" stroke="#6f9cc8" stroke-width="2.6"/>
      <line x1="93" y1="59" x2="101" y2="67" stroke="#6f9cc8" stroke-width="3.4" stroke-linecap="round"/>
    </g>

    <g class="sm-dots">
      <circle class="d d1" cx="90" cy="20" r="2" fill="#8fa8c4"/>
      <circle class="d d2" cx="97" cy="16.5" r="2" fill="#8fa8c4"/>
      <circle class="d d3" cx="104" cy="13" r="2" fill="#8fa8c4"/>
    </g>

    <g class="sm-sparks">
      <path class="sp sp1" d="${starPath(18, 26, 5.2, 2.1)}" fill="#ffd97a"/>
      <path class="sp sp2" d="${starPath(29, 12, 3.4, 1.4)}" fill="#ffd97a"/>
    </g>

    <g class="sm-puff">
      <circle cx="16" cy="60" r="4.4" fill="#e8eef5"/>
      <circle cx="10.5" cy="63" r="3.1" fill="#eef3f8"/>
    </g>
  </g>
</svg>`;
}

/** Shared Safi CSS. The widget inlines this; static assets embed it.
 *  One dominant animation per state; everything respects
 *  prefers-reduced-motion. */
export const SAFI_MASCOT_CSS = `
.safi-mascot { display: block; width: 100%; height: 100%; }
.safi-mascot .sm-glows .glow { opacity: 0; transition: opacity 420ms ease; }
.safi-mascot .sm-glows .glow-neutral { opacity: 0.75; }
.safi-mascot[data-state="verified"] .glow-verified,
.safi-mascot[data-state="uncertain"] .glow-uncertain,
.safi-mascot[data-state="failed"] .glow-failed { opacity: 1; }
.safi-mascot[data-state="verified"] .glow-neutral,
.safi-mascot[data-state="uncertain"] .glow-neutral,
.safi-mascot[data-state="failed"] .glow-neutral { opacity: 0; }

.safi-mascot .eyes, .safi-mascot .sign, .safi-mascot .sm-magnifier, .safi-mascot .sm-dots,
.safi-mascot .sm-sparks, .safi-mascot .sm-puff, .safi-mascot .m-small, .safi-mascot .m-pursed,
.safi-mascot .chk-puff, .safi-mascot .arm-sign { display: none; }
.safi-mascot .m-smile, .safi-mascot .chk { display: block; }

.safi-mascot[data-state="understanding"] .eyes-attentive { display: block; }
.safi-mascot[data-state="translating"] .eyes-glance { display: block; }
.safi-mascot[data-state="verifying"] .eyes-attentive { display: block; }
.safi-mascot[data-state="verified"] .eyes-happy { display: block; }
.safi-mascot[data-state="uncertain"] .eyes-squint { display: block; }
.safi-mascot[data-state="failed"] .eyes-squeeze { display: block; }
.safi-mascot:not([data-state="idle"]) .eyes-idle { display: none; }

.safi-mascot[data-state="uncertain"] .m-smile,
.safi-mascot[data-state="failed"] .m-smile { display: none; }
.safi-mascot[data-state="uncertain"] .m-small { display: block; }
.safi-mascot[data-state="failed"] .m-pursed { display: block; }
.safi-mascot[data-state="failed"] .chk { opacity: 0.35; }
.safi-mascot[data-state="failed"] .chk-puff { display: block; }

.safi-mascot[data-state="verified"] .sign-check,
.safi-mascot[data-state="uncertain"] .sign-query,
.safi-mascot[data-state="failed"] .sign-bang { display: block; transform-origin: ${SIGN.x + SIGN.s / 2}px ${SIGN.y + SIGN.s}px; animation: safi-mascot-sign-pop 340ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.safi-mascot[data-state="verified"] .arm-sign,
.safi-mascot[data-state="uncertain"] .arm-sign,
.safi-mascot[data-state="failed"] .arm-sign { display: block; }

.safi-mascot[data-state="verifying"] .sm-magnifier { display: block; transform-origin: 98px 66px; animation: safi-mascot-scan 1.5s ease-in-out infinite; }
.safi-mascot[data-state="understanding"] .sm-dots { display: block; }
.safi-mascot[data-state="understanding"] .sm-dots .d { animation: safi-mascot-dot 1.2s ease-in-out infinite; }
.safi-mascot[data-state="understanding"] .sm-dots .d2 { animation-delay: 150ms; }
.safi-mascot[data-state="understanding"] .sm-dots .d3 { animation-delay: 300ms; }
.safi-mascot[data-state="translating"] .sm-sparks { display: block; }
.safi-mascot[data-state="translating"] .sm-sparks .sp { transform-origin: center; animation: safi-mascot-twinkle 1.4s ease-in-out infinite; }
.safi-mascot[data-state="translating"] .sm-sparks .sp2 { animation-delay: 500ms; }
.safi-mascot[data-state="failed"] .sm-puff { display: block; animation: safi-mascot-puff 900ms ease-out both; }

.safi-mascot .sm-rig { transform-origin: 60px 92px; animation: safi-mascot-breathe 3.6s ease-in-out infinite; }
.safi-mascot[data-state="understanding"] .sm-rig { animation: safi-mascot-tilt 2.6s ease-in-out infinite; }
.safi-mascot[data-state="verifying"] .sm-rig { animation: safi-mascot-tilt-small 2.2s ease-in-out infinite; }
.safi-mascot[data-state="uncertain"] .sm-rig { animation: safi-mascot-tilt-hold 400ms ease-out both; }
.safi-mascot[data-state="translating"] .glance-rig { animation: safi-mascot-glance 1.6s ease-in-out infinite; }
.safi-mascot[data-state="verified"] .sm-rig { animation: safi-mascot-bounce 380ms cubic-bezier(0.34, 1.56, 0.64, 1) 1, safi-mascot-breathe 3.6s ease-in-out 400ms infinite; }

@keyframes safi-mascot-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.016); } }
@keyframes safi-mascot-tilt { 0%, 100% { transform: rotate(-4.5deg); } 50% { transform: rotate(-2.5deg); } }
@keyframes safi-mascot-tilt-small { 0%, 100% { transform: rotate(2deg); } 50% { transform: rotate(-2deg); } }
@keyframes safi-mascot-tilt-hold { from { transform: rotate(0deg); } to { transform: rotate(-6.5deg); } }
@keyframes safi-mascot-glance { 0%, 100% { transform: translateX(-2.6px); } 50% { transform: translateX(2.6px); } }
@keyframes safi-mascot-scan { 0%, 100% { transform: rotate(-7deg); } 50% { transform: rotate(8deg); } }
@keyframes safi-mascot-dot { 0%, 100% { opacity: 0.25; } 45% { opacity: 1; } }
@keyframes safi-mascot-twinkle { 0%, 100% { opacity: 0.25; transform: scale(0.82); } 50% { opacity: 1; transform: scale(1.08); } }
@keyframes safi-mascot-sign-pop { from { transform: scale(0.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes safi-mascot-bounce { 0% { transform: translateY(0); } 45% { transform: translateY(-4.5px); } 100% { transform: translateY(0); } }
@keyframes safi-mascot-puff { from { opacity: 0.95; transform: translateX(0); } to { opacity: 0; transform: translateX(-7px); } }

@media (prefers-reduced-motion: reduce) {
  .safi-mascot .sm-rig, .safi-mascot .glance-rig, .safi-mascot .sm-magnifier,
  .safi-mascot .sm-dots .d, .safi-mascot .sm-sparks .sp,
  .safi-mascot .sign { animation: none !important; }
}`;
