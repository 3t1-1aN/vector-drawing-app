// precision/recognize.js
// Shape recognition engine: analyzes a freeform pen stroke and returns a
// clean geometric primitive, or null. Moved out of the monolithic script
// unchanged in behavior. Takes an optional `zoom` for screen-px thresholds.

import { clamp } from "../core/view.js";

const RECOG_CLOSED_GAP_RATIO = 0.30;
const RECOG_CIRCLE_MAX_RSD = 0.22;
const RECOG_MIN_STROKE_PX = 30;
const RECOG_RDP_TOL_PX = 14;
const RECOG_CORNER_MERGE_PX = 20;
const RECOG_RIGHT_ANGLE_DEG = 22;
const RECOG_SQUARE_ASPECT = 0.12;
const RECOG_MIN_EDGE_PX = 18;
const RECOG_MIN_TRIANGLE_AREA_PX = 600;
// A vertex this close to flat is a leftover on a straight edge, not a corner.
const RECOG_STRAIGHT_DEG = 22;
// A ring this sharp was drawn as a polygon, so it must not become a circle.
const RECOG_CORNER_MAX_DEG = 130;

function strokeLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

function perpDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function simplifyRDP(points, tolerance) {
  const n = points.length;
  if (n < 3) return points.slice();
  const keep = new Array(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDist = 0;
    let idx = -1;
    const a = points[start];
    const b = points[end];
    for (let i = start + 1; i < end; i++) {
      const d = perpDistance(points[i], a, b);
      if (d > maxDist) { maxDist = d; idx = i; }
    }
    if (maxDist > tolerance && idx !== -1) {
      keep[idx] = true;
      stack.push([start, idx]);
      stack.push([idx, end]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function mergeCloseCorners(points, minDist) {
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minDist) {
      out.push(points[i]);
    }
  }
  if (out.length > 2) {
    const first = out[0];
    const last = out[out.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) < minDist) out.pop();
  }
  return out;
}

function interiorAngle(points, i) {
  const prev = points[(i - 1 + points.length) % points.length];
  const curr = points[i];
  const next = points[(i + 1) % points.length];
  const v1x = prev.x - curr.x, v1y = prev.y - curr.y;
  const v2x = next.x - curr.x, v2y = next.y - curr.y;
  const dot = v1x * v2x + v1y * v2y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (m === 0) return Math.PI;
  return Math.acos(clamp(dot / m, -1, 1));
}

function edgeLengths(points) {
  const e = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    e.push(Math.hypot(b.x - a.x, b.y - a.y));
  }
  return e;
}

function polygonArea(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function makeRectElement(corners) {
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const e = edgeLengths(corners);
  const w = (e[0] + e[2]) / 2;
  const h = (e[1] + e[3]) / 2;
  const ang = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const vx = -Math.sin(ang), vy = Math.cos(ang);
  const hw = w / 2, hh = h / 2;
  const pts = [
    { x: cx - hw * ux - hh * vx, y: cy - hw * uy - hh * vy },
    { x: cx + hw * ux - hh * vx, y: cy + hw * uy - hh * vy },
    { x: cx + hw * ux + hh * vx, y: cy + hw * uy + hh * vy },
    { x: cx - hw * ux + hh * vx, y: cy - hw * uy + hh * vy },
  ];
  const isSquare = Math.abs(w - h) / Math.max(w, h) <= RECOG_SQUARE_ASPECT;
  return {
    type: isSquare ? "square" : "rect",
    corners: pts,
    w, h,
    side: (w + h) / 2,
  };
}

/**
 * Rotate a closed stroke to start at the point farthest from its centroid,
 * and close the ring explicitly.
 *
 * RDP pins its first and last point, which on a closed stroke are the same
 * place: every candidate then gets measured against a zero-length baseline,
 * and which vertices survive comes down to where the hand happened to start.
 * The farthest point from the centroid is always a real corner on a polygon,
 * so anchoring there gives the recursion two honest endpoints to work from.
 */
function rotateToExtreme(points) {
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length;
  cy /= points.length;

  let start = 0;
  let far = -1;
  for (let i = 0; i < points.length; i++) {
    const d = (points[i].x - cx) ** 2 + (points[i].y - cy) ** 2;
    if (d > far) { far = d; start = i; }
  }

  const out = [];
  for (let i = 0; i < points.length; i++) {
    out.push(points[(start + i) % points.length]);
  }
  out.push(out[0]);
  return out;
}

/**
 * Drop vertices that sit on a straight run.
 *
 * Even anchored well, RDP leaves the occasional extra point mid-edge once the
 * stroke has any tremor in it. One of those is enough to make a square arrive
 * here as a pentagon and miss the quad test entirely, so they get removed by
 * flatness rather than by count. Removal is one-at-a-time because taking a
 * vertex out changes the angle at both its neighbours.
 */
function dropCollinear(ring) {
  const flat = Math.PI - (RECOG_STRAIGHT_DEG * Math.PI) / 180;
  let out = ring;
  for (let guard = ring.length; guard > 0 && out.length > 3; guard--) {
    let worst = -1;
    let worstAngle = flat;
    for (let i = 0; i < out.length; i++) {
      const a = interiorAngle(out, i);
      if (a > worstAngle) { worstAngle = a; worst = i; }
    }
    if (worst === -1) break;
    out = out.slice(0, worst).concat(out.slice(worst + 1));
  }
  return out;
}

/** The corner ring of a closed stroke: one vertex per genuine corner. */
function cornerRing(points, zoom) {
  let ring = simplifyRDP(rotateToExtreme(points), RECOG_RDP_TOL_PX / zoom);
  ring = mergeCloseCorners(ring, RECOG_CORNER_MERGE_PX / zoom);
  return dropCollinear(ring);
}

/** True when every vertex turns hard enough that the stroke reads as drawn corners. */
function hasSharpCorners(ring) {
  const limit = (RECOG_CORNER_MAX_DEG * Math.PI) / 180;
  for (let i = 0; i < ring.length; i++) {
    if (interiorAngle(ring, i) > limit) return false;
  }
  return true;
}

function recognizePolygon(ring, zoom) {
  const n = ring.length;
  const edges = edgeLengths(ring);
  const minEdge = RECOG_MIN_EDGE_PX / zoom;
  if (edges.some((e) => e < minEdge)) return null;

  if (n === 3) {
    const area = Math.abs(polygonArea(ring));
    const minArea = RECOG_MIN_TRIANGLE_AREA_PX / (zoom * zoom);
    if (area < minArea) return null;
    return { type: "triangle", corners: ring.slice(), sides: edges.slice() };
  }

  if (n === 4) {
    const right = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const dev = Math.abs(interiorAngle(ring, i) - right);
      if (dev > (RECOG_RIGHT_ANGLE_DEG * Math.PI) / 180) return null;
    }
    return makeRectElement(ring);
  }

  return null;
}

/**
 * Analyze a freeform stroke and return a clean primitive element (no id
 * yet — the caller assigns one on commit), or null. `zoom` is the
 * current view zoom used to convert screen-px thresholds to world units.
 */
export function recognizeShape(points, zoom) {
  if (points.length < 3) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const pathLen = strokeLength(points);
  if (pathLen * zoom < RECOG_MIN_STROKE_PX) return null;

  const endpointGap = Math.hypot(last.x - first.x, last.y - first.y);
  const gapRatio = endpointGap / pathLen;

  if (gapRatio >= RECOG_CLOSED_GAP_RATIO) {
    return { type: "line", startX: first.x, startY: first.y, endX: last.x, endY: last.y };
  }

  const ring = cornerRing(points, zoom);
  const polygon = recognizePolygon(ring, zoom);
  if (polygon) return polygon;

  // The roundness test below is a weak one -- a perfect square's radii vary by
  // about a tenth, well inside the threshold -- so it only gets to run on
  // strokes that were not drawn as corners. Without this, every quadrilateral
  // the rect test turns down (a rhombus, a lopsided box) comes back a circle.
  if (ring.length >= 3 && ring.length <= 4 && hasSharpCorners(ring)) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  let sumR = 0;
  const radii = new Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const r = Math.hypot(points[i].x - cx, points[i].y - cy);
    radii[i] = r;
    sumR += r;
  }
  const meanR = sumR / points.length;
  if (meanR > 0) {
    let sumSq = 0;
    for (const r of radii) { const d = r - meanR; sumSq += d * d; }
    const relStdDev = Math.sqrt(sumSq / points.length) / meanR;
    if (relStdDev <= RECOG_CIRCLE_MAX_RSD) {
      return { type: "circle", cx, cy, r: meanR };
    }
  }

  return null;
}

export { edgeLengths };
