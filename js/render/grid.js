// render/grid.js
// Infinite grid underlayment with viewport culling. Toggleable and typed
// (graph / dot / lined / isometric) via workspace appearance settings.
// Grid color auto-contrasts with the background unless overridden.
// Graph grid: major 100u, minor 10u; minor detail fades out when dense.
//
// Everything here is drawn in DEVICE pixels rather than world units, even
// though the caller has the world transform applied. A grid is the one layer
// where geometric truth matters less than looking machined: a 1px line under
// a fractional world transform lands across two device pixels and comes back
// as a soft 2px smear, and neighbouring lines smear by different amounts, so
// a regular lattice renders as an irregular one. Snapping each line to the
// pixel it mostly covers is what makes the sheet read as ruled rather than
// printed slightly out of focus.

import { getVisibleWorldBounds } from "../core/view.js";
import { appearance, isDarkBackground, hexToRgb } from "../workspace/appearance.js";

const GRID_MAJOR = 100;
const GRID_MINOR = 10;
// Minor spacing, in CSS px, across which the fine lattice fades in. Below the
// floor the lines are closer together than they are wide and read as a wash.
const MINOR_FADE_MIN = 4.5;
const MINOR_FADE_MAX = 11;
const ISO_ANGLE = Math.PI / 6; // 30 degrees

// Steps the dot and isometric lattices are allowed to sit on, and the
// closest together they may get on screen before stepping up. Graph and
// ruled paper keep the fixed 10/100 structure because that hierarchy is
// the point of them; dots and isometric have no such contract and only
// need to stay comfortable to draw against. Every step is a multiple of
// GRID_MINOR, so whichever one is showing still lines up with snapping.
const LATTICE_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
const DOT_SPACING = 18; // css px
const ISO_SPACING = 26; // three crossing families need more room than two

function comfortableStep(zoom, minSpacing) {
  for (const step of LATTICE_STEPS) {
    if (step * zoom >= minSpacing) return step;
  }
  return LATTICE_STEPS[LATTICE_STEPS.length - 1];
}

const dotTileCache = new Map();
const DOT_CACHE_LIMIT = 48;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function gridRgb() {
  if (appearance.gridColor) {
    const { r, g, b } = hexToRgb(appearance.gridColor);
    return `${r}, ${g}, ${b}`;
  }
  return isDarkBackground() ? "200, 200, 210" : "70, 80, 100";
}

/**
 * Snap a device-pixel coordinate so a line of `width` device px covers whole
 * pixels: odd widths straddle a pixel centre, even widths sit on the seam.
 */
function snap(v, width) {
  const half = width % 2 === 1 ? 0.5 : 0;
  return Math.round(v - half) + half;
}

/** How present the fine lattice should be at this zoom, 0..1. */
function minorFade(zoom) {
  const spacing = GRID_MINOR * zoom;
  return smoothstep(clamp01(
    (spacing - MINOR_FADE_MIN) / (MINOR_FADE_MAX - MINOR_FADE_MIN),
  ));
}

export function drawGrid(ctx, view) {
  if (!appearance.gridVisible) return;

  const dpr = window.devicePixelRatio || 1;
  const rgb = gridRgb();
  const alpha = clamp01(appearance.gridOpacity);
  const bounds = getVisibleWorldBounds();
  const fade = minorFade(view.zoom);

  // Line weights are whole device pixels, so major and minor separate by
  // tone rather than by fractional width. On a 1x display both are one pixel
  // and the hierarchy is carried entirely by alpha, which is the only thing
  // that survives at that size anyway.
  const majorW = Math.max(1, Math.round(1.25 * dpr));
  const minorW = Math.max(1, Math.round(dpr));
  const major = `rgba(${rgb}, ${alpha})`;
  const minor = `rgba(${rgb}, ${alpha * 0.3 * fade})`;

  const ctxState = { dpr, view, bounds, majorW, minorW, major, minor, fade, rgb, alpha };

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  switch (appearance.gridType) {
    case "dot":
      drawDotGrid(ctx, ctxState);
      break;
    case "lined":
      drawLinedGrid(ctx, ctxState);
      break;
    case "isometric":
      drawIsoGrid(ctx, ctxState);
      break;
    default:
      drawGraphGrid(ctx, ctxState);
  }
  ctx.restore();
}

/** World x -> device px. */
function deviceX(world, view, dpr) {
  return (world * view.zoom + view.panX) * dpr;
}

function deviceY(world, view, dpr) {
  return (world * view.zoom + view.panY) * dpr;
}

// --- Graph (10/100 engineering grid) -----------------------------------
function drawGraphGrid(ctx, s) {
  if (s.fade > 0.01) {
    strokeLattice(ctx, s, GRID_MINOR, s.minorW, s.minor, true, true,
                  (v) => v % GRID_MAJOR !== 0);
  }
  strokeLattice(ctx, s, GRID_MAJOR, s.majorW, s.major, true, true);
}

// --- Lined (ruled paper) -------------------------------------------------
function drawLinedGrid(ctx, s) {
  if (s.fade > 0.01) {
    strokeLattice(ctx, s, GRID_MINOR, s.minorW, s.minor, false, true,
                  (v) => v % GRID_MAJOR !== 0);
  }
  strokeLattice(ctx, s, GRID_MAJOR, s.majorW, s.major, false, true);
}

/**
 * Stroke a family of snapped lines at `step` world spacing.
 * `verticals` / `horizontals` select the axes; `keep` filters positions.
 */
function strokeLattice(ctx, s, step, width, color, verticals, horizontals, keep) {
  const { dpr, view, bounds } = s;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();

  if (verticals) {
    const start = Math.floor(bounds.left / step) * step;
    const end = Math.ceil(bounds.right / step) * step;
    for (let x = start; x <= end; x += step) {
      if (keep && !keep(x)) continue;
      const px = snap(deviceX(x, view, dpr), width);
      if (px < -width || px > w + width) continue;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
  }
  if (horizontals) {
    const start = Math.floor(bounds.top / step) * step;
    const end = Math.ceil(bounds.bottom / step) * step;
    for (let y = start; y <= end; y += step) {
      if (keep && !keep(y)) continue;
      const py = snap(deviceY(y, view, dpr), width);
      if (py < -width || py > h + width) continue;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
  }
  ctx.stroke();
}

// --- Dot grid -----------------------------------------------------------
// One dot is drawn into a tile whose size is the lattice spacing rounded to
// a whole pixel, then the tile is repeated across the viewport. The pattern
// transform scales by spacing/tileSize -- always within a few percent of 1,
// so the dot is effectively unresampled -- which buys exact fractional
// spacing with no drift across the screen, and one fill instead of the tens
// of thousands of stamps the lattice would otherwise cost.
function drawDotGrid(ctx, s) {
  // Dots need more air than lines do. A rule at 10px spacing still reads as
  // ruling, but dots that close together stop being a lattice and turn into
  // a halftone wash, so the lattice steps up instead of fading out.
  const step = comfortableStep(s.view.zoom, DOT_SPACING);
  fillDotLattice(ctx, s, step, 2, `rgba(${s.rgb}, ${s.alpha * 0.6})`);
  // Every hundredth unit stays emphasised while it is a coarser lattice
  // than the one already drawn, which is what keeps the sheet measurable.
  if (GRID_MAJOR > step && GRID_MAJOR % step === 0) {
    fillDotLattice(ctx, s, GRID_MAJOR, 3.2, `rgba(${s.rgb}, ${s.alpha})`);
  }
}

function fillDotLattice(ctx, s, step, diameterCss, color) {
  const { dpr, view } = s;
  const spacing = step * view.zoom * dpr;
  if (spacing < 3) return;
  const tileSize = Math.max(2, Math.round(spacing));
  const d = Math.max(1, Math.round(diameterCss * dpr));
  const tile = dotTile(tileSize, d, color);

  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return;
  // Line the tile up so a dot sits centred on every world lattice point.
  const originX = view.panX * dpr;
  const originY = view.panY * dpr;
  const phaseX = originX - Math.ceil(originX / spacing) * spacing;
  const phaseY = originY - Math.ceil(originY / spacing) * spacing;
  pattern.setTransform(
    new DOMMatrix()
      .translateSelf(phaseX - d / 2, phaseY - d / 2)
      .scaleSelf(spacing / tileSize),
  );
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function dotTile(tileSize, d, color) {
  const key = `${tileSize}:${d}:${color}`;
  const hit = dotTileCache.get(key);
  if (hit) return hit;

  const tile = document.createElement("canvas");
  tile.width = tileSize;
  tile.height = tileSize;
  const tctx = tile.getContext("2d");
  tctx.fillStyle = color;
  if (d <= 2) {
    // At one or two pixels a circle and a square are the same picture, and
    // the square is the one that stays uniform across the lattice.
    tctx.fillRect(0, 0, d, d);
  } else {
    tctx.beginPath();
    tctx.arc(d / 2, d / 2, d / 2, 0, Math.PI * 2);
    tctx.fill();
  }

  // Spacing changes continuously while zooming, so the key space is large.
  if (dotTileCache.size > DOT_CACHE_LIMIT) dotTileCache.clear();
  dotTileCache.set(key, tile);
  return tile;
}

// --- Isometric -----------------------------------------------------------
// Verticals plus two families of 30-degree lines. Perpendicular spacing
// matches the graph grid's minor step (major step when zoomed out).
// The diagonals cannot be pixel-snapped the way the verticals can, so they
// are drawn a touch softer to keep the three families reading as one weight.
function drawIsoGrid(ctx, s) {
  const { dpr, view, bounds } = s;
  // Three line families crossing at 30 degrees fill space roughly three
  // times as fast as a square grid does, so the same spacing that reads as
  // graph paper reads as woven cloth here. It gets the widest step.
  const step = comfortableStep(view.zoom, ISO_SPACING);
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const width = Math.max(1, Math.round(dpr));

  ctx.lineWidth = width;
  ctx.strokeStyle = `rgba(${s.rgb}, ${s.alpha * 0.55})`;
  ctx.beginPath();
  const start = Math.floor(bounds.left / step) * step;
  const end = Math.ceil(bounds.right / step) * step;
  for (let x = start; x <= end; x += step) {
    const px = snap(deviceX(x, view, dpr), width);
    if (px < -width || px > w + width) continue;
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
  }
  ctx.stroke();

  ctx.strokeStyle = `rgba(${s.rgb}, ${s.alpha * 0.42})`;
  ctx.beginPath();
  strokeSlanted(ctx, s, step, Math.tan(ISO_ANGLE));
  strokeSlanted(ctx, s, step, -Math.tan(ISO_ANGLE));
  ctx.stroke();
}

/** Add device-space lines y = m*x + c covering the viewport. */
function strokeSlanted(ctx, s, step, m) {
  const { dpr, view, bounds } = s;
  const w = ctx.canvas.width;
  // Intercept spacing that yields `step` perpendicular spacing.
  const d = step / Math.cos(ISO_ANGLE);
  const cMin = Math.min(bounds.top - m * bounds.left, bounds.top - m * bounds.right);
  const cMax = Math.max(bounds.bottom - m * bounds.left, bounds.bottom - m * bounds.right);
  const start = Math.floor(cMin / d) * d;
  for (let c = start; c <= cMax; c += d) {
    ctx.moveTo(0, deviceY(m * bounds.left + c, view, dpr));
    ctx.lineTo(w, deviceY(m * bounds.right + c, view, dpr));
  }
}

export { GRID_MAJOR, GRID_MINOR };
