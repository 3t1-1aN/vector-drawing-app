// math/raster.js
// Rasterize a world-space stroke cluster to a tight PNG for recognition.
// Never ships the full canvas — only the region.

import { getBounds } from "../scene/element.js";

const MAX_EDGE = 384;
const PAD_PX = 16;

/**
 * @param {object[]} elements path elements
 * @returns {{ canvas: HTMLCanvasElement, dataUrl: string } | null}
 */
export function rasterizeRegion(elements) {
  const paths = elements.filter((el) => el.type === "path" && el.points?.length);
  if (!paths.length) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of paths) {
    const b = getBounds(el);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  const worldW = Math.max(1, maxX - minX);
  const worldH = Math.max(1, maxY - minY);
  const scale = Math.min(MAX_EDGE / worldW, MAX_EDGE / worldH, 8);
  const w = Math.ceil(worldW * scale) + PAD_PX * 2;
  const h = Math.ceil(worldH * scale) + PAD_PX * 2;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000000";

  for (const el of paths) {
    const pts = el.points;
    const sw = Math.max(1.5, (el.style?.strokeWidth || 2) * scale * 0.85);
    ctx.lineWidth = sw;
    ctx.beginPath();
    ctx.moveTo(
      (pts[0].x - minX) * scale + PAD_PX,
      (pts[0].y - minY) * scale + PAD_PX
    );
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(
        (pts[i].x - minX) * scale + PAD_PX,
        (pts[i].y - minY) * scale + PAD_PX
      );
    }
    ctx.stroke();
  }

  return { canvas, dataUrl: canvas.toDataURL("image/png") };
}
