// render/dimensions.js
// CAD-style dimension annotations: extension lines, dimension lines,
// arrowheads, and measurement text. Drawn in screen space so labels stay
// crisp and upright. Replaces centroid pill labels when dimensions are on.

import { worldToScreen } from "../core/view.js";
import { lineLength, rectSize, getRectCorners } from "../scene/element.js";
import { formatLength } from "../precision/scale.js";
import { isDarkBackground } from "../workspace/appearance.js";

// Dimension ink auto-contrasts with the paper.
function DIM_COLOR() {
  return isDarkBackground() ? "rgba(180, 220, 255, 0.9)" : "rgba(40, 90, 170, 0.9)";
}
function EXT_COLOR() {
  return isDarkBackground() ? "rgba(180, 220, 255, 0.45)" : "rgba(40, 90, 170, 0.45)";
}
const FONT = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const OFFSET_PX = 28;
const ARROW = 6;
const MIN_SCREEN_PX = 24;

function toScreen(x, y) {
  return worldToScreen(x, y);
}

function drawArrow(ctx, x1, y1, x2, y2) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 + ARROW * Math.cos(ang + 2.6), y1 + ARROW * Math.sin(ang + 2.6));
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 + ARROW * Math.cos(ang - 2.6), y1 + ARROW * Math.sin(ang - 2.6));
  ctx.stroke();
}

/** Aligned dimension between two world points, offset perpendicular in screen space. */
function drawAlignedDim(ctx, ax, ay, bx, by, label, offsetSign = 1) {
  const a = toScreen(ax, ay);
  const b = toScreen(bx, by);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < MIN_SCREEN_PX) return;

  const nx = (-(b.y - a.y) / len) * OFFSET_PX * offsetSign;
  const ny = ((b.x - a.x) / len) * OFFSET_PX * offsetSign;
  const a2 = { x: a.x + nx, y: a.y + ny };
  const b2 = { x: b.x + nx, y: b.y + ny };

  ctx.strokeStyle = EXT_COLOR();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(a2.x, a2.y);
  ctx.moveTo(b.x, b.y); ctx.lineTo(b2.x, b2.y);
  ctx.stroke();

  ctx.strokeStyle = DIM_COLOR();
  ctx.beginPath();
  ctx.moveTo(a2.x, a2.y); ctx.lineTo(b2.x, b2.y);
  ctx.stroke();
  drawArrow(ctx, a2.x, a2.y, b2.x, b2.y);
  drawArrow(ctx, b2.x, b2.y, a2.x, a2.y);

  ctx.font = FONT;
  ctx.fillStyle = DIM_COLOR();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, (a2.x + b2.x) / 2, (a2.y + b2.y) / 2 - 4);
}

/** Diameter dimension for a circle (horizontal). */
function drawDiameterDim(ctx, cx, cy, r, label, zoom) {
  if (r * 2 * zoom < MIN_SCREEN_PX) return;
  const left = toScreen(cx - r, cy);
  const right = toScreen(cx + r, cy);
  const y = left.y - OFFSET_PX;
  ctx.strokeStyle = EXT_COLOR();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left.x, left.y); ctx.lineTo(left.x, y);
  ctx.moveTo(right.x, right.y); ctx.lineTo(right.x, y);
  ctx.stroke();
  ctx.strokeStyle = DIM_COLOR();
  ctx.beginPath();
  ctx.moveTo(left.x, y); ctx.lineTo(right.x, y);
  ctx.stroke();
  drawArrow(ctx, left.x, y, right.x, y);
  drawArrow(ctx, right.x, y, left.x, y);
  ctx.font = FONT;
  ctx.fillStyle = DIM_COLOR();
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, (left.x + right.x) / 2, y - 4);
}

/** Draw CAD annotations for one element. */
function drawElementDims(ctx, el, view) {
  switch (el.type) {
    case "line":
      drawAlignedDim(ctx, el.startX, el.startY, el.endX, el.endY, formatLength(lineLength(el)));
      break;
    case "circle":
      drawDiameterDim(ctx, el.cx, el.cy, el.r, `Ø ${formatLength(el.r * 2)}`, view.zoom);
      break;
    case "square": {
      const c = getRectCorners(el);
      const { w } = rectSize(el);
      drawAlignedDim(ctx, c[0].x, c[0].y, c[1].x, c[1].y, formatLength(w), 1);
      break;
    }
    case "rect": {
      const c = getRectCorners(el);
      const { w, h } = rectSize(el);
      drawAlignedDim(ctx, c[0].x, c[0].y, c[1].x, c[1].y, formatLength(w), 1);
      drawAlignedDim(ctx, c[1].x, c[1].y, c[2].x, c[2].y, formatLength(h), 1);
      break;
    }
    case "triangle": {
      const c = el.corners;
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        const len = Math.hypot(c[j].x - c[i].x, c[j].y - c[i].y);
        drawAlignedDim(ctx, c[i].x, c[i].y, c[j].x, c[j].y, formatLength(len), i % 2 ? -1 : 1);
      }
      break;
    }
  }
}

/** Draw CAD dimension annotations for all committed elements. */
export function drawCadDimensions(ctx, scene, view, liveElement) {
  for (const el of scene.elements) {
    if (el === liveElement) continue;
    drawElementDims(ctx, el, view);
  }
}

/** Live CAD dimension for the in-progress element. */
export function drawLiveCadDimension(ctx, preview, view) {
  if (!preview || !preview.element) return;
  const el = preview.element;
  if (el.type === "line" && lineLength(el) === 0) return;
  drawElementDims(ctx, el, view);
}
