// ui/style-wheel.js
// Concepts-style control hub. One floating wheel carries everything: an
// outer tool ring, a property ring (size / opacity / smoothing) wrapped
// around a center color hub, undo/redo, and popovers for mediums and
// property presets.
//
// Layer contract (outside in):
//   tool ring      TOOL_R_IN..TOOL_R_OUT   pick a tool; re-click opens mediums
//   property ring  PROP_R                  drag to adjust; click to open presets
//   color hub      HUB_R                   click to open the color wheel
//
// Material contract: the wheel is drawn as one machined body, not stacked
// panels. Depth comes from a handful of shared gradients in buildDefs() --
// swgRaisedRim for anything standing proud of its surround, swgRecessRim for
// anything sunk into it -- all lit from the same upper-left direction. Adding
// a new surface means picking one of those two rims, not inventing a shadow.
//
// All state flows through ActiveStyleState (brush/active-brush.js). The hub
// subscribes to it; when exactly one element is selected the hub edits that
// element's style (undoable) and pushes the values back into the store so
// the rings reflect the selection (reverse inheritance).
//
// Smoothing is an input setting rather than stroke geometry, so it always
// targets the active brush and is never written onto element styles.
//
// Icon contract: every glyph is drawn by renderIcon() into a 24x24 box
// centered on a slot, so the inline paths below are swappable placeholders.
// Replacing one with finished artwork means returning an <image> (or a
// different <g>) from renderIcon for that key -- slot geometry, hit areas
// and interaction code do not need to change.

import { activeBrush, setBrush, subscribeStyle } from "../brush/active-brush.js";
import { BRUSH_PRESETS, getBrushPreset, isFilledMedium, widthRangeFor } from "../brush/presets.js";
import { ERASER_RANGE } from "../tools/erase.js";
import {
  TEXT_SIZE_RANGE, displayedTextSize, setTextSize, isEditingText,
} from "../tools/text.js";
import { StyleCommand, TransformCommand } from "../scene/scene.js";
import { touchElement } from "../render/ink-rev.js";
import {
  initColorPicker, openColorPicker, closeColorPicker, isColorPickerOpen,
  setColorSampler, isEyedropperActive, stopEyedropper,
  parseColor, rgbToHsl, hslToRgb, rgbToHex,
} from "./color-picker.js";
import { sampleScreen } from "../io/sampler.js";

const SIZE = 320;
const C = SIZE / 2;

// Ring radii. The wheel is read as machined material: a raised outer shell,
// a recessed inner surface, grooves cut into that surface, and a pocket in
// the middle holding the hub. Every radius below is a real edge in that
// section, so keep them ordered and keep the gaps between them intact.
const HUB_D = 100;           // center color hub diameter (CSS-sized)
const HUB_SOCKET_R = 57;     // pocket the hub sits down into
const PROP_R = 85;           // property groove center radius
const PROP_W = 7.5;          // carved groove width
const PROP_ICON_R = 70;      // property glyph, between the pocket and its groove
const PROP_READ_R = 99;      // property readout, just outside its groove
const TOOL_R_IN = 112;       // tool ring band
const TOOL_R_OUT = 150;
const TOOL_R = (TOOL_R_IN + TOOL_R_OUT) / 2;
const TOOL_DOT_R = 16;       // leaves an even margin inside the band
const RING_BTN_R = 12;
// How far a drag must push past the wheel's on-screen stop before it docks.
const COLLAPSE_PUSH = 36;
// The hide control hangs below the disc; keep that much room on screen.
const COLLAPSE_OVERHANG = 22;
const DOCK_SIZE = 44;

const SVG_NS = "http://www.w3.org/2000/svg";

// Brush previews. Every medium but one leaves a line, so the samples are the
// same gesture drawn both ways: as the trail a tip would leave, and as the
// area a fill would ink between the same two ends.
const HUB_SAMPLE_STROKE = "M6 21 C 22 4, 50 26, 66 9";
const HUB_SAMPLE_FILL =
  "M6 21 C 13 8, 26 5, 36 11 C 46 17, 57 14, 66 9 C 68 19, 56 26, 42 26 C 27 26, 12 26, 6 21 Z";
const MEDIA_SAMPLE_STROKE = "M3 14 C 14 2, 30 16, 53 5";
const MEDIA_SAMPLE_FILL =
  "M3 14 C 10 4, 20 11, 29 8 C 39 5, 47 8, 53 5 C 54 12, 45 16, 32 16 C 19 16, 8 17, 3 14 Z";

// Property arcs: three 90-degree sectors with 30-degree gaps, each sweeping
// clockwise so "further clockwise" always means "more". Angles may exceed 360;
// polar() is periodic and angleToT() normalizes the wrap.
//
// Size sits on top with the two modifiers flanking it. Smoothing takes the
// right sector and opacity the left so their default handles (smoothing 0,
// opacity 100%) land at opposite sides instead of colliding across one gap.
const SIZE_ARC = { start: 225, end: 315 };      // across the top
const SMOOTH_ARC = { start: 345, end: 435 };    // down the right side
const OPACITY_ARC = { start: 105, end: 195 };   // up the left side

const PROPS = [
  { key: "size", arc: SIZE_ARC, label: "Size", icon: "size" },
  { key: "smoothing", arc: SMOOTH_ARC, label: "Smoothing", icon: "smoothing" },
  { key: "opacity", arc: OPACITY_ARC, label: "Opacity", icon: "opacity" },
];

const PRESETS = {
  opacity: [0.15, 0.4, 0.7, 1],
  smoothing: [0, 0.33, 0.66, 1],
};

// Keyboard step per arrow press.
const KEY_STEP = { opacity: 0.05, smoothing: 0.05 };

// Tool slots share a 270-degree sweep that starts at the lower left and ends
// at the lower right. The step follows the slot count, so adding a tool
// tightens the spacing instead of landing on undo/redo, which sit in the
// gap left at the bottom.
const TOOL_START_DEG = 135;
const TOOL_SWEEP_DEG = 270;
const UNDO_DEG = 112.5;
const REDO_DEG = 67.5;

const TOOL_SLOTS = [
  { id: "select", label: "Select", kbd: "V", icon: "select", hasMedium: false },
  { id: "line", label: "Line", kbd: "L", icon: "line", hasMedium: true },
  { id: "rect", label: "Rect", kbd: "R", icon: "rect", hasMedium: true },
  { id: "circle", label: "Circle", kbd: "C", icon: "circle", hasMedium: true },
  { id: "pen", label: "Pen", kbd: "P", icon: "pen", hasMedium: true },
  { id: "text", label: "Text", kbd: "T", icon: "text", hasMedium: false },
  { id: "nudge", label: "Nudge", kbd: "N", icon: "nudge", hasMedium: false },
  { id: "slice", label: "Slice", kbd: "S", icon: "slice", hasMedium: false },
  { id: "eraser", label: "Eraser", kbd: "E", icon: "eraser", hasMedium: false },
];

let root = null;
let svg = null;
let hubBtn = null;
let hubFill = null;
let hubStroke = null;
let hubHex = null;
let toolRing = null;
let popover = null;
let tooltip = null;

let appRef = null;
let dragging = null;     // "size" | "opacity" | "smoothing" | "move" | null
let pressCandidate = null; // pending press that may become a drag or a click
let moveOffset = { x: 0, y: 0 };
let movePointerId = null;  // finger or pen that is dragging the wheel
let dragStartPos = null;   // wheel origin when a move drag began
let collapsed = false;
let restorePos = null;
let dockAnchor = null;
let dock = null;
let dockEdge = "left";
let pendingStyleCmd = null;
let pendingTextCmd = null;
let openPopoverKind = null; // "medium" | "size" | "opacity" | "smoothing" | null
let popoverPinned = false;  // true after a click; hover-peek leaves it transient
let hoverTimer = null;
let hoverOutTimer = null;

const propEls = {}; // key -> { group, track, fill, handle, readout }

// --- Value mapping ---------------------------------------------------------

function usesTextSize() {
  if (isEditingText()) return true;
  if (activeBrush.toolType === "text") return true;
  return singleSelection()?.type === "text";
}

function sizeRange() {
  if (activeBrush.toolType === "eraser") return ERASER_RANGE;
  if (usesTextSize()) return TEXT_SIZE_RANGE;
  return widthRangeFor(currentStyle().medium);
}

function widthToT(w) {
  const { min, max } = sizeRange();
  const span = Math.max(1e-6, max - min);
  return clamp01(Math.sqrt(Math.max(0, (w - min) / span)));
}
function tToWidth(t) {
  const { min, max } = sizeRange();
  return min + t * t * (max - min);
}

function presetList(kind) {
  return kind === "size" ? sizeRange().presets : PRESETS[kind];
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function roundWidth(w) { return Math.round(w * 10) / 10; }

function polar(deg, r) {
  const rad = (deg * Math.PI) / 180;
  return { x: C + Math.cos(rad) * r, y: C + Math.sin(rad) * r };
}

function arcPathD(startDeg, endDeg, r) {
  const a = polar(startDeg, r);
  const b = polar(endDeg, r);
  const span = endDeg - startDeg;
  const large = Math.abs(span) > 180 ? 1 : 0;
  const sweep = span >= 0 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} ${sweep} ${b.x} ${b.y}`;
}

function arcValueToDeg(arc, t) {
  return arc.start + clamp01(t) * (arc.end - arc.start);
}

function pointerAngle(e) {
  const rect = svg.getBoundingClientRect();
  const dx = e.clientX - (rect.left + rect.width / 2);
  const dy = e.clientY - (rect.top + rect.height / 2);
  return ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
}

/**
 * Pointer angle -> 0..1 along the arc, snapping to the nearer end when the
 * pointer is outside the sweep. Works for arcs defined in either direction.
 */
function angleToT(arc, deg) {
  const span = arc.end - arc.start;
  const dir = span < 0 ? -1 : 1;
  const mag = Math.abs(span);
  const d = ((((deg - arc.start) * dir) % 360) + 360) % 360;
  if (d <= mag) return d / mag;
  return d - mag < 360 - d ? 1 : 0;
}

// --- Icons -----------------------------------------------------------------
// Placeholder line art on a 24x24 grid. See the icon contract at the top.

const ICONS = {
  select: [{ tag: "path", d: "M6 3.5 L6 19 L10.4 14.6 L13.2 20.8 L15.7 19.6 L12.9 13.5 L19 13 Z", filled: true }],
  line: [{ tag: "path", d: "M4.5 19.5 L19.5 4.5" }],
  rect: [{ tag: "rect", x: 4, y: 6.5, width: 16, height: 11, rx: 1 }],
  circle: [{ tag: "circle", cx: 12, cy: 12, r: 7.8 }],
  pen: [
    { tag: "path", d: "M4 20 L6.4 14.2 L16.2 4.4 L19.6 7.8 L9.8 17.6 Z" },
    { tag: "path", d: "M14.4 6.2 L17.8 9.6" },
  ],
  text: [
    { tag: "path", d: "M5 5.5 H19" },
    { tag: "path", d: "M12 5.5 V18.5" },
    { tag: "path", d: "M8 18.5 H16" },
  ],
  nudge: [
    { tag: "path", d: "M3 16.5 C 7.5 7.5, 16.5 7.5, 21 16.5" },
    { tag: "path", d: "M12 4.2 L12 11.6" },
    { tag: "path", d: "M9.2 8.8 L12 11.6 L14.8 8.8" },
  ],
  slice: [
    { tag: "path", d: "M3 12 L9 12" },
    { tag: "path", d: "M15 12 L21 12" },
    { tag: "path", d: "M10 7 L14 17" },
  ],
  eraser: [
    { tag: "path", d: "M8.2 19.2 L4.4 15.4 L13.6 6.2 L17.4 10 Z" },
    { tag: "path", d: "M12.4 7.4 L15.6 10.6" },
  ],
  undo: [
    { tag: "path", d: "M8.5 8 H14.5 A5 5 0 1 1 14.5 18 H9" },
    { tag: "path", d: "M11.4 5 L8.4 8 L11.4 11" },
  ],
  redo: [
    { tag: "path", d: "M15.5 8 H9.5 A5 5 0 1 0 9.5 18 H15" },
    { tag: "path", d: "M12.6 5 L15.6 8 L12.6 11" },
  ],
  size: [
    { tag: "path", d: "M4 8 L20 8", "stroke-width": 1.1 },
    { tag: "path", d: "M4 15.5 L20 15.5", "stroke-width": 3.6 },
  ],
  opacity: [
    { tag: "circle", cx: 12, cy: 12, r: 7.6 },
    { tag: "path", d: "M12 4.4 A 7.6 7.6 0 0 1 12 19.6 Z", filled: true },
  ],
  smoothing: [
    { tag: "path", d: "M3 15.5 C 6.2 8, 9.4 8, 12 12 S 17.8 16.4, 21 9" },
  ],
};

/**
 * Draw an icon centered at (cx, cy) inside a `box`-pixel square. Swap the
 * body of this function to move a glyph over to finished raster artwork.
 */
function renderIcon(name, cx, cy, box) {
  const shapes = ICONS[name];
  const g = svgEl("g", { class: "sw-icon" });
  if (!shapes) return g;
  const s = box / 24;
  g.setAttribute("transform", `translate(${cx} ${cy}) scale(${s}) translate(-12 -12)`);
  for (const shape of shapes) {
    const { tag, filled, ...attrs } = shape;
    // Per-shape weights go inline so the shared class default doesn't win.
    const ownWidth = attrs["stroke-width"];
    delete attrs["stroke-width"];
    const el = svgEl(tag, attrs);
    el.setAttribute("class", filled ? "sw-icon-solid" : "sw-icon-line");
    if (ownWidth !== undefined) el.style.strokeWidth = String(ownWidth);
    g.appendChild(el);
  }
  return g;
}

// --- Style targets -----------------------------------------------------------

function singleSelection() {
  if (!appRef) return null;
  const sel = appRef.scene.getSelected();
  return sel.length === 1 ? sel[0] : null;
}

function currentStyle() {
  const el = singleSelection();
  return el ? el.style : activeBrush;
}

function beginStyleEdit(key) {
  if (key === "size" && usesTextSize()) {
    const el = singleSelection();
    if (!isEditingText() && activeBrush.toolType !== "text" && el?.type === "text") {
      pendingTextCmd = new TransformCommand();
      pendingTextCmd.begin([el]);
    }
    return;
  }
  const el = singleSelection();
  if (el) {
    pendingStyleCmd = new StyleCommand();
    pendingStyleCmd.begin([el]);
  }
}

function applyStylePatch(patch) {
  const el = singleSelection();
  if (el) {
    Object.assign(el.style, patch);
    touchElement(el);
  } else setBrush(patch);
}

function commitStyleEdit() {
  const el = singleSelection();
  if (el && pendingStyleCmd) {
    pendingStyleCmd.end([el]);
    if (pendingStyleCmd.changed()) appRef.history.push(pendingStyleCmd);
  }
  pendingStyleCmd = null;
  if (pendingTextCmd) {
    const text = singleSelection();
    if (text?.type === "text") {
      pendingTextCmd.end([text]);
      const rec = pendingTextCmd.records[0];
      if (rec?.before && rec.after && rec.before.size !== rec.after.size) {
        appRef.history.push(pendingTextCmd);
      }
    }
    pendingTextCmd = null;
  }
}

// --- Property values ---------------------------------------------------------
// Size and opacity live on the edit target (selection or brush); smoothing is
// an input preference and always lives on the brush.

function propValue(key) {
  const st = currentStyle();
  if (key === "size" && activeBrush.toolType === "eraser") {
    return activeBrush.eraserWidth ?? ERASER_RANGE.min;
  }
  if (key === "size" && usesTextSize()) {
    return displayedTextSize(singleSelection(), activeBrush.toolType === "text");
  }
  if (key === "size") return st.strokeWidth ?? activeBrush.strokeWidth;
  if (key === "opacity") return st.opacity ?? 1;
  return activeBrush.smoothing ?? 0;
}

/** Normalized 0..1 position of a property on its arc. */
function propT(key) {
  if (key === "size") return widthToT(propValue("size"));
  return clamp01(propValue(key));
}

/** Split into number and unit so the readout can dim the unit on its own. */
function propParts(key) {
  if (key === "size") return { value: String(roundWidth(propValue("size"))), unit: "px" };
  return { value: String(Math.round(propValue(key) * 100)), unit: "%" };
}

function propText(key) {
  const { value, unit } = propParts(key);
  return unit === "%" ? `${value}%` : `${value} ${unit}`;
}

function setPropFromT(key, t) {
  if (key === "size") setSize(roundWidth(tToWidth(clamp01(t))));
  else if (key === "opacity") applyStylePatch({ opacity: clamp01(t) });
  else setBrush({ smoothing: clamp01(t) });
}

function setSize(width) {
  if (activeBrush.toolType === "eraser") setBrush({ eraserWidth: Math.round(width) });
  else if (usesTextSize()) {
    const size = setTextSize(width);
    const el = singleSelection();
    if (!isEditingText() && activeBrush.toolType !== "text" && el?.type === "text") {
      el.size = size;
      touchElement(el);
    }
  }
  else applyStylePatch({ strokeWidth: width });
}

function setPropValue(key, v) {
  if (key === "size") {
    const { min, max } = sizeRange();
    setSize(roundWidth(Math.max(min, Math.min(max, v))));
  }
  else if (key === "opacity") applyStylePatch({ opacity: clamp01(v) });
  else setBrush({ smoothing: clamp01(v) });
}

/** Smoothing is not element geometry, so it never needs an undo record. */
function isUndoable(key) { return key !== "smoothing"; }

/**
 * Size describes a tip, and a fill has none — how far it reaches is decided
 * by the path you draw. The groove stays in its slot but goes inert rather
 * than letting you set a number that changes nothing on screen. The value
 * itself is kept, so switching back to an outline medium restores the weight.
 */
function isPropInert(key) {
  if (key === "size" && (activeBrush.toolType === "eraser" || usesTextSize())) return false;
  return key === "size" && isFilledMedium(currentStyle().medium);
}

// --- DOM ---------------------------------------------------------------------

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
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
 * The wheel's whole sense of depth lives here. One light source, up and to
 * the left of center, so every rim gradient runs on the same 0.2,0 -> 0.8,1
 * diagonal: raised edges catch it at the top, recessed edges catch it at the
 * bottom. Tonal steps are deliberately tiny -- the material should read as
 * machined charcoal, not as a lit sphere.
 */
function buildDefs() {
  const defs = svgEl("defs", {});
  defs.appendChild(svgFragment(`
    <radialGradient id="swgBody" cx="36%" cy="26%" r="86%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.045"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.012"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.13"/>
    </radialGradient>

    <linearGradient id="swgRaisedRim" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.2"/>
      <stop offset="0.4" stop-color="#ffffff" stop-opacity="0.05"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.5"/>
    </linearGradient>

    <linearGradient id="swgRecessRim" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0.6"/>
      <stop offset="0.55" stop-color="#000000" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.085"/>
    </linearGradient>

    <radialGradient id="swgWellShade" cx="50%" cy="50%" r="50%">
      <stop offset="0.82" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.34"/>
    </radialGradient>

    <radialGradient id="swgSocketShade" cx="50%" cy="50%" r="50%">
      <stop offset="0.58" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.42"/>
    </radialGradient>

    <linearGradient id="swgPadIn" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0.32"/>
      <stop offset="0.7" stop-color="#000000" stop-opacity="0.03"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.05"/>
    </linearGradient>

    <linearGradient id="swgPadUp" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.085"/>
      <stop offset="0.62" stop-color="#ffffff" stop-opacity="0.014"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.22"/>
    </linearGradient>

    <linearGradient id="swgPadRimIn" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0.62"/>
      <stop offset="0.6" stop-color="#000000" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0.09"/>
    </linearGradient>

    <linearGradient id="swgPadRimUp" x1="0.25" y1="0" x2="0.75" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.26"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.55"/>
    </linearGradient>

    <linearGradient id="swgKnob" x1="0.3" y1="0" x2="0.7" y2="1">
      <stop offset="0" stop-color="#f2f4f8"/>
      <stop offset="0.52" stop-color="#d3d7df"/>
      <stop offset="1" stop-color="#a8adb8"/>
    </linearGradient>

    <radialGradient id="swgKnobCast" cx="50%" cy="50%" r="50%">
      <stop offset="0.52" stop-color="#000000" stop-opacity="0.42"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <!-- Fine grain over the body so the charcoal isn't perfectly sterile. -->
    <filter id="swgGrain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.92" numOctaves="2" seed="11" stitchTiles="stitch"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.64  0 0 0 0 0.65  0 0 0 0 0.7  0 0 0 1 0"/>
    </filter>

    <clipPath id="swgDisc"><circle cx="${C}" cy="${C}" r="${TOOL_R_OUT}"/></clipPath>
  `));
  return defs;
}

function buildToolRing() {
  toolRing = svgEl("g", { class: "sw-toolring" });

  // Section of the body, outside in. The solid fills also shield the canvas
  // from clicks aimed at the wheel.
  toolRing.appendChild(svgEl("circle", { cx: C, cy: C, r: TOOL_R_OUT, class: "sw-body" }));
  toolRing.appendChild(svgEl("circle", {
    cx: C, cy: C, r: TOOL_R_OUT, class: "sw-body-shade", fill: "url(#swgBody)",
  }));
  toolRing.appendChild(svgEl("circle", { cx: C, cy: C, r: TOOL_R_IN, class: "sw-well" }));
  toolRing.appendChild(svgEl("circle", {
    cx: C, cy: C, r: TOOL_R_IN, class: "sw-well-shade", fill: "url(#swgWellShade)",
  }));

  // Grain sits above the two broad surfaces and below every control, so the
  // material looks textured while the controls stay crisp.
  const grain = svgEl("g", { class: "sw-grain", "clip-path": "url(#swgDisc)" });
  grain.appendChild(svgEl("rect", {
    x: C - TOOL_R_OUT, y: C - TOOL_R_OUT, width: TOOL_R_OUT * 2, height: TOOL_R_OUT * 2,
    filter: "url(#swgGrain)",
  }));
  toolRing.appendChild(grain);

  // Band behind the tools (also the reposition drag surface).
  toolRing.appendChild(svgEl("circle", {
    cx: C, cy: C, r: TOOL_R,
    fill: "none", "stroke-width": TOOL_R_OUT - TOOL_R_IN,
    class: "sw-band",
  }));

  // Edges: the body stands proud of the canvas, the well is sunk into it.
  toolRing.appendChild(svgEl("circle", {
    cx: C, cy: C, r: TOOL_R_OUT - 0.5, class: "sw-body-rim", stroke: "url(#swgRaisedRim)",
  }));
  toolRing.appendChild(svgEl("circle", { cx: C, cy: C, r: TOOL_R_OUT - 4.5, class: "sw-body-bevel" }));
  toolRing.appendChild(svgEl("circle", {
    cx: C, cy: C, r: TOOL_R_IN, class: "sw-well-rim", stroke: "url(#swgRecessRim)",
  }));

  // Pocket the color hub drops into. The hub element itself covers all but a
  // few pixels of it, leaving just the shoulder visible.
  toolRing.appendChild(svgEl("circle", { cx: C, cy: C, r: HUB_SOCKET_R, class: "sw-socket" }));
  toolRing.appendChild(svgEl("circle", {
    cx: C, cy: C, r: HUB_SOCKET_R, class: "sw-socket-shade", fill: "url(#swgSocketShade)",
  }));
  toolRing.appendChild(svgEl("circle", {
    cx: C, cy: C, r: HUB_SOCKET_R - 0.5, class: "sw-socket-rim", stroke: "url(#swgRecessRim)",
  }));

  const toolStep = TOOL_SWEEP_DEG / (TOOL_SLOTS.length - 1);
  TOOL_SLOTS.forEach((t, i) => {
    const deg = TOOL_START_DEG + i * toolStep;
    const p = polar(deg, TOOL_R);
    const btn = svgEl("g", {
      class: "sw-tool", "data-tool": t.id, cursor: "pointer",
      tabindex: "0", role: "button", "aria-label": `${t.label} tool (${t.kbd})`,
    });
    btn.appendChild(buildPad(p.x, p.y, TOOL_DOT_R));
    btn.appendChild(renderIcon(t.icon, p.x, p.y, 18));
    // Small outward tick marks the active slot even at a glance; it is the
    // one place the working color is allowed outside the hub.
    const tickA = polar(deg, TOOL_R_OUT - 6);
    const tickB = polar(deg, TOOL_R_OUT - 2.5);
    btn.appendChild(svgEl("line", {
      x1: tickA.x, y1: tickA.y, x2: tickB.x, y2: tickB.y, class: "sw-tool-tick",
    }));

    btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      hideTooltip();
      onToolSlot(t);
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onToolSlot(t);
      }
    });
    btn.addEventListener("mouseenter", (e) => {
      showTooltip(`${t.label} · ${t.kbd}`, e.clientX, e.clientY);
    });
    btn.addEventListener("mousemove", (e) => positionTooltip(e.clientX, e.clientY));
    btn.addEventListener("mouseleave", hideTooltip);
    toolRing.appendChild(btn);
  });

  // Undo / redo sit in the gap left at the bottom of the tool sweep.
  toolRing.appendChild(buildRingBtn("undo", UNDO_DEG, "Undo"));
  toolRing.appendChild(buildRingBtn("redo", REDO_DEG, "Redo"));
  return toolRing;
}

/**
 * A control pad milled into the tool band: flat base, directional face, and
 * a rim that flips from recessed to raised via CSS when the slot goes active.
 */
function buildPad(cx, cy, r) {
  const g = svgEl("g", { class: "sw-pad" });
  g.appendChild(svgEl("circle", { cx, cy, r, class: "sw-pad-base" }));
  g.appendChild(svgEl("circle", { cx, cy, r, class: "sw-pad-face" }));
  g.appendChild(svgEl("circle", { cx, cy, r: r - 0.5, class: "sw-pad-rim" }));
  g.appendChild(svgEl("circle", { cx, cy, r: r - 0.5, class: "sw-pad-sel" }));
  return g;
}

function buildRingBtn(id, deg, label) {
  const p = polar(deg, TOOL_R);
  const btn = svgEl("g", {
    class: "sw-ringbtn", "data-action": id, cursor: "pointer",
    tabindex: "0", role: "button", "aria-label": label,
  });
  btn.appendChild(buildPad(p.x, p.y, RING_BTN_R));
  btn.appendChild(renderIcon(id, p.x, p.y, 14));

  const run = () => {
    if (!appRef) return;
    if (id === "undo") appRef.history.undo(appRef.scene);
    else appRef.history.redo(appRef.scene);
    syncUi(true);
  };
  btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener("click", (e) => { e.stopPropagation(); hideTooltip(); run(); });
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); run(); }
  });
  btn.addEventListener("mouseenter", (e) => {
    showTooltip(id === "undo" ? "Undo · Ctrl+Z" : "Redo · Ctrl+Shift+Z", e.clientX, e.clientY);
  });
  btn.addEventListener("mousemove", (e) => positionTooltip(e.clientX, e.clientY));
  btn.addEventListener("mouseleave", hideTooltip);
  return btn;
}

function onToolSlot(slot) {
  const wasActive = activeBrush.toolType === slot.id;
  if (appRef && appRef.setActiveTool) appRef.setActiveTool(slot.id);
  else setBrush({ toolType: slot.id });
  // Re-clicking an active drawing tool opens its medium list, like Concepts'
  // "tap the active tool again for brushes". Tools without a medium just stay.
  if (wasActive && slot.hasMedium) togglePopover("medium", true);
  else closePopover();
}

/**
 * Slider knob. Children sit at the local origin so syncUi only has to move
 * the wrapper, and so the inner group can scale about its own center on
 * hover without fighting that translate.
 */
function buildKnob() {
  const g = svgEl("g", { class: "sw-knob", cursor: "grab" });
  g.appendChild(svgEl("circle", { r: 8.6, cy: 1.2, class: "sw-knob-cast", fill: "url(#swgKnobCast)" }));
  const body = svgEl("g", { class: "sw-knob-body" });
  body.appendChild(svgEl("circle", { r: 6.2, class: "sw-knob-face", fill: "url(#swgKnob)" }));
  body.appendChild(svgEl("circle", { r: 6.2, class: "sw-knob-edge" }));
  body.appendChild(svgEl("path", { d: "M -3.7 -3.5 A 5.1 5.1 0 0 1 3.7 -3.5", class: "sw-knob-gloss" }));
  body.appendChild(svgEl("circle", { r: 1.15, class: "sw-knob-dimple" }));
  g.appendChild(body);
  return g;
}

function buildPropRing() {
  const g = svgEl("g", { class: "sw-propring" });

  for (const def of PROPS) {
    const group = svgEl("g", {
      class: `sw-prop sw-prop-${def.key}`,
      tabindex: "0", role: "slider", "aria-label": def.label,
      "aria-valuemin": "0", "aria-valuemax": "100",
    });

    // Wide transparent path gives the thin track a comfortable hit area.
    const hit = svgEl("path", {
      d: arcPathD(def.arc.start, def.arc.end, PROP_R),
      class: "sw-track-hit", cursor: "pointer",
    });
    const d = arcPathD(def.arc.start, def.arc.end, PROP_R);
    group.appendChild(hit);

    // The groove is a channel cut into the well: a dark floor between a lit
    // outer lip and a shadowed inner wall.
    group.appendChild(svgEl("path", { d, class: "sw-groove" }));
    group.appendChild(svgEl("path", {
      d: arcPathD(def.arc.start, def.arc.end, PROP_R + PROP_W / 2),
      class: "sw-groove-lip",
    }));
    group.appendChild(svgEl("path", {
      d: arcPathD(def.arc.start, def.arc.end, PROP_R - PROP_W / 2),
      class: "sw-groove-wall",
    }));

    const track = svgEl("path", { d, class: "sw-track" });
    const fill = svgEl("path", { class: "sw-fill", d: "" });
    group.appendChild(track);
    group.appendChild(fill);

    // Preset detents, notched across the groove floor so they stay readable
    // on both the travelled and untravelled side of the handle.
    const ticks = presetList(def.key).map(() => {
      const line = svgEl("line", { class: "sw-prop-tick" });
      group.appendChild(line);
      return line;
    });

    const handle = buildKnob();
    group.appendChild(handle);

    // Glyph just inside the groove, readout just outside it, both hugging
    // their own track so the pairing is unambiguous.
    const midDeg = (def.arc.start + def.arc.end) / 2;
    const iconP = polar(midDeg, PROP_ICON_R);
    group.appendChild(renderIcon(def.icon, iconP.x, iconP.y, 13));

    const readout = svgEl("text", { class: "sw-readout", "text-anchor": "middle" });
    const readP = polar(midDeg, PROP_READ_R);
    readout.setAttribute("x", readP.x);
    readout.setAttribute("y", readP.y + 3.2);
    group.appendChild(readout);

    // A press may become a drag (adjust) or a click (open presets); the value
    // is only touched once the pointer actually moves, so opening the panel
    // never nudges the setting.
    const onPress = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isPropInert(def.key)) return;
      pressCandidate = { key: def.key, x: e.clientX, y: e.clientY };
      cancelHoverPeek();
    };
    hit.addEventListener("mousedown", onPress);
    handle.addEventListener("mousedown", onPress);
    readout.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      cancelHoverPeek();
      if (isPropInert(def.key)) return;
      togglePopover(def.key, true);
    });

    group.addEventListener("mouseenter", (e) => {
      if (!isPropInert(def.key)) scheduleHoverPeek(def.key);
      showTooltip(`${def.label} · ${propText(def.key)}`, e.clientX, e.clientY);
    });
    group.addEventListener("mousemove", (e) => {
      if (tooltip && tooltip.classList.contains("visible")) {
        tooltip.textContent = `${def.label} · ${propText(def.key)}`;
        positionTooltip(e.clientX, e.clientY);
      }
    });
    group.addEventListener("mouseleave", () => { scheduleHoverDismiss(); hideTooltip(); });

    group.addEventListener("keydown", (e) => {
      if (isPropInert(def.key)) return;
      const step = def.key === "size" ? sizeRange().step : KEY_STEP[def.key];
      let next = null;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") next = propValue(def.key) + step;
      else if (e.key === "ArrowDown" || e.key === "ArrowLeft") next = propValue(def.key) - step;
      else if (e.key === "Home") next = def.key === "size" ? sizeRange().min : 0;
      else if (e.key === "End") next = def.key === "size" ? sizeRange().max : 1;
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        togglePopover(def.key, true);
        return;
      }
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (isUndoable(def.key)) beginStyleEdit(def.key);
      setPropValue(def.key, next);
      if (isUndoable(def.key)) commitStyleEdit();
      syncUi(true);
    });

    g.appendChild(group);
    propEls[def.key] = { group, track, fill, handle, readout, arc: def.arc, ticks };
  }
  return g;
}

function buildHub() {
  hubBtn = document.createElement("button");
  hubBtn.id = "wheelColor";
  hubBtn.type = "button";
  hubBtn.title = "Color — click to open the color wheel";
  hubBtn.setAttribute("aria-label", "Color");
  hubBtn.style.width = `${HUB_D}px`;
  hubBtn.style.height = `${HUB_D}px`;

  // Checker plate under the color so opacity reads visually, then the color
  // itself, then a live stroke sample and the hex value.
  const checker = document.createElement("span");
  checker.className = "wheel-hub-checker";
  hubFill = document.createElement("span");
  hubFill.className = "wheel-hub-fill";

  const strokeWrap = document.createElementNS(SVG_NS, "svg");
  strokeWrap.setAttribute("class", "wheel-hub-sample");
  strokeWrap.setAttribute("viewBox", "0 0 72 30");
  hubStroke = svgEl("path", { d: HUB_SAMPLE_STROKE, class: "wheel-hub-sample-path" });
  strokeWrap.appendChild(hubStroke);

  hubHex = document.createElement("span");
  hubHex.className = "wheel-hub-hex";

  hubBtn.append(checker, hubFill, strokeWrap, hubHex);
  return hubBtn;
}

function buildDom() {
  root = document.createElement("div");
  root.id = "styleWheel";
  root.style.width = `${SIZE}px`;
  root.style.height = `${SIZE}px`;

  svg = svgEl("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE });
  svg.appendChild(buildDefs());
  svg.appendChild(buildToolRing());
  svg.appendChild(buildPropRing());
  root.appendChild(svg);
  root.appendChild(buildHub());
  root.appendChild(buildCollapseButton());

  document.body.appendChild(root);
  dock = buildDockButton();
  document.body.appendChild(dock);
  restorePosition();
  clampIntoViewport();

  // Reposition drag on the tool band. Pointer events so a finger or a pen
  // can move the wheel; a mouse still arrives as a pointer too.
  const band = toolRing.querySelector(".sw-band");
  band.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    dragging = "move";
    movePointerId = e.pointerId;
    const rect = root.getBoundingClientRect();
    dragStartPos = { x: rect.left, y: rect.top };
    moveOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    closePopover();
    hideTooltip();
    root.classList.add("dragging");
    e.preventDefault();
    e.stopPropagation();
    try { band.setPointerCapture(e.pointerId); } catch { /* already released */ }
  });

  window.addEventListener("pointermove", (e) => {
    if (movePointerId === null || e.pointerId !== movePointerId) return;
    onWindowMouseMove(e);
  });
  window.addEventListener("pointerup", endWheelMove);
  window.addEventListener("pointercancel", endWheelMove);

  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mouseup", onWindowMouseUp);

  hubBtn.addEventListener("mousedown", (e) => e.stopPropagation());
  hubBtn.addEventListener("click", () => {
    closePopover();
    hideTooltip();
    if (isColorPickerOpen()) {
      closeColorLayer();
      return;
    }
    ensureRoomForRings();
    openColorPicker(hubBtn.getBoundingClientRect(), currentStyle().stroke);
    syncColorLayerState();
  });

  // Pressing outside the hub dismisses transient layers.
  document.addEventListener("mousedown", () => {
    if (isColorPickerOpen()) closeColorLayer();
    closePopover();
  });
  root.addEventListener("mousedown", (e) => e.stopPropagation());

  // Escape unwinds one layer at a time: eyedropper, color wheel, popover.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (isEyedropperActive()) { stopEyedropper(); e.stopPropagation(); return; }
    if (isColorPickerOpen()) { closeColorLayer(); e.stopPropagation(); return; }
    if (openPopoverKind) { closePopover(); e.stopPropagation(); }
  }, true);

  initColorPicker((hex, phase) => {
    if (!pendingStyleCmd && singleSelection()) beginStyleEdit();
    applyStylePatch({ stroke: hex });
    if (phase === "commit") commitStyleEdit();
    syncUi(true);
  });

  // Re-render whenever the shared style state changes (tool ring highlight,
  // property ring positions, hub color all derive from it).
  subscribeStyle(() => syncUi(true));

  window.addEventListener("resize", () => {
    if (collapsed) placeDock(dockEdge);
    else clampIntoViewport();
    if (popover) positionPopover();
  });
}

const DRAG_THRESHOLD_PX = 3;

function onWindowMouseMove(e) {
  if (pressCandidate && !dragging) {
    const moved = Math.hypot(e.clientX - pressCandidate.x, e.clientY - pressCandidate.y);
    if (moved < DRAG_THRESHOLD_PX) return;
    dragging = pressCandidate.key;
    closePopover();
    hideTooltip();
    if (isUndoable(dragging)) beginStyleEdit(dragging);
    root.classList.add("dragging");
  }
  if (!dragging) return;
  if (dragging === "move") {
    const rawX = e.clientX - moveOffset.x;
    const rawY = e.clientY - moveOffset.y;
    // Pushing past the edge it is already stopped against docks the wheel.
    // A stroke never does this; only this explicit drag does.
    const edge = overdragEdge(rawX, rawY);
    if (edge) {
      collapseWheel(edge);
      return;
    }
    placeWheel(rawX, rawY);
  } else {
    updatePropFromPointer(e);
  }
}

function endWheelMove(e) {
  if (movePointerId === null || e.pointerId !== movePointerId) return;
  movePointerId = null;
  onWindowMouseUp();
}

function onWindowMouseUp() {
  if (dragging === "move") {
    savePosition();
  } else if (dragging) {
    if (isUndoable(dragging)) commitStyleEdit();
  } else if (pressCandidate) {
    // Released without moving: treat as a click and pin the preset panel.
    togglePopover(pressCandidate.key, true);
  }
  if (dragging) root.classList.remove("dragging");
  dragging = null;
  pressCandidate = null;
}

function updatePropFromPointer(e) {
  setPropFromT(dragging, angleToT(propEls[dragging].arc, pointerAngle(e)));
  syncUi(true);
}

// --- Placement ---------------------------------------------------------------

function savePosition() {
  const rect = root.getBoundingClientRect();
  localStorage.setItem("vda.wheelPos", JSON.stringify({ x: rect.left, y: rect.top }));
}

function restorePosition() {
  const saved = localStorage.getItem("vda.wheelPos");
  if (!saved) return;
  try {
    const { x, y } = JSON.parse(saved);
    placeWheel(x, y);
  } catch { /* ignore corrupt state */ }
}

/** Top-right corner reserved for the settings gear, in CSS pixels. */
const GEAR_CLEAR = 56;
/** Top-left corner reserved for the Home control. */
const HOME_CLEAR_X = 96;
const HOME_CLEAR_Y = 64;

function wheelLimits() {
  return {
    maxX: Math.max(0, window.innerWidth - SIZE),
    maxY: Math.max(0, window.innerHeight - SIZE - COLLAPSE_OVERHANG),
  };
}

/**
 * Keep the wheel on screen, and keep its disc out from under the settings
 * gear. A small window otherwise slides the wheel into that corner and the
 * gear disappears into the dark body.
 */
function fitWheel(x, y) {
  const { maxX, maxY } = wheelLimits();
  x = Math.max(0, Math.min(x, maxX));
  y = Math.max(0, Math.min(y, maxY));

  const gearLeft = window.innerWidth - GEAR_CLEAR;
  const overlapsGear = x + SIZE > gearLeft && y < GEAR_CLEAR;
  if (overlapsGear) {
    const below = GEAR_CLEAR;
    const leftOf = gearLeft - SIZE;
    if (below <= maxY) y = Math.max(y, below);
    else if (leftOf >= 0) x = Math.min(x, leftOf);
  }

  const overlapsHome = x < HOME_CLEAR_X && y < HOME_CLEAR_Y;
  if (overlapsHome) {
    if (HOME_CLEAR_Y <= maxY) y = Math.max(y, HOME_CLEAR_Y);
    else if (HOME_CLEAR_X <= maxX) x = Math.max(x, HOME_CLEAR_X);
  }
  return { x, y };
}

function placeWheel(x, y) {
  const fitted = fitWheel(x, y);
  root.style.left = `${fitted.x}px`;
  root.style.top = `${fitted.y}px`;
  root.style.transform = "none";
  updateCollapseEdge();
}

/** Keep the wheel fully on screen after a viewport change.
 *  Home hides the wheel with display:none, and a hidden box reports a
 *  zero rect. Clamping that would pin the wheel to the corner. */
function clampIntoViewport() {
  if (!root || collapsed) return;
  const rect = root.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  const fitted = fitWheel(rect.left, rect.top);
  if (Math.abs(fitted.x - rect.left) >= 0.5 || Math.abs(fitted.y - rect.top) >= 0.5) {
    root.style.left = `${fitted.x}px`;
    root.style.top = `${fitted.y}px`;
    root.style.transform = "none";
  }
  updateCollapseEdge();
}

function nearestEdge(rect) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const options = [
    ["left", cx],
    ["right", window.innerWidth - cx],
    ["top", cy],
    ["bottom", window.innerHeight - cy],
  ];
  options.sort((a, b) => a[1] - b[1]);
  return options[0][0];
}

function updateCollapseEdge() {
  if (!root || collapsed) return;
  const rect = root.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  root.dataset.edge = nearestEdge(rect);
}

function overdragEdge(rawX, rawY) {
  const { maxX, maxY } = wheelLimits();
  const options = [
    ["left", -rawX],
    ["right", rawX - maxX],
    ["top", -rawY],
    ["bottom", rawY - maxY],
  ];
  options.sort((a, b) => b[1] - a[1]);
  return options[0][1] > COLLAPSE_PUSH ? options[0][0] : null;
}

function chevronSvg() {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "18");
  icon.setAttribute("height", "18");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M7 10 L12 15 L17 10");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.7");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  icon.appendChild(path);
  return icon;
}

function buildCollapseButton() {
  const btn = document.createElement("button");
  btn.id = "wheelCollapse";
  btn.type = "button";
  btn.title = "Hide tools";
  btn.setAttribute("aria-label", "Hide tools");
  btn.appendChild(chevronSvg());
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  btn.addEventListener("mousedown", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    collapseWheel(nearestEdge(root.getBoundingClientRect()));
  });
  return btn;
}

function buildDockButton() {
  const btn = document.createElement("button");
  btn.id = "wheelDock";
  btn.type = "button";
  btn.hidden = true;
  btn.title = "Show tools";
  btn.setAttribute("aria-label", "Show tools");
  btn.appendChild(chevronSvg());
  btn.addEventListener("click", () => expandWheel());
  return btn;
}

function placeDock(edge) {
  if (!dock) return;
  const size = DOCK_SIZE;
  const inset = 12;
  const anchor = dockAnchor || restorePos || { x: 0, y: 0 };
  const cx = anchor.x + SIZE / 2;
  const cy = anchor.y + SIZE / 2;
  const maxX = Math.max(inset, window.innerWidth - size - inset);
  const maxY = Math.max(inset, window.innerHeight - size - inset);
  let x;
  let y;
  if (edge === "left" || edge === "right") {
    x = edge === "left" ? inset : window.innerWidth - size - inset;
    y = Math.min(maxY, Math.max(HOME_CLEAR_Y, cy - size / 2));
  } else if (edge === "top") {
    y = inset;
    x = Math.min(window.innerWidth - size - GEAR_CLEAR, Math.max(HOME_CLEAR_X, cx - size / 2));
  } else {
    y = window.innerHeight - size - inset;
    x = Math.min(maxX, Math.max(inset, cx - size / 2));
  }
  dock.style.left = `${x}px`;
  dock.style.top = `${y}px`;
  dock.dataset.edge = edge;
}

function collapseWheel(edge) {
  if (collapsed || !root) return;
  const fromDrag = dragging === "move" && dragStartPos;
  const rect = root.getBoundingClientRect();
  dockAnchor = { x: rect.left, y: rect.top };
  restorePos = fromDrag
    ? { x: dragStartPos.x, y: dragStartPos.y }
    : dockAnchor;
  dragging = null;
  pressCandidate = null;
  movePointerId = null;
  dragStartPos = null;
  root.classList.remove("dragging");
  closePopover();
  hideTooltip();
  if (isColorPickerOpen()) closeColorLayer();
  if (isEyedropperActive()) stopEyedropper();
  collapsed = true;
  dockEdge = edge;
  root.classList.add("is-collapsed");
  root.inert = true;
  root.setAttribute("aria-hidden", "true");
  placeDock(edge);
  dock.hidden = false;
}

function expandWheel() {
  if (!root) return;
  collapsed = false;
  root.classList.remove("is-collapsed");
  root.inert = false;
  root.removeAttribute("aria-hidden");
  if (dock) dock.hidden = true;
  if (restorePos) placeWheel(restorePos.x, restorePos.y);
  else updateCollapseEdge();
}

// The color overlay reuses the ring space around the hub, so the wheel's own
// tool and property rings step aside while it is open. Driven from a single
// state check because the picker also closes itself (e.g. when the eyedropper
// takes over).
function syncColorLayerState() {
  root.classList.toggle("color-open", isColorPickerOpen());
}

function closeColorLayer() {
  closeColorPicker();
  syncColorLayerState();
}

// The color overlay draws concentric rings well outside the wheel, so nudge
// the wheel inward first rather than letting the rings run off screen.
const RING_RADIUS = 230;
function ensureRoomForRings() {
  const rect = root.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const minCx = RING_RADIUS + 4;
  const minCy = RING_RADIUS + 4;
  const maxCx = window.innerWidth - RING_RADIUS - 4;
  const maxCy = window.innerHeight - RING_RADIUS - 4;
  const ncx = Math.max(minCx, Math.min(cx, Math.max(minCx, maxCx)));
  const ncy = Math.max(minCy, Math.min(cy, Math.max(minCy, maxCy)));
  if (ncx === cx && ncy === cy) return;
  root.style.left = `${ncx - rect.width / 2}px`;
  root.style.top = `${ncy - rect.height / 2}px`;
  root.style.transform = "none";
  updateCollapseEdge();
  savePosition();
}

// --- Popovers (medium picker + property presets) ------------------------------

function togglePopover(kind, pinned) {
  if (openPopoverKind === kind && popoverPinned) { closePopover(); return; }
  openPopoverKind = kind;
  popoverPinned = !!pinned;
  buildPopover(kind);
}

function openPopoverPeek(kind) {
  if (openPopoverKind === kind) return;
  openPopoverKind = kind;
  popoverPinned = false;
  buildPopover(kind);
}

function closePopover() {
  openPopoverKind = null;
  popoverPinned = false;
  if (popover) { popover.remove(); popover = null; }
}

// Hover intent: brief delay before peeking so a passing cursor doesn't flash
// the popover; a grace period on mouse-out so you can move into the popover.
const HOVER_PEEK_MS = 260;
const HOVER_DISMISS_MS = 180;

function scheduleHoverPeek(kind) {
  cancelHoverPeek();
  hoverTimer = setTimeout(() => {
    if (dragging || pressCandidate) return;
    openPopoverPeek(kind);
  }, HOVER_PEEK_MS);
}

function scheduleHoverDismiss() {
  clearTimeout(hoverTimer);
  hoverTimer = null;
  clearTimeout(hoverOutTimer);
  hoverOutTimer = setTimeout(() => {
    if (!popoverPinned) closePopover();
  }, HOVER_DISMISS_MS);
}

function cancelHoverPeek() {
  clearTimeout(hoverTimer);
  hoverTimer = null;
  clearTimeout(hoverOutTimer);
  hoverOutTimer = null;
}

function buildPopover(kind) {
  if (popover) popover.remove();
  popover = document.createElement("div");
  popover.id = "wheelPopover";
  popover.addEventListener("mousedown", (e) => e.stopPropagation());
  // Moving into the popover keeps it open; leaving dismisses if not pinned.
  popover.addEventListener("mouseenter", cancelHoverPeek);
  popover.addEventListener("mouseleave", scheduleHoverDismiss);

  if (kind === "medium") buildMediumPopover();
  else buildPropPopover(kind);

  document.body.appendChild(popover);
  positionPopover();
  // Trigger the entrance transition on the next frame.
  requestAnimationFrame(() => popover && popover.classList.add("visible"));
}

function buildMediumPopover() {
  popover.classList.add("wheel-popover-media");
  const title = document.createElement("div");
  title.className = "wheel-popover-title";
  title.textContent = "Medium";
  popover.appendChild(title);

  const active = currentStyle().medium || "pen";
  for (const m of BRUSH_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.medium = m.id;
    btn.classList.toggle("active", active === m.id);

    // Each row previews the medium with its own weight and translucency.
    const sample = document.createElementNS(SVG_NS, "svg");
    sample.setAttribute("class", "wheel-medium-sample");
    sample.setAttribute("viewBox", "0 0 56 18");
    const path = svgEl("path", m.swatch.filled
      ? {
          d: MEDIA_SAMPLE_FILL,
          fill: currentStyle().stroke,
          stroke: "none",
          opacity: m.swatch.alphaMul,
        }
      : {
          d: MEDIA_SAMPLE_STROKE,
          fill: "none",
          stroke: currentStyle().stroke,
          "stroke-width": Math.max(1.2, Math.min(7, 2.4 * m.swatch.widthMul)),
          "stroke-linecap": "round",
          "stroke-dasharray": m.swatch.dash ? m.swatch.dash.join(" ") : "none",
          opacity: m.swatch.alphaMul,
        });
    sample.appendChild(path);

    const label = document.createElement("span");
    label.textContent = m.label;
    btn.append(sample, label);

    btn.addEventListener("click", () => {
      beginStyleEdit();
      const patch = { medium: m.id };
      // A fill keeps the previous weight, since the size ring does nothing
      // there. Any real tip snaps into that utensil's pixel range.
      if (!isFilledMedium(m.id)) {
        const { min, max } = widthRangeFor(m.id);
        const widthNow = usesTextSize()
          ? (currentStyle().strokeWidth ?? activeBrush.strokeWidth)
          : propValue("size");
        patch.strokeWidth = roundWidth(Math.max(min, Math.min(max, widthNow)));
      }
      applyStylePatch(patch);
      commitStyleEdit();
      syncUi(true);
      closePopover();
    });
    popover.appendChild(btn);
  }
}

function buildPropPopover(kind) {
  popover.classList.add("wheel-popover-slider");
  const def = PROPS.find((p) => p.key === kind);

  const head = document.createElement("div");
  head.className = "wheel-popover-title";
  const name = document.createElement("span");
  name.textContent = def.label;
  const value = document.createElement("span");
  value.className = "wheel-popover-value";
  value.textContent = propText(kind);
  head.append(name, value);
  popover.appendChild(head);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = 0;
  slider.max = 100;
  slider.step = 1;
  slider.value = Math.round(propT(kind) * 100);
  slider.setAttribute("aria-label", def.label);
  let sliderEditing = false;
  slider.addEventListener("input", () => {
    if (!sliderEditing) {
      sliderEditing = true;
      if (isUndoable(kind)) beginStyleEdit(kind);
    }
    setPropFromT(kind, slider.value / 100);
    value.textContent = propText(kind);
    syncUi(true);
  });
  const finishSlider = () => {
    if (!sliderEditing) return;
    sliderEditing = false;
    if (isUndoable(kind)) commitStyleEdit();
  };
  slider.addEventListener("change", finishSlider);
  slider.addEventListener("mouseup", finishSlider);
  popover.appendChild(slider);

  const presetRow = document.createElement("div");
  presetRow.className = "wheel-preset-row";
  for (const p of presetList(kind)) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = kind === "size" ? `${p}` : `${Math.round(p * 100)}%`;
    b.classList.toggle("active", Math.abs(propValue(kind) - p) < 1e-6);
    b.addEventListener("click", () => {
      if (isUndoable(kind)) beginStyleEdit(kind);
      setPropValue(kind, p);
      if (isUndoable(kind)) commitStyleEdit();
      slider.value = Math.round(propT(kind) * 100);
      value.textContent = propText(kind);
      for (const other of presetRow.querySelectorAll("button")) other.classList.remove("active");
      b.classList.add("active");
      syncUi(true);
    });
    presetRow.appendChild(b);
  }
  popover.appendChild(presetRow);
}

/** Place the popover beside the wheel, flipping to whichever side has room. */
function positionPopover() {
  if (!popover) return;
  const wheel = root.getBoundingClientRect();
  const pop = popover.getBoundingClientRect();
  const gap = 12;
  const pad = 8;
  let left = wheel.right + gap;
  if (left + pop.width > window.innerWidth - pad) {
    const flipped = wheel.left - gap - pop.width;
    left = flipped >= pad ? flipped : Math.max(pad, window.innerWidth - pop.width - pad);
  }
  let top = wheel.top + wheel.height / 2 - pop.height / 2;
  top = Math.max(pad, Math.min(top, window.innerHeight - pop.height - pad));
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

// --- Tooltip ----------------------------------------------------------------

function ensureTooltip() {
  if (tooltip) return tooltip;
  tooltip = document.createElement("div");
  tooltip.id = "wheelTooltip";
  document.body.appendChild(tooltip);
  return tooltip;
}

function showTooltip(text, x, y) {
  const tt = ensureTooltip();
  tt.textContent = text;
  tt.classList.add("visible");
  positionTooltip(x, y);
}

function positionTooltip(x, y) {
  if (!tooltip) return;
  const pad = 12;
  const rect = tooltip.getBoundingClientRect();
  let left = x - rect.width / 2;
  let top = y - rect.height - 22;
  left = Math.max(pad, Math.min(left, window.innerWidth - rect.width - pad));
  if (top < pad) top = y + 24; // flip below if near the top edge
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip() {
  if (tooltip) tooltip.classList.remove("visible");
}

// --- Sync ----------------------------------------------------------------------

let lastSynced = "";

/** Instrument readout: value at full weight, unit dimmed beside it. */
function setReadout(textEl, key) {
  const { value, unit } = propParts(key);
  let valEl = textEl.firstElementChild;
  let unitEl = textEl.lastElementChild;
  if (valEl === unitEl) {
    valEl = svgEl("tspan", { class: "sw-read-value" });
    unitEl = svgEl("tspan", { class: "sw-read-unit" });
    textEl.append(valEl, unitEl);
  }
  valEl.textContent = value;
  unitEl.textContent = unit;
  unitEl.setAttribute("dx", unit === "%" ? "0.6" : "1.8");
}

/**
 * A usable tint of the working color, for the one accent the wheel allows
 * itself. Hue is kept, saturation is tamed, and very dark or very pale
 * colors are lifted into a band that stays visible against the charcoal.
 */
function accentFrom(color) {
  const { r, g, b } = parseColor(color);
  const hsl = rgbToHsl(r, g, b);
  const lifted = hslToRgb(hsl.h, Math.min(hsl.s, 0.6), Math.max(0.55, Math.min(hsl.l, 0.76)));
  const round = (v) => Math.round(v);
  return {
    hex: rgbToHex(lifted.r, lifted.g, lifted.b),
    rgb: `${round(lifted.r)}, ${round(lifted.g)}, ${round(lifted.b)}`,
  };
}

function placeTicks(def) {
  const els = propEls[def.key];
  if (!els || !els.ticks) return;
  const notch = PROP_W / 2 - 0.6;
  presetList(def.key).forEach((p, i) => {
    const line = els.ticks[i];
    if (!line) return;
    const t = def.key === "size" ? widthToT(p) : p;
    const deg = arcValueToDeg(def.arc, t);
    const a = polar(deg, PROP_R - notch);
    const b = polar(deg, PROP_R + notch);
    line.setAttribute("x1", a.x);
    line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x);
    line.setAttribute("y2", b.y);
  });
}

function syncUi(force) {
  if (!root) return;
  const st = currentStyle();
  const key = [
    st.stroke, st.strokeWidth, st.opacity, st.medium || "pen",
    activeBrush.toolType, activeBrush.eraserWidth, activeBrush.smoothing, singleSelection()?.id || "",
    usesTextSize() ? displayedTextSize(singleSelection(), activeBrush.toolType === "text") : "",
  ].join("|");
  if (!force && key === lastSynced) return;
  lastSynced = key;

  syncHub(st);

  for (const def of PROPS) {
    const els = propEls[def.key];
    const t = propT(def.key);
    const deg = arcValueToDeg(def.arc, t);
    const p = polar(deg, PROP_R);
    els.handle.setAttribute("transform", `translate(${p.x} ${p.y})`);
    // Fill the travelled part of the arc so the value reads without the label.
    els.fill.setAttribute("d", t > 0.001 ? arcPathD(def.arc.start, deg, PROP_R) : "");
    setReadout(els.readout, def.key);
    const inert = isPropInert(def.key);
    els.group.classList.toggle("inert", inert);
    els.group.setAttribute("aria-disabled", String(inert));
    els.group.setAttribute("aria-valuenow", String(Math.round(t * 100)));
    els.group.setAttribute("aria-valuetext", propText(def.key));
    placeTicks(def);
  }

  // Tool ring active highlight.
  for (const btn of toolRing.querySelectorAll(".sw-tool")) {
    const on = btn.dataset.tool === activeBrush.toolType;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
  }
}

function syncHub(st) {
  const color = st.stroke || "#2b2b30";
  const opacity = st.opacity ?? 1;
  hubFill.style.background = color;
  hubFill.style.opacity = String(opacity);
  hubHex.textContent = color.toUpperCase();

  // The working color is the wheel's only accent: everything else stays
  // neutral, and the active tool borrows a tamed version of it.
  const accent = accentFrom(color);
  root.style.setProperty("--sw-live", accent.hex);
  root.style.setProperty("--sw-live-line", `rgba(${accent.rgb}, 0.5)`);
  root.style.setProperty("--sw-live-wash", `rgba(${accent.rgb}, 0.1)`);

  // Contrast the sample stroke and hex against the current color so both stay
  // legible from near-black to near-white.
  const light = relativeLuminance(color) > 0.45;
  hubBtn.classList.toggle("on-light", light);
  // The sample reads as the instrument itself: weight, dash and translucency
  // all come from what would actually be drawn right now — or, for a fill,
  // the area it would ink instead of any line at all.
  const sw = currentSwatch();
  hubStroke.classList.toggle("filled", !!sw.filled);
  hubStroke.setAttribute("d", sw.filled ? HUB_SAMPLE_FILL : HUB_SAMPLE_STROKE);
  hubStroke.setAttribute("fill-opacity", String(sw.alphaMul));
  const sampleW = (st.strokeWidth ?? 2) * sw.widthMul;
  hubStroke.setAttribute("stroke-width", String(Math.max(1, Math.min(9, sampleW))));
  hubStroke.setAttribute("stroke-dasharray", sw.dash ? sw.dash.join(" ") : "none");
  hubStroke.setAttribute("stroke-opacity", String(sw.alphaMul));
}

/** The active brush's preview weights — an SVG stand-in for the real tip. */
function currentSwatch() {
  return getBrushPreset(currentStyle().medium || "pen").swatch;
}

function relativeLuminance(hex) {
  const h = String(hex).replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return 0;
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

// --- Public API ------------------------------------------------------------------

/** Close transient layers and show the wheel. Used when a drawing opens. */
export function resetStyleWheel() {
  if (!root) return;
  closePopover();
  hideTooltip();
  if (isColorPickerOpen()) closeColorLayer();
  if (isEyedropperActive()) stopEyedropper();
  if (collapsed) expandWheel();
  // New drawings and a fresh load show the wheel. Measure only once it
  // is on screen — enterDocument drops the home class before calling this.
  clampIntoViewport();
}

export function initStyleWheel(app) {
  appRef = app;
  if (!root) buildDom();
  // Eyedropper samples the rendered scene offscreen (the live canvas is
  // cleared each frame, so direct getImageData is unreliable).
  setColorSampler((x, y) => sampleScreen(app.scene, x, y));
  syncUi(true);
}

/** Called once per rendered frame; keeps the hub in sync with selection. */
export function styleWheelFrame() {
  if (!root) return;
  syncColorLayerState();
  if (dragging) return;
  // Reverse inheritance: when a single element is selected, reflect its
  // style in the hub (and store) so the rings match what you're editing.
  const el = singleSelection();
  if (el) {
    const s = el.style;
    if (s.stroke !== activeBrush.stroke || s.strokeWidth !== activeBrush.strokeWidth ||
        s.opacity !== activeBrush.opacity || (s.medium || "pen") !== activeBrush.medium) {
      setBrush({
        stroke: s.stroke, strokeWidth: s.strokeWidth,
        opacity: s.opacity, medium: s.medium || "pen",
      });
    }
  }
  syncUi(false);
}
