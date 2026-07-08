// scene/element.js
// Element model: factory with stable IDs, bounding boxes, hit testing,
// and geometric transforms (translate / scale / rotate). Primitives stay
// parametric until a non-uniform transform forces them to "bake" into a
// path. All geometry is in world space.
//
// Element shapes:
//   line:     { id, type:'line',   startX, startY, endX, endY, style }
//   rect:     { id, type:'rect',   startX, startY, endX, endY, style }   (tool)
//             OR { id, type:'rect', corners:[4], w, h, style }            (recognized)
//   square:   { id, type:'square', corners:[4], w, h, side, style }
//   circle:   { id, type:'circle', cx, cy, r, style }
//   triangle: { id, type:'triangle', corners:[3], sides:[3], style }
//   path:     { id, type:'path',   points:[{x,y}], style }

import { brushToStyle } from "../brush/active-brush.js";

let _idCounter = 1;
export function nextId() {
  return `el_${_idCounter++}`;
}

export function createIdElement(type, partial) {
  return { id: nextId(), type, ...partial, style: defaultStyle(partial?.style) };
}

export function defaultStyle(style) {
  return { ...brushToStyle(), ...style };
}

/** Deep clone of an element (for history snapshots). */
export function cloneElement(el) {
  const c = { ...el, style: { ...el.style } };
  if (el.corners) c.corners = el.corners.map((p) => ({ ...p }));
  if (el.points) c.points = el.points.map((p) => ({ ...p }));
  if (el.sides) c.sides = el.sides.slice();
  return c;
}

/** Ordered 4 corners of a rect/square (handles tool + recognized forms). */
export function getRectCorners(el) {
  if (el.corners) return el.corners;
  const x1 = Math.min(el.startX, el.endX);
  const y1 = Math.min(el.startY, el.endY);
  const x2 = Math.max(el.startX, el.endX);
  const y2 = Math.max(el.startY, el.endY);
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

/** Axis-aligned bounding box {minX,minY,maxX,maxY}. */
export function getBounds(el) {
  switch (el.type) {
    case "line":
      return {
        minX: Math.min(el.startX, el.endX),
        minY: Math.min(el.startY, el.endY),
        maxX: Math.max(el.startX, el.endX),
        maxY: Math.max(el.startY, el.endY),
      };
    case "circle":
      return {
        minX: el.cx - el.r, minY: el.cy - el.r,
        maxX: el.cx + el.r, maxY: el.cy + el.r,
      };
    case "rect":
    case "square": {
      const c = getRectCorners(el);
      return bboxOfPoints(c);
    }
    case "triangle":
      return bboxOfPoints(el.corners);
    case "path":
      return bboxOfPoints(el.points);
    default:
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
}

function bboxOfPoints(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Euclidean length of a line. */
export function lineLength(el) {
  const dx = el.endX - el.startX;
  const dy = el.endY - el.startY;
  return Math.hypot(dx, dy);
}

/** Rectangle width/height (tool form or recognized corners form). */
export function rectSize(el) {
  if (el.w != null && el.h != null) return { w: el.w, h: el.h };
  return {
    w: Math.abs(el.endX - el.startX),
    h: Math.abs(el.endY - el.startY),
  };
}

/** Distance from point p to segment a-b. */
function distPointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentsOf(el) {
  switch (el.type) {
    case "line":
      return [[{ x: el.startX, y: el.startY }, { x: el.endX, y: el.endY }]];
    case "rect":
    case "square": {
      const c = getRectCorners(el);
      return [
        [c[0], c[1]], [c[1], c[2]], [c[2], c[3]], [c[3], c[0]],
      ];
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
 * Hit test an element at a world point. `toleranceWorld` is the pick
 * radius in world units (caller converts screen px -> world via /zoom).
 * Returns true if the point lies on the element's outline.
 */
export function hitTest(el, worldX, worldY, toleranceWorld) {
  if (el.type === "circle") {
    const d = Math.abs(Math.hypot(worldX - el.cx, worldY - el.cy) - el.r);
    return d <= toleranceWorld;
  }
  const p = { x: worldX, y: worldY };
  const segs = segmentsOf(el);
  for (const [a, b] of segs) {
    if (distPointToSegment(p, a, b) <= toleranceWorld) return true;
  }
  return false;
}

/** Bounding-box hit test (used by marquee selection). */
export function intersectsBounds(el, bounds) {
  const b = getBounds(el);
  return !(
    b.maxX < bounds.left ||
    b.minX > bounds.right ||
    b.maxY < bounds.top ||
    b.minY > bounds.bottom
  );
}

// ------------------------------------------------------------------
// Transforms — mutate element geometry in place.
// ------------------------------------------------------------------

/** Translate an element by (dx, dy) in world units. */
export function translateElement(el, dx, dy) {
  switch (el.type) {
    case "line":
    case "rect":
      el.startX += dx; el.startY += dy;
      el.endX += dx; el.endY += dy;
      if (el.corners) el.corners = el.corners.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      break;
    case "circle":
      el.cx += dx; el.cy += dy;
      break;
    case "square":
    case "triangle":
      el.corners = el.corners.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      break;
    case "path":
      el.points = el.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      break;
  }
}

/**
 * Bake a parametric primitive into a polyline path. Used when a
 * non-uniform scale would break the parametric form (e.g. circle ->
 * ellipse, or rect-tool form under rotation). The path approximates
 * curves with enough samples to stay smooth.
 */
export function bakeToPath(el) {
  if (el.type === "path") return el;
  let points;
  switch (el.type) {
    case "line":
      points = [{ x: el.startX, y: el.startY }, { x: el.endX, y: el.endY }];
      break;
    case "rect":
    case "square": {
      const c = getRectCorners(el);
      points = [c[0], c[1], c[2], c[3], { ...c[0] }];
      break;
    }
    case "triangle":
      points = [el.corners[0], el.corners[1], el.corners[2], { ...el.corners[0] }];
      break;
    case "circle": {
      const N = 48;
      points = [];
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        points.push({ x: el.cx + Math.cos(a) * el.r, y: el.cy + Math.sin(a) * el.r });
      }
      break;
    }
    default:
      return el;
  }
  // Mutate into a path while keeping id + style.
  Object.keys(el).forEach((k) => {
    if (k !== "id" && k !== "style" && k !== "type") delete el[k];
  });
  el.type = "path";
  el.points = points;
  return el;
}

function transformPoint(p, ox, oy, cosA, sinA, fx, fy) {
  // Translate to origin, scale, rotate, translate back.
  const tx = (p.x - ox) * fx;
  const ty = (p.y - oy) * fy;
  return {
    x: ox + tx * cosA - ty * sinA,
    y: oy + tx * sinA + ty * cosA,
  };
}

/**
 * Scale an element about origin (ox,oy) by (fx,fy) and rotate by angle
 * (radians). If the scale is non-uniform on a circle, bakes it to a path
 * first so the transform is always representable.
 */
export function transformElement(el, ox, oy, fx, fy, angle = 0) {
  const nonUniform = Math.abs(fx - fy) > 1e-6;
  if (el.type === "circle" && nonUniform) bakeToPath(el);
  if (el.type === "rect" && !el.corners) {
    // Promote rect-tool form to corners so rotation works.
    el.corners = getRectCorners(el);
  }

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  const tp = (p) => transformPoint(p, ox, oy, cosA, sinA, fx, fy);

  switch (el.type) {
    case "line":
    case "rect": {
      const s = tp({ x: el.startX, y: el.startY });
      const e = tp({ x: el.endX, y: el.endY });
      el.startX = s.x; el.startY = s.y;
      el.endX = e.x; el.endY = e.y;
      if (el.corners) el.corners = el.corners.map(tp);
      if (el.w != null) {
        const sz = rectSize(el);
        // Recompute w/h from corners if present, else from endpoints.
        if (el.corners) {
          el.w = Math.hypot(el.corners[1].x - el.corners[0].x, el.corners[1].y - el.corners[0].y);
          el.h = Math.hypot(el.corners[3].x - el.corners[0].x, el.corners[3].y - el.corners[0].y);
        } else {
          el.w = sz.w * fx; el.h = sz.h * fy;
        }
      }
      break;
    }
    case "circle": {
      // Uniform scale (non-uniform already baked to path above).
      const c = tp({ x: el.cx, y: el.cy });
      el.cx = c.x; el.cy = c.y;
      el.r = Math.max(1e-3, el.r * fx);
      break;
    }
    case "square":
    case "triangle":
      el.corners = el.corners.map(tp);
      break;
    case "path":
      el.points = el.points.map(tp);
      break;
  }

  // Square may stop being square after non-uniform scale; demote to rect.
  if (el.type === "square" && nonUniform) {
    el.type = "rect";
    const c = el.corners;
    el.w = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
    el.h = Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y);
  }
}

/** True when an element is too small to commit (filters bare clicks). */
export function isDegenerate(el) {
  switch (el.type) {
    case "line":
      return el.startX === el.endX && el.startY === el.endY;
    case "rect": {
      const { w, h } = rectSize(el);
      return w <= 0 || h <= 0;
    }
    case "square":
      return (el.w || 0) <= 0;
    case "circle":
      return el.r <= 0;
    case "triangle":
      return !el.corners || el.corners.length < 3;
    case "path":
      return el.points.length < 2;
    default:
      return true;
  }
}
