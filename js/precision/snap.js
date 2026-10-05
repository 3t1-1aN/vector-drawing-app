// precision/snap.js
// Unified snap: grid intersections plus object endpoints, midpoints,
// and perpendicular projection onto segments. Returns the nearest
// candidate within a screen-pixel threshold.

import { GRID_MINOR } from "../render/grid.js";
import { getBounds, getRectCorners } from "../scene/element.js";

const SNAP_THRESHOLD_PX = 15;

function boundsNear(el, worldX, worldY, thr) {
  const b = getBounds(el);
  return !(
    b.maxX < worldX - thr || b.minX > worldX + thr ||
    b.maxY < worldY - thr || b.minY > worldY + thr
  );
}

function segNear(a, b, worldX, worldY, thr) {
  const minX = (a.x < b.x ? a.x : b.x) - thr;
  const maxX = (a.x > b.x ? a.x : b.x) + thr;
  const minY = (a.y < b.y ? a.y : b.y) - thr;
  const maxY = (a.y > b.y ? a.y : b.y) + thr;
  return worldX >= minX && worldX <= maxX && worldY >= minY && worldY <= maxY;
}

/** Foot of the perpendicular from p onto segment a-b, if it lands on the segment. */
function perpFoot(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (t < 0 || t > 1) return null;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Snap a world coordinate to the nearest grid intersection or object
 * snap point within threshold. A closer object snap wins over the grid.
 *
 * Candidates are tested in place. Building a point per path segment made
 * shape tools allocate in proportion to everything already on the page.
 */
export function getSnappedPosition(worldX, worldY, scene, zoom, gridUnit = GRID_MINOR) {
  const thresholdWorld = SNAP_THRESHOLD_PX / zoom;
  let best = null;
  let bestDist = thresholdWorld;

  const gx = Math.round(worldX / gridUnit) * gridUnit;
  const gy = Math.round(worldY / gridUnit) * gridUnit;
  const gd = Math.hypot(gx - worldX, gy - worldY);
  if (gd <= bestDist) {
    best = { x: gx, y: gy, snapped: true, kind: "grid" };
    bestDist = gd;
  }

  const consider = (x, y, kind) => {
    const d = Math.hypot(x - worldX, y - worldY);
    if (d <= bestDist) {
      best = { x, y, snapped: true, kind };
      bestDist = d;
    }
  };

  const near = [];
  for (const el of scene.elements) {
    if (boundsNear(el, worldX, worldY, thresholdWorld)) near.push(el);
  }

  // Endpoints and midpoints first, then perpendiculars, so a tie prefers
  // the foot — the same order as collecting both lists and scanning them.
  for (const el of near) considerObject(el, worldX, worldY, thresholdWorld, consider);
  for (const el of near) considerPerp(el, worldX, worldY, thresholdWorld, consider);

  if (best) return best;
  return { x: worldX, y: worldY, snapped: false };
}

function considerObject(el, worldX, worldY, thr, consider) {
  switch (el.type) {
    case "line":
      consider(el.startX, el.startY, "endpoint");
      consider(el.endX, el.endY, "endpoint");
      consider((el.startX + el.endX) / 2, (el.startY + el.endY) / 2, "midpoint");
      break;
    case "circle":
      consider(el.cx, el.cy, "center");
      break;
    case "rect":
    case "square": {
      const c = getRectCorners(el);
      for (let i = 0; i < 4; i++) {
        consider(c[i].x, c[i].y, "endpoint");
        const j = (i + 1) % 4;
        consider((c[i].x + c[j].x) / 2, (c[i].y + c[j].y) / 2, "midpoint");
      }
      break;
    }
    case "triangle":
      for (let i = 0; i < 3; i++) {
        const a = el.corners[i];
        const b = el.corners[(i + 1) % 3];
        consider(a.x, a.y, "endpoint");
        consider((a.x + b.x) / 2, (a.y + b.y) / 2, "midpoint");
      }
      break;
    case "path": {
      const pts = el.points;
      if (pts.length === 0) break;
      consider(pts[0].x, pts[0].y, "endpoint");
      const last = pts[pts.length - 1];
      consider(last.x, last.y, "endpoint");
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        if (!segNear(a, b, worldX, worldY, thr)) continue;
        consider((a.x + b.x) / 2, (a.y + b.y) / 2, "midpoint");
      }
      break;
    }
  }
}

function considerPerp(el, worldX, worldY, thr, consider) {
  const p = { x: worldX, y: worldY };
  const visit = (a, b) => {
    if (!segNear(a, b, worldX, worldY, thr)) return;
    const foot = perpFoot(p, a, b);
    if (foot) consider(foot.x, foot.y, "perpendicular");
  };
  switch (el.type) {
    case "line":
      visit({ x: el.startX, y: el.startY }, { x: el.endX, y: el.endY });
      break;
    case "rect":
    case "square": {
      const c = getRectCorners(el);
      visit(c[0], c[1]); visit(c[1], c[2]); visit(c[2], c[3]); visit(c[3], c[0]);
      break;
    }
    case "triangle": {
      const c = el.corners;
      visit(c[0], c[1]); visit(c[1], c[2]); visit(c[2], c[0]);
      break;
    }
    case "path":
      for (let i = 1; i < el.points.length; i++) visit(el.points[i - 1], el.points[i]);
      break;
  }
}
