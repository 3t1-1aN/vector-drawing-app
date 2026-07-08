// ui/style-wheel.js
// Concepts-inspired floating style wheel. Center disc shows the active
// color (click opens the color flyout); the ring carries two draggable
// arcs — stroke size across the top, opacity across the bottom.
//
// Target resolution: with exactly one element selected the wheel mirrors
// and edits that element's style (undoable via StyleCommand); otherwise it
// edits the shared active brush used for new strokes.

import { activeBrush, setBrush } from "../brush/active-brush.js";
import { MEDIUMS } from "../brush/mediums.js";
import { StyleCommand } from "../scene/scene.js";
import {
  initColorPicker, openColorPicker, closeColorPicker, isColorPickerOpen,
} from "./color-picker.js";

const SIZE = 200;
const C = SIZE / 2;
const ARC_R = 79; // mid-band radius the handles travel on
const RING_OUTER = 96;
const RING_INNER = 62;

// Arc angle ranges in degrees (SVG: 0 = right, 90 = down).
const SIZE_ARC = { start: 210, end: 330 };    // across the top
const OPACITY_ARC = { start: 150, end: 30 };  // across the bottom (150 -> 30 through 90)

const MIN_WIDTH = 0.5;
const MAX_WIDTH = 24;

let root = null;
let svg = null;
let colorBtn = null;
let sizeHandle = null;
let opacityHandle = null;
let sizeReadout = null;
let opacityReadout = null;
let mediumBar = null;

let appRef = null;
let dragging = null; // "size" | "opacity" | "move" | null
let moveOffset = { x: 0, y: 0 };
let pendingStyleCmd = null; // batches a whole drag / color pick into one undo
let lastSynced = "";

// --- Value mapping --------------------------------------------------------

function widthToT(w) {
  return Math.sqrt((w - MIN_WIDTH) / (MAX_WIDTH - MIN_WIDTH));
}
function tToWidth(t) {
  return MIN_WIDTH + t * t * (MAX_WIDTH - MIN_WIDTH);
}

function polar(deg, r) {
  const rad = (deg * Math.PI) / 180;
  return { x: C + Math.cos(rad) * r, y: C + Math.sin(rad) * r };
}

function arcPath(arc, r) {
  const a = polar(arc.start, r);
  const b = polar(arc.end, r);
  // Both arcs span 120 degrees; sweep direction differs.
  const sweep = arc === SIZE_ARC ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 0 ${sweep} ${b.x} ${b.y}`;
}

/** Angle (deg 0..360) of the pointer relative to the wheel center. */
function pointerAngle(e) {
  const rect = svg.getBoundingClientRect();
  const dx = e.clientX - (rect.left + rect.width / 2);
  const dy = e.clientY - (rect.top + rect.height / 2);
  return ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
}

function angleToT(arc, deg) {
  if (arc === SIZE_ARC) {
    // 210..330, continuous range.
    const clamped = Math.max(arc.start, Math.min(arc.end, deg < 180 ? (deg < 90 ? arc.end : arc.start) : deg));
    return (clamped - arc.start) / (arc.end - arc.start);
  }
  // Opacity: 150 -> 30 through 90 (deg decreasing).
  const clamped = Math.max(arc.end, Math.min(arc.start, deg > 180 ? (deg > 270 ? arc.end : arc.start) : deg));
  return (arc.start - clamped) / (arc.start - arc.end);
}

// --- Style targets --------------------------------------------------------

/** The single selected element, or null (drives target resolution). */
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

// --- DOM ------------------------------------------------------------------

function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function buildDom() {
  root = document.createElement("div");
  root.id = "styleWheel";

  svg = svgEl("svg", { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE });

  // Ring band (also the reposition drag surface).
  const band = svgEl("circle", {
    cx: C, cy: C, r: (RING_OUTER + RING_INNER) / 2,
    fill: "none", "stroke-width": RING_OUTER - RING_INNER,
    class: "sw-band",
  });
  svg.appendChild(band);

  // Arc tracks.
  const sizeTrack = svgEl("path", { d: arcPath(SIZE_ARC, ARC_R), class: "sw-track" });
  const opacityTrack = svgEl("path", { d: arcPath(OPACITY_ARC, ARC_R), class: "sw-track" });
  svg.appendChild(sizeTrack);
  svg.appendChild(opacityTrack);

  // Size tick marks (S / M / L anchors).
  for (const t of [0, 0.5, 1]) {
    const deg = SIZE_ARC.start + t * (SIZE_ARC.end - SIZE_ARC.start);
    const a = polar(deg, ARC_R - 7);
    const b = polar(deg, ARC_R + 7);
    svg.appendChild(svgEl("line", {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "sw-tick",
    }));
  }

  // Handles.
  sizeHandle = svgEl("circle", { r: 9, class: "sw-handle sw-handle-size" });
  opacityHandle = svgEl("circle", { r: 9, class: "sw-handle sw-handle-opacity" });
  svg.appendChild(sizeHandle);
  svg.appendChild(opacityHandle);

  root.appendChild(svg);

  // Center color disc.
  colorBtn = document.createElement("button");
  colorBtn.id = "wheelColor";
  colorBtn.title = "Color (click to pick)";
  root.appendChild(colorBtn);

  // Readouts.
  sizeReadout = document.createElement("div");
  sizeReadout.className = "wheel-readout wheel-readout-size";
  opacityReadout = document.createElement("div");
  opacityReadout.className = "wheel-readout wheel-readout-opacity";
  root.appendChild(sizeReadout);
  root.appendChild(opacityReadout);

  // Medium selector — small bar of pen/marker/pencil/chalk buttons sitting
  // below the wheel. Switching medium edits the active brush (or the single
  // selected element, undoably, like the rest of the wheel).
  mediumBar = document.createElement("div");
  mediumBar.id = "wheelMedia";
  for (const m of MEDIUMS) {
    const btn = document.createElement("button");
    btn.dataset.medium = m.id;
    btn.title = m.label;
    btn.textContent = m.label;
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", () => {
      beginStyleEdit();
      applyStylePatch({ medium: m.id });
      commitStyleEdit();
      syncUi(true);
    });
    mediumBar.appendChild(btn);
  }
  root.appendChild(mediumBar);

  document.body.appendChild(root);
  restorePosition();

  // --- Interaction ---
  const startArcDrag = (kind) => (e) => {
    dragging = kind;
    beginStyleEdit();
    updateFromPointer(e);
    e.preventDefault();
    e.stopPropagation();
  };
  sizeHandle.addEventListener("mousedown", startArcDrag("size"));
  opacityHandle.addEventListener("mousedown", startArcDrag("opacity"));
  sizeTrack.addEventListener("mousedown", startArcDrag("size"));
  opacityTrack.addEventListener("mousedown", startArcDrag("opacity"));

  band.addEventListener("mousedown", (e) => {
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
      updateFromPointer(e);
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
    if (isColorPickerOpen()) {
      closeColorPicker();
      return;
    }
    openColorPicker(root.getBoundingClientRect(), currentStyle().stroke);
  });

  // Click anywhere else closes the color flyout.
  document.addEventListener("mousedown", () => {
    if (isColorPickerOpen()) closeColorPicker();
  });
  root.addEventListener("mousedown", (e) => e.stopPropagation());

  initColorPicker((hex, phase) => {
    if (!pendingStyleCmd && singleSelection()) beginStyleEdit();
    applyStylePatch({ stroke: hex });
    if (phase === "commit") commitStyleEdit();
    syncUi(true);
  });
}

function updateFromPointer(e) {
  const deg = pointerAngle(e);
  if (dragging === "size") {
    const t = angleToT(SIZE_ARC, deg);
    applyStylePatch({ strokeWidth: Math.round(tToWidth(t) * 10) / 10 });
  } else if (dragging === "opacity") {
    const t = angleToT(OPACITY_ARC, deg);
    applyStylePatch({ opacity: Math.round(t * 100) / 100 });
  }
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

// --- Sync -----------------------------------------------------------------

function syncUi(force) {
  const st = currentStyle();
  const key = `${st.stroke}|${st.strokeWidth}|${st.opacity}|${st.medium || "pen"}`;
  if (!force && key === lastSynced) return;
  lastSynced = key;

  colorBtn.style.background = st.stroke;

  const sizeT = Math.max(0, Math.min(1, widthToT(st.strokeWidth)));
  const sp = polar(SIZE_ARC.start + sizeT * (SIZE_ARC.end - SIZE_ARC.start), ARC_R);
  sizeHandle.setAttribute("cx", sp.x);
  sizeHandle.setAttribute("cy", sp.y);

  const op = st.opacity ?? 1;
  const opP = polar(OPACITY_ARC.start - op * (OPACITY_ARC.start - OPACITY_ARC.end), ARC_R);
  opacityHandle.setAttribute("cx", opP.x);
  opacityHandle.setAttribute("cy", opP.y);
  opacityHandle.style.opacity = 0.35 + op * 0.65;

  sizeReadout.textContent = `${st.strokeWidth}px`;
  opacityReadout.textContent = `${Math.round(op * 100)}%`;

  const activeMedium = st.medium || "pen";
  for (const btn of mediumBar.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.medium === activeMedium);
  }
}

// --- Public API -------------------------------------------------------------

export function initStyleWheel(app) {
  appRef = app;
  if (!root) buildDom();
  syncUi(true);
}

/** Called once per rendered frame; keeps the wheel in sync with the
 *  current selection without extra event plumbing. Cheap when idle. */
export function styleWheelFrame() {
  if (!root || dragging) return;
  syncUi(false);
}
