// brush/engine.js
// Stage 5: rendering. Turns nodes into pixels.
//
// Every brush renders the same way: build an alpha mask for the stroke, bite
// texture out of it, then tint the whole mask in one fill. Two reasons:
//
//  - Opacity. Stamping coloured discs straight onto the canvas makes a stroke
//    darken wherever its own stamps overlap, so a 20%-opacity pencil line
//    comes out nearly black. Accumulating alpha in a mask and tinting once
//    means overlap within a stroke is controlled by `buildup` and overlap
//    between strokes still darkens, which is how real media behave.
//
//  - Texture. Paper grain has to multiply the finished stroke, not each
//    stamp, or the grain doubles up along the trail.
//
// The tip families diverge only in how they fill the mask: round tips stamp a
// sprite, ribbon and nib tips fill a variable-width outline.

import { TIP_NIB, TIP_RIBBON, TIP_ROUND } from "./presets.js";
import { buildNodes } from "./physics.js";
import { getPaperTile, getTipSprites, hashNoise, PAPER_TILE_PX, spriteFor } from "./tips.js";

// Scratch mask, grown as needed and reused so a stroke does not allocate.
let mask = null;
let maskCtx = null;

function ensureMask(w, h) {
  if (!mask) {
    mask = document.createElement("canvas");
    maskCtx = mask.getContext("2d");
  }
  if (mask.width < w || mask.height < h) {
    mask.width = Math.max(mask.width, w);
    mask.height = Math.max(mask.height, h);
  }
  maskCtx.setTransform(1, 0, 0, 1, 0, 0);
  maskCtx.globalCompositeOperation = "source-over";
  maskCtx.globalAlpha = 1;
  return maskCtx;
}

/** Pixel rect covering the nodes, clamped to the mask and padded for the tip. */
function dirtyRect(nodes, w, h, preset, baseWidth) {
  const pad = maxTipRadius(preset, baseWidth) + 2;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const x = Math.max(0, Math.floor(minX - pad));
  const y = Math.max(0, Math.floor(minY - pad));
  return {
    x,
    y,
    w: Math.min(w, Math.ceil(maxX + pad)) - x,
    h: Math.min(h, Math.ceil(maxY + pad)) - y,
  };
}

/**
 * Widest the tip can get, in canvas px. Used to pad bounds so a stroke's
 * soft edge and low-speed swell are never clipped.
 */
export function maxTipRadius(preset, baseWidth) {
  const pool = preset.nib ? 1 + preset.nib.pool : 1;
  return (baseWidth / 2) * pool * 1.35 + 2;
}

/**
 * Convert a target alpha into the per-stamp alpha that reaches it once
 * neighbouring stamps have overlapped.
 *
 * A point on the centreline is covered about width*coverage/step times, and
 * source-over compounds as 1-(1-a)^k. Inverting that keeps a light stroke
 * light however densely it is stamped — without it, a 16%-alpha pencil line
 * comes out solid. `coverage` is the tip's measured solid-equivalent width;
 * using the raw diameter here would overestimate the overlap of a soft tip
 * and wash the stroke out instead. `buildup` blends back toward the raw
 * value for media that should darken as they are worked over.
 */
function stampAlpha(node, preset, coverage) {
  const overlap = Math.max(1, (node.width * coverage) / node.step);
  const target = Math.min(0.999, node.alpha);
  const corrected = 1 - Math.pow(1 - target, 1 / overlap);
  return corrected + (target - corrected) * preset.buildup;
}

// --- Tip fills -------------------------------------------------------------

function stampRound(ctx, nodes, preset, originX, originY, scale) {
  const { variants, coverage } = getTipSprites(preset);
  const textureGain = preset.vel.texture;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const d = n.width;
    if (d < 0.2) continue;
    let a = stampAlpha(n, preset, coverage);
    if (textureGain > 0) {
      // Break-up keyed to world position, not to the node index: the same
      // patch of paper always resists the same amount, and moving faster
      // exposes more of it.
      const wx = (n.x / scale + originX) * 0.9;
      const wy = (n.y / scale + originY) * 0.9;
      const grit = hashNoise(Math.round(wx), Math.round(wy), 0x51);
      a *= 1 - textureGain * n.v * grit;
    }
    if (a <= 0.002) continue;
    ctx.globalAlpha = Math.min(1, a);
    // Variants cycle so the baked rim irregularity does not repeat visibly.
    ctx.drawImage(spriteFor(variants[i % variants.length], d),
                  n.x - d / 2, n.y - d / 2, d, d);
  }
  ctx.globalAlpha = 1;
}

/**
 * Variable-width outline through the nodes: up one side, back down the other.
 *
 * A single filled polygon is what gives a pen its even opacity — there is no
 * overlap to accumulate — and it stays crisp because the edge is geometry
 * rather than a resampled sprite.
 */
function fillRibbon(ctx, nodes, preset) {
  if (nodes.length < 2) {
    if (nodes.length === 1) fillDot(ctx, nodes[0]);
    return;
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const h = n.width / 2;
    const x = n.x + Math.cos(n.dir - Math.PI / 2) * h;
    const y = n.y + Math.sin(n.dir - Math.PI / 2) * h;
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const h = n.width / 2;
    ctx.lineTo(
      n.x + Math.cos(n.dir + Math.PI / 2) * h,
      n.y + Math.sin(n.dir + Math.PI / 2) * h,
    );
  }
  ctx.closePath();
  ctx.fill();
  // Round the ends and smooth over the slight facets the outline leaves at
  // tight turns, without widening the stroke.
  capEnds(ctx, nodes);
}

/**
 * Nib outline: the edge of the nib is a short segment held at a fixed angle,
 * and the stroke is the area it sweeps.
 *
 * This is the whole difference between a fountain pen and a thick pressure
 * pen. Width is not a property of the node — it falls out of the angle
 * between travel and the nib, so the same pressure gives a hairline going one
 * way and a broad stroke going the other, and every curve shades between the
 * two on its own.
 */
function fillNib(ctx, nodes, preset) {
  const nib = preset.nib;
  const ax = Math.cos(nib.angle);
  const ay = Math.sin(nib.angle);
  if (nodes.length < 2) {
    if (nodes.length === 1) fillDot(ctx, nodes[0]);
    return;
  }
  ctx.globalAlpha = 1;

  const half = (n) => {
    // Ink pools where the pen slows, and the nib bites wider through a
    // direction change as the hand rolls it.
    const speedSwell = 1 + nib.pool * (1 - n.v);
    const curveSwell = 1 + nib.curveGain * n.curve;
    return (n.width / 2) * speedSwell * curveSwell;
  };

  ctx.beginPath();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const h = half(n);
    const x = n.x + ax * h;
    const y = n.y + ay * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const h = half(n);
    ctx.lineTo(n.x - ax * h, n.y - ay * h);
  }
  ctx.closePath();
  ctx.fill();

  // Travelling along the nib axis collapses the swept area to nothing, so a
  // thin round core rides underneath to keep the hairline continuous.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    ctx.lineWidth = Math.max(0.4, ((a.width + b.width) / 2) * nib.narrow);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

function fillDot(ctx, n) {
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(n.x, n.y, Math.max(0.3, n.width / 2), 0, Math.PI * 2);
  ctx.fill();
}

function capEnds(ctx, nodes) {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    const w = Math.min(a.width, b.width);
    if (w < 0.3) continue;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
}

// --- Texture ---------------------------------------------------------------

/**
 * Multiply paper tooth into the finished mask.
 *
 * `destination-out` with the tile in the alpha channel gives
 * mask *= (1 - strength * tooth), i.e. the paper refusing ink. The pattern is
 * offset by the stroke's world origin so the grain belongs to the page: pan
 * or zoom and it stays put under the stroke instead of swimming.
 */
function applyGrain(ctx, preset, rect, originX, originY, scale, meanSpeed) {
  const grain = preset.grain;
  if (!grain) return;
  const strength = Math.min(0.95, grain.strength + grain.speedGain * meanSpeed);
  if (strength <= 0.002) return;
  const pattern = ctx.createPattern(getPaperTile(), "repeat");
  if (!pattern) return;

  const tileScale = grain.scale * Math.max(0.35, Math.min(3, scale));
  const period = PAPER_TILE_PX * tileScale;
  const offX = -(((originX * scale) % period) + period) % period;
  const offY = -(((originY * scale) % period) + period) % period;
  if (typeof DOMMatrix === "function" && pattern.setTransform) {
    pattern.setTransform(new DOMMatrix([tileScale, 0, 0, tileScale, offX, offY]));
  }
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = strength;
  ctx.fillStyle = pattern;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

// --- Public entry point ----------------------------------------------------

function toLocal(points, originX, originY, scale) {
  const out = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    out[i] = { x: (p.x - originX) * scale, y: (p.y - originY) * scale, p: p.p, v: p.v };
  }
  return out;
}

/**
 * Rasterise one stroke into the shared scratch mask, tinted and textured but
 * at full opacity. The caller composites it, which is what lets the same
 * bitmap serve a committed stroke and a dimmed live preview.
 *
 * @param points  stroke points in world space, each { x, y, p?, v? }
 * @param opts
 *   preset      brush preset
 *   color       CSS colour string
 *   baseWidth   full tip width in canvas px at pressure 1
 *   scale       world -> canvas px factor (zoom * dpr)
 *   originX/Y   world coordinate of the mask's (0,0)
 *   width/height  mask size in px
 *   closed      true for closed outlines (rect, circle, triangle)
 *   exact       true when the points are already the final outline
 * @returns { canvas, x, y, w, h } in mask px, or null if nothing was drawn
 */
export function rasterizeStroke(points, opts) {
  const {
    preset, color, baseWidth, scale, originX, originY, width, height, closed, exact,
  } = opts;
  if (width <= 0 || height <= 0 || points.length === 0) return null;

  const { nodes } = buildNodes(toLocal(points, originX, originY, scale), preset,
                              { baseWidth, closed, exact });
  if (nodes.length === 0) return null;

  const ctx = ensureMask(width, height);
  const rect = dirtyRect(nodes, width, height, preset, baseWidth);
  if (rect.w <= 0 || rect.h <= 0) return null;
  ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";

  if (preset.tip === TIP_ROUND) stampRound(ctx, nodes, preset, originX, originY, scale);
  else if (preset.tip === TIP_NIB) fillNib(ctx, nodes, preset);
  else if (preset.tip === TIP_RIBBON) fillRibbon(ctx, nodes, preset);

  let meanSpeed = 0;
  for (const n of nodes) meanSpeed += n.v;
  applyGrain(ctx, preset, rect, originX, originY, scale, meanSpeed / nodes.length);

  // One tint for the whole stroke. Stamped tips already carry their alpha
  // variation in the mask, so this only colours it. Both this and the grain
  // are whole-region passes, so they run over the dirty rect only.
  ctx.globalCompositeOperation = "source-in";
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.globalCompositeOperation = "source-over";
  return { canvas: mask, ...rect };
}

