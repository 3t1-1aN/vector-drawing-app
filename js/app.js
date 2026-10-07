// app.js
// Application glue: owns the canvas context, view, scene, history, the
// active tool, and the rAF render loop. Routes pointer/keyboard input to
// the active tool (after handling pan/zoom globally), wires the toolbar
// and the precision/project panel, and draws everything each frame.

import {
  getCanvas, getContext, resizeCanvas, deviceScale,
  resetToScreenSpace, applyViewTransform,
} from "./core/canvas.js";
import {
  view, screenToWorld, worldToScreen, panBy, zoomAt, fitToBounds, clamp,
  setPageConstraint, constrainView,
} from "./core/view.js";
import { Scene, History, AddElementCommand, RemoveElementsCommand, cloneElement } from "./scene/scene.js";
import { createIdElement, nextId, translateElement, getBounds, getRectCorners } from "./scene/element.js";
import { GRID_MAJOR, GRID_MINOR } from "./render/grid.js";
import { drawGrid } from "./render/grid.js";
import { drawBackground } from "./render/background.js";
import { initWorkspacePanel } from "./ui/workspace-panel.js";
import { isEngineering, bindWorkspace } from "./workspace/mode.js";
import { bindAppearance, appearance, getBackgroundBaseColor, BACKGROUNDS } from "./workspace/appearance.js";
import { bindScale } from "./precision/scale.js";
import { createDocument, createNotebookPage, applyClassicLook } from "./scene/document.js";
import { isFilledMedium } from "./brush/presets.js";
import { initStyleWheel, styleWheelFrame, resetStyleWheel } from "./ui/style-wheel.js";
import { touchScene, inkSceneRev } from "./render/ink-rev.js";
import { drawCommitted, drawLivePreview, drawTexts } from "./render/elements.js";
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
import { textTool, handleDoubleTap, doubleTapConsumed, isEditingText } from "./tools/text.js";
import { exportSvg, downloadText } from "./io/export-svg.js";
import { serializeProject, deserializeProject, pickFile, readFileText } from "./io/project.js";
import { openMeasureDialog, closeMeasureDialog, isOpen as measureDialogOpen } from "./ui/measure-dialog.js";
import { openMathEditAt, closeMathEdit, isMathEditOpen } from "./ui/math-edit.js";
import { isEyedropperActive } from "./ui/color-picker.js";
import { setBrush } from "./brush/active-brush.js";
import { mathAssist } from "./math/settings.js";
import { beginBrushFrame, brushCacheStats } from "./brush/cache.js";
import { installBrushTestbed } from "./brush/testbed.js";
import {
  drawMathLayer,
  handleMathPointerDown,
  mathOverlayStamp,
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
registerTool("text", textTool);
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
let activeDocument = null;
// Drawings parked in the gallery for this session. Going home keeps them.
// A reload still clears the gallery; file save is separate.
const desk = [];
let deskSerial = 0;
let galleryFilter = "all";
// One save stays on the stack between frames so a notebook clip cannot leak.
// Resizing the canvas wipes that stack; the resize handler clears this flag.
let frameSaved = false;

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
function isClassicOpen() {
  return !!(activeDocument && activeDocument.kind === "notebook" && activeDocument.classic);
}

function setActiveTool(name) {
  if (isClassicOpen() && name !== "pen") return;
  const tool = getTool(name);
  if (!tool) return;
  const prev = getTool(activeTool);
  if (prev && prev.onDeactivate) prev.onDeactivate(app);
  if (name !== "text" && isEditingText()) textTool.onDeactivate(app);
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
  const data = serializeProject(scene, notebookFileExtras());
  downloadText("drawing.vda", JSON.stringify(data, null, 2), "application/json");
});

document.getElementById("loadProject").addEventListener("click", async () => {
  try {
    const file = await pickFile(".vda,application/json");
    const text = await readFileText(file);
    const data = JSON.parse(text);
    const restored = deserializeProject(data, scene);
    deserializeMathState(data.math, app);
    history.clear();
    if (activeDocument) activeDocument.mathAssist = mathAssist.enabled;
    if (activeDocument && activeDocument.kind === "notebook" && restored && restored.pages) {
      activeDocument.pages = restored.pages;
      activeDocument.pageIndex = restored.pageIndex;
      activeDocument.classic = restored.classic;
      if (restored.classic) applyClassicLook(activeDocument);
      const page = activeDocument.pages[activeDocument.pageIndex];
      scene.elements = page.elements;
      setPageConstraint(page, { cover: true });
      if (page.math) deserializeMathState(page.math, app);
      syncClassicChrome();
    } else if (activeDocument && activeDocument.kind === "notebook") {
      const page = activePage();
      if (page) page.elements = scene.elements;
      syncClassicChrome();
    }
    constrainView();
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
// Below this width the 232px panel covers the sheet and the control wheel.
// Phones and a portrait tablet in split view hit it; a landscape tablet does not.
const PANEL_OVERLAY_WIDTH = 720;

function setPanelOpen(open) {
  panel.classList.toggle("collapsed", !open);
  // A closed panel is only faded out. Without inert, Tab still walks every
  // control inside it, including ones the user cannot see.
  panel.inert = !open;
  panelToggle.setAttribute("aria-expanded", String(open));
}

// matchMedia, not a one-time innerWidth read. A viewport can settle after
// the module runs, and the change event still fires when it does.
const narrowPanel = window.matchMedia(`(max-width: ${PANEL_OVERLAY_WIDTH - 1}px)`);
let userChosePanel = false;

function syncPanelLayout() {
  if (userChosePanel) return;
  setPanelOpen(!narrowPanel.matches);
}

syncPanelLayout();
narrowPanel.addEventListener("change", syncPanelLayout);
window.addEventListener("resize", syncPanelLayout);
window.addEventListener("load", syncPanelLayout);
panelToggle.addEventListener("click", () => {
  userChosePanel = true;
  setPanelOpen(panel.classList.contains("collapsed"));
});
const workspacePanel = initWorkspacePanel({
  onChange(detail) {
    if (detail && "mathAssist" in detail) {
      if (activeDocument) activeDocument.mathAssist = !!detail.mathAssist;
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
// One-finger notebook flick. A second finger, or a slow drag, stays a pan.
let fingerTrack = null;

function noteFinger(event) {
  if (!activeDocument || activeDocument.kind !== "notebook") return;
  if (!fingerTrack) {
    fingerTrack = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: performance.now(),
      panX: view.panX,
      panY: view.panY,
      zoom: view.zoom,
      multi: false,
    };
    return;
  }
  fingerTrack.multi = true;
}

function maybeNotebookFlick(event) {
  const track = fingerTrack;
  fingerTrack = null;
  if (!track || track.multi || track.id !== event.pointerId) return;
  if (!activeDocument || activeDocument.kind !== "notebook" || pageTurn) return;
  const dx = event.clientX - track.x;
  const dy = event.clientY - track.y;
  const dt = performance.now() - track.t;
  if (dt > 480 || Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
  touchSnapshot = null;
  view.panX = track.panX;
  view.panY = track.panY;
  view.zoom = track.zoom;
  constrainView();
  turnNotebookPage(dx > 0 ? 1 : -1);
}

function dropTouch(pointerId, event) {
  if (!touches.delete(pointerId)) return false;
  if (touches.size === 0) {
    const snapshot = touchSnapshot;
    touchEndedAt = performance.now();
    setTimeout(() => {
      if (touchSnapshot === snapshot) touchSnapshot = null;
    }, 160);
    if (event && event.type === "pointerup") maybeNotebookFlick(event);
    else fingerTrack = null;
  } else if (fingerTrack) {
    fingerTrack.multi = true;
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
  if (!activeDocument) return;
  if (isFinger(event)) {
    // A resting palm must not pan the page out from under a stroke.
    if (toolPointerId !== null || navPointerId !== null) return;
    event.preventDefault();
    noteFinger(event);
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
  // A second tap on a box, circle, or note types into it. Swallow the tap
  // so the tool underneath does not also start a stroke.
  if (handleDoubleTap(app, event)) {
    capturePointer(event);
    return;
  }
  // A label opened from another tool commits when the next stroke starts.
  if (isEditingText() && activeTool !== "text") textTool.onDeactivate(app);
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
  if (dropTouch(event.pointerId, event)) return;
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
    if (!activeDocument) return;
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
  if (doubleTapConsumed()) {
    event.preventDefault();
    return;
  }
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
  KeyP: "pen", KeyT: "text", KeyN: "nudge", KeyS: "slice", KeyE: "eraser",
};

window.addEventListener("keydown", (event) => {
  if (!activeDocument) return;
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

  // A typewriter note takes the key before pan, delete, and tool shortcuts,
  // including when the note was opened by a double-tap under another tool.
  const typingTool = isEditingText() ? textTool : getTool(activeTool);
  if (!onControl(event) && typingTool && typingTool.onKeydown && typingTool.onKeydown(app, event)) {
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

  if (activeDocument.kind === "notebook" && !onControl(event)) {
    if (event.code === "ArrowRight") {
      turnNotebookPage(1);
      event.preventDefault();
      return;
    }
    if (event.code === "ArrowLeft") {
      turnNotebookPage(-1);
      event.preventDefault();
      return;
    }
  }

  // Tool shortcuts (ignored mid-drag, and in a classic notebook).
  if (interaction.panning) return;
  const tool = getTool(activeTool);
  if (tool && tool.onKeydown && tool.onKeydown(app, event)) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (isClassicOpen()) return;
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

window.addEventListener("resize", () => {
  resizeCanvas();
  frameSaved = false;
  constrainView();
});

/** Command: add several elements at once (for duplicate). */
class AddManyCommand {
  constructor(elements) { this.elements = elements.map(cloneElement); }
  apply(scene) { for (const e of this.elements) scene.add(cloneElement(e)); }
  undo(scene) { for (const e of this.elements) scene.remove(e.id); }
}

// --- Document ----------------------------------------------------------
function activePage() {
  if (!activeDocument || activeDocument.kind !== "notebook") return null;
  const pages = activeDocument.pages;
  const index = activeDocument.pageIndex || 0;
  return pages[index] || pages[0] || null;
}

function pageBounds(page) {
  return {
    minX: page.x,
    minY: page.y,
    maxX: page.x + page.width,
    maxY: page.y + page.height,
  };
}

function ensurePageRecord(page) {
  if (!page.elements) page.elements = [];
  if (!("math" in page)) page.math = null;
  return page;
}

function clearDrawing() {
  scene.elements = [];
  scene.artboards = [];
  scene.clearSelection();
  history.clear();
  touchScene();
  onSceneMutated(app);
}

function uniqueTitle(base) {
  const used = new Set(desk.map((entry) => entry.title));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

function deskTitle(kind) {
  return uniqueTitle(kind === "notebook" ? "Notebook" : "Infinite note");
}

function commitOpenPage() {
  if (!activeDocument || activeDocument.kind !== "notebook") return;
  const page = activePage();
  if (!page) return;
  page.elements = scene.elements;
  page.math = serializeMathState();
}

function notebookFileExtras() {
  const extras = { math: serializeMathState() };
  if (activeDocument && activeDocument.kind === "notebook") {
    commitOpenPage();
    extras.pages = activeDocument.pages;
    extras.pageIndex = activeDocument.pageIndex || 0;
    extras.classic = !!activeDocument.classic;
    extras.kind = "notebook";
  }
  return extras;
}

function syncClassicChrome() {
  const classic = isClassicOpen();
  document.body.classList.toggle("is-classic", classic);
  if (!classic) return;
  applyClassicLook(activeDocument);
  setMathEnabled(app, false);
  if (activeTool !== "pen") setActiveTool("pen");
  setBrush({ toolType: "pen", medium: "pencil", stroke: "#2b2b30" });
  resetStyleWheel();
  syncWorkspacePanel();
}

function parkActive() {
  if (!activeDocument) return;
  const entry = desk.find((item) => item.document === activeDocument);
  if (!entry) return;
  if (isEditingText()) textTool.onDeactivate(app);
  if (activeDocument.kind === "notebook") commitOpenPage();
  entry.elements = scene.elements.map((el) => cloneElement(el));
  entry.artboards = scene.artboards.map((board) => ({ ...board }));
  entry.view = { panX: view.panX, panY: view.panY, zoom: view.zoom };
  entry.math = activeDocument.kind === "notebook" ? null : serializeMathState();
  if (!activeDocument.classic) entry.document.mathAssist = mathAssist.enabled;
  paintThumb(entry);
}

function applyEntry(entry, fresh) {
  const doc = entry.document;
  activeDocument = doc;
  bindAppearance(doc.appearance);
  bindScale(doc.scale);
  bindWorkspace(doc.workspace);
  scene.artboards = entry.artboards.map((board) => ({ ...board }));
  scene.clearSelection();
  history.clear();
  if (doc.kind === "notebook") {
    if (doc.pageIndex == null) doc.pageIndex = 0;
    const page = ensurePageRecord(doc.pages[doc.pageIndex] || doc.pages[0]);
    scene.elements = page.elements;
    const mathOn = doc.classic ? false : doc.mathAssist;
    setMathEnabled(app, mathOn);
    deserializeMathState(page.math || { enabled: mathOn, regions: [], widgets: [] }, app);
    setPageConstraint(page, { cover: true });
    if (fresh || !entry.view) fitToBounds(pageBounds(page), 0);
    else {
      view.panX = entry.view.panX;
      view.panY = entry.view.panY;
      view.zoom = entry.view.zoom;
      constrainView();
    }
  } else {
    setMathEnabled(app, doc.mathAssist);
    scene.elements = entry.elements.map((el) => cloneElement(el));
    deserializeMathState(entry.math || { enabled: doc.mathAssist, regions: [], widgets: [] }, app);
    setPageConstraint(null);
    view.panX = entry.view ? entry.view.panX : 0;
    view.panY = entry.view ? entry.view.panY : 0;
    view.zoom = entry.view ? entry.view.zoom : 1;
  }
  touchScene();
  onSceneMutated(app);
  syncPanelFromSettings();
  // Show the canvas before placing the wheel. While .is-home is set the
  // wheel is display:none and its box is empty, so a clamp would park it
  // in the corner instead of where it was.
  document.body.classList.remove("is-home");
  syncClassicChrome();
  resetStyleWheel();
}

function enterDocument(kind, options = {}) {
  parkActive();
  const doc = createDocument(kind, options);
  deskSerial += 1;
  const title = (options.title && String(options.title).trim()) || deskTitle(kind);
  const entry = {
    id: deskSerial,
    kind: doc.kind,
    title,
    document: doc,
    elements: [],
    artboards: [],
    view: null,
    math: null,
  };
  desk.push(entry);
  clearDrawing();
  applyEntry(entry, true);
}

function kindLabel(kind) {
  return kind === "notebook" ? "Notebook" : "Infinite note";
}

function matchesFilter(entry) {
  return galleryFilter === "all" || entry.kind === galleryFilter;
}

function paperColorOf(doc) {
  const look = doc?.appearance;
  if (!look) return "#F4F0E6";
  if (look.background === "transparent") return "#f3f1ee";
  if (look.background === "custom") return look.backgroundColor || "#F4F0E6";
  return BACKGROUNDS[look.background]?.color || "#F4F0E6";
}

function thumbFrame(entry) {
  if (entry.kind === "notebook") {
    const page = entry.document.pages[entry.document.pageIndex || 0] || entry.document.pages[0];
    if (page) {
      return {
        minX: page.x, minY: page.y,
        maxX: page.x + page.width, maxY: page.y + page.height,
      };
    }
  }
  let box = null;
  for (const el of entry.elements) {
    if (el.type === "path" && !el.points?.length) continue;
    const b = getBounds(el);
    if (!Number.isFinite(b.minX) || !Number.isFinite(b.maxX)) continue;
    if (!box) box = { ...b };
    else {
      box.minX = Math.min(box.minX, b.minX);
      box.minY = Math.min(box.minY, b.minY);
      box.maxX = Math.max(box.maxX, b.maxX);
      box.maxY = Math.max(box.maxY, b.maxY);
    }
  }
  if (!box) return { minX: -360, minY: -220, maxX: 360, maxY: 220 };
  const padX = Math.max(24, (box.maxX - box.minX) * 0.12);
  const padY = Math.max(24, (box.maxY - box.minY) * 0.12);
  return {
    minX: box.minX - padX, minY: box.minY - padY,
    maxX: box.maxX + padX, maxY: box.maxY + padY,
  };
}

function traceThumb(ctx, el) {
  switch (el.type) {
    case "line":
      ctx.moveTo(el.startX, el.startY);
      ctx.lineTo(el.endX, el.endY);
      break;
    case "rect":
    case "square": {
      const c = getRectCorners(el);
      ctx.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
      ctx.closePath();
      break;
    }
    case "circle":
      ctx.moveTo(el.cx + el.r, el.cy);
      ctx.arc(el.cx, el.cy, el.r, 0, Math.PI * 2);
      break;
    case "triangle": {
      const c = el.corners || [];
      if (!c.length) break;
      ctx.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < c.length; i++) ctx.lineTo(c[i].x, c[i].y);
      ctx.closePath();
      break;
    }
    case "path":
      if (!el.points?.length) break;
      ctx.moveTo(el.points[0].x, el.points[0].y);
      for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
      break;
    default:
      break;
  }
}

/** Flat preview stored on the entry. Not the live brush. */
function paintThumb(entry) {
  const notebook = entry.kind === "notebook";
  const page = notebook
    ? (entry.document.pages[entry.document.pageIndex || 0] || entry.document.pages[0])
    : null;
  const aspect = page && page.height ? page.width / page.height : 16 / 10;
  const w = notebook ? 360 : 440;
  const h = notebook ? Math.max(1, Math.round(w / aspect)) : 264;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const frame = thumbFrame(entry);
  ctx.fillStyle = paperColorOf(entry.document);
  ctx.fillRect(0, 0, w, h);
  const fw = Math.max(1, frame.maxX - frame.minX);
  const fh = Math.max(1, frame.maxY - frame.minY);
  const scale = Math.min((w * 0.92) / fw, (h * 0.92) / fh);
  ctx.save();
  ctx.translate((w - fw * scale) / 2 - frame.minX * scale, (h - fh * scale) / 2 - frame.minY * scale);
  ctx.scale(scale, scale);
  if (notebook) {
    ctx.beginPath();
    ctx.rect(frame.minX, frame.minY, fw, fh);
    ctx.clip();
  }
  for (const el of entry.elements) {
    const style = el.style || {};
    ctx.globalAlpha = style.opacity ?? 1;
    const ink = style.stroke || "#2b2b30";
    if (el.type === "text") {
      ctx.fillStyle = ink;
      ctx.font = `${el.size || 16}px "Special Elite", "Courier Prime", "Courier New", Courier, monospace`;
      ctx.textBaseline = "top";
      ctx.fillText(el.text || "", el.x, el.y);
      continue;
    }
    ctx.beginPath();
    traceThumb(ctx, el);
    if (isFilledMedium(style.medium)) {
      ctx.fillStyle = ink;
      ctx.fill();
    } else {
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(style.strokeWidth || 2, 1);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }
  ctx.restore();
  entry.thumb = canvas.toDataURL("image/png");
}

function renderDesk() {
  const host = document.getElementById("homeSheets");
  const empty = document.getElementById("homeEmpty");
  host.replaceChildren();
  for (const btn of document.querySelectorAll("#homeSide [data-filter]")) {
    btn.setAttribute("aria-pressed", String(btn.dataset.filter === galleryFilter));
  }
  const visible = desk.filter(matchesFilter);
  empty.hidden = visible.length > 0;
  for (const entry of visible) {
    const card = document.createElement("div");
    card.className = `home-sheet is-${entry.kind === "notebook" ? "notebook" : "infinite"}`;
    card.dataset.id = String(entry.id);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open ${entry.title}, ${kindLabel(entry.kind)}`);
    const paper = document.createElement("span");
    paper.className = "home-sheet-paper";
    if (entry.kind === "notebook") {
      const page = entry.document.pages[0];
      if (page && page.height) paper.style.aspectRatio = `${page.width} / ${page.height}`;
    }
    if (entry.thumb) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = entry.thumb;
      paper.appendChild(img);
    }
    const title = document.createElement("span");
    title.className = "home-sheet-title";
    title.textContent = entry.title;
    card.append(paper, title);
    host.appendChild(card);
  }
}

let notebookSetup = null;

function resetNotebookSetup() {
  notebookSetup = null;
  const kinds = document.getElementById("homeChooserKinds");
  const form = document.getElementById("homeNotebookSetup");
  if (kinds) kinds.hidden = false;
  if (form) form.hidden = true;
}

function setChooserOpen(open) {
  const chooser = document.getElementById("homeChooser");
  const add = document.getElementById("homeAdd");
  chooser.hidden = !open;
  add.setAttribute("aria-expanded", String(open));
  if (!open) resetNotebookSetup();
}

function openNotebookSetup(mode, entry) {
  closeGalleryMenu();
  setChooserOpen(true);
  notebookSetup = mode === "edit" && entry
    ? { mode: "edit", id: entry.id }
    : { mode: "create" };
  document.getElementById("homeChooserKinds").hidden = true;
  const form = document.getElementById("homeNotebookSetup");
  form.hidden = false;
  const name = document.getElementById("homeNotebookName");
  const classic = document.getElementById("homeNotebookClassic");
  const submit = document.getElementById("homeNotebookCreate");
  if (notebookSetup.mode === "edit") {
    name.value = entry.title;
    classic.checked = !!entry.document.classic;
    submit.textContent = "Save";
  } else {
    name.value = deskTitle("notebook");
    classic.checked = false;
    submit.textContent = "Create";
  }
  name.focus();
  name.select();
}

function commitNotebookSetup() {
  const nameInput = document.getElementById("homeNotebookName");
  const classic = document.getElementById("homeNotebookClassic").checked;
  const name = nameInput.value.trim();
  const setup = notebookSetup;
  setChooserOpen(false);
  if (!setup) return;
  if (setup.mode === "edit") {
    const entry = entryById(setup.id);
    if (!entry) return;
    if (name) entry.title = name;
    if (classic) applyClassicLook(entry.document);
    else entry.document.classic = false;
    renderDesk();
    return;
  }
  enterDocument("notebook", { title: name, classic });
}

function showHome() {
  parkActive();
  clearDrawing();
  activeDocument = null;
  setPageConstraint(null);
  resetStyleWheel();
  setChooserOpen(false);
  closeGalleryMenu();
  renderDesk();
  document.body.classList.add("is-home");
  document.body.classList.remove("is-classic");
}

function openDeskEntry(id) {
  const entry = desk.find((item) => item.id === id);
  if (!entry) return;
  parkActive();
  applyEntry(entry, false);
}

let galleryMenu = null;
let suppressOpen = false;
let galleryPress = null;

function closeGalleryMenu() {
  if (galleryMenu) galleryMenu.hidden = true;
}

function entryById(id) {
  return desk.find((item) => item.id === id);
}

function beginRename(entry) {
  closeGalleryMenu();
  const card = document.querySelector(`.home-sheet[data-id="${entry.id}"]`);
  const title = card?.querySelector(".home-sheet-title");
  if (!title) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "home-rename";
  input.value = entry.title;
  input.setAttribute("aria-label", "Rename drawing");
  title.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = (keep) => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    if (keep && next) entry.title = next;
    renderDesk();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      commit(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      commit(false);
    }
  });
  input.addEventListener("blur", () => commit(true));
}

function duplicateEntry(entry) {
  deskSerial += 1;
  desk.push({
    id: deskSerial,
    kind: entry.kind,
    title: uniqueTitle(`${entry.title} copy`),
    document: structuredClone(entry.document),
    elements: entry.elements.map((el) => cloneElement(el)),
    artboards: entry.artboards.map((board) => structuredClone(board)),
    view: entry.view ? { ...entry.view } : null,
    math: entry.math ? structuredClone(entry.math) : null,
    thumb: entry.thumb || null,
  });
  closeGalleryMenu();
  renderDesk();
}

function deleteEntry(id) {
  const index = desk.findIndex((item) => item.id === id);
  if (index >= 0) desk.splice(index, 1);
  closeGalleryMenu();
  renderDesk();
}

function openGalleryMenu(entry, x, y) {
  if (!galleryMenu || !entry) return;
  galleryMenu.replaceChildren();
  const actions = [
    ["Rename", () => beginRename(entry)],
  ];
  if (entry.kind === "notebook") actions.push(["Settings", () => openNotebookSetup("edit", entry)]);
  actions.push(
    ["Duplicate", () => duplicateEntry(entry)],
    ["Delete", () => deleteEntry(entry.id), "danger"],
  );
  for (const [label, run, tone] of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    if (tone) btn.className = tone;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      run();
    });
    galleryMenu.appendChild(btn);
  }
  galleryMenu.hidden = false;
  const pad = 8;
  const rect = galleryMenu.getBoundingClientRect();
  galleryMenu.style.left = `${Math.max(pad, Math.min(x, window.innerWidth - rect.width - pad))}px`;
  galleryMenu.style.top = `${Math.max(pad, Math.min(y, window.innerHeight - rect.height - pad))}px`;
}

function wireHome() {
  const home = document.getElementById("home");
  const add = document.getElementById("homeAdd");
  const sheets = document.getElementById("homeSheets");
  galleryMenu = document.createElement("div");
  galleryMenu.id = "homeMenu";
  galleryMenu.className = "home-menu";
  galleryMenu.hidden = true;
  galleryMenu.setAttribute("role", "menu");
  home.appendChild(galleryMenu);

  add.addEventListener("click", (event) => {
    event.stopPropagation();
    closeGalleryMenu();
    setChooserOpen(document.getElementById("homeChooser").hidden);
  });
  document.getElementById("homeInfinite").addEventListener("click", () => {
    setChooserOpen(false);
    enterDocument("infinite");
  });
  document.getElementById("homeNotebook").addEventListener("click", () => {
    openNotebookSetup("create");
  });
  document.getElementById("homeNotebookSetup").addEventListener("submit", (event) => {
    event.preventDefault();
    commitNotebookSetup();
  });
  document.getElementById("homeNotebookCancel").addEventListener("click", () => {
    resetNotebookSetup();
  });
  for (const btn of document.querySelectorAll("#homeSide [data-filter]")) {
    btn.addEventListener("click", () => {
      galleryFilter = btn.dataset.filter;
      closeGalleryMenu();
      setChooserOpen(false);
      renderDesk();
    });
  }

  sheets.addEventListener("click", (event) => {
    if (suppressOpen) { suppressOpen = false; return; }
    if (event.target.closest("input, .home-menu")) return;
    const sheet = event.target.closest(".home-sheet");
    if (!sheet) return;
    openDeskEntry(Number(sheet.dataset.id));
  });
  sheets.addEventListener("keydown", (event) => {
    if (event.target.closest("input")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const sheet = event.target.closest(".home-sheet");
    if (!sheet) return;
    event.preventDefault();
    openDeskEntry(Number(sheet.dataset.id));
  });
  sheets.addEventListener("contextmenu", (event) => {
    const sheet = event.target.closest(".home-sheet");
    if (!sheet) return;
    event.preventDefault();
    setChooserOpen(false);
    openGalleryMenu(entryById(Number(sheet.dataset.id)), event.clientX, event.clientY);
  });
  sheets.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const sheet = event.target.closest(".home-sheet");
    if (!sheet || event.target.closest("input")) return;
    const id = Number(sheet.dataset.id);
    galleryPress = { id, x: event.clientX, y: event.clientY, timer: setTimeout(() => {
      suppressOpen = true;
      window.addEventListener("click", (clickEvent) => {
        suppressOpen = false;
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
      }, { capture: true, once: true });
      setChooserOpen(false);
      openGalleryMenu(entryById(id), event.clientX, event.clientY);
      galleryPress = null;
    }, 480) };
  });
  const clearPress = (event) => {
    if (!galleryPress) return;
    const press = galleryPress;
    const moved = event && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8;
    if (!event || moved || event.type !== "pointermove") {
      clearTimeout(press.timer);
      galleryPress = null;
    }
    // A finger or stylus on a tablet often never produces a click (the canvas
    // overlay, or a scrollable sheet, eats it). Open on the lift instead.
    // The click that does follow is swallowed so the drawing is not entered twice.
    if (event && event.type === "pointerup" && !moved && event.pointerType !== "mouse") {
      const swallow = (clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 700);
      openDeskEntry(press.id);
    }
  };
  sheets.addEventListener("pointermove", clearPress);
  sheets.addEventListener("pointerup", clearPress);
  sheets.addEventListener("pointercancel", clearPress);

  home.addEventListener("click", (event) => {
    if (event.target.closest("#homeChooser, #homeAdd, #homeMenu, .home-rename")) return;
    setChooserOpen(false);
    closeGalleryMenu();
  });
  document.getElementById("homeBack").addEventListener("click", showHome);
  window.addEventListener("keydown", (event) => {
    if (activeDocument || event.key !== "Escape") return;
    const chooserOpen = !document.getElementById("homeChooser").hidden;
    const menuOpen = galleryMenu && !galleryMenu.hidden;
    if (!chooserOpen && !menuOpen) return;
    setChooserOpen(false);
    closeGalleryMenu();
    event.preventDefault();
  });
}

function pageScreenRect(page) {
  const origin = worldToScreen(page.x, page.y);
  return {
    x: origin.x,
    y: origin.y,
    w: page.width * view.zoom,
    h: page.height * view.zoom,
  };
}

function pageCoversView(pageRect) {
  if (!pageRect) return false;
  return pageRect.x <= 0.5 && pageRect.y <= 0.5
    && pageRect.x + pageRect.w >= window.innerWidth - 0.5
    && pageRect.y + pageRect.h >= window.innerHeight - 0.5;
}

const PAGE_TURN_MS = 280;
let pageTurn = null;

function copyPlate() {
  if (!plate || !plate.width) return null;
  const copy = document.createElement("canvas");
  copy.width = plate.width;
  copy.height = plate.height;
  const copyCtx = copy.getContext("2d");
  copyCtx.drawImage(plate, 0, 0);
  return copy;
}

function appendNotebookPage(doc) {
  const first = doc.pages[0];
  const size = first
    ? { width: first.width, height: first.height }
    : { width: window.innerWidth, height: window.innerHeight };
  doc.pages.push(createNotebookPage(size.width, size.height));
}

function showNotebookPage(index) {
  const doc = activeDocument;
  const page = ensurePageRecord(doc.pages[index]);
  doc.pageIndex = index;
  if (isEditingText()) textTool.onDeactivate(app);
  scene.elements = page.elements;
  scene.clearSelection();
  history.clear();
  const mathOn = doc.classic ? false : doc.mathAssist;
  setMathEnabled(app, mathOn);
  deserializeMathState(page.math || { enabled: mathOn, regions: [], widgets: [] }, app);
  setPageConstraint(page, { cover: true });
  constrainView();
  touchScene();
  onSceneMutated(app);
  plateKey = "";
}

function turnNotebookPage(delta) {
  if (!activeDocument || activeDocument.kind !== "notebook" || pageTurn) return;
  const doc = activeDocument;
  const next = (doc.pageIndex || 0) + delta;
  if (delta < 0 && next < 0) return;
  if (delta > 0 && next >= doc.pages.length) appendNotebookPage(doc);
  if (next < 0 || next >= doc.pages.length || next === doc.pageIndex) return;
  const outgoing = copyPlate();
  commitOpenPage();
  showNotebookPage(next);
  if (outgoing) {
    pageTurn = { from: outgoing, dir: delta > 0 ? 1 : -1, start: performance.now() };
  }
}

// Settled picture of the page: paper, grid, committed ink, labels. Rebuilt
// when the view or the scene changes, then blitted. A finger pan or pinch
// moves this bitmap instead of re-running the paper shader and the ink
// composite on every sample — that rebuild is what makes a tablet feel late.
let plate = null;
let plateCtx = null;
let plateKey = "";
let plateView = null;
// Grid and ink without the paper, so a pinch can scale them while the
// sheet underneath stays at its default grain size.
let marks = null;
let marksCtx = null;

function ensurePlate() {
  if (plate && plate.width === canvas.width && plate.height === canvas.height) return;
  plate = document.createElement("canvas");
  plate.width = canvas.width;
  plate.height = canvas.height;
  plateCtx = plate.getContext("2d", { alpha: false });
  plateKey = "";
}

function ensureMarks() {
  if (marks && marks.width === canvas.width && marks.height === canvas.height) return;
  marks = document.createElement("canvas");
  marks.width = canvas.width;
  marks.height = canvas.height;
  marksCtx = marks.getContext("2d", { alpha: true });
}

function idSetStamp(set) {
  if (!set || !set.size) return "0";
  let h = set.size;
  for (const id of set) {
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x9e3779b1);
  }
  return String(h);
}

function artboardStamp() {
  const boards = scene.artboards || [];
  let s = String(boards.length);
  for (const b of boards) s += `:${b.x},${b.y},${b.w},${b.h}`;
  return s;
}

function settledKey(preview, doomed) {
  const page = activePage();
  const a = appearance;
  return [
    canvas.width, canvas.height, deviceScale(),
    view.panX, view.panY, view.zoom,
    inkSceneRev(),
    idSetStamp(scene.selected),
    idSetStamp(doomed),
    a.background, a.backgroundColor, a.paperTexture ? 1 : 0,
    a.gridVisible ? 1 : 0, a.gridType, a.gridOpacity, a.gridColor || "",
    isEngineering() ? 1 : 0,
    scaleSettings.dimensionMode, scaleSettings.unit, scaleSettings.unitsPerWorldUnit,
    artboardStamp(),
    page ? `${activeDocument.pageIndex}:${page.x},${page.y},${page.width},${page.height}` : "",
    preview ? `${preview.editingId || ""}:${preview.hostId || ""}` : "",
    mathOverlayStamp(),
    activeDocument ? activeDocument.kind : "home",
  ].join("|");
}

function liveStamp(preview) {
  if (!preview || !preview.element) return "";
  const el = preview.element;
  if (el.type === "path") {
    const n = el.points.length;
    const p = n ? el.points[n - 1] : null;
    return `path:${n}:${p ? `${p.x},${p.y},${p.p || 0}` : ""}`;
  }
  if (el.type === "text") return `tx:${el.text}:${el.x},${el.y}:${preview.caret ? 1 : 0}`;
  return [
    el.type, preview.recognized ? 1 : 0,
    el.startX, el.startY, el.endX, el.endY, el.cx, el.cy, el.r,
  ].join(",");
}

function overlayStamp(tool) {
  if (!tool) return "";
  let s = "";
  if (tool.getMarquee) {
    const m = tool.getMarquee(app);
    if (m) s += `m${m.x0},${m.y0},${m.x1},${m.y1};`;
  }
  if (tool.getSlice) {
    const sl = tool.getSlice(app);
    if (sl && sl.points && sl.points.length) {
      const p = sl.points[sl.points.length - 1];
      s += `s${sl.points.length}:${p.x},${p.y};`;
    }
  }
  if (tool.getEraser) {
    const er = tool.getEraser(app);
    if (er) s += `e${er.x},${er.y};`;
  }
  if (tool.getOverlay) {
    const ov = tool.getOverlay(app);
    if (ov && ov.bounds) {
      const b = ov.bounds;
      s += `h${b.minX},${b.minY},${b.maxX},${b.maxY};`;
    }
  }
  return s;
}

function visualStamp() {
  const tool = getTool(activeTool);
  const preview = tool && tool.getPreview ? tool.getPreview(app) : null;
  const doomed = tool && tool.getDoomed ? tool.getDoomed() : null;
  const blink = isEditingText() ? (Math.floor(performance.now() / 530) & 1) : 0;
  // The navigating bit forces one sharp rebuild when the finger lifts. The
  // frames in between only slide the settled bitmap, so the view alone would
  // not change the stamp at the moment the gesture ends.
  const turn = pageTurn ? Math.round((performance.now() - pageTurn.start) / 16) : 0;
  return `${settledKey(preview, doomed)}|${liveStamp(preview)}|${overlayStamp(tool)}|${blink}|${navigating() ? 1 : 0}|${debugOverlayVisible ? 1 : 0}|${activeTool}|${turn}`;
}

function navigating() {
  return interaction.panning || touches.size > 0;
}

// --- Render loop -------------------------------------------------------
function beginFrame() {
  if (frameSaved) ctx.restore();
  ctx.save();
  frameSaved = true;
  resetToScreenSpace(ctx);
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function paintGap() {
  const page = activePage();
  const covered = page && pageCoversView(pageScreenRect(page));
  ctx.fillStyle = page && !covered ? "#17181c" : (getBackgroundBaseColor() || "#1e1e22");
  const dpr = deviceScale();
  ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
}

/** Move the settled bitmap with the camera. One draw, no shader, no ink rebuild. */
function blitPlateMoved() {
  const dpr = deviceScale();
  const z = view.zoom / plateView.zoom;
  ctx.setTransform(
    dpr * z, 0, 0, dpr * z,
    dpr * (view.panX - plateView.panX * z),
    dpr * (view.panY - plateView.panY * z),
  );
  ctx.drawImage(plate, 0, 0, plate.width / dpr, plate.height / dpr);
}

function blitPlate() {
  resetToScreenSpace(ctx);
  const dpr = deviceScale();
  ctx.drawImage(plate, 0, 0, plate.width / dpr, plate.height / dpr);
}

/**
 * Pinch: redraw the paper at zoom 1 (it only shifts with the pan) and scale
 * the grid and ink on top of it.
 */
function blitZoomed(preview) {
  const dpr = deviceScale();
  const page = activePage();
  if (page) {
    const pageRect = pageScreenRect(page);
    if (!pageCoversView(pageRect)) fillPageShadow(ctx, pageRect);
    ctx.save();
    ctx.beginPath();
    ctx.rect(pageRect.x, pageRect.y, pageRect.w, pageRect.h);
    ctx.clip();
    drawBackground(ctx, view, pageRect);
  } else {
    drawBackground(ctx, view, null);
  }

  const z = view.zoom / plateView.zoom;
  ctx.setTransform(
    dpr * z, 0, 0, dpr * z,
    dpr * (view.panX - plateView.panX * z),
    dpr * (view.panY - plateView.panY * z),
  );
  ctx.drawImage(marks, 0, 0, marks.width / dpr, marks.height / dpr);

  applyViewTransform(ctx, view);
  drawTexts(ctx, scene, view, preview, null);
  if (page) ctx.restore();
  paintChrome(ctx, preview);
}

/**
 * Paper, committed ink, and the measurement layer. The in-flight stroke is
 * not here: it changes on every sample and is drawn on top of the blit.
 */
function paintSettled(pctx, preview, doomed) {
  const dpr = deviceScale();
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pctx.globalAlpha = 1;
  pctx.globalCompositeOperation = "source-over";
  pctx.filter = "none";
  pctx.shadowColor = "transparent";
  pctx.shadowBlur = 0;
  pctx.shadowOffsetY = 0;
  pctx.clearRect(0, 0, plate.width / dpr, plate.height / dpr);

  const page = activePage();
  let pageRect = null;
  if (page) {
    pageRect = pageScreenRect(page);
    if (!pageCoversView(pageRect)) {
      pctx.fillStyle = "#17181c";
      pctx.fillRect(0, 0, plate.width / dpr, plate.height / dpr);
      fillPageShadow(pctx, pageRect);
    }
    pctx.save();
    pctx.beginPath();
    pctx.rect(pageRect.x, pageRect.y, pageRect.w, pageRect.h);
    pctx.clip();
  }

  drawBackground(pctx, view, pageRect);

  applyViewTransform(pctx, view);
  drawGrid(pctx, view);
  const engineering = isEngineering();
  if (engineering) drawArtboardsWorld(pctx, view, scene.artboards);
  drawInkLayer(pctx, scene, view, doomed);
  drawTexts(pctx, scene, view, preview, doomed);

  if (page) pctx.restore();
  paintChrome(pctx, preview);
  paintMarks(doomed);
}

function fillPageShadow(pctx, pageRect) {
  pctx.save();
  pctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  pctx.shadowBlur = 24;
  pctx.shadowOffsetY = 8;
  pctx.fillStyle = "#000";
  pctx.fillRect(pageRect.x, pageRect.y, pageRect.w, pageRect.h);
  pctx.restore();
}

/** Page edge, dimensions, and the math layer. Screen space, on top of the sheet. */
function paintChrome(pctx, preview) {
  const page = activePage();
  if (page) {
    const pageRect = pageScreenRect(page);
    if (!pageCoversView(pageRect)) {
      resetToScreenSpace(pctx);
      pctx.strokeStyle = "rgba(30, 26, 20, 0.55)";
      pctx.lineWidth = 1;
      pctx.strokeRect(pageRect.x + 0.5, pageRect.y + 0.5, pageRect.w - 1, pageRect.h - 1);
    }
  }

  resetToScreenSpace(pctx);
  if (isEngineering()) {
    if (scaleSettings.dimensionMode === "cad") {
      drawCadDimensions(pctx, scene, view, preview ? preview.element : null);
    } else if (scaleSettings.dimensionMode === "labels") {
      drawCommittedMeasurements(pctx, scene, view, preview ? preview.element : null);
    }
    drawArtboardLabels(pctx, view, scene.artboards);
    drawScaleBar(pctx, view);
  }
  drawMathLayer(pctx, view);
}

/**
 * Grid and committed ink on their own, in the pixels of `view`. A later
 * pinch scales this bitmap. The paper is not in here, so it does not scale
 * with it. Pencil is painted flat; the resting frame multiplies it into
 * the sheet once the gesture ends.
 */
function paintMarks(doomed) {
  ensureMarks();
  const dpr = deviceScale();
  const pctx = marksCtx;
  pctx.setTransform(1, 0, 0, 1, 0, 0);
  pctx.globalAlpha = 1;
  pctx.globalCompositeOperation = "source-over";
  pctx.filter = "none";
  pctx.clearRect(0, 0, marks.width, marks.height);
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const page = activePage();
  if (page) {
    const pageRect = pageScreenRect(page);
    pctx.save();
    pctx.beginPath();
    pctx.rect(pageRect.x, pageRect.y, pageRect.w, pageRect.h);
    pctx.clip();
  }

  applyViewTransform(pctx, view);
  drawGrid(pctx, view);
  if (isEngineering()) drawArtboardsWorld(pctx, view, scene.artboards);
  pctx.lineCap = "round";
  pctx.lineJoin = "round";
  beginBrushFrame();
  drawCommitted(pctx, scene, view, doomed, { flat: true });
  if (page) pctx.restore();
}

function drawLive(preview, tool) {
  const page = activePage();
  if (page) {
    const pageRect = pageScreenRect(page);
    ctx.save();
    ctx.beginPath();
    ctx.rect(pageRect.x, pageRect.y, pageRect.w, pageRect.h);
    ctx.clip();
  }
  applyViewTransform(ctx, view);
  drawShapeGuides(ctx, view, preview);
  drawLivePreview(ctx, view, preview);
  if (page) ctx.restore();

  resetToScreenSpace(ctx);
  if (isEngineering()) {
    if (scaleSettings.dimensionMode === "cad") drawLiveCadDimension(ctx, preview, view);
    else if (scaleSettings.dimensionMode === "labels") drawMeasurementLabel(ctx, preview, view);
  }
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
}

function blitShifted(source, dx) {
  resetToScreenSpace(ctx);
  const dpr = deviceScale();
  ctx.drawImage(source, dx, 0, source.width / dpr, source.height / dpr);
}

function renderPageTurn(raw) {
  const tool = getTool(activeTool);
  const preview = tool && tool.getPreview ? tool.getPreview(app) : null;
  const doomed = tool && tool.getDoomed ? tool.getDoomed() : null;
  const key = settledKey(preview, doomed);
  const sizeChanged = !plate || plate.width !== canvas.width || plate.height !== canvas.height;
  if (sizeChanged) ensurePlate();
  if (sizeChanged || key !== plateKey) {
    paintSettled(plateCtx, preview, doomed);
    plateKey = key;
    plateView = { panX: view.panX, panY: view.panY, zoom: view.zoom };
  }
  const t = 1 - (1 - raw) * (1 - raw);
  const travel = pageTurn.dir * window.innerWidth;
  beginFrame();
  paintGap();
  blitShifted(plate, travel * (t - 1));
  blitShifted(pageTurn.from, travel * t);
  resetToScreenSpace(ctx);
  styleWheelFrame(app);
}

function render() {
  if (pageTurn) {
    const raw = (performance.now() - pageTurn.start) / PAGE_TURN_MS;
    if (raw >= 1) pageTurn = null;
    else {
      renderPageTurn(raw);
      return;
    }
  }
  const tool = getTool(activeTool);
  const preview = tool && tool.getPreview ? tool.getPreview(app) : null;
  if (navigating() && plate && plateView && marks) {
    beginFrame();
    paintGap();
    if (view.zoom !== plateView.zoom) blitZoomed(preview);
    else blitPlateMoved();
    resetToScreenSpace(ctx);
    drawLive(preview, tool);
    if (debugOverlayVisible) drawDebugOverlay();
    styleWheelFrame(app);
    return;
  }

  const doomed = tool && tool.getDoomed ? tool.getDoomed() : null;
  const key = settledKey(preview, doomed);
  const sizeChanged = !plate || plate.width !== canvas.width || plate.height !== canvas.height;
  if (sizeChanged) ensurePlate();
  if (sizeChanged || key !== plateKey) {
    paintSettled(plateCtx, preview, doomed);
    plateKey = key;
    plateView = { panX: view.panX, panY: view.panY, zoom: view.zoom };
  }

  beginFrame();
  blitPlate();
  drawLive(preview, tool);
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
  ctx.font = "13px \"Special Elite\", \"Courier Prime\", \"Courier New\", Courier, monospace";
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

let lastStamp = "";

function frameLoop() {
  const stamp = visualStamp();
  if (stamp !== lastStamp) {
    lastStamp = stamp;
    render();
  }
  requestAnimationFrame(frameLoop);
}

// --- Boot --------------------------------------------------------------
resizeCanvas();
syncPanelFromSettings();
initStyleWheel(app);
setActiveTool("line");
wireHome();
// The brush gallery is a dev bootstrap. It needs a canvas, so it skips home.
if (new URLSearchParams(location.search).has("brushtest")) enterDocument("infinite");
installBrushTestbed(app);
requestAnimationFrame(frameLoop);

