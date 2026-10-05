// math/cluster.js
// Pause-and-group nearby path strokes into math candidate clusters.
// Mirrors the pen tool's 700ms hold grammar so recognition feels native.

import { getBounds } from "../scene/element.js";

export const MATH_PAUSE_MS = 700;
const MAX_STROKES = 40;
const MIN_STROKES = 1;

/** World gap between stroke AABBs that still merges into one expression. */
export function mergeGapWorld(zoom) {
  return 48 / Math.max(zoom, 0.25);
}

/**
 * @param {object[]} pathElements
 * @param {number} zoom
 * @returns {object[][]} clusters of elements
 */
export function clusterPathElements(pathElements, zoom) {
  const paths = pathElements.filter((el) => el.type === "path" && el.points?.length >= 2);
  if (paths.length === 0) return [];

  const gap = mergeGapWorld(zoom);
  const bounds = paths.map((el) => padded(getBounds(el), gap * 0.15));
  const parent = paths.map((_, i) => i);

  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function unite(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      if (aabbGap(bounds[i], bounds[j]) <= gap) unite(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < paths.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(paths[i]);
  }
  return [...groups.values()];
}

function padded(b, p) {
  return {
    minX: b.minX - p, minY: b.minY - p,
    maxX: b.maxX + p, maxY: b.maxY + p,
  };
}

function aabbGap(a, b) {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

export function unionBoundsOf(elements) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    const b = getBounds(el);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const pad = Math.max(8, (maxX - minX) * 0.08);
  return {
    minX: minX - pad, minY: minY - pad,
    maxX: maxX + pad, maxY: maxY + pad,
  };
}

/**
 * Cheap gate: silence non-math scribbles before OCR.
 * Returns a score 0..1; below ~0.35 we skip recognition.
 */
export function mathLikeness(elements, zoom) {
  if (elements.length < MIN_STROKES || elements.length > MAX_STROKES) return 0;
  let totalLen = 0;
  let shortStrokes = 0;
  for (const el of elements) {
    if (el.type !== "path" || !el.points?.length) return 0;
    let len = 0;
    for (let i = 1; i < el.points.length; i++) {
      len += Math.hypot(
        el.points[i].x - el.points[i - 1].x,
        el.points[i].y - el.points[i - 1].y
      );
    }
    totalLen += len;
    const b = getBounds(el);
    const screenH = (b.maxY - b.minY) * zoom;
    const screenW = (b.maxX - b.minX) * zoom;
    if (screenH < 120 && screenW < 200) shortStrokes++;
  }
  const b = unionBoundsOf(elements);
  const w = (b.maxX - b.minX) * zoom;
  const h = (b.maxY - b.minY) * zoom;
  if (w < 12 || h < 10) return 0;
  if (w > 900 || h > 420) return 0; // huge sketches aren't expressions
  if (totalLen * zoom < 20) return 0;

  let score = 0.45;
  score += Math.min(0.25, shortStrokes * 0.04);
  const aspect = w / Math.max(h, 1);
  if (aspect > 1.2 && aspect < 12) score += 0.15; // horizontal writing
  if (elements.length >= 2) score += 0.1;
  return Math.min(1, score);
}
