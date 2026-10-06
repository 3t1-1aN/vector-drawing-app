// ui/workspace-panel.js
// The canvas section of the settings panel: which sheet you are drawing on
// and how the ruling sits on it.
//
// Every choice here is shown as a picture of its own result rather than as a
// word or a colour chip. The three paper presets differ by a few percent of
// warmth and are impossible to tell apart as 26px dots, and "Isometric" only
// means something once you have seen it; a swatch that renders the actual
// paper tile with the actual lattice over it answers both without a label
// doing the work. The previews go through the same two renderers the canvas
// uses, so a swatch cannot drift out of step with what it promises.

import { appearance, BACKGROUNDS, GRID_TYPES } from "../workspace/appearance.js";
import { workspace, setWorkspaceMode } from "../workspace/mode.js";
import { paperTileFor } from "../render/background.js";
import { bakePaper, paperParamsFor } from "../render/paper-surface.js";
import { mathAssist } from "../math/settings.js";

// Preview tiles stretch to their column, so only the shape is fixed here;
// the pixel sizes come from layout at paint time.
const SWATCH_ASPECT = 1;
const PATTERN_ASPECT = 3 / 2;
const PREVIEW_STEP = 10; // css px between preview lattice lines

const GRID_LABELS = {
  graph: "Graph",
  dot: "Dot",
  lined: "Ruled",
  isometric: "Isometric",
};

const paperTileCache = new Map();

function cachedPaperTile(background, color) {
  const id = background === "custom" ? `custom:${color}` : background;
  let tile = paperTileCache.get(id);
  if (!tile) {
    tile = paperTileFor(background, color);
    paperTileCache.set(id, tile);
  }
  return tile;
}

/**
 * Match the backing store to the laid-out size. CSS gives the tile its width
 * and aspect, so this has to run after layout -- reading clientWidth flushes
 * it, which is why the previews are painted from sync() rather than while
 * the buttons are still being appended.
 */
function sizeToLayout(canvas, aspect) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 48;
  const cssH = canvas.clientHeight || cssW / aspect;
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return dpr;
}

/**
 * Lay down a sheet across the whole canvas, grained or flat to match what
 * the real background is currently doing. The transparent preset has no
 * colour to fall back to, so it always uses its tile.
 */
function fillSheet(ctx, canvas, background, color) {
  if (background === "transparent") {
    ctx.fillStyle = ctx.createPattern(cachedPaperTile(background, color), "repeat");
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  if (!appearance.paperTexture) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const preset = BACKGROUNDS[background] || BACKGROUNDS.custom;
  const dpr = window.devicePixelRatio || 1;
  const painted = bakePaper(canvas, {
    params: paperParamsFor(color, preset.grain),
    dpr,
    zoom: 1,
  });
  if (!painted) {
    ctx.fillStyle = ctx.createPattern(cachedPaperTile(background, color), "repeat");
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

/** Paint a paper preset into a swatch canvas. */
function paintPaper(canvas, background, color) {
  const dpr = sizeToLayout(canvas, SWATCH_ASPECT);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  fillSheet(ctx, canvas, background, color);
  // A hairline of the paper's own shadow so the swatch reads as a sheet
  // sitting in the panel rather than as a flat fill of its colour.
  ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
  ctx.lineWidth = dpr;
  ctx.strokeRect(dpr / 2, dpr / 2, canvas.width - dpr, canvas.height - dpr);
}

/**
 * Paint a grid type over the current paper, at 1:1 zoom so the preview shows
 * the ruling at the size it will actually be drawn.
 */
function paintPattern(canvas, type) {
  const dpr = sizeToLayout(canvas, PATTERN_ASPECT);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  fillSheet(ctx, canvas, appearance.background, appearance.backgroundColor);
  drawPreviewLattice(ctx, canvas, type, dpr);

  ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
  ctx.lineWidth = dpr;
  ctx.strokeRect(dpr / 2, dpr / 2, canvas.width - dpr, canvas.height - dpr);
}

/**
 * A miniature of each lattice. This deliberately does not call drawGrid():
 * that one reads the live view and viewport, and a 58x38 swatch wants the
 * pattern centred and legible rather than a truthful crop of the canvas.
 */
function drawPreviewLattice(ctx, canvas, type, dpr) {
  const w = canvas.width;
  const h = canvas.height;
  const rgb = appearance.gridColor
    ? hexTriplet(appearance.gridColor)
    : (isDarkPreview() ? "205, 208, 216" : "70, 80, 100");
  const a = Math.max(0.12, Math.min(1, appearance.gridOpacity));
  const step = Math.round(PREVIEW_STEP * dpr);
  const line = Math.max(1, Math.round(dpr));
  const snap = (v) => Math.round(v - (line % 2 === 1 ? 0.5 : 0)) + (line % 2 === 1 ? 0.5 : 0);

  ctx.lineWidth = line;

  if (type === "dot") {
    ctx.fillStyle = `rgba(${rgb}, ${a})`;
    const d = Math.max(1, Math.round(1.6 * dpr));
    for (let y = step; y < h; y += step) {
      for (let x = step; x < w; x += step) {
        ctx.fillRect(Math.round(x - d / 2), Math.round(y - d / 2), d, d);
      }
    }
    return;
  }

  if (type === "isometric") {
    ctx.strokeStyle = `rgba(${rgb}, ${a * 0.75})`;
    ctx.beginPath();
    for (let x = step; x < w; x += step) {
      ctx.moveTo(snap(x), 0);
      ctx.lineTo(snap(x), h);
    }
    const m = Math.tan(Math.PI / 6);
    const d = step / Math.cos(Math.PI / 6);
    for (const slope of [m, -m]) {
      for (let c = -Math.abs(slope) * w - h; c < h + Math.abs(slope) * w; c += d) {
        ctx.moveTo(0, c);
        ctx.lineTo(w, slope * w + c);
      }
    }
    ctx.stroke();
    return;
  }

  // graph and lined share the horizontals; graph adds the verticals.
  ctx.strokeStyle = `rgba(${rgb}, ${a * 0.85})`;
  ctx.beginPath();
  for (let y = step; y < h; y += step) {
    ctx.moveTo(0, snap(y));
    ctx.lineTo(w, snap(y));
  }
  if (type !== "lined") {
    for (let x = step; x < w; x += step) {
      ctx.moveTo(snap(x), 0);
      ctx.lineTo(snap(x), h);
    }
  }
  ctx.stroke();
}

function hexTriplet(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

function isDarkPreview() {
  const key = appearance.background;
  if (key === "transparent") return true;
  const hex = key === "custom"
    ? appearance.backgroundColor
    : (BACKGROUNDS[key] && BACKGROUNDS[key].color);
  if (!hex) return true;
  const [r, g, b] = hexTriplet(hex).split(", ").map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

// role="switch" reads aria-checked. aria-pressed stays so the existing
// switch CSS, which keys off it, does not need a second rule.
function setSwitch(btn, on) {
  const value = String(!!on);
  btn.setAttribute("aria-checked", value);
  btn.setAttribute("aria-pressed", value);
}

/**
 * Wire the canvas controls. `onChange` is called after any mutation so the
 * host can persist or re-render; the panel repaints its own previews.
 */
export function initWorkspacePanel({ onChange = () => {} } = {}) {
  const modeSwitch = document.getElementById("modeSwitch");
  const engineerOnly = document.getElementById("engineerOnly");
  const paperRow = document.getElementById("bgSwatches");
  const patternRow = document.getElementById("gridPatterns");
  const customColor = document.getElementById("bgCustomColor");
  const textureToggle = document.getElementById("textureToggle");
  const mathToggle = document.getElementById("mathToggle");
  const gridToggle = document.getElementById("gridToggle");
  const gridOpacity = document.getElementById("gridOpacity");
  const gridColor = document.getElementById("gridColor");
  const gridColorAuto = document.getElementById("gridColorAuto");
  const gridFields = document.getElementById("gridFields");

  const paperCanvases = new Map();
  const patternCanvases = new Map();

  // --- Workspace mode ----------------------------------------------------
  for (const btn of modeSwitch.querySelectorAll("button")) {
    btn.addEventListener("click", () => {
      setWorkspaceMode(btn.dataset.mode);
      sync();
      onChange();
    });
  }

  // --- Paper -----------------------------------------------------------
  for (const [key, preset] of Object.entries(BACKGROUNDS)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch";
    btn.dataset.bg = key;
    btn.title = preset.label;
    btn.setAttribute("aria-pressed", "false");

    const canvas = document.createElement("canvas");
    btn.appendChild(canvas);
    const label = document.createElement("span");
    label.className = "swatch-label";
    label.textContent = preset.label;
    btn.appendChild(label);

    // No paper to render for clear; the checker comes from the button's CSS.
    if (key === "transparent") btn.classList.add("swatch-transparent");
    else paperCanvases.set(key, canvas);
    if (key === "custom") btn.classList.add("swatch-custom");

    btn.addEventListener("click", () => {
      if (key === "custom") {
        customColor.click();
        return;
      }
      appearance.background = key;
      sync();
      onChange();
    });
    paperRow.appendChild(btn);
  }

  customColor.addEventListener("input", () => {
    appearance.background = "custom";
    appearance.backgroundColor = customColor.value;
    paperTileCache.delete(`custom:${customColor.value}`);
    sync();
    onChange();
  });

  textureToggle.addEventListener("click", () => {
    appearance.paperTexture = !appearance.paperTexture;
    sync();
    onChange();
  });

  if (mathToggle) {
    mathToggle.addEventListener("click", () => {
      mathAssist.enabled = !mathAssist.enabled;
      sync();
      onChange({ mathAssist: mathAssist.enabled });
    });
  }

  // --- Grid pattern ------------------------------------------------------
  for (const type of GRID_TYPES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pattern";
    btn.dataset.grid = type;
    btn.title = GRID_LABELS[type];
    btn.setAttribute("aria-pressed", "false");

    const canvas = document.createElement("canvas");
    btn.appendChild(canvas);
    const label = document.createElement("span");
    label.className = "pattern-label";
    label.textContent = GRID_LABELS[type];
    btn.appendChild(label);
    patternCanvases.set(type, canvas);

    btn.addEventListener("click", () => {
      appearance.gridType = type;
      // Choosing a pattern while the grid is off is a request to see it.
      appearance.gridVisible = true;
      sync();
      onChange();
    });
    patternRow.appendChild(btn);
  }

  // --- Grid switches ------------------------------------------------------
  gridToggle.addEventListener("click", () => {
    appearance.gridVisible = !appearance.gridVisible;
    sync();
    onChange();
  });

  gridOpacity.addEventListener("input", () => {
    appearance.gridOpacity = Number(gridOpacity.value) / 100;
    repaintPatterns();
    onChange();
  });

  gridColor.addEventListener("input", () => {
    appearance.gridColor = gridColor.value;
    sync();
    onChange();
  });

  gridColorAuto.addEventListener("click", () => {
    appearance.gridColor = null;
    sync();
    onChange();
  });

  function repaintPatterns() {
    for (const [type, canvas] of patternCanvases) paintPattern(canvas, type);
  }

  function repaintPapers() {
    for (const [key, canvas] of paperCanvases) {
      const color = key === "custom"
        ? appearance.backgroundColor
        : BACKGROUNDS[key].color;
      paintPaper(canvas, key, color);
    }
  }

  function sync() {
    // The measurement sections are removed from the panel rather than
    // dimmed: unlike the grid fields, which describe a grid that is still
    // on screen, these describe a layer Draw does not have at all, and
    // leaving them greyed out would advertise clutter instead of hiding it.
    const engineering = workspace.mode === "engineer";
    engineerOnly.hidden = !engineering;
    for (const el of document.querySelectorAll(".engineer-only-hint")) {
      el.hidden = !engineering;
    }
    for (const btn of modeSwitch.querySelectorAll("button")) {
      const on = btn.dataset.mode === workspace.mode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", String(on));
    }

    for (const btn of paperRow.querySelectorAll("button")) {
      const on = btn.dataset.bg === appearance.background;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    }
    repaintPapers();
    customColor.value = appearance.backgroundColor;
    setSwitch(textureToggle, appearance.paperTexture);
    if (mathToggle) setSwitch(mathToggle, mathAssist.enabled);

    for (const btn of patternRow.querySelectorAll("button")) {
      const on = btn.dataset.grid === appearance.gridType;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    }

    setSwitch(gridToggle, appearance.gridVisible);
    // The pattern and its adjustments are meaningless with the grid off, so
    // they dim and go inert rather than vanishing — the row is the clearest
    // statement of what the switch controls.
    patternRow.classList.toggle("disabled", !appearance.gridVisible);
    gridFields.classList.toggle("disabled", !appearance.gridVisible);

    gridOpacity.value = String(Math.round(appearance.gridOpacity * 100));
    gridColor.value = appearance.gridColor || (isDarkPreview() ? "#c8c8d2" : "#465064");
    gridColorAuto.classList.toggle("active", !appearance.gridColor);

    repaintPatterns();
  }

  sync();
  return { sync };
}
