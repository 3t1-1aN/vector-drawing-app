// render/background.js
// Paper backgrounds. The sheet is one continuous surface in world
// coordinates (see paper-surface.js): panning keeps the grain on the page,
// and zooming looks closer instead of stretching a tile. The transparent
// preset stays a screen-space checker. Flat mode is the base colour alone.
//
// If WebGL is missing, a cached value-noise tile stands in. It repeats, so
// it is only a fallback, not the sheet the shader draws.

import {
  appearance, BACKGROUNDS, getBackgroundBaseColor, hexToRgb,
} from "../workspace/appearance.js";
import { paintPaper, paperParamsFor } from "./paper-surface.js";

const TILE = 512;
const CHECKER = 12; // px per checker square for the transparent preset

const patternCache = new Map();

/** Deterministic PRNG, so the same sheet comes back after a reload. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Accumulate one octave of value noise over the whole tile.
 *
 * The lattice is `cells` across and every lookup wraps, so the octave meets
 * itself exactly at the tile edge and the sheet can repeat without a seam.
 */
function addOctave(field, cells, amp, rand) {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand() * 2 - 1;

  const cellSize = TILE / cells;
  for (let y = 0; y < TILE; y++) {
    const gy = y / cellSize;
    const yi = Math.floor(gy);
    const y0 = ((yi % cells) + cells) % cells;
    const y1 = (y0 + 1) % cells;
    const fy = smootherstep(gy - yi);
    const row0 = y0 * cells;
    const row1 = y1 * cells;
    for (let x = 0; x < TILE; x++) {
      const gx = x / cellSize;
      const xi = Math.floor(gx);
      const x0 = ((xi % cells) + cells) % cells;
      const x1 = (x0 + 1) % cells;
      const fx = smootherstep(gx - xi);
      const top = lattice[row0 + x0] + (lattice[row0 + x1] - lattice[row0 + x0]) * fx;
      const bot = lattice[row1 + x0] + (lattice[row1 + x1] - lattice[row1 + x0]) * fx;
      field[y * TILE + x] += (top + (bot - top) * fy) * amp;
    }
  }
}

/**
 * A sheet of paper in the given colour.
 *
 * `grain` is the peak luminance swing. Because the octaves are spatially
 * correlated the same number reads far softer than it would as white noise,
 * which is what lets the texture stay visible without looking digital.
 */
function makeGrainTile(baseHex, grain) {
  const field = new Float32Array(TILE * TILE);
  const rand = mulberry32(0x9e3779b9);
  // 64px mottling, 16px fibre, 4px and 2px tooth. Weights sum to 1 so the
  // field stays inside -1..1 and `grain` remains the honest peak amplitude.
  // The low octave is kept on a short leash: at this amplitude it is the one
  // the eye picks out as cloudy patches rather than as texture.
  addOctave(field, 8, 0.2, rand);
  addOctave(field, 32, 0.32, rand);
  addOctave(field, 128, 0.3, rand);
  addOctave(field, 256, 0.18, rand);

  const tile = document.createElement("canvas");
  tile.width = TILE;
  tile.height = TILE;
  const tctx = tile.getContext("2d");
  const { r, g, b } = hexToRgb(baseHex);
  const img = tctx.createImageData(TILE, TILE);
  const d = img.data;
  // A trace of uncorrelated tooth on top. Too little and the smooth octaves
  // band into visible contours on flat colours; too much and the static is
  // back. It tiles fine precisely because it has no structure to line up.
  const tooth = grain * 0.2;
  for (let i = 0, p = 0; i < field.length; i++, p += 4) {
    const n = field[i] * grain + (rand() * 2 - 1) * tooth;
    d[p] = clamp255(r + n);
    d[p + 1] = clamp255(g + n);
    d[p + 2] = clamp255(b + n);
    d[p + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  return tile;
}

function makeCheckerTile() {
  const tile = document.createElement("canvas");
  tile.width = CHECKER * 2;
  tile.height = CHECKER * 2;
  const tctx = tile.getContext("2d");
  tctx.fillStyle = "#24242a";
  tctx.fillRect(0, 0, CHECKER * 2, CHECKER * 2);
  tctx.fillStyle = "#2b2b32";
  tctx.fillRect(CHECKER, 0, CHECKER, CHECKER);
  tctx.fillRect(0, CHECKER, CHECKER, CHECKER);
  return tile;
}

function getPattern(ctx) {
  const key = appearance.background === "custom"
    ? `custom:${appearance.backgroundColor}`
    : appearance.background;
  let pattern = patternCache.get(key);
  if (pattern) return pattern;

  if (appearance.background === "transparent") {
    pattern = ctx.createPattern(makeCheckerTile(), "repeat");
  } else {
    const preset = BACKGROUNDS[appearance.background] || BACKGROUNDS.custom;
    const base = getBackgroundBaseColor() || "#1e1e22";
    pattern = ctx.createPattern(makeGrainTile(base, preset.grain), "repeat");
  }
  patternCache.set(key, pattern);
  return pattern;
}

/**
 * True when the sheet should be painted as flat colour. The transparent
 * preset is excluded: its checker is not texture, it is the only thing
 * saying there is no paper there at all.
 */
export function isPaperFlat() {
  return !appearance.paperTexture && appearance.background !== "transparent";
}

/** Fill the viewport. `view` locks the sheet to the page while panning. */
export function drawBackground(ctx, view) {
  const dpr = window.devicePixelRatio || 1;
  const destW = ctx.canvas.width / dpr;
  const destH = ctx.canvas.height / dpr;
  const base = getBackgroundBaseColor() || "#1e1e22";

  if (appearance.background === "transparent") {
    ctx.fillStyle = getPattern(ctx);
    ctx.fillRect(0, 0, destW, destH);
    return;
  }
  if (isPaperFlat()) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, destW, destH);
    return;
  }

  const preset = BACKGROUNDS[appearance.background] || BACKGROUNDS.custom;
  const camera = view || { panX: 0, panY: 0, zoom: 1 };
  const painted = paintPaper(ctx, {
    destW,
    destH,
    bufferScale: dpr,
    panX: camera.panX,
    panY: camera.panY,
    zoom: camera.zoom,
    params: paperParamsFor(base, preset.grain),
  });
  if (!painted) {
    ctx.fillStyle = getPattern(ctx);
    ctx.fillRect(0, 0, destW, destH);
  }
}

/**
 * A standalone sheet for UI previews, at natural (unzoomed) grain size so a
 * swatch shows the same texture the canvas will.
 */
export function paperTileFor(background, backgroundColor) {
  if (background === "transparent") return makeCheckerTile();
  const preset = BACKGROUNDS[background] || BACKGROUNDS.custom;
  const base = background === "custom"
    ? backgroundColor
    : (preset.color || "#1e1e22");
  return makeGrainTile(base, preset.grain);
}
