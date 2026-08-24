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
import { appearance, BACKGROUNDS } from "./workspace/appearance.js";
import { initStyleWheel, styleWheelFrame } from "./ui/style-wheel.js";
import { drawScene } from "./render/elements.js";
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
import { exportSvg, downloadText } from "./io/export-svg.js";
import { serializeProject, deserializeProject, pickFile, readFileText } from "./io/project.js";
import { openMeasureDialog, closeMeasureDialog, isOpen as measureDialogOpen } from "./ui/measure-dialog.js";
import { isEyedropperActive } from "./ui/color-picker.js";
import { setBrush } from "./brush/active-brush.js";

// --- Register tools ----------------------------------------------------
registerTool("select", selectTool);
registerTool("line", lineTool);
registerTool("rect", rectTool);
registerTool("circle", circleTool);
registerTool("pen", penTool);
registerTool("nudge", nudgeTool);
registerTool("slice", sliceTool);

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

let activeTool = "line";

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
  setBrush({ toolType: name });
  if (tool.onActivate) tool.onActivate(app);
  for (const btn of document.querySelectorAll("#toolbar button")) {
    btn.classList.toggle("active", btn.dataset.tool === name);
  }
}

// --- Toolbar (legacy; tool selection now lives in the hub) --------------
const toolbar = document.getElementById("toolbar");
if (toolbar) {
  toolbar.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-tool]");
    if (btn) setActiveTool(btn.dataset.tool);
  });
  toolbar.addEventListener("mousedown", (event) => event.stopPropagation());
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
  const data = serializeProject(scene);
  downloadText("drawing.vda", JSON.stringify(data, null, 2), "application/json");
});

document.getElementById("loadProject").addEventListener("click", async () => {
  try {
    const file = await pickFile(".vda,application/json");
    const text = await readFileText(file);
    deserializeProject(JSON.parse(text), scene);
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
document.getElementById("panelToggle").addEventListener("click", () => {
  panel.classList.toggle("collapsed");
});
const bgSwatches = document.getElementById("bgSwatches");
const bgCustomColor = document.getElementById("bgCustomColor");
const gridToggle = document.getElementById("gridToggle");
const gridTypeSel = document.getElementById("gridType");

for (const [key, preset] of Object.entries(BACKGROUNDS)) {
  const btn = document.createElement("button");
  btn.dataset.bg = key;
  btn.title = preset.label;
  if (key === "transparent") btn.classList.add("swatch-transparent");
  else if (key === "custom") btn.classList.add("swatch-custom");
  else btn.style.background = preset.color;
  btn.addEventListener("click", () => {
    if (key === "custom") {
      bgCustomColor.click();
      return;
    }
    appearance.background = key;
    syncWorkspacePanel();
  });
  bgSwatches.appendChild(btn);
}

bgCustomColor.addEventListener("input", () => {
  appearance.background = "custom";
  appearance.backgroundColor = bgCustomColor.value;
  syncWorkspacePanel();
});

gridToggle.addEventListener("click", () => {
  appearance.gridVisible = !appearance.gridVisible;
  syncWorkspacePanel();
});

gridTypeSel.addEventListener("change", () => {
  appearance.gridType = gridTypeSel.value;
});

function syncWorkspacePanel() {
  for (const btn of bgSwatches.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.bg === appearance.background);
  }
  bgCustomColor.value = appearance.backgroundColor;
  gridToggle.setAttribute("aria-pressed", String(appearance.gridVisible));
  gridTypeSel.value = appearance.gridType;
}

// --- Input routing -----------------------------------------------------
function isPanGesture(event) {
  if (event.button === 1) return true;
  if (event.button === 0 && interaction.spaceDown) return true;
  return false;
}

canvas.addEventListener("mousedown", (event) => {
  // Pan is global (works regardless of active tool).
  if (isPanGesture(event)) {
    event.preventDefault();
    interaction.panning = true;
    interaction.lastX = event.clientX;
    interaction.lastY = event.clientY;
    canvas.classList.add("panning");
    return;
  }
  // While the color eyedropper is sampling, don't start a stroke.
  if (isEyedropperActive()) return;
  const tool = getTool(activeTool);
  if (tool && tool.onPointerDown) tool.onPointerDown(app, event);
});

window.addEventListener("mousemove", (event) => {
  if (interaction.panning) {
    panBy(event.clientX - interaction.lastX, event.clientY - interaction.lastY);
    interaction.lastX = event.clientX;
    interaction.lastY = event.clientY;
    return;
  }
  if (isEyedropperActive()) return;
  const tool = getTool(activeTool);
  if (tool && tool.onPointerMove) tool.onPointerMove(app, event);
});

window.addEventListener("mouseup", (event) => {
  if (interaction.panning) {
    interaction.panning = false;
    canvas.classList.remove("panning");
    return;
  }
  const tool = getTool(activeTool);
  if (tool && tool.onPointerUp) tool.onPointerUp(app, event);
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

// Double-click any measurable shape to type an exact dimension.
const PICK_TOLERANCE_PX = 8;
canvas.addEventListener("dblclick", (event) => {
  if (interaction.spaceDown || interaction.panning) return;
  event.preventDefault();
  const world = screenToWorld(event.clientX, event.clientY);
  const tol = PICK_TOLERANCE_PX / view.zoom;
  const hit = scene.pick(world.x, world.y, tol);
  if (!hit) return;
  openMeasureDialog(app, hit, event.clientX, event.clientY);
});

// --- Keyboard ----------------------------------------------------------
const TOOL_KEYS = {
  KeyV: "select", KeyL: "line", KeyR: "rect", KeyC: "circle",
  KeyP: "pen", KeyN: "nudge", KeyS: "slice",
};

window.addEventListener("keydown", (event) => {
  if (measureDialogOpen() && event.code === "Escape") {
    closeMeasureDialog();
    event.preventDefault();
    return;
  }

  if (event.code === "Space" || event.key === " ") {
    if (!interaction.spaceDown) {
      interaction.spaceDown = true;
      canvas.classList.add("pannable");
    }
    event.preventDefault();
    return;
  }

  // Undo / redo (global).
  if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
    if (event.shiftKey) history.redo(scene);
    else history.undo(scene);
    event.preventDefault();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.code === "KeyY") {
    history.redo(scene);
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
    event.preventDefault();
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
  drawBackground(ctx);

  // World-space scene.
  applyViewTransform(ctx, view);
  drawGrid(ctx, view);
  drawArtboardsWorld(ctx, view, scene.artboards);
  const tool = getTool(activeTool);
  const preview = tool && tool.getPreview ? tool.getPreview(app) : null;
  drawShapeGuides(ctx, view, preview);
  drawScene(ctx, scene, view, preview);

  // Screen-space overlays.
  resetToScreenSpace(ctx);
  if (scaleSettings.dimensionMode === "cad") {
    drawCadDimensions(ctx, scene, view, preview ? preview.element : null);
    drawLiveCadDimension(ctx, preview, view);
  } else if (scaleSettings.dimensionMode === "labels") {
    drawCommittedMeasurements(ctx, scene, view, preview ? preview.element : null);
    drawMeasurementLabel(ctx, preview, view);
  }
  drawArtboardLabels(ctx, view, scene.artboards);

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

  drawScaleBar(ctx, view);
  drawDebugOverlay();
  styleWheelFrame(app);
}

function drawSliceBlade(ctx, sl) {
  const a = worldToScreen(sl.a.x, sl.a.y);
  const b = worldToScreen(sl.b.x, sl.b.y);
  ctx.strokeStyle = "rgba(255, 90, 90, 0.95)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawDebugOverlay() {
  const padding = 12;
  const lineH = 18;
  const lines = [
    `panX:  ${view.panX.toFixed(1)}`,
    `panY:  ${view.panY.toFixed(1)}`,
    `zoom:  ${view.zoom.toFixed(3)}`,
    `tool:  ${activeTool}`,
    `elems: ${scene.elements.length}`,
    `sel:   ${scene.selected.size}`,
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
requestAnimationFrame(frameLoop);

