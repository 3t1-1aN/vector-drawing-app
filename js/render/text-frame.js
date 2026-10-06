// render/text-frame.js
// The box a label is centered in. Rects and squares keep the label aligned
// with the shape, including after a rotation. Circles and triangles keep it
// upright and pulled in so the lines sit inside the outline.

import { getRectCorners } from "../scene/element.js";

const PAD = 12;

function boxOf(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * { cx, cy, width, height, angle } in world space, or null when the element
 * cannot hold a centered label. `width` is the wrap measure.
 */
export function labelFrame(el) {
  if (!el) return null;
  if (el.type === "circle") {
    const side = Math.max(12, el.r * Math.SQRT2 - PAD);
    return { cx: el.cx, cy: el.cy, width: side, height: side, angle: 0 };
  }
  if (el.type === "rect" || el.type === "square") {
    const c = getRectCorners(el);
    const width = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
    const height = Math.hypot(c[3].x - c[0].x, c[3].y - c[0].y);
    const padX = Math.min(PAD, width * 0.14);
    const padY = Math.min(PAD, height * 0.14);
    return {
      cx: (c[0].x + c[2].x) / 2,
      cy: (c[0].y + c[2].y) / 2,
      width: Math.max(12, width - padX * 2),
      height: Math.max(12, height - padY * 2),
      angle: Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x),
    };
  }
  if (el.type === "triangle" && el.corners?.length >= 3) {
    const c = el.corners;
    const b = boxOf(c);
    return {
      cx: (c[0].x + c[1].x + c[2].x) / 3,
      cy: (c[0].y + c[1].y + c[2].y) / 3,
      width: Math.max(12, (b.maxX - b.minX) * 0.62),
      height: Math.max(12, (b.maxY - b.minY) * 0.46),
      angle: 0,
    };
  }
  if (el.type === "path" && el.label && el.points?.length >= 2) {
    const b = boxOf(el.points);
    return {
      cx: (b.minX + b.maxX) / 2,
      cy: (b.minY + b.maxY) / 2,
      width: Math.max(12, (b.maxX - b.minX) * 0.82),
      height: Math.max(12, (b.maxY - b.minY) * 0.72),
      angle: 0,
    };
  }
  return null;
}
