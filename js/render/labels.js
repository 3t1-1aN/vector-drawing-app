// render/labels.js
// CAD measurement labels: per-type measurement text, anchor points, a
// reusable label pill, persistent committed labels, the live label, and
// the on-screen scale bar. Drawn in SCREEN space so the font stays a
// fixed pixel size and never rotates with the view transform.

import { worldToScreen } from "../core/view.js";
import { lineLength, rectSize, getRectCorners } from "../scene/element.js";
import { edgeLengths } from "../precision/recognize.js";
import { formatLength, niceScaleBarLength, scaleSettings } from "../precision/scale.js";
import { isDarkBackground } from "../workspace/appearance.js";
import { TYPE_COLOR, typeFont, useSheetText } from "./text-style.js";

const LABEL_FONT = typeFont(13);
const LABEL_COLOR = TYPE_COLOR;
const LABEL_RECOGNIZED_COLOR = "#2f6b45";
const LABEL_OFFSET_PX = 14;
const LABEL_MIN_SIZE_PX = 24;

function centroidOf(points) {
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  return { x: sx / points.length, y: sy / points.length };
}

/** World-space anchor point for an element's measurement label. */
export function getElementAnchor(el) {
  switch (el.type) {
    case "line":
      return { x: (el.startX + el.endX) / 2, y: (el.startY + el.endY) / 2 };
    case "circle":
      return { x: el.cx, y: el.cy };
    case "rect":
    case "square":
      return centroidOf(getRectCorners(el));
    case "triangle":
      return centroidOf(el.corners);
    default:
      return null;
  }
}

/** Human-readable measurement string for an element; null if none. */
export function getElementMeasurement(el) {
  switch (el.type) {
    case "line":
      return formatLength(lineLength(el));
    case "circle":
      return `Ø ${formatLength(el.r * 2)}`;
    case "square": {
      const { w } = rectSize(el);
      return `side ${formatLength(w)}`;
    }
    case "rect": {
      const { w, h } = rectSize(el);
      return `${formatLength(w)} × ${formatLength(h)}`;
    }
    case "triangle": {
      const s = el.sides || edgeLengths(el.corners);
      return `${formatLength(s[0])} / ${formatLength(s[1])} / ${formatLength(s[2])}`;
    }
    default:
      return null;
  }
}

/** Approximate on-screen size in px (for hiding tiny labels when zoomed out). */
function getElementScreenSize(el, view) {
  switch (el.type) {
    case "line": return lineLength(el) * view.zoom;
    case "circle": return el.r * 2 * view.zoom;
    case "square":
    case "rect": {
      const { w, h } = rectSize(el);
      return Math.max(w, h) * view.zoom;
    }
    case "triangle": {
      const s = el.sides || edgeLengths(el.corners);
      return Math.max(s[0], s[1], s[2]) * view.zoom;
    }
    default: return 0;
  }
}

/** Draw one measurement the way the sheet sets a typewriter note. */
export function drawLabelBox(ctx, text, sx, sy, color) {
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "center";
  const restore = useSheetText(ctx, { typewriter: true, px: 13 });
  if (color && color !== LABEL_COLOR) ctx.fillStyle = color;
  ctx.fillText(text, sx, sy - LABEL_OFFSET_PX);
  restore();
  ctx.restore();
}

/** Persistent CAD labels for every committed, measurable element. */
export function drawCommittedMeasurements(ctx, scene, view, liveElement) {
  if (scaleSettings.dimensionMode !== "labels") return;
  for (const el of scene.elements) {
    if (el === liveElement) continue;
    const text = getElementMeasurement(el);
    if (!text) continue;
    if (getElementScreenSize(el, view) < LABEL_MIN_SIZE_PX) continue;
    const a = getElementAnchor(el);
    if (!a) continue;
    const s = worldToScreen(a.x, a.y);
    drawLabelBox(ctx, text, s.x, s.y, LABEL_COLOR);
  }
}

/** Live measurement label for the element currently being drawn. */
export function drawMeasurementLabel(ctx, preview, view) {
  if (!preview || !preview.element) return;
  const el = preview.element;
  const text = getElementMeasurement(el);
  if (!text) return;
  if (el.type === "line" && lineLength(el) === 0) return;
  const a = getElementAnchor(el);
  if (!a) return;
  const s = worldToScreen(a.x, a.y);
  drawLabelBox(ctx, text, s.x, s.y, preview.recognized ? LABEL_RECOGNIZED_COLOR : LABEL_COLOR);
}

/**
 * Scale bar in the bottom-left corner: a round real-world length with a
 * matching on-screen ruler line. Drawn in screen space.
 */
export function drawScaleBar(ctx, view) {
  const targetPx = 140;
  const { world, label } = niceScaleBarLength(targetPx, view.zoom);
  const screenLen = world * view.zoom;
  const x = 24;
  const y = window.innerHeight - 28;

  const dark = isDarkBackground();
  ctx.strokeStyle = dark ? "rgba(230, 230, 235, 0.85)" : "rgba(45, 45, 55, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + screenLen, y);
  // end ticks
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y + 5);
  ctx.moveTo(x + screenLen, y - 5);
  ctx.lineTo(x + screenLen, y + 5);
  ctx.stroke();

  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  const restore = useSheetText(ctx, { typewriter: true, px: 13 });
  if (dark) ctx.fillStyle = "#e8e5dc";
  ctx.fillText(label, x, y - 8);
  restore();
}

export { LABEL_COLOR };
