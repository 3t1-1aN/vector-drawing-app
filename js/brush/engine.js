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
// sprite, ribbon and nib tips fill a variable-width outline, and the fill tip
// has no tip at all — it inks the area the path encloses.

import { TIP_FILL, TIP_NIB, TIP_RIBBON, TIP_ROUND } from "./presets.js";
import { buildNodes } from "./physics.js";
import { getPaperTile, getTipSprites, graphiteTooth, graphiteWarp, hashNoise, paperToothPeriod, spriteFor } from "./tips.js";

// Scratch mask, grown as needed and reused so a stroke does not allocate.
let mask = null;
let maskCtx = null;

function ensureMask(w, h) {
  if (!mask) {
    mask = document.createElement("canvas");
    // Read back every frame while a pencil is live. Without this hint,
    // getImageData pulls the canvas back from the GPU and the stroke stalls.
    maskCtx = mask.getContext("2d", { willReadFrequently: true });
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

/** How far a pencil outline is shoved, in mask pixels. */
function rimAmp(scale, baseWidth) {
  return Math.max(scale * 0.85, baseWidth * 0.32);
}

/** Padding a stroke bitmap needs so the tip and the pencil rim are not clipped. */
export function maskPad(preset, baseWidth, scale) {
  const wobble = preset.id === "pencil" ? rimAmp(scale, baseWidth) + 2 : 0;
  return maxTipRadius(preset, baseWidth) + wobble;
}

/** Pixel rect covering the nodes, clamped to the mask and padded for the tip. */
function dirtyRect(nodes, w, h, preset, baseWidth, scale) {
  const pad = maskPad(preset, baseWidth, scale);
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
  // A fill has no tip to spread: its edge is the path, so all it needs is
  // room for the antialiased rim.
  if (preset.tip === TIP_FILL) return 2;
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

const spriteAlphaCache = new WeakMap();

function cachedSpriteAlpha(sprite) {
  let hit = spriteAlphaCache.get(sprite);
  if (hit) return hit;
  const w = sprite.width;
  const h = sprite.height;
  const data = sprite.getContext("2d").getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  hit = { alpha, w, h };
  spriteAlphaCache.set(sprite, hit);
  return hit;
}

/**
 * Stamp round tips into a coverage buffer. Same overlap and grit as
 * {@link stampRound}, but it never touches a canvas, so a live pencil does
 * not have to read pixels back off the GPU.
 */
function stampCoverage(buf, bw, bh, shiftX, shiftY, nodes, preset, originX, originY, scale) {
  const { variants, coverage } = getTipSprites(preset);
  const textureGain = preset.vel.texture;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const d = n.width;
    if (d < 0.2) continue;
    let a = stampAlpha(n, preset, coverage);
    if (textureGain > 0) {
      const wx = (n.x / scale + originX) * 0.9;
      const wy = (n.y / scale + originY) * 0.9;
      a *= 1 - textureGain * n.v * hashNoise(Math.round(wx), Math.round(wy), 0x51);
    }
    if (a <= 0.002) continue;
    blitCoverage(buf, bw, bh, spriteFor(variants[i % variants.length], d),
                 n.x - shiftX - d / 2, n.y - shiftY - d / 2, d, Math.min(1, a));
  }
}

function blitCoverage(buf, bw, bh, sprite, dx, dy, dw, opacity) {
  const { alpha, w: sw, h: sh } = cachedSpriteAlpha(sprite);
  const x0 = Math.max(0, Math.floor(dx));
  const y0 = Math.max(0, Math.floor(dy));
  const x1 = Math.min(bw, Math.ceil(dx + dw));
  const y1 = Math.min(bh, Math.ceil(dy + dw));
  if (x0 >= x1 || y0 >= y1) return;
  const inv = 1 / dw;
  const sw1 = sw - 1;
  const sh1 = sh - 1;
  for (let y = y0; y < y1; y++) {
    let v = ((y + 0.5 - dy) * inv) * sh - 0.5;
    let yf = 0;
    let ty = 0;
    if (v > 0) {
      if (v >= sh1) yf = sh1;
      else { yf = v | 0; ty = v - yf; }
    }
    const rowS = yf * sw;
    const rowS2 = ty > 0 ? rowS + sw : rowS;
    const row = y * bw;
    for (let x = x0; x < x1; x++) {
      let u = ((x + 0.5 - dx) * inv) * sw - 0.5;
      let xf = 0;
      let tx = 0;
      if (u > 0) {
        if (u >= sw1) xf = sw1;
        else { xf = u | 0; tx = u - xf; }
      }
      const x2 = xf < sw1 ? xf + 1 : xf;
      const i00 = alpha[rowS + xf];
      const i10 = alpha[rowS + x2];
      const sample = ty === 0
        ? i00 + (i10 - i00) * tx
        : (i00 + (i10 - i00) * tx) * (1 - ty)
          + (alpha[rowS2 + xf] + (alpha[rowS2 + x2] - alpha[rowS2 + xf]) * tx) * ty;
      const s = (sample / 255) * opacity;
      if (s < 0.004) continue;
      const di = row + x;
      const dst = buf[di] / 255;
      buf[di] = Math.round((s + dst * (1 - s)) * 255);
    }
  }
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

/**
 * The area the path encloses, rather than the path itself.
 *
 * Closing back to the start with a straight edge is what lets a stroke that
 * was lifted early still read as a shape — it gets cut off rather than
 * curved shut. Even-odd is the whole character of the brush: loop back over
 * your own stroke and the re-enclosed part drops out as a hole, cross it once
 * more and it comes back.
 *
 * Accumulating into the mask rather than painting straight to the canvas is
 * what keeps a translucent fill honest, since a shape that overlaps itself
 * would otherwise double its own opacity.
 */
function fillArea(ctx, nodes) {
  if (nodes.length < 3) return;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i < nodes.length; i++) ctx.lineTo(nodes[i].x, nodes[i].y);
  ctx.closePath();
  ctx.fill("evenodd");
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

function smooth01(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/**
 * Break the pencil's silhouette.
 *
 * Stamps lay a smooth capsule. Grain multiplied through that capsule only
 * mottles the inside; the outline stays the capsule. The sheet test does the
 * opposite at the rim: pigment survives only where tooth clears a threshold
 * that gets stricter as coverage falls, and the outline is shoved by a
 * world-locked warp so it is not a parallel curve.
 */
const warpTmp = [0, 0];

/**
 * Ragged graphite edge. `buf` is coverage 0..255 and is rewritten in place.
 * World position of `buf`'s top-left pixel is (`originX`, `originY`).
 */
function notchCoverage(buf, w, h, originX, originY, scale, baseWidth) {
  const srcA = new Uint8Array(buf);
  const amp = rimAmp(scale, baseWidth);
  const inv = 1 / Math.max(scale, 1e-4);
  const rad = Math.ceil(amp);
  // Pixels more than a warp away from any ink stay clear, so the empty
  // margin of the tip box does not pay for a noise sample.
  const near = new Uint8Array(w * h);
  for (let i = 0; i < srcA.length; i++) {
    if (srcA[i] < 3) continue;
    const px = i % w;
    const py = (i / w) | 0;
    const x0 = Math.max(0, px - rad);
    const x1 = Math.min(w - 1, px + rad);
    const y0 = Math.max(0, py - rad);
    const y1 = Math.min(h - 1, py + rad);
    for (let yy = y0; yy <= y1; yy++) near.fill(1, yy * w + x0, yy * w + x1 + 1);
  }

  for (let y = 0; y < h; y++) {
    const wy = originY + (y + 0.5) * inv;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (!near[i]) {
        buf[i] = 0;
        continue;
      }
      const wx = originX + (x + 0.5) * inv;
      graphiteWarp(wx, wy, warpTmp);
      const sx = Math.max(0, Math.min(w - 1, Math.round(x + warpTmp[0] * amp)));
      const sy = Math.max(0, Math.min(h - 1, Math.round(y + warpTmp[1] * amp)));
      const a = srcA[sy * w + sx] / 255;
      if (a < 0.012) {
        buf[i] = 0;
        continue;
      }
      // The raw tooth sits in a narrow band around 0.5. Spread it the way the
      // sheet test does, or the cutoff misses the whole field and the stroke
      // just shrinks to a smaller smooth curve.
      const raw = graphiteTooth(wx, wy);
      const t = Math.max(0, Math.min(1, 0.5 + (raw - 0.5) * 1.7));
      // High coverage fills. Toward the rim the threshold climbs, and a miss
      // is zero — a leftover fraction of the smooth falloff is what kept the
      // outline looking machined.
      const thr = 0.72 - 0.5 * Math.min(1, a);
      const keep = t <= thr - 0.04 ? 0
        : t >= thr + 0.04 ? 1
        : smooth01((t - (thr - 0.04)) / 0.08);
      const floor = a * a * 0.18 * smooth01((t - thr + 0.22) / 0.22);
      const m = keep > floor ? keep : floor;
      buf[i] = Math.round(Math.min(1, a * m) * 255);
    }
  }
}

function breakPencilRim(ctx, rect, originX, originY, scale, baseWidth) {
  if (rect.w < 1 || rect.h < 1) return;
  const img = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
  const d = img.data;
  const w = rect.w;
  const h = rect.h;
  const buf = new Uint8Array(w * h);
  for (let i = 0; i < buf.length; i++) buf[i] = d[i * 4 + 3];
  const ox = originX + rect.x / scale;
  const oy = originY + rect.y / scale;
  notchCoverage(buf, w, h, ox, oy, scale, baseWidth);
  for (let i = 0; i < buf.length; i++) d[i * 4 + 3] = buf[i];
  ctx.putImageData(img, rect.x, rect.y);
}



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

  // One tooth texel is one world pixel, then brought into mask pixels so the
  // fibers sit on the same places as the sheet.
  const tileScale = scale;
  const period = paperToothPeriod() * tileScale;
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
  const rect = dirtyRect(nodes, width, height, preset, baseWidth, scale);
  if (rect.w <= 0 || rect.h <= 0) return null;
  ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";

  if (preset.tip === TIP_ROUND) stampRound(ctx, nodes, preset, originX, originY, scale);
  else if (preset.tip === TIP_NIB) fillNib(ctx, nodes, preset);
  else if (preset.tip === TIP_RIBBON) fillRibbon(ctx, nodes, preset);
  else if (preset.tip === TIP_FILL) fillArea(ctx, nodes);

  let meanSpeed = 0;
  for (const n of nodes) meanSpeed += n.v;
  if (preset.id === "pencil") {
    breakPencilRim(ctx, rect, originX, originY, scale, baseWidth);
  }
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

// --- Live stroke ------------------------------------------------------------
// The in-flight stroke used to be rebuilt from the first point on every
// frame: every stamp, then a pixel walk over the whole bounding box. That
// walk is what made a pencil stall harder the longer the line got.
//
// The body of a stroke stops changing once it is a few widths behind the
// cursor (the exit taper and the last spline segment still move). Those
// stamps stay on a canvas. Each frame only redraws the tip, and only the
// tip is run through the rim and the grain.

const LIVE_SPARE = 360;
const LIVE_LIMIT = 8192;

let live = null;

function worldBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function makeLayer(w, h, read) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", read ? { willReadFrequently: true } : undefined);
  return { canvas, ctx };
}

function startLive(id, points, opts) {
  const { preset, scale, baseWidth, color } = opts;
  const b = worldBounds(points);
  const pad = maskPad(preset, baseWidth, scale) / Math.max(scale, 1e-4) + 24;
  const originX = Math.floor((b.minX - pad) * scale) / scale;
  const originY = Math.floor((b.minY - pad) * scale) / scale;
  const w = Math.max(1, Math.min(LIVE_LIMIT, Math.ceil((b.maxX + pad - originX) * scale) + LIVE_SPARE));
  const h = Math.max(1, Math.min(LIVE_LIMIT, Math.ceil((b.maxY + pad - originY) * scale) + LIVE_SPARE));
  const view = makeLayer(w, h, false);
  live = {
    id, scale, baseWidth, color, preset, presetId: preset.id,
    originX, originY,
    alpha: new Uint8Array(w * h),
    aw: w,
    ah: h,
    view: view.canvas, viewCtx: view.ctx,
    frozenS: 0,
    tipRect: null,
    content: null,
    pointCount: 0,
    anchor: null,
    win: null,
    img: null,
  };
}

function liveFits(b) {
  return b.minX >= 0 && b.minY >= 0
    && b.maxX <= live.aw && b.maxY <= live.ah;
}

function growLive(b) {
  const left = b.minX < 0 ? Math.ceil(-b.minX) + LIVE_SPARE : 0;
  const top = b.minY < 0 ? Math.ceil(-b.minY) + LIVE_SPARE : 0;
  const right = b.maxX > live.aw ? Math.ceil(b.maxX - live.aw) + LIVE_SPARE : 0;
  const bot = b.maxY > live.ah ? Math.ceil(b.maxY - live.ah) + LIVE_SPARE : 0;
  const w = live.aw + left + right;
  const h = live.ah + top + bot;
  if (w > LIVE_LIMIT || h > LIVE_LIMIT || (left === 0 && top === 0 && right === 0 && bot === 0)) {
    return false;
  }
  const next = new Uint8Array(w * h);
  const cols = live.aw;
  for (let y = 0; y < live.ah; y++) {
    next.set(live.alpha.subarray(y * cols, y * cols + cols), (y + top) * w + left);
  }
  const view = makeLayer(w, h, false);
  view.ctx.drawImage(live.view, left, top);
  live.originX -= left / live.scale;
  live.originY -= top / live.scale;
  live.alpha = next;
  live.aw = w;
  live.ah = h;
  live.view = view.canvas;
  live.viewCtx = view.ctx;
  if (live.tipRect) {
    live.tipRect.x += left;
    live.tipRect.y += top;
  }
  if (live.content) {
    live.content.x += left;
    live.content.y += top;
  }
  return true;
}

function nodeBounds(nodes, preset, baseWidth, scale) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pad = maskPad(preset, baseWidth, scale);
  for (const n of nodes) {
    if (n.x - pad < minX) minX = n.x - pad;
    if (n.y - pad < minY) minY = n.y - pad;
    if (n.x + pad > maxX) maxX = n.x + pad;
    if (n.y + pad > maxY) maxY = n.y + pad;
  }
  return { minX, minY, maxX, maxY };
}

function nodesBetween(nodes, s0, s1) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    const s = nodes[i].s;
    if (s >= s0 && s < s1) out.push(nodes[i]);
  }
  return out;
}

function unionRect(a, b) {
  if (!a || a.w <= 0 || a.h <= 0) return b && b.w > 0 && b.h > 0 ? b : null;
  if (!b || b.w <= 0 || b.h <= 0) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x, y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

let toothAlpha = null;
let toothN = 0;

function toothTexel(u, v) {
  if (!toothAlpha) {
    const tile = getPaperTile();
    toothN = tile.width;
    const data = tile.getContext("2d").getImageData(0, 0, toothN, toothN).data;
    toothAlpha = new Uint8Array(toothN * toothN);
    for (let i = 0; i < toothAlpha.length; i++) toothAlpha[i] = data[i * 4 + 3];
  }
  const n = toothN;
  u = ((u % n) + n) % n;
  v = ((v % n) + n) % n;
  const x0 = u | 0;
  const y0 = v | 0;
  const tx = u - x0;
  const ty = v - y0;
  const x1 = (x0 + 1) % n;
  const y1 = (y0 + 1) % n;
  const a = toothAlpha[y0 * n + x0];
  const b = toothAlpha[y0 * n + x1];
  const c = toothAlpha[y1 * n + x0];
  const d = toothAlpha[y1 * n + x1];
  return ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty) / 255;
}

function parseColor(color) {
  if (typeof color === "string" && color[0] === "#" && (color.length === 7 || color.length === 4)) {
    if (color.length === 4) {
      return [
        parseInt(color[1] + color[1], 16),
        parseInt(color[2] + color[2], 16),
        parseInt(color[3] + color[3], 16),
      ];
    }
    return [
      parseInt(color.slice(1, 3), 16),
      parseInt(color.slice(3, 5), 16),
      parseInt(color.slice(5, 7), 16),
    ];
  }
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color || "#000";
  ctx.fillRect(0, 0, 1, 1);
  const px = ctx.getImageData(0, 0, 1, 1).data;
  return [px[0], px[1], px[2]];
}

function finishWindow(rect, tail, meanSpeed) {
  const { x, y, w, h } = rect;
  const n = w * h;
  let win = live.win;
  if (!win || win.length < n) {
    win = new Uint8Array(n);
    live.win = win;
  }
  const src = live.alpha;
  const sw = live.aw;
  for (let row = 0; row < h; row++) {
    win.set(src.subarray((y + row) * sw + x, (y + row) * sw + x + w), row * w);
  }
  if (tail.length) {
    stampCoverage(win, w, h, x, y, tail, live.preset, live.originX, live.originY, live.scale);
  }
  const ox = live.originX + x / live.scale;
  const oy = live.originY + y / live.scale;
  if (live.preset.id === "pencil") notchCoverage(win, w, h, ox, oy, live.scale, live.baseWidth);

  const grain = live.preset.grain;
  const strength = grain
    ? Math.min(0.95, grain.strength + grain.speedGain * meanSpeed)
    : 0;
  const scale = live.scale;
  const period = strength > 0.002 ? paperToothPeriod() * scale : 1;
  const offX = strength > 0.002 ? -(((ox * scale) % period) + period) % period : 0;
  const offY = strength > 0.002 ? -(((oy * scale) % period) + period) % period : 0;
  if (!live.rgb) live.rgb = parseColor(live.color);
  const [cr, cg, cb] = live.rgb;

  let img = live.img;
  if (!img || img.width !== w || img.height !== h) {
    img = new ImageData(w, h);
    live.img = img;
  }
  const d = img.data;
  const inv = 1 / Math.max(scale, 1e-4);
  for (let row = 0; row < h; row++) {
    const base = row * w;
    for (let col = 0; col < w; col++) {
      let a = win[base + col];
      if (a && strength > 0.002) {
        const u = (col - offX) * inv;
        const v = (row - offY) * inv;
        a = Math.round(a * (1 - strength * toothTexel(u, v)));
        if (a < 0) a = 0;
      }
      const o = (base + col) * 4;
      d[o] = cr;
      d[o + 1] = cg;
      d[o + 2] = cb;
      d[o + 3] = a;
    }
  }
  // Replaces the patch, including pixels the tip has left behind.
  live.viewCtx.putImageData(img, x, y);
}

/**
 * Rasterise a freehand pencil while it is still being drawn.
 *
 * Same pixels as {@link rasterizeStroke} for the finished body. The tip is
 * redone each frame because taper and the last spline segment still move.
 * `owned` is false when the result sits on the shared scratch mask and must
 * not be cached.
 *
 * @returns { canvas, x, y, w, h, originX, originY, owned, extended }
 */
export function rasterizeLiveStroke(id, points, opts) {
  const { preset, color, baseWidth, scale } = opts;
  if (!points.length) return null;

  const anchorOk = live && live.pointCount > 0 && points.length >= live.pointCount
    && points[live.pointCount - 1].x === live.anchor.x
    && points[live.pointCount - 1].y === live.anchor.y;
  const same = live && live.id === id && live.scale === scale
    && live.baseWidth === baseWidth && live.color === color
    && live.presetId === preset.id && anchorOk;

  let extended = false;
  if (!same) {
    startLive(id, points, opts);
  } else {
    extended = true;
  }

  let built = null;
  for (let guard = 0; guard < 4; guard++) {
    built = buildNodes(
      toLocal(points, live.originX, live.originY, live.scale),
      preset,
      { baseWidth, closed: false, exact: false },
    );
    if (built.nodes.length === 0) return null;
    const bounds = nodeBounds(built.nodes, preset, baseWidth, scale);
    if (liveFits(bounds)) break;
    if (!growLive(bounds)) {
      live = null;
      const raster = rasterizeStroke(points, opts);
      return raster && { ...raster, originX: opts.originX, originY: opts.originY, owned: false, extended: false };
    }
  }

  const { nodes, length } = built;
  const tailKeep = Math.max(48, baseWidth * 6);
  const stableS = Math.max(0, length - tailKeep);
  if (stableS < live.frozenS) {
    // The stroke got shorter. One fresh build; the new canvas starts at 0
    // so this cannot recurse.
    live = null;
    return rasterizeLiveStroke(id, points, opts);
  }

  const stable = nodesBetween(nodes, live.frozenS, stableS);
  const stableRect = stable.length
    ? dirtyRect(stable, live.aw, live.ah, preset, baseWidth, scale)
    : null;
  if (stable.length) {
    stampCoverage(live.alpha, live.aw, live.ah, 0, 0, stable, preset, live.originX, live.originY, scale);
  }
  live.frozenS = stableS;

  const tail = nodesBetween(nodes, stableS, Infinity);
  const tailRect = tail.length
    ? dirtyRect(tail, live.aw, live.ah, preset, baseWidth, scale)
    : null;

  // Last frame's tip has to be repainted too: those pixels were the moving
  // end, and this frame they are either stable ink or empty.
  let dirty = unionRect(live.tipRect, stableRect);
  dirty = unionRect(dirty, tailRect);
  if (dirty && dirty.w > 0 && dirty.h > 0) {
    let speed = 0;
    const touched = stable.concat(tail);
    for (let i = 0; i < touched.length; i++) speed += touched[i].v;
    const mean = touched.length ? speed / touched.length : 0;
    finishWindow(dirty, tail, mean);
    live.tipRect = tailRect ? { x: tailRect.x, y: tailRect.y, w: tailRect.w, h: tailRect.h } : null;
    live.content = unionRect(live.content, dirty);
  }

  const last = points[points.length - 1];
  live.pointCount = points.length;
  live.anchor = { x: last.x, y: last.y };
  const content = live.content || { x: 0, y: 0, w: 1, h: 1 };
  return {
    canvas: live.view,
    x: content.x,
    y: content.y,
    w: content.w,
    h: content.h,
    originX: live.originX,
    originY: live.originY,
    owned: true,
    extended,
  };
}

