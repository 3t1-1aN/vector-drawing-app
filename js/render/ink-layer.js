// render/ink-layer.js
// Composites every committed stroke into one viewport-sized bitmap.
//
// The render loop is continuous. A brush cache already turns each stroke
// into a blit, but hundreds of blits per frame still crowd out pointer
// events, and that is the lag that grows as the page fills up. While the
// view and the ink are unchanged, the whole page is a single drawImage.
// Panning, zooming, or an edit rebuilds the bitmap; unchanged strokes reuse
// the brush cache, so a rebuild does not re-rasterise the page.

import { applyViewTransform } from "../core/canvas.js";
import { beginBrushFrame } from "../brush/cache.js";
import { drawCommitted } from "./elements.js";
import { inkSceneRev } from "./ink-rev.js";
import { appearance } from "../workspace/appearance.js";
import { isEngineering } from "../workspace/mode.js";

let layer = null;
let layerCtx = null;
let key = "";
let mode = "rebuild";

function mixStr(h, s) {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x9e3779b1) | 0;
  return h;
}

/** Selection outlines and slice-doomed greying are not part of inkSceneRev. */
function sheetKey(scene) {
  const a = appearance;
  let h = 0;
  const boards = scene.artboards || [];
  for (const b of boards) {
    h = Math.imul(h ^ ((b.x * 10) | 0), 0x9e3779b1) | 0;
    h = Math.imul(h ^ ((b.y * 10) | 0), 0x9e3779b1) | 0;
    h = Math.imul(h ^ ((b.w * 10) | 0), 0x9e3779b1) | 0;
    h = Math.imul(h ^ ((b.h * 10) | 0), 0x9e3779b1) | 0;
  }
  return [
    a.background, a.backgroundColor, a.paperTexture, a.gridVisible, a.gridType,
    a.gridOpacity, a.gridColor, isEngineering() ? 1 : 0, boards.length, h,
  ].join("|");
}

function overlayKey(scene, doomed) {
  let h = scene.selected.size;
  for (const id of scene.selected) h = mixStr(h, id);
  if (doomed && doomed.size) {
    h = Math.imul(h ^ (doomed.size + 1), 0x9e3779b1) | 0;
    for (const id of doomed) h = mixStr(h, id);
  }
  return h;
}

function ensure(w, h) {
  if (layer && layer.width === w && layer.height === h) return;
  layer = document.createElement("canvas");
  layer.width = w;
  layer.height = h;
  layerCtx = layer.getContext("2d");
  key = "";
}

export function inkLayerStats() {
  return { mode };
}

/**
 * Draw committed ink. The context must already be in world space; the
 * bitmap is blitted in device pixels and the world transform is restored
 * for whatever is drawn on top (the live stroke).
 */
export function drawInkLayer(ctx, scene, view, doomed) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ensure(w, h);

  const dpr = window.devicePixelRatio || 1;
  const next = `${w}x${h}|${dpr}|${view.zoom}|${view.panX}|${view.panY}|${inkSceneRev()}|${overlayKey(scene, doomed)}|${sheetKey(scene)}`;
  if (next !== key) {
    mode = "rebuild";
    layerCtx.setTransform(1, 0, 0, 1, 0, 0);
    layerCtx.globalAlpha = 1;
    layerCtx.filter = "none";
    layerCtx.globalCompositeOperation = "source-over";
    // Paper and grid are already on the stage. Copy them under the ink so
    // a pencil multiplies into the sheet instead of into empty pixels.
    layerCtx.drawImage(ctx.canvas, 0, 0);
    layerCtx.lineCap = "round";
    layerCtx.lineJoin = "round";
    applyViewTransform(layerCtx, view);
    beginBrushFrame();
    drawCommitted(layerCtx, scene, view, doomed);
    key = next;
  } else {
    mode = "reuse";
  }

  const prev = ctx.getTransform();
  const prevAlpha = ctx.globalAlpha;
  const prevOp = ctx.globalCompositeOperation;
  const prevFilter = ctx.filter;
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.setTransform(prev.a, prev.b, prev.c, prev.d, prev.e, prev.f);
  ctx.globalAlpha = prevAlpha;
  ctx.globalCompositeOperation = prevOp;
  ctx.filter = prevFilter;
}
