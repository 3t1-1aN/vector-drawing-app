// io/sampler.js
// Offscreen renderer used by the eyedropper. The live canvas is cleared at
// the start of every frame, so reading pixels from it mid-gesture is not
// reliable; instead we replay the scene (background + elements) onto a
// small offscreen canvas with the same draw calls, keeping the DPR-scaled
// screen transform so screen coordinates map 1:1.

import { resetToScreenSpace, applyViewTransform } from "../core/canvas.js";
import { drawBackground } from "../render/background.js";
import { drawScene } from "../render/elements.js";
import { view } from "../core/view.js";

let canvas = null;
let ctx = null;

function ensure() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  ctx = canvas.getContext("2d", { willReadFrequently: true });
}

/** Re-render the scene offscreen and return the device pixel at (sx, sy). */
export function sampleScreen(scene, sx, sy) {
  ensure();
  resetToScreenSpace(ctx);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground(ctx);
  applyViewTransform(ctx, view);
  drawScene(ctx, scene, view, null);

  const dpr = window.devicePixelRatio || 1;
  const x = Math.floor(sx * dpr);
  const y = Math.floor(sy * dpr);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  const d = ctx.getImageData(x, y, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
}
