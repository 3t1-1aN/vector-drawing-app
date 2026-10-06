// render/elements.js
// Stroke a single element + draw the whole scene (committed + live preview).
// Must be called after the world view transform is applied so coordinates
// are interpreted in world space. Each element is rendered by the brush
// engine using the preset named on element.style.medium.

import { getBounds, getRectCorners } from "../scene/element.js";
import { getVisibleWorldBounds } from "../core/view.js";
import { isDarkBackground } from "../workspace/appearance.js";
import { beginBrushFrame, drawBrushElement } from "../brush/cache.js";
import { drawTypewritten } from "./type-text.js";
import { labelFrame } from "./text-frame.js";

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
 * Draw committed elements, then the live preview. The stage itself does not
 * use this — it composites committed ink once and only calls
 * `drawLivePreview` — but the eyedropper replays the scene onto its own
 * canvas and needs the full pass.
 *
 * `preview` is { element, recognized } | null. `doomed` is a set of ids the
 * slice swipe has claimed; those draw greyed out so the whole object, not
 * the crossed bit, reads as about to go.
 */
export function drawScene(ctx, scene, view, preview, doomed) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  beginBrushFrame();
  drawCommitted(ctx, scene, view, doomed);
  drawLivePreview(ctx, view, preview);
}

/** Committed elements, each with its own brush. World transform must be set. */
export function drawCommitted(ctx, scene, view, doomed) {
  // Off-screen strokes cost nothing to skip and would otherwise each take a
  // rasterise slot on the way back into view.
  const visible = getVisibleWorldBounds();

  for (const el of scene.elements) {
    const selected = scene.isSelected(el.id);
    const claimed = doomed && doomed.has(el.id);
    if (!selected && !claimed && !onScreen(el, visible, view)) continue;
    // Notes are drawn after the ink bitmap. The typewriter filter is an SVG
    // filter in the page, and it does not survive the offscreen ink canvas.
    if (el.type === "text") continue;
    if (claimed) {
      // alphaScale, not globalAlpha: the brush blit replaces globalAlpha
      // with its own, so the dimming has to travel in with the draw.
      ctx.save();
      ctx.filter = "grayscale(1)";
      drawBrushElement(ctx, el, view, { alphaScale: 0.45 });
      ctx.restore();
    } else if (selected) {
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
      drawBrushElement(ctx, el, view);
    }
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

/**
 * The in-flight stroke. Kept off the committed-ink bitmap because it changes
 * every pointer sample.
 */
export function drawLivePreview(ctx, view, preview) {
  if (!preview || !preview.element) return;
  if (preview.element.type === "text") {
    drawTypewritten(ctx, preview.element, { caret: !!preview.caret, frame: preview.frame || null });
    return;
  }
  if (preview.recognized) {
    ctx.strokeStyle = recognizedColor();
    ctx.lineWidth = (preview.element.style?.strokeWidth || 2) / view.zoom;
    ctx.globalAlpha = 0.9;
    ctx.setLineDash([]);
    ctx.beginPath();
    traceElement(ctx, preview.element);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  // The in-flight stroke changes every frame, so it renders straight
  // through rather than churning a cache entry per frame.
  const pencil = (preview.element.style?.medium || "pen") === "pencil";
  drawBrushElement(ctx, preview.element, view, { alphaScale: pencil ? 1 : 0.9, cache: false });
}

/**
 * Committed notes and centered labels. Called on the on-screen canvas, after
 * the ink bitmap, so the ribbon filter still resolves.
 */
export function drawTexts(ctx, scene, view, preview, doomed) {
  const skipText = preview?.editingId || null;
  const skipHost = preview?.hostId || null;
  const visible = getVisibleWorldBounds();
  for (const el of scene.elements) {
    if (el.type === "text") {
      if (el.id === skipText) continue;
      if (!onScreen(el, visible, view) && !scene.isSelected(el.id)) continue;
      const claimed = doomed && doomed.has(el.id);
      ctx.save();
      if (claimed) ctx.globalAlpha = 0.45;
      drawTypewritten(ctx, el);
      ctx.restore();
      if (scene.isSelected(el.id) || claimed) {
        const b = getBounds(el);
        ctx.save();
        ctx.strokeStyle = claimed ? "rgba(120, 120, 120, 0.7)" : SELECTED_COLOR;
        ctx.lineWidth = 1 / view.zoom;
        ctx.setLineDash([]);
        ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
        ctx.restore();
      }
      continue;
    }
    if (!el.label || el.id === skipHost || !el.label.text) continue;
    const frame = labelFrame(el);
    if (!frame) continue;
    ctx.save();
    if (doomed && doomed.has(el.id)) ctx.globalAlpha = 0.45;
    drawTypewritten(ctx, { ...el.label, style: el.style }, { frame });
    ctx.restore();
  }
}

/** Bounding-box overlap test, padded for the widest the brush can spread. */
function onScreen(el, visible, view) {
  const b = getBounds(el);
  const pad = ((el.style?.strokeWidth || 2) * 3 + 8) / view.zoom;
  return !(
    b.maxX + pad < visible.left ||
    b.minX - pad > visible.right ||
    b.maxY + pad < visible.top ||
    b.minY - pad > visible.bottom
  );
}

