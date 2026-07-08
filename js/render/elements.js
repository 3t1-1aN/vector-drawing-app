// render/elements.js
// Stroke a single element + draw the whole scene (committed + live preview).
// Must be called after the world view transform is applied so coordinates
// are interpreted in world space. Each element is drawn with its selected
// medium (pen / marker / pencil / chalk) via brush/mediums.js.

import { getRectCorners } from "../scene/element.js";
import { isDarkBackground } from "../workspace/appearance.js";
import { strokeMedium } from "../brush/mediums.js";

const SELECTED_COLOR = "rgba(255, 170, 40, 0.95)";

function recognizedColor() {
  return isDarkBackground() ? "rgba(140, 255, 170, 0.9)" : "rgba(20, 150, 80, 0.9)";
}

/** Add one element's crisp outline to the current path (caller sets style). */
export function traceElement(ctx, el) {
  switch (el.type) {
    case "line":
      ctx.moveTo(el.startX, el.startY);
      ctx.lineTo(el.endX, el.endY);
      break;
    case "rect":
    case "square": {
      const c = getRectCorners(el);
      ctx.moveTo(c[0].x, c[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y);
      ctx.closePath();
      break;
    }
    case "circle":
      ctx.moveTo(el.cx + el.r, el.cy);
      ctx.arc(el.cx, el.cy, el.r, 0, Math.PI * 2);
      break;
    case "triangle": {
      const c = el.corners;
      ctx.moveTo(c[0].x, c[0].y);
      ctx.lineTo(c[1].x, c[1].y);
      ctx.lineTo(c[2].x, c[2].y);
      ctx.closePath();
      break;
    }
    case "path":
      if (el.points.length === 0) break;
      ctx.moveTo(el.points[0].x, el.points[0].y);
      for (let i = 1; i < el.points.length; i++) {
        ctx.lineTo(el.points[i].x, el.points[i].y);
      }
      break;
  }
}

/**
 * Draw all committed elements, then the live preview (if any), then the
 * selected-element highlight. `preview` is { element, recognized } | null.
 */
export function drawScene(ctx, scene, view, preview) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Committed elements — each rendered with its own medium.
  for (const el of scene.elements) {
    const selected = scene.isSelected(el.id);
    if (selected) {
      // Selection highlight is a plain solid outline so handles stay readable
      // regardless of the element's medium texture.
      ctx.strokeStyle = SELECTED_COLOR;
      ctx.lineWidth = Math.max(el.style.strokeWidth, 2) / view.zoom;
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      traceElement(ctx, el);
      ctx.stroke();
    } else {
      strokeMedium(ctx, el, view);
    }
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // Live preview: drawn with the element's own medium so it is WYSIWYG;
  // recognized shapes flash green until committed.
  if (preview && preview.element) {
    if (preview.recognized) {
      ctx.strokeStyle = recognizedColor();
      ctx.lineWidth = (preview.element.style?.strokeWidth || 2) / view.zoom;
      ctx.globalAlpha = 0.9;
      ctx.setLineDash([]);
      ctx.beginPath();
      traceElement(ctx, preview.element);
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      strokeMedium(ctx, preview.element, view, { alphaScale: 0.85 });
    }
  }
}

