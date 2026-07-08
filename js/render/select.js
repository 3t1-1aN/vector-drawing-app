// render/select.js
// Selection overlay: bounding box, 8 resize handles, and a rotation
// handle. Drawn in SCREEN space so handles stay a fixed pickable size.
// Also exposes handle hit testing used by the select tool.

import { worldToScreen } from "../core/view.js";
import { getBounds } from "../scene/element.js";
import { isDarkBackground } from "../workspace/appearance.js";

const HANDLE_SIZE = 8;       // screen px square edge
const ROT_HANDLE_OFFSET = 22; // screen px above top edge

// Handle ids, in order: corners then edge midpoints.
export const HANDLE_IDS = [
  "nw", "n", "ne", "e", "se", "s", "sw", "w", "rot",
];

/** Screen-space positions of every handle for a world bounds box. */
export function getHandlePositions(view, bounds) {
  const tl = worldToScreen(bounds.minX, bounds.minY);
  const br = worldToScreen(bounds.maxX, bounds.maxY);
  const tr = worldToScreen(bounds.maxX, bounds.minY);
  const bl = worldToScreen(bounds.minX, bounds.maxY);
  const mid = (ax, ay, bx, by) => ({ x: (ax + bx) / 2, y: (ay + by) / 2 });
  return {
    nw: tl, ne: tr, se: br, sw: bl,
    n: mid(tl.x, tl.y, tr.x, tr.y),
    s: mid(bl.x, bl.y, br.x, br.y),
    e: mid(tr.x, tr.y, br.x, br.y),
    w: mid(tl.x, tl.y, bl.x, bl.y),
    rot: { x: (tl.x + tr.x) / 2, y: (tl.y + br.y) / 2 - ROT_HANDLE_OFFSET },
  };
}

/** Which handle (if any) is under the screen point (sx, sy)? */
export function pickHandle(view, bounds, sx, sy) {
  const h = getHandlePositions(view, bounds);
  // Rotation handle is a small circle.
  if (Math.hypot(h.rot.x - sx, h.rot.y - sy) <= HANDLE_SIZE) return "rot";
  for (const id of HANDLE_IDS) {
    if (id === "rot") continue;
    const p = h[id];
    if (
      Math.abs(p.x - sx) <= HANDLE_SIZE &&
      Math.abs(p.y - sy) <= HANDLE_SIZE
    ) {
      return id;
    }
  }
  return null;
}

/** Draw the selection bbox + handles. `bounds` is a world bounds object. */
export function drawSelectionOverlay(ctx, view, bounds) {
  const h = getHandlePositions(view, bounds);
  const left = Math.min(h.nw.x, h.ne.x, h.se.x, h.sw.x);
  const right = Math.max(h.nw.x, h.ne.x, h.se.x, h.sw.x);
  const top = Math.min(h.nw.y, h.ne.y, h.se.y, h.sw.y);
  const bottom = Math.max(h.nw.y, h.ne.y, h.se.y, h.sw.y);

  // Bounding box.
  ctx.strokeStyle = "rgba(255, 220, 120, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.setLineDash([]);

  // Rotation handle stem.
  ctx.beginPath();
  ctx.moveTo((left + right) / 2, top);
  ctx.lineTo(h.rot.x, h.rot.y);
  ctx.stroke();

  // Square resize handles.
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "rgba(255, 220, 120, 1)";
  ctx.lineWidth = 1;
  for (const id of HANDLE_IDS) {
    if (id === "rot") continue;
    const p = h[id];
    ctx.fillRect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.strokeRect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
  }

  // Rotation handle (circle).
  ctx.beginPath();
  ctx.arc(h.rot.x, h.rot.y, HANDLE_SIZE / 2 + 1, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.stroke();
}

/** Draw a marquee selection rectangle in screen space. */
export function drawMarquee(ctx, x0, y0, x1, y1) {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  ctx.fillStyle = "rgba(120, 200, 255, 0.12)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(120, 200, 255, 0.7)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

/** Draw artboard borders in world space (call after applyViewTransform). */
export function drawArtboardsWorld(ctx, view, artboards) {
  for (const a of artboards) {
    ctx.strokeStyle = isDarkBackground() ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 0, 0, 0.3)";
    ctx.lineWidth = 1 / view.zoom;
    ctx.setLineDash([8 / view.zoom, 4 / view.zoom]);
    ctx.strokeRect(a.x, a.y, a.w, a.h);
    ctx.setLineDash([]);
  }
}

/** Draw artboard name labels in screen space. */
export function drawArtboardLabels(ctx, view, artboards) {
  for (const a of artboards) {
    const tl = worldToScreen(a.x, a.y);
    ctx.fillStyle = isDarkBackground() ? "rgba(255, 255, 255, 0.6)" : "rgba(0, 0, 0, 0.55)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "bottom";
    ctx.textAlign = "left";
    ctx.fillText(a.name, tl.x + 6, tl.y - 4);
  }
}

/** @deprecated use drawArtboardsWorld + drawArtboardLabels */
export function drawArtboards(ctx, view, artboards) {
  drawArtboardLabels(ctx, view, artboards);
}
