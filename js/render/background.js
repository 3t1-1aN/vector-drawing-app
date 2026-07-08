// render/background.js
// Concepts-inspired paper backgrounds. Each preset renders a base color
// with a subtle procedural grain, cached as a repeating CanvasPattern.
// Drawn in SCREEN space (before the view transform) so the paper reads
// like a sheet under glass: the grain never scales with zoom and tiles
// seamlessly while panning.

import {
  appearance, BACKGROUNDS, getBackgroundBaseColor, hexToRgb,
} from "../workspace/appearance.js";

const TILE = 256;
const CHECKER = 14; // px per checker square for the transparent preset

const patternCache = new Map();

function makeGrainTile(baseHex, amplitude) {
  const tile = document.createElement("canvas");
  tile.width = TILE;
  tile.height = TILE;
  const tctx = tile.getContext("2d");
  const { r, g, b } = hexToRgb(baseHex);
  const img = tctx.createImageData(TILE, TILE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // Uniform per-pixel brightness jitter — reads as paper tooth.
    const n = (Math.random() * 2 - 1) * amplitude;
    d[i] = Math.max(0, Math.min(255, r + n));
    d[i + 1] = Math.max(0, Math.min(255, g + n));
    d[i + 2] = Math.max(0, Math.min(255, b + n));
    d[i + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  return tile;
}

function makeCheckerTile() {
  const tile = document.createElement("canvas");
  tile.width = CHECKER * 2;
  tile.height = CHECKER * 2;
  const tctx = tile.getContext("2d");
  tctx.fillStyle = "#26262b";
  tctx.fillRect(0, 0, CHECKER * 2, CHECKER * 2);
  tctx.fillStyle = "#2f2f36";
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

/** Fill the whole viewport with the current background. Screen space. */
export function drawBackground(ctx) {
  ctx.fillStyle = getPattern(ctx);
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
}
