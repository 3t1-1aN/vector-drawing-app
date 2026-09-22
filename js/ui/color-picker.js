// ui/color-picker.js
// Concepts-style color wheel overlay. Opens as concentric rings around the
// style wheel hub instead of a side flyout: an inner icon ring chooses the
// mode (marker wheel / HSL / RGB / eyedropper), and the active mode renders
// circular sliders around it. The caller receives onChange(hex, phase) with
// phase "preview" while dragging and "commit" on release / discrete picks,
// so the wheel can batch undo steps.

// --- Color conversions ---------------------------------------------------

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r, g, b) {
  const to = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = l * 255;
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 };
}

export function hslToHex(h, s, l) {
  const { r, g, b } = hslToRgb(h, s / 100, l / 100);
  return rgbToHex(r, g, b);
}

/** Parse "#hex" or legacy "rgba(r, g, b, a)" strings to {r,g,b}. */
export function parseColor(str) {
  if (!str) return { r: 43, g: 43, b: 48 };
  if (str.startsWith("#")) return hexToRgb(str);
  const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3] };
  return { r: 43, g: 43, b: 48 };
}

// --- Palette (radial swatch bands, no branding) --------------------------
// Laid out like a marker case: hue runs around the circumference and each
// concentric band is one value/saturation step, so a radial column is a
// single colour family from dark to pale. The innermost band is neutral.

const PALETTE_COLUMNS = 24;
const PALETTE_START_DEG = -90;   // column 0 sits at the top

// Bands carry colour only; their radii are derived in bandRadii() so every
// divider ends up the same width. The dividers are a machined kerf between
// swatches, not a graphic element, so they stay hairline thin and let the
// colour dominate.
const PALETTE_BANDS = [
  { neutral: true },
  { s: 88, l: 26 },
  { s: 84, l: 38 },
  { s: 76, l: 50 },
  { s: 62, l: 65 },
  { s: 42, l: 81 },
];

/** Colour of one palette tile. Neutral band ramps black -> white. */
function paletteColor(band, column) {
  const hue = (column / PALETTE_COLUMNS) * 360;
  if (band.neutral) {
    return hslToHex(0, 0, 3 + (column / (PALETTE_COLUMNS - 1)) * 97);
  }
  return hslToHex(hue, band.s, band.l);
}

/** Inner and outer radius of band i, spaced so every kerf matches. */
function bandRadii(i) {
  const n = PALETTE_BANDS.length;
  const h = (PALETTE_R_OUT - PALETTE_R_IN - (n - 1) * PALETTE_KERF) / n;
  const r0 = PALETTE_R_IN + i * (h + PALETTE_KERF);
  return { r0, r1: r0 + h };
}

// --- Geometry ------------------------------------------------------------

const SIZE = 460;
const C = SIZE / 2;
const SVG_NS = "http://www.w3.org/2000/svg";

// The picker is the console opening up, so its radii continue the wheel's
// section rather than starting a new one: the control channel is milled
// around the hub, the swatch ring is recessed into the plate, and the plate
// is the wheel body carried outward past its own rim (150).
const CTRL_R_IN = 56;       // control channel, just outside the hub
const CTRL_R_OUT = 92;
const ICON_R = (CTRL_R_IN + CTRL_R_OUT) / 2;
const MODE_BTN_R = 14;

const PALETTE_R_IN = 100;   // swatch ring, recessed into the plate
const PALETTE_R_OUT = 202;
const PALETTE_KERF = 1.2;   // divider width in px, uniform radially and around

const HUE_R = 128;          // HSL hue ring mid-radius
const HUE_W = 15;           // hue ring stroke width
const ARC_R = 172;          // S/L (and RGB) arc mid-radius
const ARC_W = 13;

const PLATE_R_IN = 148;     // overlaps the wheel rim so the two read as one body
const PLATE_R_OUT = 208;
const PLATE_R = (PLATE_R_IN + PLATE_R_OUT) / 2;
const PLATE_W = PLATE_R_OUT - PLATE_R_IN;

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function polar(deg, r) {
  const rad = (deg * Math.PI) / 180;
  return { x: C + Math.cos(rad) * r, y: C + Math.sin(rad) * r };
}

function arcPathD(startDeg, endDeg, r) {
  const a = polar(startDeg, r);
  const b = polar(endDeg, r);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  const sweep = endDeg > startDeg ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} ${sweep} ${b.x} ${b.y}`;
}

function ringPathD(r) {
  return `M ${C - r} ${C} A ${r} ${r} 0 1 1 ${C + r} ${C} A ${r} ${r} 0 1 1 ${C - r} ${C}`;
}

/** Two concentric rings as one path; fill or clip it with evenodd. */
function annulusPathD(r0, r1) {
  return `${ringPathD(r1)} ${ringPathD(r0)}`;
}

/** Parse a static SVG markup string into nodes. Only used for <defs>. */
function svgFragment(markup) {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="${SVG_NS}">${markup}</svg>`, "image/svg+xml",
  );
  const frag = document.createDocumentFragment();
  while (doc.documentElement.firstChild) frag.appendChild(doc.documentElement.firstChild);
  return frag;
}

/**
 * Same lighting model as the wheel (style-wheel.js buildDefs): one source up
 * and to the left, raised edges catching it at the top, recessed edges at the
 * bottom. The gradients are restated here rather than shared so the two
 * modules stay independent -- if you retune one set, retune both.
 *
 * The palette overlays are deliberately weak. Anything heavier would tint the
 * swatches, and a colour picker that lies about its colours is useless.
 */
function buildDefs() {
  // Kept to the outermost few pixels of each edge so the shadow lands on the
  // kerf and the swatch faces stay true.
  const fadeIn = (PALETTE_R_IN / PALETTE_R_OUT).toFixed(4);
  const fadeInEnd = ((PALETTE_R_IN + 5) / PALETTE_R_OUT).toFixed(4);
  const fadeOutStart = ((PALETTE_R_OUT - 5) / PALETTE_R_OUT).toFixed(4);
  const defs = svgEl("defs", {});
  defs.appendChild(svgFragment(`
    <radialGradient id="cpgBody" cx="36%" cy="26%" r="86%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.045"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.012"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.13"/>
    </radialGradient>

    <linearGradient id="cpgRaisedRim" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.2"/>
      <stop offset="0.4" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.5"/>
    </linearGradient>

    <linearGradient id="cpgRecessRim" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0.6"/>
      <stop offset="0.55" stop-color="#000000" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.085"/>
    </linearGradient>

    <linearGradient id="cpgPadIn" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0.32"/>
      <stop offset="0.7" stop-color="#000000" stop-opacity="0.03"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.05"/>
    </linearGradient>

    <linearGradient id="cpgPadUp" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.085"/>
      <stop offset="0.62" stop-color="#ffffff" stop-opacity="0.014"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.22"/>
    </linearGradient>

    <linearGradient id="cpgPadRimIn" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0.62"/>
      <stop offset="0.6" stop-color="#000000" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.09"/>
    </linearGradient>

    <linearGradient id="cpgPadRimUp" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.26"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.55"/>
    </linearGradient>

    <!-- Swatch ring sits down in the plate, so both of its walls shadow it. -->
    <radialGradient id="cpgPaletteEdge" gradientUnits="userSpaceOnUse"
                    cx="${C}" cy="${C}" r="${PALETTE_R_OUT}">
      <stop offset="${fadeIn}" stop-color="#000000" stop-opacity="0.26"/>
      <stop offset="${fadeInEnd}" stop-color="#000000" stop-opacity="0"/>
      <stop offset="${fadeOutStart}" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.26"/>
    </radialGradient>

    <linearGradient id="cpgPaletteWash" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.022"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.035"/>
    </linearGradient>

    <filter id="cpgGrain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.92" numOctaves="2" seed="11" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.64  0 0 0 0 0.65  0 0 0 0 0.7  0 0 0 1 0"/>
    </filter>

    <clipPath id="cpgPlateClip" clipPathUnits="userSpaceOnUse">
      <path d="${annulusPathD(PLATE_R_IN, PLATE_R_OUT)}" clip-rule="evenodd"/>
    </clipPath>
  `));
  return defs;
}

/** Control pad, same construction as the wheel's tool pads. */
function buildPad(cx, cy, r) {
  const g = svgEl("g", { class: "cp-pad" });
  g.appendChild(svgEl("circle", { cx, cy, r, class: "cp-pad-base" }));
  g.appendChild(svgEl("circle", { cx, cy, r, class: "cp-pad-face" }));
  g.appendChild(svgEl("circle", { cx, cy, r: r - 0.5, class: "cp-pad-rim" }));
  return g;
}

/** Closed wedge between two radii and two angles, used for palette tiles. */
function annularSectorPathD(r0, r1, deg0, deg1) {
  const outStart = polar(deg0, r1);
  const outEnd = polar(deg1, r1);
  const inEnd = polar(deg1, r0);
  const inStart = polar(deg0, r0);
  const large = Math.abs(deg1 - deg0) > 180 ? 1 : 0;
  return [
    `M ${outStart.x} ${outStart.y}`,
    `A ${r1} ${r1} 0 ${large} 1 ${outEnd.x} ${outEnd.y}`,
    `L ${inEnd.x} ${inEnd.y}`,
    `A ${r0} ${r0} 0 ${large} 0 ${inStart.x} ${inStart.y}`,
    "Z",
  ].join(" ");
}

function pointerAngle(e, hostRect) {
  const dx = e.clientX - (hostRect.left + hostRect.width / 2);
  const dy = e.clientY - (hostRect.top + hostRect.height / 2);
  return ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
}

// Map a linear value 0..1 to an angle on an arc, and back.
function arcValueToDeg(arc, t) {
  return arc.start + t * (arc.end - arc.start);
}
function arcDegToValue(arc, deg) {
  // Clamp deg into the arc's swept range, honoring wrap.
  const span = arc.end - arc.start;
  let d = ((deg - arc.start) % 360 + 360) % 360;
  if (d > span) {
    // Outside the arc: snap to nearest end.
    const toStart = Math.min(d, 360 - d);
    const toEnd = Math.min(Math.abs(d - span), 360 - (d - span));
    return toStart < toEnd ? 0 : 1;
  }
  return d / span;
}

// Arc ranges. Saturation & blue across the top, lightness & red across the
// bottom, green on the right. 0 deg = right, 90 = down.
const ARC_SAT = { start: 200, end: 340 };   // top
const ARC_LIGHT = { start: 20, end: 160 };  // bottom
const ARC_R_TOP = { start: 200, end: 340 };
const ARC_R_MID = { start: 20, end: 160 };
const ARC_G = { start: -60, end: 60 };      // right side

// --- State ---------------------------------------------------------------

let root = null;
let svg = null;
let modeLayer = null;
let iconRing = null;
let onChangeCb = null;

const state = { h: 220, s: 0.05, l: 0.18 };
// The palette opens first: picking a swatch is the common case, and HSL/RGB
// are there for dialling in an exact value.
let mode = "markers"; // "markers" | "hsl" | "rgb"
let drag = null;      // active slider drag descriptor
let eyedropperActive = false;
let eyedropperTeardown = null;
let sampler = null; // (x, y) -> {r,g,b} | null

function currentHex() {
  const { r, g, b } = hslToRgb(state.h, state.s, state.l);
  return rgbToHex(r, g, b);
}

function emit(phase) {
  if (onChangeCb) onChangeCb(currentHex(), phase);
}

// --- Gradient arc strokes --------------------------------------------------
// We build each slider track from many small SVG arc segments so the color
// can sweep a gradient along the arc. 24-40 segments per arc is smooth.

function gradientArc(arc, r, width, colorAt, segments) {
  const frag = document.createDocumentFragment();
  const step = (arc.end - arc.start) / segments;
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const d = arcPathD(arcValueToDeg(arc, t0), arcValueToDeg(arc, t1 + 0.002), r);
    const seg = svgEl("path", {
      d,
      fill: "none",
      stroke: colorAt((t0 + t1) / 2),
      "stroke-width": width,
    });
    frag.appendChild(seg);
  }
  return frag;
}

function hueRingGradientSegments(r, width) {
  const g = document.createDocumentFragment();
  const segments = 64;
  for (let i = 0; i < segments; i++) {
    const deg0 = (i / segments) * 360;
    const deg1 = ((i + 1) / segments) * 360 + 0.3;
    const d = arcPathD(deg0, deg1, r);
    // Invert so hue 0 (red) is at angle 0; CSS angle increases clockwise.
    const hue = (360 - ((deg0 + deg1) / 2)) % 360;
    const { r: cr, g: cg, b: cb } = hslToRgb(hue, 1, 0.5);
    g.appendChild(svgEl("path", {
      d,
      fill: "none",
      stroke: rgbToHex(cr, cg, cb),
      "stroke-width": width,
    }));
  }
  return g;
}

// --- Mode button ring ------------------------------------------------------

// Modes carry either a short text label (HSL / RGB read better as words) or
// placeholder line art, drawn on the same 24x24 grid as the wheel icons so
// finished artwork can replace them without touching the ring layout.
const MODES = [
  { id: "markers", label: "Palette", paths: ["M4.5 4.5 H11 V11 H4.5 Z", "M13 4.5 H19.5 V11 H13 Z", "M4.5 13 H11 V19.5 H4.5 Z", "M13 13 H19.5 V19.5 H13 Z"] },
  { id: "hsl", label: "HSL", text: "HSL" },
  { id: "rgb", label: "RGB", text: "RGB" },
  { id: "dropper", label: "Eyedropper", paths: ["M5 19 L5 15.4 L14.6 5.8 L18.2 9.4 L8.6 19 Z", "M13.2 7.2 L16.8 10.8"] },
];

function buildIconRing() {
  const g = svgEl("g", { class: "cp-icon-ring" });
  // Channel milled around the hub. The pads sit down inside it, which is what
  // stops them reading as buttons floating over the wheel.
  g.appendChild(svgEl("circle", {
    cx: C, cy: C, r: ICON_R, class: "cp-ctrl-channel",
    fill: "none", "stroke-width": CTRL_R_OUT - CTRL_R_IN,
  }));
  g.appendChild(svgEl("circle", {
    cx: C, cy: C, r: CTRL_R_OUT - 0.5, class: "cp-ctrl-rim", stroke: "url(#cpgRecessRim)",
  }));
  g.appendChild(svgEl("circle", {
    cx: C, cy: C, r: CTRL_R_IN + 0.5, class: "cp-ctrl-rim", stroke: "url(#cpgRaisedRim)",
  }));
  MODES.forEach((m, i) => {
    const deg = 180 + i * (180 / (MODES.length - 1)); // arc across the top of the hub
    const p = polar(deg, ICON_R);
    const btn = svgEl("g", {
      class: "cp-mode-btn", "data-mode": m.id, cursor: "pointer",
      tabindex: "0", role: "button", "aria-label": m.label,
    });
    btn.appendChild(buildPad(p.x, p.y, MODE_BTN_R));
    if (m.text) {
      const txt = svgEl("text", {
        x: p.x, y: p.y + 3.5, class: "cp-mode-label", "text-anchor": "middle",
      });
      txt.textContent = m.text;
      btn.appendChild(txt);
    } else {
      const icon = svgEl("g", { class: "cp-mode-glyph" });
      icon.setAttribute("transform", `translate(${p.x} ${p.y}) scale(0.62) translate(-12 -12)`);
      for (const d of m.paths) icon.appendChild(svgEl("path", { d, class: "cp-mode-icon" }));
      btn.appendChild(icon);
    }
    const activate = () => {
      if (m.id === "dropper") startEyedropper();
      else setMode(m.id);
    };
    btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click", (e) => { e.stopPropagation(); activate(); });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        activate();
      }
    });
    g.appendChild(btn);
  });
  return g;
}

// --- HSL mode --------------------------------------------------------------

let hslEls = null;

function buildHslMode() {
  const g = svgEl("g", { class: "cp-mode-layer" });

  // Hue ring (full circle, rainbow gradient).
  const hueTrack = svgEl("g", { class: "cp-track", "data-slider": "hue", cursor: "pointer" });
  hueTrack.appendChild(hueRingGradientSegments(HUE_R, HUE_W));
  g.appendChild(hueTrack);

  // Saturation arc across the top: gray -> pure hue.
  const satTrack = svgEl("g", { class: "cp-track", "data-slider": "sat", cursor: "pointer" });
  satTrack.appendChild(gradientArc(ARC_SAT, ARC_R, ARC_W, (t) => {
    const { r, b, g: gg } = hslToRgb(state.h, t, state.l);
    return rgbToHex(r, gg, b);
  }, 28));
  g.appendChild(satTrack);

  // Lightness arc across the bottom: white -> hue -> black.
  const lightTrack = svgEl("g", { class: "cp-track", "data-slider": "light", cursor: "pointer" });
  lightTrack.appendChild(gradientArc(ARC_LIGHT, ARC_R, ARC_W, (t) => {
    const { r, b, g: gg } = hslToRgb(state.h, state.s, t);
    return rgbToHex(r, gg, b);
  }, 28));
  g.appendChild(lightTrack);

  // Handles.
  const hueHandle = svgEl("circle", { r: 8.5, class: "cp-handle" });
  const satHandle = svgEl("circle", { r: 8.5, class: "cp-handle" });
  const lightHandle = svgEl("circle", { r: 8.5, class: "cp-handle" });
  g.appendChild(hueHandle);
  g.appendChild(satHandle);
  g.appendChild(lightHandle);

  // Value labels (tap to inline-edit).
  const satLabel = svgEl("text", { class: "cp-value", "text-anchor": "middle" });
  const lightLabel = svgEl("text", { class: "cp-value", "text-anchor": "middle" });
  g.appendChild(satLabel);
  g.appendChild(lightLabel);

  hslEls = { hueHandle, satHandle, lightHandle, satLabel, lightLabel, satTrack, lightTrack, g };
  bindSliderDrag(g, "hue");
  bindSliderDrag(satTrack, "sat");
  bindSliderDrag(lightTrack, "light");
  bindInlineEdit(satLabel, () => Math.round(state.s * 100), (v) => { state.s = clamp01(v / 100); });
  bindInlineEdit(lightLabel, () => Math.round(state.l * 100), (v) => { state.l = clamp01(v / 100); });
  return g;
}

function syncHsl() {
  if (!hslEls) return;
  // Hue: stored 0..360, displayed on ring where 0deg = hue 0 going CCW, so
  // the screen angle = 360 - h.
  const hueDeg = (360 - state.h) % 360;
  const hp = polar(hueDeg, HUE_R);
  hslEls.hueHandle.setAttribute("cx", hp.x);
  hslEls.hueHandle.setAttribute("cy", hp.y);
  hslEls.hueHandle.setAttribute("fill", hslToHex(state.h, 1, 0.5));

  const sp = polar(arcValueToDeg(ARC_SAT, state.s), ARC_R);
  hslEls.satHandle.setAttribute("cx", sp.x);
  hslEls.satHandle.setAttribute("cy", sp.y);
  hslEls.satHandle.setAttribute("fill", hslToHex(state.h, state.s, state.l));

  const lp = polar(arcValueToDeg(ARC_LIGHT, state.l), ARC_R);
  hslEls.lightHandle.setAttribute("cx", lp.x);
  hslEls.lightHandle.setAttribute("cy", lp.y);
  hslEls.lightHandle.setAttribute("fill", hslToHex(state.h, state.s, state.l));

  // Label positions must be set as attributes; CSS x/y does not apply to
  // SVG <text>, so relying on the stylesheet would pin both labels at 0,0.
  const satLabelP = polar(arcValueToDeg(ARC_SAT, 0.5), ARC_R + 22);
  hslEls.satLabel.setAttribute("x", satLabelP.x);
  hslEls.satLabel.setAttribute("y", satLabelP.y);
  const lightLabelP = polar(arcValueToDeg(ARC_LIGHT, 0.5), ARC_R + 22);
  hslEls.lightLabel.setAttribute("x", lightLabelP.x);
  hslEls.lightLabel.setAttribute("y", lightLabelP.y + 4);
  hslEls.satLabel.textContent = `S ${Math.round(state.s * 100)}`;
  hslEls.lightLabel.textContent = `L ${Math.round(state.l * 100)}`;

  // Rebuild S/L gradients (they depend on current hue / saturation).
  rebuildTrack(hslEls.satTrack, ARC_SAT, ARC_R, ARC_W, (t) => {
    const { r, b, g: gg } = hslToRgb(state.h, t, state.l);
    return rgbToHex(r, gg, b);
  });
  rebuildTrack(hslEls.lightTrack, ARC_LIGHT, ARC_R, ARC_W, (t) => {
    const { r, b, g: gg } = hslToRgb(state.h, state.s, t);
    return rgbToHex(r, gg, b);
  });
}

function rebuildTrack(trackG, arc, r, width, colorAt) {
  while (trackG.firstChild) trackG.removeChild(trackG.firstChild);
  trackG.appendChild(gradientArc(arc, r, width, colorAt, 28));
}

// --- RGB mode ---------------------------------------------------------------

let rgbEls = null;

const RGB_CHANNELS = [
  { key: "r", label: "R", arc: ARC_R_MID, max: 255 },   // bottom (Concepts: red closest to bottom)
  { key: "g", label: "G", arc: ARC_G, max: 255 },       // right side
  { key: "b", label: "B", arc: ARC_R_TOP, max: 255 },   // top
];

function buildRgbMode() {
  const g = svgEl("g", { class: "cp-mode-layer" });
  rgbEls = { tracks: {}, handles: {}, labels: {}, g };

  for (const ch of RGB_CHANNELS) {
    const track = svgEl("g", { class: "cp-track", "data-slider": ch.key, cursor: "pointer" });
    g.appendChild(track);
    rgbEls.tracks[ch.key] = track;
    bindSliderDrag(track, ch.key);

    const handle = svgEl("circle", { r: 8.5, class: "cp-handle" });
    g.appendChild(handle);
    rgbEls.handles[ch.key] = handle;

    const label = svgEl("text", { class: "cp-value", "text-anchor": "middle" });
    g.appendChild(label);
    rgbEls.labels[ch.key] = label;
    bindInlineEdit(label, () => Math.round(getRgb()[ch.key]), (v) => {
      const rgb = getRgb();
      rgb[ch.key] = Math.round(Math.max(0, Math.min(255, v)));
      setFromRgb(rgb.r, rgb.g, rgb.b);
    });
  }
  return g;
}

function getRgb() {
  return hslToRgb(state.h, state.s, state.l);
}

function syncRgb() {
  if (!rgbEls) return;
  const rgb = getRgb();
  for (const ch of RGB_CHANNELS) {
    const t = rgb[ch.key] / 255;
    const p = polar(arcValueToDeg(ch.arc, t), ARC_R);
    rgbEls.handles[ch.key].setAttribute("cx", p.x);
    rgbEls.handles[ch.key].setAttribute("cy", p.y);
    const c = { r: 0, g: 0, b: 0 };
    c[ch.key] = rgb[ch.key];
    rgbEls.handles[ch.key].setAttribute("fill", rgbToHex(c.r, c.g, c.b));
    const lp = polar(arcValueToDeg(ch.arc, 0.5), ARC_R + 20);
    rgbEls.labels[ch.key].setAttribute("x", lp.x);
    rgbEls.labels[ch.key].setAttribute("y", lp.y);
    rgbEls.labels[ch.key].textContent = `${ch.label} ${Math.round(rgb[ch.key])}`;
    rebuildTrack(rgbEls.tracks[ch.key], ch.arc, ARC_R, ARC_W, (tt) => {
      const c2 = { r: 0, g: 0, b: 0 };
      c2[ch.key] = tt * 255;
      return rgbToHex(c2.r, c2.g, c2.b);
    });
  }
}

// --- Marker wheel mode --------------------------------------------------------

let markerEls = null;

function buildMarkerMode() {
  const g = svgEl("g", { class: "cp-mode-layer cp-palette" });
  const tiles = [];
  const step = 360 / PALETTE_COLUMNS;

  PALETTE_BANDS.forEach((band, i) => {
    const { r0, r1 } = bandRadii(i);
    // Half the kerf on each tile edge, converted from px at this band's mid
    // radius so the dividers stay the same width from the inner ring out.
    const half = ((PALETTE_KERF / 2) / ((r0 + r1) / 2)) * (180 / Math.PI);
    for (let col = 0; col < PALETTE_COLUMNS; col++) {
      const hex = paletteColor(band, col);
      const deg0 = PALETTE_START_DEG + col * step + half;
      const deg1 = PALETTE_START_DEG + (col + 1) * step - half;
      const tile = svgEl("path", {
        d: annularSectorPathD(r0, r1, deg0, deg1),
        fill: hex, class: "cp-tile", cursor: "pointer",
      });
      tile.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      tile.addEventListener("click", (e) => {
        e.stopPropagation();
        const { r, g: gg, b } = hexToRgb(hex);
        setFromRgb(r, gg, b);
        emit("commit");
      });
      g.appendChild(tile);
      tiles.push({ el: tile, hex });
    }
  });

  // Depth passes over the finished ring rather than per tile: one shared
  // light keeps 144 swatches reading as a single instrument.
  const ring = annulusPathD(PALETTE_R_IN, PALETTE_R_OUT);
  for (const cls of ["cp-palette-edge", "cp-palette-wash"]) {
    g.appendChild(svgEl("path", { d: ring, "fill-rule": "evenodd", class: cls }));
  }

  // One shared selection marker, drawn above the shading so the chosen
  // swatch stays crisp wherever it sits in the ring.
  const sel = svgEl("g", { class: "cp-selection" });
  const selSeat = svgEl("path", { class: "cp-selection-seat", d: "" });
  const selEdge = svgEl("path", { class: "cp-selection-edge", d: "" });
  sel.append(selSeat, selEdge);
  g.appendChild(sel);

  markerEls = { g, tiles, sel, selSeat, selEdge };
  return g;
}

/** Move the selection marker onto whichever tile matches the current colour. */
function syncMarkers() {
  if (!markerEls) return;
  const hex = currentHex().toLowerCase();
  const hit = markerEls.tiles.find((t) => t.hex.toLowerCase() === hex);
  const d = hit ? hit.el.getAttribute("d") : "";
  markerEls.selSeat.setAttribute("d", d);
  markerEls.selEdge.setAttribute("d", d);
  markerEls.sel.style.display = hit ? "" : "none";
}

// --- Eyedropper ----------------------------------------------------------------

let loupeEl = null;

function startEyedropper() {
  if (eyedropperActive) return;
  eyedropperActive = true;
  closeColorPicker();
  buildLoupe();

  const onMove = (e) => {
    if (!loupeEl) return;
    loupeEl.style.left = `${e.clientX - 44}px`;
    loupeEl.style.top = `${e.clientY - 44}px`;
    const sample = sampler ? sampler(e.clientX, e.clientY) : null;
    if (sample) {
      loupeEl.querySelector(".cp-loupe-new").style.background = rgbToHex(sample.r, sample.g, sample.b);
    }
  };
  const onUp = (e) => {
    const sample = sampler ? sampler(e.clientX, e.clientY) : null;
    stopEyedropper();
    if (sample) {
      setFromRgb(sample.r, sample.g, sample.b);
      emit("commit");
    }
  };
  const onKey = (e) => {
    if (e.code === "Escape") stopEyedropper();
  };
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("mouseup", onUp, true);
  window.addEventListener("keydown", onKey, true);
  document.body.classList.add("cp-eyedropping");
  eyedropperTeardown = () => {
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
    window.removeEventListener("keydown", onKey, true);
    document.body.classList.remove("cp-eyedropping");
  };
}

function buildLoupe() {
  loupeEl = document.createElement("div");
  loupeEl.className = "cp-loupe";
  const cur = currentHex();
  loupeEl.innerHTML = `
    <div class="cp-loupe-half cp-loupe-cur" style="background:${cur}"></div>
    <div class="cp-loupe-half cp-loupe-new" style="background:${cur}"></div>
    <div class="cp-loupe-cross"></div>
  `;
  document.body.appendChild(loupeEl);
}

/** Cancel an in-flight eyedropper gesture and restore the normal cursor. */
export function stopEyedropper() {
  eyedropperActive = false;
  if (loupeEl) { loupeEl.remove(); loupeEl = null; }
  if (eyedropperTeardown) { eyedropperTeardown(); eyedropperTeardown = null; }
}

// --- Slider drag plumbing ---------------------------------------------------------

function bindSliderDrag(trackG, sliderId) {
  trackG.addEventListener("mousedown", (e) => {
    drag = { sliderId };
    updateSliderFromPointer(e, sliderId);
    e.preventDefault();
    e.stopPropagation();
  });
}

function updateSliderFromPointer(e, sliderId) {
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const deg = pointerAngle(e, rect);

  if (sliderId === "hue") {
    state.h = (360 - deg) % 360;
  } else if (sliderId === "sat") {
    state.s = clamp01(arcDegToValue(ARC_SAT, deg));
  } else if (sliderId === "light") {
    state.l = clamp01(arcDegToValue(ARC_LIGHT, deg));
  } else if (sliderId === "r" || sliderId === "g" || sliderId === "b") {
    const ch = RGB_CHANNELS.find((c) => c.key === sliderId);
    const rgb = getRgb();
    rgb[sliderId] = Math.round(arcDegToValue(ch.arc, deg) * 255);
    setFromRgb(rgb.r, rgb.g, rgb.b);
  }
  syncUi();
  emit("preview");
}

// Global move/up while a slider drag is active.
window.addEventListener("mousemove", (e) => {
  if (!drag) return;
  updateSliderFromPointer(e, drag.sliderId);
});
window.addEventListener("mouseup", () => {
  if (!drag) return;
  drag = null;
  emit("commit");
});

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// --- Inline value editing -----------------------------------------------------

function bindInlineEdit(labelEl, getValue, setValue) {
  labelEl.addEventListener("mousedown", (e) => e.stopPropagation());
  labelEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const rect = labelEl.getBoundingClientRect();
    const input = document.createElement("input");
    input.type = "number";
    input.className = "cp-inline-edit";
    input.value = getValue();
    input.style.left = `${rect.left + rect.width / 2 - 26}px`;
    input.style.top = `${rect.top + rect.height / 2 - 12}px`;
    document.body.appendChild(input);
    input.focus();
    input.select();
    const commit = () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) {
        setValue(v);
        syncUi();
        emit("commit");
      }
      input.remove();
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") commit();
      if (ev.key === "Escape") input.remove();
      ev.stopPropagation();
    });
    input.addEventListener("blur", commit);
  });
}

// --- Build / mode switching ---------------------------------------------------

function buildDom() {
  root = document.createElement("div");
  root.id = "colorWheelOverlay";
  root.classList.add("hidden");

  svg = svgEl("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE });
  svg.appendChild(buildDefs());
  // Invisible hit surface so clicks anywhere on the ring don't fall through
  // to the canvas; clicking empty space closes the overlay.
  svg.appendChild(svgEl("circle", { cx: C, cy: C, r: C, class: "cp-hit" }));

  // The plate is the wheel's body carried outward: it starts just inside the
  // wheel's own rim so there is no seam, takes the same off-centre light and
  // grain, and moves the raised outer edge out to the picker's rim. Drawn as
  // an annulus so the hub stays visible through the middle.
  const plate = svgEl("g", { class: "cp-plate-layer" });
  plate.appendChild(svgEl("circle", {
    cx: C, cy: C, r: PLATE_R, fill: "none", "stroke-width": PLATE_W, class: "cp-plate",
  }));
  plate.appendChild(svgEl("path", {
    d: annulusPathD(PLATE_R_IN, PLATE_R_OUT), "fill-rule": "evenodd",
    class: "cp-plate-shade", fill: "url(#cpgBody)",
  }));
  const grain = svgEl("g", { class: "cp-grain", "clip-path": "url(#cpgPlateClip)" });
  grain.appendChild(svgEl("rect", {
    x: C - PLATE_R_OUT, y: C - PLATE_R_OUT,
    width: PLATE_R_OUT * 2, height: PLATE_R_OUT * 2, filter: "url(#cpgGrain)",
  }));
  plate.appendChild(grain);
  plate.appendChild(svgEl("circle", {
    cx: C, cy: C, r: PLATE_R_OUT - 0.5, class: "cp-plate-rim", stroke: "url(#cpgRaisedRim)",
  }));
  plate.appendChild(svgEl("circle", { cx: C, cy: C, r: PLATE_R_OUT - 4.5, class: "cp-plate-bevel" }));
  svg.appendChild(plate);

  // Walls of the recess the swatch ring drops into.
  svg.appendChild(svgEl("circle", {
    cx: C, cy: C, r: PALETTE_R_OUT + 0.5, class: "cp-palette-rim", stroke: "url(#cpgRecessRim)",
  }));
  svg.appendChild(svgEl("circle", {
    cx: C, cy: C, r: PALETTE_R_IN - 0.5, class: "cp-palette-rim", stroke: "url(#cpgRaisedRim)",
  }));

  svg.addEventListener("mousedown", (e) => e.stopPropagation());
  // Only the outer margin closes on click. The plate stays inert so a near
  // miss on a slider arc adjusts nothing instead of dismissing the picker.
  svg.addEventListener("click", (e) => {
    if (e.target.classList && e.target.classList.contains("cp-hit")) {
      closeColorPicker();
    }
  });

  modeLayer = svgEl("g", { class: "cp-modes" });
  svg.appendChild(modeLayer);

  iconRing = buildIconRing();
  svg.appendChild(iconRing);

  root.appendChild(svg);
  document.body.appendChild(root);
  setMode(mode);
}

function setMode(next) {
  mode = next;
  if (!modeLayer) return;
  while (modeLayer.firstChild) modeLayer.removeChild(modeLayer.firstChild);
  if (mode === "hsl") modeLayer.appendChild(buildHslMode());
  else if (mode === "rgb") modeLayer.appendChild(buildRgbMode());
  else if (mode === "markers") modeLayer.appendChild(buildMarkerMode());
  for (const btn of iconRing.querySelectorAll(".cp-mode-btn")) {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  }
  syncUi();
}

function syncUi() {
  if (mode === "hsl") syncHsl();
  else if (mode === "rgb") syncRgb();
  else if (mode === "markers") syncMarkers();
}

function setFromRgb(r, g, b) {
  const hsl = rgbToHsl(r, g, b);
  state.h = hsl.h;
  state.s = hsl.s;
  state.l = hsl.l;
  syncUi();
}

// --- Public API --------------------------------------------------------------

export function initColorPicker(onChange) {
  onChangeCb = onChange;
  if (!root) buildDom();
}

/** Attach a scene sampler used by the eyedropper: (screenX, screenY) -> {r,g,b}|null. */
export function setColorSampler(fn) {
  sampler = fn;
}

// The picker grows out of the wheel and folds back into it, so it has to stay
// mounted for the length of the collapse: display:none would cut the
// transition and make it vanish instead. `opened` is the real state, flipped
// the moment a close starts so the wheel's own rings can fade back in while
// the picker is still retracting.
const COLLAPSE_MS = 190;
let opened = false;
let hideTimer = null;

export function openColorPicker(anchorRect, color) {
  const { r, g, b } = parseColor(color);
  setFromRgb(r, g, b);
  clearTimeout(hideTimer);
  opened = true;
  root.classList.remove("hidden");
  // Center the overlay on the wheel hub.
  const cx = anchorRect.left + anchorRect.width / 2;
  const cy = anchorRect.top + anchorRect.height / 2;
  root.style.left = `${cx - SIZE / 2}px`;
  root.style.top = `${cy - SIZE / 2}px`;
  syncUi();
  requestAnimationFrame(() => root && opened && root.classList.add("open"));
}

export function closeColorPicker() {
  if (!root || !opened) return;
  opened = false;
  root.classList.remove("open");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (!opened) root.classList.add("hidden");
  }, COLLAPSE_MS);
}

export function isColorPickerOpen() {
  return opened;
}

/** True while the eyedropper is sampling (used by the app to suspend drawing). */
export function isEyedropperActive() {
  return eyedropperActive;
}
