// render/guides.js
// Interactive shape guides while drawing: ghost outlines for line, rect,
// and circle tools, plus an angle readout for the line tool. Drawn in
// world space (call after applyViewTransform).

import { lineLength } from "../scene/element.js";
import { useSheetText } from "./text-style.js";

const GUIDE_COLOR = "rgba(160, 200, 255, 0.35)";
const ANGLE_COLOR = "rgba(200, 220, 255, 0.7)";

/**
 * Draw ghost guides for the active preview element. `preview` is
 * { element, recognized } from the draw tool.
 */
export function drawShapeGuides(ctx, view, preview) {
  if (!preview || !preview.element) return;
  const el = preview.element;
  ctx.save();
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = 1 / view.zoom;
  ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);

  switch (el.type) {
    case "line": {
      const len = lineLength(el);
      if (len === 0) break;
      // Ghost axis-aligned bounding guides from start point.
      ctx.beginPath();
      ctx.moveTo(el.startX, el.startY);
      ctx.lineTo(el.endX, el.startY);
      ctx.moveTo(el.endX, el.startY);
      ctx.lineTo(el.endX, el.endY);
      ctx.stroke();

      // Angle arc at start.
      const ang = Math.atan2(el.endY - el.startY, el.endX - el.startX);
      const r = Math.min(40 / view.zoom, len * 0.3);
      ctx.setLineDash([]);
      ctx.strokeStyle = ANGLE_COLOR;
      ctx.beginPath();
      ctx.arc(el.startX, el.startY, r, 0, ang, ang < 0);
      ctx.stroke();
      const deg = ((ang * 180) / Math.PI).toFixed(0);
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const restore = useSheetText(ctx, { typewriter: true, px: 13 / view.zoom });
      ctx.fillText(`${deg}°`, el.startX + r * 0.6, el.startY - 4 / view.zoom);
      restore();
      break;
    }
    case "rect": {
      const x1 = Math.min(el.startX, el.endX);
      const y1 = Math.min(el.startY, el.endY);
      const x2 = Math.max(el.startX, el.endX);
      const y2 = Math.max(el.startY, el.endY);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      // Ghost square guide (max side).
      const side = Math.max(x2 - x1, y2 - y1);
      ctx.strokeRect(x1, y1, side, side);
      break;
    }
    case "circle": {
      if (el.r <= 0) break;
      // Ghost square inscribed in the drag radius.
      ctx.strokeRect(el.cx - el.r, el.cy - el.r, el.r * 2, el.r * 2);
      // Ghost ellipse at current radius.
      ctx.beginPath();
      ctx.ellipse(el.cx, el.cy, el.r, el.r, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}
