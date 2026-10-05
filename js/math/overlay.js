// math/overlay.js
// Quiet screen-space result bubbles — twin of render/labels.js.
// Never draws over ink as a replacement; only augments.

import { worldToScreen } from "../core/view.js";

const FONT = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const FG = "rgba(220, 230, 240, 0.92)";
const BG = "rgba(12, 14, 18, 0.55)";
const CHIP_FG = "rgba(170, 210, 255, 0.95)";
const PENDING = "rgba(200, 200, 210, 0.45)";
const PAD_X = 7;
const PAD_Y = 4;
const OFFSET_Y = 10;
const MIN_SCREEN = 28;

/**
 * @returns {{regionId:string, action:string, x:number,y:number,w:number,h:number}[]}
 */
export function drawMathOverlays(ctx, store, view) {
  const hits = [];
  for (const region of store.regions) {
    const more = drawRegion(ctx, region, view);
    if (more) hits.push(...more);
  }
  return hits;
}

function drawRegion(ctx, region, view) {
  const b = region.bounds;
  const tl = worldToScreen(b.minX, b.minY);
  const br = worldToScreen(b.maxX, b.maxY);
  const screenW = Math.abs(br.x - tl.x);
  const screenH = Math.abs(br.y - tl.y);
  if (Math.max(screenW, screenH) < MIN_SCREEN) return null;

  const anchorX = Math.max(tl.x, br.x);
  const anchorY = Math.max(tl.y, br.y) + OFFSET_Y;
  const hits = [];

  if (region.status === "pending") {
    drawPill(ctx, anchorX, anchorY, "·", PENDING);
    return hits;
  }

  if (region.status !== "ready" || !region.overlay) return hits;

  let x = anchorX;
  let y = anchorY;

  if (region.overlay.primary) {
    const label = region.kind === "equation"
      ? `↓  ${region.overlay.primary}`
      : region.kind === "arithmetic"
        ? `= ${region.overlay.primary}`
        : region.overlay.primary;
    const box = drawPill(ctx, x, y, label, FG);
    y += box.h + 4;
  }

  for (const action of region.overlay.actions || []) {
    const text = action === "graph" ? "Graph" : action;
    const box = drawChip(ctx, x, y, text);
    hits.push({
      regionId: region.id,
      action,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
    });
    y += box.h + 4;
  }
  return hits;
}

function drawPill(ctx, rightX, topY, text, color) {
  ctx.font = FONT;
  const tw = ctx.measureText(text).width;
  const w = tw + PAD_X * 2;
  const h = 11 + PAD_Y * 2;
  const x = rightX - w;
  const y = topY;
  ctx.fillStyle = BG;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + PAD_X, y + h / 2 + 0.5);
  return { x, y, w, h };
}

function drawChip(ctx, rightX, topY, text) {
  ctx.font = FONT;
  const label = `[ ${text} ]`;
  const tw = ctx.measureText(label).width;
  const w = tw + PAD_X * 2;
  const h = 11 + PAD_Y * 2;
  const x = rightX - w;
  const y = topY;
  ctx.fillStyle = "rgba(40, 70, 110, 0.45)";
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(140, 180, 230, 0.35)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 6);
  ctx.stroke();
  ctx.fillStyle = CHIP_FG;
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + PAD_X, y + h / 2 + 0.5);
  return { x, y, w, h };
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function hitOverlayAction(hits, sx, sy) {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (sx >= h.x && sx <= h.x + h.w && sy >= h.y && sy <= h.y + h.h) return h;
  }
  return null;
}
