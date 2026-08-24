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

// --- Marker palette (hue-family curated, no branding) --------------------

const MARKER_COLORS = (() => {
  const out = [];
  const hues = [4, 28, 48, 95, 150, 195, 225, 262, 305, 340];
  for (const h of hues) {
    for (const [s, l] of [[85, 38], [80, 55], [70, 72], [45, 86]]) {
      out.push(hslToHex(h, s, l));
    }
  }
  for (const l of [8, 22, 36, 50, 64, 78, 90, 98]) {
    out.push(hslToHex(220, 6, l));
  }
  return out;
})();

// Neutrals for the inner wheel rings: black/white/value steps + grays.
const NEUTRAL_RING = (() => {
  const out = [];
  // Value spectrum inner ring: black -> gray -> white.
  for (const l of [4, 12, 22, 32, 42, 52, 62, 72, 82, 90, 96, 100]) {
    out.push(hslToHex(0, 0, l));
  }
  // Warm + cool gray outer ring.
  const warms = [20, 35, 45, 55, 65, 75];
  const cools = [200, 215, 225, 235, 245, 260];
  for (let i = 0; i < warms.length; i++) {
    out.push(hslToHex(warms[i], 14, 18 + i * 13));
    out.push(hslToHex(cools[i], 12, 18 + i * 13));
  }
  return out;
})();

// --- Geometry ------------------------------------------------------------

const SIZE = 460;
const C = SIZE / 2;
const SVG_NS = "http://www.w3.org/2000/svg";

// Hub (center color disc) diameter is 108 in the wheel; the icon ring sits
// just outside it, mode rings outside that.
const ICON_R = 74;          // mode buttons travel here
const ICON_RING_R = 74;
const HUE_R = 128;          // HSL hue ring mid-radius
const HUE_W = 15;           // hue ring stroke width
const ARC_R = 172;          // S/L (and RGB) arc mid-radius
const ARC_W = 13;
const MARKER_R0 = 96;       // inner neutral ring
const MARKER_R1 = 133;      // gray ring
const MARKER_R2 = 176;      // hue family ring

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
let mode = "hsl"; // "markers" | "hsl" | "rgb"
let drag = null;  // active slider drag descriptor
let markerSpin = 0; // degrees of rotation applied to the marker wheel
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

const MODES = [
  { id: "markers", label: "Markers", icon: "◍" },
  { id: "hsl", label: "HSL", icon: "HSL" },
  { id: "rgb", label: "RGB", icon: "RGB" },
  { id: "dropper", label: "Eyedropper", icon: "⌖" },
];

function buildIconRing() {
  const g = svgEl("g", { class: "cp-icon-ring" });
  g.appendChild(svgEl("path", {
    d: ringPathD(ICON_RING_R),
    class: "cp-icon-track",
  }));
  MODES.forEach((m, i) => {
    const deg = 180 + i * (180 / (MODES.length - 1)); // arc across the bottom of the hub
    const p = polar(deg, ICON_R);
    const btn = svgEl("g", { class: "cp-mode-btn", "data-mode": m.id, cursor: "pointer" });
    btn.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: 16, class: "cp-mode-dot" }));
    const txt = svgEl("text", {
      x: p.x, y: p.y + (m.id === "dropper" || m.id === "markers" ? 4.5 : 3.5),
      class: "cp-mode-label",
      "text-anchor": "middle",
    });
    txt.textContent = m.icon;
    btn.appendChild(txt);
    btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (m.id === "dropper") {
        startEyedropper();
      } else {
        setMode(m.id);
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
  const satLabel = svgEl("text", { class: "cp-value cp-value-top", "text-anchor": "middle" });
  const lightLabel = svgEl("text", { class: "cp-value cp-value-bottom", "text-anchor": "middle" });
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
  const g = svgEl("g", { class: "cp-mode-layer cp-marker-wheel" });
  const spin = svgEl("g", { class: "cp-marker-spin" });
  g.appendChild(spin);

  // Concentric chip rings: neutrals inside, grays mid, hue families out.
  const rings = [
    { colors: NEUTRAL_RING.slice(0, 12), r: MARKER_R0, count: 12 },
    { colors: NEUTRAL_RING.slice(12), r: MARKER_R1, count: 12 },
    { colors: MARKER_COLORS, r: MARKER_R2, count: MARKER_COLORS.length },
  ];
  for (const ring of rings) {
    ring.colors.forEach((hex, i) => {
      const deg = (i / ring.count) * 360;
      const p = polar(deg, ring.r);
      const chip = svgEl("circle", {
        cx: p.x, cy: p.y, r: ring.r === MARKER_R2 ? 10 : 8,
        fill: hex, class: "cp-chip", cursor: "pointer",
      });
      chip.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        const { r, g: gg, b } = hexToRgb(hex);
        setFromRgb(r, gg, b);
        emit("commit");
      });
      spin.appendChild(chip);
    });
  }

  // Drag anywhere on the wheel (not on a chip) to spin it.
  let spinDrag = null;
  g.addEventListener("mousedown", (e) => {
    if (e.target.classList && e.target.classList.contains("cp-chip")) return;
    spinDrag = { lastY: e.clientY };
    e.preventDefault();
    e.stopPropagation();
  });
  const onMove = (e) => {
    if (!spinDrag) return;
    const dy = e.clientY - spinDrag.lastY;
    spinDrag.lastY = e.clientY;
    markerSpin += dy * 0.4;
    spin.setAttribute("transform", `rotate(${markerSpin} ${C} ${C})`);
  };
  const onUp = () => { spinDrag = null; };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  registerCleanup(() => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  });

  markerEls = { spin, g };
  return g;
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

function stopEyedropper() {
  eyedropperActive = false;
  if (loupeEl) { loupeEl.remove(); loupeEl = null; }
  if (eyedropperTeardown) { eyedropperTeardown(); eyedropperTeardown = null; }
}

// --- Cleanup registry ------------------------------------------------------------

let cleanups = [];
function registerCleanup(fn) { cleanups.push(fn); }
function runCleanups() {
  for (const fn of cleanups) { try { fn(); } catch { /* noop */ } }
  cleanups = [];
}

// --- Slider drag plumbing ---------------------------------------------------------

let activeSliderCleanup = null;

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
    return;
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
  // Invisible hit surface so clicks anywhere on the ring don't fall through
  // to the canvas; clicking empty space closes the overlay.
  svg.appendChild(svgEl("circle", { cx: C, cy: C, r: C, class: "cp-hit" }));
  svg.addEventListener("mousedown", (e) => e.stopPropagation());
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

export function openColorPicker(anchorRect, color) {
  const { r, g, b } = parseColor(color);
  setFromRgb(r, g, b);
  root.classList.remove("hidden");
  // Center the overlay on the wheel hub.
  const cx = anchorRect.left + anchorRect.width / 2;
  const cy = anchorRect.top + anchorRect.height / 2;
  root.style.left = `${cx - SIZE / 2}px`;
  root.style.top = `${cy - SIZE / 2}px`;
  syncUi();
  requestAnimationFrame(() => root && root.classList.add("open"));
}

export function closeColorPicker() {
  if (root) root.classList.add("hidden");
  if (root) root.classList.remove("open");
}

export function isColorPickerOpen() {
  return root ? !root.classList.contains("hidden") : false;
}

/** True while the eyedropper is sampling (used by the app to suspend drawing). */
export function isEyedropperActive() {
  return eyedropperActive;
}
