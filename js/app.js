// app.js
// Application glue: owns the canvas context, view, scene, history, the
// active tool, and the rAF render loop. Routes pointer/keyboard input to
// the active tool (after handling pan/zoom globally), wires the toolbar
// and the precision/project panel, and draws everything each frame.

import {
  getCanvas, getContext, resizeCanvas,
  resetToScreenSpace, applyViewTransform,
} from "./core/canvas.js";
import {
  view, screenToWorld, worldToScreen, panBy, zoomAt, fitToBounds, clamp,
} from "./core/view.js";
import { Scene, History, AddElementCommand, RemoveElementsCommand, cloneElement } from "./scene/scene.js";
import { createIdElement, nextId, translateElement } from "./scene/element.js";
import { GRID_MAJOR, GRID_MINOR } from "./render/grid.js";
import { drawGrid } from "./render/grid.js";
import { drawBackground } from "./render/background.js";
import { initWorkspacePanel } from "./ui/workspace-panel.js";
import { isEngineering } from "./workspace/mode.js";
import { initStyleWheel, styleWheelFrame } from "./ui/style-wheel.js";
import { drawLivePreview } from "./render/elements.js";
import { drawInkLayer, inkLayerStats } from "./render/ink-layer.js";
import {
  drawCommittedMeasurements, drawMeasurementLabel, drawScaleBar,
} from "./render/labels.js";
import { drawCadDimensions, drawLiveCadDimension } from "./render/dimensions.js";
import { drawShapeGuides } from "./render/guides.js";
import {
  drawSelectionOverlay, drawMarquee, drawArtboardsWorld, drawArtboardLabels,
} from "./render/select.js";
import {
  setUnit, setUnitsPerWorldUnit, setDimensionMode, scaleSettings,
} from "./precision/scale.js";
import { getSnappedPosition } from "./precision/snap.js";
import {
  registerTool, getTool, listTools,
} from "./tools/registry.js";
import { lineTool, rectTool, circleTool, penTool } from "./tools/draw.js";
import { selectTool } from "./tools/select.js";
import { nudgeTool } from "./tools/nudge.js";
import { sliceTool } from "./tools/slice.js";
import { eraserTool } from "./tools/erase.js";
import { exportSvg, downloadText } from "./io/export-svg.js";
import { serializeProject, deserializeProject, pickFile, readFileText } from "./io/project.js";
import { openMeasureDialog, closeMeasureDialog, isOpen as measureDialogOpen } from "./ui/measure-dialog.js";
import { openMathEditAt, closeMathEdit, isMathEditOpen } from "./ui/math-edit.js";
import { isEyedropperActive } from "./ui/color-picker.js";
import { setBrush } from "./brush/active-brush.js";
import { brushCacheStats } from "./brush/cache.js";
import { installBrushTestbed } from "./brush/testbed.js";
import {
  drawMathLayer,
  handleMathPointerDown,
  onSceneMutated,
  setEnabled as setMathEnabled,
  serializeMathState,
  deserializeMathState,
} from "./math/pipeline.js";

// --- Register tools ----------------------------------------------------
registerTool("select", selectTool);
registerTool("line", lineTool);
registerTool("rect", rectTool);
registerTool("circle", circleTool);
registerTool("pen", penTool);
registerTool("nudge", nudgeTool);
registerTool("slice", sliceTool);
registerTool("eraser", eraserTool);

// --- Snap configuration -----------------------------------------------
const SNAP_UNIT = GRID_MINOR;

// --- Core app state ----------------------------------------------------
const canvas = getCanvas();
const ctx = getContext();
const scene = new Scene();
const history = new History();

const interaction = {
  spaceDown: false,
  panning: false,
  lastX: 0,
  lastY: 0,
};

// Finger contacts on the canvas. A finger never draws: one pans, two pinch-zoom.
const touches = new Map();
let pinchDist = 0;
// View at the moment a finger first lands. A palm often arrives a few
// milliseconds before the nib; if the pen follows immediately, that twitch
// is put back so the stroke starts where the page was.
let touchSnapshot = null;
let touchGestureAt = 0;
// Mouse/space pan, kept separate so a palm cannot steer a stylus stroke.
let navPointerId = null;
// The pen or mouse pointer currently driving the active tool.
let toolPointerId = null;

let activeTool = "line";

// Counters for panX/zoom/cache occupancy. Useful while working on the
// renderer, permanent clutter for everyone else, so it is off unless asked
// for with F2 or `?debug`.
let debugOverlayVisible = new URLSearchParams(location.search).has("debug");

// The app object passed to every tool hook.
const app = {
  canvas,
  ctx,
  view,
  scene,
  history,
  interaction,
  get activeTool() { return activeTool; },
  setActiveTool,
  screenToWorld,
  worldToScreen,
  snap,
  requestRender() { /* rAF loop runs continuously; no-op for now */ },
};

function snap(worldX, worldY) {
  return getSnappedPosition(worldX, worldY, scene, view.zoom, SNAP_UNIT);
}

// --- Tool switching ----------------------------------------------------
function setActiveTool(name) {
  const tool = getTool(name);
  if (!tool) return;
  const prev = getTool(activeTool);
  if (prev && prev.onDeactivate) prev.onDeactivate(app);
  activeTool = name;
  // The hub's tool ring renders from the shared style state, so publishing the
  // change here keeps keyboard shortcuts and ring clicks in sync.
  setBrush({ toolType: name });
  if (tool.onActivate) tool.onActivate(app);
}

// --- Precision / project panel ----------------------------------------
const unitSel = document.getElementById("unit");
const scaleInput = document.getElementById("scale");
const dimsSel = document.getElementById("showDims");
unitSel.addEventListener("change", () => setUnit(unitSel.value));
scaleInput.addEventListener("change", () => setUnitsPerWorldUnit(scaleInput.value));
dimsSel.addEventListener("change", () => setDimensionMode(dimsSel.value));

document.getElementById("addArtboard").addEventListener("click", () => {
  const b = scene.unionBounds();
  const ab = {
    id: `ab_${Date.now()}`,
    name: `Artboard ${scene.artboards.length + 1}`,
    x: b ? b.minX - 40 : -200,
    y: b ? b.minY - 40 : -150,
    w: b ? (b.maxX - b.minX) + 80 : 400,
    h: b ? (b.maxY - b.minY) + 80 : 300,
  };
  scene.artboards.push(ab);
});

document.getElementById("fitArtboard").addEventListener("click", () => {
  const b = scene.unionBounds();
  if (b) fitToBounds(b);
});

document.getElementById("saveProject").addEventListener("click", () => {
  const data = serializeProject(scene, { math: serializeMathState() });
  downloadText("drawing.vda", JSON.stringify(data, null, 2), "application/json");
});

document.getElementById("loadProject").addEventListener("click", async () => {
  try {
    const file = await pickFile(".vda,application/json");
    const text = await readFileText(file);
    const data = JSON.parse(text);
    deserializeProject(data, scene);
    deserializeMathState(data.math, app);
    history.clear();
    syncPanelFromSettings();
  } catch (err) {
    if (err.message !== "No file selected") console.error(err);
  }
});

document.getElementById("exportSvg").addEventListener("click", () => {
  const svg = exportSvg(scene, view, scene.artboards[0] || null);
  downloadText("drawing.svg", svg, "image/svg+xml");
});

function syncPanelFromSettings() {
  unitSel.value = scaleSettings.unit;
  scaleInput.value = scaleSettings.unitsPerWorldUnit;
  dimsSel.value = scaleSettings.dimensionMode;
  syncWorkspacePanel();
}

// --- Workspace (background + grid) panel --------------------------------
const panel = document.getElementById("panel");
const panelToggle = document.getElementById("panelToggle");
// A closed panel is only faded out. Without inert, Tab still walks every
// control inside it, including ones the user cannot see.
panel.inert = panel.classList.contains("collapsed");
panelToggle.addEventListener("click", () => {
  const open = panel.classList.toggle("collapsed") === false;
  panel.inert = !open;
  panelToggle.setAttribute("aria-expanded", String(open));
});
const workspacePanel = initWorkspacePanel({
  onChange(detail) {
    if (detail && "mathAssist" in detail) {
      setMathEnabled(app, detail.mathAssist);
    }
  },
});

function syncWorkspacePanel() {
  workspacePanel.sync();
}

// --- Input routing -----------------------------------------------------
function isPanGesture(event) {
  if (event.button === 1) return true;
  if (event.button === 0 && interaction.spaceDown) return true;
  return false;
}

function isFinger(event) {
  return event.pointerType === "touch";
}

function endNavigation() {
  interaction.panning = false;
  pinchDist = 0;
  canvas.classList.remove("panning");
}

function capturePointer(event) {
  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Capture fails if the pointer already ended. The gesture still tracks.
  }
}

// Re-anchor after a finger lands or lifts so the next move does not jump.
function rebaseTouchNavigation() {
  const pts = [...touches.values()];
  if (pts.length === 0) {
    endNavigation();
    return;
  }
  interaction.panning = true;
  canvas.classList.add("panning");
  if (pts.length === 1) {
    interaction.lastX = pts[0].x;
    interaction.lastY = pts[0].y;
    pinchDist = 0;
    return;
  }
  const a = pts[0];
  const b = pts[1];
  interaction.lastX = (a.x + b.x) / 2;
  interaction.lastY = (a.y + b.y) / 2;
  pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
}

function applyTouchNavigation() {
  const pts = [...touches.values()];
  if (pts.length === 1) {
    panBy(pts[0].x - interaction.lastX, pts[0].y - interaction.lastY);
    interaction.lastX = pts[0].x;
    interaction.lastY = pts[0].y;
    return;
  }
  if (pts.length < 2) return;
  const a = pts[0];
  const b = pts[1];
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  panBy(midX - interaction.lastX, midY - interaction.lastY);
  if (pinchDist > 8 && dist > 8) zoomAt(midX, midY, dist / pinchDist);
  interaction.lastX = midX;
  interaction.lastY = midY;
  pinchDist = dist;
}

let touchEndedAt = 0;

function dropTouch(pointerId) {
  if (!touches.delete(pointerId)) return false;
  if (touches.size === 0) {
    const snapshot = touchSnapshot;
    touchEndedAt = performance.now();
    setTimeout(() => {
      if (touchSnapshot === snapshot) touchSnapshot = null;
    }, 160);
  }
  rebaseTouchNavigation();
  return true;
}

function rememberTouchOrigin() {
  if (touchSnapshot) return;
  touchSnapshot = { panX: view.panX, panY: view.panY, zoom: view.zoom };
  touchGestureAt = performance.now();
}

function revertAccidentalPan() {
  if (!touchSnapshot) return;
  const age = performance.now() - touchGestureAt;
  const palmStillDown = touches.size > 0;
  const palmJustLifted = performance.now() - touchEndedAt < 40;
  if (age < 140 && (palmStillDown || palmJustLifted)) {
    view.panX = touchSnapshot.panX;
    view.panY = touchSnapshot.panY;
    view.zoom = touchSnapshot.zoom;
  }
  touchSnapshot = null;
}

// Pointer events rather than mouse events, because stylus pressure and
// getCoalescedEvents() only exist here — see brush/input.js.
//
// Fingers navigate. A pen or mouse uses the active tool. isPrimary is not
// consulted: on a tablet the stylus stops being primary the moment a palm
// or finger lands first, which would otherwise swallow the stroke.
//
// preventDefault() is limited to finger pointerdown. Calling it on a pen
// or mouse down suppresses the compatibility mouse events dblclick-to-measure
// needs. Text selection is blocked in CSS.
canvas.addEventListener("pointerdown", (event) => {
  if (isFinger(event)) {
    // A resting palm must not pan the page out from under a stroke.
    if (toolPointerId !== null || navPointerId !== null) return;
    event.preventDefault();
    rememberTouchOrigin();
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    capturePointer(event);
    rebaseTouchNavigation();
    return;
  }

  // The stylus takes the canvas. Drop any finger navigation already in flight.
  if (event.pointerType === "pen" && (touches.size || touchSnapshot)) {
    revertAccidentalPan();
    touches.clear();
    endNavigation();
  }

  // Pan is global (works regardless of active tool).
  if (isPanGesture(event)) {
    navPointerId = event.pointerId;
    interaction.panning = true;
    interaction.lastX = event.clientX;
    interaction.lastY = event.clientY;
    canvas.classList.add("panning");
    capturePointer(event);
    return;
  }
  // While the color eyedropper is sampling, don't start a stroke.
  if (isEyedropperActive()) return;
  // Quiet math chips (e.g. Graph) consume the click before tools.
  if (handleMathPointerDown(app, event)) return;
  toolPointerId = event.pointerId;
  capturePointer(event);
  const tool = getTool(activeTool);
  if (tool && tool.onPointerDown) tool.onPointerDown(app, event);
});

window.addEventListener("pointermove", (event) => {
  if (touches.has(event.pointerId)) {
    if (toolPointerId !== null) {
      dropTouch(event.pointerId);
      return;
    }
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    applyTouchNavigation();
    return;
  }
  if (navPointerId === event.pointerId) {
    panBy(event.clientX - interaction.lastX, event.clientY - interaction.lastY);
    interaction.lastX = event.clientX;
    interaction.lastY = event.clientY;
    return;
  }
  // Fingers never draw, and a second pointer must not extend a stroke.
  if (isFinger(event)) return;
  if (toolPointerId !== null && event.pointerId !== toolPointerId) return;
  if (isEyedropperActive()) return;
  const tool = getTool(activeTool);
  if (tool && tool.onPointerMove) tool.onPointerMove(app, event);
});

window.addEventListener("pointerup", (event) => {
  if (dropTouch(event.pointerId)) return;
  if (navPointerId === event.pointerId) {
    navPointerId = null;
    endNavigation();
    return;
  }
  if (toolPointerId !== event.pointerId) return;
  toolPointerId = null;
  // The eyedropper consumes its own release; don't also finish a stroke.
  if (isEyedropperActive()) return;
  const tool = getTool(activeTool);
  if (tool && tool.onPointerUp) tool.onPointerUp(app, event);
});

// A cancelled pointer means the gesture was invalidated (palm rejection, a
// system gesture taking over). Only the pointer that was drawing is
// discarded; a cancelled finger must not throw away the stylus stroke.
window.addEventListener("pointercancel", (event) => {
  if (dropTouch(event.pointerId)) return;
  if (navPointerId === event.pointerId) {
    navPointerId = null;
    endNavigation();
    return;
  }
  if (toolPointerId !== event.pointerId) return;
  toolPointerId = null;
  const tool = getTool(activeTool);
  if (tool && tool.onDeactivate) tool.onDeactivate(app);
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    zoomAt(event.clientX, event.clientY, factor);
  },
  { passive: false }
);

// Double-click any measurable shape to type an exact dimension. Typing a
// length is meaningless without a unit to type it in, so this follows the
// rest of the measurement layer into Engineer.
const PICK_TOLERANCE_PX = 8;
canvas.addEventListener("dblclick", (event) => {
  if (interaction.spaceDown || interaction.panning) return;
  if (openMathEditAt(event.clientX, event.clientY)) {
    event.preventDefault();
    return;
  }
  if (!isEngineering()) return;
  event.preventDefault();
  const world = screenToWorld(event.clientX, event.clientY);
  const tol = PICK_TOLERANCE_PX / view.zoom;
  const hit = scene.pick(world.x, world.y, tol);
  if (!hit) return;
  openMeasureDialog(app, hit, event.clientX, event.clientY);
});

// --- Keyboard ----------------------------------------------------------
// Space pans the canvas, and the letter keys switch tools. Both have to
// leave real controls alone: a focused button needs Space to activate, and
// a measurement or expression field needs Space, Backspace, and undo.
function eventTargetElement(event) {
  return event.target instanceof Element ? event.target : null;
}

function typingInField(event) {
  const t = eventTargetElement(event);
  if (!t) return false;
  return Boolean(t.closest("input, textarea, select, [contenteditable='true']"));
}

function onControl(event) {
  const t = eventTargetElement(event);
  if (!t) return false;
  return Boolean(t.closest("button, a, summary, input, textarea, select, [contenteditable='true']"));
}

const TOOL_KEYS = {
  KeyV: "select", KeyL: "line", KeyR: "rect", KeyC: "circle",
  KeyP: "pen", KeyN: "nudge", KeyS: "slice", KeyE: "eraser",
};

window.addEventListener("keydown", (event) => {
  if (measureDialogOpen() && event.code === "Escape") {
    closeMeasureDialog();
    event.preventDefault();
    return;
  }
  if (isMathEditOpen() && event.code === "Escape") {
    closeMathEdit();
    event.preventDefault();
    return;
  }

  if (event.code === "Space" || event.key === " ") {
    if (onControl(event)) return;
    if (!interaction.spaceDown) {
      interaction.spaceDown = true;
      canvas.classList.add("pannable");
    }
    event.preventDefault();
    return;
  }

  if (typingInField(event)) return;

  if (event.code === "F2") {
    debugOverlayVisible = !debugOverlayVisible;
    event.preventDefault();
    return;
  }

  // Undo / redo (global).
  if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
    if (event.shiftKey) history.redo(scene);
    else history.undo(scene);
    onSceneMutated(app);
    event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.code === "KeyY") {
    history.redo(scene);
    onSceneMutated(app);
    event.preventDefault();
    return;
  }

  // Delete selected (global; only when not typing in a field).
  if ((event.code === "Delete" || event.code === "Backspace") &&
      !(event.target instanceof HTMLInputElement) &&
      !(event.target instanceof HTMLSelectElement)) {
    if (scene.hasSelection()) {
      const sel = scene.getSelected();
      history.push(new RemoveElementsCommand(sel));
      for (const el of sel) scene.remove(el.id);
      onSceneMutated(app);
      event.preventDefault();
    }
    return;
  }

  // Duplicate selected (Ctrl/Cmd+D).
  if ((event.ctrlKey || event.metaKey) && event.code === "KeyD") {
    if (scene.hasSelection()) {
      const sel = scene.getSelected();
      const copies = sel.map((el) => {
        const c = cloneElement(el);
        c.id = nextId();
        return c;
      });
      for (const c of copies) {
        translateElement(c, 20, 20);
        scene.add(c);
      }
      history.push(new AddManyCommand(copies));
      scene.clearSelection();
      for (const c of copies) scene.addToSelection(c.id);
      onSceneMutated(app);
      event.preventDefault();
    }
    return;
  }

  // Tool shortcuts (ignored mid-drag).
  if (interaction.panning) return;
  const tool = getTool(activeTool);
  if (tool && tool.onKeydown && tool.onKeydown(app, event)) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (TOOL_KEYS[event.code] && !interaction.panning) {
    setActiveTool(TOOL_KEYS[event.code]);
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === "Space" || event.key === " ") {
    interaction.spaceDown = false;
    if (!interaction.panning) canvas.classList.remove("pannable");
    if (!onControl(event)) event.preventDefault();
  }
});

window.addEventListener("blur", () => {
  interaction.spaceDown = false;
  interaction.panning = false;
  canvas.classList.remove("pannable", "panning");
});

window.addEventListener("resize", resizeCanvas);

/** Command: add several elements at once (for duplicate). */
class AddManyCommand {
  constructor(elements) { this.elements = elements.map(cloneElement); }
  apply(scene) { for (const e of this.elements) scene.add(cloneElement(e)); }
  undo(scene) { for (const e of this.elements) scene.remove(e.id); }
}

// --- Render loop -------------------------------------------------------
function render() {
  resetToScreenSpace(ctx);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground(ctx, view);

  // World-space scene. Artboards are a drafting construct, so they travel
  // with the rest of the measurement layer rather than with the drawing.
  applyViewTransform(ctx, view);
  drawGrid(ctx, view);
  const engineering = isEngineering();
  if (engineering) drawArtboardsWorld(ctx, view, scene.artboards);
  const tool = getTool(activeTool);
  const preview = tool && tool.getPreview ? tool.getPreview(app) : null;
  const doomed = tool && tool.getDoomed ? tool.getDoomed() : null;
  drawShapeGuides(ctx, view, preview);
  drawInkLayer(ctx, scene, view, doomed);
  drawLivePreview(ctx, view, preview);

  // Screen-space overlays. The whole measurement layer is Engineer-only;
  // dimensionMode still decides its form, but only once it is on screen.
  resetToScreenSpace(ctx);
  if (engineering) {
    if (scaleSettings.dimensionMode === "cad") {
      drawCadDimensions(ctx, scene, view, preview ? preview.element : null);
      drawLiveCadDimension(ctx, preview, view);
    } else if (scaleSettings.dimensionMode === "labels") {
      drawCommittedMeasurements(ctx, scene, view, preview ? preview.element : null);
      drawMeasurementLabel(ctx, preview, view);
    }
    drawArtboardLabels(ctx, view, scene.artboards);
  }

  // Selection handles / marquee / slice blade.
  if (tool && tool.getOverlay) {
    const ov = tool.getOverlay(app);
    if (ov && ov.kind === "handles") drawSelectionOverlay(ctx, view, ov.bounds);
  }
  if (tool && tool.getMarquee) {
    const m = tool.getMarquee(app);
    if (m) drawMarquee(ctx, m.x0, m.y0, m.x1, m.y1);
  }
  if (tool && tool.getSlice) {
    const sl = tool.getSlice(app);
    if (sl) drawSliceBlade(ctx, sl);
  }
  if (tool && tool.getEraser) {
    const er = tool.getEraser(app);
    if (er) drawEraser(ctx, er);
  }

  if (engineering) drawScaleBar(ctx, view);
  drawMathLayer(ctx, view);
  if (debugOverlayVisible) drawDebugOverlay();
  styleWheelFrame(app);
}

function drawEraser(ctx, er) {
  const c = worldToScreen(er.x, er.y);
  const r = Math.max(1, er.r * view.zoom);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 90, 90, 0.95)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function traceSlice(ctx, pts) {
  const p0 = worldToScreen(pts[0].x, pts[0].y);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i++) {
    const p = worldToScreen(pts[i].x, pts[i].y);
    ctx.lineTo(p.x, p.y);
  }
}

/** Faint reach of the swipe, plus a thin centerline. The deletion signal is
 *  the greyed object, so the swipe itself stays light. */
function drawSliceBlade(ctx, sl) {
  const pts = sl.points;
  if (!pts || pts.length === 0) return;
  const r = Math.max(1, sl.r * view.zoom);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (pts.length === 1) {
    const p = worldToScreen(pts[0].x, pts[0].y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(70, 70, 70, 0.12)";
    ctx.fill();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = "rgba(40, 40, 40, 0.75)";
    ctx.stroke();
    return;
  }
  traceSlice(ctx, pts);
  ctx.lineWidth = r * 2;
  ctx.strokeStyle = "rgba(70, 70, 70, 0.14)";
  ctx.stroke();
  traceSlice(ctx, pts);
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = "rgba(40, 40, 40, 0.8)";
  ctx.stroke();
}

function drawDebugOverlay() {
  const padding = 12;
  const lineH = 18;
  const brush = brushCacheStats();
  const ink = inkLayerStats();
  const lines = [
    `panX:  ${view.panX.toFixed(1)}`,
    `panY:  ${view.panY.toFixed(1)}`,
    `zoom:  ${view.zoom.toFixed(3)}`,
    `tool:  ${activeTool}`,
    `elems: ${scene.elements.length}`,
    `sel:   ${scene.selected.size}`,
    `brush: ${brush.entries} / ${brush.megapixels} MP`,
    `ink:   ${ink.mode}`,
  ];
  ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textBaseline = "top";
  let maxW = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxW) maxW = w;
  }
  const boxW = maxW + padding * 2;
  const boxH = lines.length * lineH + padding * 2 - 4;
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(padding, padding, boxW, boxH);
  ctx.fillStyle = "#9fe8b0";
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], padding * 2, padding + i * lineH);
  }
}

function frameLoop() {
  render();
  requestAnimationFrame(frameLoop);
}

// --- Boot --------------------------------------------------------------
resizeCanvas();
syncPanelFromSettings();
initStyleWheel(app);
setActiveTool("line");
installBrushTestbed(app);
requestAnimationFrame(frameLoop);

