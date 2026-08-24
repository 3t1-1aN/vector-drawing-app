// ui/style-wheel.js
// Concepts-style control hub. A single floating wheel replaces the top
// toolbar and carries everything: an outer tool ring, a property ring
// (size / opacity / smoothing) around a center color disc, undo/redo, and
// popovers for mediums and property presets.
//
// All state flows through ActiveStyleState (brush/active-brush.js). The hub
// subscribes to it; when exactly one element is selected the hub edits that
// element's style (undoable) and pushes the values back into the store so
// the rings reflect the selection (reverse inheritance).

import { activeBrush, setBrush, subscribeStyle } from "../brush/active-brush.js";
import { MEDIUMS } from "../brush/mediums.js";
import { StyleCommand } from "../scene/scene.js";
import {
  initColorPicker, openColorPicker, closeColorPicker, isColorPickerOpen,
  setColorSampler,
} from "./color-picker.js";
import { sampleScreen } from "../io/sampler.js";

const SIZE = 300;
const C = SIZE / 2;

// Ring radii.
const HUB_R = 62;            // center color disc
const PROP_R = 92;           // property ring (size/opacity/smoothing) mid radius
const TOOL_R_IN = 118;       // tool ring band
const TOOL_R_OUT = 148;
const TOOL_R = (TOOL_R_IN + TOOL_R_OUT) / 2;

const MIN_WIDTH = 0.5;
const MAX_WIDTH = 24;

const SVG_NS = "http://www.w3.org/2000/svg";

// Property arc ranges (degrees; 0 = right, 90 = down).
const SIZE_ARC = { start: 205, end: 335 };      // top
const OPACITY_ARC = { start: 155, end: 25 };    // bottom-left sweep
const SMOOTH_ARC = { start: 25, end: 155 };     // bottom-right sweep

let root = null;
let svg = null;
let colorBtn = null;
let toolRing = null;
let popover = null;

let appRef = null;
let dragging = null; // "size" | "opacity" | "smoothing" | "move" | null
let moveOffset = { x: 0, y: 0 };
let pendingStyleCmd = null;
let openPopoverKind = null; // "medium" | "size" | "opacity" | "smoothing" | null

const propHandles = {};
const propReadouts = {};

// Tool slots in ring order (clockwise from top). Undo/redo flank the ring.
const TOOL_SLOTS = [
  { id: "select", label: "Select", kbd: "V" },
  { id: "line", label: "Line", kbd: "L" },
  { id: "rect", label: "Rect", kbd: "R" },
  { id: "circle", label: "Circle", kbd: "C" },
  { id: "pen", label: "Pen", kbd: "P" },
  { id: "nudge", label: "Nudge", kbd: "N" },
  { id: "slice", label: "Slice", kbd: "S" },
];

// --- Value mapping ---------------------------------------------------------

function widthToT(w) {
  return Math.sqrt((w - MIN_WIDTH) / (MAX_WIDTH - MIN_WIDTH));
}
function tToWidth(t) {
  return MIN_WIDTH + t * t * (MAX_WIDTH - MIN_WIDTH);
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

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

function pointerAngle(e) {
  const rect = svg.getBoundingClientRect();
  const dx = e.clientX - (rect.left + rect.width / 2);
  const dy = e.clientY - (rect.top + rect.height / 2);
  return ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
}

function angleToT(arc, deg) {
  const span = arc.end - arc.start;
  let d = ((deg - arc.start) % 360 + 360) % 360;
  if (span > 0) {
    if (d > span) d = (d < (360 + span) / 2) ? 0 : span;
    return d / span;
  }
  // Negative span (decreasing arc).
  d = ((arc.start - deg) % 360 + 360) % 360;
  const negSpan = -span;
  if (d > negSpan) d = (d < (360 + negSpan) / 2) ? 0 : negSpan;
  return d / negSpan;
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

function beginStyleEdit() {
  const el = singleSelection();
  if (el) {
    pendingStyleCmd = new StyleCommand();
    pendingStyleCmd.begin([el]);
  }
}

function applyStylePatch(patch) {
  const el = singleSelection();
  if (el) Object.assign(el.style, patch);
  else setBrush(patch);
}

function commitStyleEdit() {
  const el = singleSelection();
  if (el && pendingStyleCmd) {
    pendingStyleCmd.end([el]);
    if (pendingStyleCmd.changed()) appRef.history.push(pendingStyleCmd);
  }
  pendingStyleCmd = null;
}

// --- DOM ---------------------------------------------------------------------

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function buildToolRing() {
  toolRing = svgEl("g", { class: "sw-toolring" });

  // Band behind the tools (also the reposition drag surface).
  toolRing.appendChild(svgEl("circle", {
    cx: C, cy: C, r: TOOL_R,
    fill: "none", "stroke-width": TOOL_R_OUT - TOOL_R_IN,
    class: "sw-band",
  }));

  TOOL_SLOTS.forEach((t, i) => {
    // Distribute tools around the full circle.
    const deg = -90 + (i / TOOL_SLOTS.length) * 360;
    const p = polar(deg, TOOL_R);
    const btn = svgEl("g", { class: "sw-tool", "data-tool": t.id, cursor: "pointer" });
    btn.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: 19, class: "sw-tool-dot" }));
    const txt = svgEl("text", {
      x: p.x, y: p.y + 3, class: "sw-tool-label", "text-anchor": "middle",
    });
    txt.textContent = t.label.slice(0, 2);
    btn.appendChild(txt);
    btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onToolSlot(t.id);
    });
    toolRing.appendChild(btn);
  });

  // Undo / redo buttons on the ring's horizontal axis.
  const undo = polar(180, TOOL_R);
  const redo = polar(0, TOOL_R);
  toolRing.appendChild(buildRingBtn("undo", undo.x, undo.y - 0, "⟲"));
  toolRing.appendChild(buildRingBtn("redo", redo.x, redo.y - 0, "⟳"));
  return toolRing;
}

function buildRingBtn(id, x, y, glyph) {
  const btn = svgEl("g", { class: "sw-ringbtn", "data-action": id, cursor: "pointer" });
  btn.appendChild(svgEl("circle", { cx: x, cy: y, r: 13, class: "sw-ringbtn-dot" }));
  const txt = svgEl("text", { x, y: y + 4, class: "sw-ringbtn-label", "text-anchor": "middle" });
  txt.textContent = glyph;
  btn.appendChild(txt);
  btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (id === "undo") appRef.history.undo(appRef.scene);
    else appRef.history.redo(appRef.scene);
  });
  return btn;
}

function onToolSlot(toolId) {
  const isActive = activeBrush.toolType === toolId;
  setBrush({ toolType: toolId });
  if (appRef && appRef.setActiveTool) appRef.setActiveTool(toolId);
  // Tapping the active tool again opens its medium popover.
  if (isActive) togglePopover("medium");
  else closePopover();
}

function buildPropRing() {
  const g = svgEl("g", { class: "sw-propring" });

  const defs = [
    { key: "size", arc: SIZE_ARC, cls: "size" },
    { key: "opacity", arc: OPACITY_ARC, cls: "opacity" },
    { key: "smoothing", arc: SMOOTH_ARC, cls: "smoothing" },
  ];

  for (const def of defs) {
    const track = svgEl("path", {
      d: arcPathD(def.arc.start, def.arc.end, PROP_R),
      class: `sw-track sw-track-${def.cls}`,
      cursor: "pointer",
    });
    track.addEventListener("mousedown", (e) => {
      dragging = def.key;
      beginStyleEdit();
      updatePropFromPointer(e);
      e.preventDefault();
      e.stopPropagation();
    });
    // Tap (click without drag) opens the preset slider popover.
    track.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePopover(def.key);
    });
    g.appendChild(track);

    const handle = svgEl("circle", { r: 8, class: `sw-handle sw-handle-${def.cls}` });
    handle.addEventListener("mousedown", (e) => {
      dragging = def.key;
      beginStyleEdit();
      updatePropFromPointer(e);
      e.preventDefault();
      e.stopPropagation();
    });
    g.appendChild(handle);
    propHandles[def.key] = handle;

    const readout = svgEl("text", { class: `sw-readout sw-readout-${def.cls}`, "text-anchor": "middle" });
    readout.addEventListener("mousedown", (e) => e.stopPropagation());
    readout.addEventListener("click", (e) => { e.stopPropagation(); togglePopover(def.key); });
    g.appendChild(readout);
    propReadouts[def.key] = readout;
  }
  return g;
}

function buildDom() {
  root = document.createElement("div");
  root.id = "styleWheel";

  svg = svgEl("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE });
  svg.appendChild(buildToolRing());
  svg.appendChild(buildPropRing());

  root.appendChild(svg);

  // Center color disc.
  colorBtn = document.createElement("button");
  colorBtn.id = "wheelColor";
  colorBtn.title = "Color (click to pick)";
  root.appendChild(colorBtn);

  document.body.appendChild(root);
  restorePosition();

  // Reposition drag on the tool band.
  toolRing.querySelector(".sw-band").addEventListener("mousedown", (e) => {
    dragging = "move";
    const rect = root.getBoundingClientRect();
    moveOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    if (dragging === "move") {
      const x = Math.max(0, Math.min(e.clientX - moveOffset.x, window.innerWidth - SIZE));
      const y = Math.max(0, Math.min(e.clientY - moveOffset.y, window.innerHeight - SIZE));
      root.style.left = `${x}px`;
      root.style.top = `${y}px`;
      root.style.transform = "none";
    } else {
      updatePropFromPointer(e);
    }
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    if (dragging === "move") {
      const rect = root.getBoundingClientRect();
      localStorage.setItem("vda.wheelPos", JSON.stringify({ x: rect.left, y: rect.top }));
    } else {
      commitStyleEdit();
    }
    dragging = null;
  });

  colorBtn.addEventListener("mousedown", (e) => e.stopPropagation());
  colorBtn.addEventListener("click", () => {
    closePopover();
    if (isColorPickerOpen()) {
      closeColorPicker();
      return;
    }
    ensureRoomForRings();
    openColorPicker(colorBtn.getBoundingClientRect(), currentStyle().stroke);
  });

  // Click anywhere else closes popovers + the color flyout.
  document.addEventListener("mousedown", () => {
    if (isColorPickerOpen()) closeColorPicker();
    closePopover();
  });
  root.addEventListener("mousedown", (e) => e.stopPropagation());

  initColorPicker((hex, phase) => {
    if (!pendingStyleCmd && singleSelection()) beginStyleEdit();
    applyStylePatch({ stroke: hex });
    if (phase === "commit") commitStyleEdit();
    syncUi(true);
  });

  // Re-render whenever the shared style state changes (tool ring highlight,
  // property ring positions, hub color all derive from it).
  subscribeStyle(() => syncUi(true));
}

function updatePropFromPointer(e) {
  const deg = pointerAngle(e);
  const st = currentStyle();
  if (dragging === "size") {
    applyStylePatch({ strokeWidth: Math.round(tToWidth(angleToT(SIZE_ARC, deg)) * 10) / 10 });
  } else if (dragging === "opacity") {
    applyStylePatch({ opacity: clamp01(angleToT(OPACITY_ARC, deg)) });
  } else if (dragging === "smoothing") {
    applyStylePatch({ smoothing: clamp01(angleToT(SMOOTH_ARC, deg)) });
  }
  void st;
  syncUi(true);
}

function restorePosition() {
  const saved = localStorage.getItem("vda.wheelPos");
  if (!saved) return;
  try {
    const { x, y } = JSON.parse(saved);
    root.style.left = `${Math.max(0, Math.min(x, window.innerWidth - SIZE))}px`;
    root.style.top = `${Math.max(0, Math.min(y, window.innerHeight - SIZE))}px`;
    root.style.transform = "none";
  } catch { /* ignore corrupt state */ }
}

// The color ring overlay is 460px; ensure room, accounting for the larger hub.
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
  const r2 = root.getBoundingClientRect();
  localStorage.setItem("vda.wheelPos", JSON.stringify({ x: r2.left, y: r2.top }));
}

// --- Popovers (medium picker + property presets) ------------------------------

const PRESETS = {
  size: [1, 2.5, 5, 12],
  opacity: [1, 0.7, 0.4, 0.15],
  smoothing: [0, 0.33, 0.66, 1],
};

function togglePopover(kind) {
  if (openPopoverKind === kind) { closePopover(); return; }
  openPopoverKind = kind;
  buildPopover(kind);
}

function closePopover() {
  openPopoverKind = null;
  if (popover) { popover.remove(); popover = null; }
}

function buildPopover(kind) {
  if (popover) popover.remove();
  popover = document.createElement("div");
  popover.id = "wheelPopover";
  popover.addEventListener("mousedown", (e) => e.stopPropagation());

  if (kind === "medium") {
    popover.classList.add("wheel-popover-media");
    for (const m of MEDIUMS) {
      const btn = document.createElement("button");
      btn.dataset.medium = m.id;
      btn.textContent = m.label;
      btn.classList.toggle("active", (currentStyle().medium || "pen") === m.id);
      btn.addEventListener("click", () => {
        beginStyleEdit();
        applyStylePatch({ medium: m.id });
        commitStyleEdit();
        syncUi(true);
        closePopover();
      });
      popover.appendChild(btn);
    }
  } else {
    // Property slider + four presets.
    popover.classList.add("wheel-popover-slider");
    const st = currentStyle();
    const isSize = kind === "size";
    const isSmoothing = kind === "smoothing";
    const value = isSize ? st.strokeWidth : isSmoothing ? (st.smoothing ?? activeBrush.smoothing) : st.opacity;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = 0;
    slider.max = 100;
    slider.value = Math.round((isSize ? widthToT(value) : value) * 100);
    slider.addEventListener("input", () => {
      const t = slider.value / 100;
      beginStyleEdit();
      if (isSize) applyStylePatch({ strokeWidth: Math.round(tToWidth(t) * 10) / 10 });
      else if (isSmoothing) applyStylePatch({ smoothing: t });
      else applyStylePatch({ opacity: t });
      syncUi(true);
    });
    slider.addEventListener("change", () => commitStyleEdit());
    popover.appendChild(slider);

    const presetRow = document.createElement("div");
    presetRow.className = "wheel-preset-row";
    for (const p of PRESETS[kind]) {
      const b = document.createElement("button");
      b.textContent = isSize ? `${p}` : isSmoothing ? `${Math.round(p * 100)}` : `${Math.round(p * 100)}%`;
      b.addEventListener("click", () => {
        beginStyleEdit();
        if (isSize) applyStylePatch({ strokeWidth: p });
        else if (isSmoothing) applyStylePatch({ smoothing: p });
        else applyStylePatch({ opacity: p });
        commitStyleEdit();
        syncUi(true);
        slider.value = Math.round((isSize ? widthToT(p) : p) * 100);
      });
      presetRow.appendChild(b);
    }
    popover.appendChild(presetRow);
  }

  // Anchor the popover beside the hub.
  const rect = root.getBoundingClientRect();
  popover.style.left = `${rect.right + 12}px`;
  popover.style.top = `${rect.top + rect.height / 2}px`;
  popover.style.transform = "translateY(-50%)";
  document.body.appendChild(popover);
}

// --- Sync ----------------------------------------------------------------------

let lastSynced = "";

function syncUi(force) {
  const st = currentStyle();
  const key = `${st.stroke}|${st.strokeWidth}|${st.opacity}|${st.medium || "pen"}|${activeBrush.toolType}|${st.smoothing ?? activeBrush.smoothing}`;
  if (!force && key === lastSynced) return;
  lastSynced = key;

  colorBtn.style.background = st.stroke;
  colorBtn.style.opacity = 0.35 + (st.opacity ?? 1) * 0.65;

  // Property ring handles + readouts.
  const sizeT = clamp01(widthToT(st.strokeWidth));
  placeProp("size", SIZE_ARC, sizeT, `${st.strokeWidth}px`);
  placeProp("opacity", OPACITY_ARC, st.opacity ?? 1, `${Math.round((st.opacity ?? 1) * 100)}%`);
  const sm = st.smoothing ?? activeBrush.smoothing;
  placeProp("smoothing", SMOOTH_ARC, sm, `${Math.round(sm * 100)}%`);

  // Tool ring active highlight.
  if (toolRing) {
    for (const btn of toolRing.querySelectorAll(".sw-tool")) {
      btn.classList.toggle("active", btn.dataset.tool === activeBrush.toolType);
    }
  }
}

function placeProp(kind, arc, t, text) {
  const handle = propHandles[kind];
  const readout = propReadouts[kind];
  if (!handle) return;
  const deg = arc.start + t * (arc.end - arc.start);
  const p = polar(deg, PROP_R);
  handle.setAttribute("cx", p.x);
  handle.setAttribute("cy", p.y);
  // Readout sits just outside the arc midpoint.
  const mid = polar((arc.start + arc.end) / 2, PROP_R + 22);
  readout.setAttribute("x", mid.x);
  readout.setAttribute("y", mid.y + 3);
  readout.textContent = text;
}

// --- Public API ------------------------------------------------------------------

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
  if (!root || dragging) return;
  // Reverse inheritance: when a single element is selected, reflect its
  // style in the hub (and store) so the rings match what you're editing.
  const el = singleSelection();
  if (el) {
    const s = el.style;
    if (s.stroke !== activeBrush.stroke || s.strokeWidth !== activeBrush.strokeWidth ||
        s.opacity !== activeBrush.opacity) {
      setBrush({ stroke: s.stroke, strokeWidth: s.strokeWidth, opacity: s.opacity });
    }
  }
  syncUi(false);
}
