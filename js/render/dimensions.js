// render/dimensions.js
// Dimension annotations: extension lines, a dimension line with slash ticks,
// and upright measurement text. Drawn in screen space so labels stay crisp.
// The line breaks around a horizontal label; a vertical dimension keeps its
// label beside the line. Replaces centroid pills when dimensions are on.

import { worldToScreen } from "../core/view.js";
import { lineLength, rectSize, getRectCorners } from "../scene/element.js";
import { formatLength } from "../precision/scale.js";
import { getBackgroundBaseColor, isDarkBackground } from "../workspace/appearance.js";
import { INK_COLOR, inkFont, useSheetText } from "./text-style.js";

function DIM_COLOR() {
  return isDarkBackground() ? "rgba(232, 229, 220, 0.92)" : INK_COLOR;
}
function EXT_COLOR() {
  return isDarkBackground() ? "rgba(232, 229, 220, 0.42)" : "rgba(46, 46, 46, 0.45)";
}
function PAPER() {
  return getBackgroundBaseColor() || (isDarkBackground() ? "#1e1e22" : "#f5f0e8");
}
const FONT_PX = 13;
const OFFSET_PX = 18;
const GAP_PX = 6;
const OVERSHOOT_PX = 5;
const MIN_SCREEN_PX = 28;

function toScreen(x, y) {
  return worldToScreen(x, y);
}

/** A short slash through the end of a dimension line. Same direction at both ends. */
function drawTick(ctx, p) {
  const s = 3.6;
  ctx.beginPath();
  ctx.moveTo(p.x - s, p.y + s);
  ctx.lineTo(p.x + s, p.y - s);
  ctx.stroke();
}

/**
 * Dimension between two screen points.
 * `away` is a screen point the line should move away from (the shape's
 * center). Without it the offset stays on the left of a→b.
 */
function drawScreenDim(ctx, a, b, label, away) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < MIN_SCREEN_PX) return;

  let sign = 1;
  const nx0 = -(b.y - a.y);
  const ny0 = b.x - a.x;
  if (away) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dot = nx0 * (away.x - mx) + ny0 * (away.y - my);
    if (dot > 0) sign = -1;
  }
  const nx = (nx0 / len) * sign;
  const ny = (ny0 / len) * sign;

  const a2 = { x: a.x + nx * OFFSET_PX, y: a.y + ny * OFFSET_PX };
  const b2 = { x: b.x + nx * OFFSET_PX, y: b.y + ny * OFFSET_PX };
  const start = (p) => ({ x: p.x + nx * GAP_PX, y: p.y + ny * GAP_PX });
  const past = (p) => ({ x: p.x + nx * OVERSHOOT_PX, y: p.y + ny * OVERSHOOT_PX });

  ctx.save();
  ctx.setLineDash([]);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.strokeStyle = EXT_COLOR();
  ctx.lineWidth = 1;
  ctx.beginPath();
  const ea0 = start(a);
  const eb0 = start(b);
  const ea1 = past(a2);
  const eb1 = past(b2);
  ctx.moveTo(ea0.x, ea0.y); ctx.lineTo(ea1.x, ea1.y);
  ctx.moveTo(eb0.x, eb0.y); ctx.lineTo(eb1.x, eb1.y);
  ctx.stroke();

  ctx.font = inkFont(FONT_PX, 400);
  const textW = ctx.measureText(label).width;
  const alongX = (b2.x - a2.x) / len;
  const alongY = (b2.y - a2.y) / len;
  const horizontal = Math.abs(b2.x - a2.x) >= Math.abs(b2.y - a2.y);
  const mx = (a2.x + b2.x) / 2;
  const my = (a2.y + b2.y) / 2;
  const breakLine = horizontal && len > textW + 16;
  const gap = textW / 2 + 6;

  ctx.strokeStyle = DIM_COLOR();
  ctx.beginPath();
  if (breakLine) {
    ctx.moveTo(a2.x, a2.y);
    ctx.lineTo(mx - alongX * gap, my - alongY * gap);
    ctx.moveTo(mx + alongX * gap, my + alongY * gap);
    ctx.lineTo(b2.x, b2.y);
  } else {
    ctx.moveTo(a2.x, a2.y);
    ctx.lineTo(b2.x, b2.y);
  }
  ctx.stroke();
  drawTick(ctx, a2);
  drawTick(ctx, b2);

  // Horizontal labels stay readable. On a vertical dimension they sit
  // outside the line instead of being turned on their side.
  let tx = mx;
  let ty = my;
  if (!breakLine && horizontal) ty = my - 12;
  if (!horizontal) {
    tx = mx + nx * (textW / 2 + 8);
    ty = my;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 4;
  ctx.strokeStyle = PAPER();
  ctx.strokeText(label, tx, ty);
  const restoreFont = useSheetText(ctx, { px: FONT_PX, weight: 400 });
  ctx.fillText(label, tx, ty);
  restoreFont();
  ctx.restore();
}

/** Aligned dimension between two world points, offset away from `away`. */
function drawAlignedDim(ctx, ax, ay, bx, by, label, away) {
  const awayScreen = away ? toScreen(away.x, away.y) : null;
  drawScreenDim(ctx, toScreen(ax, ay), toScreen(bx, by), label, awayScreen);
}

/** Diameter dimension for a circle, sitting above it. */
function drawDiameterDim(ctx, cx, cy, r, label, zoom) {
  if (r * 2 * zoom < MIN_SCREEN_PX) return;
  const top = toScreen(cx, cy - r);
  const left = toScreen(cx - r, cy);
  const right = toScreen(cx + r, cy);
  drawScreenDim(
    ctx,
    { x: left.x, y: top.y },
    { x: right.x, y: top.y },
    label,
    toScreen(cx, cy),
  );
}

/** Draw CAD annotations for one element. */
function interiorOf(el) {
  switch (el.type) {
    case "circle":
      return { x: el.cx, y: el.cy };
    case "rect":
    case "square": {
      const c = getRectCorners(el);
      return { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 };
    }
    case "triangle": {
      const c = el.corners;
      return {
        x: (c[0].x + c[1].x + c[2].x) / 3,
        y: (c[0].y + c[1].y + c[2].y) / 3,
      };
    }
    default:
      return null;
  }
}

function drawElementDims(ctx, el, view) {
  const away = interiorOf(el);
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
      drawAlignedDim(ctx, c[0].x, c[0].y, c[1].x, c[1].y, formatLength(w), away);
      break;
    }
    case "rect": {
      const c = getRectCorners(el);
      const { w, h } = rectSize(el);
      drawAlignedDim(ctx, c[0].x, c[0].y, c[1].x, c[1].y, formatLength(w), away);
      drawAlignedDim(ctx, c[1].x, c[1].y, c[2].x, c[2].y, formatLength(h), away);
      break;
    }
    case "triangle": {
      const c = el.corners;
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3;
        const len = Math.hypot(c[j].x - c[i].x, c[j].y - c[i].y);
        drawAlignedDim(ctx, c[i].x, c[i].y, c[j].x, c[j].y, formatLength(len), away);
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
