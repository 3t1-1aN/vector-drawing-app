// precision/snap.js
// Unified snap: grid intersections plus object endpoints, midpoints,
// and perpendicular projection onto segments. Returns the nearest
// candidate within a screen-pixel threshold.

import { GRID_MINOR } from "../render/grid.js";
import { getRectCorners } from "../scene/element.js";

const SNAP_THRESHOLD_PX = 15;

/** Collect snap points from every element in the scene. */
function objectSnapPoints(scene) {
  const pts = [];
  for (const el of scene.elements) {
    switch (el.type) {
      case "line":
        pts.push(
          { x: el.startX, y: el.startY, kind: "endpoint" },
          { x: el.endX, y: el.endY, kind: "endpoint" },
          { x: (el.startX + el.endX) / 2, y: (el.startY + el.endY) / 2, kind: "midpoint" }
        );
        break;
      case "circle":
        pts.push({ x: el.cx, y: el.cy, kind: "center" });
        break;
      case "rect":
      case "square": {
        const c = getRectCorners(el);
        for (let i = 0; i < 4; i++) {
          pts.push({ x: c[i].x, y: c[i].y, kind: "endpoint" });
          const j = (i + 1) % 4;
          pts.push({
            x: (c[i].x + c[j].x) / 2,
            y: (c[i].y + c[j].y) / 2,
            kind: "midpoint",
          });
        }
        break;
      }
      case "triangle":
        for (let i = 0; i < 3; i++) {
          const a = el.corners[i];
          const b = el.corners[(i + 1) % 3];
          pts.push({ x: a.x, y: a.y, kind: "endpoint" });
          pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, kind: "midpoint" });
        }
        break;
      case "path":
        if (el.points.length > 0) {
          pts.push({ x: el.points[0].x, y: el.points[0].y, kind: "endpoint" });
          const last = el.points[el.points.length - 1];
          pts.push({ x: last.x, y: last.y, kind: "endpoint" });
        }
        for (let i = 0; i < el.points.length - 1; i++) {
          const a = el.points[i], b = el.points[i + 1];
          pts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, kind: "midpoint" });
        }
        break;
    }
  }
  return pts;
}

/** Project p onto segment a-b; returns the foot if it lies on the segment. */
function perpFoot(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (t < 0 || t > 1) return null;
  return { x: a.x + t * dx, y: a.y + t * dy, kind: "perpendicular" };
}

function segmentSnapPoints(scene, worldX, worldY) {
  const p = { x: worldX, y: worldY };
  const pts = [];
  for (const el of scene.elements) {
    const segs = segmentsOf(el);
    for (const [a, b] of segs) {
      const foot = perpFoot(p, a, b);
      if (foot) pts.push(foot);
    }
  }
  return pts;
}

function segmentsOf(el) {
  switch (el.type) {
    case "line":
      return [[{ x: el.startX, y: el.startY }, { x: el.endX, y: el.endY }]];
    case "rect":
    case "square": {
      const c = getRectCorners(el);
      return [[c[0], c[1]], [c[1], c[2]], [c[2], c[3]], [c[3], c[0]]];
    }
    case "triangle": {
      const c = el.corners;
      return [[c[0], c[1]], [c[1], c[2]], [c[2], c[0]]];
    }
    case "path": {
      const segs = [];
      for (let i = 1; i < el.points.length; i++) {
        segs.push([el.points[i - 1], el.points[i]]);
      }
      return segs;
    }
    default:
      return [];
  }
}

/**
 * Snap a world coordinate to the nearest grid intersection or object
 * snap point within threshold. Object snaps take priority over grid.
 */
export function getSnappedPosition(worldX, worldY, scene, zoom, gridUnit = GRID_MINOR) {
  const thresholdWorld = SNAP_THRESHOLD_PX / zoom;
  let best = null;
  let bestDist = thresholdWorld;

  // Grid intersection.
  const gx = Math.round(worldX / gridUnit) * gridUnit;
  const gy = Math.round(worldY / gridUnit) * gridUnit;
  const gd = Math.hypot(gx - worldX, gy - worldY);
  if (gd <= bestDist) {
    best = { x: gx, y: gy, snapped: true, kind: "grid" };
    bestDist = gd;
  }

  // Object endpoint / midpoint snaps (higher priority — tighter dist wins).
  const objPts = objectSnapPoints(scene);
  const perpPts = segmentSnapPoints(scene, worldX, worldY);
  for (const pt of [...objPts, ...perpPts]) {
    const d = Math.hypot(pt.x - worldX, pt.y - worldY);
    if (d <= bestDist) {
      best = { x: pt.x, y: pt.y, snapped: true, kind: pt.kind };
      bestDist = d;
    }
  }

  if (best) return best;
  return { x: worldX, y: worldY, snapped: false };
}
