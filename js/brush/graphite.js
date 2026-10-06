// brush/graphite.js
// The pencil from the paper test sheet, kept as that sheet draws it.
//
// Pigment lands only where the paper tooth meets the tip. Each dab is an
// ellipse warped by noise; coverage builds in a float buffer (with a wear
// term) and is flushed as alpha. The caller multiplies that onto the page
// so the sheet's grain stays in the mark. HB is the sheet's selected grade.

const GRADE = { cap: 0.75, rate: 0.75, sz: 1, thr: 0 };
const PENCIL_PRESSURE = 0.5;
const SPARE = 280;
const LIMIT = 8192;

const hh = (x, y) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};

const vn2 = (x, y) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hh(ix, iy);
  const b = hh(ix + 1, iy);
  const c = hh(ix, iy + 1);
  const d = hh(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};

const tooth = (x, y) => (
  vn2(x / 1.4, y / 1.4) * 0.4
  + vn2(x / 3.1 + 17, y / 3.1 + 17) * 0.3
  + vn2(x / 0.9 + 41, y / 0.9 + 41) * 0.2
  + vn2(x * 0.3 + 5, y * 1.1 + 5) * 0.25
  + vn2(x / 8 + 3, y / 8 + 3) * 0.2
) / 1.35;

const tooth2 = (x, y, ix, iy) => (
  tooth(x, y) * 1.35 + vn2(x / 0.55 + 9, y / 0.55 + 9) * 0.3 + hh(ix * 1.7, iy * 2.3) * 0.45
) / 2.1;

function parseRgb(color) {
  if (typeof color === "string" && color[0] === "#" && color.length === 7) {
    return [
      parseInt(color.slice(1, 3), 16),
      parseInt(color.slice(3, 5), 16),
      parseInt(color.slice(5, 7), 16),
    ];
  }
  // The sheet's graphite, used when the colour isn't a plain hex.
  return [58, 58, 64];
}

function seedFrom(id) {
  let h = 2166136261;
  const s = String(id || "");
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967296) * 100;
}

/** How far a dab reaches past the centreline, in world units. */
export function graphiteReach(baseWidth, scale) {
  const r = (baseWidth / 2) * GRADE.sz / Math.max(scale, 1e-4);
  return r * 1.4 * 1.25 + 3 / Math.max(scale, 1e-4);
}

let live = null;

function makeCanvas(w, h, rgb) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = rgb[0];
    d[i * 4 + 1] = rgb[1];
    d[i * 4 + 2] = rgb[2];
  }
  return { canvas, ctx, img };
}

function alloc(w, h, rgb, originX, originY, scale, id, baseWidth) {
  const layer = makeCanvas(w, h, rgb);
  live = {
    id,
    scale,
    baseWidth,
    rgb,
    originX,
    originY,
    w,
    h,
    buf: new Float32Array(w * h),
    wr: new Float32Array(w * h),
    canvas: layer.canvas,
    ctx: layer.ctx,
    img: layer.img,
    pointCount: 0,
    anchor: null,
    seed: seedFrom(id),
    ang: 0.6,
    x: 0,
    y: 0,
  };
}

function shiftBuffers(left, top, w, h) {
  const nextB = new Float32Array(w * h);
  const nextW = new Float32Array(w * h);
  const cols = live.w;
  for (let y = 0; y < live.h; y++) {
    const src = y * cols;
    const dst = (y + top) * w + left;
    nextB.set(live.buf.subarray(src, src + cols), dst);
    nextW.set(live.wr.subarray(src, src + cols), dst);
  }
  const layer = makeCanvas(w, h, live.rgb);
  const old = live.img.data;
  const neu = layer.img.data;
  for (let y = 0; y < live.h; y++) {
    for (let x = 0; x < cols; x++) {
      const s = (y * cols + x) * 4 + 3;
      const d = ((y + top) * w + (x + left)) * 4 + 3;
      neu[d] = old[s];
    }
  }
  if (live.dirty) {
    live.dirty.x += left;
    live.dirty.y += top;
    live.dirty.x1 += left;
    live.dirty.y1 += top;
  }
  // The float coverage was copied above. The bitmap itself is new, so the
  // shifted alpha has to be uploaded or the earlier part of the stroke
  // disappears the moment the canvas grows.
  layer.ctx.putImageData(layer.img, 0, 0, left, top, cols, live.h);
  live.buf = nextB;
  live.wr = nextW;
  live.canvas = layer.canvas;
  live.ctx = layer.ctx;
  live.img = layer.img;
  live.w = w;
  live.h = h;
  live.originX -= left / live.scale;
  live.originY -= top / live.scale;
}

function growToFit(minX, minY, maxX, maxY) {
  const scale = live.scale;
  const x0 = Math.floor((minX - live.originX) * scale);
  const y0 = Math.floor((minY - live.originY) * scale);
  const x1 = Math.ceil((maxX - live.originX) * scale);
  const y1 = Math.ceil((maxY - live.originY) * scale);
  const left = x0 < 0 ? Math.ceil(-x0) + SPARE : 0;
  const top = y0 < 0 ? Math.ceil(-y0) + SPARE : 0;
  const right = x1 > live.w ? Math.ceil(x1 - live.w) + SPARE : 0;
  const bot = y1 > live.h ? Math.ceil(y1 - live.h) + SPARE : 0;
  if (left === 0 && top === 0 && right === 0 && bot === 0) return true;
  const w = live.w + left + right;
  const h = live.h + top + bot;
  if (w > LIMIT || h > LIMIT) return false;
  shiftBuffers(left, top, w, h);
  return true;
}

function flush(x0, y0, x1, y1) {
  x0 = Math.max(0, x0 | 0);
  y0 = Math.max(0, y0 | 0);
  x1 = Math.min(live.w, Math.ceil(x1));
  y1 = Math.min(live.h, Math.ceil(y1));
  if (x1 <= x0 || y1 <= y0) return;
  const d = live.img.data;
  const W = live.w;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      d[i * 4 + 3] = Math.min(255, live.buf[i] * 255);
    }
  }
  live.ctx.putImageData(live.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
  if (!live.dirty) live.dirty = { x: x0, y: y0, x1, y1 };
  else {
    live.dirty.x = Math.min(live.dirty.x, x0);
    live.dirty.y = Math.min(live.dirty.y, y0);
    live.dirty.x1 = Math.max(live.dirty.x1, x1);
    live.dirty.y1 = Math.max(live.dirty.y1, y1);
  }
}

function dab(cx, cy, r, pe, nx, ny, seed) {
  if (r < 0.05) return;
  const ca = Math.cos(0.6);
  const sa = Math.sin(0.6);
  const ell = 1.4;
  const R = r * ell * 1.25;
  const S = live.scale;
  const x0 = Math.floor((cx - live.originX - R) * S);
  const x1 = Math.ceil((cx - live.originX + R) * S);
  const y0 = Math.floor((cy - live.originY - R) * S);
  const y1 = Math.ceil((cy - live.originY + R) * S);
  const W = live.w;
  const H = live.h;
  const ox = Math.round(live.originX * S);
  const oy = Math.round(live.originY * S);
  for (let iy = Math.max(0, y0); iy < Math.min(H, y1); iy++) {
    for (let ix = Math.max(0, x0); ix < Math.min(W, x1); ix++) {
      const wx = live.originX + (ix + 0.5) / S;
      const wy = live.originY + (iy + 0.5) / S;
      const dx = wx - cx;
      const dy = wy - cy;
      const ex = ca * dx + sa * dy;
      const ey = (-sa * dx + ca * dy) * ell;
      const q = (ex * ex + ey * ey) / (r * r) * (1.3 - 0.6 * vn2(wx * 0.8 + seed, wy * 0.8));
      if (q >= 1.2) continue;
      const fall = 1 - q;
      const i = iy * W + ix;
      const a = live.buf[i];
      const fp = fall > 0 ? Math.sqrt(fall) : 0;
      const p = Math.min(1, pe * (0.8 + 0.4 * vn2((wx * nx + wy * ny) * 0.9 + seed, seed * 0.7)) * (0.25 + 0.75 * fp));
      live.wr[i] = Math.min(1, live.wr[i] + fp * fp * 0.03 * pe);
      const ax = ix + ox;
      const ay = iy + oy;
      const t = 0.5 + (tooth2(wx, wy, ax, ay) - 0.5) * 1.7 + live.wr[i] * 0.6;
      const thr = 0.68 - 0.5 * p + GRADE.thr;
      let c = t <= thr - 0.05 ? 0 : t >= thr + 0.05 ? 1 : (t - thr + 0.05) / 0.1;
      c = c * c * (3 - 2 * c);
      c = Math.max(c, p * p * 0.25 * Math.min(1, Math.max(0, (t - thr + 0.25) / 0.25)));
      if (a < GRADE.cap) {
        live.buf[i] = a + (GRADE.cap - a) * (0.35 + 0.65 * fp) * c * GRADE.rate * 0.26 * (0.65 + 0.7 * hh(ax * 1.3, ay * 0.7));
      }
    }
  }
  flush(x0, y0, x1, y1);
}

function seg(x, y) {
  const dx = x - live.sx;
  const dy = y - live.sy;
  const len = Math.hypot(dx, dy);
  const r = (live.baseWidth / 2) * GRADE.sz / live.scale;
  const n = Math.max(1, Math.ceil(len / Math.max(0.5, r * 0.25)));
  const ang = len > 0.5 ? Math.atan2(dy, dx) : live.ang;
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  // The sheet's mouse pencil. Pressure on a stylus is not kept on the
  // stored point, so every mark uses the sheet's default pencilPressure.
  const pe = PENCIL_PRESSURE * (1 - Math.min(0.35, len / 120));
  for (let k = 1; k <= n; k++) {
    dab(live.sx + dx * k / n, live.sy + dy * k / n, r, pe, nx, ny, live.seed);
  }
  live.sx = x;
  live.sy = y;
  if (len > 0.5) live.ang = ang;
}

function replay(points, closed) {
  const p0 = points[0];
  live.sx = p0.x;
  live.sy = p0.y;
  live.ang = 0.6;
  seg(p0.x + 0.01, p0.y);
  for (let i = 1; i < points.length; i++) seg(points[i].x, points[i].y);
  if (closed && points.length > 2) seg(p0.x, p0.y);
}

function boundsOf(points, reach) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX: minX - reach, minY: minY - reach, maxX: maxX + reach, maxY: maxY + reach };
}

/**
 * Rasterise a pencil the way the test sheet does. Extending the same stroke
 * only deposits the new segment. `owned` is always true: the canvas is this
 * stroke's, and the cache may keep it.
 */
export function rasterizeGraphite(id, points, opts) {
  if (!points.length) return null;
  const { color, baseWidth, scale, closed } = opts;
  const rgb = parseRgb(color);
  const reach = graphiteReach(baseWidth, scale);
  const b = boundsOf(points, reach);

  const anchorOk = live && live.pointCount > 0 && points.length >= live.pointCount
    && points[live.pointCount - 1].x === live.anchor.x
    && points[live.pointCount - 1].y === live.anchor.y;
  const same = live && live.id === id && live.scale === scale
    && live.baseWidth === baseWidth
    && live.rgb[0] === rgb[0] && live.rgb[1] === rgb[1] && live.rgb[2] === rgb[2]
    && anchorOk && !closed;

  let extended = false;
  if (!same) {
    const w = Math.max(1, Math.min(LIMIT, Math.ceil((b.maxX - b.minX) * scale) + SPARE));
    const h = Math.max(1, Math.min(LIMIT, Math.ceil((b.maxY - b.minY) * scale) + SPARE));
    const originX = Math.floor(b.minX * scale) / scale;
    const originY = Math.floor(b.minY * scale) / scale;
    alloc(w, h, rgb, originX, originY, scale, id, baseWidth);
    if (!growToFit(b.minX, b.minY, b.maxX, b.maxY)) return null;
    replay(points, closed);
  } else {
    extended = true;
    if (!growToFit(b.minX, b.minY, b.maxX, b.maxY)) return null;
    live.sx = points[live.pointCount - 1].x;
    live.sy = points[live.pointCount - 1].y;
    for (let i = live.pointCount; i < points.length; i++) seg(points[i].x, points[i].y);
  }

  const last = points[points.length - 1];
  live.pointCount = points.length;
  live.anchor = { x: last.x, y: last.y };
  const dirty = live.dirty || { x: 0, y: 0, x1: 1, y1: 1 };
  return {
    canvas: live.canvas,
    x: dirty.x,
    y: dirty.y,
    w: Math.max(1, dirty.x1 - dirty.x),
    h: Math.max(1, dirty.y1 - dirty.y),
    originX: live.originX,
    originY: live.originY,
    owned: true,
    extended,
  };
}
