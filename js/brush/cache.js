// brush/cache.js
// Makes procedural brushes affordable in an app that redraws every frame.
//
// The render loop is continuous, so without caching every committed stroke
// would be re-stamped 60 times a second. Each stroke is instead rasterised
// once into its own bitmap and blitted after that, which turns a scene of
// hundreds of textured strokes into hundreds of drawImage calls.
//
// Three things keep it honest:
//   - a signature per element, so edits and restyles invalidate
//   - a per-frame rasterise budget, so a zoom change spreads over several
//     frames instead of stalling one
//   - an LRU pixel cap, so a long session cannot grow without bound
//
// The live stroke deliberately bypasses the cache: it changes every frame, so
// caching it would only churn.

import { getRectCorners } from "../scene/element.js";
import { getBrushPreset, TIP_FILL } from "./presets.js";
import { maskPad, rasterizeStroke } from "./engine.js";
import { graphiteReach, rasterizeGraphite } from "./graphite.js";
import { elementRev } from "../render/ink-rev.js";
import { isDarkBackground } from "../workspace/appearance.js";

// Rasterises allowed per frame once an entry already exists. A brand new
// stroke always renders immediately -- it has nothing stale to fall back on.
const REFRESH_BUDGET = 4;
// ~64MB of RGBA bitmaps.
const MAX_CACHE_PX = 16e6;

const entries = new Map();
let cachedPx = 0;
let frame = 0;
let budget = REFRESH_BUDGET;

// --- Geometry --------------------------------------------------------------

/**
 * An element's outline as brush input: world-space points plus the pressure
 * and speed the engine needs.
 *
 * Freehand paths carry per-point measurements from capture. Geometric shapes
 * never had a pointer travelling along them, so they get a steady mid
 * pressure -- a snapped rectangle should look drawn with an even hand, not
 * given invented dynamics. They are also flagged `exact`: their outline is
 * the shape itself, so the engine must trace it rather than smooth it.
 */
function elementPolyline(el) {
  const steady = (pts) => pts.map((p) => ({ x: p.x, y: p.y, p: 0.7, v: 0.2 }));
  switch (el.type) {
    case "line":
      return {
        points: steady([{ x: el.startX, y: el.startY }, { x: el.endX, y: el.endY }]),
        closed: false,
        exact: true,
      };
    case "path":
      return { points: el.points, closed: false, exact: false };
    case "rect":
    case "square":
      return { points: steady(getRectCorners(el)), closed: true, exact: true };
    case "triangle":
      return { points: steady(el.corners), closed: true, exact: true };
    case "circle": {
      const n = Math.max(32, Math.min(160, Math.round(el.r * 1.2)));
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: el.cx + Math.cos(a) * el.r, y: el.cy + Math.sin(a) * el.r });
      }
      return { points: steady(pts), closed: true, exact: true };
    }
    default:
      return { points: [], closed: false, exact: false };
  }
}

function boundsOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Cheap change detector: style, point count, and a checksum over a bounded
 * sample of the geometry. Sampling rather than hashing every point keeps this
 * O(1) for long strokes; the stride is prime-ish so a transform that happens
 * to preserve the bounding box still moves the sampled points.
 */
function signature(el, points, scale) {
  const st = el.style || {};
  let sum = points.length * 7.7;
  const stride = Math.max(1, Math.floor(points.length / 24));
  for (let i = 0; i < points.length; i += stride) {
    const p = points[i];
    sum += p.x * 0.7 + p.y * 1.3 + (p.p ?? 0) * 11 + i * 0.013;
  }
  const last = points[points.length - 1];
  if (last) sum += last.x * 2.1 + last.y * 3.3;
  return `${st.medium || "pen"}|${st.stroke}|${st.strokeWidth}|${st.opacity}|${scale.toFixed(4)}|${points.length}|${sum.toFixed(3)}`;
}

// --- Cache -----------------------------------------------------------------

function evictIfNeeded() {
  if (cachedPx <= MAX_CACHE_PX) return;
  const byAge = [...entries.entries()].sort((a, b) => a[1].frame - b[1].frame);
  for (const [id, e] of byAge) {
    if (cachedPx <= MAX_CACHE_PX * 0.8) break;
    cachedPx -= e.w * e.h;
    entries.delete(id);
  }
}

function invalidateBrush(id) {
  const e = entries.get(id);
  if (!e) return;
  cachedPx -= e.w * e.h;
  entries.delete(id);
}

/**
 * Start a frame: resets the rasterise budget.
 *
 * Entries for deleted elements are left to the LRU rather than hooked into
 * scene removal — ids are never reused, and an undo re-adds the same id with
 * the same geometry, so a lingering entry is a cache hit rather than a leak.
 */
export function beginBrushFrame() {
  frame++;
  budget = REFRESH_BUDGET;
}

export function brushCacheStats() {
  return { entries: entries.size, megapixels: +(cachedPx / 1e6).toFixed(2) };
}

// --- Drawing ---------------------------------------------------------------

function tipWidth(el, preset, dpr) {
  return Math.max(0.5, (el.style?.strokeWidth || 2) * preset.sizeMul * dpr);
}

/**
 * How far the render-time spline can bow outside the points it was given.
 *
 * Sampled input is interpolated, and a centripetal Catmull-Rom leaves the
 * hull of its control points by a fraction of the chord it spans — so sparse
 * capture bows furthest. Every other brush hides that inside the padding its
 * tip already needs. A fill has no tip to hide it in, and where a clipped
 * hairline loses a sliver, a clipped fill gains a straight cut across a solid
 * area. Measured worst case is an eighth of the chord; half leaves room.
 */
function splineSlack(points, preset, exact) {
  if (exact || preset.tip !== TIP_FILL) return 0;
  let maxChord = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (d > maxChord) maxChord = d;
  }
  return maxChord * 0.5;
}

/**
 * Where a committed stroke's bitmap sits in world space, and how big it is in
 * device pixels.
 *
 * The origin is snapped so it lands on a whole device pixel, which keeps the
 * 1:1 blit from resampling the stroke through a half-pixel filter.
 */
function layout(el, points, preset, scale, dpr, exact) {
  const baseWidth = tipWidth(el, preset, dpr);
  const padWorld = (preset.id === "pencil"
    ? graphiteReach(baseWidth, scale)
    : maskPad(preset, baseWidth, scale) / scale)
                 + splineSlack(points, preset, exact);
  const b = boundsOf(points);
  if (!isFinite(b.minX)) return null;
  const originX = Math.floor((b.minX - padWorld) * scale) / scale;
  const originY = Math.floor((b.minY - padWorld) * scale) / scale;
  const w = Math.ceil((b.maxX + padWorld - originX) * scale);
  const h = Math.ceil((b.maxY + padWorld - originY) * scale);
  return { baseWidth, originX, originY, w, h };
}


/**
 * Draw one element with its brush. Must be called with the world transform
 * applied; the bitmap is placed in world units so it lands 1:1 in device
 * pixels.
 *
 * @param opts.alphaScale  extra multiplier (live preview dimming)
 * @param opts.cache       false for the in-flight stroke
 */
export function drawBrushElement(ctx, el, view, { alphaScale = 1, cache = true } = {}) {
  const st = el.style || {};
  const preset = getBrushPreset(st.medium || "pen");
  const dpr = window.devicePixelRatio || 1;
  const scale = view.zoom * dpr;
  const alpha = Math.max(0, Math.min(1, (st.opacity ?? 1) * preset.alphaMul * alphaScale));
  if (alpha <= 0.002) return;
  // The sheet multiplies graphite into the paper. On a dark sheet that
  // just swallows the mark, so it is painted on instead.
  const op = preset.id === "pencil" && !isDarkBackground() ? "multiply" : null;

  // Unchanged stroke at this zoom: the bitmap is already right. Skip the
  // polyline, the signature, and the layout. A page of drawings then costs
  // one blit per stroke on a rebuild, and nothing at all when the ink layer
  // is reused.
  if (cache) {
    const elRev = elementRev(el);
    const hit = entries.get(el.id);
    if (hit && hit.elRev === elRev && hit.scale === scale && hit.raster) {
      hit.frame = frame;
      blit(ctx, hit.raster, hit.box, hit.scale, alpha, op);
      return;
    }
  }

  const { points, closed, exact } = elementPolyline(el);
  if (points.length === 0) return;

  const box = layout(el, points, preset, scale, dpr, exact);
  if (!box || box.w <= 0 || box.h <= 0) return;

  const strokeOpts = {
    preset,
    color: st.stroke || "#888",
    baseWidth: box.baseWidth,
    scale,
    originX: box.originX,
    originY: box.originY,
    width: box.w,
    height: box.h,
    closed,
    exact,
  };

  if (!cache) {
    // A freehand pencil grows by appending. Rebuilding it from the first
    // point every frame is the stall while the hand is still down.
    if (preset.id === "pencil") {
      const raster = rasterizeGraphite(el.id, points, strokeOpts);
      if (raster) {
        blit(ctx, raster, { originX: raster.originX, originY: raster.originY }, scale, alpha, op);
        return;
      }
    }
    const raster = rasterizeStroke(points, strokeOpts);
    if (raster) blit(ctx, raster, box, scale, alpha, op);
    return;
  }

  const sig = signature(el, points, scale);
  let entry = entries.get(el.id);
  if (entry && entry.sig === sig) {
    entry.frame = frame;
    entry.elRev = elementRev(el);
    blit(ctx, entry.raster, entry.box, scale, alpha, op);
    return;
  }

  // Stale but usable: blit it at the scale it was drawn while the budget
  // catches up, so zooming stays smooth instead of stalling on a full
  // re-rasterise of the whole scene.
  if (entry && budget <= 0) {
    blit(ctx, entry.raster, entry.box, entry.scale, alpha, op);
    return;
  }

  // Releasing the pencil, or the frame that caught the last samples, can
  // extend the live canvas instead of rasterising the whole line again.
  if (preset.id === "pencil") {
    const raster = rasterizeGraphite(el.id, points, strokeOpts);
    if (raster && raster.owned) {
      rememberLive(el, points, scale, raster);
      blit(ctx, raster, { originX: raster.originX, originY: raster.originY }, scale, alpha, op);
      if (entry && !raster.extended) budget--;
      return;
    }
  }

  const raster = rasterizeStroke(points, strokeOpts);
  if (!raster) {
    invalidateBrush(el.id);
    return;
  }
  if (entry) budget--;

  // Only the dirty rect is kept, not the full padded box: for a long diagonal
  // stroke that is a fraction of the bounding area.
  if (!entry || entry.w !== raster.w || entry.h !== raster.h) {
    if (entry) cachedPx -= entry.w * entry.h;
    const canvas = document.createElement("canvas");
    canvas.width = raster.w;
    canvas.height = raster.h;
    entry = { canvas, ctx: canvas.getContext("2d"), w: raster.w, h: raster.h };
    entries.set(el.id, entry);
    cachedPx += raster.w * raster.h;
  }
  entry.ctx.clearRect(0, 0, entry.w, entry.h);
  entry.ctx.drawImage(raster.canvas, raster.x, raster.y, raster.w, raster.h,
                      0, 0, entry.w, entry.h);
  entry.sig = sig;
  entry.scale = scale;
  entry.elRev = elementRev(el);
  // Where the kept rect lands in world space.
  entry.box = {
    originX: box.originX + raster.x / scale,
    originY: box.originY + raster.y / scale,
    w: raster.w,
    h: raster.h,
  };
  entry.raster = { canvas: entry.canvas, x: 0, y: 0, w: entry.w, h: entry.h };
  entry.frame = frame;
  evictIfNeeded();

  blit(ctx, entry.raster, entry.box, scale, alpha, op);
}

/**
 * Keep a finished live pencil so releasing it, or the next frame, blits
 * the bitmap instead of walking the whole stroke again.
 */
function rememberLive(el, points, scale, raster) {
  const sig = signature(el, points, scale);
  const px = raster.canvas.width * raster.canvas.height;
  let entry = entries.get(el.id);
  if (!entry || entry.canvas !== raster.canvas) {
    if (entry) cachedPx -= entry.w * entry.h;
    entry = {
      canvas: raster.canvas,
      w: raster.canvas.width,
      h: raster.canvas.height,
      frame,
    };
    entries.set(el.id, entry);
    cachedPx += px;
    evictIfNeeded();
  }
  entry.sig = sig;
  entry.scale = scale;
  entry.elRev = elementRev(el);
  entry.frame = frame;
  entry.box = { originX: raster.originX, originY: raster.originY };
  entry.raster = {
    canvas: raster.canvas,
    x: raster.x, y: raster.y, w: raster.w, h: raster.h,
  };
}

/**
 * Place a raster sub-rect in world space. Drawn in world units so the
 * device-pixel mapping comes out 1:1 when `sourceScale` matches the view.
 */
function blit(ctx, raster, box, sourceScale, alpha, composite) {
  const prevAlpha = ctx.globalAlpha;
  const prevOp = ctx.globalCompositeOperation;
  if (composite) ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = alpha;
  const wx = box.originX + (raster.x || 0) / sourceScale;
  const wy = box.originY + (raster.y || 0) / sourceScale;
  ctx.drawImage(
    raster.canvas,
    raster.x, raster.y, raster.w, raster.h,
    wx, wy, raster.w / sourceScale, raster.h / sourceScale,
  );
  ctx.globalAlpha = prevAlpha;
  ctx.globalCompositeOperation = prevOp;
}
