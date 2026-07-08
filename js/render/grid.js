// render/grid.js
// Infinite grid underlayment with viewport culling. Toggleable and typed
// (graph / dot / lined / isometric) via workspace appearance settings.
// Grid color auto-contrasts with the background unless overridden.
// Graph grid: major 100u, minor 10u; minor detail hidden when zoomed out.

import { getVisibleWorldBounds } from "../core/view.js";
import { appearance, isDarkBackground, hexToRgb } from "../workspace/appearance.js";

const GRID_MAJOR = 100;
const GRID_MINOR = 10;
const MINOR_GRID_ZOOM_THRESHOLD = 0.4;
const GRID_MAJOR_WIDTH = 1.5;
const GRID_MINOR_WIDTH = 1.0;
const ISO_ANGLE = Math.PI / 6; // 30 degrees

function gridRgb() {
  if (appearance.gridColor) {
    const { r, g, b } = hexToRgb(appearance.gridColor);
    return `${r}, ${g}, ${b}`;
  }
  return isDarkBackground() ? "200, 200, 210" : "70, 80, 100";
}

export function drawGrid(ctx, view) {
  if (!appearance.gridVisible) return;
  const rgb = gridRgb();
  const majorAlpha = Math.max(0, Math.min(1, appearance.gridOpacity));
  const minorAlpha = majorAlpha * 0.27;
  const major = `rgba(${rgb}, ${majorAlpha})`;
  const minor = `rgba(${rgb}, ${minorAlpha})`;
  const bounds = getVisibleWorldBounds();

  switch (appearance.gridType) {
    case "dot":
      drawDotGrid(ctx, view, bounds, major, minor);
      break;
    case "lined":
      drawLinedGrid(ctx, view, bounds, major, minor);
      break;
    case "isometric":
      drawIsoGrid(ctx, view, bounds, minor);
      break;
    default:
      drawGraphGrid(ctx, view, bounds, major, minor);
  }
}

// --- Graph (10/100 engineering grid) -----------------------------------
function drawGraphGrid(ctx, view, bounds, major, minor) {
  if (view.zoom >= MINOR_GRID_ZOOM_THRESHOLD) {
    ctx.strokeStyle = minor;
    ctx.lineWidth = GRID_MINOR_WIDTH / view.zoom;
    strokeLineFamily(ctx, bounds, GRID_MINOR, (v) => v % GRID_MAJOR !== 0);
  }
  ctx.strokeStyle = major;
  ctx.lineWidth = GRID_MAJOR_WIDTH / view.zoom;
  strokeLineFamily(ctx, bounds, GRID_MAJOR, () => true);
}

/** Stroke vertical + horizontal lines at `step` spacing, filtered. */
function strokeLineFamily(ctx, bounds, step, keep) {
  const startX = Math.floor(bounds.left / step) * step;
  const endX = Math.ceil(bounds.right / step) * step;
  const startY = Math.floor(bounds.top / step) * step;
  const endY = Math.ceil(bounds.bottom / step) * step;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += step) {
    if (!keep(x)) continue;
    ctx.moveTo(x, bounds.top);
    ctx.lineTo(x, bounds.bottom);
  }
  for (let y = startY; y <= endY; y += step) {
    if (!keep(y)) continue;
    ctx.moveTo(bounds.left, y);
    ctx.lineTo(bounds.right, y);
  }
  ctx.stroke();
}

// --- Dot grid -----------------------------------------------------------
// Dots are rendered as round line-dash caps on horizontal strokes: one
// path instead of tens of thousands of arc() calls per frame.
function drawDotGrid(ctx, view, bounds, major, minor) {
  if (view.zoom >= MINOR_GRID_ZOOM_THRESHOLD) {
    strokeDotRows(ctx, view, bounds, GRID_MINOR, 2.2, minor);
  }
  strokeDotRows(ctx, view, bounds, GRID_MAJOR, 3.5, major);
}

function strokeDotRows(ctx, view, bounds, step, diameterPx, color) {
  const startX = Math.floor(bounds.left / step) * step;
  const startY = Math.floor(bounds.top / step) * step;
  const endY = Math.ceil(bounds.bottom / step) * step;
  ctx.strokeStyle = color;
  ctx.lineWidth = diameterPx / view.zoom;
  ctx.lineCap = "round";
  // Near-zero dash draws a dot at every `step` along the row.
  ctx.setLineDash([0.001, step]);
  ctx.beginPath();
  for (let y = startY; y <= endY; y += step) {
    ctx.moveTo(startX, y);
    ctx.lineTo(bounds.right, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = "butt";
}

// --- Lined (ruled paper) -------------------------------------------------
function drawLinedGrid(ctx, view, bounds, major, minor) {
  if (view.zoom >= MINOR_GRID_ZOOM_THRESHOLD) {
    ctx.strokeStyle = minor;
    ctx.lineWidth = GRID_MINOR_WIDTH / view.zoom;
    strokeHorizontals(ctx, bounds, GRID_MINOR, (y) => y % GRID_MAJOR !== 0);
  }
  ctx.strokeStyle = major;
  ctx.lineWidth = GRID_MAJOR_WIDTH / view.zoom;
  strokeHorizontals(ctx, bounds, GRID_MAJOR, () => true);
}

function strokeHorizontals(ctx, bounds, step, keep) {
  const startY = Math.floor(bounds.top / step) * step;
  const endY = Math.ceil(bounds.bottom / step) * step;
  ctx.beginPath();
  for (let y = startY; y <= endY; y += step) {
    if (!keep(y)) continue;
    ctx.moveTo(bounds.left, y);
    ctx.lineTo(bounds.right, y);
  }
  ctx.stroke();
}

// --- Isometric -----------------------------------------------------------
// Verticals plus two families of 30-degree lines. Perpendicular spacing
// matches the graph grid's minor step (major step when zoomed out).
function drawIsoGrid(ctx, view, bounds, color) {
  const step = view.zoom >= MINOR_GRID_ZOOM_THRESHOLD ? GRID_MINOR : GRID_MAJOR;
  ctx.strokeStyle = color;
  ctx.lineWidth = GRID_MINOR_WIDTH / view.zoom;

  ctx.beginPath();
  const startX = Math.floor(bounds.left / step) * step;
  const endX = Math.ceil(bounds.right / step) * step;
  for (let x = startX; x <= endX; x += step) {
    ctx.moveTo(x, bounds.top);
    ctx.lineTo(x, bounds.bottom);
  }
  strokeSlanted(ctx, bounds, step, Math.tan(ISO_ANGLE));
  strokeSlanted(ctx, bounds, step, -Math.tan(ISO_ANGLE));
  ctx.stroke();
}

/** Add lines y = m*x + c for intercepts covering the visible bounds. */
function strokeSlanted(ctx, bounds, step, m) {
  // Intercept spacing that yields `step` perpendicular spacing.
  const d = step / Math.cos(ISO_ANGLE);
  const cMin = Math.min(bounds.top - m * bounds.left, bounds.top - m * bounds.right);
  const cMax = Math.max(bounds.bottom - m * bounds.left, bounds.bottom - m * bounds.right);
  const start = Math.floor(cMin / d) * d;
  for (let c = start; c <= cMax; c += d) {
    ctx.moveTo(bounds.left, m * bounds.left + c);
    ctx.lineTo(bounds.right, m * bounds.right + c);
  }
}

export { GRID_MAJOR, GRID_MINOR };
